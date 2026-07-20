import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'

import { type DocumentKey, expandDeclaredPath } from '../db/canonical.js'
import type { VectorEntry } from '../embeddings/types.js'
import { createNamespacedVectorStore } from '../embeddings/vector-store.js'
import type { MdmManifest } from '../manifest.js'
import { bm25Search } from '../search/bm25-store.js'
import { buildManifestIndex } from './manifest-build.js'
import {
  createStorage,
  loadDocumentIndex,
  loadLinkIndex,
  loadSectionIndex,
} from './storage.js'

const cleanup: string[] = []

const makeManifestRoots = async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-corpus-'))
  cleanup.push(parent)
  const home = path.join(parent, 'home')
  const first = path.join(parent, 'first')
  const second = path.join(parent, 'second')
  await Promise.all(
    [home, first, second].map((directory) =>
      fs.mkdir(directory, { recursive: true }),
    ),
  )
  await Promise.all([
    fs.writeFile(
      path.join(first, 'first.md'),
      '# first\n\nalpha corpus words repeated for keyword index coverage',
    ),
    fs.writeFile(
      path.join(second, 'second.md'),
      '# second\n\nbetasecond corpus words repeated for keyword index coverage',
    ),
  ])
  const manifest: MdmManifest = {
    directories: [first, second].map((directory) => ({
      path: expandDeclaredPath(directory),
      recurse: true,
    })),
  }
  return { home, first, second, manifest }
}

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

it('deduplicates overlapping roots and hardlinks before one save', async () => {
  const { home, first, second } = await makeManifestRoots()
  await Promise.all([
    fs.rm(path.join(first, 'first.md')),
    fs.rm(path.join(second, 'second.md')),
  ])
  const sharedA = path.join(first, 'a.md')
  const sharedZ = path.join(second, 'z.md')
  await fs.writeFile(sharedZ, '# shared')
  await fs.link(sharedZ, sharedA)
  await fs.writeFile(path.join(second, 'only.md'), '# only')
  await fs.mkdir(path.join(second, 'nested'))
  const manifest: MdmManifest = {
    directories: [
      { path: expandDeclaredPath(first), recurse: true },
      { path: expandDeclaredPath(second), recurse: true },
      {
        path: expandDeclaredPath(path.join(second, 'nested')),
        recurse: true,
      },
    ],
  }

  const result = await Effect.runPromise(
    buildManifestIndex(manifest, { indexRoot: home }),
  )
  const documents = await Effect.runPromise(
    loadDocumentIndex(createStorage(home, home)),
  )
  const survivor = (await fs.realpath(sharedA)) as DocumentKey

  expect(result.totalDocuments).toBe(2)
  expect(Object.keys(documents?.documents ?? {})).toContain(survivor)
  expect(documents?.documents[survivor]?.declaredPaths).toEqual([
    sharedA,
    sharedZ,
  ])
})

it('prunes a root removed from the complete manifest', async () => {
  const fixture = await makeManifestRoots()
  await Effect.runPromise(
    buildManifestIndex(fixture.manifest, { indexRoot: fixture.home }),
  )

  const result = await Effect.runPromise(
    buildManifestIndex(
      { directories: [fixture.manifest.directories[0]!] },
      { indexRoot: fixture.home },
    ),
  )

  expect(result.totalDocuments).toBe(1)
  expect(
    await Effect.runPromise(bm25Search(fixture.home, 'betasecond')),
  ).toEqual([])
})

it('resolves cross-root links only when the target is discovered', async () => {
  const { home, first, second } = await makeManifestRoots()
  await Promise.all([
    fs.rm(path.join(first, 'first.md')),
    fs.rm(path.join(second, 'second.md')),
    fs.mkdir(path.join(second, 'nested')),
  ])
  const source = path.join(first, 'source.md')
  const target = path.join(second, 'nested', 'target.md')
  await Promise.all([
    fs.writeFile(source, '# Source\n\n[Target](../second/nested/target.md)'),
    fs.writeFile(target, '# Target'),
  ])
  const shallow: MdmManifest = {
    directories: [
      { path: expandDeclaredPath(first), recurse: true },
      { path: expandDeclaredPath(second), recurse: true, depth: 0 },
    ],
  }

  await Effect.runPromise(buildManifestIndex(shallow, { indexRoot: home }))
  const storage = createStorage(home, home)
  const sourceKey = (await fs.realpath(source)) as DocumentKey
  const targetKey = (await fs.realpath(target)) as DocumentKey
  let links = await Effect.runPromise(loadLinkIndex(storage))
  expect(links?.forward[sourceKey]).toEqual([])
  expect(links?.brokenBySource[sourceKey]).toEqual([target])

  const complete: MdmManifest = {
    directories: shallow.directories.map((directory) => ({
      ...directory,
      ...(directory.path === expandDeclaredPath(second) ? { depth: 1 } : {}),
    })),
  }
  await Effect.runPromise(buildManifestIndex(complete, { indexRoot: home }))
  links = await Effect.runPromise(loadLinkIndex(storage))
  expect(links?.forward[sourceKey]).toEqual([targetKey])

  await fs.writeFile(path.join(second, '.mdmignore'), 'nested/target.md\n')
  await Effect.runPromise(buildManifestIndex(complete, { indexRoot: home }))
  links = await Effect.runPromise(loadLinkIndex(storage))
  expect(links?.forward[sourceKey]).toEqual([])
  expect(links?.brokenBySource[sourceKey]).toEqual([target])
})

it('removes stale section vectors when manifest membership shrinks', async () => {
  const fixture = await makeManifestRoots()
  await Effect.runPromise(
    buildManifestIndex(fixture.manifest, { indexRoot: fixture.home }),
  )
  const storage = createStorage(fixture.home, fixture.home)
  const [documents, sections] = await Promise.all([
    Effect.runPromise(loadDocumentIndex(storage)),
    Effect.runPromise(loadSectionIndex(storage)),
  ])
  const entries: VectorEntry[] = Object.values(sections?.sections ?? {}).map(
    (section, index) => {
      const documentHash = documents?.documents[section.documentPath]?.hash
      if (documentHash === undefined) {
        throw new Error(`Missing indexed document for ${section.documentPath}`)
      }
      return {
        id: section.id,
        sectionId: section.id,
        documentPath: section.documentPath,
        documentHash,
        heading: section.heading,
        embedding: index % 2 === 0 ? [1, 0] : [0, 1],
      }
    },
  )
  const store = createNamespacedVectorStore(
    fixture.home,
    'openai',
    'test-model',
    2,
  )
  store.setProvider('openai', 'test-model')
  await Effect.runPromise(store.add(entries))
  await Effect.runPromise(store.save())

  await Effect.runPromise(
    buildManifestIndex(
      { directories: [fixture.manifest.directories[0]!] },
      { indexRoot: fixture.home },
    ),
  )

  const remainingSections = await Effect.runPromise(loadSectionIndex(storage))
  const reloaded = createNamespacedVectorStore(
    fixture.home,
    'openai',
    'test-model',
    2,
  )
  expect((await Effect.runPromise(reloaded.load())).loaded).toBe(true)
  expect(reloaded.getEmbeddedIds()).toEqual(
    new Set(Object.keys(remainingSections?.sections ?? {})),
  )
})
