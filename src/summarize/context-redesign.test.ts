/**
 * Tests for the context command redesign
 *
 * Validates the orthogonal level/budget system:
 * - Level (brief/summary/full) controls density per section
 * - Budget (tokens) controls total space for multi-file assembly
 * - Single-file mode ignores budget
 * - assembleContext packs in input order with brief fallback
 */

import { Effect } from 'effect'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatSummary } from './formatters.js'
import {
  assembleContext,
  summarizeFile,
  type CompressionLevel,
  type SectionSummary,
} from './summarizer.js'

const FIXTURES_DIR = path.join(process.cwd(), 'tests/fixtures/cli')
const README = path.join(FIXTURES_DIR, 'README.md')
const API_REF = path.join(FIXTURES_DIR, 'api-reference.md')
const GETTING_STARTED = path.join(FIXTURES_DIR, 'getting-started.md')

// ============================================================================
// summarizeFile: level controls density, no budget
// ============================================================================

describe('summarizeFile produces all sections at every level', () => {
  const levels: CompressionLevel[] = ['brief', 'summary', 'full']

  for (const level of levels) {
    it(`${level}: includes every section without truncation`, async () => {
      const result = await Effect.runPromise(
        summarizeFile(README, { level }),
      )

      // Should have sections
      expect(result.sections.length).toBeGreaterThan(0)

      // Should have no truncation fields (they were removed from the type)
      expect(result).not.toHaveProperty('truncated')
      expect(result).not.toHaveProperty('truncatedCount')
    })
  }

  it('brief produces smaller output than summary', async () => {
    const [brief, summary] = await Promise.all([
      Effect.runPromise(summarizeFile(README, { level: 'brief' })),
      Effect.runPromise(summarizeFile(README, { level: 'summary' })),
    ])

    expect(brief.summaryTokens).toBeLessThanOrEqual(summary.summaryTokens)
  })

  it('summary produces smaller output than full', async () => {
    const [summary, full] = await Promise.all([
      Effect.runPromise(summarizeFile(README, { level: 'summary' })),
      Effect.runPromise(summarizeFile(README, { level: 'full' })),
    ])

    expect(summary.summaryTokens).toBeLessThanOrEqual(full.summaryTokens)
  })

  it('defaults to brief level', async () => {
    const [defaultResult, briefResult] = await Promise.all([
      Effect.runPromise(summarizeFile(README, {})),
      Effect.runPromise(summarizeFile(README, { level: 'brief' })),
    ])

    // Default should match brief
    expect(defaultResult.summaryTokens).toBe(briefResult.summaryTokens)
    expect(defaultResult.sections.length).toBe(briefResult.sections.length)
  })
})

// ============================================================================
// formatSummary: no budget, includes line ranges
// ============================================================================

describe('formatSummary includes line ranges', () => {
  it('shows line ranges for each section in formatted output', async () => {
    const result = await Effect.runPromise(
      summarizeFile(README, { level: 'brief' }),
    )

    const output = formatSummary(result)

    // Should contain line range markers like [L1-20]
    expect(output).toMatch(/\[L\d+-\d+\]/)

    // Every section should have a line range
    const lineRangeCount = (output.match(/\[L\d+-\d+\]/g) || []).length
    const sectionCount = countSections(result.sections)
    expect(lineRangeCount).toBe(sectionCount)
  })

  it('line ranges are valid (start <= end, positive)', async () => {
    const result = await Effect.runPromise(
      summarizeFile(README, { level: 'brief' }),
    )

    const validateSection = (section: SectionSummary) => {
      expect(section.startLine).toBeGreaterThan(0)
      expect(section.endLine).toBeGreaterThanOrEqual(section.startLine)
      for (const child of section.children) {
        validateSection(child)
      }
    }

    for (const section of result.sections) {
      validateSection(section)
    }
  })
})

// ============================================================================
// assembleContext: budget controls space, input order preserved
// ============================================================================

