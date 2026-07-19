import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lines = (file: string): number =>
  fs.readFileSync(path.join(root, file), 'utf-8').split('\n').length

const groups = [
  {
    owner: 'embeddings/embedding-namespace.ts',
    modules: ['types', 'paths', 'catalog', 'migration'].map(
      (name) => `embeddings/embedding-namespace-${name}.ts`,
    ),
  },
  {
    owner: 'embeddings/vector-store.ts',
    modules: ['types', 'codec'].map(
      (name) => `embeddings/vector-store-${name}.ts`,
    ),
  },
  {
    owner: 'index/indexer.ts',
    modules: [
      'file-discovery',
      'index-state',
      'link-index',
      'bm25-build',
      'index-build',
    ].map((name) => `index/${name}.ts`),
  },
  {
    owner: 'search/searcher.ts',
    modules: ['regex', 'content-search', 'context'].map(
      (name) => `search/${name}.ts`,
    ),
  },
  {
    owner: 'cli/commands/search.ts',
    modules: ['refine', 'mode', 'output', 'summarization', 'embeddings'].map(
      (name) => `cli/commands/search-${name}.ts`,
    ),
  },
] as const

const sizedFiles = groups.flatMap(({ owner, modules }) =>
  modules.every((file) => fs.existsSync(path.join(root, file)))
    ? [owner, ...modules]
    : [],
)

it.each(sizedFiles)('%s is at most 700 lines', (file) => {
  expect(lines(file)).toBeLessThanOrEqual(700)
})
