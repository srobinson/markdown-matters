/**
 * Keyword search for mdcontext
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import type { ContextLine } from '../core/types.js'

import {
  CliValidationError,
  DocumentNotFoundError,
  type FileReadError,
  type IndexCorruptedError,
  IndexNotFoundError,
} from '../errors/index.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'
import type { DocumentEntry, SectionEntry } from '../index/types.js'
import {
  buildFuzzyHighlightPattern,
  findMatchesInLine,
  type MatchOptions,
  matchesWithOptions,
} from './fuzzy-search.js'
import { matchPath } from './path-matcher.js'
import {
  buildHighlightPattern,
  evaluateQuery,
  isAdvancedQuery,
  type ParsedQuery,
  parseQuery,
} from './query-parser.js'

// ============================================================================
// Regex Safety
// ============================================================================

const MAX_REGEX_LENGTH = 200

/**
 * Build a RegExp from user input with length validation and syntax error handling.
 * Returns an Effect that fails with CliValidationError on invalid or too-long patterns.
 */
const safeRegex = (
  pattern: string,
  flags: string,
): Effect.Effect<RegExp, CliValidationError> => {
  if (pattern.length > MAX_REGEX_LENGTH) {
    return Effect.fail(
      new CliValidationError({
        message: `Regex pattern too long (${pattern.length} chars, max ${MAX_REGEX_LENGTH})`,
      }),
    )
  }
  return Effect.try({
    try: () => new RegExp(pattern, flags),
    catch: (e) =>
      new CliValidationError({
        message: `Invalid regex pattern: ${e instanceof Error ? e.message : String(e)}`,
      }),
  })
}

// ============================================================================
// Search Options
// ============================================================================

export interface SearchOptions {
  /** Filter by heading pattern (regex) */
  readonly heading?: string | undefined
  /** Search within section content (regex) */
  readonly content?: string | undefined
  /** Filter by file path pattern (glob-like) */
  readonly pathPattern?: string | undefined
  /** Only sections with code blocks */
  readonly hasCode?: boolean | undefined
  /** Only sections with lists */
  readonly hasList?: boolean | undefined
  /** Only sections with tables */
  readonly hasTable?: boolean | undefined
  /** Minimum heading level */
  readonly minLevel?: number | undefined
  /** Maximum heading level */
  readonly maxLevel?: number | undefined
  /** Maximum results */
  readonly limit?: number | undefined
  /** Lines of context before matches */
  readonly contextBefore?: number | undefined
  /** Lines of context after matches */
  readonly contextAfter?: number | undefined
  /** Enable fuzzy matching with typo tolerance */
  readonly fuzzy?: boolean | undefined
  /** Max edit distance for fuzzy matching (default: 2) */
  readonly fuzzyDistance?: number | undefined
  /** Enable word stemming (fail matches failure, failed, etc.) */
  readonly stem?: boolean | undefined
}

export interface ContentMatch {
  /** The line number where match was found (1-based) */
  readonly lineNumber: number
  /** The matching line text */
  readonly line: string
  /** Snippet showing match context (lines before and after) */
  readonly snippet: string
  /** Context lines with their line numbers (for JSON output) */
  readonly contextLines?: readonly ContextLine[]
}

// ContextLine is re-exported from src/core/types.ts (canonical definition)

export interface SearchResult {
  readonly section: SectionEntry
  readonly document: DocumentEntry
  readonly sectionContent?: string
  /** Matches found within the content (when content search is used) */
  readonly matches?: readonly ContentMatch[]
}

// ============================================================================
// Search Implementation
// ============================================================================

/**
 * Search for sections by metadata (heading, path, content flags).
 *
 * @param rootPath - Root directory containing indexed markdown files
 * @param options - Search filters (heading, path pattern, code/list/table flags)
 * @returns Matching sections
 *
 * @throws FileReadError - Cannot read index files
 * @throws IndexCorruptedError - Index files are corrupted
 */
export const search = (
  rootPath: string,
  options: SearchOptions = {},
): Effect.Effect<
  readonly SearchResult[],
  FileReadError | IndexCorruptedError | CliValidationError
> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath)

    const docIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)

    if (!docIndex || !sectionIndex) {
      return []
    }

    const results: SearchResult[] = []
    const headingRegex = options.heading
      ? yield* safeRegex(options.heading, 'i')
      : null

    for (const section of Object.values(sectionIndex.sections)) {
      // Filter by heading pattern
      if (headingRegex && !headingRegex.test(section.heading)) {
        continue
      }

      // Filter by path pattern
      if (
        options.pathPattern &&
        !matchPath(section.documentPath, options.pathPattern)
      ) {
        continue
      }

      // Filter by code blocks
      if (
        options.hasCode !== undefined &&
        section.hasCode !== options.hasCode
      ) {
        continue
      }

      // Filter by lists
      if (
        options.hasList !== undefined &&
        section.hasList !== options.hasList
      ) {
        continue
      }

      // Filter by tables
      if (
        options.hasTable !== undefined &&
        section.hasTable !== options.hasTable
      ) {
        continue
      }

      // Filter by level range
      if (options.minLevel !== undefined && section.level < options.minLevel) {
        continue
      }

      if (options.maxLevel !== undefined && section.level > options.maxLevel) {
        continue
      }

      const document = docIndex.documents[section.documentPath]
      if (document) {
        results.push({ section, document })
      }

      // Check limit
      if (options.limit !== undefined && results.length >= options.limit) {
        break
      }
    }

    return results
  })

// ============================================================================
// Content Search Implementation
// ============================================================================

/**
 * Search within section content.
 * Supports boolean operators (AND, OR, NOT) and quoted phrases.
 * Falls back to regex for simple patterns.
 *
 * @param rootPath - Root directory containing indexed markdown files
 * @param options - Search options including content pattern
 * @returns Matching sections with match highlights
 *
 * @throws FileReadError - Cannot read index or source files
 * @throws IndexCorruptedError - Index files are corrupted
 */
export const searchContent = (
  rootPath: string,
  options: SearchOptions = {},
): Effect.Effect<
  readonly SearchResult[],
  FileReadError | IndexCorruptedError | CliValidationError
> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath)

    const docIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)

    if (!docIndex || !sectionIndex) {
      return []
    }

    // Parse content query - use boolean parser if advanced, else regex
    let parsedQuery: ParsedQuery | null = null
    let contentRegex: RegExp | null = null
    let highlightRegex: RegExp | null = null

    // Configure fuzzy/stem matching options
    const matchOptions: MatchOptions = {
      stem: options.stem,
      fuzzyDistance: options.fuzzy ? (options.fuzzyDistance ?? 2) : undefined,
    }
    const useFuzzyOrStem = options.fuzzy || options.stem

    if (options.content) {
      if (isAdvancedQuery(options.content)) {
        parsedQuery = parseQuery(options.content)
        if (parsedQuery) {
          if (useFuzzyOrStem) {
            highlightRegex = buildFuzzyHighlightPattern(
              options.content,
              matchOptions,
            )
          } else {
            highlightRegex = buildHighlightPattern(parsedQuery)
          }
        }
      } else {
        // Simple search - use regex for exact match, or fuzzy/stem matching
        if (!useFuzzyOrStem) {
          contentRegex = yield* safeRegex(options.content, 'gi')
          highlightRegex = contentRegex
        } else {
          // For fuzzy/stem mode, build a highlight pattern
          highlightRegex = buildFuzzyHighlightPattern(
            options.content,
            matchOptions,
          )
        }
      }
    }

    const headingRegex = options.heading
      ? yield* safeRegex(options.heading, 'i')
      : null

    const results: SearchResult[] = []

    // Group sections by document for efficient file reading
    const sectionsByDoc: Record<string, SectionEntry[]> = {}
    for (const section of Object.values(sectionIndex.sections)) {
      const docSections = sectionsByDoc[section.documentPath]
      if (docSections) {
        docSections.push(section)
      } else {
        sectionsByDoc[section.documentPath] = [section]
      }
    }

    // Process each document
    for (const [docPath, sections] of Object.entries(sectionsByDoc)) {
      // Apply path filter early
      if (options.pathPattern && !matchPath(docPath, options.pathPattern)) {
        continue
      }

      const document = docIndex.documents[docPath]
      if (!document) continue

      // Load file content for content search
      let fileContent: string | null = null
      let fileLines: string[] = []

      // Need to load file if we have any content matching to do:
      // - parsedQuery: boolean query evaluation
      // - contentRegex: regex matching
      // - useFuzzyOrStem: fuzzy/stem matching
      if (parsedQuery || contentRegex || (useFuzzyOrStem && options.content)) {
        const filePath = path.join(storage.rootPath, docPath)
        try {
          fileContent = yield* Effect.promise(() =>
            fs.readFile(filePath, 'utf-8'),
          )
          fileLines = fileContent.split('\n')
        } catch {
          continue // Skip files that can't be read
        }
      }

      for (const section of sections) {
        // Apply heading filter
        if (headingRegex && !headingRegex.test(section.heading)) {
          continue
        }

        // Apply other filters
        if (
          options.hasCode !== undefined &&
          section.hasCode !== options.hasCode
        ) {
          continue
        }
        if (
          options.hasList !== undefined &&
          section.hasList !== options.hasList
        ) {
          continue
        }
        if (
          options.hasTable !== undefined &&
          section.hasTable !== options.hasTable
        ) {
          continue
        }
        if (
          options.minLevel !== undefined &&
          section.level < options.minLevel
        ) {
          continue
        }
        if (
          options.maxLevel !== undefined &&
          section.level > options.maxLevel
        ) {
          continue
        }

        // Content search
        if ((parsedQuery || contentRegex || useFuzzyOrStem) && fileContent) {
          const sectionLines = fileLines.slice(
            section.startLine - 1,
            section.endLine,
          )
          const sectionContent = sectionLines.join('\n')

          // For boolean queries, evaluate against entire section content
          if (parsedQuery) {
            if (!evaluateQuery(parsedQuery.ast, sectionContent)) {
              continue // Section doesn't match query
            }
          }

          // For fuzzy/stem mode without boolean query, check section content
          if (useFuzzyOrStem && !parsedQuery && options.content) {
            if (
              !matchesWithOptions(options.content, sectionContent, matchOptions)
            ) {
              continue // Section doesn't match with fuzzy/stem
            }
          }

          // Find individual line matches for highlighting
          const matches: ContentMatch[] = []
          const searchRegex = contentRegex || highlightRegex

          // Use configurable context lines (default to 1 if not specified)
          const contextBefore = options.contextBefore ?? 1
          const contextAfter = options.contextAfter ?? 1

          // Get query words for fuzzy/stem matching
          const queryWords = options.content
            ? options.content
                .toLowerCase()
                .split(/\W+/)
                .filter((w) => w.length > 0)
            : []

          for (let i = 0; i < sectionLines.length; i++) {
            const line = sectionLines[i]
            if (!line) continue

            let isMatch = false

            // Check with regex for exact match mode
            if (searchRegex) {
              if (searchRegex.test(line)) {
                isMatch = true
              }
              // Reset regex lastIndex for next test
              searchRegex.lastIndex = 0
            }

            // Check with fuzzy/stem matching
            if (!isMatch && useFuzzyOrStem && queryWords.length > 0) {
              const lineMatches = findMatchesInLine(
                queryWords,
                line,
                matchOptions,
              )
              if (lineMatches.length > 0) {
                isMatch = true
              }
            }

            if (isMatch) {
              const absoluteLineNum = section.startLine + i

              // Create snippet with configurable context
              const snippetStart = Math.max(0, i - contextBefore)
              const snippetEnd = Math.min(
                sectionLines.length,
                i + contextAfter + 1,
              )
              const snippetLines = sectionLines.slice(snippetStart, snippetEnd)
              const snippet = snippetLines.join('\n')

              // Build context lines array for JSON output
              const contextLines: ContextLine[] = []
              for (let j = snippetStart; j < snippetEnd; j++) {
                const ctxLine = sectionLines[j]
                if (ctxLine !== undefined) {
                  contextLines.push({
                    lineNumber: section.startLine + j,
                    line: ctxLine,
                    isMatch: j === i,
                  })
                }
              }

              matches.push({
                lineNumber: absoluteLineNum,
                line: line,
                snippet,
                contextLines,
              })
            }
          }

          // For boolean queries, include section even without line-level matches
          // (the section matched as a whole)
          if (parsedQuery || matches.length > 0) {
            const result: SearchResult = {
              section,
              document,
              sectionContent,
            }
            if (matches.length > 0) {
              results.push({ ...result, matches })
            } else {
              results.push(result)
            }

            if (
              options.limit !== undefined &&
              results.length >= options.limit
            ) {
              return results
            }
          }
        } else if (!parsedQuery && !contentRegex && !useFuzzyOrStem) {
          // No content search, heading-only search
          results.push({ section, document })

          if (options.limit !== undefined && results.length >= options.limit) {
            return results
          }
        }
      }
    }

    return results
  })

// ============================================================================
// Search with Content (legacy, uses heading-only search)
// ============================================================================

/**
 * Search for sections by metadata and include section content.
 *
 * @param rootPath - Root directory containing indexed markdown files
 * @param options - Search filters
 * @returns Matching sections with content
 *
 * @throws FileReadError - Cannot read index or source files
 * @throws IndexCorruptedError - Index files are corrupted
 */
export const searchWithContent = (
  rootPath: string,
  options: SearchOptions = {},
): Effect.Effect<
  readonly SearchResult[],
  FileReadError | IndexCorruptedError | CliValidationError
> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath)
    const results = yield* search(rootPath, options)

    const resultsWithContent: SearchResult[] = []

    for (const result of results) {
      const filePath = path.join(storage.rootPath, result.section.documentPath)

      try {
        const fileContent = yield* Effect.promise(() =>
          fs.readFile(filePath, 'utf-8'),
        )

        const lines = fileContent.split('\n')
        const sectionContent = lines
          .slice(result.section.startLine - 1, result.section.endLine)
          .join('\n')

        resultsWithContent.push({
          ...result,
          sectionContent,
        })
      } catch {
        // If file can't be read, include result without content
        resultsWithContent.push(result)
      }
    }

    return resultsWithContent
  })

