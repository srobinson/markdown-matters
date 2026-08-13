import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { countTokens } from '../utils/tokens.js'
import {
  EMBEDDING_INPUT_TOKEN_LIMIT,
  poolEmbeddingsBySource,
  prepareEmbeddingInputs,
} from './embedding-inputs.js'

describe('embedding inputs', () => {
  it('preserves the existing input format when a section fits', async () => {
    const prepared = await Effect.runPromise(
      prepareEmbeddingInputs([
        { context: '# Heading\nDocument: guide', content: 'Section body' },
      ]),
    )

    expect(prepared.inputs).toMatchObject([
      { text: '# Heading\nDocument: guide\n\nSection body', sourceIndex: 0 },
    ])
    expect(prepared.chunkedSources).toEqual([])
  })

  it('chunks oversized content and repeats section context', async () => {
    const context = '# Large section\nDocument: guide'
    const prepared = await Effect.runPromise(
      prepareEmbeddingInputs([
        { context, content: 'semantic content '.repeat(10_000) },
      ]),
    )

    expect(prepared.inputs.length).toBeGreaterThan(1)
    expect(prepared.chunkCounts).toEqual([prepared.inputs.length])
    expect(prepared.chunkedSources).toEqual([
      {
        sourceIndex: 0,
        chunkCount: prepared.inputs.length,
        tokenCount: expect.any(Number),
      },
    ])
    for (const input of prepared.inputs) {
      expect(input.text.startsWith(`${context}\n\n`)).toBe(true)
      expect(input.tokenCount).toBeLessThanOrEqual(EMBEDDING_INPUT_TOKEN_LIMIT)
      expect(await Effect.runPromise(countTokens(input.text))).toBe(
        input.tokenCount,
      )
    }
  })

  it('returns one normalized vector per source', async () => {
    const prepared = await Effect.runPromise(
      prepareEmbeddingInputs([
        { context: '# Large', content: 'content '.repeat(12_000) },
        { context: '# Small', content: 'short content' },
      ]),
    )
    const embeddings = prepared.inputs.map((_input, index) =>
      index === prepared.inputs.length - 1 ? [0, 5] : [3, index + 1],
    )
    const pooled = poolEmbeddingsBySource(prepared, embeddings)

    expect(pooled).toHaveLength(2)
    expect(Math.hypot(...pooled[0]!)).toBeCloseTo(1)
    expect(pooled[0]![0]).toBeGreaterThan(0)
    expect(pooled[0]![1]).toBeGreaterThan(0)
    expect(pooled[1]).toEqual([0, 5])
  })
})
