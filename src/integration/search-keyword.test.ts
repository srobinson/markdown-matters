/**
 * Integration tests for keyword search functionality
 *
 * Tests the complete keyword search pipeline including:
 * - Basic keyword matching
 * - Boolean operators (AND, OR, NOT)
 * - Phrase search
 * - Case sensitivity
 * - Context lines
 * - Result format verification
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildIndex } from '../index/indexer.js'
import { searchContent } from '../search/searcher.js'

const TEST_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'keyword-search')
const originalMdmHome = process.env.MDM_HOME

const runEffect = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect)

describe('Keyword Search Integration', () => {
  beforeAll(async () => {
    process.env.MDM_HOME = TEST_DIR
    await fs.mkdir(TEST_DIR, { recursive: true })

    await fs.writeFile(
      path.join(TEST_DIR, 'authentication.md'),
      `# Authentication System

## Overview

The authentication system handles user login and session management.
It supports multiple authentication providers including OAuth and SAML.

## Security Features

- Password hashing with bcrypt
- Token-based authentication
- Multi-factor authentication support
- Session timeout and renewal

## Implementation Details

The auth module provides a secure way to authenticate users.
Authentication tokens expire after 24 hours for security.
Failed authentication attempts are logged and monitored.

## Error Handling

When authentication fails, the system returns appropriate error codes.
Common authentication errors include invalid credentials and expired tokens.
`,
    )

    await fs.writeFile(
      path.join(TEST_DIR, 'database.md'),
      `# Database Layer

## Connection Management

The database connection pool manages active connections efficiently.
Connection pooling improves performance and reduces overhead.

## Query Builder

Our query builder provides a fluent API for database operations.
Complex queries can be constructed programmatically without raw SQL.

## Transactions

Database transactions ensure data consistency across operations.
Transactions are automatically rolled back on error.

## Performance

Indexing strategies significantly improve query performance.
Query optimization is handled automatically by the database engine.
`,
    )

    await fs.writeFile(
      path.join(TEST_DIR, 'api.md'),
      `# API Documentation

## REST Endpoints

The REST API provides access to all system functionality.
Endpoints follow RESTful conventions for consistency.

## GraphQL Support

GraphQL endpoints offer flexible query capabilities.
Clients can request exactly the data they need.

## Rate Limiting

API rate limiting prevents abuse and ensures fair usage.
Rate limits are enforced per API key and endpoint.

## Versioning

API versioning ensures backward compatibility.
Deprecated endpoints remain available for one major version.
`,
    )

    await runEffect(buildIndex(TEST_DIR, { indexRoot: TEST_DIR, force: true }))
  })

  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
    if (originalMdmHome === undefined) delete process.env.MDM_HOME
    else process.env.MDM_HOME = originalMdmHome
  })

  describe('Basic Keyword Search', () => {
    it('should find sections containing a single keyword', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const authDoc = results.filter((r) =>
        r.section.documentPath.includes('authentication'),
      )
      expect(authDoc.length).toBeGreaterThan(0)
    })

    it('should return results with match details', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          pathPattern: 'authentication*',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      expect(firstResult).toBeDefined()
      expect(firstResult?.section).toBeDefined()
      expect(firstResult?.document).toBeDefined()
      expect(firstResult?.matches).toBeDefined()
      expect(firstResult?.matches?.length).toBeGreaterThan(0)
    })

    it('should respect case-insensitive matching by default', async () => {
      const lowerResults = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          pathPattern: 'authentication*',
        }),
      )

      const upperResults = await runEffect(
        searchContent(TEST_DIR, {
          content: 'AUTHENTICATION',
          pathPattern: 'authentication*',
        }),
      )

      expect(lowerResults.length).toBe(upperResults.length)
      expect(lowerResults.length).toBeGreaterThan(0)
    })

    it('should find multiple occurrences across sections', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'database',
          pathPattern: 'database*',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const totalMatches = results.reduce(
        (sum, r) => sum + (r.matches?.length ?? 0),
        0,
      )
      expect(totalMatches).toBeGreaterThan(1)
    })
  })

  describe('Boolean Operators', () => {
    it('should support AND operator', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication AND token',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        const content = result.sectionContent?.toLowerCase() ?? ''
        expect(content).toContain('authentication')
        expect(content).toContain('token')
      }
    })

    it('should support OR operator', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'OAuth OR SAML',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const hasOAuth = results.some(
        (r) =>
          r.sectionContent?.toLowerCase().includes('oauth') ||
          r.matches?.some((m) => m.line.toLowerCase().includes('oauth')),
      )
      const hasSAML = results.some(
        (r) =>
          r.sectionContent?.toLowerCase().includes('saml') ||
          r.matches?.some((m) => m.line.toLowerCase().includes('saml')),
      )

      expect(hasOAuth || hasSAML).toBe(true)
    })

    it('should support NOT operator', async () => {
      const allAuthResults = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
        }),
      )

      const noTokenResults = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication NOT token',
        }),
      )

      expect(noTokenResults.length).toBeLessThan(allAuthResults.length)

      for (const result of noTokenResults) {
        const content = result.sectionContent?.toLowerCase() ?? ''
        expect(content).toContain('authentication')
        expect(content).not.toContain('token')
      }
    })

    it('should support complex boolean expressions', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content:
            '(authentication AND security) OR (database AND performance)',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        const content = result.sectionContent?.toLowerCase() ?? ''
        const hasAuthSecurity =
          content.includes('authentication') && content.includes('security')
        const hasDbPerformance =
          content.includes('database') && content.includes('performance')

        expect(hasAuthSecurity || hasDbPerformance).toBe(true)
      }
    })

    it('should handle implicit AND between terms', async () => {
      const explicitResults = await runEffect(
        searchContent(TEST_DIR, {
          content: 'query AND builder',
        }),
      )

      const implicitResults = await runEffect(
        searchContent(TEST_DIR, {
          content: 'query builder',
        }),
      )

      expect(implicitResults.length).toBeGreaterThan(0)
      expect(implicitResults.length).toBe(explicitResults.length)
    })
  })

  describe('Phrase Search', () => {
    it('should find exact phrases with quotes', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: '"authentication system"',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const hasExactPhrase = results.some((r) =>
        r.matches?.some((m) =>
          m.line.toLowerCase().includes('authentication system'),
        ),
      )
      expect(hasExactPhrase).toBe(true)
    })

    it('should not match partial phrases', async () => {
      const phraseResults = await runEffect(
        searchContent(TEST_DIR, {
          content: '"password hashing"',
        }),
      )

      expect(phraseResults.length).toBeGreaterThan(0)

      const wrongOrderResults = await runEffect(
        searchContent(TEST_DIR, {
          content: '"hashing password"',
        }),
      )

      expect(wrongOrderResults.length).toBe(0)
    })

    it('should combine phrases with boolean operators', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: '"authentication system" OR "database connection"',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const hasAuthPhrase = results.some((r) =>
        r.matches?.some((m) =>
          m.line.toLowerCase().includes('authentication system'),
        ),
      )
      const hasDbPhrase = results.some((r) =>
        r.matches?.some((m) =>
          m.line.toLowerCase().includes('database connection'),
        ),
      )

      expect(hasAuthPhrase || hasDbPhrase).toBe(true)
    })

    it('should handle phrases with special characters', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: '"24 hours"',
        }),
      )

      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('Context Lines', () => {
    it('should include context lines before matches', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'bcrypt',
          contextBefore: 2,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      const firstMatch = firstResult?.matches?.[0]
      expect(firstMatch?.contextLines).toBeDefined()

      if (firstMatch?.contextLines) {
        const beforeLines = firstMatch.contextLines.filter(
          (cl) => !cl.isMatch && cl.lineNumber < firstMatch.lineNumber,
        )
        expect(beforeLines.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('should include context lines after matches', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'bcrypt',
          contextAfter: 2,
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      const firstMatch = firstResult?.matches?.[0]
      expect(firstMatch?.contextLines).toBeDefined()

      if (firstMatch?.contextLines) {
        const afterLines = firstMatch.contextLines.filter(
          (cl) => !cl.isMatch && cl.lineNumber > firstMatch.lineNumber,
        )
        expect(afterLines.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('should include context lines both before and after', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          contextBefore: 1,
          contextAfter: 1,
          pathPattern: 'authentication*',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      const firstMatch = firstResult?.matches?.[0]

      if (firstMatch?.contextLines) {
        const matchLine = firstMatch.contextLines.find((cl) => cl.isMatch)
        expect(matchLine).toBeDefined()
        expect(matchLine?.lineNumber).toBe(firstMatch.lineNumber)
        expect(firstMatch.contextLines.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('should generate snippet text from context', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          contextBefore: 1,
          contextAfter: 1,
          pathPattern: 'authentication*',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const firstResult = results[0]
      const firstMatch = firstResult?.matches?.[0]
      expect(firstMatch?.snippet).toBeDefined()
      expect(firstMatch?.snippet.length).toBeGreaterThan(0)
      expect(firstMatch?.snippet.toLowerCase()).toContain('authentication')
    })
  })

  describe('Result Format', () => {
    it('should include section metadata', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          pathPattern: 'authentication*',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const result = results[0]!
      expect(result.section.heading).toBeDefined()
      expect(result.section.level).toBeGreaterThan(0)
      expect(result.section.documentPath).toBeDefined()
      expect(typeof result.section.tokenCount).toBe('number')
    })

    it('should include document metadata', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          pathPattern: 'authentication*',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const result = results[0]!
      expect(result.document.title).toBeDefined()
      expect(result.document.path).toBeDefined()
      expect(typeof result.document.tokenCount).toBe('number')
    })

    it('should include match line numbers', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          pathPattern: 'authentication*',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const result = results[0]!
      expect(result.matches).toBeDefined()
      expect(result.matches!.length).toBeGreaterThan(0)

      for (const match of result.matches!) {
        expect(match.lineNumber).toBeGreaterThan(0)
        expect(typeof match.lineNumber).toBe('number')
      }
    })

    it('should include matching line text', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          pathPattern: 'authentication*',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      const result = results[0]!
      const match = result.matches![0]!

      expect(match.line).toBeDefined()
      expect(match.line.length).toBeGreaterThan(0)
      expect(match.line.toLowerCase()).toContain('authentication')
    })

    it('should populate section content when matches exist', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          pathPattern: 'authentication*',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        if (result.matches && result.matches.length > 0) {
          expect(result.sectionContent).toBeDefined()
          expect(result.sectionContent!.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle search with no matches', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'nonexistent_keyword_12345',
        }),
      )

      expect(results.length).toBe(0)
    })

    it('should handle empty search query gracefully', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: '',
        }),
      )

      expect(Array.isArray(results)).toBe(true)
    })

    it('should handle special regex characters', async () => {
      await fs.writeFile(
        path.join(TEST_DIR, 'special-chars.md'),
        `# Special Characters

Test with special chars: foo.bar, test[value], foo(bar)
`,
      )

      await runEffect(
        buildIndex(TEST_DIR, { indexRoot: TEST_DIR, force: true }),
      )

      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'foo.bar',
        }),
      )

      expect(results.length).toBeGreaterThan(0)
    })

    it('should handle very long keywords', async () => {
      const longKeyword = 'a'.repeat(100)

      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: longKeyword,
        }),
      )

      expect(Array.isArray(results)).toBe(true)
    })

    it('should handle multiple consecutive spaces in query', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication    system',
        }),
      )

      expect(Array.isArray(results)).toBe(true)
    })
  })

  describe('Path Filtering', () => {
    it('should filter results by path pattern', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          pathPattern: 'authentication*',
        }),
      )

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        expect(result.section.documentPath).toMatch(/authentication/)
      }
    })

    it('should return no results when path pattern does not match', async () => {
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'authentication',
          pathPattern: 'nonexistent*',
        }),
      )

      expect(results.length).toBe(0)
    })

    it('should combine path filtering with content search', async () => {
      const dbResults = await runEffect(
        searchContent(TEST_DIR, {
          content: 'query',
          pathPattern: 'database*',
        }),
      )

      expect(dbResults.length).toBeGreaterThan(0)

      for (const result of dbResults) {
        expect(result.section.documentPath).toMatch(/database/)
        expect(result.sectionContent?.toLowerCase()).toContain('query')
      }
    })
  })

  describe('Limit Results', () => {
    it('should respect limit option', async () => {
      const limit = 2
      const results = await runEffect(
        searchContent(TEST_DIR, {
          content: 'the',
          limit,
        }),
      )

      expect(results.length).toBeLessThanOrEqual(limit)
    })

    it('should return all results when limit is not specified', async () => {
      const limitedResults = await runEffect(
        searchContent(TEST_DIR, {
          content: 'API',
          limit: 1,
        }),
      )

      const unlimitedResults = await runEffect(
        searchContent(TEST_DIR, {
          content: 'API',
        }),
      )

      expect(unlimitedResults.length).toBeGreaterThanOrEqual(
        limitedResults.length,
      )
    })
  })
})
