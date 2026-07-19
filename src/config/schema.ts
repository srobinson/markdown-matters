/**
 * Configuration Schema
 *
 * Plain TypeScript interfaces and a single default configuration object.
 * This is the sole source of truth for config shape and defaults.
 *
 * To add a new config field:
 *   1. Add the field to the appropriate interface
 *   2. Add the default value in defaultConfig
 *   That's it. No other files need editing.
 */

import { Option } from 'effect'

// ============================================================================
// Index Configuration
// ============================================================================

export interface IndexConfig {
  /** Maximum directory depth to traverse when indexing. */
  maxDepth: number
  /** Glob patterns to exclude from indexing. */
  excludePatterns: readonly string[]
  /** File extensions to index. */
  fileExtensions: readonly string[]
  /** Whether to follow symlinks when traversing directories. */
  followSymlinks: boolean
}

// ============================================================================
// Search Configuration
// ============================================================================

export interface SearchConfig {
  /** Default number of search results to return. */
  defaultLimit: number
  /** Maximum number of search results allowed. */
  maxLimit: number
  /** Minimum similarity score for semantic search results (0-1). */
  minSimilarity: number
  /** Whether to include content snippets in search results. */
  includeSnippets: boolean
  /** Maximum length of content snippets in characters. */
  snippetLength: number
  /** Auto-create semantic index if estimated time is under this threshold (seconds). */
  autoIndexThreshold: number
}

// ============================================================================
// Embeddings Configuration
// ============================================================================

export const EMBEDDING_PROVIDER_NAMES = [
  'openai',
  'ollama',
  'lm-studio',
  'openrouter',
  'voyage',
] as const

export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDER_NAMES)[number]

export type OpenAIEmbeddingModel =
  | 'text-embedding-3-small'
  | 'text-embedding-3-large'
  | 'text-embedding-ada-002'

export interface EmbeddingsConfig {
  /** Embedding provider to use. */
  provider: EmbeddingProviderName
  /** Custom base URL for the embedding API. */
  baseURL: Option.Option<string>
  /** Embedding model name. */
  model: string
  /** Number of dimensions for embeddings. */
  dimensions: number
  /** Batch size for embedding API calls. */
  batchSize: number
  /** Maximum retries for failed API calls. */
  maxRetries: number
  /** Delay between retries in milliseconds. */
  retryDelayMs: number
  /** Request timeout in milliseconds. */
  timeoutMs: number
  /** API key for the embedding provider. */
  apiKey: Option.Option<string>
  /** HNSW M parameter: maximum connections per node. */
  hnswM: number
  /** HNSW efConstruction: construction-time search width. */
  hnswEfConstruction: number
}

// ============================================================================
// Output Configuration
// ============================================================================

export const OUTPUT_FORMATS = ['text', 'json'] as const

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export interface OutputConfig {
  /** Default output format. */
  format: OutputFormat
  /** Whether to use colors in terminal output. */
  color: boolean
  /** Whether to pretty-print JSON output. */
  prettyJson: boolean
  /** Whether to show verbose output. */
  verbose: boolean
  /** Whether to show debug information. */
  debug: boolean
}

// ============================================================================
// Summarization Configuration
// ============================================================================

export interface SummarizationConfig {
  /** Token budget for 'brief' compression level. */
  briefTokenBudget: number
  /** Token budget for 'summary' compression level. */
  summaryTokenBudget: number
  /** Target compression ratio for summaries (0-1). */
  compressionRatio: number
  /** Minimum tokens for any section summary. */
  minSectionTokens: number
  /** Maximum topics to extract from a document. */
  maxTopics: number
  /** Minimum remaining budget to include partial content. */
  minPartialBudget: number
}

// ============================================================================
// AI Summarization Configuration
// ============================================================================

export const AI_SUMMARIZATION_MODES = ['cli', 'api'] as const

export type AISummarizationMode = (typeof AI_SUMMARIZATION_MODES)[number]

export const CLI_PROVIDER_NAMES = [
  'claude',
  'copilot',
  'cline',
  'aider',
  'opencode',
  'amp',
] as const

export type CLIProviderName = (typeof CLI_PROVIDER_NAMES)[number]

export const API_PROVIDER_NAMES = [
  'deepseek',
  'anthropic',
  'openai',
  'gemini',
  'qwen',
] as const

export type APIProviderName = (typeof API_PROVIDER_NAMES)[number]

export const SUMMARIZATION_PROVIDER_NAMES = [
  ...CLI_PROVIDER_NAMES,
  ...API_PROVIDER_NAMES,
] as const

export type SummarizationProviderName =
  (typeof SUMMARIZATION_PROVIDER_NAMES)[number]

export interface AISummarizationConfig {
  /** Summarization mode: 'cli' (free) or 'api' (pay-per-use). */
  mode: AISummarizationMode
  /** Provider name. */
  provider: SummarizationProviderName
  /** Model name for API providers (ignored for CLI providers). */
  model: Option.Option<string>
  /** Enable streaming output. */
  stream: boolean
  /** Custom API base URL (for API providers). */
  baseURL: Option.Option<string>
  /** API key (for API providers). */
  apiKey: Option.Option<string>
}

// ============================================================================
// Paths Configuration
// ============================================================================

export interface PathsConfig {
  /** Root directory for markdown files. */
  root: Option.Option<string>
  /** Custom config file path. */
  configFile: Option.Option<string>
}

// ============================================================================
// Full Configuration
// ============================================================================

export interface MdmConfig {
  index: IndexConfig
  search: SearchConfig
  embeddings: EmbeddingsConfig
  summarization: SummarizationConfig
  aiSummarization: AISummarizationConfig
  output: OutputConfig
  paths: PathsConfig
}

// ============================================================================
// Default Configuration Values (single source of truth)
// ============================================================================

export const defaultConfig: MdmConfig = {
  index: {
    maxDepth: 10,
    excludePatterns: ['node_modules', '.git', 'dist', 'build'],
    fileExtensions: ['.md', '.mdx'],
    followSymlinks: false,
  },
  search: {
    defaultLimit: 10,
    maxLimit: 100,
    minSimilarity: 0.35,
    includeSnippets: true,
    snippetLength: 200,
    autoIndexThreshold: 10,
  },
  embeddings: {
    provider: 'openai',
    baseURL: Option.none(),
    model: 'text-embedding-3-small',
    dimensions: 512,
    batchSize: 100,
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: 30000,
    apiKey: Option.none(),
    hnswM: 16,
    hnswEfConstruction: 200,
  },
  summarization: {
    briefTokenBudget: 100,
    summaryTokenBudget: 500,
    compressionRatio: 0.3,
    minSectionTokens: 20,
    maxTopics: 10,
    minPartialBudget: 50,
  },
  aiSummarization: {
    mode: 'cli',
    provider: 'claude',
    model: Option.none(),
    stream: false,
    baseURL: Option.none(),
    apiKey: Option.none(),
  },
  output: {
    format: 'text',
    color: true,
    prettyJson: true,
    verbose: false,
    debug: false,
  },
  paths: {
    root: Option.none(),
    configFile: Option.none(),
  },
}
