/**
 * Indexer service for building and updating indexes
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import type { Ignore } from 'ignore'
import type { MdDocument, MdSection } from '../core/types.js'
import {
  type DirectoryCreateError,
  DirectoryWalkError,
  type FileReadError,
  type FileWriteError,
  type IndexCorruptedError,
  ParseError,
} from '../errors/index.js'
import { parse } from '../parser/parser.js'
import { createIgnoreFilter, shouldIgnore } from './ignore-patterns.js'
import {
  computeHash,
  createEmptyDocumentIndex,
  createEmptyLinkIndex,
  createEmptySectionIndex,
  createStorage,
  initializeIndex,
  loadDocumentIndex,
  loadLinkIndex,
  loadSectionIndex,
  saveDocumentIndex,
  saveLinkIndex,
  saveSectionIndex,
} from './storage.js'
import type {
  DocumentEntry,
  DocumentIndex,
  FileProcessingError,
  IndexResult,
  SectionEntry,
  SkipSummary,
} from './types.js'

// ============================================================================
// File Discovery
// ============================================================================

const isMarkdownFile = (filename: string): boolean =>
  filename.endsWith('.md') || filename.endsWith('.mdx')

/**
 * Result of directory walk including tracked skip counts
 */
interface WalkResult {
  readonly files: string[]
  readonly skipped: {
    hidden: number
    excluded: number
  }
}

interface WalkOptions {
  readonly followSymlinks?: boolean | undefined
}

/**
 * Walk directory using ignore filter for pattern matching.
 *
 * @param dir - Directory to walk
 * @param rootPath - Root path for computing relative paths
 * @param filter - Ignore filter instance
 * @param options - Walk options (e.g. followSymlinks)
 * @returns Walk result with files and skip counts
 */
const walkDirectory = async (
  dir: string,
  rootPath: string,
  filter: Ignore,
  options: WalkOptions = {},
): Promise<WalkResult> => {
  const files: string[] = []
  let hiddenCount = 0
  let excludedCount = 0
  const normalizedRoot = path.resolve(rootPath)
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(rootPath, fullPath)

    // Skip hidden files/directories (starting with .)
    if (entry.name.startsWith('.')) {
      if (entry.isDirectory()) {
        hiddenCount++
      }
      continue
    }

    // Check ignore filter for both files and directories
    if (shouldIgnore(relativePath, filter)) {
      if (entry.isDirectory()) {
        excludedCount++
      } else {
        excludedCount++
      }
      continue
    }

    // Handle symbolic links when followSymlinks is enabled
    if (entry.isSymbolicLink() && options.followSymlinks) {
      try {
        const realPath = await fs.realpath(fullPath)
        if (
          !realPath.startsWith(normalizedRoot + path.sep) &&
          realPath !== normalizedRoot
        ) {
          // Symlink target escapes the root boundary; skip it
          continue
        }
        const stat = await fs.stat(realPath)
        if (stat.isDirectory()) {
          const subResult = await walkDirectory(
            fullPath,
            rootPath,
            filter,
            options,
          )
          files.push(...subResult.files)
          hiddenCount += subResult.skipped.hidden
          excludedCount += subResult.skipped.excluded
        } else if (stat.isFile() && isMarkdownFile(entry.name)) {
          files.push(fullPath)
        }
      } catch {
        // Broken symlink or permission error; skip silently
      }
      continue
    }

    if (entry.isDirectory()) {
      const subResult = await walkDirectory(fullPath, rootPath, filter, options)
      files.push(...subResult.files)
      hiddenCount += subResult.skipped.hidden
      excludedCount += subResult.skipped.excluded
    } else if (entry.isFile() && isMarkdownFile(entry.name)) {
      files.push(fullPath)
    }
  }

  return { files, skipped: { hidden: hiddenCount, excluded: excludedCount } }
}

// ============================================================================
// Section Flattening
// ============================================================================

