/**
 * Tests for fuzzy-search utilities
 */

import { describe, expect, it } from 'vitest'
import {
  buildFuzzyHighlightPattern,
  findFuzzyMatches,
  findMatchesInLine,
  getStems,
  isFuzzyMatch,
  levenshteinDistance,
  matchesWithOptions,
  stem,
  stemText,
} from './fuzzy-search.js'

describe('fuzzy-search', () => {
  // ============================================================================
  // Stemming Tests
  // ============================================================================

  describe('stem', () => {
    it('stems words to their root form', () => {
      expect(stem('running')).toBe('run')
      expect(stem('runner')).toBe('runner')
      expect(stem('runs')).toBe('run')
    })

    it('handles common word forms', () => {
      expect(stem('failing')).toBe('fail')
      expect(stem('failed')).toBe('fail')
      expect(stem('failure')).toBe('failur')
      expect(stem('fails')).toBe('fail')
    })

    it('handles programming terms', () => {
      expect(stem('configuration')).toBe('configur')
      expect(stem('configuring')).toBe('configur')
      expect(stem('configured')).toBe('configur')
    })

    it('handles irregular words', () => {
      expect(stem('testing')).toBe('test')
      expect(stem('tests')).toBe('test')
      expect(stem('tested')).toBe('test')
    })

    it('converts to lowercase', () => {
      expect(stem('Running')).toBe('run')
      expect(stem('RUNNING')).toBe('run')
      expect(stem('RuNnInG')).toBe('run')
    })

    it('handles edge cases', () => {
      expect(stem('')).toBe('')
      expect(stem('a')).toBe('a')
      expect(stem('i')).toBe('i')
    })
  })

  describe('stemText', () => {
    it('splits text and stems each word', () => {
      expect(stemText('running tests')).toEqual(['run', 'test'])
      expect(stemText('the quick fox')).toEqual(['the', 'quick', 'fox'])
    })

    it('handles punctuation and special characters', () => {
      expect(stemText('hello, world!')).toEqual(['hello', 'world'])
      // Note: \W+ splits on non-word chars; underscore is a word character
      expect(stemText('foo-bar')).toEqual(['foo', 'bar'])
    })

    it('filters out empty strings', () => {
      expect(stemText('  multiple   spaces  ')).toEqual(['multipl', 'space'])
    })

    it('handles empty input', () => {
      expect(stemText('')).toEqual([])
      expect(stemText('   ')).toEqual([])
    })
  })

  describe('getStems', () => {
    it('returns unique stems as a Set', () => {
      const stems = getStems('running runs runner')
      expect(stems).toBeInstanceOf(Set)
      expect(stems.has('run')).toBe(true)
      expect(stems.has('runner')).toBe(true)
    })

    it('deduplicates stems', () => {
      const stems = getStems('test testing tests tested')
      expect(stems.size).toBe(1)
      expect(stems.has('test')).toBe(true)
    })

    it('handles empty input', () => {
      expect(getStems('')).toEqual(new Set())
    })
  })

  // ============================================================================
  // Levenshtein Distance Tests
  // ============================================================================

  describe('levenshteinDistance', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0)
      expect(levenshteinDistance('', '')).toBe(0)
      expect(levenshteinDistance('a', 'a')).toBe(0)
    })

    it('calculates insertion distance', () => {
      expect(levenshteinDistance('', 'abc')).toBe(3)
      expect(levenshteinDistance('ab', 'abc')).toBe(1)
      expect(levenshteinDistance('a', 'abc')).toBe(2)
    })

    it('calculates deletion distance', () => {
      expect(levenshteinDistance('abc', '')).toBe(3)
      expect(levenshteinDistance('abc', 'ab')).toBe(1)
      expect(levenshteinDistance('abc', 'a')).toBe(2)
    })

    it('calculates substitution distance', () => {
      expect(levenshteinDistance('abc', 'axc')).toBe(1)
      expect(levenshteinDistance('abc', 'xyz')).toBe(3)
    })

    it('calculates mixed operations', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
      expect(levenshteinDistance('saturday', 'sunday')).toBe(3)
    })

    it('handles common typos', () => {
      expect(levenshteinDistance('configuration', 'configration')).toBe(1) // missing 'u'
      expect(levenshteinDistance('function', 'funciton')).toBe(2) // transposition
      expect(levenshteinDistance('receive', 'recieve')).toBe(2) // ie/ei swap
    })

    it('is symmetric', () => {
      expect(levenshteinDistance('abc', 'xyz')).toBe(
        levenshteinDistance('xyz', 'abc'),
      )
      expect(levenshteinDistance('hello', 'world')).toBe(
        levenshteinDistance('world', 'hello'),
      )
    })
  })

  // ============================================================================
  // Fuzzy Matching Tests
  // ============================================================================

  describe('isFuzzyMatch', () => {
    it('matches identical strings', () => {
      expect(isFuzzyMatch('hello', 'hello')).toBe(true)
    })

    it('matches within default distance (2)', () => {
      expect(isFuzzyMatch('hello', 'helo')).toBe(true) // 1 deletion
      expect(isFuzzyMatch('hello', 'helloo')).toBe(true) // 1 insertion
      expect(isFuzzyMatch('hello', 'hallo')).toBe(true) // 1 substitution
      expect(isFuzzyMatch('hello', 'hallo!')).toBe(true) // 2 edits
    })

    it('does not match beyond default distance', () => {
      expect(isFuzzyMatch('hello', 'hi')).toBe(false)
      expect(isFuzzyMatch('hello', 'goodbye')).toBe(false)
    })

    it('respects custom max distance', () => {
      expect(isFuzzyMatch('hello', 'helo', 1)).toBe(true)
      expect(isFuzzyMatch('hello', 'heo', 1)).toBe(false)
      expect(isFuzzyMatch('hello', 'heo', 2)).toBe(true)
      expect(isFuzzyMatch('hello', 'h', 3)).toBe(false)
      expect(isFuzzyMatch('hello', 'h', 4)).toBe(true)
    })

    it('is case-insensitive', () => {
      expect(isFuzzyMatch('Hello', 'hello')).toBe(true)
      expect(isFuzzyMatch('HELLO', 'hello')).toBe(true)
      expect(isFuzzyMatch('HeLLo', 'hello')).toBe(true)
    })

    it('handles length difference optimization', () => {
      // Length difference > maxDistance should return false quickly
      expect(isFuzzyMatch('ab', 'abcdef', 2)).toBe(false)
      expect(isFuzzyMatch('abcdef', 'ab', 2)).toBe(false)
    })

    it('handles common programming typos', () => {
      expect(isFuzzyMatch('function', 'funciton')).toBe(true)
      expect(isFuzzyMatch('configuration', 'configration')).toBe(true)
      expect(isFuzzyMatch('database', 'databse')).toBe(true)
    })
  })

  describe('findFuzzyMatches', () => {
    const words = ['hello', 'world', 'help', 'held', 'hero', 'helm']

    it('finds matches within distance', () => {
      const matches = findFuzzyMatches('helo', words)
      expect(matches).toContain('hello')
      expect(matches).toContain('help')
      expect(matches).toContain('held')
      expect(matches).toContain('hero')
    })

    it('respects max distance parameter', () => {
      const matches = findFuzzyMatches('helo', words, 1)
      expect(matches).toContain('hello')
      expect(matches).toContain('help')
      expect(matches).not.toContain('world')
    })

    it('returns empty array for no matches', () => {
      const matches = findFuzzyMatches('xyz', words, 1)
      expect(matches).toEqual([])
    })

    it('handles empty word list', () => {
      expect(findFuzzyMatches('hello', [])).toEqual([])
    })

    it('is case-insensitive', () => {
      const matches = findFuzzyMatches('HELO', words)
      expect(matches).toContain('hello')
    })
  })

  // ============================================================================
  // Combined Matching Tests
  // ============================================================================

  describe('matchesWithOptions', () => {
    const text = 'The configuration failed during initialization'

    describe('exact matching (no options)', () => {
      it('matches exact words', () => {
        expect(matchesWithOptions('configuration', text)).toBe(true)
        expect(matchesWithOptions('failed', text)).toBe(true)
      })

      it('is case-insensitive', () => {
        expect(matchesWithOptions('CONFIGURATION', text)).toBe(true)
        expect(matchesWithOptions('Failed', text)).toBe(true)
      })

      it('does not match partial words', () => {
        expect(matchesWithOptions('config', text)).toBe(false)
        expect(matchesWithOptions('fail', text)).toBe(false)
      })

      it('requires all query words to match', () => {
        expect(matchesWithOptions('configuration failed', text)).toBe(true)
        expect(matchesWithOptions('configuration success', text)).toBe(false)
      })

      it('matches empty query', () => {
        expect(matchesWithOptions('', text)).toBe(true)
        expect(matchesWithOptions('   ', text)).toBe(true)
      })
    })

    describe('stemming', () => {
      it('matches word variations via stemming', () => {
        expect(matchesWithOptions('fail', text, { stem: true })).toBe(true)
        expect(matchesWithOptions('failing', text, { stem: true })).toBe(true)
        expect(matchesWithOptions('configure', text, { stem: true })).toBe(true)
      })

      it('matches multiple stemmed words', () => {
        expect(
          matchesWithOptions('fail initialize', text, { stem: true }),
        ).toBe(true)
      })
    })

    describe('fuzzy matching', () => {
      it('matches typos within distance', () => {
        expect(
          matchesWithOptions('configration', text, { fuzzyDistance: 2 }),
        ).toBe(true)
        expect(matchesWithOptions('faild', text, { fuzzyDistance: 1 })).toBe(
          true,
        )
      })

      it('does not match beyond distance', () => {
        expect(
          matchesWithOptions('configration', text, { fuzzyDistance: 0 }),
        ).toBe(false)
      })
    })

    describe('combined stem and fuzzy', () => {
      it('matches with both options enabled', () => {
        expect(
          matchesWithOptions('failing', text, { stem: true, fuzzyDistance: 2 }),
        ).toBe(true)
        expect(
          matchesWithOptions('configration', text, {
            stem: true,
            fuzzyDistance: 2,
          }),
        ).toBe(true)
      })
    })
  })

  describe('findMatchesInLine', () => {
    const line = 'The configuration process failed during initialization'

    it('finds exact matches', () => {
      const matches = findMatchesInLine(['configuration', 'failed'], line)
      expect(matches).toContain('configuration')
      expect(matches).toContain('failed')
    })

    it('returns unique matches (no duplicates)', () => {
      const matches = findMatchesInLine(['the', 'the', 'the'], line)
      expect(matches.filter((m) => m === 'the').length).toBe(1)
    })

    it('finds stemmed matches', () => {
      const matches = findMatchesInLine(['fail', 'configure'], line, {
        stem: true,
      })
      expect(matches).toContain('failed')
      expect(matches).toContain('configuration')
    })

    it('finds fuzzy matches', () => {
      const matches = findMatchesInLine(['configration'], line, {
        fuzzyDistance: 2,
      })
      expect(matches).toContain('configuration')
    })

    it('handles empty query words', () => {
      expect(findMatchesInLine([], line)).toEqual([])
    })

    it('handles empty line', () => {
      expect(findMatchesInLine(['test'], '')).toEqual([])
    })

    it('is case-insensitive', () => {
      const matches = findMatchesInLine(['CONFIGURATION', 'FAILED'], line)
      expect(matches).toContain('configuration')
      expect(matches).toContain('failed')
    })
  })

  // ============================================================================
  // Highlight Pattern Tests
  // ============================================================================

  describe('buildFuzzyHighlightPattern', () => {
    it('builds pattern for exact matching with word boundaries', () => {
      const pattern = buildFuzzyHighlightPattern('hello')
      // Pattern matches within text
      expect(pattern.test('say hello there')).toBe(true)
    })

    it('builds pattern for stemmed matching', () => {
      const pattern = buildFuzzyHighlightPattern('fail', { stem: true })
      // Stemmed pattern matches words starting with the stem 'fail'
      expect(pattern.test('it will fail')).toBe(true)
    })

    it('escapes regex special characters', () => {
      const pattern = buildFuzzyHighlightPattern('foo.bar')
      expect(pattern.test('use foo.bar here')).toBe(true)
      expect(pattern.test('use fooXbar here')).toBe(false)
    })

    it('returns non-matching pattern for empty query', () => {
      const pattern = buildFuzzyHighlightPattern('')
      expect(pattern.test('anything')).toBe(false)
    })

    it('matches word boundaries', () => {
      const pattern = buildFuzzyHighlightPattern('test')
      expect(pattern.test('run the test now')).toBe(true)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles special characters in text', () => {
      const text = 'function() { return true; }'
      expect(matchesWithOptions('function', text)).toBe(true)
      expect(matchesWithOptions('return', text)).toBe(true)
      expect(matchesWithOptions('true', text)).toBe(true)
    })

    it('handles numeric content', () => {
      const text = 'version 1.2.3 released on 2024'
      expect(matchesWithOptions('version', text)).toBe(true)
      expect(matchesWithOptions('2024', text)).toBe(true)
    })

    it('handles very long words', () => {
      const longWord = 'a'.repeat(100)
      expect(stem(longWord)).toBeDefined()
      expect(levenshteinDistance(longWord, longWord)).toBe(0)
    })

    it('handles unicode text', () => {
      const text = '日本語 configuration 中文'
      expect(matchesWithOptions('configuration', text)).toBe(true)
    })
  })
})
