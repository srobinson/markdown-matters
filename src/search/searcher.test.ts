/**
 * Tests for structural search
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildIndex } from '../index/indexer.js'
import { formatContextForLLM, getContext, search } from './searcher.js'

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
        getContext(TEST_DIR, path.join(TEST_DIR, 'doc1.md'), { maxTokens: limitTokens }),
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
})
