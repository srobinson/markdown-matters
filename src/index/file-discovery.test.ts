import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import ignore from 'ignore'
import { afterEach, expect, it } from 'vitest'

import { discoverFiles } from './file-discovery.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

it('follows contained symlinks without accepting sibling prefix targets', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-discovery-'))
  cleanup.push(parent)
  const root = path.join(parent, 'work')
  const inside = path.join(root, 'inside')
  const sibling = path.join(parent, 'work-notes')
  await Promise.all([
    fs.mkdir(inside, { recursive: true }),
    fs.mkdir(sibling, { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(path.join(inside, 'inside.md'), '# Inside\n'),
    fs.writeFile(path.join(sibling, 'outside.md'), '# Outside\n'),
  ])

  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  await Promise.all([
    fs.symlink(inside, path.join(root, 'inside-link'), linkType),
    fs.symlink(sibling, path.join(root, 'outside-link'), linkType),
  ])

  const result = await Effect.runPromise(
    discoverFiles(root, ignore(), { followSymlinks: true }),
  )

  expect(result.files.sort()).toEqual(
    [
      path.join(inside, 'inside.md'),
      path.join(root, 'inside-link', 'inside.md'),
    ].sort(),
  )
})
