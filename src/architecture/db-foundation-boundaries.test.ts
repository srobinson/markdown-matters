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

const sourceReaders = [
  'index/bm25-build.ts',
  'search/content-search.ts',
  'duplicates/detector.ts',
  'embeddings/semantic-search-build.ts',
  'embeddings/semantic-search.ts',
  'embeddings/semantic-search-pipeline.ts',
  'cli/commands/search-refine.ts',
] as const

const productionSourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : productionSourceFiles(file)
    }
    const isTestSupport =
      entry.name.endsWith('.test.ts') || entry.name.endsWith('-test-fixture.ts')
    return entry.name.endsWith('.ts') && !isTestSupport ? [file] : []
  })

it.each(sizedFiles)('%s is at most 700 lines', (file) => {
  expect(lines(file)).toBeLessThanOrEqual(700)
})

it.each(sourceReaders)('%s uses resolveSourceFile', (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf-8')
  expect(source).toContain('resolveSourceFile')
})

it('never joins a source root to a stored document path', () => {
  const directJoin =
    /path\.join\([\s\S]{0,120}(documentPath|docPath|(?:section|r)\.documentPath)/
  const offenders = productionSourceFiles(root)
    .filter((file) => directJoin.test(fs.readFileSync(file, 'utf-8')))
    .map((file) => path.relative(root, file))

  expect(offenders).toEqual([])
})
