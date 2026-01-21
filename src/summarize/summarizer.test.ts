/**
 * Tests for summarization engine
 *
 * Focuses on token count accuracy - ensuring displayed counts match actual output
 */

import { describe, expect, it } from 'vitest'
import { countTokensApprox } from '../utils/tokens.js'
import { formatSummary } from './formatters.js'
import type { DocumentSummary, SectionSummary } from './summarizer.js'

describe('summarizer token counting', () => {
  describe('formatSummary token accuracy', () => {
    it('displays token count matching actual output', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test Document',
        originalTokens: 1000,
        summaryTokens: 100, // This is the pre-format count
        compressionRatio: 0.9,
        sections: [
          {
            heading: 'Section 1',
            level: 2,
            originalTokens: 500,
            summaryTokens: 50,
            summary: 'This is the summary of section 1.',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: ['topic1', 'topic2'],
      }

      const output = formatSummary(mockSummary)

      // Extract the displayed token count
      const tokenMatch = output.match(/Tokens: (\d+)/)
      expect(tokenMatch).toBeTruthy()
      const displayedTokens = parseInt(tokenMatch![1]!, 10)

      // Count actual tokens in the output
      const actualTokens = countTokensApprox(output)

      // The displayed count should be close to actual (within 10%)
      // Note: The token line itself adds tokens, so we allow some margin
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

      // Should not contain Topics line
      expect(output).not.toContain('**Topics:**')

      // Token count should still be accurate
      const tokenMatch = output.match(/Tokens: (\d+)/)
      expect(tokenMatch).toBeTruthy()
      const displayedTokens = parseInt(tokenMatch![1]!, 10)
      const actualTokens = countTokensApprox(output)

      expect(Math.abs(displayedTokens - actualTokens)).toBeLessThan(5)
    })

    it('handles nested sections', () => {
      const childSection: SectionSummary = {
        heading: 'Child Section',
        level: 3,
        originalTokens: 100,
        summaryTokens: 20,
        summary: 'Child summary content.',
        children: [],
        hasCode: true,
        hasList: false,
        hasTable: false,
      }

      const mockSummary: DocumentSummary = {
        path: '/test/nested.md',
        title: 'Nested Document',
        originalTokens: 500,
        summaryTokens: 100,
        compressionRatio: 0.8,
        sections: [
          {
            heading: 'Parent Section',
            level: 2,
            originalTokens: 300,
            summaryTokens: 60,
            summary: 'Parent summary content.',
            children: [childSection],
            hasCode: false,
            hasList: true,
            hasTable: false,
          },
        ],
        keyTopics: ['parent', 'child'],
      }

      const output = formatSummary(mockSummary)

      // Verify structure is present
      expect(output).toContain('## Parent Section')
      expect(output).toContain('### Child Section')

      // Token count should still be accurate
      const tokenMatch = output.match(/Tokens: (\d+)/)
      expect(tokenMatch).toBeTruthy()
      const displayedTokens = parseInt(tokenMatch![1]!, 10)
      const actualTokens = countTokensApprox(output)

      // Allow slightly more tolerance for nested content
      const tolerance = Math.max(actualTokens * 0.15, 5)
      expect(Math.abs(displayedTokens - actualTokens)).toBeLessThan(tolerance)
    })

    it('includes compression ratio in output', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test',
        originalTokens: 1000,
        summaryTokens: 200,
        compressionRatio: 0.8, // 80% reduction
        sections: [],
        keyTopics: [],
      }

      const output = formatSummary(mockSummary)

      // Should show 80% reduction
      expect(output).toContain('80% reduction')
      expect(output).toContain('from 1000')
    })

    it('respects maxTokens budget', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test Document',
        originalTokens: 1000,
        summaryTokens: 500,
        compressionRatio: 0.5,
        sections: [
          {
            heading: 'Section 1',
            level: 2,
            originalTokens: 200,
            summaryTokens: 100,
            summary:
              'This is a longer summary that contains many words to test token budget enforcement.',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
          {
            heading: 'Section 2',
            level: 2,
            originalTokens: 200,
            summaryTokens: 100,
            summary: 'Another section with substantial content for testing.',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: ['test', 'budget'],
      }

      const output = formatSummary(mockSummary, { maxTokens: 100 })
      const actualTokens = countTokensApprox(output)

      // Output should stay within budget
      expect(actualTokens).toBeLessThanOrEqual(100)
    })

    it('shows truncation warning when sections are omitted', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test',
        originalTokens: 1000,
        summaryTokens: 500,
        compressionRatio: 0.5,
        sections: [
          {
            heading: 'Section 1',
            level: 2,
            originalTokens: 200,
            summaryTokens: 100,
            summary: 'Long content '.repeat(50),
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [],
      }

      // Increased budget to account for enhanced truncation warning with section lists
      const output = formatSummary(mockSummary, { maxTokens: 150 })

      // Should show truncation warning (lowercase in new format)
      expect(output).toContain('Truncated')
    })
  })

  describe('token budget edge cases', () => {
    it('handles very tight budget gracefully', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test',
        originalTokens: 100,
        summaryTokens: 50,
        compressionRatio: 0.5,
        sections: [
          {
            heading: 'Section',
            level: 2,
            originalTokens: 50,
            summaryTokens: 25,
            summary: 'Content',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [],
      }

      // Should not throw with very tight budget
      const output = formatSummary(mockSummary, { maxTokens: 30 })
      expect(output).toBeTruthy()
    })

    it('handles long file paths in overhead calculation', () => {
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

      const output = formatSummary(mockSummary, { maxTokens: 200 })
      const actualTokens = countTokensApprox(output)

      // Should stay within budget even with long paths/titles
      expect(actualTokens).toBeLessThanOrEqual(200)
    })
  })
})
