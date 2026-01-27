/**
 * Voyage AI Embedding Provider
 *
 * Voyage AI offers high-quality embeddings with competitive pricing:
 * - voyage-3.5-lite: Same price as OpenAI ($0.02/1M), better quality
 * - voyage-3: Higher quality option ($0.06/1M)
 * - 32K token context (4x OpenAI)
 * - Top-tier retrieval performance in benchmarks
 *
 * API docs: https://docs.voyageai.com/reference/embeddings-api
 */

import { Effect, Redacted } from 'effect'
import {
  ApiKeyInvalidError,
  ApiKeyMissingError,
  EmbeddingError,
} from '../errors/index.js'
import pricingData from './pricing.json' with { type: 'json' }
import type {
  EmbeddingProvider,
  EmbeddingProviderWithMetadata,
  EmbeddingResult,
  EmbedOptions,
} from './types.js'

// ============================================================================
// Types
// ============================================================================

interface VoyageEmbeddingResponse {
  object: 'list'
  data: Array<{
    object: 'embedding'
    embedding: number[]
    index: number
  }>
  model: string
  usage: {
    total_tokens: number
  }
}

// ============================================================================
// Constants
// ============================================================================

const VOYAGE_API_BASE = 'https://api.voyageai.com/v1'

/**
 * Voyage AI model specifications.
 * Pricing loaded from pricing.json for easy updates.
 */
const voyagePricing = pricingData.voyage as Record<string, number>
export const VOYAGE_MODELS: Record<
  string,
  { dimensions: number; pricePerMillion: number }
> = {
  'voyage-3.5-lite': {
    dimensions: 1024,
    pricePerMillion: voyagePricing['voyage-3.5-lite'] ?? 0.02,
  },
  'voyage-3': {
    dimensions: 1024,
    pricePerMillion: voyagePricing['voyage-3'] ?? 0.06,
  },
  'voyage-code-3': {
    dimensions: 1024,
    pricePerMillion: voyagePricing['voyage-code-3'] ?? 0.18,
  },
  // Legacy models
  'voyage-2': {
    dimensions: 1024,
    pricePerMillion: voyagePricing['voyage-2'] ?? 0.1,
  },
  'voyage-large-2': {
    dimensions: 1536,
    pricePerMillion: voyagePricing['voyage-large-2'] ?? 0.12,
  },
  'voyage-code-2': {
    dimensions: 1536,
    pricePerMillion: voyagePricing['voyage-code-2'] ?? 0.12,
  },
} as const

export const DEFAULT_VOYAGE_MODEL = 'voyage-3.5-lite'

// ============================================================================
// Provider Options
// ============================================================================

export interface VoyageProviderOptions {
  /**
   * API key. Can be a plain string or Redacted<string>.
   * Falls back to VOYAGE_API_KEY env var if not provided.
   */
  readonly apiKey?: string | Redacted.Redacted<string> | undefined
  /** Model to use. Default: voyage-3.5-lite */
  readonly model?: string | undefined
  /** Batch size for embedding requests. Default: 128 (Voyage supports up to 128) */
  readonly batchSize?: number | undefined
  /**
   * Request timeout in milliseconds.
   * Default: 30000 (30 seconds)
   */
  readonly timeout?: number | undefined
}

// ============================================================================
// Voyage Provider Implementation
// ============================================================================

export class VoyageProvider implements EmbeddingProviderWithMetadata {
  readonly name: string
  readonly dimensions: number
  readonly model: string
  readonly baseURL: string = VOYAGE_API_BASE
  readonly providerName = 'voyage'

  private readonly apiKey: Redacted.Redacted<string>
  private readonly batchSize: number
  private readonly timeout: number

  private constructor(
    apiKey: Redacted.Redacted<string>,
    options: VoyageProviderOptions = {},
  ) {
    this.apiKey = apiKey
    this.model = options.model ?? DEFAULT_VOYAGE_MODEL
    this.batchSize = options.batchSize ?? 128
    this.timeout = options.timeout ?? 30000

    // Get dimensions for model
    const modelSpec = VOYAGE_MODELS[this.model]
    this.dimensions = modelSpec?.dimensions ?? 1024

    this.name = `voyage:${this.model}`
  }

