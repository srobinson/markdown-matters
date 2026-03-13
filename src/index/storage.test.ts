import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createStorage,
  initializeIndex,
  saveDocumentIndex,
} from './storage.js'

describe('index storage persistence', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdcontext-storage-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('writes compact JSON for persisted indexes', async () => {
    const storage = createStorage(tempDir)

    await Effect.runPromise(initializeIndex(storage))
    await Effect.runPromise(
      saveDocumentIndex(storage, {
        version: 1,
        rootPath: tempDir,
        documents: {
          'alpha.md': {
            id: 'doc-alpha',
            path: 'alpha.md',
            title: 'Alpha',
            mtime: 1,
            hash: 'abc123',
            tokenCount: 10,
            sectionCount: 1,
          },
        },
      }),
    )

    const raw = await fs.readFile(storage.paths.documents, 'utf-8')
    expect(raw).toBe(
      JSON.stringify({
        version: 1,
        rootPath: tempDir,
        documents: {
          'alpha.md': {
            id: 'doc-alpha',
            path: 'alpha.md',
            title: 'Alpha',
            mtime: 1,
            hash: 'abc123',
            tokenCount: 10,
            sectionCount: 1,
          },
        },
      }),
    )
    expect(raw).not.toContain('\n  ')
  })
})
