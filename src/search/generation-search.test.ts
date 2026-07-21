import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'
import {
  createGenerationReadFixture,
  type GenerationReadFixture,
  removeGenerationReadFixture,
  setFixtureCurrent,
} from '../db/generation-read-test-fixture.js'
import { withCurrentGeneration } from '../db/generation-reader.js'
import { hybridSearch } from './hybrid-search.js'

let fixture: GenerationReadFixture | undefined

afterEach(async () => {
  if (fixture) await removeGenerationReadFixture(fixture)
  fixture = undefined
})

it('keeps a complete search pipeline on one leased generation', async () => {
  fixture = await createGenerationReadFixture()

  const held = await Effect.runPromise(
    withCurrentGeneration(fixture.home, (session) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => setFixtureCurrent(fixture!, fixture!.gen2))
        const result = yield* hybridSearch(
          session,
          fixture!.sourceRoot,
          'generation',
          { mode: 'keyword', limit: 10 },
        )
        const leases = yield* Effect.promise(() =>
          fs.readdir(path.join(session.indexRoot, 'leases', 'open')),
        )
        return { result, generation: session.generation, leases }
      }),
    ),
  )

  expect(held.generation).toBe('gen-1')
  expect(held.leases).toHaveLength(1)
  expect(held.result.results).toHaveLength(3)
  expect(
    held.result.results.every(({ heading }) => heading.startsWith('gen-1-')),
  ).toBe(true)

  const next = await Effect.runPromise(
    withCurrentGeneration(fixture.home, (session) =>
      hybridSearch(session, fixture!.sourceRoot, 'generation', {
        mode: 'keyword',
        limit: 10,
      }),
    ),
  )
  expect(
    next.results.every(({ heading }) => heading.startsWith('gen-2-')),
  ).toBe(true)
  await expect(
    fs.readdir(path.join(fixture.gen1.root, 'leases', 'open')),
  ).resolves.toEqual([])
  await expect(
    fs.readdir(path.join(fixture.gen2.root, 'leases', 'open')),
  ).resolves.toEqual([])
})

it('keeps semantic search loaders free of ambient home resolution', async () => {
  const source = await fs.readFile(
    new URL('../embeddings/semantic-search-pipeline.ts', import.meta.url),
    'utf8',
  )
  expect(source).not.toMatch(/resolveMdmHome|dbIndexDir/)
})
