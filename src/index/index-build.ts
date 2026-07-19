import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import type { MdDocument } from '../core/types.js'
import {
  type DirectoryCreateError,
  type DirectoryWalkError,
  type FileReadError,
  type FileWriteError,
  type IndexCorruptedError,
  ParseError,
} from '../errors/index.js'
import { parse } from '../parser/parser.js'
import { discoverFiles } from './file-discovery.js'
import { createIgnoreFilter } from './ignore-patterns.js'
import {
  applyDocument,
  createMutableIndexState,
  deleteIndexedDocument,
  type MutableIndexState,
  markBrokenLinks,
  saveIndexState,
} from './index-state.js'
import {
  computeHash,
  createEmptyDocumentIndex,
  createEmptyLinkIndex,
  createEmptySectionIndex,
  createStorage,
  type IndexStorage,
  initializeIndex,
  loadDocumentIndex,
  loadLinkIndex,
  loadSectionIndex,
} from './storage.js'
import type { FileProcessingError, IndexResult, SkipSummary } from './types.js'

export interface IndexProgress {
  readonly current: number
  readonly total: number
  readonly filePath: string
}

export interface IndexOptions {
  readonly force?: boolean | undefined
  readonly exclude?: readonly string[] | undefined
  readonly honorGitignore?: boolean | undefined
  readonly honorMdmignore?: boolean | undefined
  readonly followSymlinks?: boolean | undefined
  readonly onProgress?: ((progress: IndexProgress) => void) | undefined
  readonly changedPaths?: readonly string[] | undefined
}

interface ParsedFile {
  readonly filePath: string
  readonly relativePath: string
  readonly content: string
  readonly stats: { mtime: Date; mtimeMs: number }
  readonly hash: string
  readonly document: MdDocument
}

const loadMutableState = (
  storage: IndexStorage,
  force: boolean,
): Effect.Effect<MutableIndexState, FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    const existingDocuments = yield* loadDocumentIndex(storage)
    const documents =
      force || !existingDocuments
        ? createEmptyDocumentIndex(storage.sourceRoot)
        : existingDocuments
    const existingSections = yield* loadSectionIndex(storage)
    const existingLinks = yield* loadLinkIndex(storage)
    return createMutableIndexState(
      documents,
      force
        ? createEmptySectionIndex()
        : (existingSections ?? createEmptySectionIndex()),
      force
        ? createEmptyLinkIndex()
        : (existingLinks ?? createEmptyLinkIndex()),
    )
  })

const parseFiles = (
  storage: IndexStorage,
  files: readonly string[],
  state: MutableIndexState,
  options: IndexOptions,
  errors: FileProcessingError[],
) =>
  Effect.all(
    files.map((filePath) => {
      const relativePath = path.relative(storage.sourceRoot, filePath)
      return Effect.gen(function* () {
        const [content, stats] = yield* Effect.promise(() =>
          Promise.all([fs.readFile(filePath, 'utf-8'), fs.stat(filePath)]),
        )
        const hash = computeHash(content)
        const existing = state.documents[relativePath]
        if (
          !options.force &&
          existing?.hash === hash &&
          existing.mtime === stats.mtime.getTime()
        ) {
          return null
        }
        const document = yield* parse(content, {
          path: relativePath,
          lastModified: stats.mtime,
        }).pipe(
          Effect.mapError(
            (error) =>
              new ParseError({
                message: error.message,
                path: relativePath,
                ...(error.line !== undefined && { line: error.line }),
                ...(error.column !== undefined && { column: error.column }),
              }),
          ),
        )
        return {
          filePath,
          relativePath,
          content,
          stats: { mtime: stats.mtime, mtimeMs: stats.mtime.getTime() },
          hash,
          document,
        } satisfies ParsedFile
      }).pipe(
        Effect.catchAll((error) => {
          const message =
            'message' in error && typeof error.message === 'string'
              ? error.message
              : String(error)
          errors.push({ path: relativePath, message })
          return Effect.succeed(null)
        }),
      )
    }),
    { concurrency: 50 },
  )

