/**
 * Summarization engine for mdcontext
 *
 * Provides hierarchical summarization and multi-document context assembly
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import type { MdDocument, MdSection, ParseError } from '../core/types.js'
import type { FileReadError } from '../errors/index.js'
import { parseFile } from '../parser/parser.js'
import { filterDocumentSections } from '../parser/section-filter.js'
import { countTokensApprox } from '../utils/tokens.js'
import { formatSummary as formatSummaryImpl } from './formatters.js'

/**
 * Error type from parseFile function
 * Uses centralized errors from src/errors/index.ts
 */
type ParseFileError = ParseError | FileReadError

// ============================================================================
// Types
// ============================================================================

export type CompressionLevel = 'brief' | 'summary' | 'full'

export interface SummarizeOptions {
  /** Compression level */
  readonly level?: CompressionLevel | undefined
  /** Maximum tokens for output */
  readonly maxTokens?: number | undefined
  /** Section patterns to exclude from output */
  readonly exclude?: readonly string[] | undefined
}

export interface SectionSummary {
  readonly heading: string
  readonly level: number
  readonly originalTokens: number
  readonly summaryTokens: number
  readonly summary: string
  readonly children: readonly SectionSummary[]
  readonly hasCode: boolean
  readonly hasList: boolean
  readonly hasTable: boolean
}

export interface DocumentSummary {
  readonly path: string
  readonly title: string
  readonly originalTokens: number
  readonly summaryTokens: number
  readonly compressionRatio: number
  readonly sections: readonly SectionSummary[]
  readonly keyTopics: readonly string[]
  /** True if content was truncated to fit budget */
  readonly truncated?: boolean
  /** Number of sections that were omitted due to budget constraints */
  readonly truncatedCount?: number
}

export interface AssembleContextOptions {
  /** Total token budget */
  readonly budget: number
  /** Compression level for each source */
  readonly level?: CompressionLevel | undefined
  /** Section patterns to exclude from output */
  readonly exclude?: readonly string[] | undefined
}

export interface AssembledContext {
  readonly sources: readonly SourceContext[]
  readonly totalTokens: number
  readonly budget: number
  readonly overflow: readonly string[]
}

export interface SourceContext {
  readonly path: string
  readonly title: string
  readonly tokens: number
  readonly content: string
}

// ============================================================================
// Constants
// ============================================================================

/** Token budgets per compression level */
const TOKEN_BUDGETS: Record<CompressionLevel, number> = {
  brief: 100,
  summary: 500,
  full: Infinity,
}

/** Minimum character length for a sentence to be considered meaningful */
const MIN_SENTENCE_LENGTH = 10

/** Score weights for sentence importance heuristics */
const SENTENCE_SCORE_DEFINITION = 2 // sentences with colons (definitions)
const SENTENCE_SCORE_PROPER_START = 1 // sentences starting with capital
const SENTENCE_SCORE_MEDIUM_LENGTH = 1 // sentences in ideal length range
const SENTENCE_SCORE_EMPHASIS = 1 // sentences with emphasis or code

/** Ideal sentence length range for summaries */
const SENTENCE_LENGTH_MIN = 50
const SENTENCE_LENGTH_MAX = 200

/** Target compression ratio for summaries (30% of original) */
const SUMMARY_COMPRESSION_RATIO = 0.3

/** Minimum tokens for any section summary */
const MIN_SECTION_TOKENS = 20

/** Minimum sentences to include in any summary */
const MIN_SUMMARY_SENTENCES = 2

/** Approximate tokens per sentence (for calculating max sentences) */
const TOKENS_PER_SENTENCE_ESTIMATE = 30

/** Topic heading length constraints */
const MIN_TOPIC_LENGTH = 2
const MAX_TOPIC_LENGTH = 50

/** Maximum topics to extract from a document */
const MAX_TOPICS = 10

/** Minimum remaining budget to include partial content */
const MIN_PARTIAL_BUDGET = 50

// ============================================================================
// Section Summarization
// ============================================================================

