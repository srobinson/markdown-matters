import * as fs from 'node:fs/promises'
import { Effect, Logger } from 'effect'
import { afterEach, expect, it } from 'vitest'
import {
  createGenerationReadFixture,
  type GenerationReadFixture,
  removeGenerationReadFixture,
  setFixtureCurrent,
} from '../db/generation-read-test-fixture.js'
import { withCurrentGeneration } from '../db/generation-reader.js'
import {
  generateNamespace,
  getActiveProviderPath,
  getMetaPath,
} from '../embeddings/embedding-namespace.js'
import {
  clearHnswCache,
  getEmbeddingStats,
} from '../embeddings/semantic-search.js'
import { seedFreshVectorFixture } from '../embeddings/vector-store-test-fixture.js'
import {
  clearIndexCache,
  createStorage,
  loadSectionIndex,
  saveSectionIndex,
} from '../index/storage.js'
import { searchContent } from '../search/searcher.js'
import { getIndexInfo } from './utils.js'

let fixture: GenerationReadFixture | undefined

afterEach(async () => {
  clearIndexCache()
  clearHnswCache()
  if (fixture) await removeGenerationReadFixture(fixture)
  fixture = undefined
})

const inspectWithWarnings = async (fixture: GenerationReadFixture) => {
  const warnings: string[] = []
  const logger = Logger.make(({ logLevel, message }) => {
    if (logLevel.label === 'WARN') warnings.push(String(message))
  })
  const result = await Effect.runPromise(
    withCurrentGeneration(fixture.home, (session) =>
      Effect.gen(function* () {
        const embeddingStats = yield* getEmbeddingStats(session)
        const indexInfo = yield* getIndexInfo(session)
        const keywordResults = yield* searchContent(
          session,
          fixture.sourceRoot,
          { content: 'Repeated' },
        )
        return { embeddingStats, indexInfo, keywordResults }
      }),
    ).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))),
  )
  return { ...result, warnings }
}

const removeOneSection = async (indexRoot: string): Promise<void> => {
  const storage = createStorage(indexRoot, indexRoot)
  const index = await Effect.runPromise(loadSectionIndex(storage))
  if (!index) throw new Error('Expected seeded section index')
  const entries = Object.entries(index.sections).slice(0, 2)
  await Effect.runPromise(
    saveSectionIndex(storage, {
      ...index,
      sections: Object.fromEntries(entries),
    }),
  )
  clearIndexCache(indexRoot)
}

it('loads schema-validated statistics through the held session', async () => {
  fixture = await createGenerationReadFixture()
  await removeOneSection(fixture.gen2.root)

  const held = await Effect.runPromise(
    withCurrentGeneration(fixture.home, (session) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => setFixtureCurrent(fixture!, fixture!.gen2))
        return yield* getIndexInfo(session)
      }),
    ),
  )
  const next = await Effect.runPromise(
    withCurrentGeneration(fixture.home, getIndexInfo),
  )

  expect(held).toMatchObject({ exists: true, sectionCount: 3 })
  expect(next).toMatchObject({ exists: true, sectionCount: 2 })
})

it('rejects a malformed section index with a typed failure', async () => {
  fixture = await createGenerationReadFixture()
  await setFixtureCurrent(fixture, fixture.gen2)
  const storage = createStorage(fixture.sourceRoot, fixture.gen2.root)
  await fs.writeFile(storage.paths.sections, '{"version":2,"sections":null}')
  clearIndexCache(fixture.gen2.root)

  const exit = await Effect.runPromiseExit(
    withCurrentGeneration(fixture.home, getIndexInfo),
  )
  expect(exit).toMatchObject({
    _tag: 'Failure',
    cause: { _tag: 'Fail', error: { _tag: 'IndexCorruptedError' } },
  })
})

it('keeps keyword reads available when active embedding metadata is corrupt', async () => {
  fixture = await createGenerationReadFixture()
  await fs.writeFile(getActiveProviderPath(fixture.gen1.root), '{broken')

  const result = await inspectWithWarnings(fixture)

  expect(result.embeddingStats).toEqual({
    hasEmbeddings: false,
    count: 0,
    provider: 'none',
    dimensions: 0,
    totalCost: 0,
    totalTokens: 0,
  })
  expect(result.indexInfo).toMatchObject({
    exists: true,
    embeddingsExist: false,
  })
  expect(result.keywordResults).toHaveLength(2)
  expect(result.warnings).toHaveLength(2)
  expect(
    result.warnings.every((warning) =>
      warning.includes('active provider read'),
    ),
  ).toBe(true)
})

it('keeps keyword reads available when the active vector store is corrupt', async () => {
  fixture = await createGenerationReadFixture()
  const provider = 'test-provider'
  const model = 'test-model'
  const dimensions = 3
  await seedFreshVectorFixture({
    indexRoot: fixture.gen1.root,
    provider,
    model,
    dimensions,
  })
  await fs.writeFile(
    getMetaPath(
      fixture.gen1.root,
      generateNamespace(provider, model, dimensions),
    ),
    'corrupt vector metadata',
  )

  const result = await inspectWithWarnings(fixture)

  expect(result.embeddingStats.hasEmbeddings).toBe(false)
  expect(result.indexInfo.embeddingsExist).toBe(false)
  expect(result.keywordResults).toHaveLength(2)
  expect(result.warnings).toEqual([
    expect.stringContaining('vector store load'),
    expect.stringContaining('vector store load'),
  ])
})

it('contains no raw section index decoding or ambient root lookup', async () => {
  const source = await fs.readFile(
    new URL('./utils.ts', import.meta.url),
    'utf8',
  )
  expect(source).not.toMatch(
    /readFile\([^)]*sections|JSON\.parse|resolveMdmHome|dbIndexDir/,
  )
})
