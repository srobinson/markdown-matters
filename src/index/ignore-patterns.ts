/**
 * Ignore Pattern Support Module
 *
 * Provides .gitignore and .mdmignore support using the battle-tested `ignore` npm package.
 * Implements the following precedence (highest to lowest):
 *
 * 1. CLI --exclude flag
 * 2. MDM_INDEX_EXCLUDEPATTERNS env var
 * 3. Config file excludePatterns
 * 4. .mdmignore file
 * 5. .gitignore file
 * 6. Built-in defaults: ['node_modules', '.git', 'dist', 'build']
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import ignore, { type Ignore } from 'ignore'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for building the ignore filter
 */
export interface IgnoreOptions {
  /** Root directory to search for ignore files */
  readonly rootPath: string
  /** CLI/config exclude patterns (highest priority) */
  readonly cliPatterns?: readonly string[] | undefined
  /** Whether to honor .gitignore (default: true) */
  readonly honorGitignore?: boolean | undefined
  /** Whether to honor .mdmignore (default: true) */
  readonly honorMdmignore?: boolean | undefined
}

/**
 * Result of loading ignore patterns
 */
export interface IgnoreFilterResult {
  /** The ignore filter instance */
  readonly filter: Ignore
  /** Source files that were loaded */
  readonly sources: readonly string[]
  /** Total number of patterns loaded */
  readonly patternCount: number
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default patterns always applied (lowest priority)
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
]

// ============================================================================
// File Loading
// ============================================================================

/**
 * Try to read an ignore file, returning empty string if it doesn't exist or is unreadable.
 */
const tryReadIgnoreFile = (filePath: string): Effect.Effect<string, never> =>
  Effect.tryPromise({
    try: () => fs.readFile(filePath, 'utf-8'),
    catch: () => '',
  }).pipe(Effect.catchAll(() => Effect.succeed('')))

/**
 * Parse ignore file contents, filtering out empty lines and comments.
 * Returns the number of valid patterns found.
 */
