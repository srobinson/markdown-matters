/**
 * Vector store using hnswlib-node
 *
 * Supports both legacy (flat) and namespaced storage layouts:
 * - Legacy: .mdcontext/vectors.bin, .mdcontext/vectors.meta.bin
 * - Namespaced: .mdcontext/embeddings/{namespace}/vectors.bin, vectors.meta.bin
 *
 * New indexes are written using namespaced storage. Existing legacy indexes
 * continue to be loaded from their original flat locations; this module does
 * not perform automatic migration between layouts.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as msgpack from '@msgpack/msgpack'
import { Effect } from 'effect'
import HierarchicalNSW from 'hnswlib-node'
import { DimensionMismatchError, VectorStoreError } from '../errors/index.js'
import { INDEX_DIR } from '../index/types.js'
import {
  generateNamespace,
  getNamespaceDir,
  getMetaPath as getNamespacedMetaPath,
  getVectorPath as getNamespacedVectorPath,
} from './embedding-namespace.js'
import type { VectorEntry, VectorIndex } from './types.js'

// ============================================================================
// Constants
// ============================================================================

const VECTOR_INDEX_FILE = 'vectors.bin'
const VECTOR_META_FILE = 'vectors.meta.bin'
const INDEX_VERSION = 1

// ============================================================================
// Vector Store
// ============================================================================

export interface VectorSearchOptions {
  /** efSearch parameter for HNSW (controls recall/speed tradeoff, default: 100) */
  readonly efSearch?: number | undefined
}

export interface VectorStore {
  readonly rootPath: string
  readonly dimensions: number
  add(entries: VectorEntry[]): Effect.Effect<void, VectorStoreError>
  search(
    vector: number[],
    limit: number,
    threshold?: number,
    options?: VectorSearchOptions,
  ): Effect.Effect<VectorSearchResult[], VectorStoreError>
  /**
   * Search with additional stats about below-threshold results.
   * Used to provide feedback when 0 results pass the threshold.
   */
  searchWithStats(
    vector: number[],
    limit: number,
    threshold?: number,
    options?: VectorSearchOptions,
  ): Effect.Effect<VectorSearchResultWithStats, VectorStoreError>
  save(): Effect.Effect<void, VectorStoreError>
  /**
   * Load the vector store from disk.
   *
   * @returns VectorStoreLoadResult with loaded status and any warnings
   * @throws DimensionMismatchError if the stored dimensions don't match current provider
   */
  load(): Effect.Effect<
    VectorStoreLoadResult,
    VectorStoreError | DimensionMismatchError
  >
  getStats(): VectorStoreStats
}

export interface VectorSearchResult {
  readonly id: string
  readonly sectionId: string
  readonly documentPath: string
  readonly heading: string
  readonly similarity: number
}

/**
 * Extended search result with metadata about below-threshold results.
 * Used to provide user feedback when 0 results pass the threshold.
 */
export interface VectorSearchResultWithStats {
  readonly results: VectorSearchResult[]
  /** Number of results that were found but below threshold */
  readonly belowThresholdCount: number
  /** Highest similarity score among below-threshold results (if any) */
  readonly belowThresholdHighest: number | null
}

export interface VectorStoreStats {
  readonly count: number
  readonly dimensions: number
  readonly provider: string
  readonly providerModel?: string | undefined
  readonly totalCost: number
  readonly totalTokens: number
}

/**
 * Result of loading a vector store, including any warnings about config mismatches.
 */
export interface VectorStoreLoadResult {
  /** Whether the index was loaded successfully */
  readonly loaded: boolean
  /** Warning about HNSW parameter mismatch (if any) */
  readonly hnswMismatch?: HnswMismatchWarning | undefined
}

/**
 * Warning when HNSW parameters in config differ from stored index parameters.
 * The index was built with different parameters than currently configured.
 */
export interface HnswMismatchWarning {
  /** Current config values */
  readonly configParams: { m: number; efConstruction: number }
  /** Values stored in the index */
  readonly indexParams: { m: number; efConstruction: number }
}