  /**
   * Create a Voyage provider instance.
   * Returns an Effect that fails with ApiKeyMissingError if no API key is available.
   *
   * API keys are handled securely using Effect's Redacted type to prevent
   * accidental logging of sensitive values.
   */
  static create(
    options: VoyageProviderOptions = {},
  ): Effect.Effect<VoyageProvider, ApiKeyMissingError> {
    const rawApiKey = options.apiKey ?? process.env.VOYAGE_API_KEY

    if (!rawApiKey) {
      return Effect.fail(
        new ApiKeyMissingError({
          provider: 'Voyage AI',
          envVar: 'VOYAGE_API_KEY',
        }),
      )
    }

    // Wrap in Redacted if it's a plain string
    const redactedApiKey = Redacted.isRedacted(rawApiKey)
      ? rawApiKey
      : Redacted.make(rawApiKey)

    return Effect.succeed(new VoyageProvider(redactedApiKey, options))
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

        // Use AbortController for timeout
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)

        let response: Response
        try {
          response = await fetch(`${VOYAGE_API_BASE}/embeddings`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${Redacted.value(this.apiKey)}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: this.model,
              input: batch,
              input_type: 'document', // 'document' for indexing, 'query' for searching
            }),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timeoutId)
        }

        if (!response.ok) {
          const errorText = await response.text()
          if (response.status === 401) {
            throw new ApiKeyInvalidError({
              provider: 'Voyage AI',
              details: errorText,
            })
          }
          throw new EmbeddingError({
            reason: this.classifyHttpError(response.status, errorText),
            message: `Voyage API error: ${response.status} - ${errorText}`,
            provider: 'voyage',
          })
        }

        const data = (await response.json()) as VoyageEmbeddingResponse

        for (const item of data.data) {
          allEmbeddings.push(item.embedding)
        }

        totalTokens += data.usage?.total_tokens ?? 0

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
      if (
        error instanceof ApiKeyInvalidError ||
        error instanceof EmbeddingError
      ) {
        throw error
      }
      throw new EmbeddingError({
        reason: this.classifyError(error),
        message: error instanceof Error ? error.message : String(error),
        provider: 'voyage',
        cause: error,
      })
    }

    // Calculate cost
    const pricePerMillion = VOYAGE_MODELS[this.model]?.pricePerMillion ?? 0.02
    const cost = (totalTokens / 1_000_000) * pricePerMillion

    return {
      embeddings: allEmbeddings,
      tokensUsed: totalTokens,
      cost,
    }
  }

  private classifyHttpError(
    status: number,
    _message: string,
  ): 'RateLimit' | 'QuotaExceeded' | 'Network' | 'ModelError' | 'Unknown' {
    if (status === 429) return 'RateLimit'
    if (status === 402) return 'QuotaExceeded'
    if (status === 400) return 'ModelError'
    return 'Unknown'
  }

  private classifyError(
    error: unknown,
  ): 'RateLimit' | 'QuotaExceeded' | 'Network' | 'ModelError' | 'Unknown' {
    if (!(error instanceof Error)) return 'Unknown'
    const msg = error.message.toLowerCase()

    // Check for abort errors (timeout)
    if (error.name === 'AbortError' || msg.includes('aborted')) return 'Network'

    if (msg.includes('rate limit') || msg.includes('429')) return 'RateLimit'
    if (msg.includes('quota') || msg.includes('billing')) return 'QuotaExceeded'
    if (
      msg.includes('econnrefused') ||
      msg.includes('timeout') ||
      msg.includes('network')
    )
      return 'Network'
    if (msg.includes('model') && msg.includes('not found')) return 'ModelError'

    return 'Unknown'
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a Voyage AI embedding provider.
 * Returns an Effect that fails with ApiKeyMissingError if no API key is available.
 */
export const createVoyageProvider = (
  options?: VoyageProviderOptions,
): Effect.Effect<EmbeddingProvider, ApiKeyMissingError> =>
  VoyageProvider.create(options)
