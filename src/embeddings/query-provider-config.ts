import { Effect, Option } from 'effect'

import type { EmbeddingsConfig } from '../config/schema.js'
import type { GenerationReadSession } from '../db/generation-types.js'
import { DEFAULT_PROVIDER_IDS, type ProviderId } from '../providers/index.js'
import { getMetaPath, readActiveProvider } from './embedding-namespace.js'
import {
  type ActiveProvider,
  EmbeddingNamespaceError,
} from './embedding-namespace-types.js'
import type { EmbeddingProviderConfig } from './types.js'
import { loadVectorIndex } from './vector-store-codec.js'

export interface ResolvedQueryProviderConfig {
  readonly providerConfig: EmbeddingProviderConfig
  readonly activeProvider: ActiveProvider
  readonly vectorCount: number
}

export const parseEmbeddingProviderId = (
  provider: string,
  operation: string,
): Effect.Effect<ProviderId, EmbeddingNamespaceError> => {
  const supported = DEFAULT_PROVIDER_IDS.find(
    (candidate) => candidate === provider,
  )
  return supported === undefined
    ? Effect.fail(
        new EmbeddingNamespaceError({
          operation,
          message: `Unsupported active embedding provider: ${provider}`,
        }),
      )
    : Effect.succeed(supported)
}

export const resolveQueryProviderConfig = (
  session: GenerationReadSession,
  config: EmbeddingsConfig,
  providerOverride?: ProviderId,
) =>
  Effect.gen(function* () {
    const active = yield* readActiveProvider(session.indexRoot)
    if (active === null) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'resolveQueryProviderConfig',
          message: 'No active embedding provider signature is published',
        }),
      )
    }

    const activeProvider = yield* parseEmbeddingProviderId(
      active.provider,
      'resolveQueryProviderConfig',
    )
    if (providerOverride !== undefined && providerOverride !== activeProvider) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'resolveQueryProviderConfig',
          message: `Query provider ${providerOverride} does not match the active index provider ${activeProvider}. Rebuild the index with ${providerOverride} before searching with that provider.`,
        }),
      )
    }
    const metadata = yield* loadVectorIndex(
      getMetaPath(session.indexRoot, active.namespace),
    )
    return {
      providerConfig: {
        provider: activeProvider,
        baseURL:
          Option.getOrUndefined(config.baseURL) ?? metadata.providerBaseURL,
        model: metadata.providerModel ?? active.model,
        dimensions: metadata.dimensions,
      },
      activeProvider: active,
      vectorCount: Object.keys(metadata.entries).length,
    } satisfies ResolvedQueryProviderConfig
  })
