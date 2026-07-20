import * as fs from 'node:fs/promises'
import { Effect } from 'effect'
import { VectorStoreError } from '../errors/index.js'
import {
  type ActiveProvider,
  EmbeddingNamespaceError,
  writeActiveProvider,
} from './embedding-namespace.js'
import {
  getActiveProviderPath,
  getEmbeddingsDir,
} from './embedding-namespace-paths.js'
import { evictHnswIndexRoot, invalidateHnswCache } from './hnsw-cache.js'
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

export const clearSemanticGeneration = (
  indexRoot: string,
): Effect.Effect<void, VectorStoreError | EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    const embeddingsDir = getEmbeddingsDir(indexRoot)
    yield* Effect.tryPromise({
      try: () => fs.rm(embeddingsDir, { recursive: true, force: true }),
      catch: (cause) =>
        new VectorStoreError({
          operation: 'save',
          message: `Failed to clear semantic vectors: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
    })
    evictHnswIndexRoot(indexRoot)

    const activeProviderPath = getActiveProviderPath(indexRoot)
    yield* Effect.tryPromise({
      try: () => fs.rm(activeProviderPath, { force: true }),
      catch: (cause) =>
        new EmbeddingNamespaceError({
          operation: 'clearSemanticGeneration',
          message: `Failed to clear active provider: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
    })
  })
