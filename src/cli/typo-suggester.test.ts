/**
 * Unit tests for typo-suggester
 */

import { describe, expect, it } from 'vitest'
import type { CommandSchema } from './flag-schemas.js'
import {
  formatValidFlags,
  levenshteinDistance,
  suggestFlag,
} from './typo-suggester.js'

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('test', 'test')).toBe(0)
  })

  it('returns string length for empty comparison', () => {
    expect(levenshteinDistance('test', '')).toBe(4)
    expect(levenshteinDistance('', 'test')).toBe(4)
  })

  it('calculates single character difference', () => {
    expect(levenshteinDistance('test', 'tset')).toBe(2) // transposition
    expect(levenshteinDistance('test', 'tests')).toBe(1) // insertion
    expect(levenshteinDistance('test', 'tes')).toBe(1) // deletion
    expect(levenshteinDistance('test', 'tast')).toBe(1) // substitution
  })

  it('calculates distance for common typos', () => {
    expect(levenshteinDistance('json', 'jsno')).toBe(2)
    expect(levenshteinDistance('limit', 'limt')).toBe(1)
    expect(levenshteinDistance('tokens', 'toekns')).toBe(2)
  })
})

describe('suggestFlag', () => {
  const mockSchema: CommandSchema = {
    name: 'test',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output JSON' },
      { name: 'limit', type: 'string', alias: 'n', description: 'Max results' },
      { name: 'threshold', type: 'string', description: 'Threshold' },
    ],
  }

  it('suggests correct flag for typo', () => {
    const result = suggestFlag('--jsno', mockSchema)
    expect(result).toBeDefined()
    expect(result?.flag).toBe('--json')
  })

  it('suggests correct flag for missing letter', () => {
    const result = suggestFlag('--limt', mockSchema)
    expect(result).toBeDefined()
    expect(result?.flag).toBe('--limit')
  })

  it('returns undefined for no close match', () => {
    const result = suggestFlag('--foobar', mockSchema)
    expect(result).toBeUndefined()
  })

  it('handles prefix matches', () => {
    const result = suggestFlag('--js', mockSchema)
    expect(result).toBeDefined()
    expect(result?.flag).toBe('--json')
  })

  it('handles short flag typos', () => {
    const result = suggestFlag('-m', mockSchema)
    expect(result).toBeDefined()
    expect(result?.flag).toBe('--limit') // -m is close to -n
  })

  it('respects maxDistance parameter', () => {
    const result = suggestFlag('--jsno', mockSchema, 1)
    expect(result).toBeUndefined() // distance is 2, exceeds max
  })
})

describe('formatValidFlags', () => {
  const mockSchema: CommandSchema = {
    name: 'test',
    flags: [
      { name: 'json', type: 'boolean', description: 'Output JSON' },
      { name: 'limit', type: 'string', alias: 'n', description: 'Max results' },
      { name: 'threshold', type: 'string' },
    ],
  }

  it('formats flags with descriptions', () => {
    const output = formatValidFlags(mockSchema)
    expect(output).toContain('--json')
    expect(output).toContain('Output JSON')
    expect(output).toContain('--limit, -n')
    expect(output).toContain('Max results')
    expect(output).toContain('--threshold')
  })

  it('includes alias when present', () => {
    const output = formatValidFlags(mockSchema)
    expect(output).toContain(', -n')
  })
})
