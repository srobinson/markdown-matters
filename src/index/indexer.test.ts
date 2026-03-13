/**
 * Indexer Test Suite
 *
 * Tests the core indexing pipeline: buildIndex, link resolution,
 * incremental updates, and file exclusion logic.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  buildIndex,
  getBrokenLinks,
  getIncomingLinks,
  getOutgoingLinks,
} from './indexer.js'

// ============================================================================
// Test Helpers
// ============================================================================

let tempRoot: string

const createFixture = async (
  files: Record<string, string>,
): Promise<string> => {
  const dir = path.join(
    tempRoot,
    `fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  await fs.mkdir(dir, { recursive: true })

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, 'utf-8')
  }

  return dir
}

const runBuildIndex = (
  rootPath: string,
  options: Parameters<typeof buildIndex>[1] = {},
) =>
  Effect.runPromise(
    buildIndex(rootPath, options).pipe(Effect.catchAll((e) => Effect.die(e))),
  )

const runGetOutgoingLinks = (rootPath: string, filePath: string) =>
  Effect.runPromise(
    getOutgoingLinks(rootPath, filePath).pipe(
      Effect.catchAll((e) => Effect.die(e)),
    ),
  )

const runGetIncomingLinks = (rootPath: string, filePath: string) =>
  Effect.runPromise(
    getIncomingLinks(rootPath, filePath).pipe(
      Effect.catchAll((e) => Effect.die(e)),
    ),
  )

const runGetBrokenLinks = (rootPath: string) =>
  Effect.runPromise(
    getBrokenLinks(rootPath).pipe(Effect.catchAll((e) => Effect.die(e))),
  )

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdctx-test-'))
})

afterAll(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

// ============================================================================
// Tests
// ============================================================================

describe('buildIndex', () => {
  describe('basic indexing', () => {
    it('should index a directory of markdown files correctly', async () => {
      const dir = await createFixture({
        'README.md': '# Hello\n\nWorld\n',
        'guide.md': '# Guide\n\n## Step 1\n\nDo something\n',
        'notes.md': '# Notes\n\nSome notes\n',
      })

      const result = await runBuildIndex(dir)

      expect(result.documentsIndexed).toBe(3)
      expect(result.totalDocuments).toBe(3)
      expect(result.sectionsIndexed).toBeGreaterThan(0)
      expect(result.errors).toHaveLength(0)
    })

    it('should skip non-markdown files', async () => {
      const dir = await createFixture({
        'README.md': '# Hello\n',
        'data.json': '{"key": "value"}',
        'script.ts': 'export const x = 1',
        'style.css': 'body { color: red }',
      })

      const result = await runBuildIndex(dir)

      expect(result.documentsIndexed).toBe(1)
      expect(result.totalDocuments).toBe(1)
    })

    it('should index nested directories', async () => {
      const dir = await createFixture({
        'README.md': '# Root\n',
        'docs/intro.md': '# Intro\n',
        'docs/api/endpoints.md': '# Endpoints\n',
        'docs/api/auth.md': '# Auth\n',
      })

      const result = await runBuildIndex(dir)

      expect(result.documentsIndexed).toBe(4)
      expect(result.totalDocuments).toBe(4)
    })

    it('should return duration greater than or equal to 0', async () => {
      const dir = await createFixture({
        'README.md': '# Hello\n',
      })

      const result = await runBuildIndex(dir)

      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('incremental indexing', () => {
    it('should skip unchanged files on re-index', async () => {
      const dir = await createFixture({
        'file1.md': '# File 1\n',
        'file2.md': '# File 2\n',
      })

      // First index
      await runBuildIndex(dir)

      // Second index (no changes)
      const result = await runBuildIndex(dir)

      expect(result.documentsIndexed).toBe(0)
      expect(result.skipped.unchanged).toBe(2)
      expect(result.totalDocuments).toBe(2)
    })

    it('should re-index changed files', async () => {
      const dir = await createFixture({
        'file1.md': '# File 1\n',
        'file2.md': '# File 2\n',
      })

      // First index
      await runBuildIndex(dir)

      // Modify file1 (wait for mtime to change)
      await new Promise((r) => setTimeout(r, 50))
      await fs.writeFile(
        path.join(dir, 'file1.md'),
        '# File 1 Updated\n\nNew content\n',
      )

      // Second index
      const result = await runBuildIndex(dir)

      expect(result.documentsIndexed).toBe(1)
      expect(result.skipped.unchanged).toBe(1)
      expect(result.totalDocuments).toBe(2)
    })

    it('should re-index all files with force option', async () => {
      const dir = await createFixture({
        'file1.md': '# File 1\n',
        'file2.md': '# File 2\n',
      })

      // First index
      await runBuildIndex(dir)

      // Force re-index
      const result = await runBuildIndex(dir, { force: true })

      expect(result.documentsIndexed).toBe(2)
      expect(result.skipped.unchanged).toBe(0)
    })

    it('should remove deleted files from the index on re-index', async () => {
      const dir = await createFixture({
        'keep.md': '# Keep\n',
        'delete-me.md': '# Delete Me\n',
      })

      // First index
      const first = await runBuildIndex(dir)
      expect(first.totalDocuments).toBe(2)

      // Delete a file
      await fs.rm(path.join(dir, 'delete-me.md'))

      // Re-index with force to pick up deletion
      const result = await runBuildIndex(dir, { force: true })

      expect(result.documentsIndexed).toBe(1)
      expect(result.totalDocuments).toBe(1)
    })
  })

  describe('changedPaths with deleted files (watch mode)', () => {
    it('should not throw when changedPaths includes a deleted file', async () => {
      const dir = await createFixture({
        'keep.md': '# Keep\n',
        'deleted.md': '# Will Be Deleted\n',
      })

      // Build initial index
      await runBuildIndex(dir)

      // Delete the file, then pass its path via changedPaths
      const deletedPath = path.join(dir, 'deleted.md')
      await fs.rm(deletedPath)

      // This should succeed without ENOENT
      const result = await runBuildIndex(dir, {
        changedPaths: [deletedPath],
      })

      expect(result.errors).toHaveLength(0)
      expect(result.totalDocuments).toBe(1)
    })

    it('should remove deleted document from section and document indexes', async () => {
      const dir = await createFixture({
        'keep.md': '# Keep\n\n## Section A\n\nContent\n',
        'deleted.md':
          '# Deleted Doc\n\n## Section B\n\nContent B\n\n## Section C\n\nContent C\n',
      })

      // Build initial index
      const first = await runBuildIndex(dir)
      expect(first.totalDocuments).toBe(2)
      expect(first.totalSections).toBeGreaterThanOrEqual(4) // at least 2 per doc

      // Delete the file
      const deletedPath = path.join(dir, 'deleted.md')
      await fs.rm(deletedPath)

      // Incremental reindex via changedPaths
      const result = await runBuildIndex(dir, {
        changedPaths: [deletedPath],
      })

      expect(result.totalDocuments).toBe(1)
      // Only sections from keep.md should remain
      expect(result.totalSections).toBeGreaterThanOrEqual(2)
      expect(result.totalSections).toBeLessThanOrEqual(3)
    })

    it('should remove deleted document from link indexes', async () => {
      const dir = await createFixture({
        'README.md': '# Home\n\nSee [Guide](./guide.md)\n',
        'guide.md': '# Guide\n\nBack to [Home](./README.md)\n',
      })

      // Build initial index with links
      await runBuildIndex(dir, { force: true })

      // Verify links exist
      const linksBefore = await runGetOutgoingLinks(
        dir,
        path.join(dir, 'guide.md'),
      )
      expect(linksBefore).toContain('README.md')

      // Delete guide.md and reindex via changedPaths
      const deletedPath = path.join(dir, 'guide.md')
      await fs.rm(deletedPath)

      const result = await runBuildIndex(dir, {
        changedPaths: [deletedPath],
      })

      expect(result.totalDocuments).toBe(1)

      // guide.md's forward links should be gone
      const linksAfter = await runGetOutgoingLinks(
        dir,
        path.join(dir, 'guide.md'),
      )
      expect(linksAfter).toEqual([])

      // guide.md's backward entry should also be cleaned up
      const incomingAfter = await runGetIncomingLinks(
        dir,
        path.join(dir, 'guide.md'),
      )
      expect(incomingAfter).toEqual([])
    })

    it('should handle rename as delete + add without stale entries', async () => {
      const dir = await createFixture({
        'old-name.md': '# Document\n\n## Important Section\n\nContent\n',
        'other.md': '# Other\n',
      })

      // Build initial index
      const first = await runBuildIndex(dir)
      expect(first.totalDocuments).toBe(2)

      // Simulate rename: delete old, create new
      const oldPath = path.join(dir, 'old-name.md')
      const newPath = path.join(dir, 'new-name.md')
      await fs.rename(oldPath, newPath)

      // Pass both the deleted and the new path
      const result = await runBuildIndex(dir, {
        changedPaths: [oldPath, newPath],
      })

      expect(result.errors).toHaveLength(0)
      expect(result.totalDocuments).toBe(2) // other.md + new-name.md
      expect(result.documentsIndexed).toBe(1) // only new-name.md was indexed
    })
  })

  describe('file exclusion', () => {
    it('should exclude hidden files by default', async () => {
      const dir = await createFixture({
        'visible.md': '# Visible\n',
        '.hidden.md': '# Hidden\n',
      })

      const result = await runBuildIndex(dir)

      expect(result.documentsIndexed).toBe(1)
      expect(result.totalDocuments).toBe(1)
    })

    it('should exclude hidden directories by default', async () => {
      const dir = await createFixture({
        'visible.md': '# Visible\n',
        '.hidden/secret.md': '# Secret\n',
      })

      const result = await runBuildIndex(dir)

      expect(result.documentsIndexed).toBe(1)
    })

    it('should skip files matching excludePatterns', async () => {
      const dir = await createFixture({
        'README.md': '# Hello\n',
        'draft.md': '# Draft\n',
        'docs/draft-v2.md': '# Draft V2\n',
        'docs/final.md': '# Final\n',
      })

      const result = await runBuildIndex(dir, { exclude: ['draft*'] })

      // draft.md and docs/draft-v2.md should be excluded
      expect(result.documentsIndexed).toBe(2)
      expect(result.totalDocuments).toBe(2)
    })
  })

  describe('link tracking', () => {
    let linkDir: string

    beforeEach(async () => {
      linkDir = await createFixture({
        'README.md': '# Home\n\nSee [Guide](./guide.md) and [API](./api.md)\n',
        'guide.md': '# Guide\n\nBack to [Home](./README.md)\n',
        'api.md': '# API\n\nSome API docs\n',
      })

      await runBuildIndex(linkDir, { force: true })
    })

    it('should track outgoing links', async () => {
      const links = await runGetOutgoingLinks(
        linkDir,
        path.join(linkDir, 'README.md'),
      )

      expect(links).toContain('guide.md')
      expect(links).toContain('api.md')
      expect(links).toHaveLength(2)
    })

    it('should track incoming links (backlinks)', async () => {
      const links = await runGetIncomingLinks(
        linkDir,
        path.join(linkDir, 'guide.md'),
      )

      expect(links).toContain('README.md')
    })

    it('should track backlinks to api.md from README.md', async () => {
      const links = await runGetIncomingLinks(
        linkDir,
        path.join(linkDir, 'api.md'),
      )

      expect(links).toContain('README.md')
    })

    it('should return empty for non-indexed file', async () => {
      const links = await runGetOutgoingLinks(
        linkDir,
        path.join(linkDir, 'nonexistent.md'),
      )

      expect(links).toEqual([])
    })
  })

  describe('broken link detection', () => {
    it('should track broken internal links', async () => {
      const dir = await createFixture({
        'README.md':
          '# Home\n\nSee [Missing](./does-not-exist.md) and [Also Missing](./another-missing.md)\n',
        'guide.md': '# Guide\n',
      })

      await runBuildIndex(dir, { force: true })

      const broken = await runGetBrokenLinks(dir)

      expect(broken).toContain('does-not-exist.md')
      expect(broken).toContain('another-missing.md')
    })

    it('should not report valid internal links as broken', async () => {
      const dir = await createFixture({
        'README.md': '# Home\n\nSee [Guide](./guide.md)\n',
        'guide.md': '# Guide\n',
      })

      await runBuildIndex(dir, { force: true })

      const broken = await runGetBrokenLinks(dir)

      expect(broken).not.toContain('guide.md')
    })
  })

  describe('error handling', () => {
    it('should handle empty directory gracefully', async () => {
      const dir = await createFixture({})

      const result = await runBuildIndex(dir)

      expect(result.documentsIndexed).toBe(0)
      expect(result.totalDocuments).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it('should handle directory with only non-markdown files', async () => {
      const dir = await createFixture({
        'data.json': '{}',
        'script.js': 'console.log("hi")',
      })

      const result = await runBuildIndex(dir)

      expect(result.documentsIndexed).toBe(0)
    })
  })

  describe('sections', () => {
    it('should index sections from document headings', async () => {
      const dir = await createFixture({
        'doc.md':
          '# Title\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B\n\n### Subsection B1\n\nMore content\n',
      })

      const result = await runBuildIndex(dir)

      // Title + Section A + Section B + Subsection B1 = at least 3 sections
      expect(result.sectionsIndexed).toBeGreaterThanOrEqual(3)
    })
  })

  // maxDepth is not part of IndexOptions. Directory traversal depth is
  // unbounded by design; scoping is handled via exclude patterns and
  // .mdmignore instead. No test is needed for an unimplemented option.
})
