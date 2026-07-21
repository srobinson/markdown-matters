/**
 * Path matching utilities for search filtering.
 *
 * Simple glob-like pattern matching for document paths.
 */

import * as path from 'node:path'
import { Effect } from 'effect'
import {
  type DocumentKey,
  resolveCanonicalPathOrFallbackAsync,
  resolveSourceFile,
} from '../db/canonical.js'

export const resolveCanonicalSourceRoot = (sourceRoot: string) =>
  Effect.promise(() => resolveCanonicalPathOrFallbackAsync(sourceRoot))

export const escapePathPatternLiteral = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('*', '\\*').replaceAll('?', '\\?')

/**
 * Match a file path against a glob-like pattern.
 *
 * Supports:
 * - `**` matches any characters including directory separators (recursive)
 * - `*` matches any characters except directory separators (single segment)
 * - `?` matches exactly one character (not directory separator)
 * - `.` is treated literally
 *
 * @param filePath - The file path to test
 * @param pattern - The glob pattern (e.g., "docs/*", "src/api/*.md", "src/** /*.ts")
 * @returns True if the path matches the pattern
 */
export const matchPath = (filePath: string, pattern: string): boolean => {
  const ESCAPED_BACKSLASH_PLACEHOLDER = '\u0000ESCAPED_BACKSLASH\u0000'
  const ESCAPED_STAR_PLACEHOLDER = '\u0000ESCAPED_STAR\u0000'
  const ESCAPED_QUESTION_PLACEHOLDER = '\u0000ESCAPED_QUESTION\u0000'
  const DOUBLE_STAR_PLACEHOLDER = '\u0000DOUBLE_STAR\u0000'

  const regexPattern = pattern
    .replace(/\\\\/g, ESCAPED_BACKSLASH_PLACEHOLDER)
    .replace(/\\\*/g, ESCAPED_STAR_PLACEHOLDER)
    .replace(/\\\?/g, ESCAPED_QUESTION_PLACEHOLDER)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape all regex special chars first
    .replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER) // Preserve ** before processing *
    .replace(/\*/g, '[^/]*') // Single * doesn't match slashes
    .replace(/\?/g, '[^/]') // ? matches any single non-slash char
    .replaceAll(DOUBLE_STAR_PLACEHOLDER, '.*') // ** matches anything
    .replaceAll(ESCAPED_BACKSLASH_PLACEHOLDER, '\\\\')
    .replaceAll(ESCAPED_STAR_PLACEHOLDER, '\\*')
    .replaceAll(ESCAPED_QUESTION_PLACEHOLDER, '\\?')

  const regex = new RegExp(`^${regexPattern}$`, 'i')
  return regex.test(filePath)
}

export const matchesDocumentPath = (
  sourceRoot: string,
  documentPath: DocumentKey,
  pattern: string | undefined,
): boolean => {
  if (pattern === undefined) return true
  const relativePath = path
    .relative(sourceRoot, resolveSourceFile(documentPath))
    .split(path.sep)
    .join('/')
  return matchPath(relativePath, pattern)
}
