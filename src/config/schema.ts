/**
 * Effect Config Schema Module
 *
 * Defines all configuration options using Effect's Config combinators.
 * This provides native integration with Effect's ConfigProvider system,
 * enabling compile-time tracking of config requirements through the type system.
 *
 * ## Configuration Structure
 *
 * - index: Settings for the indexing process
 * - search: Settings for search operations
 * - embeddings: Settings for semantic embeddings (OpenAI)
 * - output: Settings for CLI output formatting
 * - paths: Settings for file paths and directories
 *
 * ## Usage
 *
 * ```typescript
 * import { MdContextConfig, IndexConfig } from './config/schema.js'
 * import { Effect } from 'effect'
 *
 * const program = Effect.gen(function* () {
 *   const config = yield* MdContextConfig
 *   console.log(`Max depth: ${config.index.maxDepth}`)
 * })
 * ```
 */

import { Config, Option } from 'effect'

// ============================================================================
// Index Configuration
// ============================================================================

/**
 * Configuration for the indexing process
 */
export const IndexConfig = Config.all({
  /**
   * Maximum directory depth to traverse when indexing
   * Default: 10
   */
  maxDepth: Config.number('maxDepth').pipe(Config.withDefault(10)),

  /**
   * Glob patterns to exclude from indexing (comma-separated)
   * Default: ['node_modules', '.git', 'dist', 'build']
   */
  excludePatterns: Config.array(Config.string(), 'excludePatterns').pipe(
    Config.withDefault(['node_modules', '.git', 'dist', 'build']),
  ),

  /**
   * File extensions to index (comma-separated)
   * Default: ['.md', '.mdx']
   */
  fileExtensions: Config.array(Config.string(), 'fileExtensions').pipe(
    Config.withDefault(['.md', '.mdx']),
  ),

  /**
   * Whether to follow symlinks when traversing directories
   * Default: false
   */
  followSymlinks: Config.boolean('followSymlinks').pipe(
    Config.withDefault(false),
  ),

  /**
   * Directory where index files are stored (relative to project root)
   * Default: '.mdcontext'
   */
  indexDir: Config.string('indexDir').pipe(Config.withDefault('.mdcontext')),
})

/**
 * Inferred type for index configuration
 */
export type IndexConfig = Config.Config.Success<typeof IndexConfig>

// ============================================================================
// Search Configuration
// ============================================================================

/**
 * Configuration for search operations
 */
export const SearchConfig = Config.all({
  /**
   * Default number of search results to return
   * Default: 10
   */
  defaultLimit: Config.number('defaultLimit').pipe(Config.withDefault(10)),

  /**
   * Maximum number of search results allowed
   * Default: 100
   */
  maxLimit: Config.number('maxLimit').pipe(Config.withDefault(100)),

  /**
   * Minimum similarity score for semantic search results (0-1)
   * Lower values return more results but may include less relevant matches.
   * Default: 0.35 (captures single-word queries that score 30-40%)
   */
  minSimilarity: Config.number('minSimilarity').pipe(Config.withDefault(0.35)),

  /**
   * Whether to include content snippets in search results
   * Default: true
   */
  includeSnippets: Config.boolean('includeSnippets').pipe(
    Config.withDefault(true),
  ),

  /**
   * Maximum length of content snippets in characters
   * Default: 200
   */
  snippetLength: Config.number('snippetLength').pipe(Config.withDefault(200)),

  /**
   * Auto-create semantic index if estimated time is under this threshold (seconds)
   * Default: 10
   */
  autoIndexThreshold: Config.number('autoIndexThreshold').pipe(
    Config.withDefault(10),
  ),
})

/**
 * Inferred type for search configuration
 */
export type SearchConfig = Config.Config.Success<typeof SearchConfig>

// ============================================================================
// Embeddings Configuration
// ============================================================================

/**
 * Supported embedding providers
 *
 * - openai: OpenAI's text-embedding-3 models (default)
 * - ollama: Local Ollama server with nomic-embed-text or similar
 * - lm-studio: LM Studio's local embedding server
 * - openrouter: OpenRouter API gateway for multiple providers
 */
export type EmbeddingProvider =
  | 'openai'
  | 'ollama'
  | 'lm-studio'
  | 'openrouter'
  | 'voyage'

/**
 * Supported OpenAI embedding models
 */
export type OpenAIEmbeddingModel =
  | 'text-embedding-3-small'
  | 'text-embedding-3-large'
  | 'text-embedding-ada-002'

/**
 * Configuration for semantic embeddings
 */
