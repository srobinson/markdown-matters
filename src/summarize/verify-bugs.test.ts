/**
 * Verification tests for the three token budget bugs
 *
 * Bug 1: Orphaned children - if parent is truncated, children are lost
 * Bug 2: Token estimation inaccuracy - 4 chars/token can be ±30% off
 * Bug 3: Formatting overhead under-estimated - 50 token reserve insufficient
 */

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { countTokens, countTokensApprox } from '../utils/tokens.js'
import { formatSummary } from './formatters.js'
import type { DocumentSummary } from './summarizer.js'

describe('verify token budget bugs', () => {
  describe('Bug 1: Orphaned children', () => {
    it('should rescue children when parent is too large', () => {
      // Create a parent with a very large summary that won't fit budget
      // but with small children that would fit
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test',
        originalTokens: 1000,
        summaryTokens: 500,
        compressionRatio: 0.5,
        sections: [
          {
            heading: 'Huge Parent',
            level: 2,
            originalTokens: 500,
            summaryTokens: 400,
            summary: 'Large content '.repeat(100), // ~400 tokens
            children: [
              {
                heading: 'Tiny Child',
                level: 3,
                originalTokens: 20,
                summaryTokens: 5,
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
        keyTopics: [],
      }

      // Budget can't fit parent (~400 tokens) but can fit child (~5 tokens)
      // Increased to account for enhanced truncation warning with section lists
      const output = formatSummary(mockSummary, { maxTokens: 180 })

      // Child should be rescued even though parent doesn't fit
      expect(output).toContain('Tiny Child')
      // Parent should NOT be included
      expect(output).not.toContain('Huge Parent')
      expect(output).not.toContain('Large content')
    })
  })

  describe('Bug 2: Token estimation accuracy', () => {
    it('approximation should never under-count vs tiktoken', async () => {
      const testCases = [
        'Hello world, this is a simple test.',
        '```typescript\nfunction foo() { return 42; }\n```',
        '/very/long/path/to/deeply/nested/directory/structure/file.md',
        '# Title\n\nSome prose with `code` and path /src/utils.ts.\n\n```js\nconst x = 1;\n```',
        'Hello, world! How are you? Fine, thanks... Well: good! (Yes, really.)',
        '这是中文文本测试。',
        '👋 Hello 🌍 World 🎉',
      ]

      for (const text of testCases) {
        const approx = countTokensApprox(text)
        const actual = await Effect.runPromise(countTokens(text))

        // CRITICAL: Approximation must NEVER be less than actual
        // Under-counting causes budget violations
        expect(approx).toBeGreaterThanOrEqual(actual)
      }
    })

    it('approximation should be reasonably close (within 2x)', async () => {
      const testCases = [
        'Hello world, this is a simple test.',
        '```typescript\nfunction foo() { return 42; }\n```',
        '/very/long/path/to/deeply/nested/directory/structure/file.md',
      ]

      for (const text of testCases) {
        const approx = countTokensApprox(text)
        const actual = await Effect.runPromise(countTokens(text))

        // Should not be more than 2x over-estimate
        expect(approx).toBeLessThanOrEqual(actual * 2)
      }
    })
  })

  describe('Bug 3: Formatting overhead', () => {
    it('output should stay within budget even with long paths', () => {
      const mockSummary: DocumentSummary = {
        path: '/very/long/path/to/some/deeply/nested/directory/structure/with/many/segments/file.md',
        title:
          'A Document With A Very Long Title That Takes Up Many Tokens In The Output',
        originalTokens: 2000,
        summaryTokens: 100,
        compressionRatio: 0.95,
        sections: [
          {
            heading: 'Section 1',
            level: 2,
            originalTokens: 100,
            summaryTokens: 20,
            summary: 'Some content.',
            children: [],
            hasCode: false,
            hasList: false,
            hasTable: false,
          },
        ],
        keyTopics: [
          'topic1',
          'topic2',
          'topic3',
          'another-very-long-topic-name',
          'yet-another-long-topic',
        ],
      }

      const budgets = [100, 150, 200, 300]

      for (const budget of budgets) {
        const output = formatSummary(mockSummary, { maxTokens: budget })
        const actualTokens = countTokensApprox(output)

        expect(actualTokens).toBeLessThanOrEqual(budget)
      }
    })

    it('output should stay within budget with many topics', () => {
      const mockSummary: DocumentSummary = {
        path: '/test/file.md',
        title: 'Test Document',
        originalTokens: 500,
        summaryTokens: 50,
        compressionRatio: 0.9,
        sections: [],
        keyTopics: [
          'topic-one',
          'topic-two',
          'topic-three',
          'topic-four',
          'topic-five',
          'topic-six',
          'topic-seven',
          'topic-eight',
          'topic-nine',
          'topic-ten',
        ],
      }

      const output = formatSummary(mockSummary, { maxTokens: 100 })
      const actualTokens = countTokensApprox(output)

      expect(actualTokens).toBeLessThanOrEqual(100)
    })
  })

  describe('strict budget enforcement', () => {
    it('MUST stay within budget for realistic scenarios', () => {
      const scenarios: DocumentSummary[] = [
        {
          // Scenario 1: Long path and title
          path: '/project/src/components/deeply/nested/module/submodule/component.tsx',
          title: 'A React Component With Authentication And Session Management',
          originalTokens: 2000,
          summaryTokens: 800,
          compressionRatio: 0.6,
          sections: [
            {
              heading: 'Overview',
              level: 2,
              originalTokens: 200,
              summaryTokens: 80,
              summary:
                'This component handles user authentication and session management.',
              children: [],
              hasCode: false,
              hasList: false,
              hasTable: false,
            },
          ],
          keyTopics: ['react', 'authentication', 'session', 'security'],
        },
        {
          // Scenario 2: Code-heavy content
          path: '/src/utils/parser.ts',
          title: 'Parser Utilities',
          originalTokens: 1500,
          summaryTokens: 600,
          compressionRatio: 0.6,
          sections: [
            {
              heading: 'parse',
              level: 2,
              originalTokens: 500,
              summaryTokens: 200,
              summary:
                '```typescript\nfunction parse(input: string): AST {\n  const tokens = tokenize(input);\n  return buildTree(tokens);\n}\n```',
              children: [],
              hasCode: true,
              hasList: false,
              hasTable: false,
            },
          ],
          keyTopics: ['parser', 'ast', 'typescript'],
        },
      ]

      const budgets = [100, 150, 200, 300, 500]

      for (const scenario of scenarios) {
        for (const budget of budgets) {
          const output = formatSummary(scenario, { maxTokens: budget })
          const actualTokens = countTokensApprox(output)

          expect(actualTokens).toBeLessThanOrEqual(budget)
        }
      }
    })
  })
})
