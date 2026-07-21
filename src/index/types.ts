/**
 * Index data types for mdm
 */

import * as path from 'node:path'

import type { HeadingLevel } from '../core/types.js'
import type {
  DeclaredPath,
  DocumentKey,
  FileIdentity,
} from '../db/canonical.js'

// ============================================================================
// Document Index
// ============================================================================

export interface DocumentIndex {
  readonly version: typeof INDEX_VERSION
  readonly documents: Record<DocumentKey, DocumentEntry>
}

export interface DocumentEntry {
  readonly id: string
  readonly path: DocumentKey
  readonly paths: readonly DocumentKey[]
  readonly declaredPaths: readonly DeclaredPath[]
  readonly identity: FileIdentity
  readonly comparisonKey: string
  readonly title: string
  readonly mtime: number
  readonly hash: string
  readonly tokenCount: number
  readonly sectionCount: number
}

// ============================================================================
// Section Index
// ============================================================================

export interface SectionIndex {
  readonly version: typeof INDEX_VERSION
  readonly sections: Record<string, SectionEntry>
  readonly byHeading: Record<string, readonly string[]>
  readonly byDocument: Record<string, readonly string[]>
}

export interface SectionEntry {
  readonly id: string
  readonly documentId: string
  readonly documentPath: DocumentKey
  readonly heading: string
  readonly level: HeadingLevel
  readonly startLine: number
  readonly endLine: number
  readonly tokenCount: number
  readonly hasCode: boolean
  readonly hasList: boolean
  readonly hasTable: boolean
}

// ============================================================================
// Link Index
// ============================================================================

export interface LinkIndex {
  readonly version: typeof INDEX_VERSION
  readonly forward: Record<DocumentKey, readonly LinkEdge[]>
  readonly backward: Record<DocumentKey, readonly LinkEdge[]>
  readonly brokenBySource: Record<DocumentKey, readonly DeclaredPath[]>
  readonly broken: readonly DeclaredPath[]
}

export interface LinkEdge {
  readonly documentPath: DocumentKey
  readonly sectionId?: string | undefined
}

// ============================================================================
// Index Result
// ============================================================================

/**
 * Reason why a file was skipped during indexing
 */
export type SkipReason =
  | 'unchanged' // File hash and mtime unchanged
  | 'excluded' // Matches exclude pattern
  | 'hidden' // Hidden file or directory
  | 'not-markdown' // Not a markdown file
  | 'binary' // Binary file detected
  | 'oversized' // File too large

/**
 * Information about a skipped file
 */
export interface SkippedFile {
  readonly path: string
  readonly reason: SkipReason
}

/**
 * Summary of skipped files by reason
 */
export interface SkipSummary {
  readonly unchanged: number
  readonly excluded: number
  readonly hidden: number
  readonly total: number
}

export interface IndexResult {
  readonly documentsIndexed: number
  readonly sectionsIndexed: number
  readonly linksIndexed: number
  readonly totalDocuments: number
  readonly totalSections: number
  readonly totalLinks: number
  readonly duration: number
  /** Non-fatal file processing errors (files that couldn't be indexed) */
  readonly errors: readonly FileProcessingError[]
  readonly skipped: SkipSummary
}

/**
 * Non-fatal error during file processing in index build.
 * These are collected and reported but don't stop the build.
 *
 * Note: This is distinct from IndexBuildError in errors/index.ts,
 * which is a TaggedError for fatal build failures.
 */
export interface FileProcessingError {
  readonly path: string
  readonly message: string
}

// ============================================================================
// Index Paths
// ============================================================================

export const INDEX_VERSION = 3 as const

export const getIndexPaths = (indexRoot: string) => {
  const root = path.resolve(indexRoot)
  return {
    root,
    documents: path.join(root, 'indexes', 'documents.json'),
    sections: path.join(root, 'indexes', 'sections.json'),
    links: path.join(root, 'indexes', 'links.json'),
    bm25: path.join(root, 'bm25.json'),
    bm25Metadata: path.join(root, 'bm25.meta.json'),
  }
}
