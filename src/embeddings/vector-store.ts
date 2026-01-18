/**
 * Vector store using hnswlib-node
 */

import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import HierarchicalNSW from "hnswlib-node";

import type { VectorEntry, VectorIndex } from "./types.js";
import { INDEX_DIR } from "../index/types.js";

// ============================================================================
// Constants
// ============================================================================

const VECTOR_INDEX_FILE = "vectors.bin";
const VECTOR_META_FILE = "vectors.meta.json";
const INDEX_VERSION = 1;

// ============================================================================
// Vector Store
// ============================================================================

export interface VectorStore {
  readonly rootPath: string;
  readonly dimensions: number;
  add(entries: VectorEntry[]): Effect.Effect<void, Error>;
  search(vector: number[], limit: number, threshold?: number): Effect.Effect<VectorSearchResult[], Error>;
  save(): Effect.Effect<void, Error>;
  load(): Effect.Effect<boolean, Error>;
  getStats(): VectorStoreStats;
}

export interface VectorSearchResult {
  readonly id: string;
  readonly sectionId: string;
  readonly documentPath: string;
  readonly heading: string;
  readonly similarity: number;
}

export interface VectorStoreStats {
  readonly count: number;
  readonly dimensions: number;
  readonly provider: string;
  readonly totalCost: number;
  readonly totalTokens: number;
}

// ============================================================================
// Implementation
// ============================================================================

class HnswVectorStore implements VectorStore {
  readonly rootPath: string;
  readonly dimensions: number;

  private index: HierarchicalNSW.HierarchicalNSW | null = null;
  private entries: Map<number, VectorEntry> = new Map();
  private idToIndex: Map<string, number> = new Map();
  private nextIndex = 0;
  private provider = "unknown";
  private totalCost = 0;
  private totalTokens = 0;

  constructor(rootPath: string, dimensions: number) {
    this.rootPath = path.resolve(rootPath);
    this.dimensions = dimensions;
  }

  private getIndexDir(): string {
    return path.join(this.rootPath, INDEX_DIR);
  }

  private getVectorPath(): string {
    return path.join(this.getIndexDir(), VECTOR_INDEX_FILE);
  }

  private getMetaPath(): string {
    return path.join(this.getIndexDir(), VECTOR_META_FILE);
  }

  private ensureIndex(): HierarchicalNSW.HierarchicalNSW {
    if (!this.index) {
      // Initialize with space for 10000 items, will resize as needed
      this.index = new HierarchicalNSW.HierarchicalNSW("cosine", this.dimensions);
      this.index.initIndex(10000, 16, 200, 100);
    }
    return this.index;
  }

  add(entries: VectorEntry[]): Effect.Effect<void, Error> {
    return Effect.sync(() => {
      const index = this.ensureIndex();

      for (const entry of entries) {
        // Skip if already exists
        if (this.idToIndex.has(entry.id)) {
          continue;
        }

        const idx = this.nextIndex++;

        // Resize if needed
        if (idx >= index.getMaxElements()) {
          index.resizeIndex(index.getMaxElements() * 2);
        }

        index.addPoint(entry.embedding as number[], idx);
        this.entries.set(idx, entry);
        this.idToIndex.set(entry.id, idx);
      }
    });
  }

  search(
    vector: number[],
    limit: number,
    threshold = 0
  ): Effect.Effect<VectorSearchResult[], Error> {
    return Effect.sync(() => {
      if (!this.index || this.entries.size === 0) {
        return [];
      }

      const result = this.index.searchKnn(vector, Math.min(limit, this.entries.size));
      const results: VectorSearchResult[] = [];

      for (let i = 0; i < result.neighbors.length; i++) {
        const idx = result.neighbors[i];
        const distance = result.distances[i];

        if (idx === undefined || distance === undefined) {
          continue;
        }

        // Convert distance to similarity (cosine distance to cosine similarity)
        // hnswlib returns 1 - cosine_similarity for cosine space
        const similarity = 1 - distance;

        if (similarity < threshold) {
          continue;
        }

        const entry = this.entries.get(idx);
        if (entry) {
          results.push({
            id: entry.id,
            sectionId: entry.sectionId,
            documentPath: entry.documentPath,
            heading: entry.heading,
            similarity,
          });
        }
      }

      return results;
    });
  }

  save(): Effect.Effect<void, Error> {
    return Effect.gen(function* (this: HnswVectorStore) {
      if (!this.index) {
        return;
      }

      const indexDir = this.getIndexDir();
      yield* Effect.promise(() => fs.mkdir(indexDir, { recursive: true }));

      // Save the hnswlib index
      yield* Effect.promise(() =>
        this.index!.writeIndex(this.getVectorPath())
      );

      // Save metadata
      const meta: VectorIndex = {
        version: INDEX_VERSION,
        provider: this.provider,
        dimensions: this.dimensions,
        entries: Object.fromEntries(
          Array.from(this.entries.entries()).map(([idx, entry]) => [
            idx.toString(),
            entry,
          ])
        ),
        totalCost: this.totalCost,
        totalTokens: this.totalTokens,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      yield* Effect.promise(() =>
        fs.writeFile(this.getMetaPath(), JSON.stringify(meta, null, 2))
      );
    }.bind(this));
  }

  load(): Effect.Effect<boolean, Error> {
    return Effect.gen(function* (this: HnswVectorStore) {
      const vectorPath = this.getVectorPath();
      const metaPath = this.getMetaPath();

      // Check if files exist
      const filesExist = yield* Effect.tryPromise({
        try: async () => {
          await fs.access(vectorPath);
          await fs.access(metaPath);
          return true;
        },
        catch: () => false as const,
      }).pipe(Effect.catchAll(() => Effect.succeed(false)));

      if (!filesExist) {
        return false;
      }

      // Load metadata first
      const metaContent = yield* Effect.promise(() =>
        fs.readFile(metaPath, "utf-8")
      );
      const meta = JSON.parse(metaContent) as VectorIndex;

      // Verify dimensions match
      if (meta.dimensions !== this.dimensions) {
        return false;
      }

      // Load the hnswlib index
      this.index = new HierarchicalNSW.HierarchicalNSW("cosine", this.dimensions);
      yield* Effect.promise(() => this.index!.readIndex(vectorPath));

      // Restore entries
      this.entries.clear();
      this.idToIndex.clear();
      this.nextIndex = 0;

      for (const [idxStr, entry] of Object.entries(meta.entries)) {
        const idx = parseInt(idxStr, 10);
        this.entries.set(idx, entry);
        this.idToIndex.set(entry.id, idx);
        this.nextIndex = Math.max(this.nextIndex, idx + 1);
      }

      this.provider = meta.provider;
      this.totalCost = meta.totalCost;
      this.totalTokens = meta.totalTokens;

      return true;
    }.bind(this));
  }

  getStats(): VectorStoreStats {
    return {
      count: this.entries.size,
      dimensions: this.dimensions,
      provider: this.provider,
      totalCost: this.totalCost,
      totalTokens: this.totalTokens,
    };
  }

  setProvider(name: string): void {
    this.provider = name;
  }

  addCost(cost: number, tokens: number): void {
    this.totalCost += cost;
    this.totalTokens += tokens;
  }
}

// ============================================================================
// Factory
// ============================================================================

export const createVectorStore = (
  rootPath: string,
  dimensions: number
): VectorStore => new HnswVectorStore(rootPath, dimensions);

// Export the class for type access
export { HnswVectorStore };
