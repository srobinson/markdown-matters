import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import type { DocumentKey } from '../db/canonical.js'
import { removeFileSystemPath } from '../db/fs-durability.js'
import {
  generationLayout,
  readCurrentGeneration,
} from '../db/generation-paths.js'
import { testGenerationSession } from '../db/generation-test-fixture.js'
import { appendManifestDirectory } from '../manifest.js'
import { parse } from '../parser/parser.js'
import { buildIndex } from './index-build.js'
import {
  getBrokenLinks,
  getIncomingLinks,
  getOutgoingLinks,
} from './link-index.js'
import { refreshManifestIndex } from './manifest-refresh.js'
import { clearIndexCache, createStorage, loadLinkIndex } from './storage.js'
import { INDEX_VERSION } from './types.js'

const cleanup: string[] = []

const makeCorpus = async (
  files: Readonly<Record<string, string>>,
): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-wikilinks-'))
  cleanup.push(root)
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content)
  }
  return root
}

const runBuild = (
  root: string,
  options: Omit<Parameters<typeof buildIndex>[1], 'indexRoot'> = {},
) => Effect.runPromise(buildIndex(root, { indexRoot: root, ...options }))

const loadLinks = (root: string) =>
  Effect.runPromise(loadLinkIndex(createStorage(root, root)))

const rewriteStructuralIndexVersion = async (
  indexRoot: string,
  version: number,
): Promise<void> => {
  const storage = createStorage(indexRoot, indexRoot)
  for (const filePath of [
    storage.paths.documents,
    storage.paths.sections,
    storage.paths.links,
  ]) {
    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<
      string,
      unknown
    >
    await fs.writeFile(filePath, JSON.stringify({ ...persisted, version }))
  }
  clearIndexCache(indexRoot)
}

const outgoing = (root: string, relativePath: string) =>
  Effect.runPromise(
    getOutgoingLinks(
      testGenerationSession(root),
      path.join(root, relativePath),
    ),
  )

const incoming = (root: string, relativePath: string) =>
  Effect.runPromise(
    getIncomingLinks(
      testGenerationSession(root),
      path.join(root, relativePath),
    ),
  )

afterEach(async () => {
  clearIndexCache()
  await Promise.all(
    cleanup.splice(0).map((root) => removeFileSystemPath(root, true)),
  )
})

