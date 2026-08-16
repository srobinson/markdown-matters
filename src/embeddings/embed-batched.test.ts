import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
  type EmbeddingClient,
  EmbeddingError as RuntimeEmbeddingError,
} from '../providers/index.js'
import { embedInBatches } from './embed-batched.js'

describe('embedInBatches', () => {
  it('bounds concurrent requests and preserves input order', async () => {
    let activeRequests = 0
    let peakRequests = 0
    const progress: number[] = []
    const client: EmbeddingClient = {
      embed: (texts) =>
        Effect.promise(async () => {
          activeRequests++
          peakRequests = Math.max(peakRequests, activeRequests)
          const first = Number(texts[0])
          await new Promise((resolve) =>
            setTimeout(resolve, first === 0 ? 30 : 2),
          )
          activeRequests--
          return {
            embeddings: texts.map((text) => [Number(text)]),
            model: 'test-model',
            usage: { inputTokens: texts.length },
          }
        }),
    }

    const result = await Effect.runPromise(
      embedInBatches(client, ['0', '1', '2', '3', '4'], {
        model: 'test-model',
        batchSize: 2,
        concurrency: 2,
        onBatchProgress: ({ processedTexts }) => progress.push(processedTexts),
      }),
    )

    expect(peakRequests).toBe(2)
    expect(result.embeddings).toEqual([[0], [1], [2], [3], [4]])
    expect(progress.at(-1)).toBe(5)
    expect(progress).toEqual([...progress].sort((left, right) => left - right))
  })

  it('honors the configured retry budget and delay', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    let attempts = 0
    const client: EmbeddingClient = {
      embed: () => {
        attempts++
        return attempts < 3
          ? Effect.fail(
              new RuntimeEmbeddingError({
                provider: 'openai',
                message: 'network connection reset',
              }),
            )
          : Effect.succeed({
              embeddings: [[1]],
              model: 'test-model',
              usage: { inputTokens: 1 },
            })
      },
    }

    try {
      await Effect.runPromise(
        embedInBatches(client, ['text'], {
          model: 'test-model',
          maxRetries: 2,
          retryDelayMs: 0,
        }),
      )
      expect(attempts).toBe(3)
    } finally {
      info.mockRestore()
    }
  })

  it('keeps each request within the configured token budget', async () => {
    const calls: string[][] = []
    const completedIndexes: number[][] = []
    const client: EmbeddingClient = {
      embed: (texts) => {
        calls.push([...texts])
        return Effect.succeed({
          embeddings: texts.map((text) => [Number(text)]),
          model: 'test-model',
          usage: { inputTokens: texts.length },
        })
      },
    }

    const result = await Effect.runPromise(
      embedInBatches(client, ['0', '1', '2', '3'], {
        model: 'test-model',
        batchSize: 4,
        tokenCounts: [6, 6, 4, 4],
        maxBatchTokens: 10,
        onBatchProgress: ({ completedTextIndexes }) =>
          completedIndexes.push([...completedTextIndexes]),
      }),
    )

    expect(calls).toEqual([['0'], ['1', '2'], ['3']])
    expect(completedIndexes).toEqual([[0], [1, 2], [3]])
    expect(result.embeddings).toEqual([[0], [1], [2], [3]])
  })

  it('aborts requests at the configured timeout', async () => {
    const client: EmbeddingClient = {
      embed: (_texts, options) =>
        Effect.tryPromise({
          try: () =>
            new Promise<never>((_resolve, reject) => {
              options?.signal?.addEventListener(
                'abort',
                () => reject(options.signal?.reason),
                { once: true },
              )
            }),
          catch: (cause) =>
            new RuntimeEmbeddingError({
              provider: 'openai',
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }),
    }

    const outcome = await Effect.runPromise(
      Effect.either(
        embedInBatches(client, ['text'], {
          model: 'test-model',
          maxRetries: 0,
          timeoutMs: 5,
        }),
      ),
    )

    expect(outcome).toMatchObject({
      _tag: 'Left',
      left: {
        reason: 'Network',
        message: 'Embedding request timed out after 5ms',
      },
    })
  })
})
