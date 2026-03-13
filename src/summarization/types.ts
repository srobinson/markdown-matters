/**
 * Summarization Module Types
 *
 * Core interfaces for AI-powered summarization of search results.
 * Supports both CLI-based providers (free with subscriptions) and
 * API-based providers (pay-per-use via Vercel AI SDK).
 */

import { Data } from 'effect'

// Re-export provider name types from canonical location
export type {
  APIProviderName,
  CLIProviderName,
} from '../config/schema.js'

// Import for local use
import type { APIProviderName, CLIProviderName } from '../config/schema.js'

/**
 * Summarization mode - CLI providers are free, API providers cost money
 */
export type SummarizationMode = 'cli' | 'api'

/**
 * Information about a detected CLI tool
 */
export interface CLIInfo {
  /** Internal name identifier */
  readonly name: CLIProviderName
  /** Command to execute */
  readonly command: string
  /** Display name for UI */
  readonly displayName: string
  /** Arguments to pass to the CLI for summarization */
  readonly args: readonly string[]
  /** Whether to use stdin for input */
  readonly useStdin: boolean
}

/**
 * API provider pricing information
 */
export interface APIProviderPricing {
  /** Provider name */
  readonly provider: APIProviderName
  /** Display name */
  readonly displayName: string
  /** Cost per million input tokens */
  readonly inputCostPer1M: number
  /** Cost per million output tokens */
  readonly outputCostPer1M: number
  /** Default model to use */
  readonly defaultModel: string
  /** Base URL for the API */
  readonly baseURL: string
  /** Environment variable for API key */
  readonly apiKeyEnvVar: string
}

/**
 * Result from a summarization operation
 */
export interface SummaryResult {
  /** The generated summary text */
  readonly summary: string
  /** Provider that generated the summary */
  readonly provider: CLIProviderName | APIProviderName
  /** Mode used (cli or api) */
  readonly mode: SummarizationMode
  /** Estimated cost in USD (0 for CLI providers) */
  readonly estimatedCost: number
  /** Time taken in milliseconds */
  readonly durationMs: number
  /** Token count estimates (if available) */
  readonly tokens?: {
    readonly input: number
    readonly output: number
  }
}

/**
 * Core summarizer interface - simple and focused
 *
 * Each provider just needs to implement this interface.
 * CLI providers return 0 for cost, API providers calculate actual costs.
 */
export interface Summarizer {
  /** Generate a summary from input text */
  summarize(input: string, prompt: string): Promise<SummaryResult>

  /** Estimate cost before running (optional, defaults to 0 for CLI) */
  estimateCost?(inputTokens: number): number

  /** Check if the provider is available/configured */
  isAvailable(): Promise<boolean>
}

/**
 * Options for streaming summarization
 */
export interface StreamOptions {
  /** Callback for each chunk of text */
  onChunk: (chunk: string) => void
  /** Callback when streaming completes */
  onComplete?: (result: SummaryResult) => void
  /** Callback on error */
  onError?: (error: Error) => void
}

/**
 * Extended summarizer interface with streaming support
 */
export interface StreamingSummarizer extends Summarizer {
  /** Generate a summary with streaming output */
  summarizeStream(
    input: string,
    prompt: string,
    options: StreamOptions,
  ): Promise<void>
}

/**
 * Configuration for AI summarization (distinct from existing SummarizationConfig)
 *
 * This configures the AI provider for generating summaries, not the
 * token budget settings in the existing SummarizationConfig.
 */
export interface AISummarizationConfig {
  /** Mode: 'cli' (free) or 'api' (pay-per-use) */
  readonly mode: SummarizationMode
  /** Provider name */
  readonly provider: CLIProviderName | APIProviderName
  /** Model name (for API providers) */
  readonly model?: string
  /** Enable streaming output */
  readonly stream?: boolean
  /** Custom API base URL */
  readonly baseURL?: string
  /** API key (for API providers, usually from env) */
  readonly apiKey?: string
}

/**
 * Factory function type for creating summarizers
 */
export type SummarizerFactory = (
  config: AISummarizationConfig,
) => Promise<Summarizer>

/**
 * Error codes specific to summarization
 */
export type SummarizationErrorCode =
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_NOT_AVAILABLE'
  | 'CLI_EXECUTION_FAILED'
  | 'API_REQUEST_FAILED'
  | 'RATE_LIMITED'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT'
  | 'NO_API_KEY'

/**
 * Summarization error as Data.TaggedError for Effect integration.
 *
 * Can be caught with Effect.catchTag('SummarizationError', ...) and
 * is part of the MdmError union.
 */
export class SummarizationError extends Data.TaggedError('SummarizationError')<{
  readonly message: string
  readonly code: SummarizationErrorCode
  readonly provider?: string
  readonly cause?: Error
}> {}
