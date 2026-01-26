/**
 * Hybrid Search with Reciprocal Rank Fusion (RRF)
 *
 * Combines BM25 keyword search with semantic vector search for improved
 * recall (15-30% improvement over single-method retrieval).
 *
 * RRF Formula: score(doc) = Σ weight / (k + rank)
 * k = 60 (standard smoothing constant from research)
 */

import * as path from 'node:path'
import { Effect } from 'effect'
import { semanticSearch } from '../embeddings/semantic-search.js'
import type {
  SearchQuality,
  SemanticSearchResult,
} from '../embeddings/types.js'
import type {
  ApiKeyInvalidError,
  ApiKeyMissingError,
  EmbeddingError,
  FileReadError,
  VectorStoreError,
} from '../errors/index.js'
import {
  type BM25SearchResult,
  bm25IndexExists,
  bm25Search,
} from './bm25-store.js'
import {
  isRerankerAvailable,
  type RerankerError,
  rerankResults,
} from './cross-encoder.js'

// ============================================================================
// Types
// ============================================================================

export type SearchMode = 'hybrid' | 'semantic' | 'keyword'

export interface HybridSearchOptions {
  /** Maximum number of results */
  readonly limit?: number
  /** Minimum similarity threshold for semantic search (0-1) */
  readonly threshold?: number
  /** Filter by document path pattern */
  readonly pathPattern?: string
  /** Force a specific search mode */
  readonly mode?: SearchMode
  /** BM25 weight for RRF (default: 1.0) */
  readonly bm25Weight?: number
  /** Semantic weight for RRF (default: 1.0) */
  readonly semanticWeight?: number
  /** RRF k constant (default: 60) */
  readonly rrfK?: number
  /** Enable cross-encoder re-ranking for improved precision */
  readonly rerank?: boolean
  /** Search quality mode: fast, balanced (default), or thorough */
  readonly quality?: SearchQuality | undefined
}

export interface HybridSearchResult {
  readonly sectionId: string
  readonly documentPath: string
  readonly heading: string
  /** Combined RRF score (higher is better) */
  readonly score: number
  /** Semantic similarity if available (0-1) */
  readonly similarity?: number
  /** BM25 score if available */
  readonly bm25Score?: number
  /** Which search methods contributed to this result */
  readonly sources: readonly ('semantic' | 'keyword')[]
  /** Cross-encoder re-ranking score (if reranking was enabled) */
  readonly rerankerScore?: number
}

export interface HybridSearchStats {
  readonly mode: SearchMode
  readonly modeReason: string
  readonly semanticResults: number
  readonly keywordResults: number
  readonly combinedResults: number
  readonly bm25Available: boolean
  readonly embeddingsAvailable: boolean
  /** Whether re-ranking was applied */
  readonly reranked?: boolean
}

// ============================================================================
// RRF Fusion
// ============================================================================

/**
 * Reciprocal Rank Fusion (RRF) combines rankings from multiple retrieval methods.
 *
 * For each document, RRF score = Σ weight / (k + rank)
 * where k is a smoothing constant (60 by default from research).
 *
 * This approach:
 * - Doesn't require score normalization between methods
 * - Gives higher weight to documents ranked highly by both methods
 * - Naturally handles missing results from either method
 */
