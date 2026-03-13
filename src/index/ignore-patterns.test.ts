/**
 * Unit tests for ignore patterns module
 *
 * Tests verify:
 * - Pattern matching (globs, negation, comments, directory-only)
 * - Precedence (CLI > .mdmignore > .gitignore > defaults)
 * - Edge cases (missing files, empty files, invalid patterns)
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createFilterFunction,
  createIgnoreFilter,
  DEFAULT_IGNORE_PATTERNS,
  getChokidarIgnorePatterns,
  shouldIgnore,
} from './ignore-patterns.js'

describe('Ignore Patterns Module', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdcontext-ignore-test-'))
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  // ==========================================================================
  // Pattern Matching
  // ==========================================================================

  describe('Pattern Matching', () => {
    it('matches glob patterns (*.log)', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n')

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      expect(shouldIgnore('debug.log', result.filter)).toBe(true)
      expect(shouldIgnore('app.log', result.filter)).toBe(true)
      expect(shouldIgnore('app.txt', result.filter)).toBe(false)
    })

    it('matches deep glob patterns (**/*.tmp)', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '**/*.tmp\n')

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      expect(shouldIgnore('file.tmp', result.filter)).toBe(true)
      expect(shouldIgnore('src/file.tmp', result.filter)).toBe(true)
      expect(shouldIgnore('src/deep/file.tmp', result.filter)).toBe(true)
      expect(shouldIgnore('src/file.md', result.filter)).toBe(false)
    })

    it('handles negation patterns (!important.log)', async () => {
      await fs.writeFile(
        path.join(testDir, '.gitignore'),
        '*.log\n!important.log\n',
      )

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      expect(shouldIgnore('debug.log', result.filter)).toBe(true)
      expect(shouldIgnore('important.log', result.filter)).toBe(false)
    })

    it('ignores comments (# ignore this)', async () => {
      await fs.writeFile(
        path.join(testDir, '.gitignore'),
        '# This is a comment\n*.log\n# Another comment\n',
      )

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      // Comments should not affect pattern matching
      expect(shouldIgnore('debug.log', result.filter)).toBe(true)
      expect(shouldIgnore('# This is a comment', result.filter)).toBe(false)
    })

    it('matches directory-only patterns (node_modules/)', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), 'build/\n')

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      expect(shouldIgnore('build/output.js', result.filter)).toBe(true)
      expect(shouldIgnore('build', result.filter)).toBe(true)
    })
  })

  // ==========================================================================
  // Precedence
  // ==========================================================================

  describe('Precedence', () => {
    it('CLI patterns override .mdmignore', async () => {
      await fs.writeFile(
        path.join(testDir, '.mdmignore'),
        '*.md\n!important.md\n',
      )

      const result = await Effect.runPromise(
        createIgnoreFilter({
          rootPath: testDir,
          cliPatterns: ['important.md'], // CLI says ignore it
        }),
      )

      // CLI takes precedence - important.md should be ignored
      expect(shouldIgnore('important.md', result.filter)).toBe(true)
    })

    it('.mdmignore overrides .gitignore', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.md\n')
      await fs.writeFile(
        path.join(testDir, '.mdmignore'),
        '!README.md\n', // Allow README.md
      )

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      // .mdmignore negation should override .gitignore
      expect(shouldIgnore('README.md', result.filter)).toBe(false)
      expect(shouldIgnore('other.md', result.filter)).toBe(true)
    })

    it('later rules override earlier (gitignore behavior)', async () => {
      await fs.writeFile(
        path.join(testDir, '.gitignore'),
        '*.md\n!important.md\nimportant.md\n', // Re-ignore important.md
      )

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      // Last rule wins - important.md should be ignored again
      expect(shouldIgnore('important.md', result.filter)).toBe(true)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles missing .gitignore gracefully', async () => {
      // No .gitignore file exists
      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      // Should still work with defaults
      expect(result.filter).toBeDefined()
      expect(result.sources).not.toContain('.gitignore')
      expect(shouldIgnore('node_modules/pkg/file.js', result.filter)).toBe(true)
    })

    it('handles missing .mdmignore gracefully', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n')
      // No .mdmignore file exists

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      expect(result.sources).toContain('.gitignore')
      expect(result.sources).not.toContain('.mdmignore')
    })

    it('handles empty files', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '')
      await fs.writeFile(path.join(testDir, '.mdmignore'), '   \n\n')

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      // Should work with just defaults
      expect(result.filter).toBeDefined()
      expect(result.sources).not.toContain('.gitignore')
      expect(result.sources).not.toContain('.mdmignore')
    })

    it('handles whitespace-only patterns (skipped)', async () => {
      await fs.writeFile(
        path.join(testDir, '.gitignore'),
        '   \n\n*.log\n   \n',
      )

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      // Should skip whitespace lines
      expect(shouldIgnore('debug.log', result.filter)).toBe(true)
    })
  })

  // ==========================================================================
  // Default Patterns
  // ==========================================================================

  describe('Default Patterns', () => {
    it('includes node_modules in defaults', () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain('node_modules')
    })

    it('includes .git in defaults', () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain('.git')
    })

    it('includes dist in defaults', () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain('dist')
    })

    it('includes build in defaults', () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain('build')
    })

    it('applies defaults without any ignore files', async () => {
      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      expect(shouldIgnore('node_modules/pkg/index.js', result.filter)).toBe(
        true,
      )
      expect(shouldIgnore('dist/bundle.js', result.filter)).toBe(true)
      expect(shouldIgnore('build/output.js', result.filter)).toBe(true)
      expect(shouldIgnore('.git/config', result.filter)).toBe(true)
    })
  })

  // ==========================================================================
  // Honor Flags
  // ==========================================================================

  describe('Honor Flags', () => {
    it('respects honorGitignore=false', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.secret\n')

      const result = await Effect.runPromise(
        createIgnoreFilter({
          rootPath: testDir,
          honorGitignore: false,
        }),
      )

      // .gitignore patterns should not be applied
      expect(shouldIgnore('password.secret', result.filter)).toBe(false)
      expect(result.sources).not.toContain('.gitignore')
    })

    it('respects honorMdmignore=false', async () => {
      await fs.writeFile(path.join(testDir, '.mdmignore'), 'drafts/\n')

      const result = await Effect.runPromise(
        createIgnoreFilter({
          rootPath: testDir,
          honorMdmignore: false,
        }),
      )

      // .mdmignore patterns should not be applied
      expect(shouldIgnore('drafts/doc.md', result.filter)).toBe(false)
      expect(result.sources).not.toContain('.mdmignore')
    })
  })

  // ==========================================================================
  // Filter Function
  // ==========================================================================

  describe('createFilterFunction', () => {
    it('creates a function suitable for Array.filter', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n')

      const result = await Effect.runPromise(
        createIgnoreFilter({ rootPath: testDir }),
      )

      const filterFn = createFilterFunction(result.filter)
      const files = ['app.md', 'debug.log', 'src/index.ts', 'error.log']
      const filtered = files.filter(filterFn)

      expect(filtered).toEqual(['app.md', 'src/index.ts'])
    })
  })

  // ==========================================================================
  // Chokidar Patterns
  // ==========================================================================

  describe('getChokidarIgnorePatterns', () => {
    it('returns patterns suitable for chokidar', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n')

      const patterns = await Effect.runPromise(
        getChokidarIgnorePatterns({ rootPath: testDir }),
      )

      expect(patterns.length).toBeGreaterThan(0)
      // Should include a regex string for dotfiles
      expect(patterns.some((p) => typeof p === 'string')).toBe(true)
    })

    it('includes default patterns', async () => {
      const patterns = await Effect.runPromise(
        getChokidarIgnorePatterns({ rootPath: testDir }),
      )

      // Should have patterns for node_modules, etc.
      expect(patterns.some((p) => p.includes('node_modules'))).toBe(true)
    })
  })

  // ==========================================================================
  // Pattern Count
  // ==========================================================================

  describe('Pattern Count', () => {
    it('counts patterns from all sources', async () => {
      await fs.writeFile(path.join(testDir, '.gitignore'), '*.log\n*.tmp\n')
      await fs.writeFile(path.join(testDir, '.mdmignore'), 'drafts/\n')

      const result = await Effect.runPromise(
        createIgnoreFilter({
          rootPath: testDir,
          cliPatterns: ['*.bak'],
        }),
      )

      // 4 defaults + 2 gitignore + 1 mdmignore + 1 CLI = 8
      expect(result.patternCount).toBe(8)
    })
  })
})
