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

interface ScopedIgnore {
  readonly base: string
  readonly filter: Ignore
}

/** Ignore rules grouped by precedence tier and directory scope. */
export interface IgnoreHierarchy {
  readonly rootPath: string
  readonly defaults: Ignore
  readonly git: readonly ScopedIgnore[]
  readonly mdm: readonly ScopedIgnore[]
  readonly cli: Ignore
  readonly sources: readonly string[]
  readonly patternCount: number
  readonly honorGitignore: boolean
  readonly honorMdmignore: boolean
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

interface LoadedScopedIgnore {
  readonly scoped: ScopedIgnore
  readonly source: string
  readonly patternCount: number
}

const loadScopedIgnore = (
  rootPath: string,
  directory: string,
  filename: '.gitignore' | '.mdmignore',
): Effect.Effect<LoadedScopedIgnore | undefined, never> =>
  Effect.gen(function* () {
    const filePath = path.join(directory, filename)
    const content = yield* tryReadIgnoreFile(filePath)
    if (!content.trim()) return undefined

    return {
      scoped: { base: directory, filter: ignore().add(content) },
      source: path.relative(rootPath, filePath).split(path.sep).join('/'),
      patternCount: countPatterns(content),
    }
  })

// ============================================================================
// Main API
// ============================================================================

/**
 * Create the root ignore hierarchy with proper precedence.
 *
 * Loads patterns from (in order, lower priority first):
 * 1. Built-in defaults
 * 2. .gitignore (if exists and honorGitignore is true)
 * 3. .mdmignore (if exists and honorMdmignore is true)
 * 4. CLI/config patterns (highest priority)
 *
 * @example
 * ```typescript
 * const hierarchy = yield* createIgnoreFilter({
 *   rootPath: '/my/project',
 *   cliPatterns: ['*.log', 'temp/'],
 * })
 *
 * // Check if a file should be ignored
 * if (shouldIgnore('node_modules/package/file.md', hierarchy)) {
 *   // Skip this file
 * }
 * ```
 */
export const createIgnoreFilter = (
  options: IgnoreOptions,
): Effect.Effect<IgnoreHierarchy, never> =>
  Effect.gen(function* () {
    const {
      rootPath,
      cliPatterns = [],
      honorGitignore = true,
      honorMdmignore = true,
    } = options

    const hierarchy: IgnoreHierarchy = {
      rootPath,
      defaults: ignore().add([...DEFAULT_IGNORE_PATTERNS]),
      git: [],
      mdm: [],
      cli: ignore().add([...cliPatterns]),
      sources: cliPatterns.length > 0 ? ['CLI/config'] : [],
      patternCount: DEFAULT_IGNORE_PATTERNS.length + cliPatterns.length,
      honorGitignore,
      honorMdmignore,
    }

    return yield* extendIgnoreHierarchy(hierarchy, rootPath)
  })

/** Add ignore files from a directory after traversal has admitted it. */
export const extendIgnoreHierarchy = (
  parent: IgnoreHierarchy,
  directory: string,
): Effect.Effect<IgnoreHierarchy, never> =>
  Effect.gen(function* () {
    const git = parent.honorGitignore
      ? yield* loadScopedIgnore(parent.rootPath, directory, '.gitignore')
      : undefined
    const mdm = parent.honorMdmignore
      ? yield* loadScopedIgnore(parent.rootPath, directory, '.mdmignore')
      : undefined
    const loaded = [git, mdm].filter(
      (value): value is LoadedScopedIgnore => value !== undefined,
    )

    return {
      ...parent,
      git: git ? [...parent.git, git.scoped] : parent.git,
      mdm: mdm ? [...parent.mdm, mdm.scoped] : parent.mdm,
      sources: [...parent.sources, ...loaded.map((value) => value.source)],
      patternCount:
        parent.patternCount +
        loaded.reduce((total, value) => total + value.patternCount, 0),
    }
  })

const decision = (
  rootPath: string,
  scoped: ScopedIgnore,
  relativePath: string,
  directory: boolean,
): boolean | undefined => {
  const local = path
    .relative(scoped.base, path.join(rootPath, relativePath))
    .split(path.sep)
    .join('/')
  if (local === '..' || local.startsWith('../')) return undefined
  const tested = scoped.filter.test(directory ? `${local}/` : local)
  return tested.ignored ? true : tested.unignored ? false : undefined
}

/** Evaluate one traversal candidate through all precedence tiers. */
export const shouldIgnore = (
  relativePath: string,
  hierarchy: IgnoreHierarchy,
  directory = false,
): boolean => {
  const candidate = relativePath
    .replace(/^[/\\]+/, '')
    .split(path.sep)
    .join('/')
  const testedCandidate = directory ? `${candidate}/` : candidate
  let ignored = hierarchy.defaults.ignores(testedCandidate)

  for (const tier of [hierarchy.git, hierarchy.mdm] as const) {
    for (const scoped of tier) {
      ignored =
        decision(hierarchy.rootPath, scoped, candidate, directory) ?? ignored
    }
  }

  const cliDecision = decision(
    hierarchy.rootPath,
    { base: hierarchy.rootPath, filter: hierarchy.cli },
    candidate,
    directory,
  )
  return cliDecision ?? ignored
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
