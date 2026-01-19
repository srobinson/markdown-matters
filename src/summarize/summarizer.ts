/**
 * Summarization engine for md-tldr
 *
 * Provides hierarchical summarization and multi-document context assembly
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import type { MdDocument, MdSection } from '../core/types.js'
import { parseFile } from '../parser/parser.js'
import { countTokensApprox } from '../utils/tokens.js'
import { formatSummary as formatSummaryImpl } from './formatters.js'

// ============================================================================
// Types
// ============================================================================

export type CompressionLevel = 'brief' | 'summary' | 'full'

export interface SummarizeOptions {
  /** Compression level */
  readonly level?: CompressionLevel | undefined
  /** Maximum tokens for output */
  readonly maxTokens?: number | undefined
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
}

export interface AssembleContextOptions {
  /** Total token budget */
  readonly budget: number
  /** Compression level for each source */
  readonly level?: CompressionLevel | undefined
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
    summary = section.content
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
  const sections = document.sections.map((s) => summarizeSection(s, level))

  // Calculate totals
  const originalTokens = document.metadata.tokenCount
  let summaryTokens = sections.reduce((acc, s) => acc + s.summaryTokens, 0)

  // If over budget, truncate sections
  if (summaryTokens > maxTokens) {
    // Simple truncation: reduce section summaries
    const ratio = maxTokens / summaryTokens
    summaryTokens = Math.floor(summaryTokens * ratio)
  }

  const compressionRatio =
    originalTokens > 0 ? 1 - summaryTokens / originalTokens : 0

  return {
    path: document.path,
    title: document.title,
    originalTokens,
    summaryTokens,
    compressionRatio,
    sections,
    keyTopics: extractTopics(document),
  }
}

export const summarizeFile = (
  filePath: string,
  options: SummarizeOptions = {},
): Effect.Effect<DocumentSummary, Error> =>
  Effect.gen(function* () {
    const document = yield* parseFile(filePath).pipe(
      Effect.mapError((e) => new Error(`${e._tag}: ${e.message}`)),
    )

    return summarizeDocument(document, options)
  })

// ============================================================================
// Format Summary for Output (re-exported from formatters.ts)
// ============================================================================

export { formatSummary } from './formatters.js'

// ============================================================================
// Multi-Document Context Assembly
// ============================================================================

export const assembleContext = (
  rootPath: string,
  sourcePaths: readonly string[],
  options: AssembleContextOptions,
): Effect.Effect<AssembledContext, Error> =>
  Effect.gen(function* () {
    const budget = options.budget
    const level = options.level ?? 'summary'

    const sources: SourceContext[] = []
    const overflow: string[] = []
    let totalTokens = 0

    // Calculate per-source budget (even distribution)
    const perSourceBudget = Math.floor(budget / sourcePaths.length)

    for (const sourcePath of sourcePaths) {
      const resolvedPath = path.isAbsolute(sourcePath)
        ? sourcePath
        : path.join(rootPath, sourcePath)

      try {
        const summary = yield* summarizeFile(resolvedPath, {
          level,
          maxTokens: perSourceBudget,
        })

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
            })
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
        }
      } catch (_e) {
        // Skip files that can't be processed
        overflow.push(sourcePath)
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
  const result = await Effect.runPromise(
    summarizeFile(filePath, { level }).pipe(
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
