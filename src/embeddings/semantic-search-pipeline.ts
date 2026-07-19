/**
 * Shared search pipeline used by all `semanticSearch*` entry points.
 *
 * Split out of semantic-search.ts for the 700 LOC refactor. The
 * pipeline is internal: callers import the thin wrappers from
 * semantic-search.ts, which delegate here for preparation and
 * post-processing. Breaking `prepareSearchPipeline` into three helpers
 * keeps every function under the 150 LOC cap.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { type DocumentKey, resolveSourceFile } from '../db/canonical.js'
import {
  type ApiKeyInvalidError,
  type ApiKeyMissingError,
  DimensionMismatchError,
  EmbeddingError,
  EmbeddingsNotFoundError,
  type FileReadError,
  type IndexCorruptedError,
  type VectorStoreError,
} from '../errors/index.js'
import { dbIndexDir, resolveMdmHome } from '../home.js'
import { createStorage, loadSectionIndex } from '../index/storage.js'
import type { SectionEntry } from '../index/types.js'
import type {
  CapabilityNotSupported,
  ProviderId,
  ProviderNotFound,
} from '../providers/index.js'
import { matchPath } from '../search/path-matcher.js'
import { getRecommendedDimensions, supportsMatryoshka } from './dimensions.js'
import { createEmbeddingClient } from './embed-batched.js'
import {
  type ActiveProvider,
  generateNamespace,
  getActiveNamespace,
} from './embedding-namespace.js'
import {
  checkHnswMismatch,
  getHnswCacheEntry,
  hnswCacheKey,
  setHnswCacheEntry,
} from './hnsw-cache.js'
import { generateHypotheticalDocument } from './hyde.js'
import { resolveHydeOptions } from './hyde-options.js'
import { calculateRankingBoost, preprocessQuery } from './ranking.js'
import {
  QUALITY_EF_SEARCH,
  type SemanticSearchOptions,
  type SemanticSearchResult,
} from './types.js'
import {
  createNamespacedVectorStore,
  type VectorSearchResult,
  type VectorStore,
} from './vector-store.js'

// ============================================================================
// Types
// ============================================================================

/** Prepared state from the shared search pipeline setup steps. */
export interface SearchPipelineContext {
  readonly resolvedRoot: string
  readonly vectorStore: VectorStore
  readonly queryVector: number[]
  readonly limit: number
  readonly threshold: number
  readonly efSearch: number | undefined
  /**
   * Multiplier applied to `limit` when fetching raw candidates from the
   * vector store. HyDE benefits from a larger pool because its main value is
   * surfacing chunks that sit lexically further from the original query, and
   * those candidates need to enter the ranking stage to begin with.
   */
  readonly candidateMultiplier: number
}

/** Candidate pool multipliers for the dense-retrieval stage. */
const CANDIDATE_MULTIPLIER_DEFAULT = 2
const CANDIDATE_MULTIPLIER_HYDE = 10

// ============================================================================
// Private helpers for prepareSearchPipeline
// ============================================================================

/**
 * Load the vector store for the active namespace, from the HNSW cache
 * when present or from disk otherwise. Caches the loaded store so
 * subsequent calls against the same root+namespace skip the load.
 */
const loadVectorStoreForActive = (
  resolvedRoot: string,
  activeProvider: ActiveProvider,
): Effect.Effect<
  VectorStore,
  EmbeddingsNotFoundError | VectorStoreError | DimensionMismatchError
> =>
  Effect.gen(function* () {
    const namespace = generateNamespace(
      activeProvider.provider,
      activeProvider.model,
      activeProvider.dimensions,
    )
    const cacheKey = hnswCacheKey(resolvedRoot, namespace)
    const cached = getHnswCacheEntry(cacheKey)
    if (cached) {
      return cached
    }

    const freshStore = createNamespacedVectorStore(
      resolvedRoot,
      activeProvider.provider,
      activeProvider.model,
      activeProvider.dimensions,
    )
    const loadResult = yield* freshStore.load()

    if (!loadResult.loaded) {
      return yield* Effect.fail(
        new EmbeddingsNotFoundError({ path: resolvedRoot }),
      )
    }

    yield* checkHnswMismatch(loadResult.hnswMismatch)

    setHnswCacheEntry(cacheKey, freshStore)
    return freshStore
  })

/**
 * Determine the text we actually embed for the query. When HyDE is
 * enabled, generate a hypothetical document via the resolved HyDE
 * provider. Otherwise preprocess the raw query (unless disabled).
 */
const resolveQueryText = (
  query: string,
  options: SemanticSearchOptions,
): Effect.Effect<
  string,
  | ApiKeyMissingError
  | ApiKeyInvalidError
  | EmbeddingError
  | CapabilityNotSupported
  | ProviderNotFound
