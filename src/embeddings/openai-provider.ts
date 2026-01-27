/**
 * OpenAI embedding provider
 */

import { Effect, Redacted } from 'effect'
import OpenAI from 'openai'
import {
  ApiKeyInvalidError,
  ApiKeyMissingError,
  EmbeddingError,
} from '../errors/index.js'
import pricingData from './pricing.json' with { type: 'json' }
import {
  getRecommendedDimensions,
  inferProviderFromUrl,
  supportsMatryoshka,
  validateModelDimensions,
} from './provider-constants.js'
import type {
  EmbeddingProvider,
  EmbeddingResult,
  EmbedOptions,
} from './types.js'

// ============================================================================
// Cost Constants
// ============================================================================

/**
 * OpenAI embedding model pricing data.
 *
 * Prices per 1M tokens. Loaded from pricing.json for easy updates.
 *
 * Maintenance: Update src/embeddings/pricing.json quarterly from
 * https://platform.openai.com/docs/pricing
 */
export const PRICING_DATA = {
  /** Last update date in YYYY-MM format */
  lastUpdated: pricingData.lastUpdated,
  /** Source URL for verification */
  source: pricingData.sources.openai,
  /** Prices per 1M tokens by model */
  prices: pricingData.openai as Record<string, number>,
}

/**
 * Check if pricing data is stale (>90 days old).
 *
 * @returns Warning message if stale, null otherwise
 */
export const checkPricingFreshness = (): string | null => {
  const [year, month] = PRICING_DATA.lastUpdated.split('-').map(Number)
  if (!year || !month) return null

  const lastUpdated = new Date(year, month - 1, 1) // Month is 0-indexed
  const now = new Date()
  const daysSince = Math.floor(
    (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24),
  )

  if (daysSince > 90) {
    return `Pricing data is ${daysSince} days old. May not reflect current rates.`
  }
  return null
}

/**
 * Get the pricing date for display.
 *
 * @returns Formatted string like "2024-09"
 */
export const getPricingDate = (): string => PRICING_DATA.lastUpdated

// ============================================================================
// OpenAI Provider
// ============================================================================

export interface OpenAIProviderOptions {
  /**
   * API key for the provider. Can be a plain string or a Redacted<string>.
   * If not provided, falls back to environment variables:
   * - OPENROUTER_API_KEY (if using OpenRouter)
   * - OPENAI_API_KEY (default)
   */
  readonly apiKey?: string | Redacted.Redacted<string> | undefined
  readonly model?: string | undefined
  readonly batchSize?: number | undefined
  readonly baseURL?: string | undefined
  /**
   * Number of embedding dimensions. If not specified, uses recommended
   * dimensions for the model (512 for Matryoshka models, native for others).
   */
  readonly dimensions?: number | undefined
  /**
   * Provider name for error context (e.g., 'ollama', 'lm-studio')
   * Defaults to 'openai' if baseURL is not set
   */
  readonly providerName?: string | undefined
  /**
   * Request timeout in milliseconds.
   * Default: 30000 (30 seconds)
   */
  readonly timeout?: number | undefined
}

export class OpenAIProvider implements EmbeddingProvider {
  readonly name: string
  readonly dimensions: number
  /** Provider name for error context */
  readonly providerName: string
  /** Model name */
  readonly model: string
  /** Base URL for API requests */
  readonly baseURL: string | undefined

  private readonly client: OpenAI
  private readonly batchSize: number

  private constructor(
    apiKey: Redacted.Redacted<string>,
    options: OpenAIProviderOptions = {},
  ) {
    this.baseURL = options.baseURL
    this.client = new OpenAI({
      apiKey: Redacted.value(apiKey),
      baseURL: options.baseURL,
      timeout: options.timeout ?? 30000,
      maxRetries: 2,
    })
    this.model = options.model ?? 'text-embedding-3-small'
    this.batchSize = options.batchSize ?? 100
    this.providerName =
      options.providerName ?? this.inferProviderName(options.baseURL)
    this.name = `${this.providerName}:${this.model}`

    const recommendedDims = getRecommendedDimensions(this.model)
    this.dimensions = options.dimensions ?? recommendedDims ?? 512
  }