const fusionRRF = (
  semanticResults: readonly SemanticSearchResult[],
  keywordResults: readonly BM25SearchResult[],
  options: {
    bm25Weight: number
    semanticWeight: number
    rrfK: number
    limit: number
  },
): HybridSearchResult[] => {
  const { bm25Weight, semanticWeight, rrfK, limit } = options

  // Map to accumulate RRF scores by sectionId
  const scoreMap = new Map<
    string,
    {
      documentPath: string
      heading: string
      rrfScore: number
      similarity?: number
      bm25Score?: number
      sources: Set<'semantic' | 'keyword'>
    }
  >()

  // Add semantic results (rank is 1-indexed)
  for (let rank = 0; rank < semanticResults.length; rank++) {
    const result = semanticResults[rank]
    if (!result) continue

    const rrfContribution = semanticWeight / (rrfK + rank + 1)

    const existing = scoreMap.get(result.sectionId)
    if (existing) {
      existing.rrfScore += rrfContribution
      existing.similarity = result.similarity
      existing.sources.add('semantic')
    } else {
      scoreMap.set(result.sectionId, {
        documentPath: result.documentPath,
        heading: result.heading,
        rrfScore: rrfContribution,
        similarity: result.similarity,
        sources: new Set(['semantic']),
      })
    }
  }

  // Add keyword (BM25) results
  for (const result of keywordResults) {
    const rrfContribution = bm25Weight / (rrfK + result.rank)

    const existing = scoreMap.get(result.sectionId)
    if (existing) {
      existing.rrfScore += rrfContribution
      existing.bm25Score = result.score
      existing.sources.add('keyword')
    } else {
      scoreMap.set(result.sectionId, {
        documentPath: result.documentPath,
        heading: result.heading,
        rrfScore: rrfContribution,
        bm25Score: result.score,
        sources: new Set(['keyword']),
      })
    }
  }

  // Convert to array and sort by RRF score
  const results: HybridSearchResult[] = Array.from(scoreMap.entries())
    .map(([sectionId, data]) => {
      const result: HybridSearchResult = {
        sectionId,
        documentPath: data.documentPath,
        heading: data.heading,
        score: data.rrfScore,
        sources: Array.from(data.sources) as readonly (
          | 'semantic'
          | 'keyword'
        )[],
      }
      if (data.similarity !== undefined) {
        ;(result as { similarity: number }).similarity = data.similarity
      }
      if (data.bm25Score !== undefined) {
        ;(result as { bm25Score: number }).bm25Score = data.bm25Score
      }
      return result
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return results
}

// ============================================================================
// Hybrid Search
// ============================================================================

/**
 * Perform hybrid search combining semantic and keyword (BM25) search.
 *
 * Mode detection priority:
 * 1. Explicit mode option
 * 2. 'hybrid' if both indexes available
 * 3. 'semantic' if only embeddings available
 * 4. 'keyword' if only BM25 available
 * 5. Error if neither available
 *
 * @param rootPath - Root directory containing indexes
 * @param query - Search query text
 * @param options - Search options
 * @returns Ranked list of results with combined scores
 */
export const hybridSearch = (
  rootPath: string,
  query: string,
  options: HybridSearchOptions = {},
): Effect.Effect<
  { results: readonly HybridSearchResult[]; stats: HybridSearchStats },
  | FileReadError
  | ApiKeyMissingError
  | ApiKeyInvalidError
  | EmbeddingError
  | VectorStoreError
  | RerankerError
> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath)
    const limit = options.limit ?? 10
    const threshold = options.threshold ?? 0.35
    const bm25Weight = options.bm25Weight ?? 1.0
    const semanticWeight = options.semanticWeight ?? 1.0
    const rrfK = options.rrfK ?? 60

    // Check index availability
    const hasBM25 = yield* bm25IndexExists(resolvedRoot)

    // Check for embeddings by trying semantic search
    // This is a lightweight check that fails fast if no embeddings exist
    let hasEmbeddings = false
    let semanticResults: readonly SemanticSearchResult[] = []

    if (options.mode !== 'keyword') {
      const semanticEffect = semanticSearch(resolvedRoot, query, {
        limit: limit * 2, // Get more for better fusion
        threshold,
        pathPattern: options.pathPattern,
        quality: options.quality,
      })

      const semanticTry = yield* Effect.either(semanticEffect)
      if (semanticTry._tag === 'Right') {
        hasEmbeddings = true
        semanticResults = semanticTry.right
      }
    }

    // Get BM25 results if available
    let keywordResults: readonly BM25SearchResult[] = []
    if (hasBM25 && options.mode !== 'semantic') {
      keywordResults = yield* bm25Search(resolvedRoot, query, limit * 2)
    }

    // Determine effective mode and reason
    let effectiveMode: SearchMode
    let modeReason: string

    if (options.mode) {
      effectiveMode = options.mode
      modeReason = `--mode ${options.mode}`
    } else if (hasEmbeddings && hasBM25) {
      effectiveMode = 'hybrid'
      modeReason = 'both indexes available'
    } else if (hasEmbeddings) {
      effectiveMode = 'semantic'
      modeReason = 'embeddings available, no BM25 index'
    } else if (hasBM25) {
      effectiveMode = 'keyword'
      modeReason = 'BM25 available, no embeddings'
    } else {
      effectiveMode = 'keyword'
      modeReason = 'no indexes available'
    }

    // Perform fusion based on mode
    let results: HybridSearchResult[]

    if (effectiveMode === 'hybrid') {
      results = fusionRRF(semanticResults, keywordResults, {
        bm25Weight,
        semanticWeight,
        rrfK,
        limit,
      })
    } else if (effectiveMode === 'semantic') {
      // Convert semantic results to hybrid format
      results = semanticResults.slice(0, limit).map((r, idx) => ({
        sectionId: r.sectionId,
        documentPath: r.documentPath,
        heading: r.heading,
        score: semanticWeight / (rrfK + idx + 1), // RRF-style score for consistency
        similarity: r.similarity,
        sources: ['semantic'] as const,
      }))
    } else {
      // Convert keyword results to hybrid format
      results = keywordResults.slice(0, limit).map((r) => ({
        sectionId: r.sectionId,
        documentPath: r.documentPath,
        heading: r.heading,
        score: bm25Weight / (rrfK + r.rank),
        bm25Score: r.score,
        sources: ['keyword'] as const,
      }))
    }

    // Apply cross-encoder re-ranking if enabled
    let reranked = false
    if (options.rerank && results.length > 0) {
      // Check if reranker is available
      const rerankerAvailable = yield* isRerankerAvailable()
      if (rerankerAvailable) {
        // Re-rank using cross-encoder (top 20 -> top N)
        const rerankedResults = yield* rerankResults(
          query,
          results,
          (r) => `${r.heading} (${r.documentPath})`,
          { topK: 20, returnTopN: limit },
        )

        // Update results with reranker scores
        results = rerankedResults.map((rr) => ({
          ...rr.item,
          rerankerScore: rr.rerankerScore,
        }))
        reranked = true
      }
    }

    const stats: HybridSearchStats = {
      mode: effectiveMode,
      modeReason,
      semanticResults: semanticResults.length,
      keywordResults: keywordResults.length,
      combinedResults: results.length,
      bm25Available: hasBM25,
      embeddingsAvailable: hasEmbeddings,
      reranked,
    }

    return { results, stats }
  })

// ============================================================================
// Mode Detection Helper
// ============================================================================

/**
 * Detect available search modes for a directory
 */
export const detectSearchModes = (
  rootPath: string,
): Effect.Effect<
  { hasBM25: boolean; hasEmbeddings: boolean; recommendedMode: SearchMode },
  never
> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath)
    const hasBM25 = yield* bm25IndexExists(resolvedRoot)

    // Check embeddings by looking for vector store files
    const hasEmbeddings = yield* Effect.promise(async () => {
      const fs = await import('node:fs/promises')
      const indexDir = path.join(resolvedRoot, '.mdcontext')
      try {
        await fs.access(path.join(indexDir, 'vectors.bin'))
        return true
      } catch {
        return false
      }
    })

    let recommendedMode: SearchMode
    if (hasBM25 && hasEmbeddings) {
      recommendedMode = 'hybrid'
    } else if (hasEmbeddings) {
      recommendedMode = 'semantic'
    } else {
      recommendedMode = 'keyword'
    }

    return { hasBM25, hasEmbeddings, recommendedMode }
  })
