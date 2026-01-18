import { describe, it, expect } from "vitest";
import { countWords, countTokensApprox } from "../src/utils/tokens.js";

describe("token utilities", () => {
  describe("countWords", () => {
    it("counts words in a simple sentence", () => {
      expect(countWords("Hello world")).toBe(2);
    });

    it("handles empty string", () => {
      expect(countWords("")).toBe(0);
    });

    it("handles whitespace only", () => {
      expect(countWords("   ")).toBe(0);
    });

    it("handles multiple spaces between words", () => {
      expect(countWords("hello    world")).toBe(2);
    });

    it("handles newlines and tabs", () => {
      expect(countWords("hello\nworld\there")).toBe(3);
    });
  });

  describe("countTokensApprox", () => {
    it("estimates tokens for short text", () => {
      // Approximation is ~4 chars per token
      const text = "Hello world"; // 11 chars
      const estimate = countTokensApprox(text);
      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBe(Math.ceil(11 / 4)); // Should be 3
    });

    it("handles empty string", () => {
      expect(countTokensApprox("")).toBe(0);
    });

    it("estimates longer text", () => {
      const text = "This is a longer piece of text that should have more tokens.";
      const estimate = countTokensApprox(text);
      expect(estimate).toBeGreaterThan(10);
    });
  });
});
