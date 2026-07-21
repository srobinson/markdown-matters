import * as fs from 'node:fs/promises'
import { Effect } from 'effect'
import { type DocumentKey, resolveSourceFile } from '../db/canonical.js'
import type {
  FileReadError,
  FileWriteError,
  IndexCorruptedError,
} from '../errors/index.js'
import { type BM25Document, createBM25Store } from '../search/bm25-store.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from './storage.js'
import type { SectionEntry } from './types.js'

export interface BuildBM25Options {
  readonly force?: boolean
  readonly onProgress?: (progress: { current: number; total: number }) => void
}

export interface BuildBM25Result {
  readonly sectionsIndexed: number
  readonly duration: number
}

export const buildBM25Index = (
  indexRoot: string,
  options: BuildBM25Options = {},
): Effect.Effect<
  BuildBM25Result,
  FileReadError | IndexCorruptedError | FileWriteError
> =>
  Effect.gen(function* () {
    const startTime = Date.now()
    const storage = createStorage(indexRoot, indexRoot)
    const documentIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)
    if (!documentIndex || !sectionIndex) {
      return { sectionsIndexed: 0, duration: 0 }
    }

    const store = createBM25Store(storage.indexRoot)
    if (!options.force && (yield* store.load()) && store.getStats().count > 0) {
      return { sectionsIndexed: 0, duration: Date.now() - startTime }
    }
    store.clear()

    const sectionsByDocument = new Map<DocumentKey, SectionEntry[]>()
    for (const section of Object.values(sectionIndex.sections)) {
      if (section.tokenCount < 10) continue
      const existing = sectionsByDocument.get(section.documentPath)
      if (existing) existing.push(section)
      else sectionsByDocument.set(section.documentPath, [section])
    }

    let processedDocuments = 0
    let sectionsIndexed = 0
    for (const [documentPath, sections] of sectionsByDocument) {
      const filePath = resolveSourceFile(documentPath)
      const contentResult = yield* Effect.promise(() =>
        fs.readFile(filePath, 'utf-8'),
      ).pipe(
        Effect.map((content) => ({ ok: true as const, content })),
        Effect.catchAll(() =>
          Effect.succeed({ ok: false as const, content: '' }),
        ),
      )
      if (!contentResult.ok) continue

      const lines = contentResult.content.split('\n')
      const documents: BM25Document[] = sections.map((section) => ({
        id: section.id,
        sectionId: section.id,
        documentPath: section.documentPath,
        heading: section.heading,
        content: lines.slice(section.startLine - 1, section.endLine).join('\n'),
      }))
      sectionsIndexed += documents.length
      yield* store.add(documents)
      processedDocuments++
      options.onProgress?.({
        current: processedDocuments,
        total: sectionsByDocument.size,
      })
    }

    yield* store.consolidate()
    yield* store.save()
    return { sectionsIndexed, duration: Date.now() - startTime }
  })
