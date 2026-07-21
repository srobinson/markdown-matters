/**
 * Hybrid Search with Reciprocal Rank Fusion (RRF)
 *
 * Combines BM25 keyword search with semantic vector search for improved
 * recall (15-30% improvement over single-method retrieval).
 *
 * RRF Formula: score(doc) = Σ weight / (k + rank)
 * k = 60 (standard smoothing constant from research)
 */

import { Effect } from 'effect'
import type { ContextLine } from '../core/types.js'
import type { DocumentKey } from '../db/canonical.js'
import type { GenerationReadSession } from '../db/generation-reader.js'
import { listNamespaces } from '../embeddings/embedding-namespace.js'
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
  IndexCorruptedError,
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
import {
  matchesDocumentPath,
  resolveCanonicalSourceRoot,
} from './path-matcher.js'

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
  /** Lines of context before matches */
  readonly contextBefore?: number | undefined
  /** Lines of context after matches */
  readonly contextAfter?: number | undefined
}

export interface HybridSearchResult {
  readonly sectionId: string
  readonly documentPath: DocumentKey
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
  /** Context lines with their line numbers (when context is requested) */
  readonly contextLines?: readonly ContextLine[] | undefined
}

// ContextLine is imported from src/core/types.ts (canonical definition)

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
  /** Total unique results available before limit was applied */
  readonly totalAvailable?: number
}

export type HybridSearchError =
  | FileReadError
  | IndexCorruptedError
  | ApiKeyMissingError
  | ApiKeyInvalidError
  | EmbeddingError
  | VectorStoreError
  | RerankerError

export interface SearchChannels {
  readonly semanticResults: readonly SemanticSearchResult[]
  readonly keywordResults: readonly BM25SearchResult[]
  readonly hasEmbeddings: boolean
  readonly hasBM25: boolean
}

type ProjectionOptions = Required<
  Pick<HybridSearchOptions, 'limit' | 'bm25Weight' | 'semanticWeight' | 'rrfK'>
>

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
): { results: HybridSearchResult[]; totalAvailable: number } => {
  const { bm25Weight, semanticWeight, rrfK, limit } = options

  // Map to accumulate RRF scores by sectionId
  const scoreMap = new Map<
    string,
    {
      documentPath: DocumentKey
      heading: string
      rrfScore: number
      similarity?: number
      bm25Score?: number
      sources: Set<'semantic' | 'keyword'>
      contextLines?: readonly ContextLine[]
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
      if (result.contextLines && !existing.contextLines) {
        existing.contextLines = result.contextLines
      }
    } else {
      const entry: {
        documentPath: DocumentKey
        heading: string
        rrfScore: number
        similarity?: number
        bm25Score?: number
        sources: Set<'semantic' | 'keyword'>
        contextLines?: readonly ContextLine[]
      } = {
        documentPath: result.documentPath,
        heading: result.heading,
        rrfScore: rrfContribution,
        similarity: result.similarity,
        sources: new Set(['semantic']),
      }
      if (result.contextLines) {
        entry.contextLines = result.contextLines
      }
      scoreMap.set(result.sectionId, entry)
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
  const allResults: HybridSearchResult[] = Array.from(scoreMap.entries())
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
      if (data.contextLines !== undefined) {
        ;(result as { contextLines: readonly ContextLine[] }).contextLines =
          data.contextLines
      }
      return result
    })
    .sort((a, b) => b.score - a.score)

  return {
    results: allResults.slice(0, limit),
    totalAvailable: allResults.length,
  }
}

// ============================================================================
// Hybrid Search
// ============================================================================

export const collectSearchChannels = (
  session: GenerationReadSession,
  sourceRoot: string,
  query: string,
  options: HybridSearchOptions,
  limit: number,
  threshold: number,
): Effect.Effect<SearchChannels, HybridSearchError> =>
  Effect.gen(function* () {
    const hasBM25 = yield* bm25IndexExists(session.indexRoot)
    let hasEmbeddings = false
    let semanticResults: readonly SemanticSearchResult[] = []

    if (options.mode !== 'keyword') {
      const semanticTry = yield* Effect.either(
        semanticSearch(session, sourceRoot, query, {
          limit: limit * 2,
          threshold,
          pathPattern: options.pathPattern,
          quality: options.quality,
          contextBefore: options.contextBefore,
          contextAfter: options.contextAfter,
        }),
      )
      if (semanticTry._tag === 'Right') {
        hasEmbeddings = true
        semanticResults = semanticTry.right
      }
    }

    let keywordResults: readonly BM25SearchResult[] = []
    if (hasBM25 && options.mode !== 'semantic') {
      const rawResults = yield* bm25Search(session.indexRoot, query, limit * 2)
      const scopeRoot = options.pathPattern
        ? yield* resolveCanonicalSourceRoot(sourceRoot)
        : sourceRoot
      keywordResults = options.pathPattern
        ? rawResults.filter((result) =>
            matchesDocumentPath(
              scopeRoot,
              result.documentPath,
              options.pathPattern,
            ),
          )
        : rawResults
    }

    return { semanticResults, keywordResults, hasEmbeddings, hasBM25 }
  })

