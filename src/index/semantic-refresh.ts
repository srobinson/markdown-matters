import { Effect } from 'effect'

import {
  getMetaPath,
  readActiveProvider,
} from '../embeddings/embedding-namespace.js'
import { parseEmbeddingProviderId } from '../embeddings/query-provider-config.js'
import {
  type BuildEmbeddingsOptions,
  type BuildEmbeddingsResult,
  buildEmbeddings,
} from '../embeddings/semantic-search.js'
import { loadVectorIndex } from '../embeddings/vector-store-codec.js'
import type { EmbeddingClient } from '../providers/index.js'

type SemanticBuildOptions = Omit<BuildEmbeddingsOptions, 'indexRoot'>

interface ActiveSemanticOptions {
  readonly mode: 'active'
  readonly client?: EmbeddingClient | undefined
  readonly onFileProgress?: BuildEmbeddingsOptions['onFileProgress']
  readonly onBatchProgress?: BuildEmbeddingsOptions['onBatchProgress']
}

export type SemanticRefreshOptions =
  | ActiveSemanticOptions
  | { readonly mode: 'build'; readonly options: SemanticBuildOptions }
  | { readonly mode: 'skip' }

export type SemanticRefreshError = Effect.Effect.Error<
  ReturnType<typeof buildEmbeddings>
>

const refreshActiveSemanticGeneration = (
  sourceRoot: string,
  indexRoot: string,
  options: ActiveSemanticOptions,
) =>
  Effect.gen(function* () {
    const active = yield* readActiveProvider(indexRoot)
    if (active === null) return null

    const provider = yield* parseEmbeddingProviderId(
      active.provider,
      'refreshSemanticGeneration',
    )
    const metadata = yield* loadVectorIndex(
      getMetaPath(indexRoot, active.namespace),
    )
    return yield* buildEmbeddings(sourceRoot, {
      indexRoot,
      client: options.client,
      providerConfig: {
        provider,
        model: active.model,
        dimensions: active.dimensions,
        baseURL: metadata.providerBaseURL,
      },
      hnswOptions: metadata.hnswParams,
      onFileProgress: options.onFileProgress,
      onBatchProgress: options.onBatchProgress,
    })
  })

export const refreshSemanticGeneration = (
  sourceRoot: string,
  indexRoot: string,
  options: SemanticRefreshOptions = { mode: 'active' },
): Effect.Effect<BuildEmbeddingsResult | null, SemanticRefreshError> => {
  if (options.mode === 'skip') return Effect.succeed(null)
  if (options.mode === 'build') {
    return buildEmbeddings(sourceRoot, {
      ...options.options,
      indexRoot,
    })
  }
  return refreshActiveSemanticGeneration(sourceRoot, indexRoot, options)
}
