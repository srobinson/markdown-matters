/**
 * Section filtering utilities for extracting specific sections from markdown documents
 */

import type { MdDocument, MdSection } from '../core/types.js'

// ============================================================================
// Simple Glob Matching
// ============================================================================

/**
 * Simple glob pattern matching (supports * and ?)
 */
const globMatch = (text: string, pattern: string): boolean => {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except * and ?
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')

  const regex = new RegExp(`^${regexPattern}$`, 'i')
  return regex.test(text)
}

// ============================================================================
// Types
// ============================================================================

export interface SectionListItem {
  readonly number: string
  readonly heading: string
  readonly level: number
  readonly tokenCount: number
}

export interface SectionFilterOptions {
  /** If true, don't include nested subsections */
  readonly shallow?: boolean
}

// ============================================================================
// Section Map Building
// ============================================================================

/**
 * Build a flat list of all sections with their hierarchical numbers
 * e.g., "1", "1.1", "1.2", "2", "2.1", etc.
 */
export const buildSectionList = (document: MdDocument): SectionListItem[] => {
  const result: SectionListItem[] = []

  const processSection = (
    section: MdSection,
    prefix: string,
    index: number,
  ): void => {
    const number = prefix ? `${prefix}.${index + 1}` : `${index + 1}`

    result.push({
      number,
      heading: section.heading,
      level: section.level,
      tokenCount: section.metadata.tokenCount,
    })

    // Process children
    section.children.forEach((child, i) => {
      processSection(child, number, i)
    })
  }

  document.sections.forEach((section, i) => {
    processSection(section, '', i)
  })

  return result
}

/**
 * Format section list for display
 */
export const formatSectionList = (sections: SectionListItem[]): string => {
  const lines: string[] = []

  for (const section of sections) {
    // Indent based on dots in number
    const depth = (section.number.match(/\./g) || []).length
    const indent = '   '.repeat(depth)
    lines.push(
      `${indent}${section.number}. ${section.heading} (${section.tokenCount} tokens)`,
    )
  }

  return lines.join('\n')
}

// ============================================================================
// Section Matching
// ============================================================================

/**
 * Check if a section matches a selector (by number, exact name, or glob pattern)
 */
const matchesSelector = (
  section: SectionListItem,
  selector: string,
): boolean => {
  // Check if it's a number match (e.g., "5.3")
  if (/^[\d.]+$/.test(selector)) {
    // Exact number match
    return section.number === selector
  }

  // Check for exact heading match (case-insensitive)
  if (section.heading.toLowerCase() === selector.toLowerCase()) {
    return true
  }

  // Check for glob pattern match
  if (selector.includes('*') || selector.includes('?')) {
    return globMatch(section.heading, selector)
  }

  // Partial match (contains)
  return section.heading.toLowerCase().includes(selector.toLowerCase())
}

/**
 * Find all sections matching a selector
 */
export const findMatchingSections = (
  sectionList: SectionListItem[],
  selector: string,
): SectionListItem[] => {
  return sectionList.filter((s) => matchesSelector(s, selector))
}

/**
 * Get all descendant section numbers for a given section number
 */
const getDescendantNumbers = (
  sectionList: SectionListItem[],
  parentNumber: string,
): Set<string> => {
  const result = new Set<string>()
  const prefix = `${parentNumber}.`

  for (const section of sectionList) {
    if (section.number.startsWith(prefix)) {
      result.add(section.number)
    }
  }

  return result
}

// ============================================================================
// Section Content Extraction
// ============================================================================

/**
 * Extract content for specific sections from a document
 */
export const extractSectionContent = (
  document: MdDocument,
  selector: string,
  options: SectionFilterOptions = {},
): {
  sections: MdSection[]
  matchedNumbers: string[]
} => {
  const sectionList = buildSectionList(document)
  const matchedSections = findMatchingSections(sectionList, selector)

  if (matchedSections.length === 0) {
    return { sections: [], matchedNumbers: [] }
  }

  // Get all section numbers to include
  const numbersToInclude = new Set<string>()
  const matchedNumbers: string[] = []

  for (const matched of matchedSections) {
    numbersToInclude.add(matched.number)
    matchedNumbers.push(matched.number)

    if (!options.shallow) {
      // Include all descendants
      const descendants = getDescendantNumbers(sectionList, matched.number)
      for (const desc of descendants) {
        numbersToInclude.add(desc)
      }
    }
  }

  // Build a map from section number to section for efficient lookup
  const numberToSection = new Map<string, MdSection>()

  const mapSections = (
    sections: readonly MdSection[],
    prefix: string,
  ): void => {
    sections.forEach((section, i) => {
      const number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`
      numberToSection.set(number, section)
      mapSections(section.children, number)
    })
  }

  mapSections(document.sections, '')

  // Extract matching sections
  const extractedSections: MdSection[] = []

  for (const number of matchedNumbers) {
    const section = numberToSection.get(number)
    if (section) {
      if (options.shallow) {
        // Clone without children for shallow mode
        extractedSections.push({
          ...section,
          children: [],
        })
      } else {
        extractedSections.push(section)
      }
    }
  }

  return { sections: extractedSections, matchedNumbers }
}

/**
 * Format extracted sections as markdown content
 */
export const formatExtractedSections = (sections: MdSection[]): string => {
  const formatSection = (
    section: MdSection,
    includeChildren: boolean,
  ): string => {
    const lines: string[] = []

    // Add heading
    const headingPrefix = '#'.repeat(section.level)
    lines.push(`${headingPrefix} ${section.heading}`)
    lines.push('')

    // Add content (strip the heading line if it starts with #)
    const contentLines = section.content.split('\n')
    const contentWithoutHeading = contentLines
      .filter((line, i) => i > 0 || !line.startsWith('#'))
      .join('\n')
      .trim()

    if (contentWithoutHeading) {
      lines.push(contentWithoutHeading)
    }

    if (includeChildren) {
      for (const child of section.children) {
        lines.push('')
        lines.push(formatSection(child, true))
      }
    }

    return lines.join('\n')
  }

  return sections.map((s) => formatSection(s, true)).join('\n\n')
}
