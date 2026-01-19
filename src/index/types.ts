/**
 * Index data types for md-tldr
 */

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
  readonly level: number
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

export interface IndexResult {
  readonly documentsIndexed: number
  readonly sectionsIndexed: number
  readonly linksIndexed: number
  readonly totalDocuments: number
  readonly totalSections: number
  readonly totalLinks: number
  readonly duration: number
  readonly errors: readonly IndexBuildError[]
}

export interface IndexBuildError {
  readonly path: string
  readonly message: string
}

// ============================================================================
// Index Paths
// ============================================================================

export const INDEX_DIR = '.md-tldr'
export const INDEX_VERSION = 1

export const getIndexPaths = (rootPath: string) => ({
  root: `${rootPath}/${INDEX_DIR}`,
  config: `${rootPath}/${INDEX_DIR}/config.json`,
  documents: `${rootPath}/${INDEX_DIR}/indexes/documents.json`,
  sections: `${rootPath}/${INDEX_DIR}/indexes/sections.json`,
  links: `${rootPath}/${INDEX_DIR}/indexes/links.json`,
  cache: `${rootPath}/${INDEX_DIR}/cache`,
  parsed: `${rootPath}/${INDEX_DIR}/cache/parsed`,
})
