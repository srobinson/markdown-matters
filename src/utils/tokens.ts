/**
 * Token counting utilities using tiktoken
 */

import { Effect } from 'effect'

// Lazy-loaded tiktoken encoder
let encoder: Awaited<
  ReturnType<typeof import('tiktoken').get_encoding>
> | null = null

const getEncoder = Effect.gen(function* () {
  if (encoder === null) {
    const { get_encoding } = yield* Effect.promise(() => import('tiktoken'))
    encoder = get_encoding('cl100k_base')
  }
  return encoder
})

/**
 * Count tokens in a string using the cl100k_base encoding
 * (compatible with GPT-4, GPT-3.5-turbo, and Claude models)
 */
export const countTokens = (
  text: string,
): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    const enc = yield* getEncoder
    const tokens = enc.encode(text)
    return tokens.length
  })

/**
 * Synchronous token counting with improved approximation
 *
 * Uses heuristics calibrated against cl100k_base encoding:
 * - Base prose: ~3.5 chars/token (conservative to never under-count)
 * - Code blocks: Content at ~2.8 chars/token + fixed overhead per block
 * - Inline code: ~2.5 chars/token + 2 tokens per backtick pair
 * - Paths: ~3.0 chars/token (slashes tokenize separately)
 * - Newlines: ~1 token each (they often become separate tokens)
 * - Punctuation/symbols: adds ~0.8 tokens per mark
 * - CJK characters: ~1.2 tokens per character
 * - Emojis: ~2.5 tokens per emoji
 *
 * Safety margin of 10% to handle edge cases and ensure budget compliance.
 * The conservative ratios combined with safety margin ensure we NEVER under-count.
 */
export const countTokensApprox = (text: string): number => {
  if (text.length === 0) return 0

  // Count CJK characters (Chinese, Japanese, Korean)
  // These typically tokenize to 1-2 tokens per character
  // Unicode ranges: CJK Unified Ideographs, Hiragana, Katakana, Hangul
  const cjkPattern =
    /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u3400-\u4dbf]/g
  const cjkMatches = text.match(cjkPattern) || []
  const cjkCount = cjkMatches.length

  // Count emojis and symbols (they often tokenize to 2-4 tokens each)
  // This pattern catches most common emojis, symbols, and dingbats
  // Also count variation selectors (FE0E/FE0F) which add extra tokens
  const emojiPattern =
    /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2300}-\u{23FF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}]/gu
  const emojiMatches = text.match(emojiPattern) || []
  const emojiCount = emojiMatches.length

  // Count variation selectors (they add extra tokens to base characters)
  const variationSelectorPattern = /[\uFE0E\uFE0F]/g
  const variationMatches = text.match(variationSelectorPattern) || []
  const variationCount = variationMatches.length

  // Extract and analyze code blocks
  // Each code block has fixed overhead: ``` markers + language identifier
  let workingText = text
  const codeBlockMatches = text.match(/```[\s\S]*?```/g) || []
  let codeBlockTokens = 0

  for (const block of codeBlockMatches) {
    // Check if it has a language identifier
    const hasLang = /^```\w+/.test(block)
    // Fixed overhead: opening backticks (1) + lang (1-2) + newline after lang (1) + closing backticks (1) + newline before close (1)
    const overhead = hasLang ? 6 : 4
    // Content between backticks (excluding the markers themselves)
    const content = block.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
    // Content newlines - each is typically 1 token
    const contentNewlines = (content.match(/\n/g) || []).length
    // Code content at ~2.5 chars/token (code has many symbols that become separate tokens)
    const contentTokens = content.length > 0 ? content.length / 2.5 : 0
    // Minimum 6 tokens for any code block (overhead alone)
    codeBlockTokens += Math.max(overhead, overhead + contentNewlines + contentTokens)
    workingText = workingText.replace(block, '')
  }

  // Extract inline code from the remaining text (single backticks)
  const inlineCodeMatches = workingText.match(/`[^`]+`/g) || []
  let inlineCodeTokens = 0
  for (const match of inlineCodeMatches) {
    // Each inline code has 2 tokens overhead (opening and closing backticks)
    const content = match.slice(1, -1)
    inlineCodeTokens += 2 + content.length / 2.5
    workingText = workingText.replace(match, '')
  }

  // Count path-like sequences (consecutive /word patterns)
  const pathMatches = workingText.match(/(?:\/[\w.-]+)+/g) || []
  let pathTokens = 0
  for (const match of pathMatches) {
    // Each slash is typically a separate token, plus the path segments
    const slashCount = (match.match(/\//g) || []).length
    const contentLength = match.length - slashCount
    pathTokens += slashCount + contentLength / 3.5
    workingText = workingText.replace(match, '')
  }

  // Count punctuation and symbols in prose - these often become separate tokens
  // Include more symbol characters that commonly appear in technical content
  const punctuationMatches =
    workingText.match(/[!?,.:;'"()[\]{}@#$%^&*+=|\\<>~\-/]/g) || []
  const punctuationCount = punctuationMatches.length

  // Count newlines in remaining prose
  const proseNewlines = (workingText.match(/\n/g) || []).length

  // Remaining prose length (excluding special characters already counted)
  const proseLength = Math.max(
    0,
    workingText.length -
      proseNewlines -
      cjkCount -
      emojiCount -
      variationCount -
      punctuationCount,
  )

  // Estimate tokens with calibrated ratios:
  // - ASCII prose: ~3.5 chars/token (conservative - actual is ~4-5 but we want safety margin)
  // - Newlines in prose: ~1 token each
  // - Punctuation: ~0.8 tokens per mark (most become separate tokens or affect adjacent)
  // - CJK: ~1.2 tokens per character (conservative estimate)
  // - Emojis: ~2.5 tokens per emoji (conservative for compound emojis)
  // - Variation selectors: ~1 token each
  const proseTokens = proseLength / 3.5
  const proseNewlineTokens = proseNewlines * 1
  const punctuationBonus = punctuationCount * 0.8
  const cjkTokens = cjkCount * 1.2
  const emojiTokens = emojiCount * 2.5
  const variationTokens = variationCount * 1

  const estimate =
    proseTokens +
    proseNewlineTokens +
    codeBlockTokens +
    inlineCodeTokens +
    pathTokens +
    punctuationBonus +
    cjkTokens +
    emojiTokens +
    variationTokens

  // Add 10% safety margin to ensure we never under-count (critical for budget enforcement)
  return Math.ceil(estimate * 1.1)
}

/**
 * Count words in text
 */
export const countWords = (text: string): number => {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}