// ============================================================================
// Context Generation
// ============================================================================

export interface ContextOptions {
  /** Maximum tokens to include */
  readonly maxTokens?: number | undefined
  /** Include section content */
  readonly includeContent?: boolean | undefined
  /** Compression level: brief, summary, full */
  readonly level?: 'brief' | 'summary' | 'full' | undefined
}

export interface DocumentContext {
  readonly path: string
  readonly title: string
  readonly totalTokens: number
  readonly includedTokens: number
  readonly sections: readonly SectionContext[]
}

export interface SectionContext {
  readonly heading: string
  readonly level: number
  readonly tokens: number
  readonly content?: string | undefined
  readonly hasCode: boolean
  readonly hasList: boolean
  readonly hasTable: boolean
}

/**
 * Get context information for a document.
 *
 * @param rootPath - Root directory containing indexed markdown files
 * @param filePath - Path to the document
 * @param options - Context options (max tokens, include content)
 * @returns Document context with sections
 *
 * @throws IndexNotFoundError - Index doesn't exist
 * @throws DocumentNotFoundError - Document not in index
 * @throws FileReadError - Cannot read index or source files
 * @throws IndexCorruptedError - Index files are corrupted
 */
export const getContext = (
  rootPath: string,
  filePath: string,
  options: ContextOptions = {},
): Effect.Effect<
  DocumentContext,
  | IndexNotFoundError
  | DocumentNotFoundError
  | FileReadError
  | IndexCorruptedError
> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath)
    const resolvedFile = path.resolve(filePath)
    const relativePath = path.relative(storage.rootPath, resolvedFile)

    const docIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)

    if (!docIndex || !sectionIndex) {
      return yield* Effect.fail(
        new IndexNotFoundError({ path: storage.rootPath }),
      )
    }

    const document = docIndex.documents[relativePath]
    if (!document) {
      return yield* Effect.fail(
        new DocumentNotFoundError({
          path: relativePath,
          indexPath: storage.rootPath,
        }),
      )
    }

    // Get sections for this document
    const sectionIds = sectionIndex.byDocument[document.id] ?? []
    const sections: SectionContext[] = []
    let includedTokens = 0
    const maxTokens = options.maxTokens ?? Infinity
    const includeContent = options.includeContent ?? options.level === 'full'

    // Read file content if needed
    let fileContent: string | null = null
    if (includeContent) {
      try {
        fileContent = yield* Effect.promise(() =>
          fs.readFile(resolvedFile, 'utf-8'),
        )
      } catch {
        // Continue without content
      }
    }

    const fileLines = fileContent?.split('\n') ?? []

    for (const sectionId of sectionIds) {
      const section = sectionIndex.sections[sectionId]
      if (!section) continue

      // Check token budget
      if (includedTokens + section.tokenCount > maxTokens) {
        // Include brief info only if we're over budget
        if (options.level === 'brief') continue

        sections.push({
          heading: section.heading,
          level: section.level,
          tokens: section.tokenCount,
          hasCode: section.hasCode,
          hasList: section.hasList,
          hasTable: section.hasTable,
        })
        continue
      }

      includedTokens += section.tokenCount

      let content: string | undefined
      if (includeContent && fileContent) {
        content = fileLines
          .slice(section.startLine - 1, section.endLine)
          .join('\n')
      }

      sections.push({
        heading: section.heading,
        level: section.level,
        tokens: section.tokenCount,
        content,
        hasCode: section.hasCode,
        hasList: section.hasList,
        hasTable: section.hasTable,
      })
    }

    return {
      path: relativePath,
      title: document.title,
      totalTokens: document.tokenCount,
      includedTokens,
      sections,
    }
  })

// ============================================================================
// LLM-Ready Output
// ============================================================================

export const formatContextForLLM = (context: DocumentContext): string => {
  const lines: string[] = []

  lines.push(`# ${context.title}`)
  lines.push(`Path: ${context.path}`)
  lines.push(`Tokens: ${context.includedTokens}/${context.totalTokens}`)
  lines.push('')

  for (const section of context.sections) {
    const prefix = '#'.repeat(section.level)
    const meta: string[] = []
    if (section.hasCode) meta.push('code')
    if (section.hasList) meta.push('list')
    if (section.hasTable) meta.push('table')

    const metaStr = meta.length > 0 ? ` [${meta.join(', ')}]` : ''
    lines.push(
      `${prefix} ${section.heading}${metaStr} (${section.tokens} tokens)`,
    )

    if (section.content) {
      lines.push('')
      lines.push(section.content)
      lines.push('')
    }
  }

  return lines.join('\n')
}