// ============================================================================
// Implementation
// ============================================================================

class HnswVectorStore implements VectorStore {
  readonly rootPath: string
  readonly dimensions: number

  private index: HierarchicalNSW.HierarchicalNSW | null = null
  private entries: Map<number, VectorEntry> = new Map()
  private idToIndex: Map<string, number> = new Map()
  private nextIndex = 0
  private provider = 'unknown'
  private providerModel: string | undefined = undefined
  private providerBaseURL: string | undefined = undefined
  private totalCost = 0
  private totalTokens = 0

  // HNSW build parameters
  private readonly hnswM: number
  private readonly hnswEfConstruction: number

  // Namespace support - when set, uses namespaced storage paths
  private namespace: string | undefined = undefined

  constructor(
    rootPath: string,
    dimensions: number,
    hnswOptions?: HnswBuildOptions,
  ) {
    this.rootPath = path.resolve(rootPath)
    this.dimensions = dimensions
    this.hnswM = hnswOptions?.m ?? 16
    this.hnswEfConstruction = hnswOptions?.efConstruction ?? 200
  }

  /**
   * Set the namespace for this vector store.
   * When set, all storage operations use the namespaced path.
   */
  setNamespace(namespace: string): void {
    this.namespace = namespace
  }

  /**
   * Get the current namespace (if any).
   */
  getNamespace(): string | undefined {
    return this.namespace
  }

  /**
   * Get the index directory path.
   * Returns namespaced path if namespace is set, otherwise legacy path.
   */
  private getIndexDir(): string {
    if (this.namespace) {
      return getNamespaceDir(this.rootPath, this.namespace)
    }
    return path.join(this.rootPath, INDEX_DIR)
  }

  /**
   * Get the vector index file path.
   */
  private getVectorPath(): string {
    if (this.namespace) {
      return getNamespacedVectorPath(this.rootPath, this.namespace)
    }
    return path.join(this.rootPath, INDEX_DIR, VECTOR_INDEX_FILE)
  }

  /**
   * Get the metadata file path.
   */
  private getMetaPath(): string {
    if (this.namespace) {
      return getNamespacedMetaPath(this.rootPath, this.namespace)
    }
    return path.join(this.rootPath, INDEX_DIR, VECTOR_META_FILE)
  }

  private ensureIndex(): HierarchicalNSW.HierarchicalNSW {
    if (!this.index) {
      // Initialize with space for 10000 items, will resize as needed
      this.index = new HierarchicalNSW.HierarchicalNSW(
        'cosine',
        this.dimensions,
      )
      // Use configured HNSW parameters (M, efConstruction, randomSeed)
      this.index.initIndex(10000, this.hnswM, this.hnswEfConstruction, 100)
    }
    return this.index
  }

  add(entries: VectorEntry[]): Effect.Effect<void, VectorStoreError> {
    return Effect.try({
      try: () => {
        const index = this.ensureIndex()

        for (const entry of entries) {
          // Skip if already exists
          if (this.idToIndex.has(entry.id)) {
            continue
          }

          const idx = this.nextIndex++

          // Resize if needed
          if (idx >= index.getMaxElements()) {
            index.resizeIndex(index.getMaxElements() * 2)
          }

          index.addPoint(entry.embedding as number[], idx)
          this.entries.set(idx, entry)
          this.idToIndex.set(entry.id, idx)
        }
      },
      catch: (e) =>
        new VectorStoreError({
          operation: 'add',
          message: e instanceof Error ? e.message : String(e),
          cause: e,
        }),
    })
  }

