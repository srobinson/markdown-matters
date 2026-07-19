/**
 * BM25 Index Store for keyword search
 *
 * Uses wink-bm25-text-search for efficient keyword matching.
 * Index is persisted to bm25.json under the explicit index root.
 */

import * as fs from 'node:fs/promises'
import { Effect, Schema } from 'effect'
import bm25 from 'wink-bm25-text-search'
import {
  CANONICAL_SCHEMA_VERSION,
  type DocumentKey,
  DocumentKeySchema,
} from '../db/canonical.js'
import { FileReadError, FileWriteError } from '../errors/index.js'
import { getIndexPaths } from '../index/types.js'

// ============================================================================
// Types
// ============================================================================

export interface BM25Document {
  readonly id: string
  readonly sectionId: string
  readonly documentPath: DocumentKey
  readonly heading: string
  readonly content: string
}

export interface BM25SearchResult {
  readonly sectionId: string
  readonly documentPath: DocumentKey
  readonly heading: string
  readonly score: number
  readonly rank: number
}

export interface BM25Stats {
  readonly count: number
  readonly lastUpdated: string
}

interface BM25Metadata {
  readonly version: typeof CANONICAL_SCHEMA_VERSION
  readonly count: number
  readonly lastUpdated: string
}

interface BM25SectionInfo {
  readonly sectionId: string
  readonly documentPath: DocumentKey
  readonly heading: string
}

const BM25SectionInfoSchema = Schema.Struct({
  sectionId: Schema.String,
  documentPath: DocumentKeySchema,
  heading: Schema.String,
})

const BM25IndexSchema = Schema.Struct({
  version: Schema.Literal(CANONICAL_SCHEMA_VERSION),
  engine: Schema.String,
  sectionMap: Schema.Array(Schema.Tuple(Schema.Number, BM25SectionInfoSchema)),
})

const BM25MetadataSchema = Schema.Struct({
  version: Schema.Literal(CANONICAL_SCHEMA_VERSION),
  count: Schema.Number,
  lastUpdated: Schema.String,
})

