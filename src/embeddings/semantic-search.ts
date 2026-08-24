/**
 * Public entry points for semantic search.
 *
 * The heavy lifting is split across sibling files to respect the 700 LOC
 * per-file and 150 LOC per-function limits. This file keeps the three
 * public `semanticSearch*` functions and re-exports the symbols that
 * external callers already pull from this module path.
 */

import * as fs from 'node:fs/promises'
import { Effect } from 'effect'
import { resolveSourceFile } from '../db/canonical.js'
import type { GenerationReadSession } from '../db/generation-reader.js'
import type {
  ApiKeyInvalidError,
  ApiKeyMissingError,
  DimensionMismatchError,
  EmbeddingError,
  EmbeddingsNotFoundError,
  FileReadError,
  IndexCorruptedError,
  VectorStoreError,
} from '../errors/index.js'
import { createStorage, loadSectionIndex } from '../index/storage.js'
import type { ManifestError } from '../manifest.js'
import type {
  CapabilityNotSupported,
  ProviderNotFound,
} from '../providers/index.js'
import {
  postProcessResults,
  prepareSearchPipeline,
} from './semantic-search-pipeline.js'
import type {
  ResolvedSemanticSearchOptions,
  SemanticSearchResult,
  SemanticSearchResultWithStats,
} from './types.js'

// ----------------------------------------------------------------------------
// Shared error union
// ----------------------------------------------------------------------------

/**
 * Error union for every public `semanticSearch*` entry point. All three
 * wrappers delegate to `prepareSearchPipeline`, so they share the same
 * failure surface: pipeline setup, provider resolution, embedding, and
 * vector store access.
 */
export type SemanticSearchError =
  | EmbeddingsNotFoundError
  | FileReadError
  | IndexCorruptedError
  | ApiKeyMissingError
  | ApiKeyInvalidError
  | CapabilityNotSupported
  | ProviderNotFound
  | EmbeddingError
  | VectorStoreError
  | DimensionMismatchError
  | ManifestError

// ----------------------------------------------------------------------------
// Re-exports: keep the public surface stable for external callers.
// ----------------------------------------------------------------------------

export { checkPricingFreshness, getPricingDate } from '../providers/pricing.js'
export type { EmbeddingExecutionOptions } from './embed-batched.js'
export { clearHnswCache, invalidateHnswCache } from './hnsw-cache.js'
export {
  type BuildEmbeddingsOptions,
  type BuildEmbeddingsResult,
  buildEmbeddings,
  type EmbeddingBatchProgress,
  type FileProgress,
  type SectionChunkProgress,
  type SectionSkipProgress,
} from './semantic-search-build.js'
export {
  type DirectoryEstimate,
  type EmbeddingEstimate,
  estimateEmbeddingCost,
} from './semantic-search-cost.js'
export {
  type EmbeddingPersistenceInput,
  persistEmbeddingBuild,
} from './semantic-search-persistence.js'
export {
  type EmbeddingStats,
  getEmbeddingStats,
} from './semantic-search-stats.js'
export type { EmbeddingProviderConfig } from './types.js'

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Perform semantic search over embedded sections.
 *
 * @param rootPath - Root directory containing embeddings
 * @param query - Natural language search query
 * @param options - Search options (limit, threshold, path filter)
 * @returns Ranked list of matching sections by similarity
 *
 * @throws EmbeddingsNotFoundError - No embeddings exist (run index --embed first)
 * @throws ApiKeyMissingError - API key not set (check provider config)
 * @throws ApiKeyInvalidError - API key rejected by provider
 * @throws EmbeddingError - Embedding API failure (rate limit, quota, network)
 * @throws VectorStoreError - Cannot load or search vector index
 * @throws DimensionMismatchError - Corpus has different dimensions than current provider
 */
export const semanticSearch = (
  session: GenerationReadSession,
  sourceRoot: string,
  query: string,
  options: ResolvedSemanticSearchOptions,
): Effect.Effect<readonly SemanticSearchResult[], SemanticSearchError> =>
  Effect.gen(function* () {
    const ctx = yield* prepareSearchPipeline(
      session,
      sourceRoot,
      query,
      options,
    )

    const searchResults = yield* ctx.vectorStore.search(
      ctx.queryVector,
      ctx.limit * ctx.candidateMultiplier,
      ctx.threshold,
      { efSearch: ctx.efSearch },
    )

    const { results } = yield* postProcessResults(
      session,
      ctx.sourceRoot,
      searchResults,
      query,
      options,
      ctx.limit,
    )

    return results
  })

