/**
 * HyDE (Hypothetical Document Embeddings) Tests
 *
 * Tests for HyDE query expansion functionality.
 */

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  generateHypotheticalDocument,
  type HydeOptions,
  type HydeResult,
  isHydeAvailable,
  shouldUseHyde,
} from './hyde.js'
import type { SemanticSearchOptions } from './types.js'

describe('HyDE Query Expansion', () => {
  describe('shouldUseHyde detection', () => {
    it('should recommend HyDE for question queries', () => {
      expect(shouldUseHyde('How do I configure authentication?')).toBe(true)
      expect(shouldUseHyde('What is the best way to handle errors?')).toBe(true)
      expect(shouldUseHyde('Why is my build failing?')).toBe(true)
      expect(shouldUseHyde('When should I use caching?')).toBe(true)
      expect(shouldUseHyde('Where are the configuration files?')).toBe(true)
    })

    it('should recommend HyDE for procedural queries', () => {
      expect(shouldUseHyde('setup react project with typescript')).toBe(true)
      expect(shouldUseHyde('install dependencies for the project')).toBe(true)
      expect(shouldUseHyde('configure webpack for production')).toBe(true)
      expect(shouldUseHyde('implement user authentication flow')).toBe(true)
    })

    it('should recommend HyDE for longer queries (6+ words)', () => {
      expect(
        shouldUseHyde('user login flow with oauth and refresh tokens'),
      ).toBe(true)
      expect(
        shouldUseHyde(
          'database connection pooling configuration options for mysql',
        ),
      ).toBe(true)
    })

    it('should not recommend HyDE for short queries', () => {
      expect(shouldUseHyde('api')).toBe(false)
      expect(shouldUseHyde('config')).toBe(false)
      expect(shouldUseHyde('user auth')).toBe(false)
    })

    it('should not recommend HyDE for exact phrase searches', () => {
      expect(shouldUseHyde('"exact phrase match"')).toBe(false)
    })

    it('should recommend HyDE for queries ending with question mark', () => {
      expect(shouldUseHyde('database configuration options?')).toBe(true)
    })

    it('should handle edge cases gracefully', () => {
      expect(shouldUseHyde('')).toBe(false)
      expect(shouldUseHyde('   ')).toBe(false)
      expect(shouldUseHyde('a')).toBe(false)
    })
  })

  describe('isHydeAvailable', () => {
    it('should check if OPENAI_API_KEY is set', () => {
      // This test reflects the actual environment state
      const result = isHydeAvailable()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('HydeOptions interface', () => {
    it('should accept all configuration options', () => {
      const options: HydeOptions = {
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
        maxTokens: 256,
        temperature: 0.3,
        systemPrompt: 'Custom prompt',
        baseURL: 'http://localhost:1234/v1',
      }

      expect(options.apiKey).toBe('test-key')
      expect(options.model).toBe('gpt-4o-mini')
      expect(options.maxTokens).toBe(256)
      expect(options.temperature).toBe(0.3)
      expect(options.systemPrompt).toBe('Custom prompt')
      expect(options.baseURL).toBe('http://localhost:1234/v1')
    })

    it('should allow partial options', () => {
      const options: HydeOptions = {
        model: 'gpt-4o',
      }
      expect(options.model).toBe('gpt-4o')
      expect(options.apiKey).toBeUndefined()
    })

    it('should allow empty options', () => {
      const options: HydeOptions = {}
      expect(options).toEqual({})
    })
  })

  describe('HydeResult interface', () => {
    it('should have required fields', () => {
      const result: HydeResult = {
        hypotheticalDocument: 'Generated content about authentication...',
        originalQuery: 'How do I configure authentication?',
        model: 'gpt-4o-mini',
        tokensUsed: 150,
        cost: 0.00003,
      }

      expect(result.hypotheticalDocument).toBeDefined()
      expect(result.originalQuery).toBeDefined()
      expect(result.model).toBeDefined()
      expect(result.tokensUsed).toBeDefined()
      expect(result.cost).toBeDefined()
    })
  })

  describe('SemanticSearchOptions hyde integration', () => {
    it('should accept hyde option in SemanticSearchOptions', () => {
      const options: SemanticSearchOptions = {
        hyde: true,
      }
      expect(options.hyde).toBe(true)
    })

    it('should default to undefined (HyDE disabled)', () => {
      const options: SemanticSearchOptions = {}
      expect(options.hyde).toBeUndefined()
    })

    it('should accept hydeOptions when hyde is enabled', () => {
      const options: SemanticSearchOptions = {
        hyde: true,
        hydeOptions: {
          model: 'gpt-4o',
          maxTokens: 512,
          temperature: 0.5,
        },
      }
      expect(options.hyde).toBe(true)
      expect(options.hydeOptions?.model).toBe('gpt-4o')
      expect(options.hydeOptions?.maxTokens).toBe(512)
      expect(options.hydeOptions?.temperature).toBe(0.5)
    })

    it('should accept hyde with other search options', () => {
      const options: SemanticSearchOptions = {
        limit: 10,
        threshold: 0.35,
        quality: 'thorough',
        hyde: true,
        hydeOptions: {
          model: 'gpt-4o-mini',
        },
      }
      expect(options.limit).toBe(10)
      expect(options.threshold).toBe(0.35)
      expect(options.quality).toBe('thorough')
      expect(options.hyde).toBe(true)
    })
  })

  describe('generateHypotheticalDocument error handling', () => {
    it('should fail with ApiKeyMissingError when no API key', async () => {
      // Save and clear the environment variable
      const originalKey = process.env.OPENAI_API_KEY
      delete process.env.OPENAI_API_KEY

      try {
        const result = await Effect.runPromise(
          generateHypotheticalDocument('test query').pipe(Effect.either),
        )

        expect(result._tag).toBe('Left')
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('ApiKeyMissingError')
        }
      } finally {
        // Restore the environment variable
        if (originalKey) {
          process.env.OPENAI_API_KEY = originalKey
        }
      }
    })
  })

  describe('Query pattern detection', () => {
    describe('question patterns', () => {
      it('should detect "how" questions', () => {
        expect(shouldUseHyde('how to implement feature X')).toBe(true)
        expect(shouldUseHyde('how does the build system work')).toBe(true)
      })

      it('should detect "what" questions', () => {
        expect(shouldUseHyde('what is the recommended approach')).toBe(true)
        expect(shouldUseHyde('what are the configuration options')).toBe(true)
      })

      it('should detect "can/could/should" questions', () => {
        expect(shouldUseHyde('can I use custom validators here')).toBe(true)
        expect(shouldUseHyde('should I enable caching for this')).toBe(true)
      })

      it('should detect "is/are/does/do" questions', () => {
        expect(shouldUseHyde('is there a way to override this')).toBe(true)
        expect(shouldUseHyde('are there any known issues with')).toBe(true)
        expect(shouldUseHyde('does the API support pagination')).toBe(true)
      })
    })

    describe('procedural patterns', () => {
      it('should detect setup/install queries', () => {
        expect(shouldUseHyde('setup local development environment')).toBe(true)
        expect(shouldUseHyde('install required dependencies for testing')).toBe(
          true,
        )
      })

      it('should detect configure/implement queries', () => {
        expect(shouldUseHyde('configure database connection pooling')).toBe(
          true,
        )
        expect(shouldUseHyde('implement user session management')).toBe(true)
      })

      it('should detect fix/debug/resolve queries', () => {
        expect(shouldUseHyde('fix the authentication issue with tokens')).toBe(
          true,
        )
        expect(shouldUseHyde('debug memory leak in the application')).toBe(true)
        expect(shouldUseHyde('resolve dependency conflicts in package')).toBe(
          true,
        )
      })

      it('should detect guide/tutorial/example queries', () => {
        expect(shouldUseHyde('guide for setting up CI CD')).toBe(true)
        expect(shouldUseHyde('tutorial for building REST APIs')).toBe(true)
        expect(shouldUseHyde('example of using custom hooks')).toBe(true)
      })
    })
  })
})

describe('Export verification', () => {
  it('should export HyDE functions from types module', async () => {
    const { generateHypotheticalDocument, isHydeAvailable, shouldUseHyde } =
      await import('./hyde.js')
    expect(generateHypotheticalDocument).toBeDefined()
    expect(typeof generateHypotheticalDocument).toBe('function')
    expect(isHydeAvailable).toBeDefined()
    expect(typeof isHydeAvailable).toBe('function')
    expect(shouldUseHyde).toBeDefined()
    expect(typeof shouldUseHyde).toBe('function')
  })

  it('should export HyDE functions from main embeddings module', async () => {
    const { generateHypotheticalDocument, isHydeAvailable, shouldUseHyde } =
      await import('./index.js')
    expect(generateHypotheticalDocument).toBeDefined()
    expect(isHydeAvailable).toBeDefined()
    expect(shouldUseHyde).toBeDefined()
  })
})
