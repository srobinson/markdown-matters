/**
 * Vector store using hnswlib-node
 *
 * Supports flat and namespaced database storage layouts:
 * - Flat: vectors.bin, vectors.meta.bin
 * - Namespaced: embeddings/{namespace}/vectors.bin, vectors.meta.bin
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import HierarchicalNSW from 'hnswlib-node'
import { CANONICAL_SCHEMA_VERSION } from '../db/canonical.js'
import { DimensionMismatchError, VectorStoreError } from '../errors/index.js'
import { dbIndexDir } from '../home.js'
import {
  generateNamespace,
  getNamespaceDir,
  getMetaPath as getNamespacedMetaPath,
  getVectorPath as getNamespacedVectorPath,
} from './embedding-namespace.js'
import type { VectorEntry, VectorIndex } from './types.js'
import { loadVectorIndex, writeVectorIndex } from './vector-store-codec.js'
import type {
  HnswBuildOptions,
  HnswMismatchWarning,
  VectorSearchOptions,
  VectorSearchResult,
  VectorSearchResultWithStats,
  VectorStore,
  VectorStoreLoadResult,
  VectorStoreStats,
} from './vector-store-types.js'

export type {
  HnswBuildOptions,
  HnswMismatchWarning,
  VectorSearchOptions,
  VectorSearchResult,
  VectorSearchResultWithStats,
  VectorStore,
  VectorStoreLoadResult,
  VectorStoreStats,
} from './vector-store-types.js'

// ============================================================================
// Constants
// ============================================================================

const VECTOR_INDEX_FILE = 'vectors.bin'
const VECTOR_META_FILE = 'vectors.meta.bin'

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
    indexRoot: string,
    dimensions: number,
    hnswOptions?: HnswBuildOptions,
  ) {
    this.rootPath = dbIndexDir(indexRoot)
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
   * Returns the namespaced path when set, otherwise the database root.
   */
  private getIndexDir(): string {
    if (this.namespace) {
      return getNamespaceDir(this.rootPath, this.namespace)
    }
    return dbIndexDir(this.rootPath)
  }

  /**
   * Get the vector index file path.
   */
  private getVectorPath(): string {
    if (this.namespace) {
      return getNamespacedVectorPath(this.rootPath, this.namespace)
    }
    return path.join(dbIndexDir(this.rootPath), VECTOR_INDEX_FILE)
  }

  /**
   * Get the metadata file path.
   */
  private getMetaPath(): string {
    if (this.namespace) {
      return getNamespacedMetaPath(this.rootPath, this.namespace)
    }
    return path.join(dbIndexDir(this.rootPath), VECTOR_META_FILE)
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
          version: CANONICAL_SCHEMA_VERSION,
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

            await writeVectorIndex(this.getMetaPath(), meta)
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

        // Check if files exist and treat an absent index as empty.
        const filesExist = yield* Effect.tryPromise({
          try: async () => {
            await fs.access(vectorPath)
            await fs.access(metaPath)
            return true
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

        const meta = yield* loadVectorIndex(metaPath)

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

  getEmbeddedIds(): Set<string> {
    return new Set(this.idToIndex.keys())
  }

  getEmbeddedDocumentHashes(): ReadonlyMap<string, string> {
    return new Map(
      [...this.entries.values()].map((entry) => [entry.id, entry.documentHash]),
    )
  }

  removeEntries(ids: string[]): Effect.Effect<void, VectorStoreError> {
    return Effect.try({
      try: () => {
        for (const id of ids) {
          const idx = this.idToIndex.get(id)
          if (idx !== undefined && this.index) {
            this.index.markDelete(idx)
            this.entries.delete(idx)
            this.idToIndex.delete(id)
          }
        }
      },
      catch: (e) =>
        new VectorStoreError({
          operation: 'removeEntries',
          message: e instanceof Error ? e.message : String(e),
          cause: e,
        }),
    })
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

/**
 * Create a vector store for the given root path.
 *
 * @param indexRoot - Explicit index root
 * @param dimensions - Embedding dimensions
 * @param hnswOptions - Optional HNSW build parameters
 * @returns A new VectorStore instance
 */
export const createVectorStore = (
  indexRoot: string,
  dimensions: number,
  hnswOptions?: HnswBuildOptions,
): VectorStore => new HnswVectorStore(indexRoot, dimensions, hnswOptions)

/**
 * Create a namespaced vector store for a specific provider/model.
 *
 * Uses the new namespaced storage structure:
 * embeddings/{provider}_{model}_{dimensions}/vectors.bin
 *
 * @param indexRoot - Explicit index root
 * @param provider - Provider name (e.g., "openai", "voyage")
 * @param model - Model name (e.g., "text-embedding-3-small")
 * @param dimensions - Embedding dimensions
 * @param hnswOptions - Optional HNSW build parameters
 * @returns A new VectorStore instance with namespace set
 */
export const createNamespacedVectorStore = (
  indexRoot: string,
  provider: string,
  model: string,
  dimensions: number,
  hnswOptions?: HnswBuildOptions,
): VectorStore => {
  const namespace = generateNamespace(provider, model, dimensions)
  const store = new HnswVectorStore(indexRoot, dimensions, hnswOptions)
  store.setNamespace(namespace)
  return store
}

// Export the class for type access
export { HnswVectorStore }
