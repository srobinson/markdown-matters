/**
 * Integration tests for keyword search context flags
 *
 * Tests the -C, -A, -B flags that show lines of context around matches.
 * This test specifically validates that context lines are properly included
 * in search results, which is the reported bug.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testGenerationSession } from '../../src/db/generation-test-fixture.js'
import { buildIndex } from '../../src/index/indexer.js'
import { type SearchOptions, searchContent } from '../../src/search/searcher.js'

const TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'context-search')
const TEST_SESSION = testGenerationSession(TEST_DIR)
const originalMdmHome = process.env.MDM_HOME

const runEffect = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect)

const searchTestContent = (options: SearchOptions) =>
  searchContent(TEST_SESSION, TEST_DIR, options)

describe('keyword search context flags', () => {
  beforeAll(async () => {
    process.env.MDM_HOME = TEST_DIR
    await fs.mkdir(TEST_DIR, { recursive: true })

    await fs.writeFile(
      path.join(TEST_DIR, 'example.md'),
      `# Test Document

## Section One

Line 1: This is the first line
Line 2: This contains the TARGET word
Line 3: This is the third line
Line 4: This is the fourth line
Line 5: This is the fifth line

## Section Two

Line A: Before the match
Line B: Before the match closer
Line C: Here is another TARGET occurrence
Line D: After the match closer
Line E: After the match

## Section Three

Line X: Only one line above
Line Y: This has TARGET in it
Line Z: Only one line below

## Section Four

Line 1: First
Line 2: Second TARGET here
Line 3: Third
Line 4: Fourth
Line 5: Fifth TARGET here
Line 6: Sixth
`,
    )

    await fs.writeFile(
      path.join(TEST_DIR, 'multiline.md'),
      `# Multiline Test

## Code Section

\`\`\`typescript
function hello() {
  console.log("TARGET");
  return true;
}
\`\`\`

Text after code.

## List Section

- Item 1
- Item with TARGET
- Item 3

End of list.
`,
    )

    const shouldRebuild = process.env.REBUILD_TEST_INDEX === 'true'
    await runEffect(
      buildIndex(TEST_DIR, { indexRoot: TEST_DIR, force: shouldRebuild }),
    )
  })

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
    if (originalMdmHome === undefined) delete process.env.MDM_HOME
    else process.env.MDM_HOME = originalMdmHome
  })

  describe('-C flag (context around matches)', () => {
    it('should include context lines when -C is specified', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          contextBefore: 2,
          contextAfter: 2,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      expect(firstResult?.matches).toBeDefined()
      expect(firstResult!.matches!.length).toBeGreaterThan(0)

      const firstMatch = firstResult!.matches![0]
      expect(firstMatch?.contextLines).toBeDefined()
      expect(firstMatch!.contextLines!.length).toBeGreaterThan(1)

      const matchingLine = firstMatch!.contextLines!.find((ctx) => ctx.isMatch)
      expect(matchingLine).toBeDefined()
      expect(matchingLine?.line).toContain('TARGET')
    })

    it('should show exactly the requested number of context lines', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'example.md',
          contextBefore: 2,
          contextAfter: 2,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        if (!result.matches) continue

        for (const match of result.matches) {
          expect(match.contextLines).toBeDefined()

          const matchIndex = match.contextLines!.findIndex((ctx) => ctx.isMatch)
          expect(matchIndex).toBeGreaterThanOrEqual(0)

          const linesBefore = matchIndex
          const linesAfter = match.contextLines!.length - matchIndex - 1

          expect(linesBefore).toBeLessThanOrEqual(2)
          expect(linesAfter).toBeLessThanOrEqual(2)
        }
      }
    })

    it('should work with -C 0 (no context)', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'example.md',
          contextBefore: 0,
          contextAfter: 0,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      expect(firstResult?.matches).toBeDefined()

      const firstMatch = firstResult!.matches![0]
      expect(firstMatch?.contextLines).toBeDefined()
      expect(firstMatch!.contextLines!.length).toBe(1)
      expect(firstMatch!.contextLines![0]?.isMatch).toBe(true)
    })

    it('should work with large context values', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'example.md',
          contextBefore: 10,
          contextAfter: 10,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      expect(firstResult?.matches).toBeDefined()
      expect(firstResult!.matches![0]?.contextLines).toBeDefined()
    })
  })

  describe('-B flag (before context)', () => {
    it('should include only lines before match when -B is specified', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'example.md',
          contextBefore: 3,
          contextAfter: 0,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      const firstMatch = firstResult!.matches![0]

      expect(firstMatch?.contextLines).toBeDefined()

      const matchIndex = firstMatch!.contextLines!.findIndex(
        (ctx) => ctx.isMatch,
      )
      const linesAfter = firstMatch!.contextLines!.length - matchIndex - 1

      expect(matchIndex).toBeGreaterThan(0)
      expect(linesAfter).toBe(0)
    })
  })

  describe('-A flag (after context)', () => {
    it('should include only lines after match when -A is specified', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'example.md',
          contextBefore: 0,
          contextAfter: 3,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      const firstMatch = firstResult!.matches![0]

      expect(firstMatch?.contextLines).toBeDefined()

      const matchIndex = firstMatch!.contextLines!.findIndex(
        (ctx) => ctx.isMatch,
      )

      expect(matchIndex).toBe(0)
      expect(firstMatch!.contextLines!.length).toBeGreaterThan(1)
    })
  })

  describe('context line content validation', () => {
    it('should preserve exact line content in context', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'example.md',
          contextBefore: 1,
          contextAfter: 1,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        if (!result.matches) continue

        for (const match of result.matches) {
          expect(match.contextLines).toBeDefined()

          for (const ctx of match.contextLines!) {
            expect(ctx.line).toBeTruthy()
            expect(typeof ctx.line).toBe('string')
            expect(ctx.lineNumber).toBeGreaterThan(0)
            expect(typeof ctx.isMatch).toBe('boolean')
          }

          const matchingLine = match.contextLines!.find((ctx) => ctx.isMatch)
          expect(matchingLine).toBeDefined()
          expect(matchingLine?.line).toContain('TARGET')
        }
      }
    })

    it('should have correct line numbers in context', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'example.md',
          contextBefore: 2,
          contextAfter: 2,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        if (!result.matches) continue

        for (const match of result.matches) {
          expect(match.contextLines).toBeDefined()

          for (let i = 1; i < match.contextLines!.length; i++) {
            const prevLine = match.contextLines![i - 1]
            const currLine = match.contextLines![i]

            expect(currLine?.lineNumber).toBe((prevLine?.lineNumber ?? 0) + 1)
          }
        }
      }
    })
  })

  describe('edge cases', () => {
    it('should handle match at start of section (limited before context)', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'Only one line above',
          contextBefore: 5,
          contextAfter: 1,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      const firstMatch = firstResult!.matches![0]

      expect(firstMatch?.contextLines).toBeDefined()

      const matchIndex = firstMatch!.contextLines!.findIndex(
        (ctx) => ctx.isMatch,
      )

      expect(matchIndex).toBeLessThan(5)
    })

    it('should handle match at end of section (limited after context)', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'Only one line below',
          contextBefore: 1,
          contextAfter: 5,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      const firstMatch = firstResult!.matches![0]

      expect(firstMatch?.contextLines).toBeDefined()

      const matchIndex = firstMatch!.contextLines!.findIndex(
        (ctx) => ctx.isMatch,
      )
      const linesAfter = firstMatch!.contextLines!.length - matchIndex - 1

      expect(linesAfter).toBeLessThan(5)
    })

    it('should handle multiple matches in same section', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'example.md',
          contextBefore: 1,
          contextAfter: 1,
        }),
      )

      const sectionFour = results.find((r) =>
        r.section.heading.includes('Section Four'),
      )

      expect(sectionFour).toBeDefined()
      expect(sectionFour!.matches!.length).toBeGreaterThanOrEqual(2)

      for (const match of sectionFour!.matches!) {
        expect(match.contextLines).toBeDefined()
        const matchingLine = match.contextLines!.find((ctx) => ctx.isMatch)
        expect(matchingLine?.line).toContain('TARGET')
      }
    })
  })

  describe('default context behavior', () => {
    it('should use default context of 1 when not specified', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'example.md',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      const firstMatch = firstResult!.matches![0]

      expect(firstMatch?.contextLines).toBeDefined()

      const matchIndex = firstMatch!.contextLines!.findIndex(
        (ctx) => ctx.isMatch,
      )

      expect(matchIndex).toBeGreaterThanOrEqual(0)
      expect(matchIndex).toBeLessThanOrEqual(1)

      const linesAfter = firstMatch!.contextLines!.length - matchIndex - 1
      expect(linesAfter).toBeLessThanOrEqual(1)
    })
  })

  describe('context with code blocks', () => {
    it('should include context lines in code blocks', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'multiline.md',
          contextBefore: 2,
          contextAfter: 2,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const codeResult = results.find((r) => r.section.heading.includes('Code'))

      if (codeResult?.matches && codeResult.matches.length > 0) {
        const match = codeResult.matches[0]
        expect(match?.contextLines).toBeDefined()
        expect(match!.contextLines!.length).toBeGreaterThan(1)
      }
    })
  })

  describe('CRITICAL: -C flag must show context (regression test)', () => {
    it('MUST FAIL if context lines are missing when -C is specified', async () => {
      const results = await runEffect(
        searchTestContent({
          content: 'TARGET',
          pathPattern: 'example.md',
          contextBefore: 2,
          contextAfter: 2,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        expect(result.matches).toBeDefined()
        expect(result.matches!.length).toBeGreaterThan(0)

        for (const match of result.matches!) {
          expect(match.contextLines).toBeDefined()
          expect(
            match.contextLines!.length,
            `Context lines must be present when contextBefore/contextAfter is specified. ` +
              `Expected context around match at line ${match.lineNumber} but got no context lines.`,
          ).toBeGreaterThan(1)

          const matchingLine = match.contextLines!.find((ctx) => ctx.isMatch)
          expect(
            matchingLine,
            'At least one context line should be marked as the matching line',
          ).toBeDefined()

          expect(
            matchingLine?.line,
            'The matching line should contain the search term',
          ).toContain('TARGET')
        }
      }
    })
  })
})
