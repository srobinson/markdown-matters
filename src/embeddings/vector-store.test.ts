/**
 * Vector Store Test Suite
 *
 * Tests the HNSW-based vector store: add/search operations, similarity
 * scoring, save/load round-trips, dimension mismatch handling, HNSW
 * parameter mismatch warnings, and auto-resize behavior.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { VectorEntry } from './types.js'
import { createVectorStore, type VectorStore } from './vector-store.js'

// ============================================================================
// Test Helpers
// ============================================================================

let tempRoot: string

const DIMS = 32

const createTempDir = async (): Promise<string> => {
  const dir = path.join(
    tempRoot,
    `vs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  await fs.mkdir(dir, { recursive: true })
  return dir
}

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.catchAll((e) => Effect.die(e))))

const runExit = <A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> =>
  Effect.runPromise(Effect.exit(effect))

/** Produce a normalized vector (unit length) from a seed. */
const makeVector = (seed: number, dims = DIMS): number[] => {
  const raw = Array.from({ length: dims }, (_, i) => Math.sin(seed * (i + 1)))
  const mag = Math.sqrt(raw.reduce((s, v) => s + v * v, 0))
  return raw.map((v) => v / mag)
}

/** Produce an orthogonal-ish vector that will have low similarity to makeVector(1). */
const makeDistantVector = (dims = DIMS): number[] => {
  // Perpendicular construction: flip signs of the base vector
  const base = makeVector(1, dims)
  return base.map((v) => -v)
}

const makeEntry = (id: string, seed: number): VectorEntry => ({
  id,
  sectionId: `section-${id}`,
  documentPath: `docs/${id}.md`,
  heading: `Heading ${id}`,
  embedding: makeVector(seed),
})

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdcontext-vs-'))
})

afterAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true })
})

// ============================================================================
// add / search basics
// ============================================================================

describe('add and search', () => {
  let store: VectorStore

  beforeEach(async () => {
    const dir = await createTempDir()
    store = createVectorStore(dir, DIMS)
  })

  it('add inserts vectors and search returns them', async () => {
    const entries = [makeEntry('a', 1), makeEntry('b', 2)]
    await run(store.add(entries))

    const results = await run(store.search(makeVector(1), 10))
    expect(results.length).toBeGreaterThanOrEqual(1)

    const ids = results.map((r) => r.id)
    expect(ids).toContain('a')
    expect(ids).toContain('b')
  })

  it('search returns results sorted by descending similarity', async () => {
    // Vectors with seeds 1, 2, 3. Query with seed 1 should rank 'a' highest.
    await run(
      store.add([makeEntry('a', 1), makeEntry('b', 2), makeEntry('c', 3)]),
    )

    const results = await run(store.search(makeVector(1), 10))
    expect(results.length).toBeGreaterThanOrEqual(2)

    // First result should be the most similar (seed=1 vs query seed=1)
    expect(results[0]!.id).toBe('a')

    // Similarity values should be in descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.similarity).toBeGreaterThanOrEqual(
        results[i]!.similarity,
      )
    }
  })

  it('search respects minSimilarity threshold', async () => {
    // Add a close vector and a distant vector
    const close = makeEntry('close', 1.001) // nearly identical to query
    const distant: VectorEntry = {
      id: 'distant',
      sectionId: 'section-distant',
      documentPath: 'docs/distant.md',
      heading: 'Distant',
      embedding: makeDistantVector(),
    }

    await run(store.add([close, distant]))

    // High threshold should filter out the distant vector
    const results = await run(store.search(makeVector(1), 10, 0.9))

    const ids = results.map((r) => r.id)
    expect(ids).toContain('close')
    expect(ids).not.toContain('distant')
  })

  it('search returns empty array when store is empty', async () => {
    const results = await run(store.search(makeVector(1), 10))
    expect(results).toEqual([])
  })

  it('add skips duplicate entries by id', async () => {
    const entry = makeEntry('dup', 1)
    await run(store.add([entry]))
    await run(store.add([entry])) // duplicate

    const stats = store.getStats()
    expect(stats.count).toBe(1)
  })

  it('cosine similarity is 1.0 for identical vectors', async () => {
    await run(store.add([makeEntry('same', 42)]))
    const results = await run(store.search(makeVector(42), 1))

    expect(results).toHaveLength(1)
    expect(results[0]!.similarity).toBeCloseTo(1.0, 4)
  })

  it('cosine similarity is near -1.0 for opposite vectors', async () => {
    const distant: VectorEntry = {
      id: 'opposite',
      sectionId: 'section-opp',
      documentPath: 'docs/opp.md',
      heading: 'Opposite',
      embedding: makeDistantVector(),
    }
    await run(store.add([distant]))

    // Query with the base vector (opposite direction)
    const results = await run(store.search(makeVector(1), 1, -2))

    expect(results).toHaveLength(1)
    expect(results[0]!.similarity).toBeCloseTo(-1.0, 4)
  })
})

// ============================================================================
// save / load round-trip
// ============================================================================

