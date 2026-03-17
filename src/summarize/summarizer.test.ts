/**
 * Tests for summarization engine
 *
 * Focuses on token count accuracy and the simplified formatting pipeline.
 * Budget enforcement is tested in assembler tests, not here.
 */

import { describe, expect, it } from 'vitest'
import { countTokensApprox } from '../utils/tokens.js'
import { formatSummary } from './formatters.js'
import type { DocumentSummary, SectionSummary } from './summarizer.js'

/** Helper to create a SectionSummary with defaults for test brevity */
const sec = (
  heading: string,
  level: number,
  overrides: Partial<SectionSummary> = {},
): SectionSummary => ({
  heading,
  level,
  startLine: 1,
  endLine: 10,
  originalTokens: 100,
  summaryTokens: 20,
  summary: '',
  children: [],
  hasCode: false,
  hasList: false,
  hasTable: false,
  ...overrides,
})

describe('summarizer', () => {
  describe('formatSummary token accuracy', () => {
    it('displays token count matching actual output', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test Document',
        originalTokens: 1000,
        summaryTokens: 100,
        compressionRatio: 0.9,
        sections: [
          sec('Section 1', 2, {
            originalTokens: 500,
            summaryTokens: 50,
            summary: 'This is the summary of section 1.',
          }),
        ],
        keyTopics: ['topic1', 'topic2'],
      }

      const output = formatSummary(mockSummary)

      const tokenMatch = output.match(/Tokens: (\d+)/)
      expect(tokenMatch).toBeTruthy()
      const displayedTokens = parseInt(tokenMatch![1]!, 10)
      const actualTokens = countTokensApprox(output)

      const tolerance = Math.max(actualTokens * 0.1, 5)
      expect(Math.abs(displayedTokens - actualTokens)).toBeLessThan(tolerance)
    })

    it('handles document with no topics', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Simple Doc',
        originalTokens: 100,
        summaryTokens: 50,
        compressionRatio: 0.5,
        sections: [],
        keyTopics: [],
      }

      const output = formatSummary(mockSummary)
      expect(output).not.toContain('**Topics:**')

      const tokenMatch = output.match(/Tokens: (\d+)/)
      expect(tokenMatch).toBeTruthy()
      const displayedTokens = parseInt(tokenMatch![1]!, 10)
      const actualTokens = countTokensApprox(output)
      expect(Math.abs(displayedTokens - actualTokens)).toBeLessThan(5)
    })

    it('handles nested sections', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/nested.md',
        title: 'Nested Document',
        originalTokens: 500,
        summaryTokens: 100,
        compressionRatio: 0.8,
        sections: [
          sec('Parent Section', 2, {
            originalTokens: 300,
            summaryTokens: 60,
            summary: 'Parent summary content.',
            children: [
              sec('Child Section', 3, {
                startLine: 5,
                endLine: 10,
                originalTokens: 100,
                summaryTokens: 20,
                summary: 'Child summary content.',
                hasCode: true,
              }),
            ],
            hasList: true,
          }),
        ],
        keyTopics: ['parent', 'child'],
      }

      const output = formatSummary(mockSummary)

      expect(output).toContain('## Parent Section')
      expect(output).toContain('### Child Section')

      const tokenMatch = output.match(/Tokens: (\d+)/)
      expect(tokenMatch).toBeTruthy()
      const displayedTokens = parseInt(tokenMatch![1]!, 10)
      const actualTokens = countTokensApprox(output)
      const tolerance = Math.max(actualTokens * 0.15, 5)
      expect(Math.abs(displayedTokens - actualTokens)).toBeLessThan(tolerance)
    })

    it('includes compression ratio in output', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test',
        originalTokens: 1000,
        summaryTokens: 200,
        compressionRatio: 0.8,
        sections: [],
        keyTopics: [],
      }

      const output = formatSummary(mockSummary)

      expect(output).toContain('80% reduction')
      expect(output).toContain('from 1000')
    })
  })

  describe('formatSummary includes all sections (no truncation)', () => {
    it('includes all sections regardless of size', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test Document',
        originalTokens: 5000,
        summaryTokens: 2000,
        compressionRatio: 0.6,
        sections: [
          sec('Section 1', 2, {
            originalTokens: 1000,
            summaryTokens: 500,
            summary: 'Long content '.repeat(50),
          }),
          sec('Section 2', 2, {
            startLine: 50,
            endLine: 100,
            originalTokens: 1000,
            summaryTokens: 500,
            summary: 'More content '.repeat(50),
          }),
        ],
        keyTopics: ['test'],
      }

      const output = formatSummary(mockSummary)

      expect(output).toContain('Section 1')
      expect(output).toContain('Section 2')
      expect(output).not.toContain('Truncated')
    })

    it('renders deeply nested children', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Deep',
        originalTokens: 1000,
        summaryTokens: 100,
        compressionRatio: 0.9,
        sections: [
          sec('L1', 2, {
            originalTokens: 500,
            summaryTokens: 30,
            summary: 'Level 1.',
            children: [
              sec('L2', 3, {
                startLine: 5,
                endLine: 30,
                originalTokens: 300,
                summaryTokens: 20,
                summary: 'Level 2.',
                children: [
                  sec('L3', 4, {
                    startLine: 10,
                    endLine: 20,
                    originalTokens: 100,
                    summaryTokens: 10,
                    summary: 'Level 3.',
                  }),
                ],
              }),
            ],
          }),
        ],
        keyTopics: [],
      }

      const output = formatSummary(mockSummary)

      expect(output).toContain('L1')
      expect(output).toContain('L2')
      expect(output).toContain('L3')
    })
  })

  describe('formatSummary includes line ranges', () => {
    it('shows line range for each section', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test',
        originalTokens: 500,
        summaryTokens: 50,
        compressionRatio: 0.9,
        sections: [
          sec('Setup', 2, {
            startLine: 3,
            endLine: 25,
            summary: 'Setup instructions.',
          }),
          sec('Usage', 2, {
            startLine: 27,
            endLine: 80,
            summary: 'Usage guide.',
          }),
        ],
        keyTopics: [],
      }

      const output = formatSummary(mockSummary)

      expect(output).toContain('[L3-25]')
      expect(output).toContain('[L27-80]')
    })
  })

  describe('edge cases', () => {
    it('handles empty sections array', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Empty',
        originalTokens: 100,
        summaryTokens: 0,
        compressionRatio: 1.0,
        sections: [],
        keyTopics: [],
      }

      const output = formatSummary(mockSummary)
      expect(output).toContain('# Empty')
    })

    it('handles section with empty summary', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test',
        originalTokens: 100,
        summaryTokens: 10,
        compressionRatio: 0.9,
        sections: [sec('Empty', 2, { summaryTokens: 5 })],
        keyTopics: [],
      }

      const output = formatSummary(mockSummary)
      expect(output).toContain('## Empty')
    })

    it('handles unicode characters in path and title', () => {
      const mockSummary: DocumentSummary = {
        path: '/docs/日本語/ファイル.md',
        title: '日本語のドキュメント',
        originalTokens: 200,
        summaryTokens: 50,
        compressionRatio: 0.75,
        sections: [
          sec('セクション', 2, {
            summaryTokens: 20,
            summary: 'コンテンツ。',
          }),
        ],
        keyTopics: ['日本語'],
      }

      const output = formatSummary(mockSummary)
      expect(output).toContain('日本語のドキュメント')
      expect(output).toContain('セクション')
    })

    it('handles long file paths', () => {
      const mockSummary: DocumentSummary = {
        path: '/very/long/path/to/some/deeply/nested/directory/structure/file.md',
        title: 'A Very Long Document Title That Takes Up Many Tokens',
        originalTokens: 1000,
        summaryTokens: 100,
        compressionRatio: 0.9,
        sections: [],
        keyTopics: [
          'topic1',
          'topic2',
          'topic3',
          'topic4',
          'topic5',
          'another-long-topic',
        ],
      }

      const output = formatSummary(mockSummary)
      expect(output).toContain('A Very Long Document Title')
      expect(output).toContain('**Topics:**')
    })
  })
})
