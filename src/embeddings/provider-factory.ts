/**
 * Embedding Provider Factory
 *
 * Creates embedding providers based on configuration. Supports multiple
 * providers (OpenAI, Ollama, LM Studio, OpenRouter) with automatic
 * baseURL mapping for OpenAI-compatible APIs.
 */

import { Effect, Option, Redacted } from 'effect'
import { ConfigService, type EmbeddingProvider } from '../config/index.js'
import type { EmbeddingsConfig } from '../config/schema.js'
import type { ApiKeyMissingError } from '../errors/index.js'
import { createOpenAIProvider } from './openai-provider.js'
import { PROVIDER_BASE_URLS } from './provider-constants.js'
import type { EmbeddingProvider as EmbeddingProviderInterface } from './types.js'
import { createVoyageProvider } from './voyage-provider.js'

// Re-export provider constants for backward compatibility
export { PROVIDER_BASE_URLS } from './provider-constants.js'

/**
 * Get the base URL for a provider, respecting config override.
 *
 * Precedence:
 * 1. Explicit baseURL from config (highest priority)
 * 2. Provider-specific default from PROVIDER_BASE_URLS
 * 3. OpenAI SDK default (undefined means use SDK default)
 */
export const getProviderBaseURL = (
  provider: EmbeddingProvider,
  configBaseURL: Option.Option<string>,
): string | undefined => {
  // Config baseURL takes precedence
  if (Option.isSome(configBaseURL)) {
    return configBaseURL.value
  }
  // Fall back to provider default
  return PROVIDER_BASE_URLS[provider]
}

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * Configuration subset needed for provider creation.
 * Extracted from EmbeddingsConfig to allow direct config passing.
 */
export interface ProviderFactoryConfig {
  readonly provider: EmbeddingProvider
  readonly baseURL?: Option.Option<string> | string | undefined
  readonly model?: string | undefined
  readonly dimensions?: number | undefined
  readonly batchSize?: number | undefined
  readonly maxRetries?: number | undefined
  readonly retryDelayMs?: number | undefined
  /**
   * API key for the provider. Accepts multiple formats:
   * - Plain string: 'sk-...'
   * - Redacted<string>: Redacted.make('sk-...') (recommended for security)
   * - Option<string>: Option.some('sk-...')
   */
  readonly apiKey?:
    | Option.Option<string>
    | string
    | Redacted.Redacted<string>
    | undefined
  /**
   * Request timeout in milliseconds.
   * Default: 30000 (30 seconds)
   */
  readonly timeout?: number | undefined
}

/**
 * Normalize baseURL from various input formats to Option<string>.
 */
const normalizeBaseURL = (
  baseURL: Option.Option<string> | string | undefined,
): Option.Option<string> => {
  if (baseURL === undefined) {
    return Option.none()
  }
  if (typeof baseURL === 'string') {
    return Option.some(baseURL)
  }
  return baseURL
}

/**
 * Normalize apiKey from various input formats to string | Redacted<string> | undefined.
 * Preserves Redacted wrapper for security - don't unwrap until needed.
 */
const normalizeApiKey = (
  apiKey:
    | Option.Option<string>
    | string
    | Redacted.Redacted<string>
    | undefined,
): string | Redacted.Redacted<string> | undefined => {
  if (apiKey === undefined) {
    return undefined
  }
  // Check for Redacted first (keep wrapped for security)
  if (Redacted.isRedacted(apiKey)) {
    return apiKey
  }
  if (typeof apiKey === 'string') {
    return apiKey
  }
  // Handle Option<string>
  return Option.isSome(apiKey) ? apiKey.value : undefined
}