interface MergeResult {
  readonly documentsIndexed: number
  readonly sectionsIndexed: number
  readonly linksIndexed: number
  readonly unchanged: number
}

const mergeParsedFiles = (
  files: readonly string[],
  parsedFiles: readonly (ParsedFile | null)[],
  storage: IndexStorage,
  state: MutableIndexState,
  options: IndexOptions,
  errors: readonly FileProcessingError[],
): MergeResult => {
  let documentsIndexed = 0
  let sectionsIndexed = 0
  let linksIndexed = 0
  let unchanged = 0

  for (let index = 0; index < parsedFiles.length; index++) {
    const parsed = parsedFiles[index]!
    const relativePath = path.relative(storage.sourceRoot, files[index]!)
    options.onProgress?.({
      current: index + 1,
      total: files.length,
      filePath: relativePath,
    })
    if (!parsed) {
      if (
        state.documents[relativePath] &&
        !errors.some((error) => error.path === relativePath)
      ) {
        unchanged++
      }
      continue
    }
    const applied = applyDocument(state, {
      document: parsed.document,
      filePath: parsed.filePath,
      relativePath: parsed.relativePath,
      rootPath: storage.sourceRoot,
      hash: parsed.hash,
      mtime: parsed.stats.mtimeMs,
    })
    documentsIndexed++
    sectionsIndexed += applied.sectionsIndexed
    linksIndexed += applied.linksIndexed
  }
  return { documentsIndexed, sectionsIndexed, linksIndexed, unchanged }
}

export const buildIndex = (
  rootPath: string,
  options: IndexOptions = {},
): Effect.Effect<
  IndexResult,
  | DirectoryWalkError
  | DirectoryCreateError
  | FileReadError
  | FileWriteError
  | IndexCorruptedError
> =>
  Effect.gen(function* () {
    const startTime = Date.now()
    const storage = createStorage(rootPath, rootPath)
    const errors: FileProcessingError[] = []
    yield* initializeIndex(storage)
    const state = yield* loadMutableState(storage, options.force ?? false)
    const ignore = yield* createIgnoreFilter({
      rootPath: storage.sourceRoot,
      cliPatterns: options.exclude,
      honorGitignore: options.honorGitignore ?? true,
      honorMdmignore: options.honorMdmignore ?? true,
    })
    const discovery = yield* discoverFiles(storage.sourceRoot, ignore.filter, {
      changedPaths: options.changedPaths,
      followSymlinks: options.followSymlinks,
    })
    for (const deletedPath of discovery.deletedPaths) {
      deleteIndexedDocument(
        state,
        path.relative(storage.sourceRoot, deletedPath),
      )
    }

    const parsed = yield* parseFiles(
      storage,
      discovery.files,
      state,
      options,
      errors,
    )
    const counts = mergeParsedFiles(
      discovery.files,
      parsed,
      storage,
      state,
      options,
      errors,
    )
    markBrokenLinks(state)
    yield* saveIndexState(storage, state)

    const totalLinks = Object.values(state.forward).reduce(
      (sum, links) => sum + links.length,
      0,
    )
    const skipped: SkipSummary = {
      unchanged: counts.unchanged,
      excluded: discovery.skipped.excluded,
      hidden: discovery.skipped.hidden,
      total:
        counts.unchanged +
        discovery.skipped.excluded +
        discovery.skipped.hidden,
    }
    return {
      documentsIndexed: counts.documentsIndexed,
      sectionsIndexed: counts.sectionsIndexed,
      linksIndexed: counts.linksIndexed,
      totalDocuments: Object.keys(state.documents).length,
      totalSections: Object.keys(state.sections).length,
      totalLinks,
      duration: Date.now() - startTime,
      errors,
      skipped,
    }
  })
