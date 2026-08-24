import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { type DocumentKey, expandDeclaredPath } from '../db/canonical.js'
import { readCurrentGeneration } from '../db/generation-paths.js'
import type { VectorEntry } from '../embeddings/types.js'
import { createNamespacedVectorStore } from '../embeddings/vector-store.js'
import {
  appendManifestDirectory,
  type MdmManifest,
  manifestPath,
} from '../manifest.js'
import { type EmbeddingClient, EmbeddingError } from '../providers/index.js'
import { bm25Search } from '../search/bm25-store.js'
import { buildManifestIndex } from './manifest-build.js'
import { refreshManifestIndex } from './manifest-refresh.js'
import {
  makeManifestRoots,
  removeFixtureRoots,
} from './manifest-test-fixture.js'
import {
  createStorage,
  loadDocumentIndex,
  loadLinkIndex,
  loadSectionIndex,
} from './storage.js'

const cleanup: string[] = []

const makeRoots = () => makeManifestRoots(cleanup)

afterEach(() => removeFixtureRoots(cleanup))

it('runs preflight before a requested directory is appended', async () => {
  const { home, first, second } = await makeRoots()
  await Effect.runPromise(appendManifestDirectory(home, { path: first }))
  const before = await fs.readFile(manifestPath(home), 'utf8')
  const failure = new Error('preflight rejected')

  await expect(
    Effect.runPromise(
      refreshManifestIndex(home, second, {
        preflight: () => Effect.fail(failure),
      }),
    ),
  ).rejects.toThrow('preflight rejected')

  expect(await fs.readFile(manifestPath(home), 'utf8')).toBe(before)
  expect(await Effect.runPromise(readCurrentGeneration(home))).toBeNull()
  expect((await fs.readdir(home)).filter((name) => /^gen-/.test(name))).toEqual(
    [],
  )
})

