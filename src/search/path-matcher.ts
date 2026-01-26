/**
 * Path matching utilities for search filtering.
 *
 * Simple glob-like pattern matching for document paths.
 */

/**
 * Match a file path against a glob-like pattern.
 *
 * Supports:
 * - `*` matches any characters (including none)
 * - `?` matches exactly one character
 * - `.` is treated literally
 *
 * @param filePath - The file path to test
 * @param pattern - The glob pattern (e.g., "docs/*", "src/api/*.md")
 * @returns True if the path matches the pattern
 */
export const matchPath = (filePath: string, pattern: string): boolean => {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')

  const regex = new RegExp(`^${regexPattern}$`, 'i')
  return regex.test(filePath)
}
