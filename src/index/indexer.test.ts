import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildIndex,
  getBrokenLinks,
  getIncomingLinks,
  getOutgoingLinks,
} from './indexer.js'

describe('indexer link graph maintenance', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdcontext-indexer-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('rebuilds backward links when a document changes targets', async () => {
    const alphaPath = path.join(tempDir, 'alpha.md')
    const betaPath = path.join(tempDir, 'beta.md')
    const gammaPath = path.join(tempDir, 'gamma.md')

    await fs.writeFile(alphaPath, '# Alpha\n\n[Beta](./beta.md)\n')
    await fs.writeFile(betaPath, '# Beta\n')
    await fs.writeFile(gammaPath, '# Gamma\n')

    await Effect.runPromise(buildIndex(tempDir))

    expect(
      await Effect.runPromise(getIncomingLinks(tempDir, betaPath)),
    ).toEqual(['alpha.md'])

    await fs.writeFile(alphaPath, '# Alpha\n\n[Gamma](./gamma.md)\n')
    await Effect.runPromise(buildIndex(tempDir))

    expect(
      await Effect.runPromise(getIncomingLinks(tempDir, betaPath)),
    ).toEqual([])
    expect(
      await Effect.runPromise(getIncomingLinks(tempDir, gammaPath)),
    ).toEqual(['alpha.md'])
    expect(
      await Effect.runPromise(getOutgoingLinks(tempDir, alphaPath)),
    ).toEqual(['gamma.md'])
  })

  it('deduplicates broken links when multiple files reference the same missing target', async () => {
    await fs.writeFile(
      path.join(tempDir, 'alpha.md'),
      '# Alpha\n\n[Missing](./missing.md)\n[Missing again](./missing.md)\n',
    )
    await fs.writeFile(
      path.join(tempDir, 'beta.md'),
      '# Beta\n\n[Missing](./missing.md)\n',
    )

    await Effect.runPromise(buildIndex(tempDir))

    expect(await Effect.runPromise(getBrokenLinks(tempDir))).toEqual([
      'missing.md',
    ])
  })
})
