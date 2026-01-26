/**
 * Tests for duplicate content detection
 */

import { describe, expect, it } from 'vitest'
import {
  collapseDuplicates,
  type DuplicateGroup,
  type DuplicateSectionInfo,
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
  documentPath: path,
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
