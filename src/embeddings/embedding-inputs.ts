import { Effect } from 'effect'

import { countTokens, splitTextByTokens } from '../utils/tokens.js'

export const EMBEDDING_INPUT_TOKEN_LIMIT = 8_000

const CONTEXT_JOIN_TOKEN_MARGIN = 32
const CONTEXT_SEPARATOR = '\n\n'

export interface EmbeddingSourceInput {
  readonly context: string
  readonly content: string
}

export interface PreparedEmbeddingInput {
  readonly text: string
  readonly tokenCount: number
  readonly weight: number
  readonly sourceIndex: number
}

export interface ChunkedEmbeddingSource {
  readonly sourceIndex: number
  readonly chunkCount: number
  readonly tokenCount: number
}

export interface PreparedEmbeddingInputs {
  readonly inputs: readonly PreparedEmbeddingInput[]
  readonly chunkCounts: readonly number[]
  readonly chunkedSources: readonly ChunkedEmbeddingSource[]
}

const prepareOversizedSource = (
  source: EmbeddingSourceInput,
  sourceIndex: number,
  fullText: string,
  fullTokenCount: number,
) =>
  Effect.gen(function* () {
    const contextTokenCount = yield* countTokens(source.context)
    const contentTokenLimit =
      EMBEDDING_INPUT_TOKEN_LIMIT -
      contextTokenCount -
      CONTEXT_JOIN_TOKEN_MARGIN

    if (contentTokenLimit < 1) {
      const chunks = yield* splitTextByTokens(
        fullText,
        EMBEDDING_INPUT_TOKEN_LIMIT,
      )
      return chunks.map((chunk) => ({
        ...chunk,
        sourceIndex,
        weight: chunk.tokenCount,
      }))
    }

    const contentChunks = yield* splitTextByTokens(
      source.content,
      contentTokenLimit,
    )
    const contextualChunks = yield* Effect.forEach(contentChunks, (chunk) =>
      Effect.map(
        countTokens(`${source.context}${CONTEXT_SEPARATOR}${chunk.text}`),
        (tokenCount) => ({
          text: `${source.context}${CONTEXT_SEPARATOR}${chunk.text}`,
          tokenCount,
          sourceIndex,
          weight: Math.max(1, chunk.tokenCount),
        }),
      ),
    )

    if (
      contextualChunks.every(
        (chunk) => chunk.tokenCount <= EMBEDDING_INPUT_TOKEN_LIMIT,
      )
    ) {
      return contextualChunks
    }

    const fallback = yield* splitTextByTokens(
      fullText,
      EMBEDDING_INPUT_TOKEN_LIMIT,
    )
    return fallback.map((chunk) => ({
      ...chunk,
      sourceIndex,
      weight: chunk.tokenCount,
    }))
  }).pipe(Effect.map((inputs) => ({ inputs, fullTokenCount })))

export const prepareEmbeddingInputs = (
  sources: readonly EmbeddingSourceInput[],
): Effect.Effect<PreparedEmbeddingInputs, never, never> =>
  Effect.gen(function* () {
    const inputs: PreparedEmbeddingInput[] = []
    const chunkCounts: number[] = []
    const chunkedSources: ChunkedEmbeddingSource[] = []

    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const source = sources[sourceIndex]!
      const fullText = `${source.context}${CONTEXT_SEPARATOR}${source.content}`
      const fullTokenCount = yield* countTokens(fullText)
      if (fullTokenCount <= EMBEDDING_INPUT_TOKEN_LIMIT) {
        inputs.push({
          text: fullText,
          tokenCount: fullTokenCount,
          weight: Math.max(1, fullTokenCount),
          sourceIndex,
        })
        chunkCounts.push(1)
        continue
      }

      const prepared = yield* prepareOversizedSource(
        source,
        sourceIndex,
        fullText,
        fullTokenCount,
      )
      inputs.push(...prepared.inputs)
      chunkCounts.push(prepared.inputs.length)
      chunkedSources.push({
        sourceIndex,
        chunkCount: prepared.inputs.length,
        tokenCount: prepared.fullTokenCount,
      })
    }

    return { inputs, chunkCounts, chunkedSources }
  })

const normalizedWeightedMean = (
  embeddings: readonly (readonly number[])[],
  weights: readonly number[],
): readonly number[] => {
  const dimensions = embeddings[0]?.length ?? 0
  const combined = Array.from({ length: dimensions }, () => 0)
  let totalWeight = 0

  for (let index = 0; index < embeddings.length; index++) {
    const embedding = embeddings[index]
    if (embedding === undefined || embedding.length !== dimensions) continue
    const weight = weights[index] ?? 1
    totalWeight += weight
    for (let dimension = 0; dimension < dimensions; dimension++) {
      combined[dimension] =
        (combined[dimension] ?? 0) + (embedding[dimension] ?? 0) * weight
    }
  }

  if (totalWeight === 0) return combined
  const mean = combined.map((value) => value / totalWeight)
  const magnitude = Math.hypot(...mean)
  return magnitude === 0 ? mean : mean.map((value) => value / magnitude)
}

export const poolEmbeddingsBySource = (
  prepared: PreparedEmbeddingInputs,
  embeddings: readonly (readonly number[])[],
): readonly (readonly number[])[] => {
  const groupedEmbeddings = prepared.chunkCounts.map(
    () => [] as (readonly number[])[],
  )
  const groupedWeights = prepared.chunkCounts.map(() => [] as number[])

  for (let index = 0; index < prepared.inputs.length; index++) {
    const input = prepared.inputs[index]
    const embedding = embeddings[index]
    if (input === undefined || embedding === undefined) continue
    groupedEmbeddings[input.sourceIndex]?.push(embedding)
    groupedWeights[input.sourceIndex]?.push(input.weight)
  }

  return groupedEmbeddings.map((sourceEmbeddings, sourceIndex) =>
    sourceEmbeddings.length <= 1
      ? (sourceEmbeddings[0] ?? [])
      : normalizedWeightedMean(
          sourceEmbeddings,
          groupedWeights[sourceIndex] ?? [],
        ),
  )
}
