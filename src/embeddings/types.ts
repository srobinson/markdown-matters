/**
 * Embedding types for md-tldr
 */

// ============================================================================
// Embedding Provider
// ============================================================================

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<EmbeddingResult>;
}

export interface EmbeddingResult {
  readonly embeddings: readonly number[][];
  readonly tokensUsed: number;
  readonly cost: number;
}

// ============================================================================
// Vector Index
// ============================================================================

export interface VectorEntry {
  readonly id: string;
  readonly sectionId: string;
  readonly documentPath: string;
  readonly heading: string;
  readonly embedding: readonly number[];
}

export interface VectorIndex {
  readonly version: number;
  readonly provider: string;
  readonly dimensions: number;
  readonly entries: Record<string, VectorEntry>;
  readonly totalCost: number;
  readonly totalTokens: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ============================================================================
// Semantic Search
// ============================================================================

export interface SemanticSearchOptions {
  /** Maximum number of results */
  readonly limit?: number | undefined;
  /** Minimum similarity threshold (0-1) */
  readonly threshold?: number | undefined;
  /** Filter by document path pattern */
  readonly pathPattern?: string | undefined;
}

export interface SemanticSearchResult {
  readonly sectionId: string;
  readonly documentPath: string;
  readonly heading: string;
  readonly similarity: number;
  readonly content?: string | undefined;
}

// ============================================================================
// Errors
// ============================================================================

export interface EmbedError {
  readonly _tag: "EmbedError";
  readonly cause: "RateLimit" | "ApiKey" | "Network" | "Unknown";
  readonly message: string;
}

export const embedError = (
  cause: EmbedError["cause"],
  message: string
): EmbedError => ({
  _tag: "EmbedError",
  cause,
  message,
});