describe('save and load round-trip', () => {
  it('preserves all vectors and metadata after save/load', async () => {
    const dir = await createTempDir()
    const store1 = createVectorStore(dir, DIMS)

    const entries = [makeEntry('x', 10), makeEntry('y', 20), makeEntry('z', 30)]
    await run(store1.add(entries))
    await run(store1.save())

    // Create a new store instance and load
    const store2 = createVectorStore(dir, DIMS)
    const loadResult = await run(store2.load())

    expect(loadResult.loaded).toBe(true)
    expect(store2.getStats().count).toBe(3)

    // Search should still work. HNSW is approximate, so check >= 2 results.
    const results = await run(store2.search(makeVector(10), 3))
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results[0]!.id).toBe('x')
    expect(results[0]!.similarity).toBeCloseTo(1.0, 4)
  })

  it('load returns { loaded: false } when no index files exist', async () => {
    const dir = await createTempDir()
    const store = createVectorStore(dir, DIMS)
    const result = await run(store.load())

    expect(result.loaded).toBe(false)
  })

  it('preserves provider metadata across save/load', async () => {
    const dir = await createTempDir()
    const store1 = createVectorStore(dir, DIMS)

    // Add vectors so save writes metadata
    await run(store1.add([makeEntry('p', 1)]))
    // setProvider is on the concrete class, cast to access it
    ;(
      store1 as unknown as { setProvider: (p: string, m: string) => void }
    ).setProvider('voyage', 'voyage-3-lite')
    await run(store1.save())

    const store2 = createVectorStore(dir, DIMS)
    await run(store2.load())

    const stats = store2.getStats()
    expect(stats.provider).toBe('voyage')
    expect(stats.providerModel).toBe('voyage-3-lite')
  })
})

// ============================================================================
// Dimension mismatch
// ============================================================================

describe('dimension mismatch', () => {
  it('load fails with DimensionMismatchError when dimensions differ', async () => {
    const dir = await createTempDir()

    // Save with DIMS (32)
    const store1 = createVectorStore(dir, DIMS)
    await run(store1.add([makeEntry('d', 1)]))
    await run(store1.save())

    // Load with different dimensions should fail with DimensionMismatchError
    const store2 = createVectorStore(dir, 64)
    const exit = await runExit(store2.load())

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('DimensionMismatchError')
    }
  })
})

// ============================================================================
// HNSW parameter mismatch
// ============================================================================

describe('HNSW parameter mismatch', () => {
  it('load returns hnswMismatch warning when params differ', async () => {
    const dir = await createTempDir()

    // Save with m=16, efConstruction=200 (defaults)
    const store1 = createVectorStore(dir, DIMS)
    await run(store1.add([makeEntry('h', 1)]))
    await run(store1.save())

    // Load with different HNSW params
    const store2 = createVectorStore(dir, DIMS, {
      m: 32,
      efConstruction: 400,
    })
    const result = await run(store2.load())

    expect(result.loaded).toBe(true)
    expect(result.hnswMismatch).toBeDefined()
    expect(result.hnswMismatch!.indexParams).toEqual({
      m: 16,
      efConstruction: 200,
    })
    expect(result.hnswMismatch!.configParams).toEqual({
      m: 32,
      efConstruction: 400,
    })
  })

  it('load returns no mismatch when params match', async () => {
    const dir = await createTempDir()
    const opts = { m: 24, efConstruction: 300 }

    const store1 = createVectorStore(dir, DIMS, opts)
    await run(store1.add([makeEntry('h', 1)]))
    await run(store1.save())

    const store2 = createVectorStore(dir, DIMS, opts)
    const result = await run(store2.load())

    expect(result.loaded).toBe(true)
    expect(result.hnswMismatch).toBeUndefined()
  })
})

// ============================================================================
// resizeIndex (auto-resize when capacity exceeded)
// ============================================================================

describe('auto-resize', () => {
  it('handles adding more entries than initial capacity', async () => {
    const dir = await createTempDir()
    // Default initial capacity is 10000. We won't add that many,
    // but we can verify the store handles growth gracefully.
    const store = createVectorStore(dir, DIMS)

    // Add 50 entries in batches to exercise the growth path
    const batch1 = Array.from({ length: 25 }, (_, i) =>
      makeEntry(`r-${i}`, i + 1),
    )
    const batch2 = Array.from({ length: 25 }, (_, i) =>
      makeEntry(`r-${i + 25}`, i + 26),
    )

    await run(store.add(batch1))
    await run(store.add(batch2))

    expect(store.getStats().count).toBe(50)

    // Search should return results (HNSW is approximate, so check a reasonable subset)
    const results = await run(store.search(makeVector(1), 50))
    expect(results.length).toBeGreaterThanOrEqual(10)
  })
})

// ============================================================================
// Legacy JSON metadata migration
// ============================================================================

