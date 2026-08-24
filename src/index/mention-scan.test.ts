import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'

import { testGenerationSession } from '../db/generation-test-fixture.js'
import { buildIndex } from './index-build.js'
import { renderUnlinkedMentions, scanUnlinkedMentions } from './mention-scan.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

const makeCorpus = async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-mentions-'))
  cleanup.push(parent)
  const home = path.join(parent, 'home')
  const docs = path.join(parent, 'docs')
  await fs.mkdir(home, { recursive: true })
  await fs.mkdir(docs, { recursive: true })
  await Promise.all([
    fs.writeFile(
      path.join(docs, 'authority.md'),
      '# Authority\n\n| Command | Source |\n| --- | --- |\n| gestures | target.md |\n',
    ),
    fs.writeFile(
      path.join(docs, 'target.md'),
      '# Target\n\nThis document mentions its own name: target.md.\n',
    ),
    fs.writeFile(path.join(docs, 'silent.md'), '# Silent\n\nNothing here.\n'),
  ])
  await Effect.runPromise(buildIndex(docs, { indexRoot: home }))
  return { home, docs, session: testGenerationSession(home) }
}

it('finds plain-text mentions of the filename and excludes the document itself', async () => {
  const { docs, session } = await makeCorpus()

  const mentions = await Effect.runPromise(
    scanUnlinkedMentions(session, path.join(docs, 'target.md')),
  )

  expect(mentions).toHaveLength(1)
  expect(mentions[0]).toMatchObject({
    path: await fs.realpath(path.join(docs, 'authority.md')),
    line: 5,
  })
  expect(mentions[0]!.text).toContain('target.md')
})

it('returns no mentions when the filename appears nowhere else', async () => {
  const { docs, session } = await makeCorpus()

  const mentions = await Effect.runPromise(
    scanUnlinkedMentions(session, path.join(docs, 'silent.md')),
  )

  expect(mentions).toEqual([])
})

it('renders mention lines with location and excerpt', () => {
  const lines = renderUnlinkedMentions('target.md', [
    { path: '/corpus/authority.md' as never, line: 5, text: '| target.md |' },
  ])

  expect(lines[0]).toBe('Unlinked mentions of target.md:')
  expect(lines[2]).toBe('  /corpus/authority.md:5  | target.md |')
  expect(renderUnlinkedMentions('target.md', [])).toEqual([])
})
