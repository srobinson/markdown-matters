/**
 * Query Preprocessing Tests
 *
 * Tests for query preprocessing before embedding generation.
 * Preprocessing normalizes queries to improve semantic search recall.
 */

import { describe, expect, it } from 'vitest'
import { preprocessQuery, type SemanticSearchOptions } from './types.js'

describe('Query Preprocessing', () => {
  describe('preprocessQuery function', () => {
    it('should convert query to lowercase', () => {
      expect(preprocessQuery('How Does Authentication Work')).toBe(
        'how does authentication work',
      )
    })

    it('should replace punctuation with spaces', () => {
      expect(preprocessQuery('user-authentication')).toBe('user authentication')
      expect(preprocessQuery('what is config.json?')).toBe(
        'what is config json',
      )
      expect(preprocessQuery('test@example.com')).toBe('test example com')
    })

    it('should collapse multiple spaces to single space', () => {
      expect(preprocessQuery('how   does   it   work')).toBe('how does it work')
      expect(preprocessQuery('user  -  auth')).toBe('user auth')
    })

    it('should trim leading/trailing whitespace', () => {
      expect(preprocessQuery('  query  ')).toBe('query')
      expect(preprocessQuery('   how does it work   ')).toBe('how does it work')
    })

    it('should handle empty string', () => {
      expect(preprocessQuery('')).toBe('')
    })

    it('should handle whitespace-only string', () => {
      expect(preprocessQuery('   ')).toBe('')
    })

    it('should preserve alphanumeric content', () => {
      expect(preprocessQuery('user123')).toBe('user123')
      expect(preprocessQuery('v2 api')).toBe('v2 api')
    })

    it('should handle complex queries', () => {
      expect(preprocessQuery("What's the best way to handle errors?")).toBe(
        'what s the best way to handle errors',
      )
      expect(preprocessQuery('API v2.0 - authentication')).toBe(
        'api v2 0 authentication',
      )
    })

    it('should handle special characters', () => {
      expect(preprocessQuery('C++ programming')).toBe('c programming')
      expect(preprocessQuery('Node.js')).toBe('node js')
      expect(preprocessQuery('$PATH variable')).toBe('path variable')
    })

    it('should handle unicode and accented characters', () => {
      // Accented characters are stripped by the regex (non-word chars in ASCII)
      // This is intentional as embeddings handle normalized ASCII better
      expect(preprocessQuery('café')).toBe('caf')
      expect(preprocessQuery('naïve')).toBe('na ve')
      // Basic ASCII preserved
      expect(preprocessQuery('cafe')).toBe('cafe')
      expect(preprocessQuery('naive')).toBe('naive')
    })

    it('should handle quotes', () => {
      expect(preprocessQuery('"exact match"')).toBe('exact match')
      expect(preprocessQuery("'single quotes'")).toBe('single quotes')
    })

    it('should handle brackets and parentheses', () => {
      expect(preprocessQuery('function(args)')).toBe('function args')
      expect(preprocessQuery('[array]')).toBe('array')
      expect(preprocessQuery('{object}')).toBe('object')
    })
  })

  describe('SemanticSearchOptions skipPreprocessing', () => {
    it('should accept skipPreprocessing option in interface', () => {
      const options: SemanticSearchOptions = {
        skipPreprocessing: true,
      }
      expect(options.skipPreprocessing).toBe(true)
    })

    it('should default to undefined (preprocessing enabled)', () => {
      const options: SemanticSearchOptions = {}
      expect(options.skipPreprocessing).toBeUndefined()
    })

    it('should accept skipPreprocessing with other options', () => {
      const options: SemanticSearchOptions = {
        limit: 10,
        threshold: 0.35,
        skipPreprocessing: false,
      }
      expect(options.skipPreprocessing).toBe(false)
      expect(options.limit).toBe(10)
      expect(options.threshold).toBe(0.35)
    })
  })

  describe('Preprocessing benefits', () => {
    it('should normalize case variations', () => {
      // Same query with different case should produce same result
      const query1 = 'Authentication'
      const query2 = 'authentication'
      const query3 = 'AUTHENTICATION'

      expect(preprocessQuery(query1)).toBe(preprocessQuery(query2))
      expect(preprocessQuery(query2)).toBe(preprocessQuery(query3))
    })

    it('should normalize punctuation variations', () => {
      // Similar queries with punctuation differences should be closer
      const query1 = 'user-auth'
      const query2 = 'user auth'

      expect(preprocessQuery(query1)).toBe(preprocessQuery(query2))
    })

    it('should handle file path references gracefully', () => {
      // File paths in queries should be handled
      expect(preprocessQuery('src/components/Button.tsx')).toBe(
        'src components button tsx',
      )
    })

    it('should handle code references gracefully', () => {
      // Code snippets in queries should be handled
      expect(preprocessQuery('function handleClick()')).toBe(
        'function handleclick',
      )
    })
  })

  describe('Edge cases', () => {
    it('should handle only punctuation', () => {
      expect(preprocessQuery('...')).toBe('')
      expect(preprocessQuery('???')).toBe('')
    })

    it('should handle only numbers', () => {
      expect(preprocessQuery('12345')).toBe('12345')
    })

    it('should handle mixed numbers and punctuation', () => {
      expect(preprocessQuery('123-456-789')).toBe('123 456 789')
    })

    it('should handle underscores (word characters)', () => {
      // Underscores are word characters in regex, so they're preserved
      expect(preprocessQuery('user_name')).toBe('user_name')
    })

    it('should handle newlines', () => {
      expect(preprocessQuery('line1\nline2')).toBe('line1 line2')
    })

    it('should handle tabs', () => {
      expect(preprocessQuery('tab\ttab')).toBe('tab tab')
    })
  })
})

describe('Export verification', () => {
  it('should export preprocessQuery from types module', async () => {
    const { preprocessQuery } = await import('./types.js')
    expect(preprocessQuery).toBeDefined()
    expect(typeof preprocessQuery).toBe('function')
  })

  it('should export preprocessQuery from main embeddings module', async () => {
    const { preprocessQuery } = await import('./index.js')
    expect(preprocessQuery).toBeDefined()
    expect(typeof preprocessQuery).toBe('function')
  })
})