const flattenSections = (
  sections: readonly MdSection[],
  docId: string,
  docPath: string,
): SectionEntry[] => {
  const result: SectionEntry[] = []

  const traverse = (section: MdSection): void => {
    result.push({
      id: section.id,
      documentId: docId,
      documentPath: docPath,
      heading: section.heading,
      level: section.level,
      startLine: section.startLine,
      endLine: section.endLine,
      tokenCount: section.metadata.tokenCount,
      hasCode: section.metadata.hasCode,
      hasList: section.metadata.hasList,
      hasTable: section.metadata.hasTable,
    })

    for (const child of section.children) {
      traverse(child)
    }
  }

  for (const section of sections) {
    traverse(section)
  }

  return result
}

// ============================================================================
// Link Resolution
// ============================================================================

const resolveInternalLink = (
  href: string,
  fromPath: string,
  rootPath: string,
): string | null => {
  if (href.startsWith('#')) {
    return fromPath
  }

  if (href.startsWith('http://') || href.startsWith('https://')) {
    return null
  }

  const linkPath = href.split('#')[0] ?? ''
  if (!linkPath) return null

  const fromDir = path.dirname(fromPath)
  const resolved = path.resolve(fromDir, linkPath)

  if (!resolved.startsWith(rootPath)) {
    return null
  }

  return path.relative(rootPath, resolved)
}

// ============================================================================
// Index Building
// ============================================================================

export interface IndexProgress {
  readonly current: number
  readonly total: number
  readonly filePath: string
}

export interface IndexOptions {
  readonly force?: boolean | undefined
  /** CLI/config exclude patterns (overrides ignore files) */
  readonly exclude?: readonly string[] | undefined
  /** Whether to honor .gitignore (default: true) */
  readonly honorGitignore?: boolean | undefined
  /** Whether to honor .mdmignore (default: true) */
  readonly honorMdmignore?: boolean | undefined
  /** Whether to follow symbolic links during directory traversal (default: false) */
  readonly followSymlinks?: boolean | undefined
  /** Callback for progress updates during file indexing */
  readonly onProgress?: ((progress: IndexProgress) => void) | undefined
  /**
   * When provided, skip full directory walk and process only these paths.
   * Used by the watcher to pass accumulated changed file paths during the
   * debounce window. Absolute paths expected.
   */
  readonly changedPaths?: readonly string[] | undefined
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
    const storage = createStorage(rootPath)
    const errors: FileProcessingError[] = []

    // Initialize storage
    yield* initializeIndex(storage)

    // Load existing indexes or create empty ones
    const existingDocIndex = yield* loadDocumentIndex(storage)
    const docIndex: DocumentIndex =
      options.force || !existingDocIndex
        ? createEmptyDocumentIndex(storage.rootPath)
        : existingDocIndex

    // Load existing section and link indexes to preserve data for unchanged files.
    // When force is true, start from empty indexes to avoid stale byHeading entries
    // accumulating (the document index is empty so cleanup cannot find old entries).
    const existingSectionIndex = yield* loadSectionIndex(storage)
    const existingLinkIndex = yield* loadLinkIndex(storage)
    const sectionIndex = options.force
      ? createEmptySectionIndex()
      : (existingSectionIndex ?? createEmptySectionIndex())
    const linkIndex = options.force
      ? createEmptyLinkIndex()
      : (existingLinkIndex ?? createEmptyLinkIndex())

    // Build ignore filter with proper precedence:
    // CLI/config patterns > .mdmignore > .gitignore > defaults
    const ignoreResult = yield* createIgnoreFilter({
      rootPath: storage.rootPath,
      cliPatterns: options.exclude,
      honorGitignore: options.honorGitignore ?? true,
      honorMdmignore: options.honorMdmignore ?? true,
    })

    // Discover files: use changedPaths if provided (watcher mode),
    // otherwise do a full directory walk
    let files: string[]
    let walkSkipped: { excluded: number; hidden: number }

