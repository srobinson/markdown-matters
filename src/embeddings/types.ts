/**
 * Embedding types for mdm
 */

import type { Redacted } from 'effect'
import type { ContextLine } from '../core/types.js'
import type { CANONICAL_SCHEMA_VERSION, DocumentKey } from '../db/canonical.js'
import type { OpenAICompatibleProviderId } from '../providers/index.js'

export type { ContextLine } from '../core/types.js'

// ============================================================================
// Embedding Provider
// ============================================================================

export interface BatchProgress {
  readonly batchIndex: number
  readonly totalBatches: number
  readonly processedTexts: number
  readonly totalTexts: number
}

export interface EmbedOptions {
  readonly onBatchProgress?: ((progress: BatchProgress) => void) | undefined
}

export interface EmbeddingProvider {
  readonly name: string
  readonly dimensions: number
  embed(texts: string[], options?: EmbedOptions): Promise<EmbeddingResult>
}

/**
 * Extended embedding provider with metadata about the underlying service.
 * Implementations like OpenAIProvider include these additional properties.
 */
export interface EmbeddingProviderWithMetadata extends EmbeddingProvider {
  readonly model: string
  readonly baseURL: string | undefined
}

/**
 * Type guard to check if an EmbeddingProvider has extended metadata.
 * Use this instead of unsafe type casting when accessing model/baseURL.
 */
export const hasProviderMetadata = (
  provider: EmbeddingProvider,
): provider is EmbeddingProviderWithMetadata => {
  return (
    'model' in provider &&
    typeof (provider as EmbeddingProviderWithMetadata).model === 'string'
  )
}

export interface EmbeddingResult {
  readonly embeddings: readonly number[][]
  readonly tokensUsed: number
  readonly cost: number
}

// ============================================================================
// Vector Index
// ============================================================================

export interface VectorEntry {
  readonly id: string
  readonly sectionId: string
  readonly documentPath: DocumentKey
  readonly heading: string
  readonly embedding: readonly number[]
}

export interface VectorIndex {
  readonly version: typeof CANONICAL_SCHEMA_VERSION
  readonly provider: string
  readonly providerModel?: string | undefined
  readonly providerBaseURL?: string | undefined
  readonly dimensions: number
  readonly entries: Record<string, VectorEntry>
  readonly totalCost: number
  readonly totalTokens: number
  readonly createdAt: string
  readonly updatedAt: string
  /**
   * HNSW index build parameters (stored for validation on load).
   * These affect index quality and build time - changes require rebuild.
   */
  readonly hnswParams?: HnswIndexParams | undefined
}

/**
 * HNSW index parameters stored in metadata.
 * Used to detect config/index mismatches and recommend rebuilds.
 */
export interface HnswIndexParams {
  /** Max connections per node (M parameter). Default: 16 */
  readonly m: number
  /** Construction-time search width. Default: 200 */
  readonly efConstruction: number
}

// ============================================================================
// Quality Modes
// ============================================================================

/**
 * Search quality modes for HNSW efSearch parameter.
 * Higher efSearch values give better recall at the cost of speed.
 *
 * - 'fast': efSearch=64, ~40% faster, slight recall reduction
 * - 'balanced': efSearch=100 (default), good balance
 * - 'thorough': efSearch=256, ~30% slower, best recall
 */
export type SearchQuality = 'fast' | 'balanced' | 'thorough'

/**
 * efSearch values for each quality mode.
 * These control the size of the dynamic candidate list during search.
 */
export const QUALITY_EF_SEARCH: Record<SearchQuality, number> = {
  fast: 64,
  balanced: 100,
  thorough: 256,
} as const

// ============================================================================
// Semantic Search
// ============================================================================

