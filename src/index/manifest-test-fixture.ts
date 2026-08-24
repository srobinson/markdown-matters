import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { expandDeclaredPath } from '../db/canonical.js'
import type { MdmManifest } from '../manifest.js'

export interface ManifestRootsFixture {
  readonly home: string
  readonly first: string
  readonly second: string
  readonly manifest: MdmManifest
}

export const makeManifestRoots = async (
  cleanup: string[],
): Promise<ManifestRootsFixture> => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-corpus-'))
  cleanup.push(parent)
  const home = path.join(parent, 'home')
  const first = path.join(parent, 'first')
  const second = path.join(parent, 'second')
  await Promise.all(
    [home, first, second].map((directory) =>
      fs.mkdir(directory, { recursive: true }),
    ),
  )
  await Promise.all([
    fs.writeFile(
      path.join(first, 'first.md'),
      '# first\n\nalpha corpus words repeated for keyword index coverage with enough additional semantic terms',
    ),
    fs.writeFile(
      path.join(second, 'second.md'),
      '# second\n\nbetasecond corpus words repeated for keyword index coverage with enough additional semantic terms',
    ),
  ])
  const manifest: MdmManifest = {
    directories: [first, second].map((directory) => ({
      path: expandDeclaredPath(directory),
      recurse: true,
    })),
  }
  return { home, first, second, manifest }
}

export const removeFixtureRoots = (cleanup: string[]): Promise<unknown> =>
  Promise.all(
    cleanup.splice(0).map((target) =>
      fs.rm(target, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    ),
  )
