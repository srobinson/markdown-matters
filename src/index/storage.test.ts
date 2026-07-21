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
import { type DocumentKey, expandDeclaredPath } from '../db/canonical.js'
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
import type {
  DocumentEntry,
  DocumentIndex,
  LinkIndex,
  SectionIndex,
} from './types.js'
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

const documentKey = (root: string, name: string): DocumentKey =>
  path.resolve(root, name) as DocumentKey

const makeDocumentEntry = (
  key: DocumentKey,
  id: string,
  title: string,
  overrides: Partial<DocumentEntry> = {},
): DocumentEntry => ({
  id,
  path: key,
  paths: [key],
  declaredPaths: [expandDeclaredPath(key)],
  identity: { device: '1', inode: id },
  comparisonKey: key,
  title,
  mtime: 0,
  hash: `hash-${id}`,
  tokenCount: 0,
  sectionCount: 0,
  ...overrides,
})

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
    expect(storage.paths).not.toHaveProperty('cache')
    expect(storage.paths).not.toHaveProperty('parsed')
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
    await expect(
      fs.access(path.join(storage.indexRoot, 'cache')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('is idempotent', async () => {
    const storage = createTestStorage(rootDir)
    await run(initializeIndex(storage))
    await run(initializeIndex(storage))
    await expect(
      fs.stat(path.dirname(storage.paths.documents)),
    ).resolves.toBeDefined()
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
    const readmeKey = documentKey(storage.sourceRoot, 'README.md')
    const index: DocumentIndex = {
      version: INDEX_VERSION,
      documents: {
        [readmeKey]: makeDocumentEntry(readmeKey, 'doc-1', 'README', {
          mtime: 1710000000000,
          hash: 'abcdef0123456789',
          tokenCount: 42,
          sectionCount: 3,
        }),
      },
    }

    await run(saveDocumentIndex(storage, index))
    const loaded = await run(loadDocumentIndex(storage))

    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe(INDEX_VERSION)
    const doc1 = loaded!.documents[readmeKey]!
    expect(doc1.title).toBe('README')
    expect(doc1.tokenCount).toBe(42)
  })

  it('returns null when document index does not exist', async () => {
    const loaded = await run(loadDocumentIndex(storage))
    expect(loaded).toBeNull()
  })

  it('createEmptyDocumentIndex produces valid structure', () => {
    const empty = createEmptyDocumentIndex()
    expect(empty.version).toBe(INDEX_VERSION)
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
    const readmeKey = documentKey(storage.sourceRoot, 'README.md')
    const index: SectionIndex = {
      version: INDEX_VERSION,
      sections: {
        'sec-1': {
          id: 'sec-1',
          documentId: 'doc-1',
          documentPath: readmeKey,
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
    const a = documentKey(storage.sourceRoot, 'a.md')
    const b = documentKey(storage.sourceRoot, 'b.md')
    const c = documentKey(storage.sourceRoot, 'c.md')
    const d = expandDeclaredPath(path.join(storage.sourceRoot, 'd.md'))
    const index: LinkIndex = {
      version: INDEX_VERSION,
      forward: { [a]: [{ documentPath: b }, { documentPath: c }] },
      backward: {
        [b]: [{ documentPath: a }],
        [c]: [{ documentPath: a }],
      },
      brokenBySource: { [a]: [d] },
      broken: [d],
    }

    await run(saveLinkIndex(storage, index))
    const loaded = await run(loadLinkIndex(storage))

    expect(loaded).not.toBeNull()
    expect(loaded!.forward[a]).toEqual([
      { documentPath: b },
      { documentPath: c },
    ])
    expect(loaded!.backward[b]).toEqual([{ documentPath: a }])
    expect(loaded!.brokenBySource[a]).toEqual([d])
    expect(loaded!.broken).toEqual([d])
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
    expect(Object.keys(empty.brokenBySource)).toHaveLength(0)
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

  it('rejects a relative document identity in the canonical schema', async () => {
    const canonical = documentKey(storage.sourceRoot, 'README.md')
    await fs.writeFile(
      storage.paths.documents,
      JSON.stringify({
        version: INDEX_VERSION,
        documents: {
          'README.md': {
            id: 'doc-1',
            path: canonical,
            paths: [canonical],
            declaredPaths: [path.join(storage.sourceRoot, 'README.md')],
            identity: { device: '1', inode: '2' },
            comparisonKey: canonical,
            title: 'README',
            mtime: 0,
            hash: 'hash',
            tokenCount: 0,
            sectionCount: 0,
          },
        },
      }),
    )

    expect(Exit.isFailure(await runExit(loadDocumentIndex(storage)))).toBe(true)
  })

  it('rejects a relative broken link in the canonical schema', async () => {
    const source = path.join(storage.sourceRoot, 'README.md')
    await fs.writeFile(
      storage.paths.links,
      JSON.stringify({
        version: INDEX_VERSION,
        forward: { [source]: [] },
        backward: {},
        brokenBySource: { [source]: ['missing.md'] },
        broken: ['missing.md'],
      }),
    )

    expect(Exit.isFailure(await runExit(loadLinkIndex(storage)))).toBe(true)
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
    const keys: DocumentKey[] = []
    for (let i = 0; i < 10_000; i++) {
      const id = `doc-${i}`
      const key = documentKey(storage.sourceRoot, `folder/file-${i}.md`)
      keys.push(key)
      documents[key] = makeDocumentEntry(key, id, `Document ${i}`, {
        mtime: 1710000000000 + i,
        hash: computeHash(`content-${i}`),
        tokenCount: 100 + i,
        sectionCount: (i % 5) + 1,
      })
    }

    const index: DocumentIndex = {
      version: INDEX_VERSION,
      documents,
    }

    await run(saveDocumentIndex(storage, index))
    const loaded = await run(loadDocumentIndex(storage))

    expect(loaded).not.toBeNull()
    expect(Object.keys(loaded!.documents)).toHaveLength(10_000)
    expect(loaded!.documents[keys[0]!]!.title).toBe('Document 0')
    expect(loaded!.documents[keys[9999]!]!.title).toBe('Document 9999')
    expect(loaded!.documents[keys[5000]!]!.tokenCount).toBe(5100)
  })
})

describe('selective cache eviction', () => {
  it('clears one generation root while retaining another root', async () => {
    const first = createTestStorage(await createTempDir())
    const second = createTestStorage(await createTempDir())
    const fixedTime = new Date('2026-01-01T00:00:00.000Z')
    const indexWithTitle = (
      storage: ReturnType<typeof createStorage>,
      title: string,
    ): DocumentIndex => {
      const key = documentKey(storage.sourceRoot, 'document.md')
      return {
        version: INDEX_VERSION,
        documents: { [key]: makeDocumentEntry(key, title, title) },
      }
    }
    for (const storage of [first, second]) {
      await run(saveDocumentIndex(storage, indexWithTitle(storage, 'old')))
      await fs.utimes(storage.paths.documents, fixedTime, fixedTime)
      expect(
        Object.values((await run(loadDocumentIndex(storage)))!.documents)[0]!
          .title,
      ).toBe('old')
      await fs.writeFile(
        storage.paths.documents,
        JSON.stringify(indexWithTitle(storage, 'new')),
      )
      await fs.utimes(storage.paths.documents, fixedTime, fixedTime)
    }

    clearIndexCache(first.indexRoot)

    expect(
      Object.values((await run(loadDocumentIndex(first)))!.documents)[0]!.title,
    ).toBe('new')
    expect(
      Object.values((await run(loadDocumentIndex(second)))!.documents)[0]!
        .title,
    ).toBe('old')
    clearIndexCache()
  })
})

describe('atomic writes', () => {
  let storage: ReturnType<typeof createStorage>

  beforeEach(async () => {
    const dir = await createTempDir()
    storage = createTestStorage(dir)
  })

  it('leaves no .tmp files in the index directory after a successful save', async () => {
    const index = createEmptyDocumentIndex()
    await run(saveDocumentIndex(storage, index))

    const dir = path.dirname(storage.paths.documents)
    const entries = await fs.readdir(dir)
    const tmps = entries.filter((f) => f.endsWith('.tmp'))
    expect(tmps).toEqual([])
  })

  it('a stale .tmp file does not affect reads or block subsequent saves', async () => {
    const firstKey = documentKey(storage.sourceRoot, 'a.md')
    const secondKey = documentKey(storage.sourceRoot, 'b.md')
    const v1: DocumentIndex = {
      version: INDEX_VERSION,
      documents: {
        [firstKey]: makeDocumentEntry(firstKey, 'doc-1', 'A'),
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
      documents: {
        [firstKey]: v1.documents[firstKey]!,
        [secondKey]: makeDocumentEntry(secondKey, 'doc-2', 'B'),
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

    const index = createEmptyDocumentIndex()
    const exit = await runExit(saveDocumentIndex(storage, index))
    expect(Exit.isFailure(exit)).toBe(true)

    const dir = path.dirname(storage.paths.documents)
    const entries = await fs.readdir(dir)
    const tmps = entries.filter((f) => f.endsWith('.tmp'))
    expect(tmps).toEqual([])
  })
})
