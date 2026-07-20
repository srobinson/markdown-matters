import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import type { MdDocument } from '../core/types.js'
import {
  type CanonicalSourceSelection,
  type DeclaredPath,
  type DocumentKey,
  expandDeclaredPath,
  fileIdentityKey,
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
import {
  type CanonicalizedDiscovery,
  canonicalizeDiscoveredFiles,
  discoverFiles,
} from './file-discovery.js'
import { createIgnoreFilter } from './ignore-patterns.js'
import {
  applyDocument,
  createMutableIndexState,
  deleteIndexedDocument,
  deleteIndexedDocumentByKey,
  findIndexedDocumentByDeclaredPath,
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
  readonly source: CanonicalSourceSelection
  readonly resolvedLinks: readonly DocumentKey[]
  readonly brokenLinks: readonly DeclaredPath[]
}

interface UnchangedFile {
  readonly kind: 'unchanged'
}

type ParsedFileResult = ParsedFile | UnchangedFile | null

const resolveDocumentLinks = (
  document: MdDocument,
  source: CanonicalSourceSelection,
  rootPath: string,
  discovery: CanonicalizedDiscovery,
  documentKeysByIdentity: ReadonlyMap<string, DocumentKey>,
) =>
  Effect.all(
    document.links
      .filter((link) => link.type === 'internal')
      .map((link) => {
        return resolveInternalLink(
          link.href,
          source.declaredPaths[0] ?? source.key,
          rootPath,
          source.caseSensitive,
          {
            canonicalize: discovery.canonicalize,
            selectDocumentKey: (target) =>
              documentKeysByIdentity.get(fileIdentityKey(target.identity)) ??
              target.key,
          },
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

const sameValues = <T>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const sourceMatchesEntry = (
  source: CanonicalSourceSelection,
  entry: MutableIndexState['documents'][DocumentKey],
): boolean =>
  sameValues(source.paths, entry.paths) &&
  sameValues(source.declaredPaths, entry.declaredPaths) &&
  source.comparisonKey === entry.comparisonKey &&
  fileIdentityKey(source.identity) === fileIdentityKey(entry.identity)

const parseFiles = (
  storage: IndexStorage,
  discovery: CanonicalizedDiscovery,
  state: MutableIndexState,
  options: IndexOptions,
  errors: FileProcessingError[],
  reparseAliases: ReadonlySet<DeclaredPath>,
) => {
  const documentKeysByIdentity = new Map<string, DocumentKey>(
    Object.values(state.documents).map((entry) => [
      fileIdentityKey(entry.identity),
      entry.path,
    ]),
  )
  for (const source of discovery.selections) {
    documentKeysByIdentity.set(fileIdentityKey(source.identity), source.key)
  }

  return Effect.all(
    discovery.selections.map((source) => {
      const relativePath = path.relative(
        storage.sourceRoot,
        source.declaredPaths[0] ?? source.key,
      )
      return Effect.gen(function* () {
        const [content, stats] = yield* Effect.promise(() =>
          Promise.all([fs.readFile(source.key, 'utf-8'), fs.stat(source.key)]),
        )
        const hash = computeHash(content)
        const existing = state.documents[source.key]
        if (
          !options.force &&
          !source.declaredPaths.some((alias) => reparseAliases.has(alias)) &&
          existing?.hash === hash &&
          existing.mtime === stats.mtime.getTime() &&
          sourceMatchesEntry(source, existing)
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
          source,
          storage.sourceRoot,
          discovery,
          documentKeysByIdentity,
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
}

interface MergeResult {
  readonly documentsIndexed: number
  readonly sectionsIndexed: number
  readonly linksIndexed: number
  readonly unchanged: number
}

const mergeParsedFiles = (
  sources: readonly CanonicalSourceSelection[],
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
    const source = sources[index]!
    const relativePath = path.relative(
      storage.sourceRoot,
      source.declaredPaths[0] ?? source.key,
    )
    options.onProgress?.({
      current: index + 1,
      total: sources.length,
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

const reconcileCanonicalSources = (
  state: MutableIndexState,
  selections: readonly CanonicalSourceSelection[],
  sourceRoot: string,
  errors: FileProcessingError[],
): void => {
  for (const selection of selections) {
    const selectionIdentity = fileIdentityKey(selection.identity)
    for (const entry of Object.values(state.documents)) {
      const sameIdentity = fileIdentityKey(entry.identity) === selectionIdentity
      const driftedAlias = selection.declaredPaths.find((declaredPath) =>
        entry.declaredPaths.includes(declaredPath),
      )
      if (driftedAlias && !sameIdentity) {
        deleteIndexedDocumentByKey(state, entry.path)
        errors.push({
          path: path.relative(sourceRoot, driftedAlias),
          message: 'canonical target changed (moved?); reindexed',
        })
      } else if (sameIdentity && entry.path !== selection.key) {
        deleteIndexedDocumentByKey(state, entry.path)
      }
    }
  }
}

const addBacklinkSourceAliases = (
  state: MutableIndexState,
  target: DocumentKey,
  aliases: Set<DeclaredPath>,
  reparseAliases?: Set<DeclaredPath>,
): void => {
  for (const sourceKey of state.backward[target] ?? []) {
    for (const declaredPath of state.documents[sourceKey]?.declaredPaths ??
      []) {
      aliases.add(declaredPath)
      reparseAliases?.add(declaredPath)
    }
  }
}

const collectDependentAliases = (
  state: MutableIndexState,
  selections: readonly CanonicalSourceSelection[],
  includeIdentityAliases: boolean,
  reparseAliases: Set<DeclaredPath>,
): DeclaredPath[] => {
  const aliases = new Set<DeclaredPath>()
  for (const selection of selections) {
    const selectionIdentity = fileIdentityKey(selection.identity)
    for (const entry of Object.values(state.documents)) {
      const sameIdentity = fileIdentityKey(entry.identity) === selectionIdentity
      if (sameIdentity && includeIdentityAliases) {
        for (const declaredPath of entry.declaredPaths) {
          aliases.add(declaredPath)
        }
        if (entry.path !== selection.key) {
          addBacklinkSourceAliases(state, entry.path, aliases, reparseAliases)
        }
        continue
      }
      const drifted =
        !sameIdentity &&
        selection.declaredPaths.some((declaredPath) =>
          entry.declaredPaths.includes(declaredPath),
        )
      if (!drifted) continue
      for (const declaredPath of entry.declaredPaths) {
        if (!selection.declaredPaths.includes(declaredPath)) {
          aliases.add(declaredPath)
        }
      }
      addBacklinkSourceAliases(state, entry.path, aliases, reparseAliases)
    }
  }
  return [...aliases]
}

const collectDeletedReplacements = (
  state: MutableIndexState,
  deletedPaths: readonly string[],
  reparseAliases: Set<DeclaredPath>,
): DeclaredPath[] => {
  const deleted = new Set(deletedPaths.map(expandDeclaredPath))
  const replacements = new Set<DeclaredPath>()
  for (const declaredPath of deleted) {
    const entry = findIndexedDocumentByDeclaredPath(state, declaredPath)
    if (!entry) continue
    for (const alias of entry.declaredPaths) {
      if (!deleted.has(alias)) replacements.add(alias)
    }
    const backlinkAliases = new Set<DeclaredPath>()
    addBacklinkSourceAliases(state, entry.path, backlinkAliases, reparseAliases)
    for (const alias of backlinkAliases) {
      if (!deleted.has(alias)) replacements.add(alias)
    }
    deleteIndexedDocument(state, declaredPath)
  }
  return [...replacements]
}

const keepExistingAliases = async (
  aliases: readonly DeclaredPath[],
  sourceRoot: string,
  errors: FileProcessingError[],
): Promise<DeclaredPath[]> => {
  const existing: DeclaredPath[] = []
  for (const alias of [...new Set(aliases)]) {
    const found = await fs
      .stat(alias)
      .then(() => true)
      .catch(() => false)
    if (found) existing.push(alias)
    else {
      errors.push({
        path: path.relative(sourceRoot, alias),
        message: 'not found (moved/deleted?); relink required',
      })
    }
  }
  return existing
}

const reportMissingStoredAliases = async (
  state: MutableIndexState,
  sourceRoot: string,
  errors: FileProcessingError[],
): Promise<void> => {
  const aliases = Object.values(state.documents).flatMap(
    (entry) => entry.declaredPaths,
  )
  await keepExistingAliases(aliases, sourceRoot, errors)
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
    const ignoreHierarchy = yield* createIgnoreFilter({
      rootPath: storage.sourceRoot,
      cliPatterns: options.exclude,
      honorGitignore: options.honorGitignore ?? true,
      honorMdmignore: options.honorMdmignore ?? true,
    })
    const discovery = yield* discoverFiles(
      storage.sourceRoot,
      ignoreHierarchy,
      {
        changedPaths: options.changedPaths,
        followSymlinks: options.followSymlinks,
      },
    )
    const incremental = (options.changedPaths?.length ?? 0) > 0
    if (!incremental) {
      yield* Effect.promise(() =>
        reportMissingStoredAliases(state, storage.sourceRoot, errors),
      )
    }
    const reparseAliases = new Set<DeclaredPath>()
    const replacementAliases = collectDeletedReplacements(
      state,
      discovery.deletedPaths,
      reparseAliases,
    )
    const existingReplacements = yield* Effect.promise(() =>
      keepExistingAliases(replacementAliases, storage.sourceRoot, errors),
    )
    const discoveredFiles = [
      ...new Set([...discovery.files, ...existingReplacements]),
    ]
    let canonicalized = yield* canonicalizeDiscoveredFiles(discoveredFiles)
    const dependentAliases = collectDependentAliases(
      state,
      canonicalized.selections,
      incremental,
      reparseAliases,
    )
    if (dependentAliases.length > 0) {
      const existingDependentAliases = yield* Effect.promise(() =>
        keepExistingAliases(dependentAliases, storage.sourceRoot, errors),
      )
      canonicalized = yield* canonicalizeDiscoveredFiles([
        ...new Set([...discoveredFiles, ...existingDependentAliases]),
      ])
    }
    const selections = canonicalized.selections
    const canonicalDiscovery = { ...canonicalized, selections }
    reconcileCanonicalSources(state, selections, storage.sourceRoot, errors)

    const parsed = yield* parseFiles(
      storage,
      canonicalDiscovery,
      state,
      options,
      errors,
      reparseAliases,
    )
    const counts = mergeParsedFiles(selections, parsed, storage, state, options)
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
