/**
 * Module-level HNSW vector store cache, shared between the build and
 * search paths. Keyed by `${resolvedRoot}::${namespace}` so multiple
 * roots and provider/model/dimensions tuples can coexist.
 *
 * Per-process only, not persisted. Invalidated per-key after
 * `buildEmbeddings` writes new vectors for that namespace, and via
 * `clearHnswCache` from tests.
 */

import * as path from 'node:path'
import { Effect } from 'effect'
import type { HnswMismatchWarning, VectorStore } from './vector-store.js'

const hnswCache = new Map<string, VectorStore>()

export const hnswCacheKey = (indexRoot: string, namespace: string): string =>
  `${path.resolve(indexRoot)}::${namespace}`

export const getHnswCacheEntry = (key: string): VectorStore | undefined =>
  hnswCache.get(key)

export const setHnswCacheEntry = (key: string, store: VectorStore): void => {
  hnswCache.set(key, store)
}

/**
 * Invalidate the HNSW cache entry for a given root and namespace.
 * Called after buildEmbeddings writes new vectors to disk.
 */
export const invalidateHnswCache = (
  indexRoot: string,
  namespace: string,
): void => {
  hnswCache.delete(hnswCacheKey(indexRoot, namespace))
}

export const evictHnswIndexRoot = (indexRoot: string): void => {
  const prefix = `${path.resolve(indexRoot)}::`
  for (const key of hnswCache.keys()) {
    if (key.startsWith(prefix)) hnswCache.delete(key)
  }
}

/**
 * Clear the entire HNSW cache. Useful for testing.
 */
export const clearHnswCache = (): void => {
  hnswCache.clear()
}

/**
 * Log a warning when the stored HNSW index params disagree with config.
 * HNSW params only affect construction, so this is non-fatal: we tell
 * the user to rebuild if they care about the config values.
 */
export const checkHnswMismatch = (
  mismatch: HnswMismatchWarning | undefined,
): Effect.Effect<void, never, never> => {
  if (!mismatch) {
    return Effect.void
  }

  const { configParams, indexParams } = mismatch
  return Effect.logWarning(
    `HNSW parameter mismatch: Index was built with M=${indexParams.m}, efConstruction=${indexParams.efConstruction}, ` +
      `but config specifies M=${configParams.m}, efConstruction=${configParams.efConstruction}. ` +
      `HNSW parameters only affect index construction. Run 'mdm index --embed --force' to rebuild with new parameters.`,
  )
}
