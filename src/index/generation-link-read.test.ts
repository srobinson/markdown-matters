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
import { detectDuplicates } from '../duplicates/detector.js'
import {
  getIncomingLinks,
  getOutgoingLinks,
  resolveIndexedDocumentKey,
} from './link-index.js'

let fixture: GenerationReadFixture | undefined

afterEach(async () => {
  if (fixture) await removeGenerationReadFixture(fixture)
  fixture = undefined
})

it('keeps links and duplicate sections on one leased generation', async () => {
  fixture = await createGenerationReadFixture()

  const held = await Effect.runPromise(
    withCurrentGeneration(fixture.home, (session) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => setFixtureCurrent(fixture!, fixture!.gen2))
        const outgoing = yield* getOutgoingLinks(session, fixture!.primaryFile)
        const incoming = yield* getIncomingLinks(session, fixture!.primaryFile)
        const documentKey = yield* resolveIndexedDocumentKey(
          session,
          fixture!.primaryFile,
        )
        const duplicates = yield* detectDuplicates(
          session,
          fixture!.sourceRoot,
          { minContentLength: 20 },
        )
        return { outgoing, incoming, documentKey, duplicates }
      }),
    ),
  )

  expect(held.documentKey).toBe(await fs.realpath(fixture.primaryFile))
  const canonicalSourceRoot = await fs.realpath(fixture.sourceRoot)
  expect(held.outgoing).toEqual([
    path.resolve(canonicalSourceRoot, 'gen-1-target.md'),
  ])
  expect(held.incoming).toEqual([
    path.resolve(canonicalSourceRoot, 'gen-1-inbound.md'),
  ])
  expect(held.duplicates.groups).toHaveLength(1)
  expect(held.duplicates.groups[0]?.primary.heading).toMatch(/^gen-1-/)
  expect(
    held.duplicates.groups[0]?.duplicates.every(({ heading }) =>
      heading.startsWith('gen-1-'),
    ),
  ).toBe(true)

  const next = await Effect.runPromise(
    withCurrentGeneration(fixture.home, (session) =>
      getOutgoingLinks(session, fixture!.primaryFile),
    ),
  )
  expect(next).toEqual([path.resolve(canonicalSourceRoot, 'gen-2-target.md')])
  await expect(
    fs.readdir(path.join(fixture.gen1.root, 'leases', 'open')),
  ).resolves.toEqual([])
  await expect(
    fs.readdir(path.join(fixture.gen2.root, 'leases', 'open')),
  ).resolves.toEqual([])
})

it('keeps link and duplicate readers free of ambient home resolution', async () => {
  const sources = await Promise.all([
    fs.readFile(new URL('./link-index.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('../duplicates/detector.ts', import.meta.url), 'utf8'),
  ])
  expect(sources.join('\n')).not.toMatch(/resolveMdmHome|dbIndexDir/)
})
