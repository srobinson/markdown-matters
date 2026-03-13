/**
 * BM25 Index Store for keyword search
 *
 * Uses wink-bm25-text-search for efficient keyword matching.
 * Index is persisted to .mdm/bm25.json for fast startup.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import bm25 from 'wink-bm25-text-search'
import { FileReadError, FileWriteError } from '../errors/index.js'
import { INDEX_DIR } from '../index/types.js'

// ============================================================================
// Types
// ============================================================================

export interface BM25Document {
  readonly id: string
  readonly sectionId: string
  readonly documentPath: string
  readonly heading: string
  readonly content: string
}

export interface BM25SearchResult {
  readonly sectionId: string
  readonly documentPath: string
  readonly heading: string
  readonly score: number
  readonly rank: number
}

export interface BM25Stats {
  readonly count: number
  readonly lastUpdated: string
}

interface BM25Metadata {
  readonly version: number
  readonly count: number
  readonly lastUpdated: string
}

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
 * Create a BM25 store for keyword search
 */
export const createBM25Store = (rootPath: string): BM25Store => {
  const resolvedRoot = path.resolve(rootPath)
  const indexPath = path.join(resolvedRoot, INDEX_DIR, 'bm25.json')
  const metadataPath = path.join(resolvedRoot, INDEX_DIR, 'bm25.meta.json')

  // Store mapping from internal index to section info
  const sectionMap: Map<
    number,
    { sectionId: string; documentPath: string; heading: string }
  > = new Map()
  let documentCount = 0
  let consolidated = false
  let lastUpdated = new Date().toISOString()

  // Create BM25 engine
  let engine = bm25()

  // Configure with weights for heading vs content
  engine.defineConfig({
    fldWeights: {
      heading: 2,
      content: 1,
    },
  })

  // Define tokenization
  engine.definePrepTasks([tokenize])

  return {
    add(docs: readonly BM25Document[]): Effect.Effect<void, never> {
      return Effect.sync(() => {
        for (const doc of docs) {
          const idx = documentCount++
          sectionMap.set(idx, {
            sectionId: doc.sectionId,
            documentPath: doc.documentPath,
            heading: doc.heading,
          })
          engine.addDoc(
            {
              heading: doc.heading,
              content: doc.content,
            },
            idx,
          )
        }
        consolidated = false
        lastUpdated = new Date().toISOString()
      })
    },

    consolidate(): Effect.Effect<void, never> {
      return Effect.sync(() => {
        if (!consolidated && documentCount > 0) {
          engine.consolidate()
          consolidated = true
        }
      })
    },

    search(
      query: string,
      limit = 10,
    ): Effect.Effect<readonly BM25SearchResult[], never> {
      return Effect.sync(() => {
        if (!consolidated || documentCount === 0) {
          return []
        }

        const results = engine.search(query, limit) as [number, number][]

        return results.map(([idx, score], rank) => {
          const info = sectionMap.get(idx)
          return {
            sectionId: info?.sectionId ?? '',
            documentPath: info?.documentPath ?? '',
            heading: info?.heading ?? '',
            score,
            rank: rank + 1,
          }
        })
      })
    },

    save(): Effect.Effect<void, FileWriteError> {
      return Effect.gen(function* () {
        // Export BM25 index
        const jsonModel = engine.exportJSON()

        // Save section map as array for JSON serialization
        const sectionMapArray = Array.from(sectionMap.entries())

        const data = {
          engine: jsonModel,
          sectionMap: sectionMapArray,
        }

        const metadata: BM25Metadata = {
          version: 1,
          count: documentCount,
          lastUpdated,
        }

        yield* Effect.tryPromise({
          try: async () => {
            await fs.writeFile(indexPath, JSON.stringify(data), 'utf-8')
            await fs.writeFile(
              metadataPath,
              JSON.stringify(metadata, null, 2),
              'utf-8',
            )
          },
          catch: (e) =>
            new FileWriteError({
              path: indexPath,
              message: `Failed to save BM25 index: ${e instanceof Error ? e.message : String(e)}`,
            }),
        })
      })
    },

    load(): Effect.Effect<boolean, FileReadError> {
      return Effect.gen(function* () {
        // Check if index exists
        const exists = yield* Effect.promise(async () => {
          try {
            await fs.access(indexPath)
            return true
          } catch {
            return false
          }
        })

        if (!exists) {
          return false
        }

        // Load data
        const [dataStr, metaStr] = yield* Effect.tryPromise({
          try: async () => {
            const data = await fs.readFile(indexPath, 'utf-8')
            const meta = await fs.readFile(metadataPath, 'utf-8')
            return [data, meta] as const
          },
          catch: (e) =>
            new FileReadError({
              path: indexPath,
              message: `Failed to load BM25 index: ${e instanceof Error ? e.message : String(e)}`,
            }),
        })

        const data = JSON.parse(dataStr) as {
          engine: string
          sectionMap: [
            number,
            { sectionId: string; documentPath: string; heading: string },
          ][]
        }
        const metadata = JSON.parse(metaStr) as BM25Metadata

        // Restore engine
        engine = bm25()
        engine.importJSON(data.engine)
        engine.definePrepTasks([tokenize])

        // Restore section map
        sectionMap.clear()
        for (const [idx, info] of data.sectionMap) {
          sectionMap.set(idx, info)
        }

        documentCount = metadata.count
        lastUpdated = metadata.lastUpdated
        consolidated = true

        return true
      })
    },

    getStats(): BM25Stats {
      return {
        count: documentCount,
        lastUpdated,
      }
    },

    isConsolidated(): boolean {
      return consolidated
    },

    clear(): void {
      engine = bm25()
      engine.defineConfig({
        fldWeights: {
          heading: 2,
          content: 1,
        },
      })
      engine.definePrepTasks([tokenize])
      sectionMap.clear()
      documentCount = 0
      consolidated = false
      lastUpdated = new Date().toISOString()
    },
  }
}

// ============================================================================
// BM25 Search Function
// ============================================================================

/**
 * Perform BM25 keyword search over indexed sections.
 *
 * @param rootPath - Root directory containing BM25 index
 * @param query - Search query text
 * @param limit - Maximum results (default: 10)
 * @returns Ranked list of matching sections by BM25 score
 */
export const bm25Search = (
  rootPath: string,
  query: string,
  limit = 10,
): Effect.Effect<readonly BM25SearchResult[], FileReadError> =>
  Effect.gen(function* () {
    const store = createBM25Store(rootPath)
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
export const bm25IndexExists = (rootPath: string): Effect.Effect<boolean> =>
  Effect.promise(async () => {
    const resolvedRoot = path.resolve(rootPath)
    const indexPath = path.join(resolvedRoot, INDEX_DIR, 'bm25.json')

    try {
      await fs.access(indexPath)
      return true
    } catch {
      return false
    }
  })