    // Track paths that were deleted (watcher mode only). Populated during
    // file discovery, consumed after mutable indexes are initialized.
    const deletedPaths: string[] = []

    if (options.changedPaths && options.changedPaths.length > 0) {
      // Watcher mode: separate deleted files from changed/added files.
      // Deleted paths arrive from chokidar's unlink event and no longer
      // exist on disk. Attempting fs.readFile on them would ENOENT, leaving
      // stale entries in the index.
      const markdownPaths = options.changedPaths.filter((p) =>
        isMarkdownFile(p),
      ) as string[]
      const existResults = yield* Effect.promise(() =>
        Promise.all(
          markdownPaths.map((p) =>
            fs
              .stat(p)
              .then(() => true)
              .catch(() => false),
          ),
        ),
      )
      files = []
      for (let i = 0; i < markdownPaths.length; i++) {
        if (existResults[i]) {
          files.push(markdownPaths[i]!)
        } else {
          deletedPaths.push(markdownPaths[i]!)
        }
      }
      walkSkipped = { excluded: 0, hidden: 0 }
    } else {
      const walkResult = yield* Effect.tryPromise({
        try: () =>
          walkDirectory(
            storage.rootPath,
            storage.rootPath,
            ignoreResult.filter,
            {
              followSymlinks: options.followSymlinks,
            },
          ),
        catch: (e) =>
          new DirectoryWalkError({
            path: storage.rootPath,
            message: `Failed to traverse directory: ${e instanceof Error ? e.message : String(e)}`,
            cause: e,
          }),
      })
      files = walkResult.files
      walkSkipped = walkResult.skipped
    }

    // Process each file
    let documentsIndexed = 0
    let sectionsIndexed = 0
    let linksIndexed = 0
    let unchangedCount = 0

    const mutableDocuments: Record<string, DocumentEntry> = {
      ...docIndex.documents,
    }
    const mutableSections: Record<string, SectionEntry> = {
      ...sectionIndex.sections,
    }

    const mutableByHeading: Record<string, string[]> = Object.assign(
      Object.create(null),
      Object.fromEntries(
        Object.entries(sectionIndex.byHeading).map(([k, v]) => [k, [...v]]),
      ),
    )
    const mutableByDocument: Record<string, string[]> = Object.assign(
      Object.create(null),
      Object.fromEntries(
        Object.entries(sectionIndex.byDocument).map(([k, v]) => [k, [...v]]),
      ),
    )
    const mutableForward: Record<string, string[]> = Object.assign(
      Object.create(null),
      Object.fromEntries(
        Object.entries(linkIndex.forward).map(([k, v]) => [k, [...v]]),
      ),
    )
    const mutableBackward: Record<string, string[]> = Object.assign(
      Object.create(null),
      Object.fromEntries(
        Object.entries(linkIndex.backward).map(([k, v]) => [k, [...v]]),
      ),
    )
    const brokenLinks = new Set<string>(linkIndex.broken)

    // Remove deleted files from all indexes before the parse phase.
    // In watcher mode, chokidar's unlink events produce paths that no longer
    // exist on disk. Without this cleanup, stale document/section/link entries
    // persist in the stored index after a file is deleted or renamed.
    for (const deletedPath of deletedPaths) {
      const relativePath = path.relative(storage.rootPath, deletedPath)
      const existingEntry = mutableDocuments[relativePath]
      if (!existingEntry) continue

      // Remove sections belonging to this document
      const oldSectionIds = mutableByDocument[existingEntry.id] ?? []
      for (const sectionId of oldSectionIds) {
        const oldSection = mutableSections[sectionId]
        if (oldSection) {
          const headingKey = oldSection.heading.toLowerCase()
          const headingList = mutableByHeading[headingKey]
          if (headingList) {
            const idx = headingList.indexOf(sectionId)
            if (idx !== -1) headingList.splice(idx, 1)
          }
        }
        delete mutableSections[sectionId]
      }
      delete mutableByDocument[existingEntry.id]

      // Remove forward links from this document and clean up backward refs
      const forwardTargets = mutableForward[relativePath] ?? []
      for (const target of forwardTargets) {
        const backList = mutableBackward[target]
        if (backList) {
          const idx = backList.indexOf(relativePath)
          if (idx !== -1) backList.splice(idx, 1)
        }
      }
      delete mutableForward[relativePath]

      // Remove backward entry for this path (other files linking here).
      // The broken-link scan at the end of Phase 2 will re-flag these
      // targets since the document no longer exists in mutableDocuments.
      delete mutableBackward[relativePath]

      // Remove document entry
      delete mutableDocuments[relativePath]
    }

