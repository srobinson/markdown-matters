/**
 * Core data types for mdcontext
 * Based on DESIGN.md specifications
 */

// ============================================================================
// Document Types
// ============================================================================

export interface MdDocument {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly frontmatter: Record<string, unknown>
  readonly sections: readonly MdSection[]
  readonly links: readonly MdLink[]
  readonly codeBlocks: readonly MdCodeBlock[]
  readonly metadata: DocumentMetadata
}

export interface DocumentMetadata {
  readonly wordCount: number
  readonly tokenCount: number
  readonly headingCount: number
  readonly linkCount: number
  readonly codeBlockCount: number
  readonly lastModified: Date
  readonly indexedAt: Date
}

// ============================================================================
// Section Types
// ============================================================================

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface MdSection {
  readonly id: string
  readonly heading: string
  readonly level: HeadingLevel
  readonly content: string
  readonly plainText: string
  readonly startLine: number
  readonly endLine: number
  readonly children: readonly MdSection[]
  readonly metadata: SectionMetadata
}

export interface SectionMetadata {
  readonly wordCount: number
  readonly tokenCount: number
  readonly hasCode: boolean
  readonly hasList: boolean
  readonly hasTable: boolean
}

// ============================================================================
// Link Types
// ============================================================================

export type LinkType = 'internal' | 'external' | 'image'

export interface MdLink {
  readonly type: LinkType
  readonly href: string
  readonly text: string
  readonly sectionId: string
  readonly line: number
}

// ============================================================================
// Code Block Types
// ============================================================================

export interface MdCodeBlock {
  readonly language: string | null
  readonly content: string
  readonly sectionId: string
  readonly startLine: number
  readonly endLine: number
}

// ============================================================================
// Context Line Types
// ============================================================================

/**
 * A single line of source text with its position and match status.
 * Used across search, hybrid search, and semantic search for context display.
 */
export interface ContextLine {
  /** The line number (1-based) */
  readonly lineNumber: number
  /** The line text */
  readonly line: string
  /**
   * Whether this line is part of the matched result.
   *
   * - For keyword search: true when the line directly matches the query.
   * - For semantic/hybrid search: true when the line lies within the
   *   selected/matched section span, even if it is not a direct text match.
   */
  readonly isMatch: boolean
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Parse error from markdown parsing
 *
 * Note: This interface is used by parser.ts. For the TaggedError version
 * that works with Effect's error handling, see src/errors/index.ts ParseError.
 */
export interface ParseError {
  readonly _tag: 'ParseError'
  readonly message: string
  readonly line?: number | undefined
  readonly column?: number | undefined
}

// ============================================================================
// Constructor Functions
// ============================================================================

export const ParseError = (
  message: string,
  line?: number,
  column?: number,
): ParseError => ({
  _tag: 'ParseError',
  message,
  line,
  column,
})
