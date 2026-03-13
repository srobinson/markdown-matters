/**
 * Index data types for mdcontext
 */

import * as path from 'node:path'

import type { HeadingLevel } from '../core/types.js'

// ============================================================================
// Configuration
// ============================================================================

export interface IndexConfig {
  readonly version: number
  readonly rootPath: string
  readonly include: readonly string[]
  readonly exclude: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

// ============================================================================
// Document Index
// ============================================================================

export interface DocumentIndex {
  readonly version: number
  readonly rootPath: string
  readonly documents: Record<string, DocumentEntry>
}

export interface DocumentEntry {
  readonly id: string
  readonly path: string
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
  readonly version: number
  readonly sections: Record<string, SectionEntry>
  readonly byHeading: Record<string, readonly string[]>
  readonly byDocument: Record<string, readonly string[]>
}

export interface SectionEntry {
  readonly id: string
  readonly documentId: string
  readonly documentPath: string
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
  readonly version: number
  readonly forward: Record<string, readonly string[]>
  readonly backward: Record<string, readonly string[]>
  readonly broken: readonly string[]
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

export const INDEX_DIR = '.mdcontext'
export const INDEX_VERSION = 1

export const getIndexPaths = (rootPath: string) => ({
  root: path.join(rootPath, INDEX_DIR),
  config: path.join(rootPath, INDEX_DIR, 'config.json'),
  documents: path.join(rootPath, INDEX_DIR, 'indexes', 'documents.json'),
  sections: path.join(rootPath, INDEX_DIR, 'indexes', 'sections.json'),
  links: path.join(rootPath, INDEX_DIR, 'indexes', 'links.json'),
  cache: path.join(rootPath, INDEX_DIR, 'cache'),
  parsed: path.join(rootPath, INDEX_DIR, 'cache', 'parsed'),
})
