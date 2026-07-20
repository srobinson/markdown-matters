/**
 * Hybrid Search Integration Tests
 *
 * Tests the full hybrid search stack combining BM25 keyword search with
 * semantic vector search using Reciprocal Rank Fusion (RRF).
 *
 * Test corpus: src/__tests__/fixtures/semantic-search/multi-word-corpus
 * - 6 documents covering system configuration and error handling topics
 * - Pre-built embeddings (512 dimensions, text-embedding-3-small)
 * - BM25 index for keyword search
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedFreshVectorFixture } from '../../embeddings/vector-store-test-fixture.js'
import { buildIndex } from '../../index/indexer.js'
import { createStorage, loadSectionIndex } from '../../index/storage.js'
import { createBM25Store } from '../bm25-store.js'
import {
  detectSearchModes,
  hybridSearch,
  type SearchMode,
} from '../hybrid-search.js'

const FIXTURE_CORPUS_PATH = path.join(
  __dirname,
  '../../__tests__/fixtures/semantic-search/multi-word-corpus',
)
let TEST_SOURCE_PATH: string
let TEST_INDEX_PATH: string

describe('Hybrid Search Integration', () => {
  beforeAll(async () => {
    TEST_SOURCE_PATH = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mdm-hybrid-source-'),
    )
    TEST_INDEX_PATH = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mdm-hybrid-schema-'),
    )
    await fs.cp(FIXTURE_CORPUS_PATH, TEST_SOURCE_PATH, { recursive: true })
    const docsPath = path.join(TEST_SOURCE_PATH, 'docs')
    await fs.mkdir(docsPath)
    await fs.rename(
      path.join(TEST_SOURCE_PATH, 'error-handling.md'),
      path.join(docsPath, 'error-handling.md'),
    )
    await Effect.runPromise(
      buildIndex(TEST_SOURCE_PATH, {
        indexRoot: TEST_INDEX_PATH,
        force: true,
      }),
    )
    const storage = createStorage(TEST_SOURCE_PATH, TEST_INDEX_PATH)
    const sectionIndex = await Effect.runPromise(loadSectionIndex(storage))
    const docs = await Promise.all(
      Object.values(sectionIndex?.sections ?? {}).map(async (section) => {
        const fileContent = await fs.readFile(section.documentPath, 'utf-8')
        return {
          id: section.id,
          sectionId: section.id,
          documentPath: section.documentPath,
          heading: section.heading,
          content: fileContent
            .split('\n')
            .slice(section.startLine - 1, section.endLine)
            .join('\n'),
        }
      }),
    )
    const store = createBM25Store(TEST_INDEX_PATH)
    await Effect.runPromise(store.add(docs))
    await Effect.runPromise(store.consolidate())
    await Effect.runPromise(store.save())
    await seedFreshVectorFixture({
      indexRoot: TEST_INDEX_PATH,
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 512,
    })
  })

  afterAll(async () => {
    await Promise.all([
      fs.rm(TEST_SOURCE_PATH, { recursive: true, force: true }),
      fs.rm(TEST_INDEX_PATH, { recursive: true, force: true }),
    ])
  })

  describe('Index Detection', () => {
    it('should detect both BM25 and embeddings indexes', async () => {
      const modes = await Effect.runPromise(detectSearchModes(TEST_INDEX_PATH))

      expect(modes.hasBM25).toBe(true)
      expect(modes.hasEmbeddings).toBe(true)
      expect(modes.recommendedMode).toBe('hybrid')
    })

    it('should recommend hybrid mode when both indexes available', async () => {
      const modes = await Effect.runPromise(detectSearchModes(TEST_INDEX_PATH))

      expect(modes.recommendedMode).toBe('hybrid')
    })
  })

  describe('Hybrid Search Results', () => {
    it('should combine semantic and keyword results', async () => {
      const query = 'error handling configuration'
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, query, {
          limit: 10,
          threshold: 0.2,
          mode: 'hybrid',
        }),
      )

      expect(result.results).toBeDefined()
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results.length).toBeGreaterThan(0)

      expect(result.stats.mode).toBe('hybrid')
      expect(result.stats.semanticResults).toBeGreaterThanOrEqual(0)
      expect(result.stats.keywordResults).toBeGreaterThan(0)
    })

    it('should include both exact matches and semantic matches', async () => {
      const query = 'configuration management'
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, query, {
          limit: 20,
          threshold: 0.15,
          mode: 'hybrid',
        }),
      )

      const hasExactMatches = result.results.some((r) =>
        r.sources.includes('keyword'),
      )
      const hasSemanticMatches = result.results.some((r) =>
        r.sources.includes('semantic'),
      )

      expect(hasExactMatches).toBe(true)
      if (result.stats.embeddingsAvailable) {
        expect(hasSemanticMatches).toBe(true)
      }
    })

    it('should indicate which sources contributed to each result', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error handling', {
          limit: 10,
          threshold: 0.3,
          mode: 'hybrid',
        }),
      )

      for (const r of result.results) {
        expect(r.sources).toBeDefined()
        expect(Array.isArray(r.sources)).toBe(true)
        expect(r.sources.length).toBeGreaterThan(0)

        for (const source of r.sources) {
          expect(['semantic', 'keyword']).toContain(source)
        }
      }
    })
  })

  describe('RRF Scoring', () => {
    it('should rank results by combined RRF score', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error handling', {
          limit: 10,
          threshold: 0.2,
          mode: 'hybrid',
        }),
      )

      expect(result.results.length).toBeGreaterThanOrEqual(1)

      for (let i = 1; i < result.results.length; i++) {
        const prevScore = result.results[i - 1]!.score
        const currentScore = result.results[i]!.score
        expect(prevScore).toBeGreaterThanOrEqual(currentScore)
      }
    })

    it('should give higher scores to results found by both methods', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error handling', {
          limit: 15,
          threshold: 0.2,
          mode: 'hybrid',
        }),
      )

      const bothSources = result.results.filter((r) => r.sources.length === 2)
      const singleSource = result.results.filter((r) => r.sources.length === 1)

      if (bothSources.length > 0 && singleSource.length > 0) {
        const avgBoth =
          bothSources.reduce((sum, r) => sum + r.score, 0) / bothSources.length
        const avgSingle =
          singleSource.reduce((sum, r) => sum + r.score, 0) /
          singleSource.length

        expect(avgBoth).toBeGreaterThan(avgSingle * 0.8)
      }
    })

    it('should include individual scores when available', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'configuration', {
          limit: 10,
          threshold: 0.2,
          mode: 'hybrid',
        }),
      )

      for (const r of result.results) {
        if (r.sources.includes('semantic')) {
          expect(r.similarity).toBeDefined()
          expect(r.similarity).toBeGreaterThanOrEqual(0)
          expect(r.similarity).toBeLessThanOrEqual(1)
        }

        if (r.sources.includes('keyword')) {
          expect(r.bm25Score).toBeDefined()
          expect(r.bm25Score).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('Result Format', () => {
    it('should return results with correct structure', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error', {
          limit: 5,
          threshold: 0.3,
          mode: 'hybrid',
        }),
      )

      for (const r of result.results) {
        expect(r.sectionId).toBeDefined()
        expect(typeof r.sectionId).toBe('string')

        expect(r.documentPath).toBeDefined()
        expect(typeof r.documentPath).toBe('string')

        expect(r.heading).toBeDefined()
        expect(typeof r.heading).toBe('string')

        expect(r.score).toBeDefined()
        expect(typeof r.score).toBe('number')
        expect(r.score).toBeGreaterThan(0)

        expect(r.sources).toBeDefined()
        expect(Array.isArray(r.sources)).toBe(true)
      }
    })

    it('should return stats with search metadata', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error', {
          limit: 10,
          threshold: 0.2,
          mode: 'hybrid',
        }),
      )

      expect(result.stats).toBeDefined()
      expect(result.stats.modeReason).toBeDefined()
      expect(result.stats.semanticResults).toBeGreaterThanOrEqual(0)
      expect(result.stats.keywordResults).toBeGreaterThanOrEqual(0)
      expect(result.stats.combinedResults).toBeGreaterThanOrEqual(0)
      expect(result.stats.bm25Available).toBe(true)
      expect(typeof result.stats.embeddingsAvailable).toBe('boolean')
    })

    it('should track total available results', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error', {
          limit: 3,
          threshold: 0.2,
          mode: 'hybrid',
        }),
      )

      if (result.stats.totalAvailable !== undefined) {
        expect(result.stats.totalAvailable).toBeGreaterThanOrEqual(
          result.results.length,
        )
      }
    })
  })

  describe('Search Modes', () => {
    it('should support explicit hybrid mode', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'configuration', {
          limit: 10,
          mode: 'hybrid',
        }),
      )

      expect(result.stats.mode).toBe('hybrid')
      expect(result.stats.modeReason).toContain('--mode')
    })

    it('should support semantic-only mode', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error handling', {
          limit: 10,
          mode: 'semantic',
        }),
      )

      expect(result.stats.mode).toBe('semantic')
      expect(result.results.every((r) => r.sources.includes('semantic'))).toBe(
        true,
      )
      expect(result.results.every((r) => !r.sources.includes('keyword'))).toBe(
        true,
      )
    })

    it('should support keyword-only mode', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'configuration', {
          limit: 10,
          mode: 'keyword',
        }),
      )

      expect(result.stats.mode).toBe('keyword')
      expect(result.results.every((r) => r.sources.includes('keyword'))).toBe(
        true,
      )
      expect(result.results.every((r) => !r.sources.includes('semantic'))).toBe(
        true,
      )
    })
  })

  describe('Query Variations', () => {
    it('should handle single-word queries', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error', {
          limit: 10,
          threshold: 0.2,
          mode: 'hybrid',
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)
      expect(result.stats.keywordResults).toBeGreaterThan(0)
    })

    it('should handle multi-word queries', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error handling configuration', {
          limit: 10,
          threshold: 0.3,
          mode: 'hybrid',
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)
    })

    it('should handle phrase queries', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'distributed systems', {
          limit: 10,
          threshold: 0.3,
          mode: 'hybrid',
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)
    })

    it('should handle technical terms', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'automation', {
          limit: 10,
          threshold: 0.3,
          mode: 'hybrid',
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)
    })

    it('should return empty results for unrelated queries', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'quantum physics blockchain', {
          limit: 10,
          threshold: 0.7,
          mode: 'hybrid',
        }),
      )

      expect(result.results.length).toEqual(0)
    })
  })

  describe('Search Parameters', () => {
    it('should respect limit parameter', async () => {
      const limit = 3
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'configuration', {
          limit,
          threshold: 0.2,
          mode: 'hybrid',
        }),
      )

      expect(result.results.length).toBeLessThanOrEqual(limit)
    })

    it('should respect threshold parameter', async () => {
      const threshold = 0.7
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'configuration', {
          limit: 20,
          threshold,
          mode: 'hybrid',
        }),
      )

      for (const r of result.results) {
        if (r.similarity !== undefined) {
          expect(r.similarity).toBeGreaterThanOrEqual(threshold)
        }
      }
    })

    it('should support custom RRF weights', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error handling', {
          limit: 10,
          threshold: 0.3,
          mode: 'hybrid',
          bm25Weight: 2.0,
          semanticWeight: 1.0,
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)
      expect(result.stats.mode).toBe('hybrid')
    })

    it('should support custom RRF k constant', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'configuration', {
          limit: 10,
          threshold: 0.3,
          mode: 'hybrid',
          rrfK: 30,
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)
    })

    it('filters hybrid results with a database relative path pattern', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error', {
          limit: 10,
          threshold: 0.3,
          mode: 'hybrid',
          pathPattern: '**/docs/*.md',
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)
      const canonicalSourceRoot = await fs.realpath(TEST_SOURCE_PATH)
      for (const r of result.results) {
        expect(path.relative(canonicalSourceRoot, r.documentPath)).toMatch(
          /^docs[/\\][^/\\]+\.md$/,
        )
      }
    })

    it('should support quality modes', async () => {
      const qualities: Array<'fast' | 'balanced' | 'thorough'> = [
        'fast',
        'balanced',
        'thorough',
      ]

      for (const quality of qualities) {
        const result = await Effect.runPromise(
          hybridSearch(TEST_INDEX_PATH, 'configuration', {
            limit: 10,
            threshold: 0.3,
            mode: 'hybrid',
            quality,
          }),
        )

        expect(result.results.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty query', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, '', {
          limit: 10,
          threshold: 0.3,
          mode: 'hybrid',
        }),
      )

      expect(result.results).toBeDefined()
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('should handle very short queries', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'a', {
          limit: 10,
          threshold: 0.3,
          mode: 'hybrid',
        }),
      )

      expect(result.results).toBeDefined()
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('should handle limit of 1', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'configuration', {
          limit: 1,
          threshold: 0.3,
          mode: 'hybrid',
        }),
      )

      expect(result.results.length).toBeLessThanOrEqual(1)
    })

    it('should handle high threshold with no results', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'configuration', {
          limit: 10,
          threshold: 0.99,
          mode: 'hybrid',
        }),
      )

      expect(result.results).toBeDefined()
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('should handle large limit values', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'configuration', {
          limit: 1000,
          threshold: 0.2,
          mode: 'hybrid',
        }),
      )

      expect(result.results).toBeDefined()
      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  describe('Result Consistency', () => {
    it('should return deterministic results for same query', async () => {
      const query = 'error handling'
      const options = {
        limit: 10,
        threshold: 0.3,
        mode: 'hybrid' as SearchMode,
      }

      const result1 = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, query, options),
      )
      const result2 = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, query, options),
      )

      expect(result1.results.length).toBe(result2.results.length)

      for (let i = 0; i < result1.results.length; i++) {
        const r1 = result1.results[i]
        const r2 = result2.results[i]
        expect(r1?.sectionId).toBe(r2?.sectionId)
        expect(r1?.score).toBeCloseTo(r2?.score ?? 0, 5)
      }
    })

    it('should maintain score ordering across searches', async () => {
      const result = await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'configuration', {
          limit: 10,
          threshold: 0.2,
          mode: 'hybrid',
        }),
      )

      const scores = result.results.map((r) => r.score)

      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]!)
      }
    })
  })

  describe('Performance', () => {
    it('should complete search within reasonable time', async () => {
      const startTime = Date.now()

      await Effect.runPromise(
        hybridSearch(TEST_INDEX_PATH, 'error handling configuration', {
          limit: 10,
          threshold: 0.3,
          mode: 'hybrid',
        }),
      )

      const duration = Date.now() - startTime

      expect(duration).toBeLessThan(5000)
    })

    it('should handle multiple concurrent searches', async () => {
      const queries = [
        'configuration',
        'error handling',
        'distributed systems',
        'automation',
      ]

      const promises = queries.map((query) =>
        Effect.runPromise(
          hybridSearch(TEST_INDEX_PATH, query, {
            limit: 5,
            threshold: 0.3,
            mode: 'hybrid',
          }),
        ),
      )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(queries.length)
      for (const result of results) {
        expect(result.results).toBeDefined()
        expect(Array.isArray(result.results)).toBe(true)
      }
    })
  })
})
