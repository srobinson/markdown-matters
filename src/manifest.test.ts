import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { expandDeclaredPath } from './db/canonical.js'
import {
  appendManifestDirectory,
  loadManifest,
  manifestPath,
} from './manifest.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

describe('manifest', () => {
  it('loads defaults and appends an absolute declared path once', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-manifest-'))
    cleanup.push(home)
    await fs.writeFile(
      manifestPath(home),
      '[[dir]]\npath = "~/notes"\n\n[[dir]]\npath = "/tmp/shallow"\nrecurse = true\ndepth = 2\n',
    )

    const loaded = await Effect.runPromise(loadManifest(home))
    expect(loaded.directories).toEqual([
      { path: expandDeclaredPath('~/notes'), recurse: true },
      {
        path: expandDeclaredPath('/tmp/shallow'),
        recurse: true,
        depth: 2,
      },
    ])

    const source = path.join(home, 'source')
    await fs.mkdir(source)
    expect(
      (await Effect.runPromise(appendManifestDirectory(home, { path: source })))
        .added,
    ).toBe(true)
    expect(
      (await Effect.runPromise(appendManifestDirectory(home, { path: source })))
        .added,
    ).toBe(false)
    expect(
      (await Effect.runPromise(loadManifest(home))).directories,
    ).toHaveLength(3)
  })

  it('rejects a contradictory non-recursive depth', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-manifest-'))
    cleanup.push(home)
    await fs.writeFile(
      manifestPath(home),
      '[[dir]]\npath="/tmp/notes"\nrecurse=false\ndepth=2\n',
    )

    await expect(
      Effect.runPromise(Effect.flip(loadManifest(home))),
    ).resolves.toMatchObject({ _tag: 'ManifestError' })
  })

  it('normalizes a declared path without resolving its target', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-manifest-'))
    cleanup.push(home)
    const declared = path.join(home, 'missing', '..', 'declared')

    const result = await Effect.runPromise(
      appendManifestDirectory(home, { path: declared }),
    )

    expect(result.manifest.directories).toEqual([
      { path: path.join(home, 'declared'), recurse: true },
    ])
    await expect(fs.access(path.join(home, 'declared'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
