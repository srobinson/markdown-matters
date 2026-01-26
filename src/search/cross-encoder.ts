/**
 * Cross-Encoder Re-ranking for Search Results
 *
 * Uses a cross-encoder model to re-rank search results for improved precision.
 * Cross-encoders process query-document pairs together, capturing fine-grained
 * relevance that bi-encoders (used in initial retrieval) may miss.
 *
 * Benefits:
 * - 20-35% improvement in retrieval precision
 * - Better handling of nuanced relevance
 * - Opt-in to avoid latency when not needed
 *
 * Model: Xenova/ms-marco-MiniLM-L-6-v2 (22.7M params, 2-5ms/pair)
 * Note: Model download is ~90MB on first use. Use initializeReranker() to pre-download.
 */

import * as path from 'node:path'
import { Effect } from 'effect'
import { INDEX_DIR } from '../index/types.js'

// ============================================================================
// Dependency availability (checked at module load time)
// ============================================================================

let transformersAvailable: boolean | null = null

/**
 * Check if @huggingface/transformers is available.
 * Result is cached after first check.
 */
const checkTransformersAvailable = async (): Promise<boolean> => {
  if (transformersAvailable !== null) {
    return transformersAvailable
  }
  try {
    await import('@huggingface/transformers')
    transformersAvailable = true
  } catch {
    transformersAvailable = false
  }
  return transformersAvailable
}

// ============================================================================
// Types
// ============================================================================

export interface RerankerOptions {
  /** Number of top candidates to re-rank (default: 20) */
  readonly topK?: number
  /** Number of results to return after re-ranking (default: 10) */
  readonly returnTopN?: number
  /** Progress callback for model loading */
  readonly onProgress?: (progress: ModelProgress) => void
}

export interface ModelProgress {
  readonly status: 'loading' | 'ready'
  readonly file?: string | undefined
  readonly progress?: number | undefined
}

export interface RerankedResult<T> {
  readonly item: T
  readonly rerankerScore: number
  readonly originalRank: number
}

export interface Reranker {
  /**
   * Re-rank search results by query-document relevance.
   *
   * @param query - The search query
   * @param results - Array of search results to re-rank
   * @param getContent - Function to extract text content for each result
   * @returns Re-ranked results with scores
   */
  rerank<T>(
    query: string,
    results: readonly T[],
    getContent: (item: T) => string,
  ): Promise<RerankedResult<T>[]>

  /**
   * Check if the model is loaded and ready.
   */
  isReady(): boolean

  /**
   * Unload the model to free memory.
   */
  unload(): void
}

// ============================================================================
// Cross-Encoder Implementation
// ============================================================================

// Types for dynamically imported transformers.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AutoTokenizer = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AutoModelForSequenceClassification = any

const MODEL_ID = 'Xenova/ms-marco-MiniLM-L-6-v2'