it('deduplicates overlapping roots and hardlinks before one save', async () => {
  const { home, first, second } = await makeRoots()
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
  const fixture = await makeRoots()
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

it('limits changed path builds to affected manifest roots', async () => {
  const fixture = await makeRoots()
  await Effect.runPromise(
    buildManifestIndex(fixture.manifest, { indexRoot: fixture.home }),
  )
  const changed = path.join(fixture.first, 'first.md')
  await fs.writeFile(
    changed,
    '# first\n\nupdated alpha corpus with enough additional words for incremental indexing coverage',
  )

  const result = await Effect.runPromise(
    buildManifestIndex(fixture.manifest, {
      indexRoot: fixture.home,
      changedPaths: [changed],
    }),
  )

  expect(result.documentsIndexed).toBe(1)
  expect(result.totalDocuments).toBe(2)
  expect(result.skipped.unchanged).toBe(0)
})

it('resolves cross-root links only when the target is discovered', async () => {
  const { home, first, second } = await makeRoots()
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
  expect(links?.forward[sourceKey]).toEqual([{ documentPath: targetKey }])

  await fs.writeFile(path.join(second, '.mdmignore'), 'nested/target.md\n')
  await Effect.runPromise(buildManifestIndex(complete, { indexRoot: home }))
  links = await Effect.runPromise(loadLinkIndex(storage))
  expect(links?.forward[sourceKey]).toEqual([])
  expect(links?.brokenBySource[sourceKey]).toEqual([target])
})

it('removes stale section vectors when manifest membership shrinks', async () => {
  const fixture = await makeRoots()
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

it('removes a vector when its section survives with a changed document hash', async () => {
  const fixture = await makeRoots()
  const manifest = {
    directories: [fixture.manifest.directories[0]!],
  }
  await Effect.runPromise(
    buildManifestIndex(manifest, { indexRoot: fixture.home }),
  )
  const storage = createStorage(fixture.home, fixture.home)
  const [documents, sections] = await Promise.all([
    Effect.runPromise(loadDocumentIndex(storage)),
    Effect.runPromise(loadSectionIndex(storage)),
  ])
  const section = Object.values(sections?.sections ?? {})[0]
  if (section === undefined) throw new Error('Expected one indexed section')
  const documentHash = documents?.documents[section.documentPath]?.hash
  if (documentHash === undefined) throw new Error('Expected indexed document')

  const store = createNamespacedVectorStore(
    fixture.home,
    'openai',
    'test-model',
    2,
  )
  await Effect.runPromise(
    store.add([
      {
        id: section.id,
        sectionId: section.id,
        documentPath: section.documentPath,
        documentHash,
        heading: section.heading,
        embedding: [1, 0],
      },
    ]),
  )
  await Effect.runPromise(store.save())

  await fs.writeFile(
    path.join(fixture.first, 'first.md'),
    '# first\n\nchanged body keeps the same section identity',
  )
  await Effect.runPromise(
    buildManifestIndex(manifest, { indexRoot: fixture.home }),
  )

  const reloaded = createNamespacedVectorStore(
    fixture.home,
    'openai',
    'test-model',
    2,
  )
  expect((await Effect.runPromise(reloaded.load())).loaded).toBe(true)
  expect(reloaded.getEmbeddedIds().has(section.id)).toBe(false)
})

it('preserves vectors when an incremental build produces an empty corpus', async () => {
  const fixture = await makeRoots()
  const source = path.join(fixture.first, 'first.md')
  const manifest = { directories: [fixture.manifest.directories[0]!] }
  await Effect.runPromise(
    buildManifestIndex(manifest, { indexRoot: fixture.home }),
  )
  const storage = createStorage(fixture.home, fixture.home)
  const [documents, sections] = await Promise.all([
    Effect.runPromise(loadDocumentIndex(storage)),
    Effect.runPromise(loadSectionIndex(storage)),
  ])
  const section = Object.values(sections?.sections ?? {})[0]
  if (section === undefined) throw new Error('Expected an indexed section')
  const documentHash = documents?.documents[section.documentPath]?.hash
  if (documentHash === undefined)
    throw new Error('Expected an indexed document')
  const store = createNamespacedVectorStore(
    fixture.home,
    'openai',
    'test-model',
    2,
  )
  await Effect.runPromise(
    store.add([
      {
        id: section.id,
        sectionId: section.id,
        documentPath: section.documentPath,
        documentHash,
        heading: section.heading,
        embedding: [1, 0],
      },
    ]),
  )
  await Effect.runPromise(store.save())
  await fs.rm(source)

  await Effect.runPromise(
    buildManifestIndex(manifest, {
      indexRoot: fixture.home,
      changedPaths: [source],
    }),
  )

  const reloaded = createNamespacedVectorStore(
    fixture.home,
    'openai',
    'test-model',
    2,
  )
  expect((await Effect.runPromise(reloaded.load())).loaded).toBe(true)
  expect(reloaded.getEmbeddedIds()).toEqual(new Set([section.id]))
})

it('leaves semantic vectors unchanged when semantic refresh is skipped', async () => {
  const fixture = await makeRoots()
  await Effect.runPromise(
    appendManifestDirectory(fixture.home, { path: fixture.first }),
  )
  const client: EmbeddingClient = {
    embed: (texts) =>
      Effect.succeed({
        embeddings: texts.map(() => [1, 0]),
        model: 'test-model',
        usage: { inputTokens: texts.length * 20 },
      }),
  }
  const first = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {
      semantic: {
        mode: 'build',
        options: {
          client,
          providerConfig: {
            provider: 'openai',
            model: 'test-model',
            dimensions: 2,
          },
        },
      },
    }),
  )
  const firstStore = createNamespacedVectorStore(
    first.indexRoot,
    'openai',
    'test-model',
    2,
  )
  await Effect.runPromise(firstStore.load())
  const [sectionId] = [...firstStore.getEmbeddedIds()]
  if (sectionId === undefined) throw new Error('Expected an embedded section')
  const previousHash = firstStore.getEmbeddedDocumentHashes().get(sectionId)
  if (previousHash === undefined) throw new Error('Expected an embedded hash')

  const source = path.join(fixture.first, 'first.md')
  await fs.writeFile(
    source,
    '# first\n\nchanged content has enough words to produce a different indexed document hash',
  )
  const second = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {
      semantic: { mode: 'skip' },
    }),
  )
  const secondStore = createNamespacedVectorStore(
    second.indexRoot,
    'openai',
    'test-model',
    2,
  )
  await Effect.runPromise(secondStore.load())
  const documents = await Effect.runPromise(
    loadDocumentIndex(createStorage(second.indexRoot, second.indexRoot)),
  )
  const currentHash = Object.values(documents?.documents ?? {})[0]?.hash
  if (currentHash === undefined) throw new Error('Expected a current hash')

  expect(currentHash).not.toBe(previousHash)
  expect(secondStore.getEmbeddedDocumentHashes().get(sectionId)).toBe(
    previousHash,
  )
})

it('keeps current unchanged when staged semantic refresh fails', async () => {
  const fixture = await makeRoots()
  await Effect.runPromise(
    appendManifestDirectory(fixture.home, { path: fixture.first }),
  )
  const first = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {}),
  )

  await expect(
    Effect.runPromise(
      refreshManifestIndex(fixture.home, undefined, {
        semantic: {
          mode: 'build',
          options: {
            client: {
              embed: () =>
                Effect.fail(
                  new EmbeddingError({
                    provider: 'openai',
                    message: 'simulated embedding failure',
                  }),
                ),
            } satisfies EmbeddingClient,
            providerConfig: {
              provider: 'openai',
              model: 'test-model',
              dimensions: 2,
            },
          },
        },
      }),
    ),
  ).rejects.toThrow('simulated embedding failure')

  expect(await Effect.runPromise(readCurrentGeneration(fixture.home))).toBe(
    first.generation,
  )
  await expect(
    fs.access(path.join(fixture.home, 'gen-2')),
  ).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(
    fs.access(path.join(fixture.home, 'indexes')),
  ).rejects.toMatchObject({ code: 'ENOENT' })
})

