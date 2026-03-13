/**
 * Duplicate Content Detection
 *
 * Detects duplicate and near-duplicate content across markdown sections.
 * Uses both exact hash matching and embedding similarity for detection.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect, Option } from 'effect'
import { FileReadError, type IndexCorruptedError } from '../errors/index.js'
import { createStorage, loadSectionIndex } from '../index/storage.js'
import { matchPath } from '../search/path-matcher.js'

// ============================================================================
// Types
// ============================================================================

/**
 * A group of duplicate sections, with one primary and zero or more duplicates.
 */
export interface DuplicateGroup {
  /** The primary section (first encountered or highest-ranked) */
  readonly primary: DuplicateSectionInfo
  /** All sections that are duplicates of the primary */
  readonly duplicates: readonly DuplicateSectionInfo[]
  /** Detection method used */
  readonly method: 'exact' | 'similar'
  /** Similarity score (1.0 for exact matches, <1.0 for similar) */
  readonly similarity: number
}

/**
 * Information about a section in a duplicate group.
 */
export interface DuplicateSectionInfo {
  readonly sectionId: string
  readonly documentPath: string
  readonly heading: string
  readonly startLine: number
  readonly endLine: number
  readonly tokenCount: number
}

/**
 * Options for duplicate detection.
 */
export interface DuplicateDetectionOptions {
  /** Minimum content length (characters) to consider for duplicate detection */
  readonly minContentLength?: number | undefined
  /** Similarity threshold for near-duplicate detection (0-1, default: 0.85) */
  readonly similarityThreshold?: number | undefined
  /** Include exact matches only (skip similarity detection) */
  readonly exactOnly?: boolean | undefined
  /** Filter by document path pattern */
  readonly pathPattern?: string | undefined
}

/**
 * Result of duplicate detection.
 */
export interface DuplicateDetectionResult {
  /** Groups of duplicate sections */
  readonly groups: readonly DuplicateGroup[]
  /** Total sections analyzed */
  readonly sectionsAnalyzed: number
  /** Total duplicate pairs found */
  readonly duplicatePairs: number
  /** Sections involved in at least one duplicate relationship */
  readonly sectionsWithDuplicates: number
}

/**
 * Options for collapsing search results.
 */
export interface CollapseOptions {
  /** Show duplicate locations in output */
  readonly showLocations?: boolean
  /** Maximum duplicate locations to show */
  readonly maxLocations?: number
}

/**
 * A search result with collapsed duplicate information.
 */
export interface CollapsedResult<T> {
  /** The primary result */
  readonly result: T
  /** Number of duplicates collapsed */
  readonly duplicateCount: number
  /** Locations of duplicates (if showLocations enabled) */
  readonly duplicateLocations:
    | readonly {
        readonly documentPath: string
        readonly heading: string
      }[]
    | undefined
}

// ============================================================================
// Content Hashing
// ============================================================================

/**
 * Normalize content for comparison by removing whitespace variations
 * and normalizing line endings.
 */
