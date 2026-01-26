/**
 * Fuzzy Search Utilities
 *
 * Provides stemming and fuzzy matching capabilities for search:
 * - Porter stemmer for word normalization (fail -> fail, failure -> failur)
 * - Levenshtein distance for typo tolerance
 */

import { stemmer } from 'stemmer'

// ============================================================================
// Stemming
// ============================================================================

/**
 * Apply Porter stemmer to a word
 */
export const stem = (word: string): string => {
  return stemmer(word.toLowerCase())
}

/**
 * Stem all words in a text
 */
export const stemText = (text: string): string[] => {
  return text
    .toLowerCase()
    .split(/[\W_]+/)
    .filter((word) => word.length > 0)
    .map((word) => stem(word))
}

/**
 * Get unique stems from text
 */
export const getStems = (text: string): Set<string> => {
  return new Set(stemText(text))
}

// ============================================================================
// Fuzzy Matching (Levenshtein Distance)
// ============================================================================

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
 * Check if two words are fuzzy matches within a given distance
 */
export const isFuzzyMatch = (
  word1: string,
  word2: string,
  maxDistance: number = 2,
): boolean => {
  // Quick length check - can't be a match if lengths differ too much
  if (Math.abs(word1.length - word2.length) > maxDistance) {
    return false
  }

  return (
    levenshteinDistance(word1.toLowerCase(), word2.toLowerCase()) <= maxDistance
  )
}

/**
 * Find fuzzy matches for a word in a list of words
 */
export const findFuzzyMatches = (
  query: string,
  words: readonly string[],
  maxDistance: number = 2,
): string[] => {
  const lowerQuery = query.toLowerCase()
  return words.filter((word) =>
    isFuzzyMatch(lowerQuery, word.toLowerCase(), maxDistance),
  )
}

// ============================================================================
// Combined Matching Options
// ============================================================================

export interface MatchOptions {
  /** Use stemming for word matching */
  readonly stem?: boolean | undefined
  /** Use fuzzy matching with this max edit distance */
  readonly fuzzyDistance?: number | undefined
}

/**
 * Check if query matches text with stemming and/or fuzzy matching
 */
export const matchesWithOptions = (
  query: string,
  text: string,
  options: MatchOptions = {},
): boolean => {
  const { stem: useStemming, fuzzyDistance } = options

  // Get words from query and text
  const queryWords = query
    .toLowerCase()
    .split(/[\W_]+/)
    .filter((w) => w.length > 0)
  const textWords = text
    .toLowerCase()
    .split(/[\W_]+/)
    .filter((w) => w.length > 0)

  if (queryWords.length === 0) {
    return true // Empty query matches everything
  }

  // For each query word, check if it matches any text word
  for (const queryWord of queryWords) {
    let found = false

    for (const textWord of textWords) {
      // Exact match (case-insensitive)
      if (textWord === queryWord) {
        found = true
        break
      }

      // Stemming match
      if (useStemming) {
        if (stem(textWord) === stem(queryWord)) {
          found = true
          break
        }
      }

      // Fuzzy match
      if (fuzzyDistance !== undefined && fuzzyDistance > 0) {
        if (isFuzzyMatch(textWord, queryWord, fuzzyDistance)) {
          found = true
          break
        }
      }
    }

    if (!found) {
      return false // All query words must match
    }
  }

  return true
}

/**
 * Check if a line contains a match using stemming/fuzzy options
 * Returns the matching word(s) if found
 *
 * Uses Set for O(1) duplicate checking instead of array.includes() O(k)
 */
export const findMatchesInLine = (
  queryWords: readonly string[],
  line: string,
  options: MatchOptions = {},
): string[] => {
  const { stem: useStemming, fuzzyDistance } = options
  const matchesSet = new Set<string>()

  const lineWords = line
    .toLowerCase()
    .split(/[\W_]+/)
    .filter((w) => w.length > 0)

  for (const queryWord of queryWords) {
    const queryLower = queryWord.toLowerCase()
    const queryStem = useStemming ? stem(queryWord) : null

    for (const lineWord of lineWords) {
      // Skip if already matched (O(1) lookup)
      if (matchesSet.has(lineWord)) {
        continue
      }

      // Exact match
      if (lineWord === queryLower) {
        matchesSet.add(lineWord)
        continue
      }

      // Stemming match
      if (queryStem && stem(lineWord) === queryStem) {
        matchesSet.add(lineWord)
        continue
      }

      // Fuzzy match
      if (
        fuzzyDistance !== undefined &&
        fuzzyDistance > 0 &&
        isFuzzyMatch(lineWord, queryLower, fuzzyDistance)
      ) {
        matchesSet.add(lineWord)
      }
    }
  }

  return Array.from(matchesSet)
}

/**
 * Build a regex pattern that matches stemmed variations of query terms
 * For highlighting purposes
 */
export const buildFuzzyHighlightPattern = (
  query: string,
  options: MatchOptions = {},
): RegExp => {
  const { stem: useStemming } = options

  const queryWords = query
    .toLowerCase()
    .split(/[\W_]+/)
    .filter((w) => w.length > 0)

  if (queryWords.length === 0) {
    return /.^/ // Match nothing
  }

  // Build patterns for each query word
  const patterns: string[] = []

  for (const word of queryWords) {
    // Escape special regex chars
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    if (useStemming) {
      // Match words that share the same stem
      // We do this by matching the stem as a prefix followed by optional suffix
      const wordStem = stem(word)
      const escapedStem = wordStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Match the stem followed by common suffixes
      patterns.push(`\\b${escapedStem}\\w*\\b`)
    } else {
      // Exact word match
      patterns.push(`\\b${escaped}\\b`)
    }
  }

  return new RegExp(patterns.join('|'), 'gi')
}
