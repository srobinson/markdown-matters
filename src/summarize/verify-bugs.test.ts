/**
 * Token estimation accuracy tests and formatSummary completeness verification
 */

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { countTokens, countTokensApprox } from '../utils/tokens.js'
import { formatSummary } from './formatters.js'
import type { DocumentSummary, SectionSummary } from './summarizer.js'

/** Helper to create a SectionSummary with defaults */
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

describe('token estimation accuracy', () => {
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
      expect(approx).toBeLessThanOrEqual(actual * 2)
    }
  })
})

describe('formatSummary produces complete output', () => {
  it('includes all sections without any truncation', () => {
    const mockSummary: DocumentSummary = {
      path: '/very/long/path/to/some/deeply/nested/directory/structure/with/many/segments/file.md',
      title:
        'A Document With A Very Long Title That Takes Up Many Tokens In The Output',
      originalTokens: 2000,
      summaryTokens: 100,
      compressionRatio: 0.95,
      sections: [
        sec('Section 1', 2, {
          startLine: 3,
          endLine: 40,
          summaryTokens: 20,
          summary: 'Some content.',
        }),
        sec('Section 2', 2, {
          startLine: 42,
          endLine: 80,
          summaryTokens: 20,
          summary: 'More content.',
        }),
      ],
      keyTopics: [
        'topic1',
        'topic2',
        'topic3',
        'another-very-long-topic-name',
        'yet-another-long-topic',
      ],
    }

    const output = formatSummary(mockSummary)

    expect(output).toContain('Section 1')
    expect(output).toContain('Section 2')
    expect(output).toContain('Some content.')
    expect(output).toContain('More content.')
    expect(output).not.toContain('Truncated')
    expect(output).not.toContain('⚠️')
    expect(output).toContain('**Topics:**')
  })

  it('includes line ranges for every section', () => {
    const mockSummary: DocumentSummary = {
      path: '/test/file.md',
      title: 'Line Range Test',
      originalTokens: 500,
      summaryTokens: 50,
      compressionRatio: 0.9,
      sections: [
        sec('Introduction', 2, {
          startLine: 1,
          endLine: 20,
          summary: 'Intro.',
        }),
        sec('Details', 2, {
          startLine: 22,
          endLine: 100,
          summary: 'Details.',
          children: [
            sec('Sub-detail', 3, {
              startLine: 40,
              endLine: 65,
              summary: 'Sub.',
            }),
          ],
        }),
      ],
      keyTopics: [],
    }

    const output = formatSummary(mockSummary)

    expect(output).toContain('[L1-20]')
    expect(output).toContain('[L22-100]')
    expect(output).toContain('[L40-65]')
  })

  it('includes token count and compression ratio', () => {
    const mockSummary: DocumentSummary = {
      path: '/test/file.md',
      title: 'Test Document',
      originalTokens: 500,
      summaryTokens: 50,
      compressionRatio: 0.9,
      sections: [],
      keyTopics: [],
    }

    const output = formatSummary(mockSummary)
    expect(output).toContain('90% reduction')
    expect(output).toContain('from 500')
  })
})
