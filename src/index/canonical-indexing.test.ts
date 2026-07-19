import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import type { DocumentKey } from '../db/canonical.js'
import { buildIndex } from './index-build.js'
import { resolveInternalLink } from './link-index.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from './storage.js'

const cleanup: string[] = []

const makeRoots = async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-indexing-'))
  cleanup.push(parent)
  const sourceRoot = path.join(parent, 'source')
  const indexRoot = path.join(parent, 'index')
  await Promise.all([
    fs.mkdir(sourceRoot, { recursive: true }),
    fs.mkdir(indexRoot, { recursive: true }),
  ])
  return { sourceRoot, indexRoot }
}

const runBuild = (
  sourceRoot: string,
  indexRoot: string,
  options: Omit<Parameters<typeof buildIndex>[1], 'indexRoot'> = {},
) => Effect.runPromise(buildIndex(sourceRoot, { indexRoot, ...options }))

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

describe('canonical index construction', () => {
  it('classifies resolved links by DocumentKey and broken links by DeclaredPath', async () => {
    const { sourceRoot } = await makeRoots()
    const source = path.join(sourceRoot, 'source.md')
    const target = path.join(sourceRoot, 'target.md')
    const missing = path.join(sourceRoot, 'missing.md')
    await Promise.all([
      fs.writeFile(source, '# Source\n'),
      fs.writeFile(target, '# Target\n'),
    ])

    await expect(
      Effect.runPromise(
        resolveInternalLink('./target.md', source, sourceRoot, true),
      ),
    ).resolves.toEqual({ kind: 'resolved', path: await fs.realpath(target) })
    await expect(
      Effect.runPromise(
        resolveInternalLink('./missing.md', source, sourceRoot, true),
      ),
    ).resolves.toEqual({ kind: 'broken', path: missing })
    await expect(
      Effect.runPromise(
        resolveInternalLink('https://example.com', source, sourceRoot, true),
      ),
    ).resolves.toBeNull()
  })

  it('reports a symlink target drift and replaces the old canonical key', async () => {
    const { sourceRoot, indexRoot } = await makeRoots()
    const targets = path.join(sourceRoot, '.targets')
    const declared = path.join(sourceRoot, 'declared.md')
    const oldTarget = path.join(targets, 'old.md')
    const newTarget = path.join(targets, 'new.md')
    await fs.mkdir(targets)
    await Promise.all([
      fs.writeFile(oldTarget, '# Old\n'),
      fs.writeFile(newTarget, '# New\n'),
    ])
    await fs.symlink(oldTarget, declared)
    await runBuild(sourceRoot, indexRoot, { followSymlinks: true })

    await fs.unlink(declared)
    await fs.symlink(newTarget, declared)
    const result = await runBuild(sourceRoot, indexRoot, {
      changedPaths: [declared],
      followSymlinks: true,
    })

    const documents = await Effect.runPromise(
      loadDocumentIndex(createStorage(sourceRoot, indexRoot)),
    )
    const oldKey = (await fs.realpath(oldTarget)) as DocumentKey
    const newKey = (await fs.realpath(newTarget)) as DocumentKey
    expect(documents?.documents[oldKey]).toBeUndefined()
    expect(documents?.documents[newKey]?.declaredPaths).toEqual([declared])
    expect(result.errors).toContainEqual({
      path: 'declared.md',
      message: 'canonical target changed (moved?); reindexed',
    })
  })

  it('reports a missing declared alias without aborting the build', async () => {
    const { sourceRoot, indexRoot } = await makeRoots()
    const declared = path.join(sourceRoot, 'declared.md')
    await fs.writeFile(declared, '# Declared\n')
    await runBuild(sourceRoot, indexRoot)
    await fs.unlink(declared)

    const result = await runBuild(sourceRoot, indexRoot)

    expect(result.totalDocuments).toBe(1)
    expect(result.errors).toContainEqual({
      path: 'declared.md',
      message: 'not found (moved/deleted?); relink required',
    })
  })

  it('keeps a hardlinked document when its selected alias is deleted', async () => {
    const { sourceRoot, indexRoot } = await makeRoots()
    const a = path.join(sourceRoot, 'a.md')
    const z = path.join(sourceRoot, 'z.md')
    await fs.writeFile(a, '# Shared\n\n## Section\n')
    await fs.link(a, z)
    await runBuild(sourceRoot, indexRoot)

    await fs.unlink(a)
    const result = await runBuild(sourceRoot, indexRoot, {
      changedPaths: [a],
    })

    const storage = createStorage(sourceRoot, indexRoot)
    const [documents, sections] = await Promise.all([
      Effect.runPromise(loadDocumentIndex(storage)),
      Effect.runPromise(loadSectionIndex(storage)),
    ])
    const newKey = (await fs.realpath(z)) as DocumentKey
    expect(result.totalDocuments).toBe(1)
    expect(Object.keys(documents?.documents ?? {})).toEqual([newKey])
    expect(documents?.documents[newKey]?.paths).toEqual([newKey])
    expect(documents?.documents[newKey]?.declaredPaths).toEqual([z])
    expect(
      Object.values(sections?.sections ?? {}).every(
        (section) => section.documentPath === newKey,
      ),
    ).toBe(true)
  })

  it('preserves every hardlink alias during an incremental update', async () => {
    const { sourceRoot, indexRoot } = await makeRoots()
    const a = path.join(sourceRoot, 'a.md')
    const z = path.join(sourceRoot, 'z.md')
    await fs.writeFile(a, '# Shared\n')
    await fs.link(a, z)
    await runBuild(sourceRoot, indexRoot)

    await fs.writeFile(z, '# Updated\n')
    await runBuild(sourceRoot, indexRoot, { changedPaths: [z] })

    const documents = await Effect.runPromise(
      loadDocumentIndex(createStorage(sourceRoot, indexRoot)),
    )
    const key = (await fs.realpath(a)) as DocumentKey
    expect(Object.keys(documents?.documents ?? {})).toEqual([key])
    expect(documents?.documents[key]?.paths).toEqual([
      await fs.realpath(a),
      await fs.realpath(z),
    ])
    expect(documents?.documents[key]?.declaredPaths).toEqual([a, z])
    expect(documents?.documents[key]?.title).toBe('Updated')
  })
})
