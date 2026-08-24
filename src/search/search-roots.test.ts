import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'

import { testGenerationSession } from '../db/generation-test-fixture.js'
import { buildIndex } from '../index/indexer.js'
import { search } from './searcher.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

const makeCorpus = async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-search-roots-'))
  cleanup.push(parent)
  const home = path.join(parent, 'home')
  const docs = path.join(parent, 'docs')
  const inside = path.join(docs, 'project')
  const outside = path.join(docs, 'elsewhere')
  await fs.mkdir(home, { recursive: true })
  await fs.mkdir(inside, { recursive: true })
  await fs.mkdir(outside, { recursive: true })
  await Promise.all([
    fs.writeFile(
      path.join(inside, 'inside.md'),
      '# Inside\n\n## Deployment Notes\n\nProject deployment content.\n',
    ),
    fs.writeFile(
      path.join(outside, 'outside.md'),
      '# Outside\n\n## Deployment Notes\n\nUnrelated deployment content.\n',
    ),
  ])
  await Effect.runPromise(buildIndex(docs, { indexRoot: home }))
  return { home, docs, inside, session: testGenerationSession(home) }
}

it('filters results to the given search roots', async () => {
  const { docs, inside, session } = await makeCorpus()

  const scoped = await Effect.runPromise(
    search(session, docs, {
      heading: 'Deployment Notes',
      searchRoots: [inside],
    }),
  )

  expect(scoped).toHaveLength(1)
  expect(scoped[0]!.section.documentPath).toContain('inside.md')
})

it('returns every root when no search roots are given', async () => {
  const { docs, session } = await makeCorpus()

  const results = await Effect.runPromise(
    search(session, docs, { heading: 'Deployment Notes' }),
  )

  expect(results).toHaveLength(2)
})

it('combines search roots with a path pattern', async () => {
  const { docs, inside, session } = await makeCorpus()

  const results = await Effect.runPromise(
    search(session, docs, {
      heading: 'Deployment Notes',
      pathPattern: 'elsewhere',
      searchRoots: [inside],
    }),
  )

  expect(results).toHaveLength(0)
})