  /**
   * Infer the provider name from the baseURL.
   * Delegates to centralized inferProviderFromUrl for single source of truth.
   */
  private inferProviderName(baseURL: string | undefined): string {
    return inferProviderFromUrl(baseURL)
  }

  /**
   * Create an OpenAI provider instance.
   * Returns an Effect that fails with ApiKeyMissingError if no API key is available.
   *
   * API keys are handled securely using Effect's Redacted type to prevent
   * accidental logging of sensitive values.
   */
  static create(
    options: OpenAIProviderOptions = {},
  ): Effect.Effect<OpenAIProvider, ApiKeyMissingError> {
    // For OpenRouter provider, check OPENROUTER_API_KEY first, then fall back to OPENAI_API_KEY
    const isOpenRouter =
      options.baseURL?.includes('openrouter') ||
      options.providerName === 'openrouter'

    // Normalize API key to Redacted<string>
    // If apiKey is already Redacted, use it; if string, wrap it; if undefined, check env vars
    const resolveApiKey = ():
      | Redacted.Redacted<string>
      | string
      | undefined => {
      if (options.apiKey !== undefined) {
        return options.apiKey
      }
      return (
        (isOpenRouter ? process.env.OPENROUTER_API_KEY : undefined) ??
        process.env.OPENAI_API_KEY
      )
    }

    const rawApiKey = resolveApiKey()
    if (!rawApiKey) {
      return Effect.fail(
        new ApiKeyMissingError({
          provider: isOpenRouter ? 'OpenRouter' : 'OpenAI',
          envVar: isOpenRouter ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY',
        }),
      )
    }

    // Wrap in Redacted if it's a plain string
    const redactedApiKey = Redacted.isRedacted(rawApiKey)
      ? rawApiKey
      : Redacted.make(rawApiKey)

    // Check key format for warnings (need to access value temporarily)
    const apiKeyValue = Redacted.value(redactedApiKey)
    const shouldWarnOpenRouter =
      isOpenRouter &&
      apiKeyValue.startsWith('sk-') &&
      !apiKeyValue.startsWith('sk-or-')

    // Validate dimensions if explicitly set
    const model = options.model ?? 'text-embedding-3-small'
    const dimensionValidation = options.dimensions
      ? validateModelDimensions(model, options.dimensions)
      : { isValid: true }

    return Effect.succeed(new OpenAIProvider(redactedApiKey, options)).pipe(
      shouldWarnOpenRouter
        ? Effect.tap(() =>
            Effect.logWarning(
              '⚠️  Using OpenAI key format with OpenRouter. Consider setting OPENROUTER_API_KEY with a key starting with "sk-or-"',
            ),
          )
        : (self) => self,
      // Warn about invalid dimension configuration
      dimensionValidation.warning
        ? Effect.tap(() =>
            Effect.logWarning(`⚠️  ${dimensionValidation.warning}`),
          )
        : (self) => self,
    )
  }