const decodeStoredJson = <A, I>(
  content: string,
  schema: Schema.Schema<A, I>,
  filePath: string,
): Effect.Effect<A, FileReadError> =>
  Effect.try({
    try: () => JSON.parse(content) as unknown,
    catch: (cause) =>
      new FileReadError({
        path: filePath,
        message: `Invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknown(schema)),
    Effect.mapError((cause) =>
      cause instanceof FileReadError
        ? cause
        : new FileReadError({
            path: filePath,
            message: `Schema validation failed: ${String(cause)}`,
            cause,
          }),
    ),
  )

// ============================================================================
// Text Preparation
// ============================================================================

/**
 * Simple tokenizer: lowercase, split on non-word chars, filter short tokens
 */
const tokenize = (text: string): string[] => {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length > 2)
}

// ============================================================================
// BM25 Store
// ============================================================================

export interface BM25Store {
  /**
   * Add documents to the index
   */
  add(docs: readonly BM25Document[]): Effect.Effect<void, never>

  /**
   * Consolidate the index (must be called after adding docs, before search)
   */
  consolidate(): Effect.Effect<void, never>

  /**
   * Search for matching documents
   */
  search(
    query: string,
    limit?: number,
  ): Effect.Effect<readonly BM25SearchResult[], never>

  /**
   * Save the index to disk
   */
  save(): Effect.Effect<void, FileWriteError>

  /**
   * Load the index from disk
   * @returns true if loaded successfully, false if no index exists
   */
  load(): Effect.Effect<boolean, FileReadError>

  /**
   * Get index statistics
   */
  getStats(): BM25Stats

  /**
   * Check if the index has been consolidated
   */
  isConsolidated(): boolean

  /**
   * Clear the index
   */
  clear(): void
}

/**
 * Build a configured BM25 engine. Loading replaces its model but retains the
 * same tokenizer contract.
 */
type BM25Engine = ReturnType<typeof bm25>

const createEngine = (): BM25Engine => {
  const engine = bm25()
  engine.defineConfig({
    fldWeights: {
      heading: 2,
      content: 1,
    },
  })
  engine.definePrepTasks([tokenize])
  return engine
}

class BM25StoreImpl implements BM25Store {
  private readonly indexPath: string
  private readonly metadataPath: string
  private readonly sectionMap = new Map<number, BM25SectionInfo>()
  private documentCount = 0
  private consolidated = false
  private lastUpdated = new Date().toISOString()
  private engine = createEngine()

  constructor(indexRoot: string) {
    const paths = getIndexPaths(indexRoot)
    this.indexPath = paths.bm25
    this.metadataPath = paths.bm25Metadata
  }

  add(docs: readonly BM25Document[]): Effect.Effect<void, never> {
    return Effect.sync(() => {
      for (const doc of docs) {
        const idx = this.documentCount++
        this.sectionMap.set(idx, {
          sectionId: doc.sectionId,
          documentPath: doc.documentPath,
          heading: doc.heading,
        })
        this.engine.addDoc({ heading: doc.heading, content: doc.content }, idx)
      }
      this.consolidated = false
      this.lastUpdated = new Date().toISOString()
    })
  }

  consolidate(): Effect.Effect<void, never> {
    return Effect.sync(() => {
      if (!this.consolidated && this.documentCount > 0) {
        this.engine.consolidate()
        this.consolidated = true
      }
    })
  }

  search(
    query: string,
    limit = 10,
  ): Effect.Effect<readonly BM25SearchResult[], never> {
    return Effect.sync(() => {
      if (!this.consolidated || this.documentCount === 0) return []
      const results = this.engine.search(query, limit) as [
        string | number,
        number,
      ][]
      return results.flatMap(([idx, score], rank) => {
        const info = this.sectionMap.get(Number(idx))
        return info
          ? [
              {
                sectionId: info.sectionId,
                documentPath: info.documentPath,
                heading: info.heading,
                score,
                rank: rank + 1,
              },
            ]
          : []
      })
    })
  }

  save(): Effect.Effect<void, FileWriteError> {
    const data = {
      version: CANONICAL_SCHEMA_VERSION,
      engine: this.engine.exportJSON(),
      sectionMap: Array.from(this.sectionMap.entries()),
    }
    const metadata: BM25Metadata = {
      version: CANONICAL_SCHEMA_VERSION,
      count: this.documentCount,
      lastUpdated: this.lastUpdated,
    }
    return Effect.tryPromise({
      try: async () => {
        await fs.writeFile(this.indexPath, JSON.stringify(data), 'utf-8')
        await fs.writeFile(
          this.metadataPath,
          JSON.stringify(metadata, null, 2),
          'utf-8',
        )
      },
      catch: (cause) =>
        new FileWriteError({
          path: this.indexPath,
          message: `Failed to save BM25 index: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    })
  }

  load(): Effect.Effect<boolean, FileReadError> {
    const store = this
    return Effect.gen(function* () {
      if (!(yield* store.indexExists())) return false
      const [dataStr, metaStr] = yield* store.readStoredFiles()
      const data = yield* decodeStoredJson(
        dataStr,
        BM25IndexSchema,
        store.indexPath,
      )
      const metadata = yield* decodeStoredJson(
        metaStr,
        BM25MetadataSchema,
        store.metadataPath,
      )

      store.engine = createEngine()
      store.engine.importJSON(data.engine)
      store.sectionMap.clear()
      for (const [idx, info] of data.sectionMap) {
        store.sectionMap.set(idx, info)
      }
      store.documentCount = metadata.count
      store.lastUpdated = metadata.lastUpdated
      store.consolidated = true
      return true
    })
  }

  getStats(): BM25Stats {
    return { count: this.documentCount, lastUpdated: this.lastUpdated }
  }

  isConsolidated(): boolean {
    return this.consolidated
  }

  clear(): void {
    this.engine = createEngine()
    this.sectionMap.clear()
    this.documentCount = 0
    this.consolidated = false
    this.lastUpdated = new Date().toISOString()
  }

  private indexExists(): Effect.Effect<boolean> {
    return Effect.promise(async () => {
      try {
        await fs.access(this.indexPath)
        return true
      } catch {
        return false
      }
    })
  }

  private readStoredFiles(): Effect.Effect<
    readonly [string, string],
    FileReadError
  > {
    return Effect.tryPromise({
      try: () =>
        Promise.all([
          fs.readFile(this.indexPath, 'utf-8'),
          fs.readFile(this.metadataPath, 'utf-8'),
        ] as const),
      catch: (cause) =>
        new FileReadError({
          path: this.indexPath,
          message: `Failed to load BM25 index: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    })
  }
}

/** Create a BM25 store for keyword search. */
export const createBM25Store = (indexRoot: string): BM25Store =>
  new BM25StoreImpl(indexRoot)

// ============================================================================
// BM25 Search Function
// ============================================================================

/**
 * Perform BM25 keyword search over indexed sections.
 *
 * @param indexRoot - Root directory containing BM25 index
 * @param query - Search query text
 * @param limit - Maximum results (default: 10)
 * @returns Ranked list of matching sections by BM25 score
 */
export const bm25Search = (
  indexRoot: string,
  query: string,
  limit = 10,
): Effect.Effect<readonly BM25SearchResult[], FileReadError> =>
  Effect.gen(function* () {
    const store = createBM25Store(indexRoot)
    const loaded = yield* store.load()

    if (!loaded) {
      return []
    }

    return yield* store.search(query, limit)
  })

// ============================================================================
// Check BM25 Index Exists
// ============================================================================

/**
 * Check if BM25 index exists for a directory
 */
export const bm25IndexExists = (indexRoot: string): Effect.Effect<boolean> =>
  Effect.promise(async () => {
    const indexPath = getIndexPaths(indexRoot).bm25

    try {
      await fs.access(indexPath)
      return true
    } catch {
      return false
    }
  })
