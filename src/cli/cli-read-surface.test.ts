import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executeCli } from './cli-test-runner.js'

const FIXTURE_SOURCE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'cli')

const emptyDuplicatesJson = {
  sectionsAnalyzed: 0,
  duplicatePairs: 0,
  sectionsWithDuplicates: 0,
  groupCount: 0,
  groups: [],
}

const readCommands = [
  ['search', 'search needle . --keyword', 'search needle . --keyword --json'],
  ['stats', 'stats', 'stats --json'],
  ['links', 'links README.md', 'links README.md --json'],
  ['backlinks', 'backlinks README.md', 'backlinks README.md --json'],
  ['duplicates', 'duplicates', 'duplicates --json'],
  ['embeddings list', 'embeddings list', 'embeddings list --json'],
  ['embeddings current', 'embeddings current', 'embeddings current --json'],
] as const

describe('CLI read surface', () => {
  let parent = ''
  let sourceRoot = ''
  let emptyHome = ''
  let emptyIndexedHome = ''
  let emptyIndexedSource = ''

  beforeAll(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-read-surface-'))
    sourceRoot = path.join(parent, 'source')
    emptyHome = path.join(parent, 'empty-home')
    emptyIndexedHome = path.join(parent, 'empty-indexed-home')
    emptyIndexedSource = path.join(parent, 'empty-indexed-source')
    await Promise.all([
      fs.cp(FIXTURE_SOURCE_DIR, sourceRoot, { recursive: true }),
      fs.mkdir(emptyHome),
      fs.mkdir(emptyIndexedHome),
      fs.mkdir(emptyIndexedSource),
    ])

    const indexed = await executeCli('index . --force --no-embed', {
      cwd: emptyIndexedSource,
      env: { ...process.env, MDM_HOME: emptyIndexedHome },
    })
    if (indexed.exitCode !== 0) {
      throw new Error(indexed.stderr || indexed.stdout)
    }
  })

  afterAll(async () => {
    await fs.rm(parent, { recursive: true, force: true })
  })

  describe('zero state guidance', () => {
    for (const [name, textArgs, jsonArgs] of readCommands) {
      it(`${name} renders shared text guidance`, async () => {
        const result = await executeCli(textArgs, {
          cwd: sourceRoot,
          env: { ...process.env, MDM_HOME: emptyHome },
        })

        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('No index found.')
        expect(result.stdout).toContain('Run: mdm index /path/to/docs')
        expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
          /GenerationReadError|No current generation exists|Stack trace/,
        )
      })

      it(`${name} renders shared JSON guidance`, async () => {
        const result = await executeCli(jsonArgs, {
          cwd: sourceRoot,
          env: { ...process.env, MDM_HOME: emptyHome },
        })

        expect(result.exitCode).toBe(0)
        const output = JSON.parse(result.stdout)
        if (name === 'duplicates') {
          expect(output).toEqual(emptyDuplicatesJson)
        } else {
          expect(output).toMatchObject({
            error: 'No index found.',
            guidance: 'Run: mdm index /path/to/docs',
          })
        }
        expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
          /GenerationReadError|No current generation exists|Stack trace/,
        )
      })
    }

    it('returns the normal empty JSON shape for an indexed empty corpus', async () => {
      const result = await executeCli('duplicates --json', {
        cwd: emptyIndexedSource,
        env: { ...process.env, MDM_HOME: emptyIndexedHome },
      })

      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(emptyDuplicatesJson)
    })

    it('keeps source only commands usable without an index', async () => {
      const [tree, context] = await Promise.all([
        executeCli('tree README.md', {
          cwd: sourceRoot,
          env: { ...process.env, MDM_HOME: emptyHome },
        }),
        executeCli('context README.md', {
          cwd: sourceRoot,
          env: { ...process.env, MDM_HOME: emptyHome },
        }),
      ])

      expect(tree.exitCode).toBe(0)
      expect(tree.stdout).toContain('# Test Project')
      expect(context.exitCode).toBe(0)
      expect(context.stdout).toContain('# Test Project')
    })
  })
})