const normalizeContent = (content: string): string => {
  return content
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * Compute a content hash for exact duplicate detection.
 */
const computeContentHash = (content: string): string => {
  const normalized = normalizeContent(content)
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

// ============================================================================
// Section Content Loading
// ============================================================================

/**
 * File content cache for efficient section loading.
 * Multiple sections from the same file share the cached content.
 */
interface FileContentCache {
  readonly cache: Map<string, string | null>
  get: (
    rootPath: string,
    documentPath: string,
  ) => Effect.Effect<string | null, never>
}

/**
 * Create a file content cache for efficient repeated lookups.
 */
const createFileContentCache = (): FileContentCache => {
  const cache = new Map<string, string | null>()

  return {
    cache,
    get: (rootPath: string, documentPath: string) =>
      Effect.gen(function* () {
        if (cache.has(documentPath)) {
          return cache.get(documentPath)!
        }
        const filePath = path.join(rootPath, documentPath)
        const readResult = yield* Effect.tryPromise({
          try: () => fs.readFile(filePath, 'utf-8'),
          catch: (e) =>
            new FileReadError({
              path: filePath,
              message: `Failed to read file: ${filePath}`,
              cause: e,
            }),
        }).pipe(
          Effect.tapError((e) => Effect.logWarning(`Skipping file: ${e.path}`)),
          Effect.option,
        )
        const content = Option.isSome(readResult) ? readResult.value : null
        cache.set(documentPath, content)
        return content
      }),
  }
}

/**
 * Extract section content from cached file content.
 */
const extractSectionFromContent = (
  content: string,
  startLine: number,
  endLine: number,
): string => {
  const lines = content.split('\n')
  return lines.slice(startLine - 1, endLine).join('\n')
}

// ============================================================================
// Duplicate Detection
// ============================================================================

/**
 * Detect duplicate sections using content hashing (exact matches).
 * This is fast and doesn't require embeddings.
 */
export const detectExactDuplicates = (
  rootPath: string,
  options: DuplicateDetectionOptions = {},
): Effect.Effect<
  DuplicateDetectionResult,
  FileReadError | IndexCorruptedError
> =>
  Effect.gen(function* () {
    const minContentLength = options.minContentLength ?? 50
    const storage = createStorage(rootPath)

    // Load section index
    const sectionIndex = yield* loadSectionIndex(storage)
    if (!sectionIndex) {
      return {
        groups: [],
        sectionsAnalyzed: 0,
        duplicatePairs: 0,
        sectionsWithDuplicates: 0,
      }
    }

    const sections = Object.values(sectionIndex.sections)

    // Filter sections by path pattern if specified
    const filteredSections = options.pathPattern
      ? sections.filter((s) => matchPath(s.documentPath, options.pathPattern!))
      : sections

    // Map: hash -> list of sections with that hash
    const hashGroups = new Map<string, DuplicateSectionInfo[]>()

    // Create file content cache to avoid re-reading files
    const fileCache = createFileContentCache()

    // Process sections in parallel batches, grouped by file for cache efficiency
    // First, group sections by file to maximize cache hits
    const sectionsByFile = new Map<string, typeof filteredSections>()
    for (const section of filteredSections) {
      const existing = sectionsByFile.get(section.documentPath)
      if (existing) {
        existing.push(section)
      } else {
        sectionsByFile.set(section.documentPath, [section])
      }
    }

    // Process all files in parallel with concurrency limit
    yield* Effect.all(
      Array.from(sectionsByFile.entries()).map(([documentPath, sections]) =>
        Effect.gen(function* () {
          // Load file content once (cached)
          const fileContent = yield* fileCache.get(rootPath, documentPath)
          if (!fileContent) return

          // Process all sections from this file
          for (const section of sections) {
            const content = extractSectionFromContent(
              fileContent,
              section.startLine,
              section.endLine,
            )

            if (content.length < minContentLength) {
              continue
            }

            const hash = computeContentHash(content)
            const info: DuplicateSectionInfo = {
              sectionId: section.id,
              documentPath: section.documentPath,
              heading: section.heading,
              startLine: section.startLine,
              endLine: section.endLine,
              tokenCount: section.tokenCount,
            }

            const existing = hashGroups.get(hash)
            if (existing) {
              existing.push(info)
            } else {
              hashGroups.set(hash, [info])
            }
          }
        }),
      ),
      { concurrency: 10 },
    )

    // Convert to DuplicateGroup format
    const groups: DuplicateGroup[] = []
    let duplicatePairs = 0
    const sectionsInDuplicates = new Set<string>()

    for (const members of hashGroups.values()) {
      if (members.length > 1) {
        const [primary, ...duplicates] = members
        groups.push({
          primary: primary!,
          duplicates,
          method: 'exact',
          similarity: 1.0,
        })

        // Track stats
        duplicatePairs += duplicates.length
        for (const m of members) {
          sectionsInDuplicates.add(m.sectionId)
        }
      }
    }

    // Sort by number of duplicates (descending)
    groups.sort((a, b) => b.duplicates.length - a.duplicates.length)

    return {
      groups,
      sectionsAnalyzed: filteredSections.length,
      duplicatePairs,
      sectionsWithDuplicates: sectionsInDuplicates.size,
    }
  })

// ============================================================================
// Search Result Collapsing
// ============================================================================

/**
 * Collapse duplicate search results.
 * Takes search results and duplicate groups, returns collapsed results.
 *
 * @param results - Search results with sectionId property
 * @param duplicateGroups - Pre-computed duplicate groups
 * @param options - Collapse options
 * @returns Collapsed results with duplicate counts
 */
export const collapseDuplicates = <
  T extends { readonly sectionId: string; readonly documentPath: string },
>(
  results: readonly T[],
  duplicateGroups: readonly DuplicateGroup[],
  options: CollapseOptions = {},
): readonly CollapsedResult<T>[] => {
  const maxLocations = options.maxLocations ?? 3

  // Build a map: sectionId -> primary sectionId (or self if not a duplicate)
  const primaryMap = new Map<string, string>()
  const duplicateMap = new Map<string, DuplicateSectionInfo[]>()

  for (const group of duplicateGroups) {
    // Map primary to itself
    primaryMap.set(group.primary.sectionId, group.primary.sectionId)
    duplicateMap.set(group.primary.sectionId, [...group.duplicates])

    // Map all duplicates to primary
    for (const dup of group.duplicates) {
      primaryMap.set(dup.sectionId, group.primary.sectionId)
    }
  }

  // Track which primaries we've already added
  const seenPrimaries = new Set<string>()
  const collapsedResults: CollapsedResult<T>[] = []

  for (const result of results) {
    const primaryId = primaryMap.get(result.sectionId) ?? result.sectionId

    if (seenPrimaries.has(primaryId)) {
      // Skip - we've already added this duplicate group
      continue
    }

    seenPrimaries.add(primaryId)

    // Get duplicate info
    const duplicates = duplicateMap.get(primaryId) ?? []
    const duplicateLocations =
      options.showLocations && duplicates.length > 0
        ? duplicates.slice(0, maxLocations).map((d) => ({
            documentPath: d.documentPath,
            heading: d.heading,
          }))
        : undefined

    collapsedResults.push({
      result,
      duplicateCount: duplicates.length,
      duplicateLocations,
    })
  }

  return collapsedResults
}

// ============================================================================
// Detection from Index (no content loading needed for hash-only)
// ============================================================================

/**
 * Get duplicate groups from the section index.
 * This is the main entry point for duplicate detection.
 */
export const detectDuplicates = (
  rootPath: string,
  options: DuplicateDetectionOptions = {},
): Effect.Effect<
  DuplicateDetectionResult,
  FileReadError | IndexCorruptedError
> => {
  // For now, we only support exact duplicate detection via content hashing.
  // Future: Add embedding-based similarity detection for near-duplicates.
  return detectExactDuplicates(rootPath, options)
}