describe('assembleContext budget and ordering', () => {
  it('packs files in input order', async () => {
    const result = await Effect.runPromise(
      assembleContext(FIXTURES_DIR, [README, API_REF, GETTING_STARTED], {
        budget: 10000,
        level: 'brief',
      }),
    )

    // All files should fit in a generous budget
    expect(result.sources).toHaveLength(3)
    expect(result.overflow).toHaveLength(0)

    // Order should match input order
    expect(result.sources[0]!.path).toBe('README.md')
    expect(result.sources[1]!.path).toBe('api-reference.md')
    expect(result.sources[2]!.path).toBe('getting-started.md')
  })

  it('respects input order (reversed)', async () => {
    const result = await Effect.runPromise(
      assembleContext(
        FIXTURES_DIR,
        [GETTING_STARTED, API_REF, README],
        { budget: 10000, level: 'brief' },
      ),
    )

    expect(result.sources[0]!.path).toBe('getting-started.md')
    expect(result.sources[1]!.path).toBe('api-reference.md')
    expect(result.sources[2]!.path).toBe('README.md')
  })

  it('stays within token budget', async () => {
    const budgets = [200, 500, 1000, 2000]

    for (const budget of budgets) {
      const result = await Effect.runPromise(
        assembleContext(
          FIXTURES_DIR,
          [README, API_REF, GETTING_STARTED],
          { budget, level: 'brief' },
        ),
      )

      expect(result.totalTokens).toBeLessThanOrEqual(budget)
    }
  })

  it('monotonic: larger budgets include at least as many files', async () => {
    const run = (budget: number) =>
      Effect.runPromise(
        assembleContext(
          FIXTURES_DIR,
          [README, API_REF, GETTING_STARTED],
          { budget, level: 'brief' },
        ),
      )

    const [small, large] = await Promise.all([run(200), run(5000)])

    expect(large.sources.length).toBeGreaterThanOrEqual(small.sources.length)
  })

  it('overflows files that do not fit', async () => {
    // Very tight budget: should overflow some files
    const result = await Effect.runPromise(
      assembleContext(
        FIXTURES_DIR,
        [README, API_REF, GETTING_STARTED],
        { budget: 50, level: 'brief' },
      ),
    )

    // With budget of 50, at least some files should overflow
    expect(result.overflow.length).toBeGreaterThan(0)
    expect(result.totalTokens).toBeLessThanOrEqual(50)
  })

  it('retries at brief when summary does not fit', async () => {
    // Use summary level with a tight budget
    const summaryResult = await Effect.runPromise(
      assembleContext(
        FIXTURES_DIR,
        [README, API_REF, GETTING_STARTED],
        { budget: 500, level: 'summary' },
      ),
    )

    // The assembler should have attempted brief fallback for files that
    // didn't fit at summary level
    expect(summaryResult.totalTokens).toBeLessThanOrEqual(500)
  })

  it('does not retry brief fallback when already at brief level', async () => {
    const briefResult = await Effect.runPromise(
      assembleContext(
        FIXTURES_DIR,
        [README, API_REF, GETTING_STARTED],
        { budget: 100, level: 'brief' },
      ),
    )

    // At brief level, files that don't fit go straight to overflow
    expect(briefResult.totalTokens).toBeLessThanOrEqual(100)
    // Total sources + overflow should equal input count
    expect(
      briefResult.sources.length + briefResult.overflow.length,
    ).toBe(3)
  })

  it('handles non-existent files gracefully', async () => {
    const result = await Effect.runPromise(
      assembleContext(
        FIXTURES_DIR,
        [README, '/nonexistent/file.md', GETTING_STARTED],
        { budget: 5000, level: 'brief' },
      ),
    )

    // Non-existent file should be in overflow (error), others should succeed
    expect(result.sources.length).toBe(2)
    expect(result.overflow).toContain('/nonexistent/file.md')
  })
})

// ============================================================================
// Level density ordering: brief < summary < full
// ============================================================================

describe('level density ordering across real files', () => {
  it('brief <= summary <= full token counts for each file', async () => {
    const files = [README, API_REF, GETTING_STARTED]

    for (const file of files) {
      const [brief, summary, full] = await Promise.all([
        Effect.runPromise(summarizeFile(file, { level: 'brief' })),
        Effect.runPromise(summarizeFile(file, { level: 'summary' })),
        Effect.runPromise(summarizeFile(file, { level: 'full' })),
      ])

      expect(brief.summaryTokens).toBeLessThanOrEqual(
        summary.summaryTokens,
      )
      expect(summary.summaryTokens).toBeLessThanOrEqual(
        full.summaryTokens,
      )
    }
  })
})

// ============================================================================
// Edge case matrix from the spec
// ============================================================================

describe('edge case matrix', () => {
  it('single file with no options uses brief', async () => {
    const result = await Effect.runPromise(summarizeFile(README))
    const briefResult = await Effect.runPromise(
      summarizeFile(README, { level: 'brief' }),
    )

    expect(result.summaryTokens).toBe(briefResult.summaryTokens)
  })

  it('exclude option filters sections', async () => {
    const withExclude = await Effect.runPromise(
      summarizeFile(README, {
        level: 'brief',
        exclude: ['*'],
      }),
    )

    // Excluding all sections should result in no sections
    expect(withExclude.sections).toHaveLength(0)
  })

  it('full level multi-file with large budget includes everything', async () => {
    const result = await Effect.runPromise(
      assembleContext(
        FIXTURES_DIR,
        [README, API_REF, GETTING_STARTED],
        { budget: 100000, level: 'full' },
      ),
    )

    expect(result.sources).toHaveLength(3)
    expect(result.overflow).toHaveLength(0)
  })
})

// ============================================================================
// Helpers
// ============================================================================

function countSections(sections: readonly SectionSummary[]): number {
  let count = 0
  for (const section of sections) {
    count++
    count += countSections(section.children)
  }
  return count
}
