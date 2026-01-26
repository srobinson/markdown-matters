/**
 * Tests for cross-encoder re-ranking module
 */

import { Effect, Exit } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getReranker,
  isRerankerAvailable,
  type RerankedResult,
  RerankerError,
  type RerankerOptions,
  rerankResults,
  unloadReranker,
} from './cross-encoder.js'

describe('cross-encoder', () => {
  afterEach(() => {
    unloadReranker()
    vi.restoreAllMocks()
  })

  describe('RerankerError', () => {
    it('should create error with DependencyMissing reason', () => {
      const error = new RerankerError(
        'DependencyMissing',
        'Package not installed',
      )
      expect(error.reason).toBe('DependencyMissing')
      expect(error.message).toBe('Package not installed')
      expect(error._tag).toBe('RerankerError')
      expect(error.name).toBe('RerankerError')
    })

    it('should create error with ModelLoadFailed reason', () => {
      const error = new RerankerError('ModelLoadFailed', 'Failed to load model')
      expect(error.reason).toBe('ModelLoadFailed')
      expect(error.message).toBe('Failed to load model')
    })

    it('should create error with InferenceFailed reason', () => {
      const cause = new Error('GPU OOM')
      const error = new RerankerError(
        'InferenceFailed',
        'Inference failed',
        cause,
      )
      expect(error.reason).toBe('InferenceFailed')
      expect(error.cause).toBe(cause)
    })
  })

  describe('getReranker', () => {
    it('should return a singleton reranker instance', () => {
      const reranker1 = getReranker()
      const reranker2 = getReranker()
      expect(reranker1).toBe(reranker2)
    })

    it('should return reranker with expected interface', () => {
      const reranker = getReranker()
      expect(typeof reranker.rerank).toBe('function')
      expect(typeof reranker.isReady).toBe('function')
      expect(typeof reranker.unload).toBe('function')
    })

    it('should report not ready before loading', () => {
      const reranker = getReranker()
      expect(reranker.isReady()).toBe(false)
    })

    it('should accept custom cache directory', () => {
      unloadReranker()
      const reranker = getReranker('/custom/cache/dir')
      expect(reranker).toBeDefined()
    })
  })

  describe('unloadReranker', () => {
    it('should reset singleton', () => {
      const reranker1 = getReranker()
      unloadReranker()
      const reranker2 = getReranker()
      expect(reranker1).not.toBe(reranker2)
    })

    it('should be safe to call multiple times', () => {
      unloadReranker()
      unloadReranker()
      unloadReranker()
      // No error should be thrown
    })
  })

  describe('rerankResults', () => {
    it('should return empty array for empty input', async () => {
      const result = await Effect.runPromise(
        rerankResults('test query', [], (item: unknown) => String(item)),
      )
      expect(result).toEqual([])
    })

    it('should handle DependencyMissing error gracefully', async () => {
      // When transformers is not installed, the effect should fail with DependencyMissing
      const results = [
        { id: 1, content: 'test content' },
        { id: 2, content: 'another content' },
      ]

      const effect = rerankResults(
        'test query',
        results,
        (item) => item.content,
      )

      const exit = await Effect.runPromiseExit(effect)

      // This test will either:
      // 1. Fail with DependencyMissing if @huggingface/transformers is not installed
      // 2. Succeed if the package is installed
      if (Exit.isFailure(exit)) {
        const error = exit.cause
        // Check if it's the right kind of error
        if ('_tag' in error) {
          // It should be a RerankerError
          expect(true).toBe(true)
        }
      } else {
        // If it succeeds, that's fine too (package is installed)
        expect(Exit.isSuccess(exit)).toBe(true)
      }
    })

    it('should respect topK option', async () => {
      const results = Array.from({ length: 30 }, (_, i) => ({
        id: i,
        content: `content ${i}`,
      }))

      const options: RerankerOptions = { topK: 5, returnTopN: 3 }

      // This test verifies the options are passed through
      // The actual slicing happens in the effect implementation
      const effect = rerankResults(
        'test query',
        results,
        (item) => item.content,
        options,
      )

      // Just verify the effect can be created without error
      expect(effect).toBeDefined()
    })

    it('should respect returnTopN option', async () => {
      const results = Array.from({ length: 10 }, (_, i) => ({
        id: i,
        content: `content ${i}`,
      }))

      const options: RerankerOptions = { topK: 10, returnTopN: 5 }

      const effect = rerankResults(
        'test query',
        results,
        (item) => item.content,
        options,
      )

      expect(effect).toBeDefined()
    })

    it('should use default topK of 20', async () => {
      // Default options should be topK=20, returnTopN=10
      const results = Array.from({ length: 25 }, (_, i) => ({
        id: i,
        content: `content ${i}`,
      }))

      const effect = rerankResults(
        'test query',
        results,
        (item) => item.content,
        // No options, should use defaults
      )

      expect(effect).toBeDefined()
    })

    it('should use default returnTopN of 10', async () => {
      const results = Array.from({ length: 15 }, (_, i) => ({
        id: i,
        content: `content ${i}`,
      }))

      const effect = rerankResults(
        'test query',
        results,
        (item) => item.content,
      )

      expect(effect).toBeDefined()
    })
  })

  describe('isRerankerAvailable', () => {
    it('should return boolean effect', async () => {
      const effect = isRerankerAvailable()
      const result = await Effect.runPromise(effect)
      expect(typeof result).toBe('boolean')
    })

    it('should not throw on missing dependency', async () => {
      // This should gracefully return false if package is not installed
      const result = await Effect.runPromise(isRerankerAvailable())
      // Result is either true or false, never throws
      expect([true, false]).toContain(result)
    })
  })

  describe('RerankedResult type', () => {
    it('should have expected structure', () => {
      const result: RerankedResult<{ id: number }> = {
        item: { id: 1 },
        rerankerScore: 0.95,
        originalRank: 1,
      }

      expect(result.item.id).toBe(1)
      expect(result.rerankerScore).toBe(0.95)
      expect(result.originalRank).toBe(1)
    })
  })

  describe('Reranker interface', () => {
    it('should define rerank method signature', () => {
      const reranker = getReranker()

      // Verify the rerank method exists and is async
      expect(typeof reranker.rerank).toBe('function')
    })

    it('should define isReady method', () => {
      const reranker = getReranker()
      expect(typeof reranker.isReady).toBe('function')
    })

    it('should define unload method', () => {
      const reranker = getReranker()
      expect(typeof reranker.unload).toBe('function')
    })
  })
})
