import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executeCli } from './cli-test-runner.js'

const FIXTURE_SOURCE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'cli')

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

  beforeAll(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-read-surface-'))
    sourceRoot = path.join(parent, 'source')
    emptyHome = path.join(parent, 'empty-home')
    await Promise.all([
      fs.cp(FIXTURE_SOURCE_DIR, sourceRoot, { recursive: true }),
      fs.mkdir(emptyHome),
    ])
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
        expect(JSON.parse(result.stdout)).toMatchObject({
          error: 'No index found.',
          guidance: 'Run: mdm index /path/to/docs',
        })
        expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
          /GenerationReadError|No current generation exists|Stack trace/,
        )
      })
    }

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

    await Promise.all([
      fs.mkdir(scopedPath, { recursive: true }),
      fs.mkdir(emptyPath, { recursive: true }),
      fs.mkdir(unindexedPath, { recursive: true }),
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
