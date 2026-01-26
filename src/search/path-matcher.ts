/**
 * Path matching utilities for search filtering.
 *
 * Simple glob-like pattern matching for document paths.
 */

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
  // Use a placeholder for ** to avoid it being processed by single * replacement
  const DOUBLE_STAR_PLACEHOLDER = '__DOUBLE_STAR_MARKER__'

  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape all regex special chars first
    .replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER) // Preserve ** before processing *
    .replace(/\*/g, '[^/]*') // Single * doesn't match slashes
    .replace(/\?/g, '[^/]') // ? matches any single non-slash char
    .replace(new RegExp(DOUBLE_STAR_PLACEHOLDER, 'g'), '.*') // ** matches anything

  const regex = new RegExp(`^${regexPattern}$`, 'i')
  return regex.test(filePath)
}
