/**
 * Heading Match Boost Tests
 *
 * Tests for heading boost functionality that improves search results
 * when query terms appear in section headings.
 */

import { describe, expect, it } from 'vitest'
import { calculateHeadingBoost, type SemanticSearchOptions } from './types.js'

describe('Heading Match Boost', () => {
  describe('calculateHeadingBoost function', () => {
    it('should return 0 for no matches', () => {
      expect(
        calculateHeadingBoost('Installation Guide', 'authentication'),
      ).toBe(0)
    })

    it('should return boost for single term match', () => {
      expect(calculateHeadingBoost('Installation Guide', 'installation')).toBe(
        0.05,
      )
    })

    it('should return higher boost for multiple term matches', () => {
      expect(
        calculateHeadingBoost('Installation Guide', 'installation guide'),
      ).toBe(0.1)
    })

    it('should be case-insensitive', () => {
      expect(
        calculateHeadingBoost('INSTALLATION GUIDE', 'installation guide'),
      ).toBe(0.1)
      expect(
        calculateHeadingBoost('Installation Guide', 'INSTALLATION GUIDE'),
      ).toBe(0.1)
    })

    it('should handle partial term matches', () => {
      // "install" is contained in "Installation"
      expect(calculateHeadingBoost('Installation Guide', 'install')).toBe(0.05)
    })

    it('should handle empty query', () => {
      expect(calculateHeadingBoost('Installation Guide', '')).toBe(0)
    })

    it('should handle empty heading', () => {
      expect(calculateHeadingBoost('', 'installation')).toBe(0)
    })

    it('should handle whitespace-only query', () => {
      expect(calculateHeadingBoost('Installation Guide', '   ')).toBe(0)
    })

    it('should boost navigation queries', () => {
      // Common navigation patterns
      expect(calculateHeadingBoost('API Reference', 'api reference')).toBe(0.1)
      expect(calculateHeadingBoost('Getting Started', 'getting started')).toBe(
        0.1,
      )
      expect(calculateHeadingBoost('Configuration', 'config')).toBe(0.05)
    })

    it('should count each matching term only once', () => {
      // Query with repeated terms - each "auth" matches "authentication"
      expect(
        calculateHeadingBoost('Authentication', 'auth auth auth'),
      ).toBeCloseTo(0.15)
    })
  })

  describe('SemanticSearchOptions headingBoost', () => {
    it('should accept headingBoost option', () => {
      const options: SemanticSearchOptions = {
        headingBoost: true,
      }
      expect(options.headingBoost).toBe(true)
    })

    it('should accept headingBoost=false to disable', () => {
      const options: SemanticSearchOptions = {
        headingBoost: false,
      }
      expect(options.headingBoost).toBe(false)
    })

    it('should default to undefined (enabled)', () => {
      const options: SemanticSearchOptions = {}
      expect(options.headingBoost).toBeUndefined()
    })

    it('should work with other options', () => {
      const options: SemanticSearchOptions = {
        limit: 10,
        threshold: 0.35,
        headingBoost: true,
        skipPreprocessing: false,
      }
      expect(options.headingBoost).toBe(true)
      expect(options.limit).toBe(10)
    })
  })
})

describe('Export verification', () => {
  it('should export calculateHeadingBoost from types module', async () => {
    const { calculateHeadingBoost } = await import('./types.js')
    expect(calculateHeadingBoost).toBeDefined()
    expect(typeof calculateHeadingBoost).toBe('function')
  })

  it('should export calculateHeadingBoost from main embeddings module', async () => {
    const { calculateHeadingBoost } = await import('./index.js')
    expect(calculateHeadingBoost).toBeDefined()
    expect(typeof calculateHeadingBoost).toBe('function')
  })
})
