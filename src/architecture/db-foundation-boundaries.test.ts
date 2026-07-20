import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lines = (file: string): number =>
  fs.readFileSync(path.join(root, file), 'utf-8').split('\n').length

const functionLines = (file: string, symbol: string): number => {
  const sourcePath = path.join(root, file)
  const source = fs.readFileSync(sourcePath, 'utf-8')
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  let declaration: ts.FunctionLikeDeclaration | undefined

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === symbol) {
      declaration = node
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === symbol &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      declaration = node.initializer
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  if (!declaration) throw new Error(`Function ${symbol} not found in ${file}`)

  const start = sourceFile.getLineAndCharacterOfPosition(declaration.getStart())
  const end = sourceFile.getLineAndCharacterOfPosition(declaration.getEnd())
  return end.line - start.line + 1
}

const groups = [
  {
    owner: 'embeddings/embedding-namespace.ts',
    modules: ['types', 'paths', 'catalog'].map(
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

it('keeps hybridSearch within the function size limit', () => {
  expect(
    functionLines('search/hybrid-search.ts', 'hybridSearch'),
  ).toBeLessThanOrEqual(150)
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

it('never applies raw path matchers to stored document paths', () => {
  const directDocumentPathMatch =
    /\b(?:matchPath|matchesPathPattern)\(\s*(?:[A-Za-z_$][\w$]*\.)?(?:documentPath|docPath)\b/
  const offenders = productionSourceFiles(root)
    .filter((file) =>
      directDocumentPathMatch.test(fs.readFileSync(file, 'utf-8')),
    )
    .map((file) => path.relative(root, file))

  expect(offenders).toEqual([])
})

it('contains no index compatibility implementation', () => {
  const production = productionSourceFiles(root)
    .map((file) => fs.readFileSync(file, 'utf-8'))
    .join('\n')
  const forbiddenSymbols = [
    ['has', 'LegacyEmbeddings'].join(''),
    ['migrate', 'LegacyEmbeddings'].join(''),
    ['migrate', 'JsonVectorIndex'].join(''),
    ['get', 'LegacyVectorPath'].join(''),
    ['get', 'LegacyMetaPath'].join(''),
    ['get', 'LegacyMetaJsonPath'].join(''),
    ['legacy', 'IndexDir'].join(''),
    ['vectors', 'meta', 'json'].join('.'),
    `${'[['}${'sources'}${']]'}`,
  ]

  for (const symbol of forbiddenSymbols) {
    expect(production).not.toContain(symbol)
  }
})

it('uses only fixed namespaced vector stores', () => {
  const production = productionSourceFiles(root)
    .map((file) => fs.readFileSync(file, 'utf-8'))
    .join('\n')

  expect(production).not.toMatch(
    /createVectorStore\(|\.setNamespace\(|\.setProvider\(|private get(?:Vector|Meta)Path/,
  )
})
