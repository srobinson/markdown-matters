import { Effect } from 'effect'
import type { VectorStoreError } from '../errors/index.js'
import {
  type ActiveProvider,
  type EmbeddingNamespaceError,
  writeActiveProvider,
} from './embedding-namespace.js'
import { invalidateHnswCache } from './hnsw-cache.js'
import type { VectorStore } from './vector-store.js'

export interface EmbeddingPersistenceInput {
  readonly indexRoot: string
  readonly vectorStore: VectorStore
  readonly namespace: string
  readonly activeProvider?: ActiveProvider | undefined
}

export interface EmbeddingPersistenceRuntime {
  readonly providerName: string
  readonly providerModel: string
  readonly dimensions: number
  readonly vectorStore: VectorStore
  readonly namespace: string
}

export const persistEmbeddingBuild = (
  input: EmbeddingPersistenceInput,
): Effect.Effect<void, VectorStoreError | EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    yield* input.vectorStore.save()
    invalidateHnswCache(input.indexRoot, input.namespace)
    if (input.activeProvider) {
      yield* writeActiveProvider(input.indexRoot, input.activeProvider)
    }
  })

export const persistEmbeddingRuntime = (
  indexRoot: string,
  runtime: EmbeddingPersistenceRuntime,
  activateProvider: boolean,
) =>
  persistEmbeddingBuild({
    indexRoot,
    vectorStore: runtime.vectorStore,
    namespace: runtime.namespace,
    ...(activateProvider
      ? {
          activeProvider: {
            namespace: runtime.namespace,
            provider: runtime.providerName,
            model: runtime.providerModel,
            dimensions: runtime.dimensions,
            activatedAt: new Date().toISOString(),
          },
        }
      : {}),
  })