class CrossEncoderReranker implements Reranker {
  private model: AutoModelForSequenceClassification | null = null
  private tokenizer: AutoTokenizer | null = null
  private loadPromise: Promise<void> | null = null
  private cacheDir: string | undefined

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir
  }

  private async ensureLoaded(
    onProgress?: (progress: ModelProgress) => void,
  ): Promise<void> {
    if (this.model && this.tokenizer) {
      return
    }

    if (this.loadPromise) {
      return this.loadPromise
    }

    this.loadPromise = this.load(onProgress)
    return this.loadPromise
  }

  private async load(
    onProgress?: (progress: ModelProgress) => void,
  ): Promise<void> {
    onProgress?.({ status: 'loading' })

    // Dynamic import to avoid bundling issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const transformers = await import(
      /* webpackIgnore: true */ '@huggingface/transformers'
    )
    const { AutoTokenizer, AutoModelForSequenceClassification, env } =
      transformers

    // Set cache directory if specified
    if (this.cacheDir) {
      env.cacheDir = this.cacheDir
    }

    // Load model and tokenizer
    const progressCallback = onProgress
      ? (data: { file?: string; progress?: number }) => {
          onProgress({
            status: 'loading',
            file: data.file,
            progress: data.progress,
          })
        }
      : undefined

    this.tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
      progress_callback: progressCallback,
    })

    this.model = await AutoModelForSequenceClassification.from_pretrained(
      MODEL_ID,
      {
        progress_callback: progressCallback,
      },
    )

    onProgress?.({ status: 'ready' })
  }

  async rerank<T>(
    query: string,
    results: readonly T[],
    getContent: (item: T) => string,
  ): Promise<RerankedResult<T>[]> {
    if (results.length === 0) {
      return []
    }

    await this.ensureLoaded()

    if (!this.model || !this.tokenizer) {
      throw new Error('Failed to load cross-encoder model')
    }

    // Prepare query-document pairs
    const queries = results.map(() => query)
    const documents = results.map((r) => getContent(r))

    // Tokenize all pairs
    const features = this.tokenizer(queries, {
      text_pair: documents,
      padding: true,
      truncation: true,
      max_length: 512,
    })

    // Get relevance scores
    const output = await this.model(features)

    // Extract logits (relevance scores)
    // The model outputs logits directly - higher = more relevant
    const logits = output.logits.data as Float32Array

    // Create results with scores
    const scoredResults: RerankedResult<T>[] = results.map((item, idx) => ({
      item,
      rerankerScore: logits[idx] ?? 0,
      originalRank: idx + 1,
    }))

    // Sort by re-ranker score (descending)
    scoredResults.sort((a, b) => b.rerankerScore - a.rerankerScore)

    return scoredResults
  }

  isReady(): boolean {
    return this.model !== null && this.tokenizer !== null
  }

  /**
   * Initialize (pre-download) the model with progress reporting.
   * This is the preferred method for --rerank-init.
   */
  async initialize(
    onProgress?: (progress: ModelProgress) => void,
  ): Promise<void> {
    await this.ensureLoaded(onProgress)
  }

  unload(): void {
    this.model = null
    this.tokenizer = null
    this.loadPromise = null
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let rerankerInstance: CrossEncoderReranker | null = null
let rerankerCacheDir: string | undefined

/**
 * Get the singleton reranker instance.
 * The model is loaded lazily on first use.
 *
 * Note: If cacheDir changes from a previous call, the instance is recreated.
 * This ensures correct behavior in multi-tenant scenarios and tests.
 */
export const getReranker = (cacheDir?: string): Reranker => {
  // Recreate instance if cacheDir has changed
  if (rerankerInstance && rerankerCacheDir !== cacheDir) {
    rerankerInstance.unload()
    rerankerInstance = null
  }

  if (!rerankerInstance) {
    rerankerInstance = new CrossEncoderReranker(cacheDir)
    rerankerCacheDir = cacheDir
  }
  return rerankerInstance
}

/**
 * Unload the reranker model to free memory.
 */
export const unloadReranker = (): void => {
  if (rerankerInstance) {
    rerankerInstance.unload()
    rerankerInstance = null
    rerankerCacheDir = undefined
  }
}

// ============================================================================
// Effect Wrappers
// ============================================================================

export class RerankerError extends Error {
  readonly _tag = 'RerankerError'
  constructor(
    readonly reason:
      | 'ModelLoadFailed'
      | 'InferenceFailed'
      | 'DependencyMissing',
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'RerankerError'
  }
}

/**
 * Re-rank search results using the cross-encoder model.
 *
 * @param query - The search query
 * @param results - Array of search results to re-rank
 * @param getContent - Function to extract text content for each result
 * @param options - Re-ranking options
 * @returns Re-ranked results wrapped in Effect
 */
export const rerankResults = <T>(
  query: string,
  results: readonly T[],
  getContent: (item: T) => string,
  options: RerankerOptions = {},
): Effect.Effect<RerankedResult<T>[], RerankerError> =>
  Effect.gen(function* () {
    const topK = options.topK ?? 20
    const returnTopN = options.returnTopN ?? 10

    // Take top-K candidates for re-ranking
    const candidates = results.slice(0, topK)

    if (candidates.length === 0) {
      return []
    }

    // Determine cache directory using node's process.cwd()
    const nodeProcess = globalThis as unknown as {
      process?: { cwd: () => string }
    }
    const cwd = nodeProcess.process?.cwd() ?? '.'
    const cacheDir = options.onProgress
      ? undefined // Let user see download progress
      : path.join(cwd, INDEX_DIR, 'models')

    const reranker = getReranker(cacheDir)

    // Check dependency availability before attempting re-ranking
    const available = yield* Effect.promise(() => checkTransformersAvailable())
    if (!available) {
      return yield* Effect.fail(
        new RerankerError(
          'DependencyMissing',
          'Cross-encoder re-ranking requires @huggingface/transformers. Install with: npm install @huggingface/transformers',
        ),
      )
    }

    // Re-rank using cross-encoder
    const reranked = yield* Effect.tryPromise({
      try: () => reranker.rerank(query, candidates, getContent),
      catch: (e) =>
        new RerankerError(
          'InferenceFailed',
          `Re-ranking failed: ${e instanceof Error ? e.message : String(e)}`,
          e,
        ),
    })

    // Return top-N re-ranked results
    return reranked.slice(0, returnTopN)
  })

/**
 * Check if the @huggingface/transformers package is available.
 */
export const isRerankerAvailable = (): Effect.Effect<boolean, never> =>
  Effect.promise(() => checkTransformersAvailable())

/**
 * Initialize (pre-download) the cross-encoder model.
 * Use this to download the model before first search to avoid latency.
 *
 * @param cacheDir - Optional directory to cache the model
 * @param onProgress - Optional callback for download progress
 * @returns Effect that completes when model is loaded
 */
export const initializeReranker = (
  cacheDir?: string,
  onProgress?: (progress: ModelProgress) => void,
): Effect.Effect<void, RerankerError> =>
  Effect.gen(function* () {
    // Check dependency availability
    const available = yield* Effect.promise(() => checkTransformersAvailable())
    if (!available) {
      return yield* Effect.fail(
        new RerankerError(
          'DependencyMissing',
          'Cross-encoder re-ranking requires @huggingface/transformers. Install with: npm install @huggingface/transformers',
        ),
      )
    }

    const reranker = getReranker(cacheDir) as CrossEncoderReranker

    // Initialize the model with progress reporting
    yield* Effect.tryPromise({
      try: () => reranker.initialize(onProgress),
      catch: (e) =>
        new RerankerError(
          'ModelLoadFailed',
          `Failed to initialize model: ${e instanceof Error ? e.message : String(e)}`,
          e,
        ),
    })
  })