const extractKeyPoints = (content: string, maxSentences: number): string[] => {
  // Split into sentences
  const sentences = content
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > MIN_SENTENCE_LENGTH)

  if (sentences.length <= maxSentences) {
    return sentences
  }

  // Simple heuristic: prefer sentences with key indicators
  const scored = sentences.map((s) => {
    let score = 0
    // Prefer sentences with:
    if (s.includes(':')) score += SENTENCE_SCORE_DEFINITION
    if (/^[A-Z]/.test(s)) score += SENTENCE_SCORE_PROPER_START
    if (s.length > SENTENCE_LENGTH_MIN && s.length < SENTENCE_LENGTH_MAX)
      score += SENTENCE_SCORE_MEDIUM_LENGTH
    if (/\*\*|`/.test(s)) score += SENTENCE_SCORE_EMPHASIS
    return { sentence: s, score }
  })

  // Sort by score and take top sentences
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxSentences).map((s) => s.sentence)
}

const summarizeSection = (
  section: MdSection,
  level: CompressionLevel,
): SectionSummary => {
  const originalTokens = section.metadata.tokenCount

  // Get children summaries first
  const children = section.children.map((child) =>
    summarizeSection(child, level),
  )

  // Calculate target tokens based on level
  const targetTokens = Math.min(
    TOKEN_BUDGETS[level],
    Math.max(originalTokens * SUMMARY_COMPRESSION_RATIO, MIN_SECTION_TOKENS),
  )

  let summary: string

  if (level === 'full' || originalTokens <= targetTokens) {
    // Include full content for "full" level or if already small
    // Use plainText instead of content to avoid including the heading markdown
    // (the heading is output separately by the formatter)
    summary = section.plainText
  } else if (level === 'brief') {
    // Just heading and metadata for brief
    const meta: string[] = []
    if (section.metadata.hasCode) meta.push('code')
    if (section.metadata.hasList) meta.push('list')
    if (section.metadata.hasTable) meta.push('table')
    summary = meta.length > 0 ? `[${meta.join(', ')}]` : ''
  } else {
    // Summary level: extract key points
    const maxSentences = Math.max(
      MIN_SUMMARY_SENTENCES,
      Math.floor(targetTokens / TOKENS_PER_SENTENCE_ESTIMATE),
    )
    const keyPoints = extractKeyPoints(section.plainText, maxSentences)

    if (keyPoints.length > 0) {
      summary = keyPoints.join(' ')
    } else {
      // Fallback: truncate
      const words = section.plainText.split(/\s+/).slice(0, targetTokens)
      summary =
        words.join(' ') +
        (words.length < section.plainText.split(/\s+/).length ? '...' : '')
    }
  }

  const summaryTokens = countTokensApprox(summary)

  return {
    heading: section.heading,
    level: section.level,
    originalTokens,
    summaryTokens,
    summary,
    children,
    hasCode: section.metadata.hasCode,
    hasList: section.metadata.hasList,
    hasTable: section.metadata.hasTable,
  }
}

// ============================================================================
// Document Summarization
// ============================================================================

const extractTopics = (document: MdDocument): string[] => {
  const topics: Set<string> = new Set()

  // Extract from headings
  const processSection = (section: MdSection) => {
    // Clean heading and add as topic
    const cleanHeading = section.heading
      .replace(/[:#\-_]/g, ' ')
      .trim()
      .toLowerCase()
    if (
      cleanHeading.length > MIN_TOPIC_LENGTH &&
      cleanHeading.length < MAX_TOPIC_LENGTH
    ) {
      topics.add(cleanHeading)
    }

    for (const child of section.children) {
      processSection(child)
    }
  }

  for (const section of document.sections) {
    processSection(section)
  }

  // Also extract from frontmatter tags if present
  const frontmatter = document.frontmatter as Record<string, unknown>
  if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
    for (const tag of frontmatter.tags) {
      if (typeof tag === 'string') {
        topics.add(tag.toLowerCase())
      }
    }
  }

  return Array.from(topics).slice(0, MAX_TOPICS)
}

export const summarizeDocument = (
  document: MdDocument,
  options: SummarizeOptions = {},
): DocumentSummary => {
  const level = options.level ?? 'summary'
  const maxTokens = options.maxTokens ?? TOKEN_BUDGETS[level]

  // Summarize all sections
  const allSections = document.sections.map((s) => summarizeSection(s, level))

  // Calculate totals and collect all flattened sections with their tokens
  const originalTokens = document.metadata.tokenCount
  let totalSummaryTokens = 0
  const flatSections: SectionSummary[] = []

  const flattenWithTokens = (section: SectionSummary) => {
    flatSections.push(section)
    totalSummaryTokens += section.summaryTokens
    for (const child of section.children) {
      flattenWithTokens(child)
    }
  }

  for (const section of allSections) {
    flattenWithTokens(section)
  }

  // Calculate formatting overhead dynamically based on actual content
  // Header includes: "# {title}\nPath: {path}\nTokens: X (Y% reduction from Z)\n"
  // Plus topics line if present, plus possible truncation warning
  const topics = extractTopics(document)
  const headerTemplate = `# ${document.title}\nPath: ${document.path}\nTokens: 9999 (99% reduction from ${document.metadata.tokenCount})\n`
  const topicsLine =
    topics.length > 0 ? `\n**Topics:** ${topics.join(', ')}\n` : ''
  const truncationWarning =
    '\n⚠️ TRUNCATED: 999 sections omitted to fit token budget'
  // Add all possible overhead plus a generous safety margin (20% of overhead + 20 base)
  // This accounts for variance in token estimation
  const baseOverhead = countTokensApprox(
    headerTemplate + topicsLine + truncationWarning,
  )
  const formattingOverhead = Math.ceil(baseOverhead * 1.2) + 20
  const contentBudget = maxTokens - formattingOverhead

  // If over budget, truncate sections to fit
  let truncated = false
  let truncatedCount = 0
  let sections: SectionSummary[]
  let summaryTokens: number

  if (totalSummaryTokens > contentBudget && contentBudget > 0) {
    // Need to truncate - use greedy tree traversal that can include children
    // even when parent doesn't fit (orphan rescue)
    let tokensUsed = 0

    // Process tree with orphan rescue: if parent doesn't fit, still try children
    const truncateSections = (
      sectionList: readonly SectionSummary[],
    ): SectionSummary[] => {
      const result: SectionSummary[] = []

      for (const section of sectionList) {
        const sectionOwnTokens = section.summaryTokens
        const fitsInBudget = tokensUsed + sectionOwnTokens <= contentBudget

        if (fitsInBudget) {
          // Section fits - include it and recursively process children
          tokensUsed += sectionOwnTokens
          const truncatedChildren = truncateSections(section.children)
          result.push({
            ...section,
            children: truncatedChildren,
          })
        } else {
          // Section doesn't fit - but still try to rescue children (orphan rescue)
          truncatedCount++
          const rescuedChildren = truncateSections(section.children)
          // Add rescued children as top-level items in result
          result.push(...rescuedChildren)
        }
      }

      return result
    }

    sections = truncateSections(allSections)
    summaryTokens = tokensUsed
    truncated = truncatedCount > 0
  } else {
    sections = allSections
    summaryTokens = totalSummaryTokens
  }

  const compressionRatio =
    originalTokens > 0 ? 1 - summaryTokens / originalTokens : 0

  const result: DocumentSummary = {
    path: document.path,
    title: document.title,
    originalTokens,
    summaryTokens,
    compressionRatio,
    sections,
    keyTopics: topics,
  }

  if (truncated) {
    return {
      ...result,
      truncated: true,
      truncatedCount,
    }
  }

  return result
}

/**
 * Summarize a markdown file
 *
 * @throws ParseError - File content cannot be parsed
 * @throws FileReadError - File cannot be read from filesystem
 */
export const summarizeFile = (
  filePath: string,
  options: SummarizeOptions = {},
): Effect.Effect<DocumentSummary, ParseFileError> =>
  Effect.gen(function* () {
    let document = yield* parseFile(filePath)

    // Apply exclusion filter if patterns provided
    if (options.exclude && options.exclude.length > 0) {
      const { document: filteredDoc } = filterDocumentSections(
        document,
        options.exclude,
      )
      document = filteredDoc
    }

    return summarizeDocument(document, options)
  })

// ============================================================================
// Format Summary for Output (re-exported from formatters.ts)
// ============================================================================

export { type FormatSummaryOptions, formatSummary } from './formatters.js'

// ============================================================================
// Multi-Document Context Assembly
// ============================================================================

/**
 * Assemble context from multiple markdown files within a token budget
 *
 * @throws ParseError - File content cannot be parsed
 * @throws FileReadError - File cannot be read from filesystem
 */
export const assembleContext = (
  rootPath: string,
  sourcePaths: readonly string[],
  options: AssembleContextOptions,
): Effect.Effect<AssembledContext, ParseFileError> =>
  Effect.gen(function* () {
    const budget = options.budget
    const level = options.level ?? 'summary'
    const excludePatterns = options.exclude ?? []

    const sources: SourceContext[] = []
    const overflow: string[] = []
    let totalTokens = 0

    // Calculate per-source budget (even distribution)
    const perSourceBudget = Math.floor(budget / sourcePaths.length)

    for (const sourcePath of sourcePaths) {
      const resolvedPath = path.isAbsolute(sourcePath)
        ? sourcePath
        : path.join(rootPath, sourcePath)

      // Use catchAll for graceful degradation - individual file failures
      // shouldn't stop the entire context assembly operation
      const summaryResult = yield* summarizeFile(resolvedPath, {
        level,
        maxTokens: perSourceBudget,
        exclude: excludePatterns,
      }).pipe(
        Effect.map((s): DocumentSummary | null => s),
        // Log error for observability before gracefully degrading
        Effect.tapError((error) =>
          Effect.logError(`Failed to summarize ${sourcePath}`, error),
        ),
        // Note: catchAll intentional for batch processing - individual file
        // failures add to overflow instead of stopping assembly
        Effect.catchAll(() => Effect.succeed(null as DocumentSummary | null)),
      )

      if (!summaryResult) {
        overflow.push(sourcePath)
        continue
      }

      const summary = summaryResult
      const content = formatSummaryImpl(summary)
      // Count actual formatted output tokens, not pre-format summary tokens
      const tokens = countTokensApprox(content)

      if (totalTokens + tokens <= budget) {
        sources.push({
          path: path.relative(rootPath, resolvedPath),
          title: summary.title,
          tokens,
          content,
        })
        totalTokens += tokens
      } else {
        // Over budget
        const remaining = budget - totalTokens
        if (remaining > MIN_PARTIAL_BUDGET) {
          // Include partial if we have some room
          const briefSummary = yield* summarizeFile(resolvedPath, {
            level: 'brief',
            maxTokens: remaining,
            exclude: excludePatterns,
          }).pipe(
            Effect.map((s): DocumentSummary | null => s),
            // Log error for observability before gracefully degrading
            Effect.tapError((error) =>
              Effect.logError(
                `Failed to create brief summary for ${sourcePath}`,
                error,
              ),
            ),
            Effect.catchAll(() =>
              Effect.succeed(null as DocumentSummary | null),
            ),
          )

          if (briefSummary) {
            const briefContent = formatSummaryImpl(briefSummary)
            // Count actual formatted output tokens, not pre-format summary tokens
            const briefTokens = countTokensApprox(briefContent)

            sources.push({
              path: path.relative(rootPath, resolvedPath),
              title: briefSummary.title,
              tokens: briefTokens,
              content: briefContent,
            })
            totalTokens += briefTokens
          } else {
            overflow.push(path.relative(rootPath, resolvedPath))
          }
        } else {
          overflow.push(path.relative(rootPath, resolvedPath))
        }
      }
    }

    return {
      sources,
      totalTokens,
      budget,
      overflow,
    }
  })

// ============================================================================
// Format Assembled Context (re-exported from formatters.ts)
// ============================================================================

export { formatAssembledContext } from './formatters.js'

// ============================================================================
// Measure Token Reduction
// ============================================================================

export interface TokenReductionReport {
  readonly originalTokens: number
  readonly summaryTokens: number
  readonly reduction: number
  readonly reductionPercent: number
}

export const measureReduction = async (
  filePath: string,
  level: CompressionLevel = 'summary',
): Promise<TokenReductionReport> => {
  // Read original content
  const originalContent = await fs.readFile(filePath, 'utf-8')
  const originalTokens = countTokensApprox(originalContent)

  // Get summary
  // Note: catchAll is intentional - measureReduction is a utility function
  // where failures should return default values (no reduction) rather than throw
  const result = await Effect.runPromise(
    summarizeFile(filePath, { level }).pipe(
      // Log error for observability before gracefully degrading
      Effect.tapError((error) =>
        Effect.logError(`Failed to measure reduction for ${filePath}`, error),
      ),
      Effect.catchAll(() => Effect.succeed(null)),
    ),
  )

  if (!result) {
    return {
      originalTokens,
      summaryTokens: originalTokens,
      reduction: 0,
      reductionPercent: 0,
    }
  }

  const summaryTokens = result.summaryTokens
  const reduction = originalTokens - summaryTokens
  const reductionPercent = originalTokens > 0 ? reduction / originalTokens : 0

  return {
    originalTokens,
    summaryTokens,
    reduction,
    reductionPercent,
  }
}
