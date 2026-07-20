import { Effect } from 'effect'

import { listNamespaces } from './embedding-namespace.js'
import { invalidateHnswCache } from './hnsw-cache.js'
import {
  createNamespacedVectorStore,
  type VectorStore,
} from './vector-store.js'

export const pruneStaleVectorEntries = (
  vectorStore: VectorStore,
  currentSectionIds: ReadonlySet<string>,
) => {
  const staleIds = [...vectorStore.getEmbeddedIds()].filter(
    (id) => !currentSectionIds.has(id),
  )
  return staleIds.length === 0
    ? Effect.succeed(0)
    : vectorStore.removeEntries(staleIds).pipe(Effect.as(staleIds.length))
}

export const pruneVectorNamespaces = (
  indexRoot: string,
  currentSectionIds: ReadonlySet<string>,
) =>
  Effect.gen(function* () {
    const namespaces = yield* listNamespaces(indexRoot)
    return yield* Effect.all(
      namespaces.map((namespace) =>
        Effect.gen(function* () {
          const store = createNamespacedVectorStore(
            indexRoot,
            namespace.provider,
            namespace.model,
            namespace.dimensions,
          )
          const loaded = yield* store.load()
          if (!loaded.loaded) return 0
          const removed = yield* pruneStaleVectorEntries(
            store,
            currentSectionIds,
          )
          if (removed === 0) return 0
          yield* store.save()
          invalidateHnswCache(indexRoot, namespace.namespace)
          return removed
        }),
      ),
      { concurrency: 4 },
    )
  })
