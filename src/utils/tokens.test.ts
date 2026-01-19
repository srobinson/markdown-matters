import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { countTokensApprox, countTokens, countWords } from './tokens.js'

describe('token utilities', () => {
  describe('countWords', () => {
    it('counts words in a simple sentence', () => {
      expect(countWords('Hello world')).toBe(2)
    })

    it('handles empty string', () => {
      expect(countWords('')).toBe(0)
    })

    it('handles whitespace only', () => {
      expect(countWords('   ')).toBe(0)
    })

    it('handles multiple spaces between words', () => {
      expect(countWords('hello    world')).toBe(2)
    })

    it('handles newlines and tabs', () => {
      expect(countWords('hello\nworld\there')).toBe(3)
    })
  })

  describe('countTokensApprox', () => {
    it('estimates tokens for short text', () => {
      // Approximation includes safety margin, so we check it's reasonable
      const text = 'Hello world' // 11 chars
      const estimate = countTokensApprox(text)
      expect(estimate).toBeGreaterThan(0)
      // With 20% safety margin, should be around 4-5 tokens
      expect(estimate).toBeGreaterThanOrEqual(3)
      expect(estimate).toBeLessThanOrEqual(10)
    })

    it('handles empty string', () => {
      expect(countTokensApprox('')).toBe(0)
    })

    it('estimates longer text', () => {
      const text =
        'This is a longer piece of text that should have more tokens.'
      const estimate = countTokensApprox(text)
      expect(estimate).toBeGreaterThan(10)
    })

    it('is conservative for code blocks', () => {
      const code = '```javascript\nfunction foo() {\n  return bar;\n}\n```'
      const estimate = countTokensApprox(code)
      // Code block is ~50 chars, actual tiktoken count is 13 tokens
      // Estimate should be >= actual (conservative) - we prioritize never under-counting
      // for budget enforcement, so we allow up to 100% over-estimation
      expect(estimate).toBeGreaterThanOrEqual(13)
      expect(estimate).toBeLessThanOrEqual(26) // up to 2x actual
    })

    it('accounts for punctuation', () => {
      const textWithPunctuation = 'Hello, world! How are you? Fine, thanks.'
      const plainText = 'Hello world How are you Fine thanks'
      const withPunc = countTokensApprox(textWithPunctuation)
      const withoutPunc = countTokensApprox(plainText)
      // Punctuation should add some token overhead
      expect(withPunc).toBeGreaterThan(withoutPunc)
    })

    it('accounts for newlines', () => {
      const singleLine = 'Hello world'
      const multiLine = 'Hello\nworld'
      const singleEst = countTokensApprox(singleLine)
      const multiEst = countTokensApprox(multiLine)
      // Newlines add token overhead
      expect(multiEst).toBeGreaterThanOrEqual(singleEst)
    })
  })

  describe('countTokensApprox accuracy vs tiktoken', () => {
    // These tests verify the approximation is conservative (never under-estimates)
    // We allow up to 2x over-estimation to ensure we NEVER violate token budgets
    // Being over is safe (wastes some budget), under is dangerous (budget violations)

    it('is conservative (never under-estimates) for prose', async () => {
      const text = 'This is a simple sentence with some common words that form a typical paragraph.'
      const approx = countTokensApprox(text)
      const actual = await Effect.runPromise(countTokens(text))
      // Approximation should be >= actual (conservative) - this is the critical requirement
      expect(approx).toBeGreaterThanOrEqual(actual)
      // Allow up to 2x over to ensure we never under-count
      expect(approx).toBeLessThanOrEqual(actual * 2)
    })

    it('is conservative for code blocks', async () => {
      const code = '```typescript\nfunction parseDocument(input: string): AST {\n  const tokens = tokenize(input);\n  return buildTree(tokens);\n}\n```'
      const approx = countTokensApprox(code)
      const actual = await Effect.runPromise(countTokens(code))
      // Approximation should be >= actual (conservative)
      expect(approx).toBeGreaterThanOrEqual(actual)
      // Allow up to 2.5x for code blocks (they're hardest to estimate)
      expect(approx).toBeLessThanOrEqual(actual * 2.5)
    })

    it('is conservative for inline code', async () => {
      const text = 'Use the `countTokens` function to count tokens in a `string`.'
      const approx = countTokensApprox(text)
      const actual = await Effect.runPromise(countTokens(text))
      expect(approx).toBeGreaterThanOrEqual(actual)
      expect(approx).toBeLessThanOrEqual(actual * 2)
    })

    it('is conservative for file paths', async () => {
      const path = '/very/long/path/to/deeply/nested/directory/structure/that/keeps/going/file.md'
      const approx = countTokensApprox(path)
      const actual = await Effect.runPromise(countTokens(path))
      expect(approx).toBeGreaterThanOrEqual(actual)
      expect(approx).toBeLessThanOrEqual(actual * 2)
    })

    it('is conservative for mixed content', async () => {
      const text = '# Title\n\nSome prose with `code` and a path `/src/utils.ts`.\n\n```js\nconst x = 1;\n```'
      const approx = countTokensApprox(text)
      const actual = await Effect.runPromise(countTokens(text))
      expect(approx).toBeGreaterThanOrEqual(actual)
      expect(approx).toBeLessThanOrEqual(actual * 2)
    })

    it('is conservative for punctuation-heavy text', async () => {
      const text = "Hello, world! How are you? Fine, thanks... Well: good! (Yes, really.)"
      const approx = countTokensApprox(text)
      const actual = await Effect.runPromise(countTokens(text))
      expect(approx).toBeGreaterThanOrEqual(actual)
      expect(approx).toBeLessThanOrEqual(actual * 2)
    })
  })
})
