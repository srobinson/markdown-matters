import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { canonicalizeDiscoveredFiles, discoverFiles } from './file-discovery.js'
import { createIgnoreFilter } from './ignore-patterns.js'

const cleanup: string[] = []

const makeTree = async (
  entries: Readonly<Record<string, string>>,
): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-discovery-'))
  cleanup.push(root)
  await Promise.all(
    Object.entries(entries).map(async ([relativePath, content]) => {
      const filePath = path.join(root, relativePath)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content)
    }),
  )
  return root
}

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

it('re-anchors nested ignores and honors negation across levels', async () => {
  const root = await makeTree({
    '.gitignore': '*.md\n',
    'top.md': '# top',
    'notes/.gitignore': '!keep.md\n',
    'notes/keep.md': '# keep',
    'notes/drop.md': '# drop',
    'other/keep.md': '# other keep',
  })
  const filter = await Effect.runPromise(createIgnoreFilter({ rootPath: root }))
  const result = await Effect.runPromise(
    discoverFiles(root, filter, { recurse: true }),
  )

  expect(result.files).toEqual([path.join(root, 'notes', 'keep.md')])
})

it('does not read an ignore file below an ignored directory', async () => {
  const root = await makeTree({
    '.gitignore': 'drafts/\n',
    'drafts/.gitignore': '!keep.md\n',
    'drafts/keep.md': '# keep',
  })
  const filter = await Effect.runPromise(createIgnoreFilter({ rootPath: root }))

  expect(
    (await Effect.runPromise(discoverFiles(root, filter, { recurse: true })))
      .files,
  ).toEqual([])
})

it.each([
  [{ recurse: false }, ['root.md']],
  [{ recurse: true, depth: 0 }, ['root.md']],
  [{ recurse: true, depth: 1 }, ['root.md', 'one/one.md']],
])('bounds descent with %o', async (options, expected) => {
  const root = await makeTree({
    'root.md': '# root',
    'one/one.md': '# one',
    'one/two/two.md': '# two',
  })
  const filter = await Effect.runPromise(createIgnoreFilter({ rootPath: root }))
  const result = await Effect.runPromise(discoverFiles(root, filter, options))

  expect(result.files.map((file) => path.relative(root, file)).sort()).toEqual(
    [...expected].sort(),
  )
})

it('skips hidden entries before applying nested ignore rules', async () => {
  const root = await makeTree({
    'visible.md': '# visible',
    '.notes/.gitignore': '!keep.md\n',
    '.notes/keep.md': '# keep',
  })
  const hierarchy = await Effect.runPromise(
    createIgnoreFilter({ rootPath: root }),
  )
  const result = await Effect.runPromise(
    discoverFiles(root, hierarchy, { recurse: true }),
  )

  expect(result.files).toEqual([path.join(root, 'visible.md')])
  expect(result.skipped.hidden).toBe(1)
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

  const hierarchy = await Effect.runPromise(
    createIgnoreFilter({ rootPath: root }),
  )
  const result = await Effect.runPromise(
    discoverFiles(root, hierarchy, { followSymlinks: true }),
  )

  expect(result.files.sort()).toEqual(
    [
      path.join(inside, 'inside.md'),
      path.join(root, 'inside-link', 'inside.md'),
    ].sort(),
  )
})

it('probes case sensitivity once per device while grouping a batch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-discovery-'))
  cleanup.push(root)
  const first = path.join(root, 'first.md')
  const second = path.join(root, 'second.md')
  await fs.writeFile(first, '# First\n')
  await fs.writeFile(second, '# Second\n')
  const probe = vi.fn().mockResolvedValue(true)

  const result = await Effect.runPromise(
    canonicalizeDiscoveredFiles([first, second], probe),
  )

  expect(result.selections).toHaveLength(2)
  expect(probe).toHaveBeenCalledTimes(1)
})