  search(
    vector: number[],
    limit: number,
    threshold = 0,
    options?: VectorSearchOptions,
  ): Effect.Effect<VectorSearchResult[], VectorStoreError> {
    return Effect.try({
      try: () => {
        if (!this.index || this.entries.size === 0) {
          return []
        }

        // Set efSearch if provided (controls recall/speed tradeoff)
        if (options?.efSearch !== undefined) {
          this.index.setEf(options.efSearch)
        }

        const result = this.index.searchKnn(
          vector,
          Math.min(limit, this.entries.size),
        )
        const results: VectorSearchResult[] = []

        for (let i = 0; i < result.neighbors.length; i++) {
          const idx = result.neighbors[i]
          const distance = result.distances[i]

          if (idx === undefined || distance === undefined) {
            continue
          }

          // Convert distance to similarity (cosine distance to cosine similarity)
          // hnswlib returns 1 - cosine_similarity for cosine space
          const similarity = 1 - distance

          if (similarity < threshold) {
            continue
          }

          const entry = this.entries.get(idx)
          if (entry) {
            results.push({
              id: entry.id,
              sectionId: entry.sectionId,
              documentPath: entry.documentPath,
              heading: entry.heading,
              similarity,
            })
          }
        }

        return results
      },
      catch: (e) =>
        new VectorStoreError({
          operation: 'search',
          message: e instanceof Error ? e.message : String(e),
          cause: e,
        }),
    })
  }

  searchWithStats(
    vector: number[],
    limit: number,
    threshold = 0,
    options?: VectorSearchOptions,
  ): Effect.Effect<VectorSearchResultWithStats, VectorStoreError> {
    return Effect.try({
      try: () => {
        if (!this.index || this.entries.size === 0) {
          return {
            results: [],
            belowThresholdCount: 0,
            belowThresholdHighest: null,
          }
        }

        // Set efSearch if provided (controls recall/speed tradeoff)
        if (options?.efSearch !== undefined) {
          this.index.setEf(options.efSearch)
        }

        const result = this.index.searchKnn(
          vector,
          Math.min(limit, this.entries.size),
        )
        const results: VectorSearchResult[] = []
        let belowThresholdCount = 0
        let belowThresholdHighest: number | null = null

        for (let i = 0; i < result.neighbors.length; i++) {
          const idx = result.neighbors[i]
          const distance = result.distances[i]

          if (idx === undefined || distance === undefined) {
            continue
          }

          // Convert distance to similarity (cosine distance to cosine similarity)
          // hnswlib returns 1 - cosine_similarity for cosine space
          const similarity = 1 - distance

          const entry = this.entries.get(idx)
          if (!entry) continue

          if (similarity < threshold) {
            // Track below-threshold stats
            belowThresholdCount++
            if (
              belowThresholdHighest === null ||
              similarity > belowThresholdHighest
            ) {
              belowThresholdHighest = similarity
            }
            continue
          }

          results.push({
            id: entry.id,
            sectionId: entry.sectionId,
            documentPath: entry.documentPath,
            heading: entry.heading,
            similarity,
          })
        }

        return {
          results,
          belowThresholdCount,
          belowThresholdHighest,
        }
      },
      catch: (e) =>
        new VectorStoreError({
          operation: 'search',
          message: e instanceof Error ? e.message : String(e),
          cause: e,
        }),
    })
  }

  save(): Effect.Effect<void, VectorStoreError> {
    return Effect.gen(
      function* (this: HnswVectorStore) {
        if (!this.index) {
          return
        }

        const indexDir = this.getIndexDir()
        yield* Effect.tryPromise({
          try: () => fs.mkdir(indexDir, { recursive: true }),
          catch: (e) =>
            new VectorStoreError({
              operation: 'save',
              message: `Failed to create directory: ${e instanceof Error ? e.message : String(e)}`,
              cause: e,
            }),
        })

        // Save the hnswlib index
        yield* Effect.tryPromise({
          try: () => this.index!.writeIndex(this.getVectorPath()),
          catch: (e) =>
            new VectorStoreError({
              operation: 'save',
              message: `Failed to write index: ${e instanceof Error ? e.message : String(e)}`,
              cause: e,
            }),
        })

        // Save metadata
        const meta: VectorIndex = {
          version: INDEX_VERSION,
          provider: this.provider,
          providerModel: this.providerModel,
          providerBaseURL: this.providerBaseURL,
          dimensions: this.dimensions,
          entries: Object.fromEntries(
            Array.from(this.entries.entries()).map(([idx, entry]) => [
              idx.toString(),
              entry,
            ]),
          ),
          totalCost: this.totalCost,
          totalTokens: this.totalTokens,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // Store HNSW build parameters for validation on load
          hnswParams: {
            m: this.hnswM,
            efConstruction: this.hnswEfConstruction,
          },
        }

        yield* Effect.tryPromise({
          try: async () => {
            // Size validation
            const estimatedSize = this.entries.size * 15000
            if (estimatedSize > 100_000_000) {
              console.warn(
                `Large metadata detected: ~${(estimatedSize / 1e6).toFixed(0)}MB. ` +
                  `Consider indexing subdirectories separately.`,
              )
            }

            // Encode with MessagePack and write
            const encoded = msgpack.encode(meta)
            await fs.writeFile(this.getMetaPath(), encoded)
          },
          catch: (e) =>
            new VectorStoreError({
              operation: 'save',
              message: `Failed to write metadata: ${e instanceof Error ? e.message : String(e)}`,
              cause: e,
            }),
        })
      }.bind(this),
    )
  }

