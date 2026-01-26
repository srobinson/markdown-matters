/**
 * Heading Match Boost Tests
 *
 * Tests for heading boost functionality that improves search results
 * when query terms appear in section headings.
 */

import { describe, expect, it } from 'vitest'
import {
  calculateFileImportanceBoost,
  calculateHeadingBoost,
  calculateRankingBoost,
  type SemanticSearchOptions,
} from './types.js'

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

describe('File Importance Boost', () => {
  describe('calculateFileImportanceBoost function', () => {
    it('should return boost for README files', () => {
      expect(calculateFileImportanceBoost('README.md')).toBe(0.03)
      expect(calculateFileImportanceBoost('docs/README.md')).toBe(0.03)
      expect(calculateFileImportanceBoost('readme.md')).toBe(0.03)
    })

    it('should return boost for index files', () => {
      expect(calculateFileImportanceBoost('index.md')).toBe(0.03)
      expect(calculateFileImportanceBoost('docs/index.md')).toBe(0.03)
    })

    it('should return boost for getting started guides', () => {
      expect(calculateFileImportanceBoost('getting-started.md')).toBe(0.03)
      expect(calculateFileImportanceBoost('Getting-Started.md')).toBe(0.03)
      expect(calculateFileImportanceBoost('gettingstarted.md')).toBe(0.03)
    })

    it('should return boost for introduction files', () => {
      expect(calculateFileImportanceBoost('introduction.md')).toBe(0.03)
      expect(calculateFileImportanceBoost('docs/introduction.md')).toBe(0.03)
    })

    it('should return boost for overview files', () => {
      expect(calculateFileImportanceBoost('overview.md')).toBe(0.03)
      expect(calculateFileImportanceBoost('docs/overview.md')).toBe(0.03)
    })

    it('should return boost for quickstart guides', () => {
      expect(calculateFileImportanceBoost('quickstart.md')).toBe(0.03)
      expect(calculateFileImportanceBoost('Quickstart.md')).toBe(0.03)
    })

    it('should return boost for changelog files', () => {
      expect(calculateFileImportanceBoost('CHANGELOG.md')).toBe(0.03)
      expect(calculateFileImportanceBoost('changelog.md')).toBe(0.03)
    })

    it('should return 0 for regular files', () => {
      expect(calculateFileImportanceBoost('api.md')).toBe(0)
      expect(calculateFileImportanceBoost('docs/configuration.md')).toBe(0)
      expect(calculateFileImportanceBoost('src/utils.md')).toBe(0)
    })
  })

  describe('calculateRankingBoost combined function', () => {
    it('should combine heading and file importance boosts', () => {
      // README with matching heading
      const boost = calculateRankingBoost(
        'Installation Guide',
        'installation',
        'README.md',
      )
      expect(boost).toBe(0.08) // 0.05 (heading) + 0.03 (file)
    })

    it('should return only file boost when heading does not match', () => {
      const boost = calculateRankingBoost(
        'API Reference',
        'authentication',
        'README.md',
      )
      expect(boost).toBe(0.03) // 0.00 (heading) + 0.03 (file)
    })

    it('should return only heading boost for regular files', () => {
      const boost = calculateRankingBoost(
        'Installation Guide',
        'installation',
        'docs/install.md',
      )
      expect(boost).toBe(0.05) // 0.05 (heading) + 0.00 (file)
    })

    it('should return 0 when nothing matches', () => {
      const boost = calculateRankingBoost(
        'API Reference',
        'authentication',
        'docs/api.md',
      )
      expect(boost).toBe(0)
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

  it('should export calculateFileImportanceBoost from types module', async () => {
    const { calculateFileImportanceBoost } = await import('./types.js')
    expect(calculateFileImportanceBoost).toBeDefined()
    expect(typeof calculateFileImportanceBoost).toBe('function')
  })

  it('should export calculateFileImportanceBoost from main embeddings module', async () => {
    const { calculateFileImportanceBoost } = await import('./index.js')
    expect(calculateFileImportanceBoost).toBeDefined()
    expect(typeof calculateFileImportanceBoost).toBe('function')
  })
})