export const EmbeddingsConfig = Config.all({
  /**
   * Embedding provider to use
   * Default: 'openai'
   */
  provider: Config.literal(
    'openai',
    'ollama',
    'lm-studio',
    'openrouter',
    'voyage',
  )('provider').pipe(Config.withDefault('openai' as const)),

  /**
   * Custom base URL for the embedding API
   * If not specified, provider-specific defaults are used:
   * - openai: https://api.openai.com/v1
   * - ollama: http://localhost:11434/v1
   * - lm-studio: http://localhost:1234/v1
   * - openrouter: https://openrouter.ai/api/v1
   */
  baseURL: Config.option(Config.string('baseURL')),

  /**
   * OpenAI embedding model to use
   * Default: 'text-embedding-3-small'
   */
  model: Config.string('model').pipe(
    Config.withDefault('text-embedding-3-small'),
  ),

  /**
   * Number of dimensions for embeddings
   * Lower dimensions = faster search, higher = more accuracy
   * Default: 512
   */
  dimensions: Config.number('dimensions').pipe(Config.withDefault(512)),

  /**
   * Batch size for embedding API calls
   * Default: 100
   */
  batchSize: Config.number('batchSize').pipe(Config.withDefault(100)),

  /**
   * Maximum retries for failed API calls
   * Default: 3
   */
  maxRetries: Config.number('maxRetries').pipe(Config.withDefault(3)),

  /**
   * Delay between retries in milliseconds
   * Default: 1000
   */
  retryDelayMs: Config.number('retryDelayMs').pipe(Config.withDefault(1000)),

  /**
   * Request timeout in milliseconds
   * Default: 30000 (30 seconds)
   */
  timeoutMs: Config.number('timeoutMs').pipe(Config.withDefault(30000)),

  /**
   * OpenAI API key (usually from environment variable)
   * No default - must be provided
   */
  apiKey: Config.option(Config.string('apiKey')),

  // HNSW Index Build Parameters
  // These control the vector index structure and affect build time and search quality.
  // Changing these requires rebuilding the index.

  /**
   * HNSW M parameter: maximum connections per node
   * Higher M = better recall but larger index and slower builds
   * Recommended: 12 (speed), 16 (balanced), 24 (quality)
   * Default: 16
   */
  hnswM: Config.number('hnswM').pipe(Config.withDefault(16)),

  /**
   * HNSW efConstruction: construction-time search width
   * Higher values = better index quality but slower builds
   * Recommended: 128 (speed), 200 (balanced), 256 (quality)
   * Default: 200
   */
  hnswEfConstruction: Config.number('hnswEfConstruction').pipe(
    Config.withDefault(200),
  ),
})

/**
 * Inferred type for embeddings configuration
 */
export type EmbeddingsConfig = Config.Config.Success<typeof EmbeddingsConfig>

// ============================================================================
// Output Configuration
// ============================================================================

/**
 * Supported output formats
 */
export type OutputFormat = 'text' | 'json'

/**
 * Configuration for CLI output formatting
 */
export const OutputConfig = Config.all({
  /**
   * Default output format
   * Default: 'text'
   */
  format: Config.literal(
    'text',
    'json',
  )('format').pipe(Config.withDefault('text' as const)),

  /**
   * Whether to use colors in terminal output
   * Default: true
   */
  color: Config.boolean('color').pipe(Config.withDefault(true)),

  /**
   * Whether to pretty-print JSON output
   * Default: true
   */
  prettyJson: Config.boolean('prettyJson').pipe(Config.withDefault(true)),

  /**
   * Whether to show verbose output
   * Default: false
   */
  verbose: Config.boolean('verbose').pipe(Config.withDefault(false)),

  /**
   * Whether to show debug information
   * Default: false
   */
  debug: Config.boolean('debug').pipe(Config.withDefault(false)),
})

/**
 * Inferred type for output configuration
 */
export type OutputConfig = Config.Config.Success<typeof OutputConfig>

// ============================================================================
// Summarization Configuration
// ============================================================================

/**
 * Configuration for summarization and context assembly
 */
export const SummarizationConfig = Config.all({
  /**
   * Token budget for 'brief' compression level
   * Default: 100
   */
  briefTokenBudget: Config.number('briefTokenBudget').pipe(
    Config.withDefault(100),
  ),

  /**
   * Token budget for 'summary' compression level
   * Default: 500
   */
  summaryTokenBudget: Config.number('summaryTokenBudget').pipe(
    Config.withDefault(500),
  ),

  /**
   * Target compression ratio for summaries (0-1)
   * Default: 0.3 (30% of original)
   */
  compressionRatio: Config.number('compressionRatio').pipe(
    Config.withDefault(0.3),
  ),

  /**
   * Minimum tokens for any section summary
   * Default: 20
   */
  minSectionTokens: Config.number('minSectionTokens').pipe(
    Config.withDefault(20),
  ),

  /**
   * Maximum topics to extract from a document
   * Default: 10
   */
  maxTopics: Config.number('maxTopics').pipe(Config.withDefault(10)),

  /**
   * Minimum remaining budget to include partial content
   * Default: 50
   */
  minPartialBudget: Config.number('minPartialBudget').pipe(
    Config.withDefault(50),
  ),
})