  load(): Effect.Effect<
    VectorStoreLoadResult,
    VectorStoreError | DimensionMismatchError
  > {
    return Effect.gen(
      function* (this: HnswVectorStore) {
        const vectorPath = this.getVectorPath()
        const metaPath = this.getMetaPath()

        // Check if files exist - catch file not found gracefully
        // For metadata, check both binary (.bin) and JSON (.json) for migration
        const filesExist = yield* Effect.tryPromise({
          try: async () => {
            await fs.access(vectorPath)
            // Check if either binary or JSON metadata exists
            try {
              await fs.access(metaPath)
              return true
            } catch {
              const jsonPath = metaPath.replace('.bin', '.json')
              await fs.access(jsonPath)
              return true
            }
          },
          catch: () =>
            new VectorStoreError({
              operation: 'load',
              message: 'Files not found',
            }),
        }).pipe(
          Effect.catchTag('VectorStoreError', () => Effect.succeed(false)),
        )

        if (!filesExist) {
          return { loaded: false }
        }

        // Load metadata - try binary first, fall back to JSON for migration
        const loadedMeta = yield* Effect.tryPromise({
          try: async () => {
            // Try binary format first (new)
            try {
              await fs.access(metaPath)
              const buffer = await fs.readFile(metaPath)
              return msgpack.decode(buffer) as VectorIndex
            } catch {
              // Fall back to JSON for migration (old)
              const jsonPath = metaPath.replace('.bin', '.json')
              try {
                await fs.access(jsonPath)
                const json = await fs.readFile(jsonPath, 'utf-8')
                const meta = JSON.parse(json) as VectorIndex

                // Auto-migrate to binary format (safe for concurrent access)
                try {
                  const encoded = msgpack.encode(meta)
                  await fs.writeFile(metaPath, encoded)

                  // Remove old JSON file (ignore errors if already deleted by another process)
                  await fs.unlink(jsonPath).catch(() => {})
                } catch {
                  // Migration failed, but we have the data - continue
                }

                return meta
              } catch {
                throw new Error('Metadata file not found')
              }
            }
          },
          catch: (e) =>
            new VectorStoreError({
              operation: 'load',
              message: `Failed to read metadata: ${e instanceof Error ? e.message : String(e)}`,
              cause: e,
            }),
        })

        // Apply legacy index migration: default to 'openai' if provider is missing
        const meta: VectorIndex = {
          ...loadedMeta,
          provider: loadedMeta.provider || 'openai',
        }

        // Verify dimensions match - fail with clear error if mismatch
        if (meta.dimensions !== this.dimensions) {
          return yield* Effect.fail(
            new DimensionMismatchError({
              corpusDimensions: meta.dimensions,
              providerDimensions: this.dimensions,
              corpusProvider: meta.providerModel
                ? `${meta.provider}:${meta.providerModel}`
                : meta.provider,
              path: this.rootPath,
            }),
          )
        }

        // Load the hnswlib index
        this.index = new HierarchicalNSW.HierarchicalNSW(
          'cosine',
          this.dimensions,
        )
        yield* Effect.tryPromise({
          try: () => this.index!.readIndex(vectorPath),
          catch: (e) =>
            new VectorStoreError({
              operation: 'load',
              message: `Failed to read index: ${e instanceof Error ? e.message : String(e)}`,
              cause: e,
            }),
        })

        // Restore entries
        this.entries.clear()
        this.idToIndex.clear()
        this.nextIndex = 0

        for (const [idxStr, entry] of Object.entries(meta.entries)) {
          const idx = parseInt(idxStr, 10)
          this.entries.set(idx, entry)
          this.idToIndex.set(entry.id, idx)
          this.nextIndex = Math.max(this.nextIndex, idx + 1)
        }

        this.provider = meta.provider
        this.providerModel = meta.providerModel
        this.providerBaseURL = meta.providerBaseURL
        this.totalCost = meta.totalCost
        this.totalTokens = meta.totalTokens

        // Check for HNSW parameter mismatch
        let hnswMismatch: HnswMismatchWarning | undefined
        if (meta.hnswParams) {
          const indexM = meta.hnswParams.m
          const indexEf = meta.hnswParams.efConstruction
          if (indexM !== this.hnswM || indexEf !== this.hnswEfConstruction) {
            hnswMismatch = {
              configParams: {
                m: this.hnswM,
                efConstruction: this.hnswEfConstruction,
              },
              indexParams: { m: indexM, efConstruction: indexEf },
            }
          }
        }

        return { loaded: true, hnswMismatch }
      }.bind(this),
    )
  }