describe('CLI positional search path', () => {
  let parent = ''
  let sourceRoot = ''
  let home = ''
  let scopedPath = ''
  let emptyPath = ''
  let unindexedPath = ''
  let consumerPath = ''
  let literalPath = ''

  const runSearch = (args: string) =>
    executeCli(args, {
      cwd: sourceRoot,
      env: { ...process.env, MDM_HOME: home },
    })

  beforeAll(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-search-path-'))
    sourceRoot = path.join(parent, 'source')
    home = path.join(parent, 'home')
    scopedPath = path.join(sourceRoot, 'scoped')
    emptyPath = path.join(sourceRoot, 'empty')
    unindexedPath = path.join(parent, 'unindexed')
    consumerPath = path.join(parent, 'consumer')
    literalPath = path.join(sourceRoot, 'literal*?')

    await Promise.all([
      fs.mkdir(scopedPath, { recursive: true }),
      fs.mkdir(emptyPath, { recursive: true }),
      fs.mkdir(unindexedPath, { recursive: true }),
      fs.mkdir(consumerPath, { recursive: true }),
      fs.mkdir(literalPath, { recursive: true }),
      fs.mkdir(path.join(sourceRoot, 'literal-decoyX'), { recursive: true }),
      fs.mkdir(home, { recursive: true }),
    ])
    await Promise.all([
      fs.writeFile(
        path.join(scopedPath, 'inside.md'),
        '# Inside\n\nscope-marker shared content\n',
      ),
      fs.writeFile(
        path.join(sourceRoot, 'outside.md'),
        '# Outside\n\nscope-marker shared content\n',
      ),
      fs.writeFile(
        path.join(unindexedPath, 'unindexed.md'),
        '# Unindexed\n\nscope-marker shared content\n',
      ),
      fs.writeFile(
        path.join(literalPath, 'inside.md'),
        '# Literal\n\nliteral-marker shared content\n',
      ),
      fs.writeFile(
        path.join(sourceRoot, 'literal-decoyX', 'outside.md'),
        '# Literal decoy\n\nliteral-marker shared content\n',
      ),
    ])

    const indexed = await executeCli('index . --force --no-embed', {
      cwd: sourceRoot,
      env: { ...process.env, MDM_HOME: home },
    })
    if (indexed.exitCode !== 0) {
      throw new Error(indexed.stderr || indexed.stdout)
    }
  }, 60_000)

  afterAll(async () => {
    await fs.rm(parent, { recursive: true, force: true })
  })

  it('restricts keyword results to an indexed subtree', async () => {
    const result = await runSearch(
      'search scope-marker scoped --keyword --json',
    )

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout) as {
      readonly results: readonly { readonly path: string }[]
    }
    expect(output.results.map((entry) => entry.path)).toEqual([
      await fs.realpath(path.join(scopedPath, 'inside.md')),
    ])
  })

  it('searches the whole corpus when the path is omitted', async () => {
    const result = await executeCli('search scope-marker --keyword --json', {
      cwd: consumerPath,
      env: { ...process.env, MDM_HOME: home },
    })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout) as {
      readonly results: readonly { readonly path: string }[]
    }
    expect(new Set(output.results.map((entry) => entry.path))).toEqual(
      new Set([
        await fs.realpath(path.join(scopedPath, 'inside.md')),
        await fs.realpath(path.join(sourceRoot, 'outside.md')),
      ]),
    )
  })

  it('restricts hybrid results to an indexed subtree', async () => {
    const result = await runSearch(
      'search scope-marker scoped --mode hybrid --json',
    )

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout) as {
      readonly results: readonly { readonly path: string }[]
    }
    expect(output.results.map((entry) => entry.path)).toEqual([
      await fs.realpath(path.join(scopedPath, 'inside.md')),
    ])
  })

  it('treats glob metacharacters in an explicit path literally', async () => {
    const result = await runSearch(
      "search literal-marker 'literal*?' --keyword --json",
    )

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout) as {
      readonly results: readonly { readonly path: string }[]
    }
    expect(output.results.map((entry) => entry.path)).toEqual([
      await fs.realpath(path.join(literalPath, 'inside.md')),
    ])
  })

  it('guides an existing unindexed directory without corpus leakage', async () => {
    const result = await runSearch('search scope-marker ../unindexed --keyword')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      `No indexed documents found in ${await fs.realpath(unindexedPath)}.`,
    )
    expect(result.stdout).toContain(
      `Run: mdm index ${await fs.realpath(unindexedPath)}`,
    )
    expect(result.stdout).not.toContain('inside.md')
    expect(result.stdout).not.toContain('outside.md')
  })

  it('guides an empty indexed subtree in JSON', async () => {
    const result = await runSearch('search scope-marker empty --keyword --json')

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      error: 'No indexed documents found.',
      path: await fs.realpath(emptyPath),
      guidance: `Run: mdm index ${await fs.realpath(emptyPath)}`,
    })
  })

  it('preserves ordinary zero results inside an indexed subtree', async () => {
    const result = await runSearch(
      'search absent-marker scoped --keyword --json',
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ results: [] })
  })
})