export interface SemanticSearchOptions {
  /** Maximum number of results */
  readonly limit?: number | undefined
  /** Minimum similarity threshold (0-1) */
  readonly threshold?: number | undefined
  /** Filter by document path pattern */
  readonly pathPattern?: string | undefined
  /** Search quality mode: fast, balanced (default), or thorough */
  readonly quality?: SearchQuality | undefined
  /** Provider configuration override */
  readonly providerConfig?:
    | {
        readonly provider:
          | 'openai'
          | 'ollama'
          | 'lm-studio'
          | 'openrouter'
          | 'voyage'
        readonly baseURL?: string | undefined
        readonly model?: string | undefined
      }
    | undefined
  /**
   * Skip query preprocessing (normalize, lowercase, strip punctuation).
   * Default: false (preprocessing enabled for better recall).
   * Set to true for exact query matching.
   */
  readonly skipPreprocessing?: boolean | undefined
  /**
   * Boost results where query terms appear in section headings.
   * Improves navigation queries like "installation guide" or "API reference".
   * Default: true (heading boost enabled).
   */
  readonly headingBoost?: boolean | undefined
  /**
   * Use HyDE (Hypothetical Document Embeddings) for query expansion.
   * Generates a hypothetical document answering the query using an LLM,
   * then searches using that document's embedding.
   *
   * Best for: complex questions, "how to" queries, ambiguous searches
   * Adds: ~1-2s latency, LLM API cost
   * Improvement: 10-30% better recall on complex queries
   *
   * Default: false (disabled)
   */
  readonly hyde?: boolean | undefined
  /**
   * HyDE configuration options (only used when hyde: true).
   *
   * Each field is optional. When unset, the value is resolved from the
   * embedding-side `providerConfig` where it makes sense (provider, baseURL)
   * and otherwise from per-provider defaults inside `hyde.ts`. Credential
   * lookup is provider-specific: the runtime reads `OPENAI_API_KEY` for
   * openai and `OPENROUTER_API_KEY` for openrouter, while ollama and
   * lm-studio use a local sentinel and need no credential. When a remote
   * provider's env var is unset the runtime fails fast with an actionable
   * error naming that exact variable. Set `apiKey` to bypass env lookup
   * entirely.
   *
   * Voyage is intentionally absent from `provider` because Voyage AI does
   * not expose a chat completion API. If the embedding side uses voyage,
   * callers must pin `hydeOptions.provider` explicitly; otherwise the
   * resolver fails fast with `CapabilityNotSupported` before any HTTP
   * call is made.
   */
  readonly hydeOptions?:
    | {
        /**
         * LLM provider for HyDE generation. Defaults to the embedding-side
         * provider (`providerConfig.provider`) when not set. Required when
         * the embedding side uses voyage, which has no chat completion API.
         */
        readonly provider?: OpenAICompatibleProviderId | undefined
        /**
         * Base URL for the chat completion endpoint. Defaults to the
         * embedding-side `baseURL` when HyDE inherits the embedding
         * provider, otherwise to the resolved provider's default.
         */
        readonly baseURL?: string | undefined
        /**
         * API key for the chosen provider. Accepts plain string or
         * `Redacted<string>`. When unset, the runtime resolves the
         * credential from the provider-specific env var
         * (`OPENAI_API_KEY` for openai, `OPENROUTER_API_KEY` for
         * openrouter; ollama and lm-studio need no credential).
         */
        readonly apiKey?: string | Redacted.Redacted<string> | undefined
        /** Custom system prompt for hypothetical document generation. */
        readonly systemPrompt?: string | undefined
        /**
         * Model for hypothetical document generation. Defaults to a
         * provider-specific value (e.g. gpt-4o-mini for openai).
         */
        readonly model?: string | undefined
        /** Max tokens for generation. Default: 256 */
        readonly maxTokens?: number | undefined
        /** Generation temperature (0-1). Default: 0.3 */
        readonly temperature?: number | undefined
      }
    | undefined
  /** Lines of context before matches */
  readonly contextBefore?: number | undefined
  /** Lines of context after matches */
  readonly contextAfter?: number | undefined
}

export interface SemanticSearchResult {
  readonly sectionId: string
  readonly documentPath: string
  readonly heading: string
  readonly similarity: number
  readonly content?: string | undefined
  /** Context lines with their line numbers (when context is requested) */
  readonly contextLines?: readonly ContextLine[] | undefined
}

// ContextLine is re-exported from src/core/types.ts (canonical definition)

/**
 * Extended semantic search result including metadata about below-threshold results.
 * Used to provide user feedback when 0 results pass the threshold.
 */
export interface SemanticSearchResultWithStats {
  readonly results: readonly SemanticSearchResult[]
  /** Number of results found below threshold (only set when includeBelowThresholdStats is true) */
  readonly belowThresholdCount?: number | undefined
  /** Highest similarity among below-threshold results */
  readonly belowThresholdHighest?: number | undefined
  /** Total results available above threshold before limit was applied */
  readonly totalAvailable?: number | undefined
}

// ============================================================================
// Errors
// ============================================================================
// NOTE: Embedding-related errors are defined in src/errors/index.ts:
// - EmbeddingError: For embedding operation failures (rate limits, quota, network)
// - ApiKeyMissingError: For missing API keys
// - ApiKeyInvalidError: For invalid/rejected API keys
//
// Use these centralized error types instead of defining errors here.
// Example:
//   import { EmbeddingError } from '../errors/index.js'
//   new EmbeddingError({ reason: 'RateLimit', message: 'Rate limited' })
