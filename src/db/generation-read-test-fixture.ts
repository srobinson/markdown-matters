import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import {
  createEmptyDocumentIndex,
  createEmptyLinkIndex,
  createEmptySectionIndex,
  createStorage,
  initializeIndex,
  saveDocumentIndex,
  saveLinkIndex,
  saveSectionIndex,
} from '../index/storage.js'
import { createBM25Store } from '../search/bm25-store.js'
import {
  type CanonicalSource,
  canonicalizeSourceFile,
  type DocumentKey,
} from './canonical.js'
import {
  generationHomeLayout,
  generationLayout,
  parseGenerationName,
} from './generation-paths.js'
import { initializeLeaseGate } from './generation-reader.js'
import type { GenerationLayout } from './generation-types.js'

export interface GenerationReadFixture {
  readonly parent: string
  readonly home: string
  readonly sourceRoot: string
  readonly primaryFile: string
  readonly duplicateFile: string
  readonly gen1: GenerationLayout
  readonly gen2: GenerationLayout
}

const sourceRecord = async (filePath: string): Promise<CanonicalSource> =>
  Effect.runPromise(canonicalizeSourceFile(filePath))

const seedGeneration = async (
  home: string,
  sources: readonly CanonicalSource[],
  marker: string,
): Promise<GenerationLayout> => {
  const name = await Effect.runPromise(parseGenerationName(marker))
  const layout = generationLayout(home, name)
  const storage = createStorage(path.dirname(sources[0]!.key), layout.root)
  await Effect.runPromise(initializeIndex(storage))

  const documents = Object.fromEntries(
    sources.map((source, index) => [
      source.key,
      {
        id: `document-${index + 1}`,
        path: source.key,
        paths: [source.key],
        declaredPaths: [source.declaredPath],
        identity: source.identity,
        comparisonKey: source.comparisonKey,
        title: `${marker}-document-${index + 1}`,
        mtime: 1,
        hash: `${marker}-hash-${index + 1}`,
        tokenCount: 10,
        sectionCount: 1,
      },
    ]),
  )
  const sections = Object.fromEntries(
    sources.map((source, index) => [
      `${marker}-section-${index + 1}`,
      {
        id: `${marker}-section-${index + 1}`,
        documentId: `document-${index + 1}`,
        documentPath: source.key,
        heading: `${marker}-heading-${index + 1}`,
        level: 1 as const,
        startLine: 1,
        endLine: 3,
        tokenCount: 10,
        hasCode: false,
        hasList: false,
        hasTable: false,
      },
    ]),
  )
  const byDocument = Object.fromEntries(
    sources.map((_, index) => [
      `document-${index + 1}`,
      [`${marker}-section-${index + 1}`],
    ]),
  )

  await Effect.runPromise(
    saveDocumentIndex(storage, {
      ...createEmptyDocumentIndex(),
      documents,
    }),
  )
  await Effect.runPromise(
    saveSectionIndex(storage, {
      ...createEmptySectionIndex(),
      sections,
      byDocument,
    }),
  )
  const primary = sources[0]!.key
  const target = path.resolve(
    path.dirname(primary),
    `${marker}-target.md`,
  ) as DocumentKey
  const inbound = path.resolve(
    path.dirname(primary),
    `${marker}-inbound.md`,
  ) as DocumentKey
  await Effect.runPromise(
    saveLinkIndex(storage, {
      ...createEmptyLinkIndex(),
      forward: { [primary]: [{ documentPath: target }] },
      backward: { [primary]: [{ documentPath: inbound }] },
    }),
  )

  const bm25 = createBM25Store(layout.root)
  await Effect.runPromise(
    bm25.add(
      sources.map((source, index) => ({
        id: `${marker}-section-${index + 1}`,
        sectionId: `${marker}-section-${index + 1}`,
        documentPath: source.key,
        heading: `${marker}-heading-${index + 1}`,
        content: `${marker} generation marker shared content`,
      })),
    ),
  )
  await Effect.runPromise(bm25.consolidate())
  await Effect.runPromise(bm25.save())
  await Effect.runPromise(initializeLeaseGate(layout))
  return layout
}

export const setFixtureCurrent = (
  fixture: GenerationReadFixture,
  layout: GenerationLayout,
): Promise<void> =>
  fs.writeFile(generationHomeLayout(fixture.home).current, layout.name)

export const createGenerationReadFixture =
  async (): Promise<GenerationReadFixture> => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-read-routing-'))
    const home = path.join(parent, 'home')
    const sourceRoot = path.join(parent, 'source')
    await Promise.all([
      fs.mkdir(home, { recursive: true }),
      fs.mkdir(sourceRoot, { recursive: true }),
    ])
    const primaryFile = path.join(sourceRoot, 'primary.md')
    const duplicateFile = path.join(sourceRoot, 'duplicate.md')
    const content =
      '# Shared\n\nRepeated source content for generation routing tests.\n'
    await Promise.all([
      fs.writeFile(primaryFile, content),
      fs.writeFile(duplicateFile, content),
      fs.writeFile(path.join(sourceRoot, 'third.md'), '# Third\n\nMarker\n'),
    ])
    const sources = await Promise.all(
      [primaryFile, duplicateFile, path.join(sourceRoot, 'third.md')].map(
        sourceRecord,
      ),
    )
    const gen1 = await seedGeneration(home, sources, 'gen-1')
    const gen2 = await seedGeneration(home, sources, 'gen-2')
    const fixture = {
      parent,
      home,
      sourceRoot,
      primaryFile,
      duplicateFile,
      gen1,
      gen2,
    }
    await setFixtureCurrent(fixture, gen1)
    return fixture
  }

export const removeGenerationReadFixture = (
  fixture: GenerationReadFixture,
): Promise<void> => fs.rm(fixture.parent, { recursive: true, force: true })
