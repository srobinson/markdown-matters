/**
 * Storage Test Suite
 *
 * Tests the index storage layer: JSON file round-trips, schema validation,
 * hash stability, index lifecycle, and error handling for corrupted/missing files.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  clearIndexCache,
  computeHash,
  createEmptyDocumentIndex,
  createEmptyLinkIndex,
  createEmptySectionIndex,
  createStorage,
  indexExists,
  initializeIndex,
  loadDocumentIndex,
  loadLinkIndex,
  loadSectionIndex,
  saveDocumentIndex,
  saveLinkIndex,
  saveSectionIndex,
} from './storage.js'
import type { DocumentIndex, LinkIndex, SectionIndex } from './types.js'
import { INDEX_VERSION } from './types.js'

// ============================================================================
// Test Helpers
// ============================================================================

let tempRoot: string

const createTempDir = async (): Promise<string> => {
  const dir = path.join(
    tempRoot,
    `storage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  await fs.mkdir(dir, { recursive: true })
  return dir
}

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.catchAll((e) => Effect.die(e))))

const runExit = <A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> =>
  Effect.runPromise(Effect.exit(effect))

const createTestStorage = (root: string): ReturnType<typeof createStorage> =>
  createStorage(root, root)

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-storage-'))
})

afterAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true })
})

// ============================================================================
// createStorage & getIndexPaths
// ============================================================================

describe('createStorage', () => {
  it('keeps separate absolute source and index roots', () => {
    const storage = createStorage('./relative/source', './relative/index')
    expect(path.isAbsolute(storage.sourceRoot)).toBe(true)
    expect(path.isAbsolute(storage.indexRoot)).toBe(true)
    expect(storage.sourceRoot).not.toBe(storage.indexRoot)
  })

  it('returns correct paths for the explicit index root', () => {
    const sourceRoot = path.resolve('/tmp/test-source')
    const indexRoot = path.resolve('/tmp/test-index')
    const storage = createStorage(sourceRoot, indexRoot)
    expect(storage.sourceRoot).toBe(sourceRoot)
    expect(storage.indexRoot).toBe(indexRoot)
    expect(storage.paths.root).toBe(indexRoot)
    expect(storage.paths.documents).toBe(
      path.join(indexRoot, 'indexes', 'documents.json'),
    )
    expect(storage.paths.sections).toBe(
      path.join(indexRoot, 'indexes', 'sections.json'),
    )
    expect(storage.paths.links).toBe(
      path.join(indexRoot, 'indexes', 'links.json'),
    )
    expect(storage.paths.cache).toBe(path.join(indexRoot, 'cache'))
    expect(storage.paths.parsed).toBe(path.join(indexRoot, 'cache', 'parsed'))
    expect(storage.paths.bm25).toBe(path.join(indexRoot, 'bm25.json'))
    expect(storage.paths.bm25Metadata).toBe(
      path.join(indexRoot, 'bm25.meta.json'),
    )
  })
})

// ============================================================================
// computeHash
// ============================================================================

describe('computeHash', () => {
  it('returns a 16-character hex string', () => {
    const hash = computeHash('hello world')
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces stable output across calls', () => {
    const input = 'stable content for hashing'
    expect(computeHash(input)).toBe(computeHash(input))
  })

  it('produces different hashes for different inputs', () => {
    expect(computeHash('input-a')).not.toBe(computeHash('input-b'))
  })

  it('handles empty string', () => {
    const hash = computeHash('')
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })
})

// ============================================================================
// initializeIndex
// ============================================================================

describe('initializeIndex', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await createTempDir()
  })

  it('creates only index directories', async () => {
    const storage = createTestStorage(rootDir)
    await run(initializeIndex(storage))

    await expect(fs.stat(storage.paths.root)).resolves.toBeDefined()
    await expect(
      fs.access(path.join(storage.indexRoot, 'config.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('is idempotent', async () => {
    const storage = createTestStorage(rootDir)
    await run(initializeIndex(storage))
    await run(initializeIndex(storage))
    await expect(fs.stat(storage.paths.parsed)).resolves.toBeDefined()
  })

  it('creates parsed cache directory', async () => {
    const storage = createTestStorage(rootDir)
    await run(initializeIndex(storage))

    const stat = await fs.stat(storage.paths.parsed)
    expect(stat.isDirectory()).toBe(true)
  })
})

// ============================================================================
// indexExists
// ============================================================================

describe('indexExists', () => {
  it('returns false when no index has been created', async () => {
    const dir = await createTempDir()
    const storage = createTestStorage(dir)
    const exists = await run(indexExists(storage))
    expect(exists).toBe(false)
  })

  it('returns true after initialization', async () => {
    const dir = await createTempDir()
    const storage = createTestStorage(dir)
    await run(initializeIndex(storage))
    const exists = await run(indexExists(storage))
    expect(exists).toBe(true)
  })
})

// ============================================================================
// Document Index: save/load round-trip
// ============================================================================

describe('DocumentIndex round-trip', () => {
  let storage: ReturnType<typeof createStorage>

  beforeEach(async () => {
    const dir = await createTempDir()
    storage = createTestStorage(dir)
    await run(initializeIndex(storage))
  })

  it('save then load preserves data', async () => {
    const index: DocumentIndex = {
      version: INDEX_VERSION,
      rootPath: storage.sourceRoot,
      documents: {
        'doc-1': {
          id: 'doc-1',
          path: 'README.md',
          title: 'README',
          mtime: 1710000000000,
          hash: 'abcdef0123456789',
          tokenCount: 42,
          sectionCount: 3,
        },
      },
    }

    await run(saveDocumentIndex(storage, index))
    const loaded = await run(loadDocumentIndex(storage))

    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe(INDEX_VERSION)
    const doc1 = loaded!.documents['doc-1']!
    expect(doc1.title).toBe('README')
    expect(doc1.tokenCount).toBe(42)
  })

  it('returns null when document index does not exist', async () => {
    const loaded = await run(loadDocumentIndex(storage))
    expect(loaded).toBeNull()
  })

  it('createEmptyDocumentIndex produces valid structure', () => {
    const empty = createEmptyDocumentIndex(storage.sourceRoot)
    expect(empty.version).toBe(INDEX_VERSION)
    expect(empty.rootPath).toBe(storage.sourceRoot)
    expect(Object.keys(empty.documents)).toHaveLength(0)
  })
})

// ============================================================================
// Section Index: save/load round-trip
// ============================================================================

describe('SectionIndex round-trip', () => {
  let storage: ReturnType<typeof createStorage>

  beforeEach(async () => {
    const dir = await createTempDir()
    storage = createTestStorage(dir)
    await run(initializeIndex(storage))
  })

  it('save then load preserves data', async () => {
    const index: SectionIndex = {
      version: INDEX_VERSION,
      sections: {
        'sec-1': {
          id: 'sec-1',
          documentId: 'doc-1',
          documentPath: 'README.md',
          heading: 'Introduction',
          level: 1,
          startLine: 1,
          endLine: 10,
          tokenCount: 20,
          hasCode: false,
          hasList: true,
          hasTable: false,
        },
      },
      byHeading: { introduction: ['sec-1'] },
      byDocument: { 'doc-1': ['sec-1'] },
    }

    await run(saveSectionIndex(storage, index))
    const loaded = await run(loadSectionIndex(storage))

    expect(loaded).not.toBeNull()
    expect(loaded!.sections['sec-1']!.heading).toBe('Introduction')
    expect(loaded!.byHeading.introduction).toEqual(['sec-1'])
    expect(loaded!.byDocument['doc-1']).toEqual(['sec-1'])
  })

  it('returns null when section index does not exist', async () => {
    const loaded = await run(loadSectionIndex(storage))
    expect(loaded).toBeNull()
  })

  it('createEmptySectionIndex produces valid structure', () => {
    const empty = createEmptySectionIndex()
    expect(empty.version).toBe(INDEX_VERSION)
    expect(Object.keys(empty.sections)).toHaveLength(0)
    expect(Object.keys(empty.byHeading)).toHaveLength(0)
    expect(Object.keys(empty.byDocument)).toHaveLength(0)
  })
})

// ============================================================================
// Link Index: save/load round-trip
// ============================================================================

describe('LinkIndex round-trip', () => {
  let storage: ReturnType<typeof createStorage>

  beforeEach(async () => {
    const dir = await createTempDir()
    storage = createTestStorage(dir)
    await run(initializeIndex(storage))
  })

  it('save then load preserves data', async () => {
    const index: LinkIndex = {
      version: INDEX_VERSION,
      forward: { 'a.md': ['b.md', 'c.md'] },
      backward: { 'b.md': ['a.md'], 'c.md': ['a.md'] },
      broken: ['d.md'],
    }

    await run(saveLinkIndex(storage, index))
    const loaded = await run(loadLinkIndex(storage))

    expect(loaded).not.toBeNull()
    expect(loaded!.forward['a.md']).toEqual(['b.md', 'c.md'])
    expect(loaded!.backward['b.md']).toEqual(['a.md'])
    expect(loaded!.broken).toEqual(['d.md'])
  })

  it('returns null when link index does not exist', async () => {
    const loaded = await run(loadLinkIndex(storage))
    expect(loaded).toBeNull()
  })

  it('createEmptyLinkIndex produces valid structure', () => {
    const empty = createEmptyLinkIndex()
    expect(empty.version).toBe(INDEX_VERSION)
    expect(Object.keys(empty.forward)).toHaveLength(0)
    expect(Object.keys(empty.backward)).toHaveLength(0)
    expect(empty.broken).toEqual([])
  })
})

// ============================================================================
// Error handling: malformed JSON
// ============================================================================

describe('malformed JSON handling', () => {
  let storage: ReturnType<typeof createStorage>

  beforeEach(async () => {
    const dir = await createTempDir()
    storage = createTestStorage(dir)
    await run(initializeIndex(storage))
  })

  it('loadDocumentIndex returns IndexCorruptedError on invalid JSON', async () => {
    await fs.writeFile(storage.paths.documents, '{{not json}}', 'utf-8')
    const exit = await runExit(loadDocumentIndex(storage))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = exit.cause
      // The error channel should contain IndexCorruptedError
      expect(String(error)).toContain('IndexCorruptedError')
    }
  })

  it('loadSectionIndex returns IndexCorruptedError on invalid JSON', async () => {
    await fs.mkdir(path.dirname(storage.paths.sections), { recursive: true })
    await fs.writeFile(storage.paths.sections, 'not-json-at-all', 'utf-8')
    const exit = await runExit(loadSectionIndex(storage))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('IndexCorruptedError')
    }
  })

  it('loadDocumentIndex returns IndexCorruptedError on schema mismatch', async () => {
    // Valid JSON but wrong shape: missing required fields
    await fs.writeFile(
      storage.paths.documents,
      JSON.stringify({ wrong: 'shape' }),
      'utf-8',
    )
    const exit = await runExit(loadDocumentIndex(storage))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('IndexCorruptedError')
    }
  })

  it('loadSectionIndex returns IndexCorruptedError on schema mismatch', async () => {
    await fs.mkdir(path.dirname(storage.paths.sections), { recursive: true })
    await fs.writeFile(
      storage.paths.sections,
      JSON.stringify({ version: 1, sections: 'not-a-record' }),
      'utf-8',
    )
    const exit = await runExit(loadSectionIndex(storage))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('IndexCorruptedError')
    }
  })

  it('loadLinkIndex returns IndexCorruptedError on invalid JSON', async () => {
    await fs.mkdir(path.dirname(storage.paths.links), { recursive: true })
    await fs.writeFile(storage.paths.links, '!!!', 'utf-8')
    const exit = await runExit(loadLinkIndex(storage))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('IndexCorruptedError')
    }
  })
})

// ============================================================================
// Large index serialization
// ============================================================================

describe('large index handling', () => {
  it('serializes and deserializes 10k document entries correctly', async () => {
    const dir = await createTempDir()
    const storage = createTestStorage(dir)
    await run(initializeIndex(storage))

    const documents: DocumentIndex['documents'] = {}
    for (let i = 0; i < 10_000; i++) {
      const id = `doc-${i}`
      documents[id] = {
        id,
        path: `folder/file-${i}.md`,
        title: `Document ${i}`,
        mtime: 1710000000000 + i,
        hash: computeHash(`content-${i}`),
        tokenCount: 100 + i,
        sectionCount: (i % 5) + 1,
      }
    }

    const index: DocumentIndex = {
      version: INDEX_VERSION,
      rootPath: storage.sourceRoot,
      documents,
    }

    await run(saveDocumentIndex(storage, index))
    const loaded = await run(loadDocumentIndex(storage))

    expect(loaded).not.toBeNull()
    expect(Object.keys(loaded!.documents)).toHaveLength(10_000)
    expect(loaded!.documents['doc-0']!.title).toBe('Document 0')
    expect(loaded!.documents['doc-9999']!.title).toBe('Document 9999')
    expect(loaded!.documents['doc-5000']!.tokenCount).toBe(5100)
  })
})

describe('atomic writes', () => {
  let storage: ReturnType<typeof createStorage>

  beforeEach(async () => {
    const dir = await createTempDir()
    storage = createTestStorage(dir)
  })

  it('leaves no .tmp files in the index directory after a successful save', async () => {
    const index = createEmptyDocumentIndex(storage.sourceRoot)
    await run(saveDocumentIndex(storage, index))

    const dir = path.dirname(storage.paths.documents)
    const entries = await fs.readdir(dir)
    const tmps = entries.filter((f) => f.endsWith('.tmp'))
    expect(tmps).toEqual([])
  })

  it('a stale .tmp file does not affect reads or block subsequent saves', async () => {
    const v1: DocumentIndex = {
      version: INDEX_VERSION,
      rootPath: storage.sourceRoot,
      documents: {
        'doc-1': {
          id: 'doc-1',
          path: 'a.md',
          title: 'A',
          mtime: 0,
          hash: 'hash-a',
          tokenCount: 0,
          sectionCount: 0,
        },
      },
    }
    await run(saveDocumentIndex(storage, v1))

    // Drop a stale, truncated .tmp simulating a previously killed save.
    const dir = path.dirname(storage.paths.documents)
    const staleTmp = path.join(
      dir,
      `${path.basename(storage.paths.documents)}.99999.deadbeef.tmp`,
    )
    await fs.writeFile(staleTmp, '{"truncated":')

    // Clear the in-memory cache so the next load goes to disk.
    clearIndexCache()

    const loadedV1 = await run(loadDocumentIndex(storage))
    expect(Object.keys(loadedV1!.documents)).toHaveLength(1)

    // A new save succeeds (unique tmp names — stale tmp does not collide).
    const v2: DocumentIndex = {
      version: INDEX_VERSION,
      rootPath: storage.sourceRoot,
      documents: {
        'doc-1': v1.documents['doc-1']!,
        'doc-2': {
          id: 'doc-2',
          path: 'b.md',
          title: 'B',
          mtime: 0,
          hash: 'hash-b',
          tokenCount: 0,
          sectionCount: 0,
        },
      },
    }
    await run(saveDocumentIndex(storage, v2))

    clearIndexCache()
    const loadedV2 = await run(loadDocumentIndex(storage))
    expect(Object.keys(loadedV2!.documents)).toHaveLength(2)

    // Cleanup the stale tmp so afterEach's rm doesn't race anything.
    await fs.unlink(staleTmp).catch(() => undefined)
  })

  it('cleans up the .tmp file when rename fails', async () => {
    // Make the target path an existing directory so fs.rename over it fails
    // with EISDIR (Linux) / ENOTEMPTY (macOS) / EPERM (Windows).
    await fs.mkdir(storage.paths.documents, { recursive: true })

    const index = createEmptyDocumentIndex(storage.sourceRoot)
    const exit = await runExit(saveDocumentIndex(storage, index))
    expect(Exit.isFailure(exit)).toBe(true)

    const dir = path.dirname(storage.paths.documents)
    const entries = await fs.readdir(dir)
    const tmps = entries.filter((f) => f.endsWith('.tmp'))
    expect(tmps).toEqual([])
  })
})
