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
  computeHash,
  createEmptyDocumentIndex,
  createEmptyLinkIndex,
  createEmptySectionIndex,
  createStorage,
  indexExists,
  initializeIndex,
  loadConfig,
  loadDocumentIndex,
  loadLinkIndex,
  loadSectionIndex,
  saveConfig,
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

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdcontext-storage-'))
})

afterAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true })
})

// ============================================================================
// createStorage & getIndexPaths
// ============================================================================

describe('createStorage', () => {
  it('resolves rootPath to absolute', () => {
    const storage = createStorage('./relative/path')
    expect(path.isAbsolute(storage.rootPath)).toBe(true)
  })

  it('returns correct index paths for given rootPath', () => {
    const root = path.resolve('/tmp/test-root')
    const storage = createStorage('/tmp/test-root')
    expect(storage.paths.root).toBe(path.join(root, '.mdcontext'))
    expect(storage.paths.config).toBe(
      path.join(root, '.mdcontext', 'config.json'),
    )
    expect(storage.paths.documents).toBe(
      path.join(root, '.mdcontext', 'indexes', 'documents.json'),
    )
    expect(storage.paths.sections).toBe(
      path.join(root, '.mdcontext', 'indexes', 'sections.json'),
    )
    expect(storage.paths.links).toBe(
      path.join(root, '.mdcontext', 'indexes', 'links.json'),
    )
    expect(storage.paths.cache).toBe(path.join(root, '.mdcontext', 'cache'))
    expect(storage.paths.parsed).toBe(
      path.join(root, '.mdcontext', 'cache', 'parsed'),
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

  it('creates directory structure and default config', async () => {
    const storage = createStorage(rootDir)
    await run(initializeIndex(storage))

    const config = await run(loadConfig(storage))
    expect(config).not.toBeNull()
    expect(config!.version).toBe(INDEX_VERSION)
    expect(config!.rootPath).toBe(storage.rootPath)
    expect(config!.include).toEqual(['**/*.md', '**/*.mdx'])
    expect(config!.exclude).toEqual(['**/node_modules/**', '**/.*/**'])
  })

  it('does not overwrite existing config on re-initialization', async () => {
    const storage = createStorage(rootDir)
    await run(initializeIndex(storage))
    const firstConfig = await run(loadConfig(storage))

    // Re-initialize should preserve the original config
    await run(initializeIndex(storage))
    const secondConfig = await run(loadConfig(storage))
    expect(secondConfig!.createdAt).toBe(firstConfig!.createdAt)
  })

  it('creates parsed cache directory', async () => {
    const storage = createStorage(rootDir)
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
    const storage = createStorage(dir)
    const exists = await run(indexExists(storage))
    expect(exists).toBe(false)
  })

  it('returns true after initialization', async () => {
    const dir = await createTempDir()
    const storage = createStorage(dir)
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
    storage = createStorage(dir)
    await run(initializeIndex(storage))
  })

  it('save then load preserves data', async () => {
    const index: DocumentIndex = {
      version: INDEX_VERSION,
      rootPath: storage.rootPath,
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
    const empty = createEmptyDocumentIndex(storage.rootPath)
    expect(empty.version).toBe(INDEX_VERSION)
    expect(empty.rootPath).toBe(storage.rootPath)
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
    storage = createStorage(dir)
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
    storage = createStorage(dir)
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
// Config: save/load round-trip
// ============================================================================

describe('Config round-trip', () => {
  let storage: ReturnType<typeof createStorage>

  beforeEach(async () => {
    const dir = await createTempDir()
    storage = createStorage(dir)
    await run(initializeIndex(storage))
  })

  it('saveConfig updates the updatedAt timestamp', async () => {
    const config = await run(loadConfig(storage))
    expect(config).not.toBeNull()

    const originalUpdatedAt = config!.updatedAt
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10))

    await run(saveConfig(storage, config!))
    const reloaded = await run(loadConfig(storage))
    expect(reloaded!.updatedAt).not.toBe(originalUpdatedAt)
  })
})

// ============================================================================
// Error handling: malformed JSON
// ============================================================================

describe('malformed JSON handling', () => {
  let storage: ReturnType<typeof createStorage>

  beforeEach(async () => {
    const dir = await createTempDir()
    storage = createStorage(dir)
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

  it('loadConfig returns IndexCorruptedError on malformed config', async () => {
    await fs.writeFile(storage.paths.config, '{broken', 'utf-8')
    const exit = await runExit(loadConfig(storage))

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
    const storage = createStorage(dir)
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
      rootPath: storage.rootPath,
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
