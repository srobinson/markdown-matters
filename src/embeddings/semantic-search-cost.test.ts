import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { expect, it } from 'vitest'
import { buildIndex } from '../index/indexer.js'
import { estimateEmbeddingCost } from './semantic-search-cost.js'

it('excludes source relative path patterns from the estimate', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-cost-path-'))
  const sourceRoot = path.join(parent, 'source')
  const indexRoot = path.join(parent, 'index')
  const previousHome = process.env.MDM_HOME

  try {
    await Promise.all([
      fs.mkdir(path.join(sourceRoot, 'docs'), { recursive: true }),
      fs.mkdir(indexRoot, { recursive: true }),
    ])
    const content =
      '# Estimate\n\nThese words provide enough indexed tokens for the embedding cost estimate to include this section.\n'
    await Promise.all([
      fs.writeFile(path.join(sourceRoot, 'README.md'), content),
      fs.writeFile(path.join(sourceRoot, 'docs', 'guide.md'), content),
    ])
    process.env.MDM_HOME = indexRoot

    await Effect.runPromise(buildIndex(sourceRoot, { indexRoot }))
    const complete = await Effect.runPromise(estimateEmbeddingCost(sourceRoot))
    const filtered = await Effect.runPromise(
      estimateEmbeddingCost(sourceRoot, { excludePatterns: ['docs/*'] }),
    )

    expect(complete.totalFiles).toBe(2)
    expect(filtered.totalFiles).toBe(1)
    expect(filtered.totalSections).toBeLessThan(complete.totalSections)
    expect(filtered.totalTokens).toBeLessThan(complete.totalTokens)
  } finally {
    if (previousHome === undefined) delete process.env.MDM_HOME
    else process.env.MDM_HOME = previousHome
    await fs.rm(parent, { recursive: true, force: true })
  }
})
