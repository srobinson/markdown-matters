/**
 * OpenAI embedding provider
 */

import { Effect } from 'effect'
import OpenAI from 'openai'
import {
  ApiKeyInvalidError,
  ApiKeyMissingError,
  EmbeddingError,
} from '../errors/index.js'
import type { EmbeddingProvider, EmbeddingResult } from './types.js'

// ============================================================================
// Cost Constants
// ============================================================================

// Prices per 1M tokens (as of 2024)
const PRICING: Record<string, number> = {
  'text-embedding-3-small': 0.02,
  'text-embedding-3-large': 0.13,
  'text-embedding-ada-002': 0.1,
}

// ============================================================================
// OpenAI Provider
// ============================================================================

export interface OpenAIProviderOptions {
  readonly apiKey?: string | undefined
  readonly model?: string | undefined
  readonly batchSize?: number | undefined
}

export class OpenAIProvider implements EmbeddingProvider {
  readonly name: string
  readonly dimensions: number

  private readonly client: OpenAI
  private readonly model: string
  private readonly batchSize: number

  private constructor(apiKey: string, options: OpenAIProviderOptions = {}) {
    this.client = new OpenAI({ apiKey })
    this.model = options.model ?? 'text-embedding-3-small'
    this.batchSize = options.batchSize ?? 100
    this.name = `openai:${this.model}`
    this.dimensions = 512
  }

  /**
   * Create an OpenAI provider instance.
   * Returns an Effect that fails with ApiKeyMissingError if no API key is available.
   */
  static create(
    options: OpenAIProviderOptions = {},
  ): Effect.Effect<OpenAIProvider, ApiKeyMissingError> {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) {
      return Effect.fail(
        new ApiKeyMissingError({
          provider: 'OpenAI',
          envVar: 'OPENAI_API_KEY',
        }),
      )
    }
    return Effect.succeed(new OpenAIProvider(apiKey, options))
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

        const response = await this.client.embeddings.create({
          model: this.model,
          input: batch,
          dimensions: 512, // Ensure consistent dimensions
        })

        for (const item of response.data) {
          allEmbeddings.push(item.embedding)
        }

        totalTokens += response.usage?.total_tokens ?? 0
      }
    } catch (error) {
      // Check for authentication errors (401 Unauthorized, invalid API key)
      if (error instanceof OpenAI.AuthenticationError) {
        throw new ApiKeyInvalidError({
          provider: 'OpenAI',
          details: error.message,
        })
      }
      throw error
    }

    // Calculate cost
    const pricePerMillion = PRICING[this.model] ?? 0.02
    const cost = (totalTokens / 1_000_000) * pricePerMillion

    return {
      embeddings: allEmbeddings,
      tokensUsed: totalTokens,
      cost,
    }
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
        provider: 'OpenAI',
        cause: e,
      })
    },
  })