  async embed(
    texts: string[],
    options?: EmbedOptions,
  ): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return { embeddings: [], tokensUsed: 0, cost: 0 }
    }

    const allEmbeddings: number[][] = []
    let totalTokens = 0
    const totalBatches = Math.ceil(texts.length / this.batchSize)

    try {
      // Process in batches
      for (let i = 0; i < texts.length; i += this.batchSize) {
        const batch = texts.slice(i, i + this.batchSize)
        const batchIndex = Math.floor(i / this.batchSize)

        // Only pass dimensions parameter for models that support it (Matryoshka)
        // Non-Matryoshka models will use their native dimensions automatically
        const embedParams: OpenAI.Embeddings.EmbeddingCreateParams = {
          model: this.model,
          input: batch,
        }

        // Only add dimensions parameter for Matryoshka-compatible models
        if (supportsMatryoshka(this.model)) {
          embedParams.dimensions = this.dimensions
        }

        const response = await this.client.embeddings.create(embedParams)

        for (const item of response.data) {
          allEmbeddings.push(item.embedding)
        }

        totalTokens += response.usage?.total_tokens ?? 0

        // Report batch progress
        if (options?.onBatchProgress) {
          options.onBatchProgress({
            batchIndex: batchIndex + 1,
            totalBatches,
            processedTexts: Math.min(i + this.batchSize, texts.length),
            totalTexts: texts.length,
          })
        }
      }
    } catch (error) {
      // Check for authentication errors (401 Unauthorized, invalid API key)
      if (error instanceof OpenAI.AuthenticationError) {
        throw new ApiKeyInvalidError({
          provider: this.providerName,
          details: error.message,
        })
      }
      // Wrap error with provider context for better error messages
      throw new EmbeddingError({
        reason: this.classifyError(error),
        message: error instanceof Error ? error.message : String(error),
        provider: this.providerName,
        cause: error,
      })
    }

    // Calculate cost (only for paid providers)
    const pricePerMillion =
      this.providerName === 'openai' || this.providerName === 'openrouter'
        ? (PRICING_DATA.prices[this.model] ?? 0.02)
        : 0 // Local providers are free
    const cost = (totalTokens / 1_000_000) * pricePerMillion

    return {
      embeddings: allEmbeddings,
      tokensUsed: totalTokens,
      cost,
    }
  }

  /**
   * Classify an error into a known category for better error handling.
   * Uses OpenAI SDK error types where available, falls back to string matching
   * for non-OpenAI providers (Ollama, LM Studio, OpenRouter).
   */
  private classifyError(
    error: unknown,
  ): 'RateLimit' | 'QuotaExceeded' | 'Network' | 'ModelError' | 'Unknown' {
    // Use OpenAI SDK error types when available
    if (error instanceof OpenAI.RateLimitError) {
      return 'RateLimit'
    }
    if (error instanceof OpenAI.BadRequestError) {
      const msg = error.message.toLowerCase()
      if (msg.includes('model')) return 'ModelError'
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return 'Network'
    }

    // Fallback to string matching for non-SDK errors (local providers, etc.)
    if (!(error instanceof Error)) return 'Unknown'
    const msg = error.message.toLowerCase()

    // Rate limiting
    if (
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests')
    ) {
      return 'RateLimit'
    }

    // Quota/billing issues
    if (
      msg.includes('quota') ||
      msg.includes('insufficient') ||
      msg.includes('billing')
    ) {
      return 'QuotaExceeded'
    }

    // Network issues
    if (
      msg.includes('econnrefused') ||
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('enotfound') ||
      msg.includes('connection')
    ) {
      return 'Network'
    }

    // Model issues
    if (
      msg.includes('model') &&
      (msg.includes('not found') ||
        msg.includes('not exist') ||
        msg.includes('invalid'))
    ) {
      return 'ModelError'
    }

    return 'Unknown'
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an OpenAI embedding provider.
 * Returns an Effect that fails with ApiKeyMissingError if no API key is available.
 *
 * Usage:
 * ```typescript
 * const provider = yield* createOpenAIProvider()
 * const result = yield* Effect.tryPromise(() => provider.embed(texts))
 * ```
 */
export const createOpenAIProvider = (
  options?: OpenAIProviderOptions,
): Effect.Effect<EmbeddingProvider, ApiKeyMissingError> =>
  OpenAIProvider.create(options)

/**
 * Wrap an embedding operation to catch InvalidApiKeyError thrown during embed().
 * Use this when calling provider.embed() to convert thrown errors to Effect failures.
 *
 * Usage:
 * ```typescript
 * const result = yield* wrapEmbedding(provider.embed(texts))
 * ```
 */
export const wrapEmbedding = (
  embedPromise: Promise<EmbeddingResult>,
  providerName = 'openai',
): Effect.Effect<EmbeddingResult, ApiKeyInvalidError | EmbeddingError> =>
  Effect.tryPromise({
    try: () => embedPromise,
    catch: (e) => {
      if (e instanceof ApiKeyInvalidError) {
        return e
      }
      return new EmbeddingError({
        reason: 'Unknown',
        message: e instanceof Error ? e.message : String(e),
        provider: providerName,
        cause: e,
      })
    },
  })