> =>
  Effect.gen(function* () {
    if (!options.hyde) {
      return options.skipPreprocessing ? query : preprocessQuery(query)
    }

    // Resolve effective HyDE provider, baseURL, and credentials with the
    // following precedence:
    //   1. Explicit hydeOptions.* takes priority.
    //   2. Otherwise inherit from the embedding-side providerConfig where
    //      the field can be carried across (provider, baseURL).
    //   3. Otherwise fall back to per-provider defaults inside hyde.ts.
    // Voyage cannot serve chat completions; resolveHydeOptions fails fast
    // with CapabilityNotSupported when the embedding side is voyage and
    // no explicit HyDE provider override is pinned.
    const resolvedHydeOptions = yield* resolveHydeOptions(options)
    const hydeResult = yield* generateHypotheticalDocument(
      query,
      resolvedHydeOptions,
    )
    yield* Effect.logDebug(
      `HyDE generated ${hydeResult.tokensUsed} tokens ($${hydeResult.cost.toFixed(6)})`,
    )
    return hydeResult.hypotheticalDocument
  })

// ============================================================================
// prepareSearchPipeline
// ============================================================================

/**
 * Shared setup for semantic search: resolves the root path, loads the active
 * embedding namespace, creates the embedding provider, verifies dimension
 * compatibility, loads the vector store, handles HyDE if enabled, and embeds
 * the query.
 *
 * All `semanticSearch*` entry points delegate here to avoid duplicating
 * the 10-step preparation sequence.
 */
export const prepareSearchPipeline = (
  rootPath: string,
  query: string,
  options: SemanticSearchOptions,
): Effect.Effect<
  SearchPipelineContext,
  | EmbeddingsNotFoundError
  | ApiKeyMissingError
  | ApiKeyInvalidError
  | CapabilityNotSupported
  | ProviderNotFound
  | EmbeddingError
  | VectorStoreError
  | DimensionMismatchError
> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath)

    // Get active namespace to determine which embedding index to use
    const activeProvider = yield* getActiveNamespace(resolvedRoot).pipe(
      Effect.catchAll(() => Effect.succeed(null as ActiveProvider | null)),
    )

    if (!activeProvider) {
      return yield* Effect.fail(
        new EmbeddingsNotFoundError({ path: resolvedRoot }),
      )
    }

    // Resolve provider config and build the runtime client for query embedding.
    const queryProviderConfig = options.providerConfig ?? { provider: 'openai' }
    const currentProviderName: ProviderId = queryProviderConfig.provider
    const queryModel = queryProviderConfig.model ?? 'text-embedding-3-small'
    const dimensions = getRecommendedDimensions(queryModel) ?? 512
    const client = yield* createEmbeddingClient(currentProviderName, {
      baseURL: queryProviderConfig.baseURL,
    })

    // Verify dimensions match the active namespace
    if (dimensions !== activeProvider.dimensions) {
      return yield* Effect.fail(
        new DimensionMismatchError({
          corpusDimensions: activeProvider.dimensions,
          providerDimensions: dimensions,
          corpusProvider: `${activeProvider.provider}:${activeProvider.model}`,
          currentProvider: currentProviderName,
          path: resolvedRoot,
        }),
      )
    }

    const vectorStore = yield* loadVectorStoreForActive(
      resolvedRoot,
      activeProvider,
    )

    const textToEmbed = yield* resolveQueryText(query, options)

    // Embed the query (or hypothetical document) directly via the runtime
    // client. No batching needed for a single text. The runtime returns
    // Effect natively so no Promise wrapping is required.
    //
    // Pass `dimensions` to the API only for Matryoshka-capable models so the
    // returned query vector has the same width as the corpus. Non-Matryoshka
    // models always emit native dimensions and would reject the parameter.
    const queryResult = yield* client
      .embed([textToEmbed], {
        model: queryModel,
        ...(supportsMatryoshka(queryModel) ? { dimensions } : {}),
      })
      .pipe(
        Effect.mapError(
          (e) =>
            new EmbeddingError({
              reason: 'Unknown',
              message: e.message,
              provider: currentProviderName,
              cause: e.cause,
            }),
        ),
      )

    const queryVector = queryResult.embeddings[0]
    if (!queryVector) {
      return yield* Effect.fail(
        new EmbeddingError({
          reason: 'Unknown',
          message: 'Failed to generate query embedding',
          provider: currentProviderName,
        }),
      )
    }

    const limit = options.limit ?? 10
    const threshold = options.threshold ?? 0
    const efSearch = options.quality
      ? QUALITY_EF_SEARCH[options.quality]
      : undefined
    const candidateMultiplier = options.hyde
      ? CANDIDATE_MULTIPLIER_HYDE
      : CANDIDATE_MULTIPLIER_DEFAULT

    // hnswlib-node's searchKnn requires a mutable number[]; the runtime
    // returns readonly number[] from embed. Copy once here so the rest of
    // the pipeline can pass the vector through unchanged.
    return {
      resolvedRoot,
      vectorStore,
      queryVector: [...queryVector],
      limit,
      threshold,
      efSearch,
      candidateMultiplier,
    }
  })

// ============================================================================
// Post-processing
// ============================================================================

