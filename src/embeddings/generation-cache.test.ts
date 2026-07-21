import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'
import { parseGenerationName } from '../db/generation-paths.js'
import {
  clearHnswCache,
  evictHnswGeneration,
  getHnswCacheEntry,
  hnswCacheKey,
  setHnswCacheEntry,
} from './hnsw-cache.js'
import type { VectorStore } from './vector-store.js'

afterEach(clearHnswCache)

it('keys HNSW stores by logical home, namespace, and generation', async () => {
  const generation = await Effect.runPromise(parseGenerationName('gen-1'))
  expect(hnswCacheKey('/home', 'openai_model_512', generation)).toBe(
    '/home::openai_model_512::gen-1',
  )
})

it('evicts one generation while retaining the next generation', async () => {
  const gen1 = await Effect.runPromise(parseGenerationName('gen-1'))
  const gen2 = await Effect.runPromise(parseGenerationName('gen-2'))
  const gen1Key = hnswCacheKey('/home', 'openai_model_512', gen1)
  const gen2Key = hnswCacheKey('/home', 'openai_model_512', gen2)
  setHnswCacheEntry(gen1Key, {} as VectorStore)
  setHnswCacheEntry(gen2Key, {} as VectorStore)

  evictHnswGeneration('/home', gen1)

  expect(getHnswCacheEntry(gen1Key)).toBeUndefined()
  expect(getHnswCacheEntry(gen2Key)).toBeDefined()
})