    const totalFiles = files.length

    // Phase 1: Read and parse files concurrently.
    // I/O and parsing are the bottleneck; running them in parallel reduces
    // build time from O(n * avg_io) to O(n * avg_io / concurrency).
    type ParsedFile = {
      filePath: string
      relativePath: string
      content: string
      stats: { mtime: Date; mtimeMs: number }
      hash: string
      doc: MdDocument
    }

    const fileEffects = files.map((filePath) => {
      const relativePath = path.relative(storage.rootPath, filePath)

      return Effect.gen(function* () {
        const [content, stats] = yield* Effect.promise(() =>
          Promise.all([fs.readFile(filePath, 'utf-8'), fs.stat(filePath)]),
        )

        const hash = computeHash(content)
        const existingEntry = mutableDocuments[relativePath]

        // Skip if unchanged
        if (
          !options.force &&
          existingEntry &&
          existingEntry.hash === hash &&
          existingEntry.mtime === stats.mtime.getTime()
        ) {
          return null // unchanged
        }

        // Parse document
        const doc = yield* parse(content, {
          path: relativePath,
          lastModified: stats.mtime,
        }).pipe(
          Effect.mapError(
            (e) =>
              new ParseError({
                message: e.message,
                path: relativePath,
                ...(e.line !== undefined && { line: e.line }),
                ...(e.column !== undefined && { column: e.column }),
              }),
          ),
        )

        return {
          filePath,
          relativePath,
          content,
          stats: { mtime: stats.mtime, mtimeMs: stats.mtime.getTime() },
          hash,
          doc,
        } as ParsedFile
      }).pipe(
        // Note: catchAll is intentional for batch file processing.
        // Individual file failures should be collected in errors array
        // rather than stopping the entire index build operation.
        Effect.catchAll((error) => {
          const message =
            'message' in error && typeof error.message === 'string'
              ? error.message
              : String(error)
          errors.push({ path: relativePath, message })
          return Effect.succeed(null)
        }),
      )
    })

    const parsedFiles = yield* Effect.all(fileEffects, { concurrency: 50 })

