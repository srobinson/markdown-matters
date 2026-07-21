import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultConfig } from '../config/schema.js'
import type { DocumentKey } from '../db/canonical.js'
import { refreshManifestIndex } from '../index/manifest-refresh.js'
import { appendManifestDirectory } from '../manifest.js'

const semanticResult = vi.hoisted(() => ({
  current: [] as Array<{
    sectionId: string
    documentPath: DocumentKey
    heading: string
    similarity: number
  }>,
}))

vi.mock('../embeddings/semantic-search.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../embeddings/semantic-search.js')>()
  return {
    ...actual,
    semanticSearch: () => Effect.succeed(semanticResult.current),
  }
})

import {
  handleMdBacklinks,
  handleMdLinks,
  handleMdm,
  handleMdSearch,
  handleMdStructure,
} from './handlers.js'

interface PathFixture {
  readonly parent: string
  readonly home: string
  readonly callerRoot: string
  readonly source: string
  readonly sourceAlias: string
  readonly target: string
  readonly inbound: string
  readonly outside: string
}

const resultText = (result: CallToolResult): string =>
  result.content
    .filter(
      (item): item is { type: 'text'; text: string } => item.type === 'text',
    )
    .map(({ text }) => text)
    .join('\n')

const createFixture = async (): Promise<PathFixture> => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-round-trip-'))
  const home = path.join(parent, 'mdm-home')
  const callerRoot = path.join(parent, 'caller')
  const mdxRoot = path.join(parent, 'home-corpus', '.mdx')
  const repoRoot = path.join(parent, 'workspace', 'project-docs')
  await Promise.all(
    [home, callerRoot, mdxRoot, repoRoot].map((directory) =>
      fs.mkdir(directory, { recursive: true }),
    ),
  )

  const contentRoot = path.join(repoRoot, 'content')
  const source = path.join(contentRoot, 'search-source.md')
  const sourceAlias = path.join(repoRoot, 'search-source-alias.md')
  const target = path.join(contentRoot, 'target.md')
  const inbound = path.join(contentRoot, 'inbound.md')
  const outside = path.join(callerRoot, 'outside.md')
  await fs.mkdir(contentRoot, { recursive: true })
  await Promise.all([
    fs.writeFile(source, '# Search Source\n\n[Target](./target.md)\n'),
    fs.writeFile(target, '# Target\n\nTarget content.\n'),
    fs.writeFile(inbound, '# Inbound\n\n[Source](./search-source.md)\n'),
    fs.writeFile(path.join(mdxRoot, 'notes.md'), '# MDX Notes\n'),
    fs.writeFile(outside, '# Outside\n\nCaller content.\n'),
  ])
  await fs.symlink(source, sourceAlias, 'file')
  await Effect.runPromise(appendManifestDirectory(home, { path: mdxRoot }))
  await Effect.runPromise(appendManifestDirectory(home, { path: repoRoot }))
  await Effect.runPromise(
    refreshManifestIndex(home, undefined, {
      force: true,
      followSymlinks: true,
      semantic: { mode: 'skip' },
    }),
  )

  return {
    parent,
    home,
    callerRoot,
    source: await fs.realpath(source),
    sourceAlias,
    target: await fs.realpath(target),
    inbound: await fs.realpath(inbound),
    outside: await fs.realpath(outside),
  }
}

const inspectWithEveryPathTool = (
  filePath: string,
): Promise<readonly CallToolResult[]> =>
  Promise.all([
    handleMdm({ path: filePath, level: 'brief' }),
    handleMdStructure({ path: filePath }),
    handleMdLinks({ path: filePath }),
    handleMdBacklinks({ path: filePath }),
  ])

const emittedSearchPaths = (result: CallToolResult): readonly string[] =>
  resultText(result)
    .split('\n')
    .filter((line) => line.startsWith('   '))
    .map((line) => line.trim())

describe('MCP multi-root path round-trip contract', () => {
  let fixture: PathFixture
  let previousHome: string | undefined

  beforeEach(async () => {
    previousHome = process.env.MDM_HOME
    fixture = await createFixture()
    process.env.MDM_HOME = fixture.home
    semanticResult.current = [
      {
        sectionId: 'search-source',
        documentPath: fixture.source as DocumentKey,
        heading: 'Search Source',
        similarity: 0.99,
      },
    ]
  })

  afterEach(async () => {
    semanticResult.current = []
    if (previousHome === undefined) delete process.env.MDM_HOME
    else process.env.MDM_HOME = previousHome
    await fs.rm(fixture.parent, { recursive: true, force: true })
  })

  it('round-trips every canonical path emitted by md_search through all four tools', async () => {
    const search = await handleMdSearch(
      { query: 'search source' },
      fixture.callerRoot,
      defaultConfig,
    )
    expect(search.isError).toBeFalsy()
    const searchPaths = emittedSearchPaths(search)
    expect(searchPaths).toEqual([fixture.source])

    for (const emittedPath of searchPaths) {
      const results = await inspectWithEveryPathTool(emittedPath)
      expect(results.every((result) => !result.isError)).toBe(true)
      expect(resultText(results[0]!)).toContain('Search Source')
      expect(resultText(results[1]!)).toContain('Search Source')
      expect(resultText(results[2]!)).toContain(fixture.target)
      expect(resultText(results[3]!)).toContain(fixture.inbound)
    }
  })

  it('normalizes a symlink alias to the emitted canonical document path', async () => {
    const canonical = await inspectWithEveryPathTool(fixture.source)
    const alias = await inspectWithEveryPathTool(fixture.sourceAlias)

    expect(alias.map(resultText)).toEqual(canonical.map(resultText))
  })

  it('resolves relative paths against every served root instead of process CWD', async () => {
    const results = await inspectWithEveryPathTool('content/search-source.md')

    expect(results.every((result) => !result.isError)).toBe(true)
    expect(resultText(results[0]!)).toContain('Search Source')
    expect(resultText(results[1]!)).toContain('Search Source')
    expect(resultText(results[2]!)).toContain(fixture.target)
    expect(resultText(results[3]!)).toContain(fixture.inbound)
  })

  it('returns a clear typed signal for a path outside the indexed corpus', async () => {
    const results = await inspectWithEveryPathTool(fixture.outside)

    for (const result of results) {
      expect(result.isError).toBe(true)
      expect(resultText(result)).toContain('Path not in indexed corpus')
    }
    expect(resultText(results[2]!)).not.toContain('No outgoing links')
    expect(resultText(results[3]!)).not.toContain('No incoming links')
  })
})