export const selectEffectiveMode = (
  requested: SearchMode | undefined,
  channels: SearchChannels,
): { mode: SearchMode; reason: string } => {
  if (requested) return { mode: requested, reason: `--mode ${requested}` }
  if (channels.hasEmbeddings && channels.hasBM25) {
    return { mode: 'hybrid', reason: 'both indexes available' }
  }
  if (channels.hasEmbeddings) {
    return { mode: 'semantic', reason: 'embeddings available, no BM25 index' }
  }
  if (channels.hasBM25) {
    return { mode: 'keyword', reason: 'BM25 available, no embeddings' }
  }
  return { mode: 'keyword', reason: 'no indexes available' }
}

export const projectSearchResults = (
  mode: SearchMode,
  channels: SearchChannels,
  options: ProjectionOptions,
): { results: HybridSearchResult[]; totalAvailable: number | undefined } => {
  const { semanticResults, keywordResults } = channels
  const { limit, bm25Weight, semanticWeight, rrfK } = options
  if (mode === 'hybrid') {
    return fusionRRF(semanticResults, keywordResults, options)
  }
  if (mode === 'semantic') {
    return {
      totalAvailable: semanticResults.length,
      results: semanticResults.slice(0, limit).map((result, index) => ({
        sectionId: result.sectionId,
        documentPath: result.documentPath,
        heading: result.heading,
        score: semanticWeight / (rrfK + index + 1),
        similarity: result.similarity,
        sources: ['semantic'] as const,
      })),
    }
  }
  return {
    totalAvailable: keywordResults.length,
    results: keywordResults.slice(0, limit).map((result) => ({
      sectionId: result.sectionId,
      documentPath: result.documentPath,
      heading: result.heading,
      score: bm25Weight / (rrfK + result.rank),
      bm25Score: result.score,
      sources: ['keyword'] as const,
    })),
  }
}

const rerankProjectedResults = (
  query: string,
  results: readonly HybridSearchResult[],
  limit: number,
  enabled: boolean,
): Effect.Effect<
  { results: HybridSearchResult[]; reranked: boolean },
  RerankerError
> =>
  Effect.gen(function* () {
    if (!enabled || results.length === 0 || !(yield* isRerankerAvailable())) {
      return { results: [...results], reranked: false }
    }
    const rerankedResults = yield* rerankResults(
      query,
      results,
      (result) => `${result.heading} (${result.documentPath})`,
      { topK: 20, returnTopN: limit },
    )
    return {
      results: rerankedResults.map((result) => ({
        ...result.item,
        rerankerScore: result.rerankerScore,
      })),
      reranked: true,
    }
  })

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
  session: GenerationReadSession,
  sourceRoot: string,
  query: string,
  options: HybridSearchOptions = {},
): Effect.Effect<
  { results: readonly HybridSearchResult[]; stats: HybridSearchStats },
  HybridSearchError
> =>
  Effect.gen(function* () {
    const limit = options.limit ?? 10
    const threshold = options.threshold ?? 0.35
    const projectionOptions: ProjectionOptions = {
      limit,
      bm25Weight: options.bm25Weight ?? 1.0,
      semanticWeight: options.semanticWeight ?? 1.0,
      rrfK: options.rrfK ?? 60,
    }
    const channels = yield* collectSearchChannels(
      session,
      sourceRoot,
      query,
      options,
      limit,
      threshold,
    )
    const effective = selectEffectiveMode(options.mode, channels)
    const projected = projectSearchResults(
      effective.mode,
      channels,
      projectionOptions,
    )
    const reranking = yield* rerankProjectedResults(
      query,
      projected.results,
      limit,
      options.rerank ?? false,
    )

    const stats: HybridSearchStats = {
      mode: effective.mode,
      modeReason: effective.reason,
      semanticResults: channels.semanticResults.length,
      keywordResults: channels.keywordResults.length,
      combinedResults: reranking.results.length,
      bm25Available: channels.hasBM25,
      embeddingsAvailable: channels.hasEmbeddings,
      reranked: reranking.reranked,
      ...(projected.totalAvailable === undefined
        ? {}
        : { totalAvailable: projected.totalAvailable }),
    }

    return { results: reranking.results, stats }
  })

// ============================================================================
// Mode Detection Helper
// ============================================================================

/**
 * Detect available search modes for a directory
 */
export const detectSearchModes = (
  session: GenerationReadSession,
): Effect.Effect<
  { hasBM25: boolean; hasEmbeddings: boolean; recommendedMode: SearchMode },
  never
> =>
  Effect.gen(function* () {
    const hasBM25 = yield* bm25IndexExists(session.indexRoot)

    // Check embeddings by looking for namespaced vector stores
    const hasEmbeddings = yield* listNamespaces(session.indexRoot).pipe(
      Effect.map((namespaces) => namespaces.length > 0),
      Effect.catchAll(() => Effect.succeed(false)),
    )

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
