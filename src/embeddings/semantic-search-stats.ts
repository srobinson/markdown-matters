/**
 * Embedding index statistics reporting.
 *
 * Split out of semantic-search.ts for the 700 LOC refactor. Reads the
 * active namespace and returns counts, costs, and provider metadata for
 * the loaded vector store. Uses the shared HNSW cache so subsequent
 * search calls don't re-load the same store.
 */

import { Effect } from 'effect'
import type { GenerationReadSession } from '../db/generation-reader.js'
import type {
  DimensionMismatchError,
  VectorStoreError,
} from '../errors/index.js'
import {
  type ActiveProvider,
  type EmbeddingNamespaceError,
  generateNamespace,
  getActiveNamespace,
} from './embedding-namespace.js'
import {
  getHnswCacheEntry,
  hnswCacheKey,
  setHnswCacheEntry,
} from './hnsw-cache.js'
import {
  createNamespacedVectorStore,
  type VectorStoreLoadResult,
} from './vector-store.js'

export interface EmbeddingStats {
  readonly hasEmbeddings: boolean
  readonly count: number
  readonly provider: string
  readonly model?: string | undefined
  readonly dimensions: number
  readonly totalCost: number
  readonly totalTokens: number
}

const emptyStats: EmbeddingStats = {
  hasEmbeddings: false,
  count: 0,
  provider: 'none',
  dimensions: 0,
  totalCost: 0,
  totalTokens: 0,
}

/**
 * Get statistics about stored embeddings.
 * Uses the active namespace to find the current embedding index.
 *
 * @param indexRoot - Root directory containing embeddings
 * @returns Embedding statistics (count, provider, costs)
 *
 * @throws VectorStoreError - Cannot load vector index metadata
 */
export const getEmbeddingStats = (
  session: GenerationReadSession,
): Effect.Effect<
  EmbeddingStats,
  VectorStoreError | EmbeddingNamespaceError | DimensionMismatchError
> =>
  Effect.gen(function* () {
    // Get the active namespace to find where embeddings are stored
    const activeProvider: ActiveProvider | null = yield* getActiveNamespace(
      session.indexRoot,
    )

    if (!activeProvider) {
      return emptyStats
    }

    // Load the namespaced vector store from cache or disk
    const namespace = generateNamespace(
      activeProvider.provider,
      activeProvider.model,
      activeProvider.dimensions,
    )
    const cacheKey = hnswCacheKey(session.home, namespace, session.generation)
    let vectorStore = getHnswCacheEntry(cacheKey)

    if (!vectorStore) {
      const freshStore = createNamespacedVectorStore(
        session.indexRoot,
        activeProvider.provider,
        activeProvider.model,
        activeProvider.dimensions,
      )

      const loadResult: VectorStoreLoadResult = yield* freshStore.load()

      if (!loadResult.loaded) {
        return emptyStats
      }

      setHnswCacheEntry(cacheKey, freshStore)
      vectorStore = freshStore
    }

    const stats = vectorStore.getStats()

    return {
      hasEmbeddings: true,
      count: stats.count,
      provider: stats.provider || 'openai',
      model: stats.providerModel,
      dimensions: stats.dimensions,
      totalCost: stats.totalCost || 0,
      totalTokens: stats.totalTokens || 0,
    }
  })
