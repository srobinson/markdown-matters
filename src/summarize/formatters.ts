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

/**
 * Format a document summary for display
 *
 * Outputs a markdown-formatted summary with:
 * - Title and path
 * - Accurate token count (of the formatted output)
 * - Key topics
 * - Hierarchical section summaries
 */
export const formatSummary = (summary: DocumentSummary): string => {
  const lines: string[] = []

  // Build section content first to get accurate token count
  const sectionLines: string[] = []

  const formatSection = (section: SectionSummary, depth: number = 0) => {
    const indent = '  '.repeat(depth)
    const prefix = '#'.repeat(section.level)

    sectionLines.push(`${indent}${prefix} ${section.heading}`)

    if (section.summary) {
      sectionLines.push(`${indent}${section.summary}`)
    }

    for (const child of section.children) {
      formatSection(child, depth + 1)
    }
  }

  for (const section of summary.sections) {
    formatSection(section)
    sectionLines.push('')
  }

  // Calculate actual output tokens including metadata
  const metadataLines = [`# ${summary.title}`, `Path: ${summary.path}`]
  if (summary.keyTopics.length > 0) {
    metadataLines.push('')
    metadataLines.push(`**Topics:** ${summary.keyTopics.join(', ')}`)
  }
  metadataLines.push('')

  // Build the complete output including the token line
  // We need to calculate this iteratively since the token line itself adds tokens
  const baseContent = [...metadataLines, ...sectionLines].join('\n')
  const baseTokens = countTokensApprox(baseContent)

  // Estimate tokens for the "Tokens: X (Y% reduction from Z)" line
  // This line is typically 10-15 tokens depending on the numbers
  const tokenLineTemplate = `Tokens: ${baseTokens} (${(summary.compressionRatio * 100).toFixed(0)}% reduction from ${summary.originalTokens})`
  const tokenLineTokens = countTokensApprox(tokenLineTemplate)
  const totalTokens = baseTokens + tokenLineTokens

  // Now build the actual output with accurate token count
  lines.push(`# ${summary.title}`)
  lines.push(`Path: ${summary.path}`)
  lines.push(
    `Tokens: ${totalTokens} (${(summary.compressionRatio * 100).toFixed(0)}% reduction from ${summary.originalTokens})`,
  )
  lines.push('')

  if (summary.keyTopics.length > 0) {
    lines.push(`**Topics:** ${summary.keyTopics.join(', ')}`)
    lines.push('')
  }

  lines.push(...sectionLines)

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
