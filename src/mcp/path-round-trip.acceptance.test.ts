import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultConfig } from '../config/schema.js'
import type { DocumentKey } from '../db/canonical.js'
import { refreshManifestIndex } from '../index/manifest-refresh.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'
import { appendManifestDirectory } from '../manifest.js'
import { mcpText } from './adapter.js'

const semanticResult = vi.hoisted(() => ({
  calls: 0,
  error: null as Error | null,
  current: [] as Array<{
    id: string
    sectionId: string
    documentPath: DocumentKey
    heading: string
    similarity: number
  }>,
}))

vi.mock('../embeddings/semantic-search.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../embeddings/semantic-search.js')>()
  const { postProcessResults } = await import(
    '../embeddings/semantic-search-pipeline.js'
  )
  return {
    ...actual,
    semanticSearch: (
      session: Parameters<typeof postProcessResults>[0],
      sourceRoot: string,
      query: string,
      options: Parameters<typeof postProcessResults>[4],
    ) => {
      semanticResult.calls += 1
      if (semanticResult.error !== null) {
        return Effect.fail(semanticResult.error)
      }
      return postProcessResults(
        session,
        sourceRoot,
        semanticResult.current,
        query,
        options,
        options.limit ?? 5,
      ).pipe(Effect.map(({ results }) => results))
    },
  }
})

import {
  handleMdBacklinks,
  handleMdKeywordSearch,
  handleMdLinks,
  handleMdm,
  handleMdSearch,
  handleMdStructure,
} from './handlers.js'

interface PathFixture {
  readonly parent: string
  readonly home: string
  readonly callerRoot: string
  readonly corpusRoots: readonly string[]
  readonly contentDocumentCount: number
  readonly documentCount: number
  readonly examplePaths: readonly string[]
  readonly repoRoot: string
  readonly source: string
  readonly sourceAlias: string
  readonly target: string
  readonly inbound: string
  readonly sameBasename: string
  readonly segmentMatch: string
  readonly segmentDecoy: string
  readonly hardlinkKey: string
  readonly hardlinkAliasPattern: string
  readonly hardlinkAliasSegment: string
  readonly literalMeta: string | null
  readonly literalDecoy: string | null
  readonly outside: string
  readonly sourceSectionTokenCount: number
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
  const sameBasename = path.join(mdxRoot, 'search-source.md')
  const segmentRoot = path.join(repoRoot, 'MiXeDDocs')
  const segmentDecoyRoot = path.join(repoRoot, 'myMixedDocs-archive')
  const segmentMatch = path.join(segmentRoot, 'segment.md')
  const segmentDecoy = path.join(segmentDecoyRoot, 'decoy.md')
  const hardlinkSourceRoot = path.join(repoRoot, 'hardlink-source')
  const hardlinkAliasRoot = path.join(mdxRoot, 'hardlink-alias')
  const hardlinkSource = path.join(hardlinkSourceRoot, 'shared.md')
  const hardlinkAlias = path.join(hardlinkAliasRoot, 'shared.md')
  const literalMeta =
    process.platform === 'win32' ? null : path.join(contentRoot, 'literal*?.md')
  const literalDecoy =
    process.platform === 'win32' ? null : path.join(contentRoot, 'literalXY.md')
  const outside = path.join(callerRoot, 'outside.md')
  await Promise.all(
    [
      contentRoot,
      segmentRoot,
      segmentDecoyRoot,
      hardlinkSourceRoot,
      hardlinkAliasRoot,
    ].map((directory) => fs.mkdir(directory, { recursive: true })),
  )
  const writes = [
    fs.writeFile(source, '# Search Source\n\n[Target](./target.md)\n'),
    fs.writeFile(target, '# Target\n\nTarget content.\n'),
    fs.writeFile(inbound, '# Inbound\n\n[Source](./search-source.md)\n'),
    fs.writeFile(path.join(mdxRoot, 'notes.md'), '# MDX Notes\n'),
    fs.writeFile(sameBasename, '# MDX Search Source\n'),
    fs.writeFile(segmentMatch, '# Segment Match\n'),
    fs.writeFile(segmentDecoy, '# Segment Decoy\n'),
    fs.writeFile(hardlinkSource, '# Hardlink Shared\n'),
    fs.writeFile(outside, '# Outside\n\nCaller content.\n'),
  ]
  if (literalMeta && literalDecoy) {
    writes.push(
      fs.writeFile(literalMeta, '# Literal Meta\n'),
      fs.writeFile(literalDecoy, '# Literal Decoy\n'),
    )
  }
  await Promise.all(writes)
  await fs.link(hardlinkSource, hardlinkAlias)
  await fs.symlink(source, sourceAlias, 'file')
  await Effect.runPromise(appendManifestDirectory(home, { path: mdxRoot }))
  await Effect.runPromise(appendManifestDirectory(home, { path: repoRoot }))
  const published = await Effect.runPromise(
    refreshManifestIndex(home, undefined, {
      force: true,
      followSymlinks: true,
      semantic: { mode: 'skip' },
    }),
  )
  const documentIndex = await Effect.runPromise(
    loadDocumentIndex(createStorage(repoRoot, published.indexRoot)),
  )
  const sectionIndex = await Effect.runPromise(
    loadSectionIndex(createStorage(repoRoot, published.indexRoot)),
  )
  const documents = Object.values(documentIndex?.documents ?? {})
  const hardlinkPaths = new Set([
    await fs.realpath(hardlinkSource),
    await fs.realpath(hardlinkAlias),
  ])
  const hardlinkEntry = Object.values(documentIndex?.documents ?? {}).find(
    (entry) =>
      entry.paths.length === hardlinkPaths.size &&
      entry.paths.every((entryPath) => hardlinkPaths.has(entryPath)),
  )
  if (hardlinkEntry?.paths.length !== 2) {
    throw new Error('Hardlink fixture did not collapse to one indexed document')
  }
  const nonSurvivingAlias = hardlinkEntry.paths.find(
    (entryPath) => entryPath !== hardlinkEntry.path,
  )
  if (!nonSurvivingAlias) {
    throw new Error('Hardlink fixture has no non-surviving alias')
  }
  const canonicalSource = await fs.realpath(source)
  const sourceSection = Object.values(sectionIndex?.sections ?? {}).find(
    (section) =>
      section.documentPath === canonicalSource &&
      section.heading === 'Search Source',
  )
  if (!sourceSection) throw new Error('Search source section was not indexed')

