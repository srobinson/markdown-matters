/**
 * Formatting functions for summarization output
 *
 * Responsible for converting summary data structures into human-readable text
 */

import { countTokensApprox } from '../utils/tokens.js'
import type {
  AssembledContext,
  DocumentSummary,
  SectionSummary,
} from './summarizer.js'

export interface FormatSummaryOptions {
  /** Maximum tokens for formatted output. If exceeded, sections will be truncated. */
  readonly maxTokens?: number
}

/**
 * Format a document summary for display
 *
 * Outputs a markdown-formatted summary with:
 * - Title and path
 * - Accurate token count (of the formatted output)
 * - Key topics
 * - Hierarchical section summaries
 */
export const formatSummary = (
  summary: DocumentSummary,
  options: FormatSummaryOptions = {},
): string => {
  const maxTokens = options.maxTokens

  // Flatten sections in order for incremental building
  const flatSections: { section: SectionSummary; depth: number }[] = []

  const collectSections = (section: SectionSummary, depth: number = 0) => {
    flatSections.push({ section, depth })
    for (const child of section.children) {
      collectSections(child, depth + 1)
    }
  }

  for (const section of summary.sections) {
    collectSections(section)
  }

  // Build header
  const headerLines: string[] = []
  headerLines.push(`# ${summary.title}`)
  headerLines.push(`Path: ${summary.path}`)
  // Placeholder for token line - will be updated
  const tokenLinePlaceholder = 'Tokens: PLACEHOLDER'
  headerLines.push(tokenLinePlaceholder)

  if (summary.keyTopics.length > 0) {
    headerLines.push('')
    headerLines.push(`**Topics:** ${summary.keyTopics.join(', ')}`)
  }
  headerLines.push('')

  // Calculate header overhead
  const headerText = headerLines.join('\n')
  const headerTokens = countTokensApprox(headerText)

  // Build sections, tracking tokens
  const sectionLines: string[] = []
  let truncated = false
  let truncatedCount = 0

  for (const { section, depth } of flatSections) {
    const indent = '  '.repeat(depth)
    const prefix = '#'.repeat(section.level)

    const newLines: string[] = []
    newLines.push(`${indent}${prefix} ${section.heading}`)
    if (section.summary) {
      newLines.push(`${indent}${section.summary}`)
    }

    // Check if adding this section would exceed budget
    if (maxTokens !== undefined) {
      const currentContent = [...sectionLines, ...newLines].join('\n')
      const totalTokens =
        headerTokens + countTokensApprox(currentContent) + 15 // +15 for final token line estimate

      if (totalTokens > maxTokens) {
        truncated = true
        truncatedCount++
        continue // Skip this section
      }
    }

    sectionLines.push(...newLines)
  }

  // Calculate final token count
  const sectionText = sectionLines.join('\n')
  const contentTokens = headerTokens + countTokensApprox(sectionText)
  const tokenLineText = `Tokens: ${contentTokens} (${(summary.compressionRatio * 100).toFixed(0)}% reduction from ${summary.originalTokens})`
  const finalTokens = countTokensApprox(
    headerText.replace(tokenLinePlaceholder, tokenLineText) + sectionText,
  )

  // Build final output
  const lines: string[] = []
  lines.push(`# ${summary.title}`)
  lines.push(`Path: ${summary.path}`)
  lines.push(
    `Tokens: ${finalTokens} (${(summary.compressionRatio * 100).toFixed(0)}% reduction from ${summary.originalTokens})`,
  )

  // Show truncation warning
  if (truncated || (summary.truncated && summary.truncatedCount)) {
    const totalTruncated =
      truncatedCount + (summary.truncatedCount ?? 0)
    lines.push(
      `⚠️ TRUNCATED: ${totalTruncated} sections omitted to fit token budget`,
    )
  }
  lines.push('')

  if (summary.keyTopics.length > 0) {
    lines.push(`**Topics:** ${summary.keyTopics.join(', ')}`)
    lines.push('')
  }

  lines.push(sectionText)

  return lines.join('\n')
}

/**
 * Format assembled context for display
 *
 * Outputs a combined view of multiple document summaries with:
 * - Header showing total tokens and source count
 * - Individual source summaries separated by dividers
 * - Overflow list for sources that didn't fit the budget
 */
export const formatAssembledContext = (context: AssembledContext): string => {
  const lines: string[] = []

  lines.push('# Context Assembly')
  lines.push(`Total tokens: ${context.totalTokens}/${context.budget}`)
  lines.push(`Sources: ${context.sources.length}`)
  lines.push('')

  for (const source of context.sources) {
    lines.push('---')
    lines.push('')
    lines.push(source.content)
  }

  if (context.overflow.length > 0) {
    lines.push('---')
    lines.push('')
    lines.push('## Overflow (not included due to budget)')
    for (const overflowPath of context.overflow) {
      lines.push(`- ${overflowPath}`)
    }
  }

  return lines.join('\n')
}