/**
 * Add context lines to search results by loading section content from
 * files. Shared between `semanticSearch` and `semanticSearchWithStats`
 * via `postProcessResults`.
 */
const addContextLinesToResults = (
  limitedResults: readonly VectorSearchResult[],
  sectionIndex: { sections: Record<string, SectionEntry> },
  options: {
    contextBefore?: number | undefined
    contextAfter?: number | undefined
  },
): Effect.Effect<readonly SemanticSearchResult[], FileReadError, never> =>
  Effect.gen(function* () {
    const contextBefore = options.contextBefore ?? 0
    const contextAfter = options.contextAfter ?? 0

    const resultsWithContext: SemanticSearchResult[] = []
    const fileCache = new Map<DocumentKey, string>()

    for (const r of limitedResults) {
      const section = sectionIndex.sections[r.sectionId]
      if (!section) {
        resultsWithContext.push({
          sectionId: r.sectionId,
          documentPath: r.documentPath,
          heading: r.heading,
          similarity: r.similarity,
        })
        continue
      }

      let fileContent = fileCache.get(r.documentPath)
      if (!fileContent) {
        const filePath = resolveSourceFile(r.documentPath)
        const contentResult = yield* Effect.promise(() =>
          fs.readFile(filePath, 'utf-8'),
        ).pipe(
          Effect.map((content) => content),
          Effect.catchAll(() => Effect.succeed(null as string | null)),
        )

        if (contentResult) {
          fileContent = contentResult
          fileCache.set(r.documentPath, fileContent)
        }
      }

      if (fileContent) {
        const lines = fileContent.split('\n')
        const startIdx = Math.max(0, section.startLine - 1 - contextBefore)
        const endIdx = Math.min(lines.length, section.endLine + contextAfter)

        const contextLines: {
          lineNumber: number
          line: string
          isMatch: boolean
        }[] = []
        for (let i = startIdx; i < endIdx; i++) {
          const line = lines[i]
          if (line !== undefined) {
            contextLines.push({
              lineNumber: i + 1,
              line,
              isMatch: i >= section.startLine - 1 && i < section.endLine,
            })
          }
        }

        resultsWithContext.push({
          sectionId: r.sectionId,
          documentPath: r.documentPath,
          heading: r.heading,
          similarity: r.similarity,
          contextLines,
        })
      } else {
        resultsWithContext.push({
          sectionId: r.sectionId,
          documentPath: r.documentPath,
          heading: r.heading,
          similarity: r.similarity,
        })
      }
    }

    return resultsWithContext
  })

/**
 * Shared post-search processing: applies path filtering, heading/file
 * importance boost, re-sorts by boosted similarity, applies limit, and
 * optionally loads context lines.
 */
export const postProcessResults = (
  rawResults: readonly VectorSearchResult[],
  query: string,
  options: SemanticSearchOptions,
  resolvedRoot: string,
  limit: number,
): Effect.Effect<
  { results: readonly SemanticSearchResult[]; totalAvailable: number },
  FileReadError | IndexCorruptedError
> =>
  Effect.gen(function* () {
    // Apply path filter if specified
    let filteredResults = rawResults
    if (options.pathPattern) {
      filteredResults = rawResults.filter((r) =>
        matchPath(r.documentPath, options.pathPattern!),
      )
    }

    // Apply ranking boost (heading + file importance, enabled by default).
    // calculateRankingBoost already clamps the total to TOTAL_BOOST_CAP so
    // cosine similarity stays the primary ranking signal. See ranking.ts
    // for the rationale.
    const applyBoost = options.headingBoost !== false
    const boostedResults = applyBoost
      ? filteredResults.map((r) => ({
          ...r,
          similarity: Math.min(
            1,
            r.similarity +
              calculateRankingBoost(r.heading, query, r.documentPath),
          ),
        }))
      : filteredResults

    // Re-sort by boosted similarity
    const sortedResults = [...boostedResults].sort(
      (a: VectorSearchResult, b: VectorSearchResult) =>
        b.similarity - a.similarity,
    )
    const totalAvailable = sortedResults.length
    const limitedResults = sortedResults.slice(0, limit)

    // If context lines are requested, load section content
    let results: readonly SemanticSearchResult[]
    if (
      options.contextBefore !== undefined ||
      options.contextAfter !== undefined
    ) {
      const storage = createStorage(resolvedRoot, dbIndexDir(resolveMdmHome()))
      const sectionIndex = yield* loadSectionIndex(storage)

      if (sectionIndex) {
        results = yield* addContextLinesToResults(
          limitedResults,
          sectionIndex,
          options,
        )
      } else {
        results = limitedResults.map((r: VectorSearchResult) => ({
          sectionId: r.sectionId,
          documentPath: r.documentPath,
          heading: r.heading,
          similarity: r.similarity,
        }))
      }
    } else {
      results = limitedResults.map((r: VectorSearchResult) => ({
        sectionId: r.sectionId,
        documentPath: r.documentPath,
        heading: r.heading,
        similarity: r.similarity,
      }))
    }

    return { results, totalAvailable }
  })