  getStats(): VectorStoreStats {
    return {
      count: this.entries.size,
      dimensions: this.dimensions,
      provider: this.provider,
      providerModel: this.providerModel,
      totalCost: this.totalCost,
      totalTokens: this.totalTokens,
    }
  }

  setProvider(name: string, model?: string, baseURL?: string): void {
    this.provider = name
    this.providerModel = model
    this.providerBaseURL = baseURL
  }

  addCost(cost: number, tokens: number): void {
    this.totalCost += cost
    this.totalTokens += tokens
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * HNSW build parameters for index construction.
 * These affect index quality and build time - changes require index rebuild.
 */
export interface HnswBuildOptions {
  /** Max connections per node (default: 16). Higher = better recall, larger index. */
  readonly m?: number | undefined
  /** Construction-time search width (default: 200). Higher = better quality, slower builds. */
  readonly efConstruction?: number | undefined
}

/**
 * Create a vector store for the given root path.
 *
 * @param rootPath - Root directory containing the index
 * @param dimensions - Embedding dimensions
 * @param hnswOptions - Optional HNSW build parameters
 * @returns A new VectorStore instance
 */
export const createVectorStore = (
  rootPath: string,
  dimensions: number,
  hnswOptions?: HnswBuildOptions,
): VectorStore => new HnswVectorStore(rootPath, dimensions, hnswOptions)

/**
 * Create a namespaced vector store for a specific provider/model.
 *
 * Uses the new namespaced storage structure:
 * .mdcontext/embeddings/{provider}_{model}_{dimensions}/vectors.bin
 *
 * @param rootPath - Root directory containing the index
 * @param provider - Provider name (e.g., "openai", "voyage")
 * @param model - Model name (e.g., "text-embedding-3-small")
 * @param dimensions - Embedding dimensions
 * @param hnswOptions - Optional HNSW build parameters
 * @returns A new VectorStore instance with namespace set
 */
export const createNamespacedVectorStore = (
  rootPath: string,
  provider: string,
  model: string,
  dimensions: number,
  hnswOptions?: HnswBuildOptions,
): VectorStore => {
  const namespace = generateNamespace(provider, model, dimensions)
  const store = new HnswVectorStore(rootPath, dimensions, hnswOptions)
  store.setNamespace(namespace)
  return store
}

// Export the class for type access
export { HnswVectorStore }
