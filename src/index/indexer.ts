/**
 * Indexer service for building and updating indexes
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import type { MdSection } from '../core/types.js'
import {
  type DirectoryCreateError,
  DirectoryWalkError,
  type FileReadError,
  type FileWriteError,
  type IndexCorruptedError,
  ParseError,
} from '../errors/index.js'
import { parse } from '../parser/parser.js'
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

const shouldExclude = (
  filePath: string,
  exclude: readonly string[],
): boolean => {
  const normalized = filePath.toLowerCase()
  for (const pattern of exclude) {
    if (
      pattern.includes('node_modules') &&
      normalized.includes('node_modules')
    ) {
      return true
    }
    if (pattern.startsWith('**/.*') && normalized.includes('/.')) {
      return true
    }
  }
  return false
}

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

const walkDirectory = async (
  dir: string,
  exclude: readonly string[],
): Promise<WalkResult> => {
  const files: string[] = []
  let hiddenCount = 0
  let excludedCount = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      if (entry.isDirectory()) {
        hiddenCount++
      }
      continue
    }

    if (shouldExclude(fullPath, exclude)) {
      excludedCount++
      continue
    }

    if (entry.isDirectory()) {
      const subResult = await walkDirectory(fullPath, exclude)
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

export interface IndexOptions {
  readonly force?: boolean
  readonly exclude?: readonly string[]
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

    // Load existing section and link indexes to preserve data for unchanged files
    const existingSectionIndex = yield* loadSectionIndex(storage)
    const existingLinkIndex = yield* loadLinkIndex(storage)
    const sectionIndex = existingSectionIndex ?? createEmptySectionIndex()
    const linkIndex = existingLinkIndex ?? createEmptyLinkIndex()

    // Discover files
    const exclude = options.exclude ?? ['**/node_modules/**', '**/.*/**']
    const walkResult = yield* Effect.tryPromise({
      try: () => walkDirectory(storage.rootPath, exclude),
      catch: (e) =>
        new DirectoryWalkError({
          path: storage.rootPath,
          message: `Failed to traverse directory: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        }),
    })

    const { files, skipped: walkSkipped } = walkResult

    // Process each file
    let documentsIndexed = 0
    let sectionsIndexed = 0
    let linksIndexed = 0
    let unchangedCount = 0

    const mutableDocuments: Record<string, DocumentEntry> = {
      ...docIndex.documents,
    }
    // Initialize with existing data to preserve sections/links for unchanged files
    const mutableSections: Record<string, SectionEntry> = {
      ...sectionIndex.sections,
    }
    const mutableByHeading: Record<string, string[]> = Object.fromEntries(
      Object.entries(sectionIndex.byHeading).map(([k, v]) => [k, [...v]]),
    )
    const mutableByDocument: Record<string, string[]> = Object.fromEntries(
      Object.entries(sectionIndex.byDocument).map(([k, v]) => [k, [...v]]),
    )
    const mutableForward: Record<string, string[]> = Object.fromEntries(
      Object.entries(linkIndex.forward).map(([k, v]) => [k, [...v]]),
    )
    const mutableBackward: Record<string, string[]> = Object.fromEntries(
      Object.entries(linkIndex.backward).map(([k, v]) => [k, [...v]]),
    )
    const brokenLinks: string[] = [...linkIndex.broken]

    for (const filePath of files) {
      const relativePath = path.relative(storage.rootPath, filePath)

      // Process each file, collecting errors instead of failing
      const processFile = Effect.gen(function* () {
        // Read file content and stats
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
          unchangedCount++
          return // File unchanged, skip processing
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

        // Clean up old sections for this document before adding new ones
        if (existingEntry) {
          const oldSectionIds = mutableByDocument[existingEntry.id] ?? []
          for (const sectionId of oldSectionIds) {
            const oldSection = mutableSections[sectionId]
            if (oldSection) {
              // Remove from byHeading
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

          // Clean up old links
          delete mutableForward[relativePath]
        }

        // Update document index
        mutableDocuments[relativePath] = {
          id: doc.id,
          path: relativePath,
          title: doc.title,
          mtime: stats.mtime.getTime(),
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

          // Index by heading
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

            // Add to backward links
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
      }).pipe(
        // Note: catchAll is intentional for batch file processing.
        // Individual file failures should be collected in errors array
        // rather than stopping the entire index build operation.
        Effect.catchAll((error) => {
          // Extract message from typed errors or generic errors
          const message =
            'message' in error && typeof error.message === 'string'
              ? error.message
              : String(error)
          errors.push({
            path: relativePath,
            message,
          })
          return Effect.void
        }),
      )

      yield* processFile
    }

    // Check for broken links
    for (const [_from, targets] of Object.entries(mutableForward)) {
      for (const target of targets) {
        if (!mutableDocuments[target] && !brokenLinks.includes(target)) {
          brokenLinks.push(target)
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
      broken: brokenLinks,
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
