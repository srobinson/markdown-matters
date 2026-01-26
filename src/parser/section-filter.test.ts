/**
 * Tests for section filtering utilities
 */

import { describe, expect, it } from 'vitest'
import type { HeadingLevel, MdDocument, MdSection } from '../core/types.js'
import {
  buildSectionList,
  extractSectionContent,
  filterDocumentSections,
  filterExcludedSections,
} from './section-filter.js'

// Helper to create minimal section for testing
const createSection = (
  heading: string,
  level: HeadingLevel,
  children: MdSection[] = [],
  tokenCount: number = 100,
): MdSection => ({
  id: `section-${heading.toLowerCase().replace(/\s+/g, '-')}`,
  heading,
  level,
  content: `# ${heading}\n\nContent for ${heading}`,
  plainText: `Content for ${heading}`,
  startLine: 1,
  endLine: 10,
  children,
  metadata: {
    wordCount: 10,
    tokenCount,
    hasCode: false,
    hasList: false,
    hasTable: false,
  },
})

// Helper to create minimal document for testing
const createDocument = (sections: MdSection[]): MdDocument => ({
  id: 'test-doc',
  path: '/test/doc.md',
  title: 'Test Document',
  sections,
  links: [],
  codeBlocks: [],
  metadata: {
    tokenCount: sections.reduce((acc, s) => acc + s.metadata.tokenCount, 0),
    headingCount: sections.length,
    linkCount: 0,
    codeBlockCount: 0,
    wordCount: 100,
    lastModified: new Date(),
    indexedAt: new Date(),
  },
  frontmatter: {},
})

