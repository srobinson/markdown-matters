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
  readonly firstRoot: string
  readonly secondRoot: string
  readonly source: string
  readonly target: string
  readonly inbound: string
  readonly second: string
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
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-mcp-path-'))
  const home = path.join(parent, 'home')
  const callerRoot = path.join(parent, 'caller')
  const firstRoot = path.join(parent, 'first')
  const secondRoot = path.join(parent, 'second')
  await Promise.all(
    [home, callerRoot, firstRoot, secondRoot].map((directory) =>
      fs.mkdir(directory, { recursive: true }),
    ),
  )

  const source = path.join(firstRoot, 'source.md')
  const target = path.join(firstRoot, 'target.md')
  const inbound = path.join(firstRoot, 'inbound.md')
  const second = path.join(secondRoot, 'second.md')
  const outside = path.join(callerRoot, 'outside.md')
  await Promise.all([
    fs.writeFile(source, '# Search Source\n\n[Target](./target.md)\n'),
    fs.writeFile(target, '# Target\n\nTarget content.\n'),
    fs.writeFile(inbound, '# Inbound\n\n[Source](./source.md)\n'),
    fs.writeFile(second, '# Second Root\n\nSecond root content.\n'),
    fs.writeFile(outside, '# Outside\n\nCaller content.\n'),
  ])
  await Effect.runPromise(appendManifestDirectory(home, { path: firstRoot }))
  await Effect.runPromise(appendManifestDirectory(home, { path: secondRoot }))
  await Effect.runPromise(
    refreshManifestIndex(home, undefined, {
      force: true,
      semantic: { mode: 'skip' },
    }),
  )

  return {
    parent,
    home,
    callerRoot,
    firstRoot,
    secondRoot,
    source: await fs.realpath(source),
    target: await fs.realpath(target),
    inbound: await fs.realpath(inbound),
    second: await fs.realpath(second),
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

describe('MCP indexed corpus path resolution', () => {
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

  it('round-trips an absolute path emitted by md_search through all four tools', async () => {
    const search = await handleMdSearch(
      { query: 'search source' },
      fixture.callerRoot,
      defaultConfig,
    )
    expect(search.isError).toBeFalsy()
    expect(resultText(search)).toContain(fixture.source)

    const results = await inspectWithEveryPathTool(fixture.source)

    expect(results.every((result) => !result.isError)).toBe(true)
    expect(resultText(results[0]!)).toContain('Search Source')
    expect(resultText(results[1]!)).toContain('Search Source')
    expect(resultText(results[2]!)).toContain(fixture.target)
    expect(resultText(results[3]!)).toContain(fixture.inbound)
  })

  it('resolves relative paths against served roots instead of process CWD', async () => {
    const results = await inspectWithEveryPathTool('source.md')

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

  it('resolves a document under a non-first manifest root', async () => {
    const results = await inspectWithEveryPathTool('second.md')

    expect(results.every((result) => !result.isError)).toBe(true)
    expect(resultText(results[0]!)).toContain('Second Root')
    expect(resultText(results[1]!)).toContain('Second Root')
    expect(resultText(results[2]!)).toContain(fixture.second)
    expect(resultText(results[3]!)).toContain(fixture.second)
  })
})
