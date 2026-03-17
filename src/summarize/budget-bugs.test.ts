/**
 * Tests for summarizeDocument behavior
 *
 * Validates that summarizeDocument produces all sections at each level
 * without truncation, and that the level controls density correctly.
 */

import { describe, expect, it } from 'vitest'
import type {
  DocumentMetadata,
  HeadingLevel,
  MdDocument,
  MdSection,
  SectionMetadata,
} from '../core/types.js'
import { summarizeDocument } from './summarizer.js'

const makeSectionMeta = (
  overrides: Partial<SectionMetadata> = {},
): SectionMetadata => ({
  wordCount: 20,
  tokenCount: 100,
  hasCode: false,
  hasList: false,
  hasTable: false,
  ...overrides,
})

const makeSection = (
  heading: string,
  level: HeadingLevel,
  overrides: {
    plainText?: string
    children?: MdSection[]
    metadata?: Partial<SectionMetadata>
  } = {},
): MdSection => ({
  id: heading.toLowerCase().replace(/\s+/g, '-'),
  heading,
  level,
  content: `${'#'.repeat(level)} ${heading}\n${overrides.plainText ?? 'Some content here.'}`,
  plainText: overrides.plainText ?? 'Some content here.',
  startLine: 1,
  endLine: 10,
  children: overrides.children ?? [],
  metadata: makeSectionMeta(overrides.metadata),
})

const makeDocument = (
  title: string,
  sections: MdSection[],
): MdDocument => {
  const totalTokens = sections.reduce(
    (sum, s) => sum + s.metadata.tokenCount,
    0,
  )
  const metadata: DocumentMetadata = {
    wordCount: totalTokens * 2,
    tokenCount: totalTokens,
    headingCount: sections.length,
    linkCount: 0,
    codeBlockCount: 0,
    lastModified: new Date(),
    indexedAt: new Date(),
  }
  return {
    id: title.toLowerCase().replace(/\s+/g, '-'),
    title,
    path: '/test/file.md',
    frontmatter: {},
    sections,
    links: [],
    codeBlocks: [],
    metadata,
  }
}

describe('summarizeDocument', () => {
  describe('produces all sections without truncation', () => {
    it('includes every section at brief level', () => {
      const doc = makeDocument('Test', [
        makeSection('Section A', 2),
        makeSection('Section B', 2),
        makeSection('Section C', 2),
      ])

      const result = summarizeDocument(doc, { level: 'brief' })

      expect(result.sections).toHaveLength(3)
      expect(result.sections[0]!.heading).toBe('Section A')
      expect(result.sections[1]!.heading).toBe('Section B')
      expect(result.sections[2]!.heading).toBe('Section C')
    })

    it('includes every section at summary level', () => {
      const doc = makeDocument('Test', [
        makeSection('Section A', 2, {
          plainText:
            'Long content that would exceed any reasonable budget. '.repeat(20),
          metadata: { tokenCount: 500 },
        }),
        makeSection('Section B', 2, {
          plainText:
            'More content that is also quite large in token count. '.repeat(20),
          metadata: { tokenCount: 500 },
        }),
      ])

      const result = summarizeDocument(doc, { level: 'summary' })

      expect(result.sections).toHaveLength(2)
      expect(result.sections[0]!.heading).toBe('Section A')
      expect(result.sections[1]!.heading).toBe('Section B')
    })

    it('includes every section at full level', () => {
      const doc = makeDocument('Test', [
        makeSection('Section A', 2, {
          plainText: 'Full content A.',
          metadata: { tokenCount: 1000 },
        }),
        makeSection('Section B', 2, {
          plainText: 'Full content B.',
          metadata: { tokenCount: 1000 },
        }),
      ])

      const result = summarizeDocument(doc, { level: 'full' })

      expect(result.sections).toHaveLength(2)
      expect(result.sections[0]!.summary).toBe('Full content A.')
      expect(result.sections[1]!.summary).toBe('Full content B.')
    })
  })

  describe('level controls density', () => {
    it('brief produces minimal output with content markers', () => {
      const doc = makeDocument('Test', [
        makeSection('Code Section', 2, {
          plainText: 'Some code content. '.repeat(50),
          metadata: { tokenCount: 500, hasCode: true, hasList: true },
        }),
      ])

      const result = summarizeDocument(doc, { level: 'brief' })
      const section = result.sections[0]!

      expect(section.summary).toContain('[')
      expect(section.summary).toContain('code')
      expect(section.summary).toContain('list')
      expect(section.summaryTokens).toBeLessThan(section.originalTokens)
    })

    it('summary extracts key points', () => {
      const doc = makeDocument('Test', [
        makeSection('Detailed Section', 2, {
          plainText:
            'Authentication uses OAuth2 with PKCE flow. The token refresh happens automatically. Sessions are stored in Redis for fast access. Expired sessions are cleaned every hour.',
          metadata: { tokenCount: 200 },
        }),
      ])

      const result = summarizeDocument(doc, { level: 'summary' })
      const section = result.sections[0]!

      expect(section.summary.length).toBeGreaterThan(0)
      expect(section.summaryTokens).toBeLessThanOrEqual(
        section.originalTokens,
      )
    })

    it('full includes complete content', () => {
      const fullText =
        'Complete original content that should be preserved exactly.'
      const doc = makeDocument('Test', [
        makeSection('Full Section', 2, {
          plainText: fullText,
          metadata: { tokenCount: 20 },
        }),
      ])

      const result = summarizeDocument(doc, { level: 'full' })
      const section = result.sections[0]!

      expect(section.summary).toBe(fullText)
    })
  })

  describe('defaults to brief level', () => {
    it('uses brief when no level specified', () => {
      const doc = makeDocument('Test', [
        makeSection('Section', 2, {
          plainText: 'Content. '.repeat(100),
          metadata: { tokenCount: 500, hasCode: true },
        }),
      ])

      const result = summarizeDocument(doc)
      const section = result.sections[0]!

      expect(section.summary).toContain('[code]')
    })
  })

  describe('nested sections preserved', () => {
    it('preserves full section tree at all levels', () => {
      const child = makeSection('Child', 3, {
        plainText: 'Child content.',
        metadata: { tokenCount: 50 },
      })
      const parent = makeSection('Parent', 2, {
        plainText: 'Parent content.',
        children: [child],
        metadata: { tokenCount: 200 },
      })

      const doc = makeDocument('Test', [parent])
      const result = summarizeDocument(doc, { level: 'brief' })

      expect(result.sections).toHaveLength(1)
      expect(result.sections[0]!.children).toHaveLength(1)
      expect(result.sections[0]!.children[0]!.heading).toBe('Child')
    })
  })

  describe('compression ratio', () => {
    it('calculates compression ratio correctly', () => {
      const doc = makeDocument('Test', [
        makeSection('Section', 2, {
          plainText: 'Content. '.repeat(100),
          metadata: { tokenCount: 500 },
        }),
      ])

      const result = summarizeDocument(doc, { level: 'brief' })

      expect(result.compressionRatio).toBeGreaterThan(0)
      expect(result.compressionRatio).toBeLessThanOrEqual(1)
      expect(result.summaryTokens).toBeLessThan(result.originalTokens)
    })
  })

  describe('topics extraction', () => {
    it('extracts topics from section headings', () => {
      const doc = makeDocument('Test', [
        makeSection('Authentication', 2),
        makeSection('Session Management', 2),
      ])

      const result = summarizeDocument(doc)

      expect(result.keyTopics.length).toBeGreaterThan(0)
      expect(result.keyTopics).toContain('authentication')
    })
  })
})
