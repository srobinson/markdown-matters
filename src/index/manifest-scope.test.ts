import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'

import type { DocumentKey } from '../db/canonical.js'
import { appendManifestDirectory, manifestPath } from '../manifest.js'
import { refreshManifestIndex } from './manifest-refresh.js'
import {
  makeManifestRoots,
  removeFixtureRoots,
} from './manifest-test-fixture.js'
import { createStorage, loadDocumentIndex } from './storage.js'
import type { DocumentIndex } from './types.js'

const cleanup: string[] = []

afterEach(() => removeFixtureRoots(cleanup))

const semantic = { mode: 'skip' } as const

const registerRoots = async (home: string, roots: readonly string[]) => {
  for (const root of roots) {
    await Effect.runPromise(appendManifestDirectory(home, { path: root }))
  }
}

const refresh = (home: string, requestedPath?: string) =>
  Effect.runPromise(refreshManifestIndex(home, requestedPath, { semantic }))

const readDocuments = async (indexRoot: string): Promise<DocumentIndex> => {
  const storage = createStorage(indexRoot, indexRoot)
  const documents = await Effect.runPromise(loadDocumentIndex(storage))
  expect(documents).not.toBeNull()
  return documents!
}

const documentKey = async (filePath: string): Promise<DocumentKey> =>
  (await fs.realpath(filePath)) as DocumentKey

it('scopes a refresh to the requested root and leaves other roots untouched', async () => {
  const { home, first, second } = await makeManifestRoots(cleanup)
  await registerRoots(home, [first, second])
  const initial = await refresh(home)
  const [firstKey, secondKey] = await Promise.all([
    documentKey(path.join(first, 'first.md')),
    documentKey(path.join(second, 'second.md')),
  ])
  const before = await readDocuments(initial.indexRoot)

  await Promise.all([
    fs.writeFile(path.join(first, 'first.md'), '# first\n\nrewritten alpha'),
    fs.writeFile(path.join(second, 'second.md'), '# second\n\nrewritten beta'),
  ])
  const manifestBefore = await fs.readFile(manifestPath(home), 'utf8')
  const scoped = await refresh(home, second)

  expect(scoped.value.documentsIndexed).toBe(1)
  const after = await readDocuments(scoped.indexRoot)
  expect(after.documents[secondKey]?.hash).not.toBe(
    before.documents[secondKey]?.hash,
  )
  expect(after.documents[firstKey]?.hash).toBe(before.documents[firstKey]?.hash)
  expect(await fs.readFile(manifestPath(home), 'utf8')).toBe(manifestBefore)
})

it('detects deletions inside the scope and keeps documents outside it', async () => {
  const { home, first, second } = await makeManifestRoots(cleanup)
  await registerRoots(home, [first, second])
  await refresh(home)
  const [firstKey, secondKey] = await Promise.all([
    documentKey(path.join(first, 'first.md')),
    documentKey(path.join(second, 'second.md')),
  ])

  await fs.rm(path.join(second, 'second.md'))
  const scoped = await refresh(home, second)

  const after = await readDocuments(scoped.indexRoot)
  expect(after.documents[secondKey]).toBeUndefined()
  expect(after.documents[firstKey]).toBeDefined()
})

it('scoping to a subdirectory of a root does not register a nested root', async () => {
  const { home, first, second } = await makeManifestRoots(cleanup)
  await registerRoots(home, [first, second])
  const nested = path.join(first, 'nested')
  await fs.mkdir(nested)
  await refresh(home)

  await fs.writeFile(path.join(nested, 'doc.md'), '# nested doc')
  await fs.writeFile(path.join(first, 'first.md'), '# first\n\nrewritten')
  const manifestBefore = await fs.readFile(manifestPath(home), 'utf8')
  const scoped = await refresh(home, nested)

  const after = await readDocuments(scoped.indexRoot)
  expect(
    after.documents[await documentKey(path.join(nested, 'doc.md'))],
  ).toBeDefined()
  expect(await fs.readFile(manifestPath(home), 'utf8')).toBe(manifestBefore)
})

it('registers a new root only after a successful build', async () => {
  const { home, first, second } = await makeManifestRoots(cleanup)
  await registerRoots(home, [first])
  await refresh(home)

  const scoped = await refresh(home, second)
  const manifestText = await fs.readFile(manifestPath(home), 'utf8')
  expect(manifestText).toContain(second.replace(/\\/g, '/'))
  const after = await readDocuments(scoped.indexRoot)
  expect(
    after.documents[await documentKey(path.join(second, 'second.md'))],
  ).toBeDefined()
})

it('force with a path rebuilds every root instead of dropping out-of-scope documents', async () => {
  const { home, first, second } = await makeManifestRoots(cleanup)
  await registerRoots(home, [first, second])
  await refresh(home)

  const forced = await Effect.runPromise(
    refreshManifestIndex(home, second, { semantic, force: true }),
  )

  const after = await readDocuments(forced.indexRoot)
  expect(
    after.documents[await documentKey(path.join(first, 'first.md'))],
  ).toBeDefined()
  expect(
    after.documents[await documentKey(path.join(second, 'second.md'))],
  ).toBeDefined()
})

it('does not modify the manifest when a scoped build fails', async () => {
  const { home, first } = await makeManifestRoots(cleanup)
  await registerRoots(home, [first])
  await refresh(home)
  const manifestBefore = await fs.readFile(manifestPath(home), 'utf8')

  const missing = path.join(path.dirname(first), 'does-not-exist')
  await expect(refresh(home, missing)).rejects.toThrow()

  expect(await fs.readFile(manifestPath(home), 'utf8')).toBe(manifestBefore)
})
