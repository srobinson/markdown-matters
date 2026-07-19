import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import type { MdDocument } from '../core/types.js'
import {
  type CanonicalSource,
  canonicalizeSourceFile,
  type DeclaredPath,
  type DocumentKey,
  expandDeclaredPath,
} from '../db/canonical.js'
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
  saveIndexState,
} from './index-state.js'
import { resolveInternalLink } from './link-index.js'
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
  readonly indexRoot: string
  readonly force?: boolean | undefined
  readonly exclude?: readonly string[] | undefined
  readonly honorGitignore?: boolean | undefined
  readonly honorMdmignore?: boolean | undefined
  readonly followSymlinks?: boolean | undefined
  readonly onProgress?: ((progress: IndexProgress) => void) | undefined
  readonly changedPaths?: readonly string[] | undefined
}

interface ParsedFile {
  readonly kind: 'parsed'
  readonly mtime: number
  readonly hash: string
  readonly document: MdDocument
  readonly source: CanonicalSource
  readonly resolvedLinks: readonly DocumentKey[]
  readonly brokenLinks: readonly DeclaredPath[]
}

interface UnchangedFile {
  readonly kind: 'unchanged'
}

type ParsedFileResult = ParsedFile | UnchangedFile | null

type LinkTarget =
  | { readonly kind: 'resolved'; readonly path: DocumentKey }
  | { readonly kind: 'broken'; readonly path: DeclaredPath }

const resolveDocumentLinks = (
  document: MdDocument,
  filePath: string,
  source: CanonicalSource,
  rootPath: string,
) =>
  Effect.all(
    document.links
      .filter((link) => link.type === 'internal')
      .map((link) => {
        const declaredPath = resolveInternalLink(
          link.href,
          filePath,
          rootPath,
          source.caseSensitive,
        )
        if (!declaredPath) return Effect.succeed(null)
        return canonicalizeSourceFile(declaredPath).pipe(
          Effect.map(
            (target): LinkTarget => ({ kind: 'resolved', path: target.key }),
          ),
          Effect.catchAll(() =>
            Effect.succeed<LinkTarget>({
              kind: 'broken',
              path: declaredPath,
            }),
          ),
        )
      }),
    { concurrency: 50 },
  ).pipe(
    Effect.map((targets) => ({
      resolvedLinks: targets.flatMap((target) =>
        target?.kind === 'resolved' ? [target.path] : [],
      ),
      brokenLinks: targets.flatMap((target) =>
        target?.kind === 'broken' ? [target.path] : [],
      ),
    })),
  )

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
        const source = yield* canonicalizeSourceFile(filePath)
        const [content, stats] = yield* Effect.promise(() =>
          Promise.all([fs.readFile(filePath, 'utf-8'), fs.stat(filePath)]),
        )
        const hash = computeHash(content)
        const existing = state.documents[source.key]
        if (
          !options.force &&
          existing?.hash === hash &&
          existing.mtime === stats.mtime.getTime()
        ) {
          return { kind: 'unchanged' } satisfies UnchangedFile
        }
        const document = yield* parse(content, {
          path: source.key,
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
        const links = yield* resolveDocumentLinks(
          document,
          filePath,
          source,
          storage.sourceRoot,
        )
        return {
          kind: 'parsed',
          mtime: stats.mtime.getTime(),
          hash,
          document,
          source,
          ...links,
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
  parsedFiles: readonly ParsedFileResult[],
  storage: IndexStorage,
  state: MutableIndexState,
  options: IndexOptions,
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
      continue
    }
    if (parsed.kind === 'unchanged') {
      unchanged++
      continue
    }
    const applied = applyDocument(state, {
      document: parsed.document,
      source: parsed.source,
      resolvedLinks: parsed.resolvedLinks,
      brokenLinks: parsed.brokenLinks,
      hash: parsed.hash,
      mtime: parsed.mtime,
    })
    documentsIndexed++
    sectionsIndexed += applied.sectionsIndexed
    linksIndexed += applied.linksIndexed
  }
  return { documentsIndexed, sectionsIndexed, linksIndexed, unchanged }
}

export const buildIndex = (
  rootPath: string,
  options: IndexOptions,
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
    const storage = createStorage(rootPath, options.indexRoot)
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
      deleteIndexedDocument(state, expandDeclaredPath(deletedPath))
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
    )
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
