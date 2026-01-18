/**
 * Token counting utilities using tiktoken
 */

import { Effect } from "effect";

// Lazy-loaded tiktoken encoder
let encoder: Awaited<ReturnType<typeof import("tiktoken").get_encoding>> | null =
  null;

const getEncoder = Effect.gen(function* () {
  if (encoder === null) {
    const { get_encoding } = yield* Effect.promise(() => import("tiktoken"));
    encoder = get_encoding("cl100k_base");
  }
  return encoder;
});

/**
 * Count tokens in a string using the cl100k_base encoding
 * (compatible with GPT-4, GPT-3.5-turbo, and Claude models)
 */
export const countTokens = (text: string): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    const enc = yield* getEncoder;
    const tokens = enc.encode(text);
    return tokens.length;
  });

/**
 * Synchronous token counting for simple use cases
 * Falls back to approximation if tiktoken not loaded
 */
export const countTokensApprox = (text: string): number => {
  // Approximation: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
};

/**
 * Count words in text
 */
export const countWords = (text: string): number => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
};