/**
 * Create an embedding provider based on configuration.
 *
 * All supported providers (OpenAI, Ollama, LM Studio, OpenRouter) use
 * OpenAI-compatible APIs, so we use the OpenAI provider with different
 * base URLs.
 *
 * @param config - Optional explicit config (if not provided, reads from ConfigService)
 * @returns Effect yielding the configured EmbeddingProvider
 *
 * @example
 * ```typescript
 * // Using ConfigService (reads from environment/config file)
 * const provider = yield* createEmbeddingProvider()
 *
 * // Explicit config override
 * const provider = yield* createEmbeddingProvider({
 *   provider: 'ollama',
 *   model: 'nomic-embed-text',
 * })
 * ```
 */
export const createEmbeddingProvider = (
  config?: ProviderFactoryConfig,
): Effect.Effect<
  EmbeddingProviderInterface,
  ApiKeyMissingError,
  ConfigService
> =>
  Effect.gen(function* () {
    // Get embeddings config from service if not provided
    const embeddingsConfig: EmbeddingsConfig = config
      ? ({
          provider: config.provider,
          baseURL: normalizeBaseURL(config.baseURL),
          model: config.model ?? 'text-embedding-3-small',
          dimensions: config.dimensions, // Let provider determine default if not specified
          batchSize: config.batchSize ?? 100,
          maxRetries: config.maxRetries ?? 3,
          retryDelayMs: config.retryDelayMs ?? 1000,
          timeoutMs: 30000,
          apiKey: Option.fromNullable(normalizeApiKey(config.apiKey)),
        } as EmbeddingsConfig)
      : (yield* ConfigService).embeddings

    const provider = embeddingsConfig.provider
    const baseURL = getProviderBaseURL(provider, embeddingsConfig.baseURL)

    // Extract API key from config if available
    const apiKey = Option.isSome(embeddingsConfig.apiKey)
      ? embeddingsConfig.apiKey.value
      : undefined

    // Voyage AI uses its own native API, not OpenAI-compatible
    if (provider === 'voyage') {
      return yield* createVoyageProvider({
        model: embeddingsConfig.model,
        batchSize: embeddingsConfig.batchSize,
        maxRetries: embeddingsConfig.maxRetries,
        retryDelayMs: embeddingsConfig.retryDelayMs,
        apiKey,
        timeout: embeddingsConfig.timeoutMs,
      })
    }

    // All other providers use OpenAI-compatible API
    return yield* createOpenAIProvider({
      model: embeddingsConfig.model,
      dimensions: embeddingsConfig.dimensions,
      batchSize: embeddingsConfig.batchSize,
      maxRetries: embeddingsConfig.maxRetries,
      retryDelayMs: embeddingsConfig.retryDelayMs,
      baseURL,
      apiKey,
      timeout: embeddingsConfig.timeoutMs,
    })
  })

/**
 * Create an embedding provider without ConfigService dependency.
 *
 * Use this when you need to create a provider outside of the Effect
 * context or when you have explicit config values.
 *
 * @param config - Explicit provider configuration
 * @returns Effect yielding the configured EmbeddingProvider
 */
export const createEmbeddingProviderDirect = (
  config: ProviderFactoryConfig,
): Effect.Effect<EmbeddingProviderInterface, ApiKeyMissingError> =>
  Effect.gen(function* () {
    const provider = config.provider
    const baseURL = getProviderBaseURL(
      provider,
      normalizeBaseURL(config.baseURL),
    )

    // Voyage AI uses its own native API, not OpenAI-compatible
    if (provider === 'voyage') {
      return yield* createVoyageProvider({
        model: config.model,
        batchSize: config.batchSize,
        maxRetries: config.maxRetries,
        retryDelayMs: config.retryDelayMs,
        apiKey: normalizeApiKey(config.apiKey),
        timeout: config.timeout,
      })
    }

    // All other providers use OpenAI-compatible API
    return yield* createOpenAIProvider({
      model: config.model,
      dimensions: config.dimensions,
      batchSize: config.batchSize,
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelayMs,
      baseURL,
      apiKey: normalizeApiKey(config.apiKey),
      timeout: config.timeout,
    })
  })
