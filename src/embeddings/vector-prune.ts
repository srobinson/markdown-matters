import { Effect } from 'effect'
import type { DocumentIndex, SectionIndex } from '../index/types.js'
import { listNamespaces } from './embedding-namespace.js'
import { invalidateHnswCache } from './hnsw-cache.js'
import {
  createNamespacedVectorStore,
  type VectorStore,
} from './vector-store.js'

export const sectionDocumentHashes = (
  sections: SectionIndex,
  documents: DocumentIndex,
  includedSectionIds?: ReadonlySet<string>,
): ReadonlyMap<string, string> =>
  new Map(
    Object.values(sections.sections).flatMap((section) => {
      if (includedSectionIds && !includedSectionIds.has(section.id)) return []
      const hash = documents.documents[section.documentPath]?.hash
      return hash === undefined ? [] : [[section.id, hash] as const]
    }),
  )

export const reusableVectorIds = (
  vectorStore: VectorStore,
  currentSectionHashes: ReadonlyMap<string, string>,
): Set<string> => {
  const embeddedHashes = vectorStore.getEmbeddedDocumentHashes()
  return new Set(
    [...vectorStore.getEmbeddedIds()].filter(
      (id) => currentSectionHashes.get(id) === embeddedHashes.get(id),
    ),
  )
}

export const pruneStaleVectorEntries = (
  vectorStore: VectorStore,
  reusableIds: ReadonlySet<string>,
) => {
  const staleIds = [...vectorStore.getEmbeddedIds()].filter(
    (id) => !reusableIds.has(id),
  )
  return staleIds.length === 0
    ? Effect.succeed(0)
    : vectorStore.removeEntries(staleIds).pipe(Effect.as(staleIds.length))
}

export const pruneVectorNamespaces = (
  indexRoot: string,
  currentSectionHashes: ReadonlyMap<string, string>,
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
          const reusableIds = reusableVectorIds(store, currentSectionHashes)
          const removed = yield* pruneStaleVectorEntries(store, reusableIds)
          if (removed === 0) return 0
          yield* store.save()
          invalidateHnswCache(indexRoot, namespace.namespace)
          return removed
        }),
      ),
      { concurrency: 4 },
    )
  })