    // Phase 2: Merge results into indexes (synchronous, single-threaded).
    // This section mutates shared index objects. It runs sequentially after
    // all I/O completes, so no concurrent access concerns.
    for (let fileIndex = 0; fileIndex < parsedFiles.length; fileIndex++) {
      const result = parsedFiles[fileIndex]!
      const filePath = files[fileIndex]!
      const relativePath = path.relative(storage.rootPath, filePath)

      // Report progress
      if (options.onProgress) {
        options.onProgress({
          current: fileIndex + 1,
          total: totalFiles,
          filePath: relativePath,
        })
      }

      if (result === null) {
        // File was unchanged or errored during phase 1
        const existingEntry = mutableDocuments[relativePath]
        if (existingEntry && !errors.some((e) => e.path === relativePath)) {
          unchangedCount++
        }
        continue
      }

      const { doc, hash } = result
      const existingEntry = mutableDocuments[relativePath]

      // Clean up old sections for this document before adding new ones
      if (existingEntry) {
        const oldSectionIds = mutableByDocument[existingEntry.id] ?? []
        for (const sectionId of oldSectionIds) {
          const oldSection = mutableSections[sectionId]
          if (oldSection) {
            const headingKey = oldSection.heading.toLowerCase()
            const headingList = mutableByHeading[headingKey]
            if (headingList) {
              const idx = headingList.indexOf(sectionId)
              if (idx !== -1) headingList.splice(idx, 1)
            }
          }
          delete mutableSections[sectionId]
        }
        delete mutableByDocument[existingEntry.id]
        delete mutableForward[relativePath]
      }

      // Update document index
      mutableDocuments[relativePath] = {
        id: doc.id,
        path: relativePath,
        title: doc.title,
        mtime: result.stats.mtimeMs,
        hash,
        tokenCount: doc.metadata.tokenCount,
        sectionCount: doc.metadata.headingCount,
      }

      documentsIndexed++

      // Update section index
      const sections = flattenSections(doc.sections, doc.id, relativePath)
      mutableByDocument[doc.id] = []

      for (const section of sections) {
        mutableSections[section.id] = section
        mutableByDocument[doc.id]?.push(section.id)

        const headingKey = section.heading.toLowerCase()
        if (!mutableByHeading[headingKey]) {
          mutableByHeading[headingKey] = []
        }
        mutableByHeading[headingKey]?.push(section.id)

        sectionsIndexed++
      }

      // Update link index
      const internalLinks = doc.links.filter((l) => l.type === 'internal')
      const outgoingLinks: string[] = []

      for (const link of internalLinks) {
        const target = resolveInternalLink(
          link.href,
          filePath,
          storage.rootPath,
        )

        if (target) {
          outgoingLinks.push(target)

          if (!mutableBackward[target]) {
            mutableBackward[target] = []
          }
          if (!mutableBackward[target]?.includes(relativePath)) {
            mutableBackward[target]?.push(relativePath)
          }

          linksIndexed++
        }
      }

      mutableForward[relativePath] = outgoingLinks
    }

    // Check for broken links
    for (const [_from, targets] of Object.entries(mutableForward)) {
      for (const target of targets) {
        if (!mutableDocuments[target] && !brokenLinks.has(target)) {
          brokenLinks.add(target)
        }
      }
    }

    // Save indexes
    yield* saveDocumentIndex(storage, {
      version: docIndex.version,
      rootPath: storage.rootPath,
      documents: mutableDocuments,
    })

    yield* saveSectionIndex(storage, {
      version: sectionIndex.version,
      sections: mutableSections,
      byHeading: mutableByHeading,
      byDocument: mutableByDocument,
    })

    yield* saveLinkIndex(storage, {
      version: linkIndex.version,
      forward: mutableForward,
      backward: mutableBackward,
      broken: [...brokenLinks],
    })

    const duration = Date.now() - startTime

    // Calculate totals for all links across all forward entries
    const totalLinks = Object.values(mutableForward).reduce(
      (sum, links) => sum + links.length,
      0,
    )

    // Build skip summary
    const skipped: SkipSummary = {
      unchanged: unchangedCount,
      excluded: walkSkipped.excluded,
      hidden: walkSkipped.hidden,
      total: unchangedCount + walkSkipped.excluded + walkSkipped.hidden,
    }

    return {
      documentsIndexed,
      sectionsIndexed,
      linksIndexed,
      totalDocuments: Object.keys(mutableDocuments).length,
      totalSections: Object.keys(mutableSections).length,
      totalLinks,
      duration,
      errors,
      skipped,
    }
  })

// ============================================================================
// Link Queries
// ============================================================================

export const getOutgoingLinks = (
  rootPath: string,
  filePath: string,
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath)
    const linkIndex = yield* loadLinkIndex(storage)

    if (!linkIndex) {
      return []
    }

    const relativePath = path.relative(storage.rootPath, path.resolve(filePath))
    return linkIndex.forward[relativePath] ?? []
  })

