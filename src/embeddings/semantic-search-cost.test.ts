import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { expect, it } from 'vitest'
import { buildIndex } from '../index/indexer.js'
import { estimateEmbeddingCost } from './semantic-search-cost.js'

it('keeps embedding build and estimate roots explicit', async () => {
  const sources = await Promise.all([
    fs.readFile(new URL('./semantic-search-build.ts', import.meta.url), 'utf8'),
    fs.readFile(new URL('./semantic-search-cost.ts', import.meta.url), 'utf8'),
  ])

  for (const source of sources) {
    expect(source).not.toMatch(/resolveMdmHome|dbIndexDir|indexRoot\s*\?\?/)
  }
})

it('excludes source relative path patterns from the estimate', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-cost-path-'))
  const sourceRoot = path.join(parent, 'source')
  const indexRoot = path.join(parent, 'index')

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

    await Effect.runPromise(buildIndex(sourceRoot, { indexRoot }))
    const complete = await Effect.runPromise(
      estimateEmbeddingCost(sourceRoot, { indexRoot }),
    )
    const filtered = await Effect.runPromise(
      estimateEmbeddingCost(sourceRoot, {
        indexRoot,
        excludePatterns: ['docs/*'],
      }),
    )

    expect(complete.totalFiles).toBe(2)
    expect(filtered.totalFiles).toBe(1)
    expect(filtered.totalSections).toBeLessThan(complete.totalSections)
    expect(filtered.totalTokens).toBeLessThan(complete.totalTokens)
  } finally {
    await fs.rm(parent, { recursive: true, force: true })
  }
})
