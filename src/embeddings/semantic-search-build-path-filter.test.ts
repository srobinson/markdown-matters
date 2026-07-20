import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { expect, it, vi } from 'vitest'
import { buildIndex } from '../index/indexer.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'
import type { EmbeddingClient } from '../providers/index.js'
import { buildEmbeddings } from './semantic-search-build.js'
import { createNamespacedVectorStore } from './vector-store.js'

const providerConfig = {
  provider: 'openai' as const,
  model: 'text-embedding-3-small',
  dimensions: 512,
}

const embedTexts: EmbeddingClient['embed'] = (texts, options) =>
  Effect.succeed({
    embeddings: texts.map(() =>
      Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0)),
    ),
    model: options?.model ?? providerConfig.model,
    usage: { inputTokens: texts.length * 20 },
  })

const client: EmbeddingClient = {
  embed: embedTexts,
}

const makeEmbeddingFixture = async (content: string) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-embed-hash-'))
  const sourceRoot = path.join(parent, 'source')
  const indexRoot = path.join(parent, 'index')
  const file = path.join(sourceRoot, 'README.md')
  const embed = vi.fn<EmbeddingClient['embed']>(embedTexts)

  await Promise.all([
    fs.mkdir(sourceRoot, { recursive: true }),
    fs.mkdir(indexRoot, { recursive: true }),
  ])
  await fs.writeFile(file, content)

  return {
    parent,
    sourceRoot,
    indexRoot,
    file,
    embed,
    client: { embed } satisfies EmbeddingClient,
  }
}

const loadOnlySectionState = async (
  sourceRoot: string,
  indexRoot: string,
): Promise<{ sectionId: string; documentHash: string }> => {
  const storage = createStorage(sourceRoot, indexRoot)
  const [documents, sections] = await Promise.all([
    Effect.runPromise(loadDocumentIndex(storage)),
    Effect.runPromise(loadSectionIndex(storage)),
  ])
  const sectionIds = Object.keys(sections?.sections ?? {})
  if (sectionIds.length !== 1) {
    throw new Error(
      `Expected one indexed section, received ${sectionIds.length}`,
    )
  }
  const sectionId = sectionIds[0]!
  const section = sections?.sections[sectionId]
  if (section === undefined) {
    throw new Error(`Missing indexed section ${sectionId}`)
  }
  const documentHash = documents?.documents[section.documentPath]?.hash
  if (documentHash === undefined) {
    throw new Error(`Missing indexed document ${section.documentPath}`)
  }
  return { sectionId, documentHash }
}

it('excludes source relative path patterns from embedding builds', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-build-path-'))
  const sourceRoot = path.join(parent, 'source')
  const indexRoot = path.join(parent, 'index')

  try {
    await Promise.all([
      fs.mkdir(path.join(sourceRoot, 'docs'), { recursive: true }),
      fs.mkdir(indexRoot, { recursive: true }),
    ])
    const content =
      '# Embedding\n\nThese words provide enough indexed tokens for this section to be eligible for an embedding build.\n'
    await Promise.all([
      fs.writeFile(path.join(sourceRoot, 'README.md'), content),
      fs.writeFile(path.join(sourceRoot, 'docs', 'guide.md'), content),
    ])

    await Effect.runPromise(buildIndex(sourceRoot, { indexRoot }))
    const result = await Effect.runPromise(
      buildEmbeddings(sourceRoot, {
        indexRoot,
        client,
        excludePatterns: ['docs/*'],
        force: true,
      }),
    )

    expect(result.filesProcessed).toBe(1)
    expect(result.sectionsEmbedded).toBeGreaterThan(0)
  } finally {
    await fs.rm(parent, { recursive: true, force: true })
  }
})

it('re-embeds changed text when the section id stays stable', async () => {
  const firstContent =
    '# Title\n\nfirst body has enough words to remain eligible for semantic embedding reuse coverage'
  const secondContent =
    '# Title\n\nsecond body has enough words to remain eligible for semantic embedding reuse coverage'
  const fixture = await makeEmbeddingFixture(firstContent)

  try {
    await Effect.runPromise(
      buildIndex(fixture.sourceRoot, { indexRoot: fixture.indexRoot }),
    )
    const initialState = await loadOnlySectionState(
      fixture.sourceRoot,
      fixture.indexRoot,
    )
    await Effect.runPromise(
      buildEmbeddings(fixture.sourceRoot, {
        indexRoot: fixture.indexRoot,
        client: fixture.client,
        providerConfig,
      }),
    )

    fixture.embed.mockClear()
    await fs.writeFile(fixture.file, secondContent)
    await Effect.runPromise(
      buildIndex(fixture.sourceRoot, { indexRoot: fixture.indexRoot }),
    )
    await Effect.runPromise(
      buildEmbeddings(fixture.sourceRoot, {
        indexRoot: fixture.indexRoot,
        client: fixture.client,
        providerConfig,
      }),
    )

    const currentState = await loadOnlySectionState(
      fixture.sourceRoot,
      fixture.indexRoot,
    )
    const store = createNamespacedVectorStore(
      fixture.indexRoot,
      providerConfig.provider,
      providerConfig.model,
      providerConfig.dimensions,
    )
    await Effect.runPromise(store.load())

    expect(currentState.sectionId).toBe(initialState.sectionId)
    expect(currentState.documentHash).not.toBe(initialState.documentHash)
    expect(fixture.embed).toHaveBeenCalledTimes(1)
    expect(fixture.embed.mock.calls.flat().join(' ')).toContain('second body')
    expect(store.getStats().count).toBe(1)
    expect(store.getEmbeddedDocumentHashes().get(currentState.sectionId)).toBe(
      currentState.documentHash,
    )
  } finally {
    await fs.rm(fixture.parent, { recursive: true, force: true })
  }
})

it('reuses an embedded section when its document hash is unchanged', async () => {
  const content =
    '# Title\n\nunchanged body has enough words to remain eligible for semantic embedding reuse coverage'
  const fixture = await makeEmbeddingFixture(content)

  try {
    await Effect.runPromise(
      buildIndex(fixture.sourceRoot, { indexRoot: fixture.indexRoot }),
    )
    await Effect.runPromise(
      buildEmbeddings(fixture.sourceRoot, {
        indexRoot: fixture.indexRoot,
        client: fixture.client,
        providerConfig,
      }),
    )

    fixture.embed.mockClear()
    const result = await Effect.runPromise(
      buildEmbeddings(fixture.sourceRoot, {
        indexRoot: fixture.indexRoot,
        client: fixture.client,
        providerConfig,
      }),
    )

    expect(fixture.embed).not.toHaveBeenCalled()
    expect(result.sectionsEmbedded).toBe(0)
    expect(result.cacheHit).toBe(true)
    expect(result.existingVectors).toBe(1)
  } finally {
    await fs.rm(fixture.parent, { recursive: true, force: true })
  }
})
