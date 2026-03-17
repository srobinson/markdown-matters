/**
 * Formatting functions for summarization output
 *
 * Responsible for converting summary data structures into human-readable text.
 * No budget logic. The formatter formats; the assembler budgets.
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

  lines.push(`# ${summary.title}`)
  lines.push(`Path: ${summary.path}`)

  // Placeholder for token line (we calculate actual tokens after building)
  const tokenLineIndex = lines.length
  lines.push('PLACEHOLDER')
  lines.push('')

  if (summary.keyTopics.length > 0) {
    lines.push(`**Topics:** ${summary.keyTopics.join(', ')}`)
    lines.push('')
  }

  // Build section content with depth-first traversal
  const sectionLines: string[] = []

  const renderSection = (section: SectionSummary, depth: number) => {
    const indent = '  '.repeat(depth)
    const prefix = '#'.repeat(section.level)
    sectionLines.push(`${indent}${prefix} ${section.heading}`)
    if (section.summary) {
      sectionLines.push(`${indent}${section.summary}`)
    }
    for (const child of section.children) {
      renderSection(child, depth + 1)
    }
  }

  for (const section of summary.sections) {
    renderSection(section, 0)
  }

  lines.push(sectionLines.join('\n'))

  // Calculate actual token count for this output
  const tempOutput = lines.join('\n')
  const tokensWithoutLine = countTokensApprox(
    tempOutput.replace('PLACEHOLDER', ''),
  )

  // Iterate to find stable token count (the token line itself adds tokens)
  let estimatedTotal = tokensWithoutLine + 8
  for (let iter = 0; iter < 3; iter++) {
    const testTokenLine = `Tokens: ${estimatedTotal} (${(summary.compressionRatio * 100).toFixed(0)}% reduction from ${summary.originalTokens})`
    const testOutput = tempOutput.replace('PLACEHOLDER', testTokenLine)
    const actualTotal = countTokensApprox(testOutput)
    if (actualTotal === estimatedTotal) break
    estimatedTotal = actualTotal
  }

  const finalTokenLine = `Tokens: ${estimatedTotal} (${(summary.compressionRatio * 100).toFixed(0)}% reduction from ${summary.originalTokens})`
  lines[tokenLineIndex] = finalTokenLine

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
