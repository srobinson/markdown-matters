/**
 * Token estimation accuracy tests
 *
 * Validates that countTokensApprox never under-counts vs tiktoken,
 * and stays within a reasonable range.
 */

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { countTokens, countTokensApprox } from '../utils/tokens.js'
import { formatSummary } from './formatters.js'
import type { DocumentSummary } from './summarizer.js'

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

      // Approximation must never be less than actual (under-counting causes budget violations)
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
        {
          heading: 'Section 2',
          level: 2,
          originalTokens: 100,
          summaryTokens: 20,
          summary: 'More content.',
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

    const output = formatSummary(mockSummary)

    // All sections should be present
    expect(output).toContain('Section 1')
    expect(output).toContain('Section 2')
    expect(output).toContain('Some content.')
    expect(output).toContain('More content.')

    // No truncation warning
    expect(output).not.toContain('Truncated')
    expect(output).not.toContain('⚠️')

    // Topics should be present
    expect(output).toContain('**Topics:**')
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
