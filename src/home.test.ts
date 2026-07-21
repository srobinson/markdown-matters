import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

import { dbIndexDir, resolveMdmHome } from './home.js'
import { getIndexPaths } from './index/types.js'

const cleanup: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const target of cleanup.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true })
  }
})

it('tolerates a fresh home, then canonicalizes it without doubling', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-home-'))
  cleanup.push(parent)
  const home = path.join(parent, 'missing')
  vi.stubEnv('MDM_HOME', home)

  expect(resolveMdmHome()).toBe(path.resolve(home))
  expect(fs.existsSync(home)).toBe(false)

  const created = resolveMdmHome({ create: true })
  expect(created).toBe(fs.realpathSync(home))
  expect(dbIndexDir(created)).toBe(created)
  expect(getIndexPaths(created).documents).toBe(
    path.join(created, 'indexes', 'documents.json'),
  )
})
