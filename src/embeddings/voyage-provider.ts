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

import { Effect } from 'effect'
import {
  ApiKeyInvalidError,
  ApiKeyMissingError,
  EmbeddingError,
} from '../errors/index.js'
import type {
  EmbeddingProvider,
  EmbeddingProviderWithMetadata,
  EmbeddingResult,
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
 */
export const VOYAGE_MODELS: Record<
  string,
  { dimensions: number; pricePerMillion: number }
> = {
  'voyage-3.5-lite': { dimensions: 1024, pricePerMillion: 0.02 },
  'voyage-3': { dimensions: 1024, pricePerMillion: 0.06 },
  'voyage-code-3': { dimensions: 1024, pricePerMillion: 0.18 },
  // Legacy models
  'voyage-2': { dimensions: 1024, pricePerMillion: 0.1 },
  'voyage-large-2': { dimensions: 1536, pricePerMillion: 0.12 },
  'voyage-code-2': { dimensions: 1536, pricePerMillion: 0.12 },
} as const

export const DEFAULT_VOYAGE_MODEL = 'voyage-3.5-lite'

// ============================================================================
// Provider Options
// ============================================================================

export interface VoyageProviderOptions {
  /** API key. Falls back to VOYAGE_API_KEY env var. */
  readonly apiKey?: string | undefined
  /** Model to use. Default: voyage-3.5-lite */
  readonly model?: string | undefined
  /** Batch size for embedding requests. Default: 128 (Voyage supports up to 128) */
  readonly batchSize?: number | undefined
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

  private readonly apiKey: string
  private readonly batchSize: number

  private constructor(apiKey: string, options: VoyageProviderOptions = {}) {
    this.apiKey = apiKey
    this.model = options.model ?? DEFAULT_VOYAGE_MODEL
    this.batchSize = options.batchSize ?? 128

    // Get dimensions for model
    const modelSpec = VOYAGE_MODELS[this.model]
    this.dimensions = modelSpec?.dimensions ?? 1024

    this.name = `voyage:${this.model}`
  }

  /**
   * Create a Voyage provider instance.
   * Returns an Effect that fails with ApiKeyMissingError if no API key is available.
   */
  static create(
    options: VoyageProviderOptions = {},
  ): Effect.Effect<VoyageProvider, ApiKeyMissingError> {
    const apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY

    if (!apiKey) {
      return Effect.fail(
        new ApiKeyMissingError({
          provider: 'Voyage AI',
          envVar: 'VOYAGE_API_KEY',
        }),
      )
    }

    return Effect.succeed(new VoyageProvider(apiKey, options))
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return { embeddings: [], tokensUsed: 0, cost: 0 }
    }

    const allEmbeddings: number[][] = []
    let totalTokens = 0

    try {
      // Process in batches
      for (let i = 0; i < texts.length; i += this.batchSize) {
        const batch = texts.slice(i, i + this.batchSize)

        const response = await fetch(`${VOYAGE_API_BASE}/embeddings`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            input: batch,
            input_type: 'document', // 'document' for indexing, 'query' for searching
          }),
        })

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