/**
 * Inferred type for summarization configuration
 */
export type SummarizationConfig = Config.Config.Success<
  typeof SummarizationConfig
>

// ============================================================================
// AI Summarization Configuration
// ============================================================================

/**
 * Supported AI summarization modes
 *
 * - cli: Use CLI tools like Claude Code, Copilot CLI (free with subscription)
 * - api: Use API providers like DeepSeek, OpenAI (pay-per-use)
 */
export type AISummarizationMode = 'cli' | 'api'

/**
 * CLI provider names for AI summarization
 */
export type CLIProviderName =
  | 'claude'
  | 'copilot'
  | 'cline'
  | 'aider'
  | 'opencode'
  | 'amp'

/**
 * API provider names for AI summarization
 */
export type APIProviderName =
  | 'deepseek'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'qwen'

/**
 * All provider names (CLI + API)
 */
export type SummarizationProviderName = CLIProviderName | APIProviderName

/**
 * Configuration for AI-powered summarization of search results.
 *
 * This is separate from SummarizationConfig which handles token budgets
 * for context assembly. AISummarizationConfig controls the AI provider
 * used to generate natural language summaries.
 */
export const AISummarizationConfig = Config.all({
  /**
   * Summarization mode: 'cli' (free) or 'api' (pay-per-use)
   * Default: 'cli' - prioritize free CLI tools
   */
  mode: Config.literal(
    'cli',
    'api',
  )('mode').pipe(Config.withDefault('cli' as const)),

  /**
   * Provider name (e.g., 'claude', 'opencode' for CLI; 'deepseek', 'openai' for API)
   * Default: 'claude' - most common CLI tool
   */
  provider: Config.literal(
    // CLI providers
    'claude',
    'copilot',
    'cline',
    'aider',
    'opencode',
    'amp',
    // API providers
    'deepseek',
    'anthropic',
    'openai',
    'gemini',
    'qwen',
  )('provider').pipe(Config.withDefault('claude' as const)),

  /**
   * Model name for API providers (ignored for CLI providers)
   * Default: 'deepseek-chat' - ultra-cheap default
   */
  model: Config.option(Config.string('model')),

  /**
   * Enable streaming output
   * Default: false
   */
  stream: Config.boolean('stream').pipe(Config.withDefault(false)),

  /**
   * Custom API base URL (for API providers)
   */
  baseURL: Config.option(Config.string('baseURL')),

  /**
   * API key (for API providers, usually from environment)
   */
  apiKey: Config.option(Config.string('apiKey')),
})

/**
 * Inferred type for AI summarization configuration
 */
export type AISummarizationConfig = Config.Config.Success<
  typeof AISummarizationConfig
>

// ============================================================================
// Paths Configuration
// ============================================================================

/**
 * Configuration for file paths and directories
 */
export const PathsConfig = Config.all({
  /**
   * Root directory for markdown files (default: current working directory)
   */
  root: Config.option(Config.string('root')),

  /**
   * Custom config file path (default: auto-detected)
   */
  configFile: Config.option(Config.string('configFile')),

  /**
   * Cache directory for temporary files
   * Default: '.mdcontext/cache'
   */
  cacheDir: Config.string('cacheDir').pipe(
    Config.withDefault('.mdcontext/cache'),
  ),
})

/**
 * Inferred type for paths configuration
 */
export type PathsConfig = Config.Config.Success<typeof PathsConfig>

// ============================================================================
// Full Configuration
// ============================================================================

/**
 * Complete mdcontext configuration
 *
 * Combines all configuration sections into a single nested config.
 * Use with Effect's ConfigProvider to load from various sources.
 */
export const MdContextConfig = Config.all({
  index: Config.nested(IndexConfig, 'index'),
  search: Config.nested(SearchConfig, 'search'),
  embeddings: Config.nested(EmbeddingsConfig, 'embeddings'),
  summarization: Config.nested(SummarizationConfig, 'summarization'),
  aiSummarization: Config.nested(AISummarizationConfig, 'aiSummarization'),
  output: Config.nested(OutputConfig, 'output'),
  paths: Config.nested(PathsConfig, 'paths'),
})

/**
 * Inferred type for the complete configuration
 */
export type MdContextConfig = Config.Config.Success<typeof MdContextConfig>

// ============================================================================
// Default Configuration Values
// ============================================================================

/**
 * Default configuration values as a plain object.
 * Useful for initializing config files or for documentation.
 */
export const defaultConfig: MdContextConfig = {
  index: {
    maxDepth: 10,
    excludePatterns: ['node_modules', '.git', 'dist', 'build'],
    fileExtensions: ['.md', '.mdx'],
    followSymlinks: false,
    indexDir: '.mdcontext',
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
    cacheDir: '.mdcontext/cache',
  },
}
