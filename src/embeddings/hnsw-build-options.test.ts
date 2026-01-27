/**
 * HNSW Build Options Tests
 *
 * Tests for configurable HNSW index build parameters:
 * - M: maximum connections per node (affects recall and index size)
 * - efConstruction: construction-time search width (affects quality and build time)
 *
 * These parameters control the vector index structure and require index rebuild when changed.
 */

import * as path from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  createNamespacedVectorStore,
  createVectorStore,
  type HnswBuildOptions,
} from './vector-store.js'

// Path to test corpus with pre-built embeddings
const TEST_CORPUS_PATH = path.join(
  __dirname,
  '../__tests__/fixtures/semantic-search/multi-word-corpus',
)

// Test corpus uses 512 dimensions (text-embedding-3-small with Matryoshka reduction)
const TEST_CORPUS_DIMENSIONS = 512
const TEST_CORPUS_PROVIDER = 'openai'
const TEST_CORPUS_MODEL = 'text-embedding-3-small'

// Helper to create the namespaced vector store for test corpus
const createTestVectorStore = (hnswOptions?: HnswBuildOptions) =>
  createNamespacedVectorStore(
    TEST_CORPUS_PATH,
    TEST_CORPUS_PROVIDER,
    TEST_CORPUS_MODEL,
    TEST_CORPUS_DIMENSIONS,
    hnswOptions,
  )

describe('HNSW Build Options', () => {
  describe('HnswBuildOptions interface', () => {
    it('should accept M parameter', () => {
      const options: HnswBuildOptions = { m: 24 }
      expect(options.m).toBe(24)
    })

    it('should accept efConstruction parameter', () => {
      const options: HnswBuildOptions = { efConstruction: 256 }
      expect(options.efConstruction).toBe(256)
    })

    it('should accept both parameters', () => {
      const options: HnswBuildOptions = { m: 24, efConstruction: 256 }
      expect(options.m).toBe(24)
      expect(options.efConstruction).toBe(256)
    })

    it('should allow undefined parameters for defaults', () => {
      const options: HnswBuildOptions = {}
      expect(options.m).toBeUndefined()
      expect(options.efConstruction).toBeUndefined()
    })
  })

  describe('createVectorStore with HNSW options', () => {
    it('should create vector store without HNSW options (defaults)', () => {
      const vectorStore = createVectorStore(
        TEST_CORPUS_PATH,
        TEST_CORPUS_DIMENSIONS,
      )
      expect(vectorStore).toBeDefined()
      expect(vectorStore.dimensions).toBe(TEST_CORPUS_DIMENSIONS)
    })

    it('should create vector store with custom M parameter', () => {
      const vectorStore = createVectorStore(
        TEST_CORPUS_PATH,
        TEST_CORPUS_DIMENSIONS,
        { m: 24 },
      )
      expect(vectorStore).toBeDefined()
      expect(vectorStore.dimensions).toBe(TEST_CORPUS_DIMENSIONS)
    })

    it('should create vector store with custom efConstruction parameter', () => {
      const vectorStore = createVectorStore(
        TEST_CORPUS_PATH,
        TEST_CORPUS_DIMENSIONS,
        { efConstruction: 256 },
      )
      expect(vectorStore).toBeDefined()
      expect(vectorStore.dimensions).toBe(TEST_CORPUS_DIMENSIONS)
    })

    it('should create vector store with both custom parameters', () => {
      const vectorStore = createVectorStore(
        TEST_CORPUS_PATH,
        TEST_CORPUS_DIMENSIONS,
        { m: 24, efConstruction: 256 },
      )
      expect(vectorStore).toBeDefined()
      expect(vectorStore.dimensions).toBe(TEST_CORPUS_DIMENSIONS)
    })
  })

  describe('Recommended configurations', () => {
    it('should support speed-focused config (M=12, efConstruction=128)', () => {
      const speedOptions: HnswBuildOptions = { m: 12, efConstruction: 128 }
      const vectorStore = createVectorStore(
        TEST_CORPUS_PATH,
        TEST_CORPUS_DIMENSIONS,
        speedOptions,
      )
      expect(vectorStore).toBeDefined()
    })

    it('should support balanced config (M=16, efConstruction=200) - defaults', () => {
      // Default config - no options passed
      const vectorStore = createVectorStore(
        TEST_CORPUS_PATH,
        TEST_CORPUS_DIMENSIONS,
      )
      expect(vectorStore).toBeDefined()
    })

    it('should support quality-focused config (M=24, efConstruction=256)', () => {
      const qualityOptions: HnswBuildOptions = { m: 24, efConstruction: 256 }
      const vectorStore = createVectorStore(
        TEST_CORPUS_PATH,
        TEST_CORPUS_DIMENSIONS,
        qualityOptions,
      )
      expect(vectorStore).toBeDefined()
    })
  })

  describe('Vector store functionality with custom options', () => {
    it('should load existing index regardless of HNSW options', async () => {
      // HNSW options only affect index creation, not loading
      const vectorStore = createTestVectorStore({ m: 24, efConstruction: 256 })
      const loadResult = await Effect.runPromise(vectorStore.load())
      expect(loadResult.loaded).toBe(true)

      const stats = vectorStore.getStats()
      expect(stats.count).toBeGreaterThan(0)
    })

    it('should search after loading with custom options', async () => {
      const vectorStore = createTestVectorStore({ m: 12, efConstruction: 128 })
      await Effect.runPromise(vectorStore.load())

      const results = await Effect.runPromise(
        vectorStore.search(new Array(TEST_CORPUS_DIMENSIONS).fill(0.1), 10, 0),
      )

      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('Config schema HNSW defaults', () => {
    it('should have hnswM default of 16 in config schema', async () => {
      const { defaultConfig } = await import('../config/schema.js')
      expect(defaultConfig.embeddings.hnswM).toBe(16)
    })

    it('should have hnswEfConstruction default of 200 in config schema', async () => {
      const { defaultConfig } = await import('../config/schema.js')
      expect(defaultConfig.embeddings.hnswEfConstruction).toBe(200)
    })
  })
})

describe('BuildEmbeddingsOptions HNSW support', () => {
  it('should export BuildEmbeddingsOptions with hnswOptions field', async () => {
    const { buildEmbeddings } = await import('./semantic-search.js')
    expect(buildEmbeddings).toBeDefined()
    expect(typeof buildEmbeddings).toBe('function')
  })

  it('should accept hnswOptions in BuildEmbeddingsOptions interface', async () => {
    // Type-level test: if this compiles, the interface has the field
    type BuildEmbeddingsOptions =
      typeof import('./semantic-search.js').buildEmbeddings extends (
        path: string,
        options?: infer O,
      ) => unknown
        ? O
        : never

    // This verifies the type accepts hnswOptions
    const options: BuildEmbeddingsOptions = {
      hnswOptions: { m: 24, efConstruction: 256 },
    }
    expect(options.hnswOptions?.m).toBe(24)
    expect(options.hnswOptions?.efConstruction).toBe(256)
  })
})