describe('section-filter', () => {
  describe('filterExcludedSections', () => {
    const sectionList = [
      { number: '1', heading: 'Introduction', level: 1, tokenCount: 100 },
      { number: '1.1', heading: 'Overview', level: 2, tokenCount: 50 },
      { number: '2', heading: 'Installation', level: 1, tokenCount: 200 },
      { number: '2.1', heading: 'Requirements', level: 2, tokenCount: 75 },
      { number: '2.2', heading: 'Setup Steps', level: 2, tokenCount: 80 },
      { number: '3', heading: 'API Reference', level: 1, tokenCount: 500 },
      { number: '3.1', heading: 'Methods', level: 2, tokenCount: 300 },
      { number: '4', heading: 'License', level: 1, tokenCount: 50 },
    ]

    it('returns all sections when no exclusion patterns provided', () => {
      const result = filterExcludedSections(sectionList, [])
      expect(result).toEqual(sectionList)
    })

    it('excludes sections by exact heading match', () => {
      const result = filterExcludedSections(sectionList, ['License'])
      expect(result).toHaveLength(7)
      expect(result.find((s) => s.heading === 'License')).toBeUndefined()
    })

    it('excludes sections by partial heading match', () => {
      const result = filterExcludedSections(sectionList, ['Setup'])
      expect(result).toHaveLength(7)
      expect(result.find((s) => s.heading === 'Setup Steps')).toBeUndefined()
    })

    it('excludes sections by glob pattern', () => {
      const result = filterExcludedSections(sectionList, ['*Reference*'])
      expect(result).toHaveLength(7)
      expect(result.find((s) => s.heading === 'API Reference')).toBeUndefined()
    })

    it('excludes sections by section number', () => {
      const result = filterExcludedSections(sectionList, ['2.1'])
      expect(result).toHaveLength(7)
      expect(result.find((s) => s.number === '2.1')).toBeUndefined()
    })

    it('excludes multiple sections with multiple patterns', () => {
      const result = filterExcludedSections(sectionList, [
        'License',
        'Overview',
      ])
      expect(result).toHaveLength(6)
      expect(result.find((s) => s.heading === 'License')).toBeUndefined()
      expect(result.find((s) => s.heading === 'Overview')).toBeUndefined()
    })

    it('handles case-insensitive matching', () => {
      const result = filterExcludedSections(sectionList, ['LICENSE'])
      expect(result).toHaveLength(7)
      expect(result.find((s) => s.heading === 'License')).toBeUndefined()
    })
  })

  describe('extractSectionContent with exclusion', () => {
    const doc = createDocument([
      createSection('Introduction', 1, [
        createSection('Getting Started', 2),
        createSection('Quick Start', 2),
      ]),
      createSection('API', 1, [
        createSection('Methods', 2),
        createSection('Properties', 2),
      ]),
      createSection('License', 1),
    ])

    it('extracts all matching sections without exclusion', () => {
      const result = extractSectionContent(doc, '*')
      expect(result.matchedNumbers).toHaveLength(7)
      expect(result.excludedNumbers).toHaveLength(0)
    })

    it('excludes sections matching exclusion pattern', () => {
      const result = extractSectionContent(doc, '*', {
        exclude: ['License'],
      })
      expect(result.matchedNumbers).toHaveLength(6)
      expect(result.excludedNumbers).toEqual(['3'])
      expect(
        result.sections.find((s) => s.heading === 'License'),
      ).toBeUndefined()
    })

    it('reports excluded sections in excludedNumbers', () => {
      const result = extractSectionContent(doc, '*', {
        exclude: ['Quick Start', 'Properties'],
      })
      expect(result.excludedNumbers).toContain('1.2')
      expect(result.excludedNumbers).toContain('2.2')
    })

    it('combines shallow and exclude options', () => {
      const result = extractSectionContent(doc, 'Introduction', {
        shallow: true,
        exclude: ['Getting Started'],
      })
      // With shallow, we only get Introduction without children
      // The exclude pattern only affects the matched sections list
      expect(result.sections).toHaveLength(1)
      expect(result.sections[0]?.heading).toBe('Introduction')
    })
  })

  describe('filterDocumentSections', () => {
    const doc = createDocument([
      createSection('Introduction', 1, [
        createSection('Overview', 2),
        createSection('Goals', 2),
      ]),
      createSection('Installation', 1),
      createSection('License', 1),
    ])

    it('returns original document when no exclusion patterns', () => {
      const result = filterDocumentSections(doc, [])
      expect(result.document).toBe(doc)
      expect(result.excludedCount).toBe(0)
    })

    it('filters out matching sections from document', () => {
      const result = filterDocumentSections(doc, ['License'])
      expect(result.excludedCount).toBe(1)
      expect(result.document.sections).toHaveLength(2)
      expect(
        result.document.sections.find((s) => s.heading === 'License'),
      ).toBeUndefined()
    })

    it('filters out nested sections', () => {
      const result = filterDocumentSections(doc, ['Overview'])
      expect(result.excludedCount).toBe(1)
      // Find Introduction section
      const intro = result.document.sections.find(
        (s) => s.heading === 'Introduction',
      )
      expect(intro).toBeDefined()
      // Overview should be removed from children
      expect(
        intro?.children.find((c) => c.heading === 'Overview'),
      ).toBeUndefined()
      // Goals should still be there
      expect(intro?.children.find((c) => c.heading === 'Goals')).toBeDefined()
    })

    it('filters multiple sections with glob pattern', () => {
      const result = filterDocumentSections(doc, ['*stallation*', 'License'])
      expect(result.excludedCount).toBe(2)
      expect(result.document.sections).toHaveLength(1)
      expect(result.document.sections[0]?.heading).toBe('Introduction')
    })

    it('preserves document structure for non-matching sections', () => {
      const result = filterDocumentSections(doc, ['NonExistent'])
      expect(result.document).toBe(doc)
      expect(result.excludedCount).toBe(0)
    })

    it('counts descendants when parent section is excluded', () => {
      // Introduction has 2 children (Overview, Goals), so excluding Introduction
      // should count 3 total excluded sections
      const result = filterDocumentSections(doc, ['Introduction'])
      expect(result.excludedCount).toBe(3) // Introduction + Overview + Goals
      expect(result.document.sections).toHaveLength(2) // Installation + License
      expect(
        result.document.sections.find((s) => s.heading === 'Introduction'),
      ).toBeUndefined()
    })

    it('counts deeply nested descendants correctly', () => {
      const deepDoc = createDocument([
        createSection('Root', 1, [
          createSection('Child 1', 2, [
            createSection('Grandchild 1', 3),
            createSection('Grandchild 2', 3),
          ]),
          createSection('Child 2', 2),
        ]),
        createSection('Other', 1),
      ])
      const result = filterDocumentSections(deepDoc, ['Root'])
      // Root + Child 1 + Grandchild 1 + Grandchild 2 + Child 2 = 5
      expect(result.excludedCount).toBe(5)
      expect(result.document.sections).toHaveLength(1)
      expect(result.document.sections[0]?.heading).toBe('Other')
    })

    it('does not double-count when multiple patterns match same section', () => {
      const result = filterDocumentSections(doc, ['Introduction', 'Intro*'])
      // Both patterns match Introduction, but should only count once
      // Introduction + Overview + Goals = 3
      expect(result.excludedCount).toBe(3)
    })
  })

  describe('buildSectionList', () => {
    const doc = createDocument([
      createSection('A', 1, [
        createSection('A.1', 2, [createSection('A.1.1', 3)]),
        createSection('A.2', 2),
      ]),
      createSection('B', 1),
    ])

    it('assigns correct hierarchical numbers', () => {
      const list = buildSectionList(doc)
      expect(list).toHaveLength(5)
      expect(list[0]).toMatchObject({ number: '1', heading: 'A' })
      expect(list[1]).toMatchObject({ number: '1.1', heading: 'A.1' })
      expect(list[2]).toMatchObject({ number: '1.1.1', heading: 'A.1.1' })
      expect(list[3]).toMatchObject({ number: '1.2', heading: 'A.2' })
      expect(list[4]).toMatchObject({ number: '2', heading: 'B' })
    })
  })
})
