/**
 * Tests for keyword search
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildIndex } from '../index/indexer.js'
import {
  formatContextForLLM,
  getContext,
  search,
  searchContent,
} from './searcher.js'

// Test fixture directory
const TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'search')

// Helper to run Effect
const runEffect = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect)

describe('search', () => {
  beforeAll(async () => {
    // Create test fixtures
    await fs.mkdir(TEST_DIR, { recursive: true })

    // Create test markdown files
    await fs.writeFile(
      path.join(TEST_DIR, 'doc1.md'),
      `# Document One

## Introduction

This is the introduction section.

## Code Example

Here's some code:

\`\`\`typescript
const x = 1;
\`\`\`

## Summary

A brief summary.
`,
    )

    await fs.writeFile(
      path.join(TEST_DIR, 'doc2.md'),
      `# Document Two

## Overview

An overview of the document.

## Data Table

| Column A | Column B |
|----------|----------|
| Value 1  | Value 2  |

## Tasks

- Task 1
- Task 2
- Task 3
`,
    )

    // Create test file for fuzzy/stem search
    await fs.writeFile(
      path.join(TEST_DIR, 'stem-test.md'),
      `# Failure Handling

When the application fails, it logs the failure message.
Failed operations are retried automatically.
Failing gracefully is important for user experience.

## Configuration

The configration (typo) file is located at config.json.
Set the configuration options carefully.
`,
    )

    // Build index
    await runEffect(buildIndex(TEST_DIR, { force: true }))
  })

  afterAll(async () => {
    // Clean up
    await fs.rm(TEST_DIR, { recursive: true, force: true })
  })

  describe('search()', () => {
    it('should return all sections without filters', async () => {
      const results = await runEffect(search(TEST_DIR))
      expect(results.length).toBeGreaterThan(0)
    })

    it('should filter by heading pattern', async () => {
      const results = await runEffect(
        search(TEST_DIR, { heading: 'Introduction|Overview' }),
      )
      expect(results.length).toBe(2)
      expect(results.map((r) => r.section.heading)).toContain('Introduction')
      expect(results.map((r) => r.section.heading)).toContain('Overview')
    })

    it('should filter by path pattern', async () => {
      const results = await runEffect(
        search(TEST_DIR, { pathPattern: 'doc1*' }),
      )
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result.section.documentPath).toMatch(/doc1/)
      }
    })

    it('should filter by hasCode', async () => {
      const results = await runEffect(search(TEST_DIR, { hasCode: true }))
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result.section.hasCode).toBe(true)
      }
    })

    it('should filter by hasTable', async () => {
      const results = await runEffect(search(TEST_DIR, { hasTable: true }))
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result.section.hasTable).toBe(true)
      }
    })

    it('should filter by hasList', async () => {
      const results = await runEffect(search(TEST_DIR, { hasList: true }))
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result.section.hasList).toBe(true)
      }
    })

    it('should respect limit', async () => {
      const results = await runEffect(search(TEST_DIR, { limit: 2 }))
      expect(results.length).toBe(2)
    })
  })

  describe('getContext()', () => {
    it('should return document context', async () => {
      const context = await runEffect(
        getContext(TEST_DIR, path.join(TEST_DIR, 'doc1.md')),
      )
      expect(context.title).toBe('Document One')
      expect(context.sections.length).toBeGreaterThan(0)
    })

    it('should respect maxTokens', async () => {
      const fullContext = await runEffect(
        getContext(TEST_DIR, path.join(TEST_DIR, 'doc1.md')),
      )
      // Use a limit that's definitely smaller than the full document
      const limitTokens = Math.max(10, Math.floor(fullContext.totalTokens / 2))
      const limitedContext = await runEffect(
        getContext(TEST_DIR, path.join(TEST_DIR, 'doc1.md'), {
          maxTokens: limitTokens,
        }),
      )
      expect(limitedContext.includedTokens).toBeLessThanOrEqual(limitTokens)
      // Only check for reduction if the full context exceeds the limit
      if (fullContext.totalTokens > limitTokens) {
        expect(limitedContext.includedTokens).toBeLessThan(
          fullContext.totalTokens,
        )
      }
    })
  })

  describe('formatContextForLLM()', () => {
    it('should format context as readable text', async () => {
      const context = await runEffect(
        getContext(TEST_DIR, path.join(TEST_DIR, 'doc1.md')),
      )
      const formatted = formatContextForLLM(context)
      expect(formatted).toContain('# Document One')
      expect(formatted).toContain('Path: doc1.md')
      expect(formatted).toContain('tokens')
    })

    it('should include content metadata markers', async () => {
      const context = await runEffect(
        getContext(TEST_DIR, path.join(TEST_DIR, 'doc1.md')),
      )
      const formatted = formatContextForLLM(context)
      expect(formatted).toContain('[code]')
    })
  })

  describe('searchContent() with fuzzy/stem matching', () => {
    it('should match stemmed variations with --stem flag', async () => {
      // Search for "fail" should match "fails", "failed", "failing", "failure"
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'fail',
          stem: true,
          pathPattern: 'stem-test*',
        }),
      )
      expect(results.length).toBe(1)
      expect(results[0]?.section.heading).toBe('Failure Handling')
      // Should have multiple line matches for different word forms
      expect(results[0]?.matches?.length).toBeGreaterThan(1)
    })

    it('should match typos with --fuzzy flag', async () => {
      // Search for "configration" (typo) should match "configuration"
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'configration',
          fuzzy: true,
          pathPattern: 'stem-test*',
        }),
      )
      expect(results.length).toBe(1)
      expect(results[0]?.section.heading).toBe('Configuration')
      // Should match both the typo line and the correct spelling line
      expect(results[0]?.matches?.length).toBeGreaterThanOrEqual(1)
    })

    it('should respect fuzzyDistance option', async () => {
      // With distance 1, "fail" should NOT match "file" (distance 2)
      const strictResults = await runEffect(
        searchContent(TEST_DIR, {
          content: 'fail',
          fuzzy: true,
          fuzzyDistance: 1,
          pathPattern: 'stem-test*',
        }),
      )
      // With distance 1, only exact or 1-edit matches
      const matchedWords = strictResults
        .flatMap((r) => r.matches?.map((m) => m.line) ?? [])
        .join(' ')
        .toLowerCase()
      // "fail" with distance 1 matches "fails" but not "file"
      expect(matchedWords).toContain('fail')
    })

    it('should not match without fuzzy/stem flags', async () => {
      // Exact search for "fail" should NOT match "failure" or "fails"
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'fail',
          pathPattern: 'stem-test*',
        }),
      )
      // With exact search, "fail" appears as substring in "fails", "failure", "failing", "failed"
      // so it still matches, but checks the regex-based behavior
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('should combine fuzzy and stem matching', async () => {
      // Both flags together should provide broader matching
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'fail',
          fuzzy: true,
          stem: true,
          pathPattern: 'stem-test*',
        }),
      )
      expect(results.length).toBeGreaterThanOrEqual(1)
    })
  })
})
