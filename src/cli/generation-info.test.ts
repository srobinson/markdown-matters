import * as fs from 'node:fs/promises'
import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'
import {
  createGenerationReadFixture,
  type GenerationReadFixture,
  removeGenerationReadFixture,
  setFixtureCurrent,
} from '../db/generation-read-test-fixture.js'
import { withCurrentGeneration } from '../db/generation-reader.js'
import {
  clearIndexCache,
  createStorage,
  loadSectionIndex,
  saveSectionIndex,
} from '../index/storage.js'
import { getIndexInfo } from './utils.js'

let fixture: GenerationReadFixture | undefined

afterEach(async () => {
  clearIndexCache()
  if (fixture) await removeGenerationReadFixture(fixture)
  fixture = undefined
})

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

it('contains no raw section index decoding or ambient root lookup', async () => {
  const source = await fs.readFile(
    new URL('./utils.ts', import.meta.url),
    'utf8',
  )
  expect(source).not.toMatch(
    /readFile\([^)]*sections|JSON\.parse|resolveMdmHome|dbIndexDir/,
  )
})
