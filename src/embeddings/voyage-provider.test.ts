import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVoyageProvider } from './voyage-provider.js'

describe('VoyageProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries transient rate limits before failing the batch', async () => {
    const provider = await Effect.runPromise(
      createVoyageProvider({
        apiKey: 'test-key',
        maxRetries: 1,
        retryDelayMs: 0,
      }),
    )

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: 'list',
            data: [{ object: 'embedding', embedding: [1, 2], index: 0 }],
            model: 'voyage-3.5-lite',
            usage: { total_tokens: 12 },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    const result = await provider.embed(['hello'])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.embeddings).toEqual([[1, 2]])
    expect(result.tokensUsed).toBe(12)
  })
})