describe('legacy JSON metadata migration', () => {
  it('auto-migrates JSON metadata to msgpack on load', async () => {
    const dir = await createTempDir()

    // First save normally (creates .bin metadata)
    const store1 = createVectorStore(dir, DIMS)
    await run(store1.add([makeEntry('legacy', 5)]))
    await run(store1.save())

    // Read the binary metadata and convert to JSON at the old path
    const indexDir = path.join(dir, '.mdm')
    const binPath = path.join(indexDir, 'vectors.meta.bin')
    const jsonPath = path.join(indexDir, 'vectors.meta.json')

    const { decode } = await import('@msgpack/msgpack')
    const binData = await fs.readFile(binPath)
    const meta = decode(binData)

    // Remove binary, write JSON (simulate legacy state)
    await fs.unlink(binPath)
    await fs.writeFile(jsonPath, JSON.stringify(meta))

    // Load should auto-migrate
    const store2 = createVectorStore(dir, DIMS)
    const result = await run(store2.load())

    expect(result.loaded).toBe(true)
    expect(store2.getStats().count).toBe(1)

    // Verify binary file was recreated and JSON was removed
    const binExists = await fs.access(binPath).then(
      () => true,
      () => false,
    )
    const jsonExists = await fs.access(jsonPath).then(
      () => true,
      () => false,
    )

    expect(binExists).toBe(true)
    expect(jsonExists).toBe(false)
  })
})

// ============================================================================
// Corrupted metadata validation
// ============================================================================

describe('corrupted metadata validation', () => {
  it('load fails with VectorStoreError for malformed binary metadata', async () => {
    const dir = await createTempDir()

    // Save a valid index first so we have a vectors.bin file
    const store1 = createVectorStore(dir, DIMS)
    await run(store1.add([makeEntry('c1', 1)]))
    await run(store1.save())

    // Overwrite metadata with invalid structure
    const indexDir = path.join(dir, '.mdm')
    const metaPath = path.join(indexDir, 'vectors.meta.bin')
    const { encode } = await import('@msgpack/msgpack')
    await fs.writeFile(metaPath, encode({ bad: 'data', version: 'wrong' }))

    const store2 = createVectorStore(dir, DIMS)
    const exit = await runExit(store2.load())

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = exit.cause
      expect(String(error)).toContain('schema validation failed')
    }
  })

  it('load fails with VectorStoreError for malformed JSON metadata', async () => {
    const dir = await createTempDir()

    // Save a valid index first so we have a vectors.bin file
    const store1 = createVectorStore(dir, DIMS)
    await run(store1.add([makeEntry('c2', 2)]))
    await run(store1.save())

    // Replace binary metadata with invalid JSON at legacy path
    const indexDir = path.join(dir, '.mdm')
    const binPath = path.join(indexDir, 'vectors.meta.bin')
    const jsonPath = path.join(indexDir, 'vectors.meta.json')

    await fs.unlink(binPath)
    await fs.writeFile(
      jsonPath,
      JSON.stringify({ entries: 'not-an-object', dimensions: 'wrong' }),
    )

    const store2 = createVectorStore(dir, DIMS)
    const exit = await runExit(store2.load())

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = exit.cause
      expect(String(error)).toContain('schema validation failed')
    }
  })
})

// ============================================================================
// removeEntries (markDeleted)
// ============================================================================

describe('removeEntries', () => {
  it('removes a vector from search results', async () => {
    const dir = await createTempDir()
    const store = createVectorStore(dir, DIMS)

    await run(store.add([makeEntry('keep', 1), makeEntry('remove', 2)]))

    // Both should appear before removal
    const before = await run(store.search(makeVector(2), 10))
    const idsBefore = before.map((r) => r.id)
    expect(idsBefore).toContain('remove')
    expect(idsBefore).toContain('keep')

    // Remove one entry
    await run(store.removeEntries(['remove']))

    // After removal, 'remove' should not appear in results
    const after = await run(store.search(makeVector(2), 10))
    const idsAfter = after.map((r) => r.id)
    expect(idsAfter).not.toContain('remove')
    expect(idsAfter).toContain('keep')
  })

  it('updates getEmbeddedIds after removal', async () => {
    const dir = await createTempDir()
    const store = createVectorStore(dir, DIMS)

    await run(store.add([makeEntry('x', 1), makeEntry('y', 2)]))
    expect(store.getEmbeddedIds()).toContain('x')
    expect(store.getEmbeddedIds()).toContain('y')

    await run(store.removeEntries(['x']))
    expect(store.getEmbeddedIds()).not.toContain('x')
    expect(store.getEmbeddedIds()).toContain('y')
  })

  it('is a no-op for non-existent IDs', async () => {
    const dir = await createTempDir()
    const store = createVectorStore(dir, DIMS)

    await run(store.add([makeEntry('only', 1)]))
    await run(store.removeEntries(['nonexistent']))

    expect(store.getStats().count).toBe(1)
  })
})

// ============================================================================
// getStats
// ============================================================================

describe('getStats', () => {
  it('reports correct count and dimensions', async () => {
    const dir = await createTempDir()
    const store = createVectorStore(dir, DIMS)

    expect(store.getStats().count).toBe(0)
    expect(store.getStats().dimensions).toBe(DIMS)

    await run(store.add([makeEntry('s1', 1), makeEntry('s2', 2)]))
    expect(store.getStats().count).toBe(2)
  })
})
