/**
 * Typo Suggester
 *
 * Uses Levenshtein distance to suggest correct flags when users mistype.
 */

import type { CommandSchema } from './flag-schemas.js'

/**
 * Calculate Levenshtein distance between two strings
 */
export const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = []

  // Initialize first column
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i]
  }

  // Initialize first row
  for (let j = 0; j <= b.length; j++) {
    matrix[0]![j] = j
  }

  // Fill in the rest
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1, // deletion
        matrix[i]![j - 1]! + 1, // insertion
        matrix[i - 1]![j - 1]! + cost, // substitution
      )
    }
  }

  return matrix[a.length]![b.length]!
}

/**
 * Suggestion result
 */
export interface Suggestion {
  flag: string
  distance: number
  description: string | undefined
}

/**
 * Find the best flag suggestion for a typo
 *
 * @param typo - The mistyped flag (e.g., '--jsno')
 * @param schema - The command schema to search
 * @param maxDistance - Maximum Levenshtein distance to consider (default: 2)
 * @returns Best matching flag or undefined
 */
export const suggestFlag = (
  typo: string,
  schema: CommandSchema,
  maxDistance: number = 2,
): Suggestion | undefined => {
  // Normalize the typo (remove leading dashes for comparison)
  const normalizedTypo = typo.replace(/^-+/, '')

  let bestMatch: Suggestion | undefined
  let bestDistance = Infinity

  for (const spec of schema.flags) {
    // Check against full flag name
    const flagName = spec.name
    const distance = levenshteinDistance(normalizedTypo, flagName)

    if (distance <= maxDistance && distance < bestDistance) {
      bestDistance = distance
      bestMatch = {
        flag: `--${spec.name}`,
        distance,
        description: spec.description,
      }
    }

    // Also check against alias if present
    if (spec.alias) {
      const aliasDistance = levenshteinDistance(normalizedTypo, spec.alias)
      if (aliasDistance <= maxDistance && aliasDistance < bestDistance) {
        bestDistance = aliasDistance
        bestMatch = {
          flag: `--${spec.name}`,
          distance: aliasDistance,
          description: spec.description,
        }
      }
    }
  }

  // Prefer exact prefix matches (e.g., '--js' should suggest '--json')
  if (!bestMatch || bestDistance > 0) {
    for (const spec of schema.flags) {
      if (spec.name.startsWith(normalizedTypo)) {
        // Prefix match - this is likely what they meant
        const prefixDistance = spec.name.length - normalizedTypo.length
        if (prefixDistance <= maxDistance && prefixDistance < bestDistance) {
          bestDistance = prefixDistance
          bestMatch = {
            flag: `--${spec.name}`,
            distance: prefixDistance,
            description: spec.description,
          }
        }
      }
    }
  }

  return bestMatch
}

/**
 * Format a list of valid flags for a command
 */
export const formatValidFlags = (schema: CommandSchema): string => {
  const lines: string[] = []

  for (const spec of schema.flags) {
    const alias = spec.alias ? `, -${spec.alias}` : ''
    const desc = spec.description ? `  ${spec.description}` : ''
    lines.push(`  --${spec.name}${alias}${desc}`)
  }

  return lines.join('\n')
}
