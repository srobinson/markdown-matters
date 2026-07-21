/**
 * Tests for duplicate content detection
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { DocumentKey } from '../db/canonical.js'
import { testGenerationSession } from '../db/generation-test-fixture.js'
import { buildIndex } from '../index/indexer.js'
import {
  collapseDuplicates,
  type DuplicateGroup,
  type DuplicateSectionInfo,
  detectExactDuplicates,
} from './detector.js'

// ============================================================================
// Test Data
// ============================================================================

const makeSectionInfo = (
  id: string,
  path: string,
  heading: string,
): DuplicateSectionInfo => ({
  sectionId: id,
  documentPath: path as DocumentKey,
  heading,
  startLine: 1,
  endLine: 10,
  tokenCount: 100,
})

const makeGroup = (
  primary: DuplicateSectionInfo,
  duplicates: DuplicateSectionInfo[],
): DuplicateGroup => ({
  primary,
  duplicates,
  method: 'exact',
  similarity: 1.0,
})

// ============================================================================
// collapseDuplicates Tests
// ============================================================================

describe('collapseDuplicates', () => {
  it('returns all results when no duplicate groups', () => {
    const results = [
      { sectionId: 'a', documentPath: 'doc1.md', score: 0.9 },
      { sectionId: 'b', documentPath: 'doc2.md', score: 0.8 },
      { sectionId: 'c', documentPath: 'doc3.md', score: 0.7 },
    ]
    const groups: DuplicateGroup[] = []

    const collapsed = collapseDuplicates(results, groups)

    expect(collapsed.length).toBe(3)
    expect(collapsed[0]?.result.sectionId).toBe('a')
    expect(collapsed[0]?.duplicateCount).toBe(0)
    expect(collapsed[1]?.result.sectionId).toBe('b')
    expect(collapsed[2]?.result.sectionId).toBe('c')
  })

  it('collapses duplicates and keeps primary', () => {
    const section1 = makeSectionInfo('a', 'doc1.md', 'Section A')
    const section2 = makeSectionInfo('b', 'doc2.md', 'Section A (copy)')

    const results = [
      { sectionId: 'a', documentPath: 'doc1.md', score: 0.9 },
      { sectionId: 'b', documentPath: 'doc2.md', score: 0.8 },
    ]
    const groups = [makeGroup(section1, [section2])]

    const collapsed = collapseDuplicates(results, groups)

    expect(collapsed.length).toBe(1)
    expect(collapsed[0]?.result.sectionId).toBe('a')
    expect(collapsed[0]?.duplicateCount).toBe(1)
  })

  it('collapses when duplicate appears first', () => {
    const section1 = makeSectionInfo('a', 'doc1.md', 'Section A')
    const section2 = makeSectionInfo('b', 'doc2.md', 'Section A (copy)')

    // Duplicate appears first in results
    const results = [
      { sectionId: 'b', documentPath: 'doc2.md', score: 0.9 },
      { sectionId: 'a', documentPath: 'doc1.md', score: 0.8 },
    ]
    const groups = [makeGroup(section1, [section2])]

    const collapsed = collapseDuplicates(results, groups)

    // Should keep the first result (b), not the primary (a)
    expect(collapsed.length).toBe(1)
    expect(collapsed[0]?.result.sectionId).toBe('b')
    expect(collapsed[0]?.duplicateCount).toBe(1)
  })

  it('includes duplicate locations when showLocations is true', () => {
    const section1 = makeSectionInfo('a', 'doc1.md', 'Section A')
    const section2 = makeSectionInfo('b', 'doc2.md', 'Section A (copy)')
    const section3 = makeSectionInfo('c', 'doc3.md', 'Section A (copy 2)')

    const results = [{ sectionId: 'a', documentPath: 'doc1.md', score: 0.9 }]
    const groups = [makeGroup(section1, [section2, section3])]

    const collapsed = collapseDuplicates(results, groups, {
      showLocations: true,
    })

    expect(collapsed.length).toBe(1)
    expect(collapsed[0]?.duplicateCount).toBe(2)
    expect(collapsed[0]?.duplicateLocations).toBeDefined()
    expect(collapsed[0]?.duplicateLocations?.length).toBe(2)
    expect(collapsed[0]?.duplicateLocations?.[0]?.documentPath).toBe('doc2.md')
    expect(collapsed[0]?.duplicateLocations?.[1]?.documentPath).toBe('doc3.md')
  })

  it('respects maxLocations option', () => {
    const section1 = makeSectionInfo('a', 'doc1.md', 'Section A')
    const section2 = makeSectionInfo('b', 'doc2.md', 'Copy 1')
    const section3 = makeSectionInfo('c', 'doc3.md', 'Copy 2')
    const section4 = makeSectionInfo('d', 'doc4.md', 'Copy 3')
    const section5 = makeSectionInfo('e', 'doc5.md', 'Copy 4')

    const results = [{ sectionId: 'a', documentPath: 'doc1.md', score: 0.9 }]
    const groups = [
      makeGroup(section1, [section2, section3, section4, section5]),
    ]

    const collapsed = collapseDuplicates(results, groups, {
      showLocations: true,
      maxLocations: 2,
    })

    expect(collapsed[0]?.duplicateCount).toBe(4)
    expect(collapsed[0]?.duplicateLocations?.length).toBe(2)
  })

  it('handles multiple duplicate groups', () => {
    const sectionA1 = makeSectionInfo('a1', 'doc1.md', 'Section A')
    const sectionA2 = makeSectionInfo('a2', 'doc2.md', 'Section A copy')
    const sectionB1 = makeSectionInfo('b1', 'doc3.md', 'Section B')
    const sectionB2 = makeSectionInfo('b2', 'doc4.md', 'Section B copy')

    const results = [
      { sectionId: 'a1', documentPath: 'doc1.md', score: 0.9 },
      { sectionId: 'b1', documentPath: 'doc3.md', score: 0.8 },
      { sectionId: 'a2', documentPath: 'doc2.md', score: 0.7 },
      { sectionId: 'b2', documentPath: 'doc4.md', score: 0.6 },
    ]
    const groups = [
      makeGroup(sectionA1, [sectionA2]),
      makeGroup(sectionB1, [sectionB2]),
    ]

    const collapsed = collapseDuplicates(results, groups)

    expect(collapsed.length).toBe(2)
    expect(collapsed[0]?.result.sectionId).toBe('a1')
    expect(collapsed[0]?.duplicateCount).toBe(1)
    expect(collapsed[1]?.result.sectionId).toBe('b1')
    expect(collapsed[1]?.duplicateCount).toBe(1)
  })

  it('handles empty results', () => {
    const collapsed = collapseDuplicates([], [])
    expect(collapsed.length).toBe(0)
  })

  it('does not include locations when showLocations is false', () => {
    const section1 = makeSectionInfo('a', 'doc1.md', 'Section A')
    const section2 = makeSectionInfo('b', 'doc2.md', 'Section A copy')

    const results = [{ sectionId: 'a', documentPath: 'doc1.md', score: 0.9 }]
    const groups = [makeGroup(section1, [section2])]

    const collapsed = collapseDuplicates(results, groups, {
      showLocations: false,
    })

    expect(collapsed[0]?.duplicateCount).toBe(1)
    expect(collapsed[0]?.duplicateLocations).toBeUndefined()
  })
})

describe('detectExactDuplicates', () => {
  it('filters duplicate detection by source relative path', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-duplicates-'))
    const sourceRoot = path.join(parent, 'source')
    const indexRoot = path.join(parent, 'index')
    const docsRoot = path.join(sourceRoot, 'docs')
    const previousHome = process.env.MDM_HOME

    try {
      await Promise.all([
        fs.mkdir(docsRoot, { recursive: true }),
        fs.mkdir(indexRoot, { recursive: true }),
      ])
      const content =
        '# Shared\n\nThis repeated section has enough content for exact duplicate detection inside the docs directory.\n'
      await Promise.all([
        fs.writeFile(path.join(docsRoot, 'first.md'), content),
        fs.writeFile(path.join(docsRoot, 'second.md'), content),
        fs.writeFile(path.join(sourceRoot, 'outside.md'), content),
      ])
      process.env.MDM_HOME = indexRoot

      await Effect.runPromise(buildIndex(sourceRoot, { indexRoot }))
      const result = await Effect.runPromise(
        detectExactDuplicates(testGenerationSession(indexRoot), sourceRoot, {
          minContentLength: 20,
          pathPattern: 'docs/*.md',
        }),
      )
      const paths = result.groups.flatMap(({ primary, duplicates }) => [
        primary.documentPath,
        ...duplicates.map(({ documentPath }) => documentPath),
      ])
      const canonicalDocsRoot = await fs.realpath(docsRoot)

      expect(result.groups).toHaveLength(1)
      expect(result.sectionsAnalyzed).toBe(2)
      expect(paths).toHaveLength(2)
      expect(
        paths.every((documentPath) =>
          documentPath.startsWith(`${canonicalDocsRoot}${path.sep}`),
        ),
      ).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.MDM_HOME
      else process.env.MDM_HOME = previousHome
      await fs.rm(parent, { recursive: true, force: true })
    }
  })

  it('reads canonical hardlink survivors without joining them to the source root', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-duplicates-'))
    const sourceRoot = path.join(parent, 'source')
    const indexRoot = path.join(parent, 'index')
    const previousHome = process.env.MDM_HOME

    try {
      await Promise.all([
        fs.mkdir(sourceRoot, { recursive: true }),
        fs.mkdir(indexRoot, { recursive: true }),
      ])
      const content =
        '# Shared\n\nThis repeated section has enough content for exact duplicate detection across canonical documents.\n'
      const z = path.join(sourceRoot, 'z.md')
      const a = path.join(sourceRoot, 'a.md')
      const copy = path.join(sourceRoot, 'copy.md')
      await fs.writeFile(z, content)
      await fs.link(z, a)
      await fs.writeFile(copy, content)
      process.env.MDM_HOME = indexRoot

      await Effect.runPromise(buildIndex(sourceRoot, { indexRoot }))
      const result = await Effect.runPromise(
        detectExactDuplicates(testGenerationSession(indexRoot), sourceRoot, {
          minContentLength: 20,
        }),
      )
      const paths = result.groups.flatMap(({ primary, duplicates }) => [
        primary.documentPath,
        ...duplicates.map(({ documentPath }) => documentPath),
      ])

      expect(result.groups).toHaveLength(1)
      expect(new Set(paths)).toEqual(
        new Set([await fs.realpath(a), await fs.realpath(copy)]),
      )
      expect(paths).not.toContain(await fs.realpath(z))
    } finally {
      if (previousHome === undefined) delete process.env.MDM_HOME
      else process.env.MDM_HOME = previousHome
      await fs.rm(parent, { recursive: true, force: true })
    }
  })
})
