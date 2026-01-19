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
 *
 * When maxTokens is specified, strictly enforces the budget by iteratively
 * removing sections until the output fits.
 */
export const formatSummary = (
  summary: DocumentSummary,
  options: FormatSummaryOptions = {},
): string => {
  const maxTokens = options.maxTokens

  // Flatten sections in order for incremental building
  // Uses depth-first order so children follow parents - this enables "orphan rescue"
  // where children can still be included even if their parent was too large
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

  // Helper to build output with a given set of section indices
  const buildOutput = (
    includedSectionIndices: Set<number>,
    showTruncationWarning: boolean,
    truncationCount: number,
    includeTopics: boolean,
  ): string => {
    const lines: string[] = []
    lines.push(`# ${summary.title}`)
    lines.push(`Path: ${summary.path}`)

    // Placeholder for token line - we'll calculate actual tokens after building
    const tokenLineIndex = lines.length
    lines.push('PLACEHOLDER')

    if (showTruncationWarning && truncationCount > 0) {
      const totalTruncated = truncationCount + (summary.truncatedCount ?? 0)
      lines.push(
        `⚠️ TRUNCATED: ${totalTruncated} sections omitted to fit token budget`,
      )
    }
    lines.push('')

    const fullTopicsLine =
      summary.keyTopics.length > 0
        ? `**Topics:** ${summary.keyTopics.join(', ')}`
        : ''

    if (includeTopics && fullTopicsLine) {
      lines.push(fullTopicsLine)
      lines.push('')
    }

    // Build section content
    const sectionLines: string[] = []
    for (let i = 0; i < flatSections.length; i++) {
      if (!includedSectionIndices.has(i)) continue
      const { section, depth } = flatSections[i]!
      const indent = '  '.repeat(depth)
      const prefix = '#'.repeat(section.level)
      sectionLines.push(`${indent}${prefix} ${section.heading}`)
      if (section.summary) {
        sectionLines.push(`${indent}${section.summary}`)
      }
    }

    lines.push(sectionLines.join('\n'))

    // Calculate actual token count for this output
    // Build output without token line first
    const tempOutput = lines.join('\n')
    const tokensWithoutLine = countTokensApprox(
      tempOutput.replace('PLACEHOLDER', ''),
    )

    // The token line itself adds tokens - iterate to find stable count
    // Token line format: "Tokens: XXX (YY% reduction from ZZZ)"
    let estimatedTotal = tokensWithoutLine + 8 // Initial estimate for token line
    for (let iter = 0; iter < 3; iter++) {
      const testTokenLine = `Tokens: ${estimatedTotal} (${(summary.compressionRatio * 100).toFixed(0)}% reduction from ${summary.originalTokens})`
      const testOutput = tempOutput.replace('PLACEHOLDER', testTokenLine)
      const actualTotal = countTokensApprox(testOutput)
      if (actualTotal === estimatedTotal) break
      estimatedTotal = actualTotal
    }

    // Final token line with converged count
    const finalTokenLine = `Tokens: ${estimatedTotal} (${(summary.compressionRatio * 100).toFixed(0)}% reduction from ${summary.originalTokens})`
    lines[tokenLineIndex] = finalTokenLine

    return lines.join('\n')
  }

  // If no budget, include everything
  if (maxTokens === undefined) {
    const allIndices = new Set(flatSections.map((_, i) => i))
    const hasPriorTruncation = summary.truncated && summary.truncatedCount
    return buildOutput(allIndices, !!hasPriorTruncation, 0, true)
  }

  // With budget: greedily add sections, then validate and trim if needed
  const includedIndices = new Set<number>()
  let truncatedCount = 0
  let includeTopics = true

  // First pass: estimate what fits using conservative token counting
  // Add 15% safety margin to each section's token count
  const SAFETY_MARGIN = 1.15

  // Calculate minimum header overhead (title, path, token line)
  const minHeaderTemplate = [
    `# ${summary.title}`,
    `Path: ${summary.path}`,
    `Tokens: 9999 (${(summary.compressionRatio * 100).toFixed(0)}% reduction from ${summary.originalTokens})`,
    '',
    '',
  ].join('\n')
  const minHeaderTokens = Math.ceil(
    countTokensApprox(minHeaderTemplate) * SAFETY_MARGIN,
  )

  // Calculate topics overhead
  const fullTopicsLine =
    summary.keyTopics.length > 0
      ? `**Topics:** ${summary.keyTopics.join(', ')}\n`
      : ''
  const topicsTokens = fullTopicsLine
    ? Math.ceil(countTokensApprox(fullTopicsLine) * SAFETY_MARGIN)
    : 0

  // Truncation warning overhead
  const truncationWarningTokens = Math.ceil(
    countTokensApprox(
      `⚠️ TRUNCATED: 999 sections omitted to fit token budget\n`,
    ) * SAFETY_MARGIN,
  )

  // Start with header + topics
  let headerTokens = minHeaderTokens + topicsTokens

  // If header alone exceeds budget, drop topics
  if (headerTokens >= maxTokens) {
    includeTopics = false
    headerTokens = minHeaderTokens
  }

  // Calculate content budget (reserve space for potential truncation warning)
  let contentBudget = maxTokens - headerTokens - truncationWarningTokens
  let tokensUsed = 0

  // Greedy section selection
  for (let i = 0; i < flatSections.length; i++) {
    const { section, depth } = flatSections[i]!
    const indent = '  '.repeat(depth)
    const prefix = '#'.repeat(section.level)
    const sectionContent = section.summary
      ? `${indent}${prefix} ${section.heading}\n${indent}${section.summary}`
      : `${indent}${prefix} ${section.heading}`

    const sectionTokens = Math.ceil(
      countTokensApprox(sectionContent) * SAFETY_MARGIN,
    )

    if (tokensUsed + sectionTokens <= contentBudget) {
      includedIndices.add(i)
      tokensUsed += sectionTokens
    } else {
      truncatedCount++
    }
  }

  // If nothing was truncated, we can use the full content budget
  if (truncatedCount === 0) {
    contentBudget += truncationWarningTokens
  }

  // Build output and validate it fits
  let output = buildOutput(
    includedIndices,
    truncatedCount > 0,
    truncatedCount,
    includeTopics,
  )
  let actualTokens = countTokensApprox(output)

  // Final validation loop: remove sections from the end until we fit
  // This handles any estimation errors
  const sortedIndices = Array.from(includedIndices).sort((a, b) => b - a) // Reverse order
  let removalIndex = 0

  while (actualTokens > maxTokens && removalIndex < sortedIndices.length) {
    // Remove the last section
    const indexToRemove = sortedIndices[removalIndex]!
    includedIndices.delete(indexToRemove)
    truncatedCount++
    removalIndex++

    // Rebuild and recheck
    output = buildOutput(includedIndices, true, truncatedCount, includeTopics)
    actualTokens = countTokensApprox(output)
  }

  // If still over budget and we haven't dropped topics yet, try that
  if (actualTokens > maxTokens && includeTopics) {
    includeTopics = false
    output = buildOutput(includedIndices, true, truncatedCount, includeTopics)
    actualTokens = countTokensApprox(output)
  }

  // If still over budget, try dropping the truncation warning as last resort
  // (only if we're showing it and have truncated sections)
  if (actualTokens > maxTokens && truncatedCount > 0) {
    output = buildOutput(includedIndices, false, truncatedCount, includeTopics)
    actualTokens = countTokensApprox(output)
  }

  return output
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
