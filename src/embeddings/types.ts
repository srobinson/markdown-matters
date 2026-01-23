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
  readonly dimensions: number
  readonly entries: Record<string, VectorEntry>
  readonly totalCost: number
  readonly totalTokens: number
  readonly createdAt: string
  readonly updatedAt: string
}

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
}

export interface SemanticSearchResult {
  readonly sectionId: string
  readonly documentPath: string
  readonly heading: string
  readonly similarity: number
  readonly content?: string | undefined
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