/**
 * Perform semantic search with stats about below-threshold results.
 * Use this when you want to provide feedback to users about results that
 * didn't meet the threshold.
 *
 * @param rootPath - Root directory containing embeddings
 * @param query - Natural language search query
 * @param options - Search options (limit, threshold, path filter)
 * @returns Results with optional below-threshold stats
 *
 * @throws EmbeddingsNotFoundError - No embeddings exist (run index --embed first)
 * @throws ApiKeyMissingError - API key not set (check provider config)
 * @throws ApiKeyInvalidError - API key rejected by provider
 * @throws EmbeddingError - Embedding API failure (rate limit, quota, network)
 * @throws VectorStoreError - Cannot load or search vector index
 * @throws DimensionMismatchError - Corpus has different dimensions than current provider
 */
export const semanticSearchWithStats = (
  session: GenerationReadSession,
  sourceRoot: string,
  query: string,
  options: ResolvedSemanticSearchOptions,
): Effect.Effect<SemanticSearchResultWithStats, SemanticSearchError> =>
  Effect.gen(function* () {
    const ctx = yield* prepareSearchPipeline(
      session,
      sourceRoot,
      query,
      options,
    )

    const searchResultWithStats = yield* ctx.vectorStore.searchWithStats(
      ctx.queryVector,
      ctx.limit * ctx.candidateMultiplier,
      ctx.threshold,
      { efSearch: ctx.efSearch },
    )

    const { results, totalAvailable } = yield* postProcessResults(
      session,
      ctx.sourceRoot,
      searchResultWithStats.results,
      query,
      options,
      ctx.limit,
    )

    return {
      results,
      belowThresholdCount: searchResultWithStats.belowThresholdCount,
      belowThresholdHighest:
        searchResultWithStats.belowThresholdHighest ?? undefined,
      totalAvailable,
    }
  })

/**
 * Perform semantic search and include section content in results.
 *
 * @param rootPath - Root directory containing embeddings
 * @param query - Natural language search query
 * @param options - Search options (limit, threshold, path filter)
 * @returns Ranked list of matching sections with content
 *
 * @throws EmbeddingsNotFoundError - No embeddings exist (run index --embed first)
 * @throws FileReadError - Cannot read index files
 * @throws IndexCorruptedError - Index files are corrupted
 * @throws ApiKeyMissingError - API key not set (check provider config)
 * @throws ApiKeyInvalidError - API key rejected by provider
 * @throws EmbeddingError - Embedding API failure (rate limit, quota, network)
 * @throws VectorStoreError - Cannot load or search vector index
 * @throws DimensionMismatchError - Corpus has different dimensions than current provider
 */
export const semanticSearchWithContent = (
  session: GenerationReadSession,
  sourceRoot: string,
  query: string,
  options: ResolvedSemanticSearchOptions,
): Effect.Effect<readonly SemanticSearchResult[], SemanticSearchError> =>
  Effect.gen(function* () {
    const results = yield* semanticSearch(session, sourceRoot, query, options)

    const storage = createStorage(sourceRoot, session.indexRoot)
    const sectionIndex = yield* loadSectionIndex(storage)

    if (!sectionIndex) {
      return results
    }

    const resultsWithContent: SemanticSearchResult[] = []

    for (const result of results) {
      const section = sectionIndex.sections[result.sectionId]
      if (!section) {
        resultsWithContent.push(result)
        continue
      }

      const filePath = resolveSourceFile(result.documentPath)

      // Note: catchAll is intentional - file read failures during search result
      // enrichment should skip content loading with a warning, not fail the search.
      // Results are still returned without content when files can't be read.
      const fileContentResult = yield* Effect.promise(() =>
        fs.readFile(filePath, 'utf-8'),
      ).pipe(
        Effect.map((content) => ({ ok: true as const, content })),
        Effect.catchAll(() =>
          Effect.succeed({ ok: false as const, content: '' }),
        ),
      )

      if (!fileContentResult.ok) {
        yield* Effect.logWarning(
          `Skipping content load (cannot read): ${result.documentPath}`,
        )
        resultsWithContent.push(result)
        continue
      }

      const lines = fileContentResult.content.split('\n')
      const content = lines
        .slice(section.startLine - 1, section.endLine)
        .join('\n')

      resultsWithContent.push({
        ...result,
        content,
      })
    }

    return resultsWithContent
  })
