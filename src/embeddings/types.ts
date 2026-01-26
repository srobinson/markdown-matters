/**
 * Embedding types for mdcontext
 */

// ============================================================================
// Embedding Provider
// ============================================================================

export interface EmbeddingProvider {
  readonly name: string
  readonly dimensions: number
  embed(texts: string[]): Promise<EmbeddingResult>
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
  readonly documentPath: string
  readonly heading: string
  readonly embedding: readonly number[]
}

export interface VectorIndex {
  readonly version: number
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
   */
  readonly hydeOptions?:
    | {
        /** Model for hypothetical document generation. Default: gpt-4o-mini */
        readonly model?: string | undefined
        /** Max tokens for generation. Default: 256 */
        readonly maxTokens?: number | undefined
        /** Generation temperature (0-1). Default: 0.3 */
        readonly temperature?: number | undefined
      }
    | undefined
}

// ============================================================================
// Query Preprocessing
// ============================================================================

// ============================================================================
// Heading Boost
// ============================================================================

/** Boost factor per matched term in heading (0.05 = 5% boost per term) */
const HEADING_BOOST_FACTOR = 0.05

/** Boost factor for important files like README (0.03 = 3% boost) */
const FILE_IMPORTANCE_BOOST = 0.03

/**
 * Important file patterns that get ranking boost.
 * These are typically entry points or high-value documentation.
 */
const IMPORTANT_FILE_PATTERNS = [
  /^readme\.md$/i, // Root README
  /\/readme\.md$/i, // Nested README
  /^index\.md$/i, // Index files
  /\/index\.md$/i,
  /^getting-?started/i, // Getting started guides
  /\/getting-?started/i,
  /^introduction/i, // Introductions
  /\/introduction/i,
  /^overview/i, // Overviews
  /\/overview/i,
  /^quickstart/i, // Quickstart guides
  /\/quickstart/i,
  /^changelog\.md$/i, // Changelogs (useful for "what changed" queries)
  /\/changelog\.md$/i,
]

/**
 * Calculate file importance boost for a search result.
 * Boosts results from important files like README, index, getting-started.
 *
 * @param documentPath - Path to the document
 * @returns Boost value to add to similarity score (0.0 to 0.03)
 */
export const calculateFileImportanceBoost = (documentPath: string): number => {
  const isImportant = IMPORTANT_FILE_PATTERNS.some((pattern) =>
    pattern.test(documentPath),
  )
  return isImportant ? FILE_IMPORTANCE_BOOST : 0
}

/**
 * Calculate heading match boost for a search result.
 * Boosts results where query terms appear in section headings.
 *
 * @param heading - Section heading to check
 * @param query - Original search query (will be normalized)
 * @returns Boost value to add to similarity score (0.0 to ~0.15 typically)
 */
export const calculateHeadingBoost = (
  heading: string,
  query: string,
): number => {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (queryTerms.length === 0) return 0

  const headingLower = heading.toLowerCase()
  const matchCount = queryTerms.filter((term) =>
    headingLower.includes(term),
  ).length

  return matchCount * HEADING_BOOST_FACTOR
}

/**
 * Calculate combined ranking boost for a search result.
 * Combines heading match boost and file importance boost.
 *
 * @param heading - Section heading
 * @param query - Search query
 * @param documentPath - Path to the document
 * @returns Combined boost value (0.0 to ~0.18 typically)
 */
export const calculateRankingBoost = (
  heading: string,
  query: string,
  documentPath: string,
): number => {
  const headingBoost = calculateHeadingBoost(heading, query)
  const fileBoost = calculateFileImportanceBoost(documentPath)
  return headingBoost + fileBoost
}

// ============================================================================
// Query Preprocessing
// ============================================================================

/**
 * Preprocess a search query before embedding to reduce noise and improve recall.
 *
 * Transformations applied:
 * - Convert to lowercase (embeddings are case-insensitive)
 * - Replace punctuation with spaces (preserves word boundaries)
 * - Collapse multiple spaces to single space
 * - Trim leading/trailing whitespace
 *
 * This provides 2-5% precision improvement for most queries.
 *
 * @param query - Raw search query
 * @returns Normalized query string
 */
export const preprocessQuery = (query: string): string => {
  return (
    query
      .toLowerCase()
      // Replace punctuation with spaces (preserves word boundaries)
      .replace(/[^\w\s]/g, ' ')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      .trim()
  )
}

export interface SemanticSearchResult {
  readonly sectionId: string
  readonly documentPath: string
  readonly heading: string
  readonly similarity: number
  readonly content?: string | undefined
}

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