it('publishes only structural changes across identical, edited, and deleted corpora', async () => {
  const fixture = await makeRoots()
  await Effect.runPromise(
    appendManifestDirectory(fixture.home, { path: fixture.first }),
  )
  const source = path.join(fixture.first, 'first.md')

  const first = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {
      semantic: { mode: 'skip' },
    }),
  )
  const touched = new Date(Date.now() + 10_000)
  await fs.utimes(source, touched, touched)
  const identical = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {
      semantic: { mode: 'skip' },
    }),
  )

  expect(identical.generation).toBe(first.generation)
  expect(identical.indexRoot).toBe(first.indexRoot)
  expect(identical.mutation).toEqual({
    structural: false,
    semantic: false,
    changed: false,
  })
  await expect(
    fs.access(path.join(fixture.home, 'gen-2')),
  ).rejects.toMatchObject({ code: 'ENOENT' })

  await fs.writeFile(
    source,
    '# first\n\nupdated corpus content with enough words for a real logical index change',
  )
  const edited = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {
      semantic: { mode: 'skip' },
    }),
  )
  expect(edited.generation).not.toBe(first.generation)
  expect(edited.mutation).toMatchObject({ structural: true, changed: true })

  await fs.rm(source)
  const deleted = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {
      semantic: { mode: 'skip' },
    }),
  )
  expect(deleted.generation).not.toBe(edited.generation)
  expect(deleted.value.documentsIndexed).toBe(0)
  expect(deleted.value.totalDocuments).toBe(0)
  expect(deleted.mutation).toMatchObject({ structural: true, changed: true })
})

it('detects semantic no-ops and embedding-only changes', async () => {
  const fixture = await makeRoots()
  await Effect.runPromise(
    appendManifestDirectory(fixture.home, { path: fixture.first }),
  )
  const firstClient: EmbeddingClient = {
    embed: (texts) =>
      Effect.succeed({
        embeddings: texts.map(() => [1, 0]),
        model: 'test-model',
        usage: { inputTokens: texts.length },
      }),
  }
  const first = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {
      semantic: {
        mode: 'build',
        options: {
          client: firstClient,
          providerConfig: {
            provider: 'openai',
            model: 'test-model',
            dimensions: 2,
          },
        },
      },
    }),
  )
  const identical = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {
      semantic: { mode: 'active', client: firstClient },
    }),
  )

  expect(identical.generation).toBe(first.generation)
  expect(identical.mutation).toEqual({
    structural: false,
    semantic: false,
    changed: false,
  })

  const changedClient: EmbeddingClient = {
    embed: (texts) =>
      Effect.succeed({
        embeddings: texts.map(() => [0, 1]),
        model: 'test-model',
        usage: { inputTokens: texts.length },
      }),
  }
  const reembedded = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {
      semantic: {
        mode: 'build',
        options: {
          force: true,
          client: changedClient,
          providerConfig: {
            provider: 'openai',
            model: 'test-model',
            dimensions: 2,
          },
        },
      },
    }),
  )

  expect(reembedded.generation).not.toBe(first.generation)
  expect(reembedded.mutation).toEqual({
    structural: false,
    semantic: true,
    changed: true,
  })
})

it('reuses copied vectors during a forced structural rebuild', async () => {
  const fixture = await makeRoots()
  await Effect.runPromise(
    appendManifestDirectory(fixture.home, { path: fixture.first }),
  )
  const embed = vi.fn<EmbeddingClient['embed']>((texts) =>
    Effect.succeed({
      embeddings: texts.map(() => [1, 0]),
      model: 'test-model',
      usage: { inputTokens: texts.length },
    }),
  )
  const semantic = {
    mode: 'build' as const,
    options: {
      client: { embed } satisfies EmbeddingClient,
      providerConfig: {
        provider: 'openai' as const,
        model: 'test-model',
        dimensions: 2,
      },
    },
  }

  const first = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, { semantic }),
  )
  const second = await Effect.runPromise(
    refreshManifestIndex(fixture.home, undefined, {
      force: true,
      semantic,
    }),
  )

  expect(embed).toHaveBeenCalledTimes(1)
  expect(second.generation).not.toBe(first.generation)
  expect(second.semantic).toMatchObject({
    sectionsEmbedded: 0,
    cacheHit: true,
  })
  expect(second.mutation).toEqual({
    structural: false,
    semantic: false,
    changed: false,
  })
})