export const getIncomingLinks = (
  rootPath: string,
  filePath: string,
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath)
    const linkIndex = yield* loadLinkIndex(storage)

    if (!linkIndex) {
      return []
    }

    const relativePath = path.relative(storage.rootPath, path.resolve(filePath))
    return linkIndex.backward[relativePath] ?? []
  })

export const getBrokenLinks = (
  rootPath: string,
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath)
    const linkIndex = yield* loadLinkIndex(storage)

    if (!linkIndex) {
      return []
    }

    return linkIndex.broken
  })

// ============================================================================
// BM25 Index Building
// ============================================================================

import { type BM25Document, createBM25Store } from '../search/bm25-store.js'

export interface BuildBM25Options {
  readonly force?: boolean
  readonly onProgress?: (progress: { current: number; total: number }) => void
}

export interface BuildBM25Result {
  readonly sectionsIndexed: number
  readonly duration: number
}

/**
 * Build BM25 keyword index for all sections.
 *
 * @param rootPath - Root directory containing indexed markdown files
 * @param options - Build options (force rebuild, progress callback)
 * @returns Result with section count and timing
 */
export const buildBM25Index = (
  rootPath: string,
  options: BuildBM25Options = {},
): Effect.Effect<
  BuildBM25Result,
  FileReadError | IndexCorruptedError | FileWriteError
> =>
  Effect.gen(function* () {
    const startTime = Date.now()
    const storage = createStorage(rootPath)

    // Load section index
    const docIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)

    if (!docIndex || !sectionIndex) {
      return { sectionsIndexed: 0, duration: 0 }
    }

    // Create BM25 store
    const bm25Store = createBM25Store(storage.rootPath)

    // Check if we can skip
    if (!options.force) {
      const loaded = yield* bm25Store.load()
      if (loaded) {
        const stats = bm25Store.getStats()
        if (stats.count > 0) {
          return { sectionsIndexed: 0, duration: Date.now() - startTime }
        }
      }
    }

    // Clear and rebuild
    bm25Store.clear()

    // Group sections by document for efficient file reading
    const sectionsByDoc: Map<string, SectionEntry[]> = new Map()
    for (const section of Object.values(sectionIndex.sections)) {
      if (section.tokenCount < 10) continue
      const existing = sectionsByDoc.get(section.documentPath)
      if (existing) {
        existing.push(section)
      } else {
        sectionsByDoc.set(section.documentPath, [section])
      }
    }

    const totalDocs = sectionsByDoc.size
    let processedDocs = 0
    let sectionsIndexed = 0

    // Process each document
    for (const [docPath, sections] of sectionsByDoc) {
      const filePath = path.join(storage.rootPath, docPath)

      // Read file content
      const fileContentResult = yield* Effect.promise(() =>
        fs.readFile(filePath, 'utf-8'),
      ).pipe(
        Effect.map((content) => ({ ok: true as const, content })),
        Effect.catchAll(() =>
          Effect.succeed({ ok: false as const, content: '' }),
        ),
      )

      if (!fileContentResult.ok) continue

      const lines = fileContentResult.content.split('\n')
      const docs: BM25Document[] = []

      for (const section of sections) {
        const content = lines
          .slice(section.startLine - 1, section.endLine)
          .join('\n')

        docs.push({
          id: section.id,
          sectionId: section.id,
          documentPath: section.documentPath,
          heading: section.heading,
          content,
        })
        sectionsIndexed++
      }

      yield* bm25Store.add(docs)

      processedDocs++
      if (options.onProgress) {
        options.onProgress({ current: processedDocs, total: totalDocs })
      }
    }

    // Consolidate and save
    yield* bm25Store.consolidate()
    yield* bm25Store.save()

    return {
      sectionsIndexed,
      duration: Date.now() - startTime,
    }
  })