  return {
    parent,
    home,
    callerRoot,
    corpusRoots: [mdxRoot, repoRoot],
    contentDocumentCount: literalMeta === null ? 3 : 5,
    documentCount: documents.length,
    examplePaths: documents
      .map((document) => document.path)
      .sort()
      .slice(0, 3),
    repoRoot,
    source: canonicalSource,
    sourceAlias,
    target: await fs.realpath(target),
    inbound: await fs.realpath(inbound),
    sameBasename: await fs.realpath(sameBasename),
    segmentMatch: await fs.realpath(segmentMatch),
    segmentDecoy: await fs.realpath(segmentDecoy),
    hardlinkKey: hardlinkEntry.path,
    hardlinkAliasPattern: path.join(path.dirname(nonSurvivingAlias), '*.md'),
    hardlinkAliasSegment: path.basename(path.dirname(nonSurvivingAlias)),
    literalMeta: literalMeta ? await fs.realpath(literalMeta) : null,
    literalDecoy: literalDecoy ? await fs.realpath(literalDecoy) : null,
    outside: await fs.realpath(outside),
    sourceSectionTokenCount: sourceSection.tokenCount,
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

const emittedKeywordPaths = (result: CallToolResult): readonly string[] =>
  resultText(result)
    .split('\n')
    .filter((line) => line.startsWith('   '))
    .map((line) => line.trim().replace(/ \(\d+ tokens\)$/, ''))

const filterWithBothSearchTools = async (
  pathFilter: string,
): Promise<readonly [CallToolResult, CallToolResult]> =>
  Promise.all([
    handleMdSearch(
      { query: 'path filter', path_filter: pathFilter, limit: 20 },
      fixture.callerRoot,
      defaultConfig,
    ),
    handleMdKeywordSearch(
      { path_filter: pathFilter, limit: 100 },
      fixture.callerRoot,
    ),
  ])

const filteredPaths = (
  results: readonly [CallToolResult, CallToolResult],
): readonly [readonly string[], readonly string[]] => [
  emittedSearchPaths(results[0]),
  emittedKeywordPaths(results[1]),
]

const firstRunPointer =
  'No index found.\n\nRun: mdm index /path/to/docs\n  Add --embed for semantic search capabilities'

const filterMissPointer = (): string =>
  `path_filter matched 0 of ${fixture.documentCount} documents. Corpus paths look like: ${fixture.examplePaths.join(', ')}. Corpus roots: [${fixture.corpusRoots.join(', ')}].`

const queryMissPointer = (query: string, matchingDocuments?: number): string =>
  matchingDocuments === undefined
    ? `no matches for "${query}" across ${fixture.documentCount} indexed documents`
    : `no matches for "${query}" among the ${matchingDocuments} documents matching your path_filter`

const expectedSourceInspection = (): readonly CallToolResult[] => [
  mcpText(
    `# Search Source\nPath: ${fixture.source}\nTokens: 99 (89% reduction from 19)\n\n**Topics:** search source\n\n# Search Source [L1-3]\nTarget`,
  ),
  mcpText(
    `# Search Source\nPath: ${fixture.source}\nTotal tokens: 19\n\n# Search Source (${fixture.sourceSectionTokenCount} tokens)\n`,
  ),
  mcpText(
    `Outgoing links from ${fixture.source}:\n\n  -> ${fixture.target}\n\nTotal: 1 links`,
  ),
  mcpText(
    `Incoming links to ${fixture.source}:\n\n  <- ${fixture.inbound}\n\nTotal: 1 backlinks`,
  ),
]

let fixture: PathFixture

const usePathFixture = (): void => {
  let previousHome: string | undefined

  beforeEach(async () => {
    previousHome = process.env.MDM_HOME
    fixture = await createFixture()
    process.env.MDM_HOME = fixture.home
    semanticResult.calls = 0
    semanticResult.error = null
    semanticResult.current = [
      fixture.source,
      fixture.target,
      fixture.inbound,
      fixture.sameBasename,
      fixture.segmentMatch,
      fixture.segmentDecoy,
      fixture.hardlinkKey,
      ...(fixture.literalMeta && fixture.literalDecoy
        ? [fixture.literalMeta, fixture.literalDecoy]
        : []),
    ].map((documentPath, index) => ({
      id: `vector-${index}`,
      sectionId: `fixture-${index}`,
      documentPath: documentPath as DocumentKey,
      heading: path.basename(documentPath, '.md'),
      similarity: 0.99 - index * 0.01,
    }))
  })

  afterEach(async () => {
    semanticResult.calls = 0
    semanticResult.error = null
    semanticResult.current = []
    if (previousHome === undefined) delete process.env.MDM_HOME
    else process.env.MDM_HOME = previousHome
    await fs.rm(fixture.parent, { recursive: true, force: true })
  })
}

describe('MCP multi-root search path filters', () => {
  usePathFixture()

  it('round-trips every canonical path emitted by md_search through all four tools', async () => {
    const search = await handleMdSearch(
      { query: 'search source', limit: 20 },
      fixture.callerRoot,
      defaultConfig,
    )
    expect(search.isError).toBeFalsy()
    const searchPaths = emittedSearchPaths(search)
    expect(new Set(searchPaths)).toEqual(
      new Set(semanticResult.current.map(({ documentPath }) => documentPath)),
    )

    for (const emittedPath of searchPaths) {
      const results = await inspectWithEveryPathTool(emittedPath)
      expect(results.every((result) => !result.isError)).toBe(true)
    }

    expect(await inspectWithEveryPathTool(fixture.source)).toEqual(
      expectedSourceInspection(),
    )
  })

  it('reuses every displayed absolute search path as a canonical filter', async () => {
    const search = await handleMdSearch(
      { query: 'path filter', limit: 20 },
      fixture.callerRoot,
      defaultConfig,
    )
    const displayedPaths = emittedSearchPaths(search)
    expect(displayedPaths).toEqual(
      semanticResult.current.map(({ documentPath }) => documentPath),
    )

    for (const displayedPath of displayedPaths) {
      expect(
        filteredPaths(await filterWithBothSearchTools(displayedPath)),
      ).toEqual([[displayedPath], [displayedPath]])
    }
  })

  it('normalizes a symlink filter alias to the canonical search path', async () => {
    expect(
      filteredPaths(await filterWithBothSearchTools(fixture.sourceAlias)),
    ).toEqual([[fixture.source], [fixture.source]])
  })

  it.skipIf(process.platform === 'win32')(
    'treats glob characters in a displayed absolute path literally',
    async () => {
      expect(fixture.literalMeta).not.toBeNull()
      expect(fixture.literalDecoy).not.toBeNull()
      expect(
        filteredPaths(await filterWithBothSearchTools(fixture.literalMeta!)),
      ).toEqual([[fixture.literalMeta!], [fixture.literalMeta!]])
    },
  )

  it('keeps relative globs working across served roots', async () => {
    const [semanticPaths, keywordPaths] = filteredPaths(
      await filterWithBothSearchTools('content/*.md'),
    )
    const expected = [
      fixture.source,
      fixture.target,
      fixture.inbound,
      ...(fixture.literalMeta && fixture.literalDecoy
        ? [fixture.literalMeta, fixture.literalDecoy]
        : []),
    ]

    expect(new Set(semanticPaths)).toEqual(new Set(expected))
    expect(new Set(keywordPaths)).toEqual(new Set(expected))
  })

  it('matches a manifest root by its own directory segment', async () => {
    const expected = [
      fixture.source,
      fixture.target,
      fixture.inbound,
      fixture.segmentMatch,
      fixture.segmentDecoy,
      fixture.hardlinkKey,
      ...(fixture.literalMeta && fixture.literalDecoy
        ? [fixture.literalMeta, fixture.literalDecoy]
        : []),
    ]
    const rootName = path.basename(fixture.repoRoot)

    for (const pathFilter of [`**/${rootName}/**`, rootName]) {
      const [semanticPaths, keywordPaths] = filteredPaths(
        await filterWithBothSearchTools(pathFilter),
      )
      expect(new Set(semanticPaths)).toEqual(new Set(expected))
      expect(new Set(keywordPaths)).toEqual(new Set(expected))
    }
  })

  it('matches bare strings case insensitively at path segment boundaries', async () => {
    expect(filteredPaths(await filterWithBothSearchTools('mixeddocs'))).toEqual(
      [[fixture.segmentMatch], [fixture.segmentMatch]],
    )
  })

  it('matches a canonical document through its non-surviving hardlink alias', async () => {
    for (const pathFilter of [
      fixture.hardlinkAliasPattern,
      fixture.hardlinkAliasSegment,
    ]) {
      expect(
        filteredPaths(await filterWithBothSearchTools(pathFilter)),
      ).toEqual([[fixture.hardlinkKey], [fixture.hardlinkKey]])
    }
  })

  it('returns zero results for an absolute path outside the indexed corpus', async () => {
    const results = await filterWithBothSearchTools(fixture.outside)

    expect(results.every((result) => !result.isError)).toBe(true)
    expect(results.map(resultText)).toEqual([
      filterMissPointer(),
      filterMissPointer(),
    ])
    expect(semanticResult.calls).toBe(1)
    expect(filteredPaths(results)).toEqual([[], []])
  })
})

describe('MCP multi-root empty result guidance', () => {
  usePathFixture()

  it('uses first-run guidance for both search tools when no generation exists', async () => {
    const emptyHome = path.join(fixture.parent, 'no-generation-home')
    await fs.mkdir(emptyHome)
    process.env.MDM_HOME = emptyHome

    const results = await Promise.all([
      handleMdSearch({ query: 'anything' }, fixture.callerRoot, defaultConfig),
      handleMdKeywordSearch({ heading: 'anything' }, fixture.callerRoot),
    ])

    expect(results.every((result) => result.isError)).toBe(true)
    for (const result of results) {
      expect(resultText(result)).toContain(firstRunPointer)
      expect(resultText(result)).not.toMatch(
        /GenerationReadError|No current generation exists|Stack trace/,
      )
    }
    expect(semanticResult.calls).toBe(0)
  })

  it('uses first-run guidance for both search tools when the indexed corpus is empty', async () => {
    const emptyHome = path.join(fixture.parent, 'empty-corpus-home')
    const emptyRoot = path.join(fixture.parent, 'empty-corpus-root')
    await fs.mkdir(emptyRoot)
    await Effect.runPromise(
      appendManifestDirectory(emptyHome, { path: emptyRoot }),
    )
    await Effect.runPromise(
      refreshManifestIndex(emptyHome, undefined, {
        force: true,
        semantic: { mode: 'skip' },
      }),
    )
    process.env.MDM_HOME = emptyHome
    semanticResult.current = []
    semanticResult.error = new Error('Embeddings unavailable')

    const results = await Promise.all([
      handleMdSearch({ query: 'anything' }, fixture.callerRoot, defaultConfig),
      handleMdKeywordSearch({ heading: 'anything' }, fixture.callerRoot),
    ])

    expect(results[0].isError).toBe(true)
    expect(results[1].isError).toBeFalsy()
    expect(results.map(resultText)).toEqual([
      `Error: ${firstRunPointer}`,
      firstRunPointer,
    ])
    expect(semanticResult.calls).toBe(1)
  })

  it('preserves search errors when the corpus contains documents', async () => {
    semanticResult.error = new Error('Provider unavailable')

    const result = await handleMdSearch(
      { query: 'anything' },
      fixture.callerRoot,
      defaultConfig,
    )

    expect(result.isError).toBe(true)
    expect(resultText(result)).toBe('Error: Provider unavailable')
    expect(resultText(result)).not.toMatch(
      /path_filter matched|corpus roots|no matches for|mdm index/,
    )
    expect(semanticResult.calls).toBe(1)
  })

  it('distinguishes query misses across both search tools', async () => {
    semanticResult.current = []
    const semanticQuery = 'no semantic match'
    const keywordQuery = 'zzz_no_heading_match_zzz'

    const results = await Promise.all([
      handleMdSearch(
        { query: semanticQuery },
        fixture.callerRoot,
        defaultConfig,
      ),
      handleMdKeywordSearch({ heading: keywordQuery }, fixture.callerRoot),
    ])

    expect(results.every((result) => !result.isError)).toBe(true)
    expect(results.map(resultText)).toEqual([
      queryMissPointer(semanticQuery),
      queryMissPointer(keywordQuery),
    ])
    expect(semanticResult.calls).toBe(1)
  })

  it('counts only documents in a satisfiable path filter for query misses', async () => {
    semanticResult.current = []
    const pathFilter = 'content/*.md'
    const semanticQuery = 'no filtered semantic match'
    const keywordQuery = 'zzz_no_filtered_heading_match_zzz'

    const results = await Promise.all([
      handleMdSearch(
        { query: semanticQuery, path_filter: pathFilter },
        fixture.callerRoot,
        defaultConfig,
      ),
      handleMdKeywordSearch(
        { heading: keywordQuery, path_filter: pathFilter },
        fixture.callerRoot,
      ),
    ])

    expect(results.every((result) => !result.isError)).toBe(true)
    expect(results.map(resultText)).toEqual([
      queryMissPointer(semanticQuery, fixture.contentDocumentCount),
      queryMissPointer(keywordQuery, fixture.contentDocumentCount),
    ])
    expect(semanticResult.calls).toBe(1)
  })
})

describe('MCP multi-root successful search responses', () => {
  usePathFixture()

  it('keeps successful search responses unchanged and pointer-free', async () => {
    semanticResult.current = [semanticResult.current[0]!]
    const semanticQuery = 'stable-success'
    const [semantic, keyword] = await Promise.all([
      handleMdSearch(
        { query: semanticQuery, limit: 1 },
        fixture.callerRoot,
        defaultConfig,
      ),
      handleMdKeywordSearch(
        { heading: '^Search Source$', limit: 1 },
        fixture.callerRoot,
      ),
    ])

    expect(resultText(semantic)).toBe(
      `Found 1 results for "${semanticQuery}":\n\n1. **search-source** (99.0% match)\n   ${fixture.source}`,
    )
    expect(resultText(keyword)).toBe(
      `Found 1 sections:\n\n1. **Search Source**\n   ${fixture.source} (${fixture.sourceSectionTokenCount} tokens)`,
    )
    for (const result of [semantic, keyword]) {
      expect(result.isError).toBeFalsy()
      expect(resultText(result)).not.toMatch(
        /path_filter matched|corpus roots|no matches for|mdm index/,
      )
    }
  })
})

describe('MCP multi-root path inspection', () => {
  usePathFixture()

  it('normalizes a symlink alias to the emitted canonical document path', async () => {
    const canonical = await inspectWithEveryPathTool(fixture.source)
    const alias = await inspectWithEveryPathTool(fixture.sourceAlias)

    expect(canonical).toEqual(expectedSourceInspection())
    expect(alias).toEqual(expectedSourceInspection())
  })

  it('resolves relative paths against every served root instead of process CWD', async () => {
    const results = await inspectWithEveryPathTool('content/search-source.md')

    expect(results).toEqual(expectedSourceInspection())
  })

  it('returns a clear typed signal for a path outside the indexed corpus', async () => {
    const results = await inspectWithEveryPathTool(fixture.outside)

    for (const result of results) {
      expect(result.isError).toBe(true)
      expect(resultText(result)).toContain('Path not in indexed corpus')
      expect(resultText(result)).toContain(
        `use an indexed path like [${fixture.examplePaths.join(', ')}]`,
      )
      expect(resultText(result)).toContain(
        `corpus roots: [${fixture.corpusRoots.join(', ')}]`,
      )
    }
    expect(resultText(results[2]!)).not.toContain('No outgoing links')
    expect(resultText(results[3]!)).not.toContain('No incoming links')
  })
})
