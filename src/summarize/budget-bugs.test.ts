import { describe, expect, it } from 'vitest'
import { formatSummary } from './formatters.js'
import { countTokensApprox } from '../utils/tokens.js'
import type { DocumentSummary } from './summarizer.js'

describe('token budget enforcement', () => {
  describe('orphan rescue - children included when parent too large', () => {
    it('rescues children when parent section is too large for budget', () => {
      // Large parent that won't fit, but small children that would
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test',
        originalTokens: 1000,
        summaryTokens: 500,
        compressionRatio: 0.5,
        sections: [
          {
            heading: 'Large Parent',
            level: 2,
            originalTokens: 500,
            summaryTokens: 200,
            summary: 'Very large parent content. '.repeat(50), // ~1000 chars = ~250 tokens
            children: [
              {
                heading: 'Small Child A',
                level: 3,
                originalTokens: 20,
                summaryTokens: 10,
                summary: 'Tiny child A.',
                children: [],
                hasCode: false,
                hasList: false,
                hasTable: false,
              },
              {
                heading: 'Small Child B',
                level: 3,
                originalTokens: 20,
                summaryTokens: 10,
                summary: 'Tiny child B.',
                children: [],
                hasCode: false,
                hasList: false,
                hasTable: false,
              },
            ],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [],
      }

      // Budget that can't fit parent but can fit children
      const output = formatSummary(mockSummary, { maxTokens: 100 })

      // Children should be rescued and included even though parent was skipped
      expect(output).toContain('Small Child A')
      expect(output).toContain('Small Child B')
      // Parent should NOT be included (too large)
      expect(output).not.toContain('Large Parent')
      expect(output).not.toContain('Very large parent content')
    })

    it('preserves hierarchy when parent fits but some children do not', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test',
        originalTokens: 500,
        summaryTokens: 200,
        compressionRatio: 0.6,
        sections: [
          {
            heading: 'Parent',
            level: 2,
            originalTokens: 100,
            summaryTokens: 20,
            summary: 'Short parent.',
            children: [
              {
                heading: 'Child Fits',
                level: 3,
                originalTokens: 20,
                summaryTokens: 10,
                summary: 'Small.',
                children: [],
                hasCode: false,
                hasList: false,
                hasTable: false,
              },
              {
                heading: 'Child Too Large',
                level: 3,
                originalTokens: 300,
                summaryTokens: 150,
                summary: 'Very long child. '.repeat(30),
                children: [],
                hasCode: false,
                hasList: false,
                hasTable: false,
              },
            ],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [],
      }

      // Budget increased to account for more conservative token counting
      const output = formatSummary(mockSummary, { maxTokens: 120 })

      // Parent and first child should be included
      expect(output).toContain('Parent')
      expect(output).toContain('Child Fits')
      // Large child should be truncated
      expect(output).not.toContain('Child Too Large')
    })
  })

  it('includes sections greedily up to budget', () => {
    const mockSummary = {
      path: '/test/file.md',
      title: 'Test Document',
      originalTokens: 1000,
      summaryTokens: 500,
      compressionRatio: 0.5,
      sections: [
        {
          heading: 'Introduction',
          level: 2,
          originalTokens: 200,
          summaryTokens: 100,
          summary: 'Short intro.',
          children: [
            {
              heading: 'Subsection A',
              level: 3,
              originalTokens: 50,
              summaryTokens: 20,
              summary: 'Small subsection A.',
              children: [],
              hasCode: false,
              hasList: false,
              hasTable: false,
            },
            {
              heading: 'Subsection B',
              level: 3,
              originalTokens: 50,
              summaryTokens: 20,
              summary: 'Small subsection B.',
              children: [],
              hasCode: false,
              hasList: false,
              hasTable: false,
            },
          ],
          hasCode: false,
          hasList: false,
          hasTable: false,
        },
      ],
      keyTopics: ['topic1', 'topic2'],
    }

    // Budget should fit header + all sections with small content
    const output = formatSummary(mockSummary, { maxTokens: 150 })

    // All sections should be included since they're small
    expect(output).toContain('Introduction')
    expect(output).toContain('Subsection A')
    expect(output).toContain('Subsection B')
  })

  it('stays within budget for long paths and titles', () => {
    const mockSummary = {
      path: '/very/long/path/to/deeply/nested/directory/structure/that/keeps/going/file.md',
      title: 'A Very Long Document Title That Uses Significantly More Tokens Than Expected',
      originalTokens: 1000,
      summaryTokens: 100,
      compressionRatio: 0.9,
      sections: [
        {
          heading: 'Section',
          level: 2,
          originalTokens: 100,
          summaryTokens: 50,
          summary: 'Some content.',
          children: [],
          hasCode: false,
          hasList: false,
          hasTable: false,
        },
      ],
      keyTopics: ['topic1', 'topic2', 'topic3', 'topic4', 'topic5', 'long-topic-name'],
    }

    const output = formatSummary(mockSummary, { maxTokens: 100 })
    const actualTokens = countTokensApprox(output)

    // Output should stay within budget
    expect(actualTokens).toBeLessThanOrEqual(100)
  })

  it('drops topics when header overhead exceeds budget', () => {
    const mockSummary = {
      path: '/very/long/path/file.md',
      title: 'Long Title Here',
      originalTokens: 1000,
      summaryTokens: 100,
      compressionRatio: 0.9,
      sections: [],
      keyTopics: ['topic1', 'topic2', 'topic3', 'topic4'],
    }

    // Very tight budget - should drop topics to make room
    const output = formatSummary(mockSummary, { maxTokens: 50 })

    // With tight budget, topics may be dropped to fit
    const actualTokens = countTokensApprox(output)
    expect(actualTokens).toBeLessThanOrEqual(50)
  })

  describe('strict budget enforcement', () => {
    it('never exceeds specified token budget when budget is achievable', () => {
      // Test with realistic budgets - the minimum header for this document is ~60 tokens
      // (long path + long title + token line + truncation warning)
      // So we test budgets that should be achievable
      const budgets = [75, 100, 150, 200, 300, 500]

      for (const budget of budgets) {
        const mockSummary: DocumentSummary = {
          path: '/project/src/components/deeply/nested/component.tsx',
          title: 'A Component With A Moderately Long Title',
          originalTokens: 2000,
          summaryTokens: 800,
          compressionRatio: 0.6,
          sections: [
            {
              heading: 'Overview',
              level: 2,
              originalTokens: 200,
              summaryTokens: 80,
              summary: 'This component handles user authentication and session management with proper error handling.',
              children: [
                {
                  heading: 'Props',
                  level: 3,
                  originalTokens: 100,
                  summaryTokens: 40,
                  summary: 'Accepts user object, onLogin callback, and configuration options.',
                  children: [],
                  hasCode: true,
                  hasList: false,
                  hasTable: false,
                },
              ],
              hasCode: false,
              hasList: false,
              hasTable: false,
            },
            {
              heading: 'Implementation',
              level: 2,
              originalTokens: 300,
              summaryTokens: 120,
              summary: 'Uses React hooks for state management. Implements OAuth2 flow with PKCE.',
              children: [],
              hasCode: true,
              hasList: true,
              hasTable: false,
            },
          ],
          keyTopics: ['react', 'authentication', 'oauth', 'hooks', 'security'],
        }

        const output = formatSummary(mockSummary, { maxTokens: budget })
        const actualTokens = countTokensApprox(output)

        expect(actualTokens).toBeLessThanOrEqual(budget)
      }
    })

    it('handles tight budgets with short paths gracefully', () => {
      // With a short path and title, we can achieve tighter budgets
      // Minimum header for this doc is roughly:
      // "# X\nPath: x\nTokens: XX (Y% reduction from Z)\n\n" ~= 20-25 tokens
      const mockSummary: DocumentSummary = {
        path: 'x',
        title: 'X',
        originalTokens: 100,
        summaryTokens: 50,
        compressionRatio: 0.5,
        sections: [
          {
            heading: 'S',
            level: 2,
            originalTokens: 50,
            summaryTokens: 25,
            summary: 'Text.',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [],
      }

      // Test with a budget that should definitely fit the minimal header
      const output = formatSummary(mockSummary, { maxTokens: 40 })
      const actualTokens = countTokensApprox(output)

      expect(actualTokens).toBeLessThanOrEqual(40)
    })

    it('stays within budget even with code-heavy content', () => {
      const mockSummary: DocumentSummary = {
        path: '/src/utils/parser.ts',
        title: 'Parser Utilities',
        originalTokens: 1500,
        summaryTokens: 600,
        compressionRatio: 0.6,
        sections: [
          {
            heading: 'Functions',
            level: 2,
            originalTokens: 500,
            summaryTokens: 200,
            summary: '```typescript\nfunction parse(input: string): AST {\n  const tokens = tokenize(input);\n  return buildTree(tokens);\n}\n```',
            children: [],
            hasCode: true,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: ['parser', 'ast', 'typescript'],
      }

      const output = formatSummary(mockSummary, { maxTokens: 100 })
      const actualTokens = countTokensApprox(output)

      expect(actualTokens).toBeLessThanOrEqual(100)
    })
  })

  describe('deeply nested content', () => {
    it('handles 3+ levels of nesting with orphan rescue', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Deep',
        originalTokens: 1000,
        summaryTokens: 500,
        compressionRatio: 0.5,
        sections: [
          {
            heading: 'Large L1',
            level: 2,
            originalTokens: 400,
            summaryTokens: 200,
            summary: 'Large level 1 content. '.repeat(40),
            children: [
              {
                heading: 'Large L2',
                level: 3,
                originalTokens: 200,
                summaryTokens: 100,
                summary: 'Large level 2 content. '.repeat(20),
                children: [
                  {
                    heading: 'Small L3',
                    level: 4,
                    originalTokens: 20,
                    summaryTokens: 10,
                    summary: 'Small.',
                    children: [],
                    hasCode: false,
                    hasList: false,
                    hasTable: false,
                  },
                ],
                hasCode: false,
                hasList: false,
                hasTable: false,
              },
            ],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [],
      }

      const output = formatSummary(mockSummary, { maxTokens: 80 })

      // Deepest child should still be rescued
      expect(output).toContain('Small L3')
      // Large ancestors should be skipped
      expect(output).not.toContain('Large L1')
      expect(output).not.toContain('Large L2')
      // And stay within budget
      expect(countTokensApprox(output)).toBeLessThanOrEqual(80)
    })

    it('includes multiple siblings when all fit', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Siblings',
        originalTokens: 500,
        summaryTokens: 200,
        compressionRatio: 0.6,
        sections: [
          {
            heading: 'A',
            level: 2,
            originalTokens: 30,
            summaryTokens: 10,
            summary: 'Content A.',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
          {
            heading: 'B',
            level: 2,
            originalTokens: 30,
            summaryTokens: 10,
            summary: 'Content B.',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
          {
            heading: 'C',
            level: 2,
            originalTokens: 30,
            summaryTokens: 10,
            summary: 'Content C.',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [],
      }

      const output = formatSummary(mockSummary, { maxTokens: 100 })

      // All small sections should fit
      expect(output).toContain('A')
      expect(output).toContain('B')
      expect(output).toContain('C')
      expect(countTokensApprox(output)).toBeLessThanOrEqual(100)
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

      const output = formatSummary(mockSummary, { maxTokens: 50 })
      expect(output).toContain('# Empty')
      expect(countTokensApprox(output)).toBeLessThanOrEqual(50)
    })

    it('handles section with empty summary', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test',
        originalTokens: 100,
        summaryTokens: 10,
        compressionRatio: 0.9,
        sections: [
          {
            heading: 'Empty',
            level: 2,
            originalTokens: 10,
            summaryTokens: 5,
            summary: '',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [],
      }

      // Use larger budget so section fits (increased for conservative token counting)
      const output = formatSummary(mockSummary, { maxTokens: 80 })
      expect(output).toContain('## Empty')
      expect(countTokensApprox(output)).toBeLessThanOrEqual(80)
    })

    it('handles unicode characters in path and title', () => {
      const mockSummary: DocumentSummary = {
        path: '/docs/日本語/ファイル.md',
        title: '日本語のドキュメント',
        originalTokens: 200,
        summaryTokens: 50,
        compressionRatio: 0.75,
        sections: [
          {
            heading: 'セクション',
            level: 2,
            originalTokens: 50,
            summaryTokens: 20,
            summary: 'コンテンツ。',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: ['日本語'],
      }

      const output = formatSummary(mockSummary, { maxTokens: 100 })
      expect(output).toContain('日本語のドキュメント')
      expect(countTokensApprox(output)).toBeLessThanOrEqual(100)
    })

    it('drops truncation warning when budget is very tight', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Short Title',
        originalTokens: 500,
        summaryTokens: 200,
        compressionRatio: 0.6,
        sections: [
          {
            heading: 'Large Section',
            level: 2,
            originalTokens: 400,
            summaryTokens: 150,
            summary: 'Large content that will be truncated. '.repeat(20),
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [],
      }

      // Very tight budget that can fit header but not with truncation warning
      // Increased to account for more conservative token counting
      const output = formatSummary(mockSummary, { maxTokens: 35 })

      // Should stay within budget
      expect(countTokensApprox(output)).toBeLessThanOrEqual(35)
      // Should NOT contain truncation warning (dropped to fit)
      expect(output).not.toContain('TRUNCATED')
    })

    it('shows truncation warning when budget allows', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Short Title',
        originalTokens: 500,
        summaryTokens: 200,
        compressionRatio: 0.6,
        sections: [
          {
            heading: 'Large Section',
            level: 2,
            originalTokens: 400,
            summaryTokens: 150,
            summary: 'Large content that will be truncated. '.repeat(20),
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [],
      }

      // Larger budget that can fit header AND truncation warning
      // Increased to account for more conservative token counting
      const output = formatSummary(mockSummary, { maxTokens: 70 })

      // Should stay within budget
      expect(countTokensApprox(output)).toBeLessThanOrEqual(70)
      // Should contain truncation warning (enough room)
      expect(output).toContain('TRUNCATED')
    })
  })
})
