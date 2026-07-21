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
import { search, searchContent } from '../search/content-search.js'
import { getContext } from '../search/context.js'

let fixture: GenerationReadFixture | undefined

afterEach(async () => {
  if (fixture) await removeGenerationReadFixture(fixture)
  fixture = undefined
})

const openLeases = (root: string): Promise<string[]> =>
  fs.readdir(`${root}/leases/open`)

it('keeps every structural read on one leased generation', async () => {
  fixture = await createGenerationReadFixture()

  const held = await Effect.runPromise(
    withCurrentGeneration(fixture.home, (session) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => setFixtureCurrent(fixture!, fixture!.gen2))
        const headingResults = yield* search(session, fixture!.sourceRoot, {
          heading: 'gen-1',
        })
        const contentResults = yield* searchContent(
          session,
          fixture!.sourceRoot,
          { content: 'Repeated' },
        )
        const context = yield* getContext(
          session,
          fixture!.sourceRoot,
          fixture!.primaryFile,
        )
        return {
          generation: session.generation,
          headings: [
            ...headingResults.map(({ section }) => section.heading),
            ...contentResults.map(({ section }) => section.heading),
            ...context.sections.map(({ heading }) => heading),
          ],
        }
      }),
    ),
  )

  expect(held.generation).toBe('gen-1')
  expect(held.headings.length).toBeGreaterThan(0)
  expect(new Set(held.headings.map((heading) => heading.slice(0, 5)))).toEqual(
    new Set(['gen-1']),
  )

  const next = await Effect.runPromise(
    withCurrentGeneration(fixture.home, (session) =>
      search(session, fixture!.sourceRoot, { heading: 'gen-2' }),
    ),
  )
  expect(next.map(({ section }) => section.heading)).toEqual([
    'gen-2-heading-1',
    'gen-2-heading-2',
    'gen-2-heading-3',
  ])
  await expect(openLeases(fixture.gen1.root)).resolves.toEqual([])
  await expect(openLeases(fixture.gen2.root)).resolves.toEqual([])
})

it('keeps structural readers free of ambient home resolution', async () => {
  const sources = await Promise.all([
    fs.readFile(
      new URL('../search/content-search.ts', import.meta.url),
      'utf8',
    ),
    fs.readFile(new URL('../search/context.ts', import.meta.url), 'utf8'),
  ])
  expect(sources.join('\n')).not.toMatch(/resolveMdmHome|dbIndexDir/)
})
