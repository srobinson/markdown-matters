import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { expect, it } from 'vitest'
import { buildIndex } from '../index/indexer.js'
import type { EmbeddingClient } from '../providers/index.js'
import { buildEmbeddings } from './semantic-search-build.js'

const client: EmbeddingClient = {
  embed: (texts, options) =>
    Effect.succeed({
      embeddings: texts.map(() =>
        Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0)),
      ),
      model: options?.model ?? 'text-embedding-3-small',
      usage: { inputTokens: texts.length * 20 },
    }),
}

it('excludes source relative path patterns from embedding builds', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-build-path-'))
  const sourceRoot = path.join(parent, 'source')
  const indexRoot = path.join(parent, 'index')
  const previousHome = process.env.MDM_HOME

  try {
    await Promise.all([
      fs.mkdir(path.join(sourceRoot, 'docs'), { recursive: true }),
      fs.mkdir(indexRoot, { recursive: true }),
    ])
    const content =
      '# Embedding\n\nThese words provide enough indexed tokens for this section to be eligible for an embedding build.\n'
    await Promise.all([
      fs.writeFile(path.join(sourceRoot, 'README.md'), content),
      fs.writeFile(path.join(sourceRoot, 'docs', 'guide.md'), content),
    ])
    process.env.MDM_HOME = indexRoot

    await Effect.runPromise(buildIndex(sourceRoot, { indexRoot }))
    const result = await Effect.runPromise(
      buildEmbeddings(sourceRoot, {
        client,
        excludePatterns: ['docs/*'],
        force: true,
      }),
    )

    expect(result.filesProcessed).toBe(1)
    expect(result.sectionsEmbedded).toBeGreaterThan(0)
  } finally {
    if (previousHome === undefined) delete process.env.MDM_HOME
    else process.env.MDM_HOME = previousHome
    await fs.rm(parent, { recursive: true, force: true })
  }
})