const countPatterns = (content: string): number => {
  if (!content.trim()) return 0
  return content.split('\n').filter((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('#')
  }).length
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Create an ignore filter with proper precedence.
 *
 * Loads patterns from (in order, lower priority first):
 * 1. Built-in defaults
 * 2. .gitignore (if exists and honorGitignore is true)
 * 3. .mdmignore (if exists and honorMdmignore is true)
 * 4. CLI/config patterns (highest priority)
 *
 * @example
 * ```typescript
 * const result = yield* createIgnoreFilter({
 *   rootPath: '/my/project',
 *   cliPatterns: ['*.log', 'temp/'],
 * })
 *
 * // Check if a file should be ignored
 * if (result.filter.ignores('node_modules/package/file.md')) {
 *   // Skip this file
 * }
 *
 * // Or filter an array of paths
 * const includedFiles = files.filter(result.filter.createFilter())
 * ```
 */
export const createIgnoreFilter = (
  options: IgnoreOptions,
): Effect.Effect<IgnoreFilterResult, never> =>
  Effect.gen(function* () {
    const {
      rootPath,
      cliPatterns = [],
      honorGitignore = true,
      honorMdmignore = true,
    } = options

    const ig = ignore()
    const sources: string[] = []
    let patternCount = 0

    // 1. Add defaults (lowest priority)
    ig.add(DEFAULT_IGNORE_PATTERNS as string[])
    patternCount += DEFAULT_IGNORE_PATTERNS.length

    // 2. Load .gitignore if enabled
    if (honorGitignore) {
      const gitignorePath = path.join(rootPath, '.gitignore')
      const gitignoreContent = yield* tryReadIgnoreFile(gitignorePath)
      if (gitignoreContent.trim()) {
        ig.add(gitignoreContent)
        const count = countPatterns(gitignoreContent)
        patternCount += count
        sources.push('.gitignore')
      }
    }

    // 3. Load .mdmignore if enabled
    if (honorMdmignore) {
      const mdmignorePath = path.join(rootPath, '.mdmignore')
      const mdmignoreContent = yield* tryReadIgnoreFile(mdmignorePath)
      if (mdmignoreContent.trim()) {
        ig.add(mdmignoreContent)
        const count = countPatterns(mdmignoreContent)
        patternCount += count
        sources.push('.mdmignore')
      }
    }

    // 4. Add CLI/config patterns (highest priority)
    if (cliPatterns.length > 0) {
      ig.add(cliPatterns as string[])
      patternCount += cliPatterns.length
      sources.push('CLI/config')
    }

    return {
      filter: ig,
      sources,
      patternCount,
    }
  })

/**
 * Check if a path should be ignored.
 *
 * This is a convenience wrapper around createIgnoreFilter for single-path checks.
 * For checking multiple paths, prefer creating the filter once and reusing it.
 *
 * @param relativePath - Path relative to root (e.g., 'src/foo/bar.md')
 * @param filter - The ignore filter instance
 * @returns true if the path should be ignored
 */
export const shouldIgnore = (relativePath: string, filter: Ignore): boolean => {
  // The ignore package requires paths without leading slash
  const normalized = relativePath.replace(/^\//, '')
  return filter.ignores(normalized)
}

/**
 * Create a filter function suitable for Array.filter().
 *
 * @example
 * ```typescript
 * const result = yield* createIgnoreFilter({ rootPath })
 * const filterFn = createFilterFunction(result.filter)
 * const includedFiles = files.filter(filterFn)
 * ```
 */
export const createFilterFunction = (
  filter: Ignore,
): ((relativePath: string) => boolean) => {
  const innerFilter = filter.createFilter()
  return (relativePath: string) => {
    // The ignore package's createFilter returns true for non-ignored files
    const normalized = relativePath.replace(/^\//, '')
    return innerFilter(normalized)
  }
}

/**
 * Get ignore patterns as an array of strings for chokidar.
 *
 * Chokidar uses anymatch which accepts globs, so we convert
 * the ignore patterns to glob format.
 *
 * @param options - Ignore options
 * @returns Array of patterns suitable for chokidar's `ignored` option
 */
export const getChokidarIgnorePatterns = (
  options: IgnoreOptions,
): Effect.Effect<string[], never> =>
  Effect.gen(function* () {
    const {
      rootPath,
      cliPatterns = [],
      honorGitignore = true,
      honorMdmignore = true,
    } = options

    const patterns: string[] = []

    // Always ignore dotfiles (chokidar regex format)
    patterns.push(/(^|[/\\])\./.source)

    // Add defaults
    for (const p of DEFAULT_IGNORE_PATTERNS) {
      patterns.push(`**/${p}/**`)
    }

    // Load .gitignore patterns
    if (honorGitignore) {
      const gitignorePath = path.join(rootPath, '.gitignore')
      const content = yield* tryReadIgnoreFile(gitignorePath)
      if (content.trim()) {
        const parsed = parseIgnoreFile(content)
        for (const p of parsed) {
          patterns.push(convertToGlob(p))
        }
      }
    }

    // Load .mdmignore patterns
    if (honorMdmignore) {
      const mdmignorePath = path.join(rootPath, '.mdmignore')
      const content = yield* tryReadIgnoreFile(mdmignorePath)
      if (content.trim()) {
        const parsed = parseIgnoreFile(content)
        for (const p of parsed) {
          patterns.push(convertToGlob(p))
        }
      }
    }

    // Add CLI patterns
    for (const p of cliPatterns) {
      patterns.push(convertToGlob(p))
    }

    return patterns
  })

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse ignore file content into individual patterns
 */
const parseIgnoreFile = (content: string): string[] => {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/**
 * Convert a gitignore pattern to glob format for chokidar
 */
const convertToGlob = (pattern: string): string => {
  // Negation patterns - keep as is for now (chokidar handles them differently)
  if (pattern.startsWith('!')) {
    return pattern
  }

  // Already a glob pattern
  if (pattern.includes('*') || pattern.includes('/')) {
    return pattern.startsWith('/') ? pattern.slice(1) : `**/${pattern}`
  }

  // Simple name - match anywhere
  return `**/${pattern}/**`
}
