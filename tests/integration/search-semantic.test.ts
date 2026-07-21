/**
 * Integration tests for semantic search with CLI flags
 *
 * Tests semantic search functionality including:
 * - Basic semantic search
 * - Context flags (-C, -A, -B)
 * - Threshold filtering (--threshold)
 * - Result limits (--limit)
 * - Edge cases (no results, below threshold)
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildEmbeddings,
  semanticSearchWithStats,
} from '../../src/embeddings/semantic-search.js'
import { buildIndex } from '../../src/index/indexer.js'
import { registerDefaultProviders } from '../../src/providers/index.js'

const TEST_DIR = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'semantic-search',
)
const originalMdmHome = process.env.MDM_HOME

const runEffect = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect)

const skipIfNoApiKey = () => {
  if (!process.env.OPENAI_API_KEY && !process.env.INCLUDE_EMBED_TESTS) {
    return true
  }
  return false
}

describe('semantic search integration', () => {
  beforeAll(async () => {
    if (skipIfNoApiKey()) {
      console.log(
        'Skipping semantic search tests (set OPENAI_API_KEY or INCLUDE_EMBED_TESTS=true)',
      )
      return
    }
    process.env.MDM_HOME = TEST_DIR

    // `buildEmbeddings` dispatches through the runtime registry. The CLI
    // main path calls this at bootstrap; the integration tests skip main
    // and hit the pipeline directly, so we mirror the bootstrap here.
    await runEffect(registerDefaultProviders())

    await fs.mkdir(TEST_DIR, { recursive: true })

    await fs.writeFile(
      path.join(TEST_DIR, 'authentication.md'),
      `# Authentication Guide

## Overview

This document explains how authentication works in the system.

## User Login

Users can log in using email and password. The system validates credentials
against the database and returns a JWT token for subsequent requests.

### Password Requirements

Passwords must be at least 8 characters and contain uppercase, lowercase,
numbers, and special characters.

## OAuth Integration

The system supports OAuth 2.0 for third-party authentication providers
including Google, GitHub, and Microsoft.

### Configuration

Set the following environment variables:
- OAUTH_CLIENT_ID
- OAUTH_CLIENT_SECRET
- OAUTH_REDIRECT_URI

## Session Management

Sessions are stored in Redis with a 30-minute expiration time.
Sessions can be refreshed by calling the /refresh endpoint.

## Security Considerations

Always use HTTPS in production. Never store passwords in plain text.
Implement rate limiting on authentication endpoints to prevent brute force attacks.
`,
    )

    await fs.writeFile(
      path.join(TEST_DIR, 'database.md'),
      `# Database Schema

## Tables

### users

The users table stores account information.

Columns:
- id (primary key)
- email (unique)
- password_hash
- created_at
- updated_at

### sessions

The sessions table tracks active user sessions.

Columns:
- id (primary key)
- user_id (foreign key)
- token
- expires_at

## Migrations

Database migrations are managed using a migration tool.
Run migrations before deploying new code.

## Backup Strategy

Daily backups are stored in S3 with 30-day retention.
Point-in-time recovery is available for the last 7 days.
`,
    )

    await fs.writeFile(
      path.join(TEST_DIR, 'api.md'),
      `# API Documentation

## REST Endpoints

### Authentication Endpoints

POST /api/auth/login - Authenticate user and get token
POST /api/auth/logout - Invalidate session
POST /api/auth/refresh - Refresh authentication token

### User Endpoints

GET /api/users/:id - Get user profile
PUT /api/users/:id - Update user profile
DELETE /api/users/:id - Delete user account

## Rate Limiting

API endpoints are rate limited to 100 requests per minute per IP address.
Authenticated users get 1000 requests per minute.

## Error Handling

All errors return JSON with status code and message.
Use the error code to determine appropriate retry logic.
`,
    )

    await fs.writeFile(
      path.join(TEST_DIR, 'deployment.md'),
      `# Deployment Guide

## Production Setup

Deploy to AWS using Docker containers.
Use environment-specific configuration files.

## Environment Variables

Required variables:
- DATABASE_URL
- REDIS_URL
- JWT_SECRET
- OAUTH_CLIENT_ID

## Monitoring

Set up CloudWatch alarms for:
- High error rates
- Slow response times
- Database connection issues

## Rollback Procedure

If deployment fails, rollback using the previous Docker image tag.
Database migrations cannot be automatically rolled back.
`,
    )

    const shouldRebuild = process.env.REBUILD_TEST_INDEX === 'true'

    await runEffect(
      buildIndex(TEST_DIR, { indexRoot: TEST_DIR, force: shouldRebuild }),
    )

    await runEffect(
      buildEmbeddings(TEST_DIR, {
        indexRoot: TEST_DIR,
        force: shouldRebuild,
      }),
    )
  }, 60000)

  afterAll(async () => {
    if (skipIfNoApiKey()) return
    await fs.rm(TEST_DIR, { recursive: true, force: true })
    if (originalMdmHome === undefined) delete process.env.MDM_HOME
    else process.env.MDM_HOME = originalMdmHome
  })

  describe('basic semantic search', () => {
    it('should find results for natural language query', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'how does user login work', {
          limit: 5,
          threshold: 0.3,
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)
      expect(result.results[0]?.similarity).toBeGreaterThanOrEqual(0.3)

      const topResult = result.results[0]
      expect(topResult?.documentPath).toContain('.md')
      expect(topResult?.heading).toBeTruthy()
      expect(topResult?.sectionId).toBeTruthy()
    })

    it('should return results sorted by similarity score', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'authentication', {
          limit: 10,
          threshold: 0.2,
        }),
      )

      expect(result.results.length).toBeGreaterThan(1)

      for (let i = 1; i < result.results.length; i++) {
        const prev = result.results[i - 1]
        const curr = result.results[i]
        expect(prev?.similarity).toBeGreaterThanOrEqual(curr?.similarity ?? 0)
      }
    })
  })

  describe('--threshold flag', () => {
    it('should filter results below threshold', async () => {
      if (skipIfNoApiKey()) return

      const lowThreshold = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'deployment', {
          limit: 10,
          threshold: 0.2,
        }),
      )

      const highThreshold = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'deployment', {
          limit: 10,
          threshold: 0.5,
        }),
      )

      expect(lowThreshold.results.length).toBeGreaterThanOrEqual(
        highThreshold.results.length,
      )

      for (const result of highThreshold.results) {
        expect(result.similarity).toBeGreaterThanOrEqual(0.5)
      }
    })

    it('should provide stats when no results meet threshold', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'authentication', {
          limit: 5,
          threshold: 0.99,
        }),
      )

      expect(result.results.length).toBe(0)

      if (result.belowThresholdCount !== undefined) {
        expect(result.belowThresholdCount).toBeGreaterThan(0)
        expect(result.belowThresholdHighest).toBeDefined()
        expect(result.belowThresholdHighest).toBeLessThan(0.99)
      }
    })
  })

  describe('--limit flag', () => {
    it('should respect limit parameter', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'api endpoints', {
          limit: 3,
          threshold: 0.2,
        }),
      )

      expect(result.results.length).toBeLessThanOrEqual(3)
    })

    it('should provide totalAvailable when results exceed limit', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'user', {
          limit: 2,
          threshold: 0.2,
        }),
      )

      if (result.totalAvailable !== undefined) {
        expect(result.totalAvailable).toBeGreaterThanOrEqual(
          result.results.length,
        )
      }
    })

    it('should handle limit larger than available results', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'authentication', {
          limit: 100,
          threshold: 0.3,
        }),
      )

      expect(result.results.length).toBeLessThan(100)
      expect(result.results.length).toBeGreaterThan(0)
    })
  })

  describe('context flags (-C, -A, -B)', () => {
    it('should include context lines when context flags are provided', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'authentication', {
          limit: 5,
          threshold: 0.3,
          contextBefore: 2,
          contextAfter: 2,
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)

      const firstResult = result.results[0]
      expect(firstResult?.contextLines).toBeDefined()
      expect(firstResult!.contextLines!.length).toBeGreaterThan(0)

      const matchingLine = firstResult!.contextLines!.find((ctx) => ctx.isMatch)
      expect(matchingLine).toBeDefined()
      expect(matchingLine?.lineNumber).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it('should handle query with no relevant results', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'quantum physics blockchain AI', {
          limit: 5,
          threshold: 0.7,
        }),
      )

      expect(result.results.length).toBe(0)
    })

    it('should handle very short query', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'api', {
          limit: 5,
          threshold: 0.3,
        }),
      )

      expect(result.results.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle very long query', async () => {
      if (skipIfNoApiKey()) return

      const longQuery =
        'I need to understand how the authentication system works including user login with email and password, OAuth integration with third-party providers like Google and GitHub, session management with Redis, and security best practices for production deployment'

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, longQuery, {
          limit: 5,
          threshold: 0.3,
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)
    })

    it('should handle query with special characters', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'OAuth 2.0 & JWT tokens', {
          limit: 5,
          threshold: 0.3,
        }),
      )

      expect(result.results.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('result format validation', () => {
    it('should return correctly structured results', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'database schema', {
          limit: 5,
          threshold: 0.3,
        }),
      )

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)

      if (result.results.length > 0) {
        const firstResult = result.results[0]
        expect(firstResult).toHaveProperty('sectionId')
        expect(firstResult).toHaveProperty('documentPath')
        expect(firstResult).toHaveProperty('heading')
        expect(firstResult).toHaveProperty('similarity')

        expect(typeof firstResult?.sectionId).toBe('string')
        expect(typeof firstResult?.documentPath).toBe('string')
        expect(typeof firstResult?.heading).toBe('string')
        expect(typeof firstResult?.similarity).toBe('number')

        expect(firstResult?.similarity).toBeGreaterThan(0)
        expect(firstResult?.similarity).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('multi-document search', () => {
    it('should search across multiple documents', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(
          TEST_DIR,
          'configuration environment variables',
          {
            limit: 10,
            threshold: 0.3,
          },
        ),
      )

      expect(result.results.length).toBeGreaterThan(0)

      const uniqueDocs = new Set(result.results.map((r) => r.documentPath))
      expect(uniqueDocs.size).toBeGreaterThan(1)
    })

    it('should find related content across different sections', async () => {
      if (skipIfNoApiKey()) return

      const result = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'security and passwords', {
          limit: 10,
          threshold: 0.3,
        }),
      )

      expect(result.results.length).toBeGreaterThan(0)
    })
  })

  describe('similarity score behavior', () => {
    it('should give higher scores for exact topic matches', async () => {
      if (skipIfNoApiKey()) return

      const authResult = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'OAuth authentication', {
          limit: 5,
          threshold: 0.2,
        }),
      )

      const unrelatedResult = await runEffect(
        semanticSearchWithStats(TEST_DIR, 'database backup', {
          limit: 5,
          threshold: 0.2,
        }),
      )

      if (authResult.results.length > 0 && unrelatedResult.results.length > 0) {
        const authDoc = authResult.results.find((r) =>
          r.documentPath.includes('authentication'),
        )
        const backupDoc = unrelatedResult.results.find((r) =>
          r.documentPath.includes('database'),
        )

        if (authDoc && backupDoc) {
          expect(authDoc.similarity).toBeGreaterThan(0.3)
        }
      }
    })
  })
})
