/**
 * Unit tests for argv-preprocessor
 */

import { describe, expect, it } from 'vitest'
import { preprocessArgvWithValidation } from './argv-preprocessor.js'

describe('preprocessArgvWithValidation', () => {
  const node = '/usr/bin/node'
  const script = '/path/to/mdm'

  describe('flag reordering', () => {
    it('reorders flags before positional args', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'search',
        'query',
        '--limit',
        '5',
        'docs/',
      ])
      expect(result.argv).toEqual([
        node,
        script,
        'search',
        '--limit',
        '5',
        'query',
        'docs/',
      ])
      expect(result.error).toBeUndefined()
    })

    it('handles --flag=value syntax', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'search',
        'query',
        '--limit=5',
        'docs/',
      ])
      expect(result.argv).toEqual([
        node,
        script,
        'search',
        '--limit=5',
        'query',
        'docs/',
      ])
      expect(result.error).toBeUndefined()
    })

    it('handles boolean flags', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'context',
        'file.md',
        '--brief',
      ])
      expect(result.argv).toEqual([
        node,
        script,
        'context',
        '--brief',
        'file.md',
      ])
      expect(result.error).toBeUndefined()
    })

    it('accepts the semantic rebuild flag', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'index',
        '--force-embed',
      ])
      expect(result.argv).toEqual([node, script, 'index', '--force-embed'])
      expect(result.error).toBeUndefined()
    })

    it('passes through --help flag', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'context',
        '--help',
      ])
      expect(result.argv).toEqual([node, script, 'context', '--help'])
      expect(result.error).toBeUndefined()
    })
  })

  describe('unknown flag detection', () => {
    it('returns error for unknown flag', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'context',
        '-z',
        'file.md',
      ])
      expect(result.error).toContain("Unknown option '-z'")
      expect(result.error).toContain("'context'")
    })

    it('returns error for unknown long flag', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'search',
        '--invalid',
        'query',
      ])
      expect(result.error).toContain("Unknown option '--invalid'")
    })

    it('returns error for unknown flag with value', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'context',
        '--foo=bar',
        'file.md',
      ])
      expect(result.error).toContain("Unknown option '--foo'")
    })
  })

  describe('typo suggestions', () => {
    it('suggests --json for --jsno', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'context',
        '--jsno',
        'file.md',
      ])
      expect(result.error).toContain("Did you mean '--json'")
    })

    it('suggests --limit for --limt', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'search',
        '--limt',
        '5',
        'query',
      ])
      expect(result.error).toContain("Did you mean '--limit'")
    })

    it('suggests --tokens for --toekns', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'context',
        '--toekns',
        '100',
        'file.md',
      ])
      expect(result.error).toContain("Did you mean '--tokens'")
    })
  })

  describe('edge cases', () => {
    it('passes through empty args', () => {
      const result = preprocessArgvWithValidation([node, script])
      expect(result.argv).toEqual([node, script])
      expect(result.error).toBeUndefined()
    })

    it('passes through unknown subcommand', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'unknown',
        '--flag',
      ])
      // Unknown subcommand should pass through (no schema)
      expect(result.argv).toEqual([node, script, 'unknown', '--flag'])
      expect(result.error).toBeUndefined()
    })

    it('handles -- end of flags marker', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'context',
        '--',
        '--not-a-flag',
        'file.md',
      ])
      // After --, everything is positional
      expect(result.argv).toEqual([
        node,
        script,
        'context',
        '--not-a-flag',
        'file.md',
      ])
      expect(result.error).toBeUndefined()
    })

    it('validates alias flags', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'context',
        '-t',
        '100',
        'file.md',
      ])
      expect(result.error).toBeUndefined()
      expect(result.argv).toContain('-t')
    })
  })

  describe('negative numeric values', () => {
    it('--threshold -1 should pass -1 as the value, not as a flag', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'search',
        'query',
        '--threshold',
        '-1',
      ])
      expect(result.error).toBeUndefined()
      expect(result.argv).toEqual([
        node,
        script,
        'search',
        '--threshold',
        '-1',
        'query',
      ])
    })

    it('--fuzzy-distance -1 should pass -1 as the value', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'search',
        'query',
        '--fuzzy-distance',
        '-1',
      ])
      expect(result.error).toBeUndefined()
      expect(result.argv).toEqual([
        node,
        script,
        'search',
        '--fuzzy-distance',
        '-1',
        'query',
      ])
    })

    it('--tokens -1 should pass -1 as the value', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'context',
        'README.md',
        '--tokens',
        '-1',
      ])
      expect(result.error).toBeUndefined()
      expect(result.argv).toEqual([
        node,
        script,
        'context',
        '--tokens',
        '-1',
        'README.md',
      ])
    })

    it('--threshold -0.5 should pass -0.5 as the value', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'search',
        'query',
        '--threshold',
        '-0.5',
      ])
      expect(result.error).toBeUndefined()
      expect(result.argv).toContain('-0.5')
    })

    it('non-numeric flag after value flag should still be rejected', () => {
      const result = preprocessArgvWithValidation([
        node,
        script,
        'search',
        'query',
        '--threshold',
        '--unknown',
      ])
      // --unknown is not a negative number and not a valid flag
      expect(result.error).toBeDefined()
    })
  })
})
