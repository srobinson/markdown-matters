import { Effect, Option } from 'effect'

import type { EmbeddingsConfig } from '../config/schema.js'
import type { GenerationReadSession } from '../db/generation-types.js'
import { DEFAULT_PROVIDER_IDS, type ProviderId } from '../providers/index.js'
import { getMetaPath, readActiveProvider } from './embedding-namespace.js'
import { EmbeddingNamespaceError } from './embedding-namespace-types.js'
import type { EmbeddingProviderConfig } from './types.js'
import { loadVectorIndex } from './vector-store-codec.js'

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
      return {
        provider: providerOverride ?? config.provider,
        baseURL: Option.getOrUndefined(config.baseURL),
        model: config.model,
        dimensions: config.dimensions,
      } satisfies EmbeddingProviderConfig
    }

    const activeProvider = yield* parseEmbeddingProviderId(
      active.provider,
      'resolveQueryProviderConfig',
    )
    const metadata = yield* loadVectorIndex(
      getMetaPath(session.indexRoot, active.namespace),
    )
    return {
      provider: providerOverride ?? activeProvider,
      baseURL:
        Option.getOrUndefined(config.baseURL) ?? metadata.providerBaseURL,
      model: metadata.providerModel ?? active.model,
      dimensions: metadata.dimensions,
    } satisfies EmbeddingProviderConfig
  })
