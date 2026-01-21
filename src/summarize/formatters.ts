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
  readonly maxTokens?: number | undefined
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
 *
 * TRUNCATION UX: When truncated, shows a warning at the TOP with:
 * - Percentage of tokens shown
 * - List of sections included/excluded
 * - Actionable guidance for getting more content
 */
export const formatSummary = (
  summary: DocumentSummary,
  options: FormatSummaryOptions = {},
): string => {
  const maxTokens = options.maxTokens

  // Flatten sections in order for incremental building
  // Uses depth-first order so children follow parents - this enables "orphan rescue"
  // where children can still be included even if their parent was too large
  const flatSections: {
    section: SectionSummary
    depth: number
    number: string
  }[] = []

  // Track section numbers for included/excluded listing
  const collectSections = (
    section: SectionSummary,
    depth: number = 0,
    parentNumber: string = '',
    index: number = 0,
  ) => {
    const number = parentNumber
      ? `${parentNumber}.${index + 1}`
      : `${index + 1}`
    flatSections.push({ section, depth, number })
    section.children.forEach((child, i) => {
      collectSections(child, depth + 1, number, i)
    })
  }

  summary.sections.forEach((section, i) => {
    collectSections(section, 0, '', i)
  })

  // Helper to build output with a given set of section indices
  const buildOutput = (
    includedSectionIndices: Set<number>,
    truncationInfo: {
      showWarning: boolean
      truncatedCount: number
      includedNumbers: string[]
      excludedNumbers: string[]
      tokensShown: number
      tokensTotal: number
    },
    includeTopics: boolean,
  ): string => {
    const lines: string[] = []

    // TRUNCATION WARNING AT TOP (when truncated)
    if (
      truncationInfo.showWarning &&
      truncationInfo.truncatedCount > 0 &&
      truncationInfo.tokensTotal > 0
    ) {
      const pct = Math.round(
        (truncationInfo.tokensShown / truncationInfo.tokensTotal) * 100,
      )
      lines.push(
        `⚠️ Truncated: Showing ~${truncationInfo.tokensShown}/${truncationInfo.tokensTotal} tokens (${pct}%)`,
      )

      // Show included sections (first few)
      if (truncationInfo.includedNumbers.length > 0) {
        const includedDisplay =
          truncationInfo.includedNumbers.length <= 6
            ? truncationInfo.includedNumbers.join(', ')
            : truncationInfo.includedNumbers.slice(0, 5).join(', ') +
              `, ... (+${truncationInfo.includedNumbers.length - 5} more)`
        lines.push(`Sections included: ${includedDisplay}`)
      }

      // Show excluded sections (first few)
      if (truncationInfo.excludedNumbers.length > 0) {
        const excludedDisplay =
          truncationInfo.excludedNumbers.length <= 6
            ? truncationInfo.excludedNumbers.join(', ')
            : truncationInfo.excludedNumbers.slice(0, 5).join(', ') +
              `, ... (+${truncationInfo.excludedNumbers.length - 5} more)`
        lines.push(`Sections excluded: ${excludedDisplay}`)
      }

      lines.push(
        'Use --full for complete content or --section to target specific sections.',
      )
      lines.push('')
    }

    lines.push(`# ${summary.title}`)
    lines.push(`Path: ${summary.path}`)

    // Placeholder for token line - we'll calculate actual tokens after building
    const tokenLineIndex = lines.length
    lines.push('PLACEHOLDER')
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
    return buildOutput(
      allIndices,
      {
        showWarning: !!hasPriorTruncation,
        truncatedCount: summary.truncatedCount ?? 0,
        includedNumbers: flatSections.map((s) => s.number),
        excludedNumbers: [],
        tokensShown: summary.summaryTokens,
        tokensTotal: summary.originalTokens,
      },
      true,
    )
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

  // Truncation warning overhead (larger now with section lists)
  const truncationWarningTokens = Math.ceil(
    countTokensApprox(
      `⚠️ Truncated: Showing ~9999/9999 tokens (99%)\nSections included: 1, 2, 3, 4, 5, ... (+99 more)\nSections excluded: 6, 7, 8, 9, 10, ... (+99 more)\nUse --full for complete content or --section to target specific sections.\n`,
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

  // Collect included/excluded section numbers
  const includedNumbers: string[] = []
  const excludedNumbers: string[] = []
  for (let i = 0; i < flatSections.length; i++) {
    if (includedIndices.has(i)) {
      includedNumbers.push(flatSections[i]!.number)
    } else {
      excludedNumbers.push(flatSections[i]!.number)
    }
  }

  // Calculate tokens shown vs total
  let tokensShown = 0
  for (const idx of includedIndices) {
    tokensShown += flatSections[idx]!.section.summaryTokens
  }

  // Build output and validate it fits
  let output = buildOutput(
    includedIndices,
    {
      showWarning: truncatedCount > 0,
      truncatedCount,
      includedNumbers,
      excludedNumbers,
      tokensShown,
      tokensTotal: summary.originalTokens,
    },
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

    // Update included/excluded lists
    const removedNumber = flatSections[indexToRemove]!.number
    const includedIdx = includedNumbers.indexOf(removedNumber)
    if (includedIdx !== -1) {
      includedNumbers.splice(includedIdx, 1)
      excludedNumbers.push(removedNumber)
    }

    // Update tokens shown
    tokensShown -= flatSections[indexToRemove]!.section.summaryTokens

    // Rebuild and recheck
    output = buildOutput(
      includedIndices,
      {
        showWarning: true,
        truncatedCount,
        includedNumbers,
        excludedNumbers,
        tokensShown,
        tokensTotal: summary.originalTokens,
      },
      includeTopics,
    )
    actualTokens = countTokensApprox(output)
  }

  // If still over budget and we haven't dropped topics yet, try that
  if (actualTokens > maxTokens && includeTopics) {
    includeTopics = false
    output = buildOutput(
      includedIndices,
      {
        showWarning: truncatedCount > 0,
        truncatedCount,
        includedNumbers,
        excludedNumbers,
        tokensShown,
        tokensTotal: summary.originalTokens,
      },
      includeTopics,
    )
    actualTokens = countTokensApprox(output)
  }

  // If still over budget, try dropping the truncation warning as last resort
  // (only if we're showing it and have truncated sections)
  if (actualTokens > maxTokens && truncatedCount > 0) {
    output = buildOutput(
      includedIndices,
      {
        showWarning: false,
        truncatedCount,
        includedNumbers,
        excludedNumbers,
        tokensShown,
        tokensTotal: summary.originalTokens,
      },
      includeTopics,
    )
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