describe('wikilink indexing', () => {
  it('parses [[Note]] as a basename target', async () => {
    const document = await Effect.runPromise(parse('# Source\n\n[[Note]]\n'))

    expect(document.links).toContainEqual(
      expect.objectContaining({
        type: 'internal',
        syntax: 'wikilink',
        lookup: 'basename',
        href: 'Note',
        text: 'Note',
        line: 3,
      }),
    )
  })

  it('keeps [[Note|alias]] display text out of resolution', async () => {
    const document = await Effect.runPromise(
      parse('# Source\n\n[[Note|Readable alias]]\n'),
    )

    expect(document.links).toContainEqual(
      expect.objectContaining({
        syntax: 'wikilink',
        lookup: 'basename',
        href: 'Note',
        text: 'Readable alias',
      }),
    )
  })

  it('ignores wikilink shaped text inside code', async () => {
    const document = await Effect.runPromise(
      parse(
        '# Source\n\n`[[Inline]]`\n\n```text\n[[Fenced]]\n```\n\n[[Real]]\n',
      ),
    )

    expect(document.links.map((link) => link.href)).toEqual(['Real'])
  })

  it('matches a bare basename case insensitively', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[note]]\n',
      'vault/NOTE.md': '# Note\n',
    })

    await runBuild(root)

    expect(await outgoing(root, 'Source.md')).toEqual([
      await fs.realpath(path.join(root, 'vault/NOTE.md')),
    ])
  })

  it('resolves [[Note#Heading]] to the target section', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Note#Details]]\n',
      'Note.md': '# Note\n\n## Details\n\nTarget section.\n',
    })

    await runBuild(root)

    const links = await loadLinks(root)
    const sourceKey = (await fs.realpath(
      path.join(root, 'Source.md'),
    )) as DocumentKey
    const noteKey = (await fs.realpath(
      path.join(root, 'Note.md'),
    )) as DocumentKey
    const target = links?.forward[sourceKey]?.[0]
    expect(target).toMatchObject({ documentPath: noteKey })
    expect(target?.sectionId).toMatch(/-details-L3$/)
  })

  it('resolves [[folder/Note]] by exact relative path', async () => {
    const root = await makeCorpus({
      'docs/Source.md': '# Source\n\n[[folder/Note]]\n',
      'docs/folder/Note.md': '# Exact\n',
      'other/Note.md': '# Basename decoy\n',
    })

    await runBuild(root)

    expect(await outgoing(root, 'docs/Source.md')).toEqual([
      await fs.realpath(path.join(root, 'docs/folder/Note.md')),
    ])
  })

  it('selects the shortest ambiguous basename and records a diagnostic', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Note]]\n',
      'a/Note.md': '# Short\n',
      'deep/nested/Note.md': '# Long\n',
    })

    const result = await runBuild(root)

    expect(await outgoing(root, 'Source.md')).toEqual([
      await fs.realpath(path.join(root, 'a/Note.md')),
    ])
    expect(result.errors).toContainEqual({
      path: 'Source.md',
      message: expect.stringMatching(
        /Ambiguous wikilink "Note".*a\/Note\.md.*deep\/nested\/Note\.md/,
      ),
    })
  })

  it('routes an unresolved wikilink through brokenBySource', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Missing]]\n',
    })

    await runBuild(root)

    const sourceKey = (await fs.realpath(
      path.join(root, 'Source.md'),
    )) as DocumentKey
    const missingPath = path.join(root, 'Missing.md')
    const links = await loadLinks(root)
    expect(links?.brokenBySource[sourceKey]).toEqual([missingPath])
    expect(
      await Effect.runPromise(getBrokenLinks(testGenerationSession(root))),
    ).toEqual([missingPath])
  })

  it('indexes Markdown and wikilink syntax through one graph', async () => {
    const root = await makeCorpus({
      'Source.md':
        '# Source\n\n[Standard](./Standard.md) and [[Wiki|Wiki alias]]\n',
      'Standard.md': '# Standard\n',
      'Wiki.md': '# Wiki\n',
    })

    await runBuild(root)

    expect(new Set(await outgoing(root, 'Source.md'))).toEqual(
      new Set([
        await fs.realpath(path.join(root, 'Standard.md')),
        await fs.realpath(path.join(root, 'Wiki.md')),
      ]),
    )
  })

  it('projects outgoing links and backlinks in both syntax directions', async () => {
    const root = await makeCorpus({
      'A.md': '# A\n\n[B](./B.md)\n',
      'B.md': '# B\n\n[[A]]\n',
    })
    const a = await fs.realpath(path.join(root, 'A.md'))
    const b = await fs.realpath(path.join(root, 'B.md'))

    await runBuild(root)

    expect(await outgoing(root, 'A.md')).toEqual([b])
    expect(await outgoing(root, 'B.md')).toEqual([a])
    expect(await incoming(root, 'A.md')).toEqual([b])
    expect(await incoming(root, 'B.md')).toEqual([a])
  })

  it('extracts a standard link inside a heading with its backlink', async () => {
    const root = await makeCorpus({
      'Source.md': '# [Target](./Target.md)\n\nBody.\n',
      'Target.md': '# Target\n',
    })
    const source = await fs.realpath(path.join(root, 'Source.md'))
    const target = await fs.realpath(path.join(root, 'Target.md'))

    await runBuild(root)

    expect(await outgoing(root, 'Source.md')).toEqual([target])
    expect(await incoming(root, 'Target.md')).toEqual([source])
  })

  it('rebuilds a persisted version 2 index under the new index version', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Target]]\n',
      'Target.md': '# Target\n',
    })
    await runBuild(root)
    await rewriteStructuralIndexVersion(root, 2)

    const rebuilt = await runBuild(root)

    expect(INDEX_VERSION).toBe(3)
    expect(rebuilt.documentsIndexed).toBe(2)
    expect(rebuilt.skipped.unchanged).toBe(0)
    expect(await outgoing(root, 'Source.md')).toEqual([
      await fs.realpath(path.join(root, 'Target.md')),
    ])
  })

  it('fully rebuilds a version 2 index after an incremental file change', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Target]]\n',
      'Target.md': '# Target\n',
    })
    const sourcePath = path.join(root, 'Source.md')
    await runBuild(root)
    await rewriteStructuralIndexVersion(root, 2)
    await fs.writeFile(sourcePath, '# Updated source\n\n[[Target]]\n')

    const rebuilt = await runBuild(root, { changedPaths: [sourcePath] })

    expect(rebuilt.documentsIndexed).toBe(2)
    expect(rebuilt.skipped.unchanged).toBe(0)
    expect(rebuilt.totalDocuments).toBe(2)
    expect(await outgoing(root, 'Source.md')).toEqual([
      await fs.realpath(path.join(root, 'Target.md')),
    ])
  })

  it('publishes a rebuilt generation when the current index is version 2', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Target]]\n',
      'Target.md': '# Target\n',
    })
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-wikilink-home-'))
    cleanup.push(home)
    await Effect.runPromise(appendManifestDirectory(home, { path: root }))
    const first = await Effect.runPromise(
      refreshManifestIndex(home, undefined, {
        force: false,
        semantic: { mode: 'skip' },
      }),
    )

    await rewriteStructuralIndexVersion(first.indexRoot, 2)

    const rebuilt = await Effect.runPromise(
      refreshManifestIndex(home, undefined, {
        force: false,
        semantic: { mode: 'skip' },
      }),
    )

    expect(rebuilt.generation).not.toBe(first.generation)
    expect(rebuilt.value.documentsIndexed).toBe(2)
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe(
      rebuilt.generation,
    )
    expect(rebuilt.indexRoot).toBe(
      generationLayout(home, rebuilt.generation).root,
    )
    const links = await loadLinks(rebuilt.indexRoot)
    const sourceKey = (await fs.realpath(
      path.join(root, 'Source.md'),
    )) as DocumentKey
    const targetKey = (await fs.realpath(
      path.join(root, 'Target.md'),
    )) as DocumentKey
    expect(links?.version).toBe(INDEX_VERSION)
    expect(links?.forward[sourceKey]).toEqual([{ documentPath: targetKey }])
  })

  it('fully rebuilds a version 2 generation after an incremental file change', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Target]]\n',
      'Target.md': '# Target\n',
    })
    const sourcePath = path.join(root, 'Source.md')
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-wikilink-home-'))
    cleanup.push(home)
    await Effect.runPromise(appendManifestDirectory(home, { path: root }))
    const first = await Effect.runPromise(
      refreshManifestIndex(home, undefined, {
        force: false,
        semantic: { mode: 'skip' },
      }),
    )
    await rewriteStructuralIndexVersion(first.indexRoot, 2)
    await fs.writeFile(sourcePath, '# Updated source\n\n[[Target]]\n')

    const rebuilt = await Effect.runPromise(
      refreshManifestIndex(home, undefined, {
        force: false,
        changedPaths: [sourcePath],
        semantic: { mode: 'skip' },
      }),
    )

    expect(rebuilt.generation).not.toBe(first.generation)
    expect(rebuilt.value.documentsIndexed).toBe(2)
    expect(rebuilt.value.skipped.unchanged).toBe(0)
    expect(rebuilt.value.totalDocuments).toBe(2)
    const links = await loadLinks(rebuilt.indexRoot)
    const sourceKey = (await fs.realpath(sourcePath)) as DocumentKey
    const targetKey = (await fs.realpath(
      path.join(root, 'Target.md'),
    )) as DocumentKey
    expect(links?.forward[sourceKey]).toEqual([{ documentPath: targetKey }])
  })

  it('selects the first duplicate heading in document order', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Note#Repeated]]\n',
      'Note.md': '# Note\n\n## Repeated\n\nFirst.\n\n## Repeated\n\nSecond.\n',
    })

    await runBuild(root)

    const sourceKey = (await fs.realpath(
      path.join(root, 'Source.md'),
    )) as DocumentKey
    const links = await loadLinks(root)
    expect(links?.forward[sourceKey]?.[0]?.sectionId).toMatch(/-repeated-L3$/)
  })

  it('falls back to a document edge for an unmatched standard fragment', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[Missing](./Note.md#missing-slug)\n',
      'Note.md': '# Note\n\n## Existing\n',
    })

    await runBuild(root)

    const sourceKey = (await fs.realpath(
      path.join(root, 'Source.md'),
    )) as DocumentKey
    const noteKey = (await fs.realpath(
      path.join(root, 'Note.md'),
    )) as DocumentKey
    const links = await loadLinks(root)
    expect(links?.forward[sourceKey]).toEqual([{ documentPath: noteKey }])
  })

  it('re-resolves an unchanged source after a target heading moves', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Note#Details]]\n',
      'Note.md': '# Note\n\n## Details\n',
    })
    const targetPath = path.join(root, 'Note.md')
    const sourceKey = (await fs.realpath(
      path.join(root, 'Source.md'),
    )) as DocumentKey
    await runBuild(root)

    await fs.writeFile(targetPath, '# Note\n\nIntro.\n\n## Details\n')
    await runBuild(root, { changedPaths: [targetPath] })

    const links = await loadLinks(root)
    expect(links?.forward[sourceKey]?.[0]?.sectionId).toMatch(/-details-L5$/)
  })

  it('resolves a broken basename after a matching document is added', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Found]]\n',
    })
    const targetPath = path.join(root, 'notes/Found.md')
    await runBuild(root)

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, '# Found\n')
    await runBuild(root, { changedPaths: [targetPath] })

    expect(await outgoing(root, 'Source.md')).toEqual([
      await fs.realpath(targetPath),
    ])
    expect(
      await Effect.runPromise(getBrokenLinks(testGenerationSession(root))),
    ).toEqual([])
  })

  it('repairs both backlink directions when the shortest candidate changes', async () => {
    const root = await makeCorpus({
      'Source.md': '# Source\n\n[[Note]]\n',
      'deep/nested/Note.md': '# Long\n',
    })
    const source = await fs.realpath(path.join(root, 'Source.md'))
    const longTarget = await fs.realpath(path.join(root, 'deep/nested/Note.md'))
    const shortPath = path.join(root, 'a/Note.md')
    await runBuild(root)

    await fs.mkdir(path.dirname(shortPath), { recursive: true })
    await fs.writeFile(shortPath, '# Short\n')
    await runBuild(root, { changedPaths: [shortPath] })
    const shortTarget = await fs.realpath(shortPath)

    expect(await outgoing(root, 'Source.md')).toEqual([shortTarget])
    expect(await incoming(root, 'a/Note.md')).toEqual([source])
    expect(await incoming(root, 'deep/nested/Note.md')).toEqual([])

    await fs.rm(shortPath)
    await runBuild(root, { changedPaths: [shortPath] })

    expect(await outgoing(root, 'Source.md')).toEqual([longTarget])
    expect(await incoming(root, 'deep/nested/Note.md')).toEqual([source])
  })
})
