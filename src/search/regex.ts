import { Effect } from 'effect'
import { CliValidationError } from '../errors/index.js'

const MAX_REGEX_LENGTH = 200

export const isCatastrophicPattern = (pattern: string): boolean => {
  const stripped = pattern.replace(/\\./g, '')
  if (/\([^)]*[+*?][^)]*\)[+*?{]/.test(stripped)) return true

  if (/\([^)]*\|[^)]*\)[+*?{]/.test(stripped)) {
    const groupMatch = stripped.match(/\(([^)]*)\)[+*?{]/)
    if (groupMatch?.[1]) {
      const branches = groupMatch[1].split('|')
      if (branches.length >= 2) {
        if (branches.some((branch) => branch.includes('.'))) return true

        const characterSets = branches.map(
          (branch) => new Set(branch.replace(/[^a-zA-Z0-9]/g, '')),
        )
        for (let left = 0; left < characterSets.length; left++) {
          for (let right = left + 1; right < characterSets.length; right++) {
            const leftSet = characterSets[left] as Set<string>
            const rightSet = characterSets[right] as Set<string>
            for (const character of leftSet) {
              if (rightSet.has(character)) return true
            }
          }
        }
      }
    }
  }
  return false
}

export const safeRegex = (
  pattern: string,
  flags: string,
): Effect.Effect<RegExp, CliValidationError> => {
  if (pattern.length > MAX_REGEX_LENGTH) {
    return Effect.fail(
      new CliValidationError({
        message: `Regex pattern too long (${pattern.length} chars, max ${MAX_REGEX_LENGTH})`,
      }),
    )
  }
  if (isCatastrophicPattern(pattern)) {
    return Effect.fail(
      new CliValidationError({
        message: `Regex pattern rejected: potentially catastrophic backtracking in "${pattern}"`,
      }),
    )
  }
  return Effect.try({
    try: () => new RegExp(pattern, flags),
    catch: (cause) =>
      new CliValidationError({
        message: `Invalid regex pattern: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  })
}
