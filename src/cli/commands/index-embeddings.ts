import { Console, Effect } from 'effect'

import type {
  BuildEmbeddingsOptions,
  BuildEmbeddingsResult,
  EmbeddingProviderConfig,
} from '../../embeddings/semantic-search.js'
import type { SemanticRefreshOptions } from '../../index/semantic-refresh.js'
import type { ProviderId } from '../../providers/index.js'

export interface EmbeddingRefreshInput {
  readonly embed: boolean
  readonly noEmbed: boolean
  readonly force: boolean
  readonly json: boolean
  readonly provider: ProviderId | undefined
  readonly providerBaseUrl: string | undefined
  readonly providerModel: string | undefined
  readonly hnswM: number | undefined
  readonly hnswEfConstruction: number | undefined
  readonly timeout: number | undefined
}

const providerConfig = (
  input: EmbeddingRefreshInput,
): EmbeddingProviderConfig | undefined => {
  if (input.provider !== undefined) {
    return {
      provider: input.provider,
      baseURL: input.providerBaseUrl,
      model: input.providerModel,
      timeout: input.timeout,
    }
  }
  return input.timeout === undefined
    ? undefined
    : { provider: 'openai', timeout: input.timeout }
}

const hnswOptions = (input: EmbeddingRefreshInput) =>
  input.hnswM !== undefined || input.hnswEfConstruction !== undefined
    ? { m: input.hnswM, efConstruction: input.hnswEfConstruction }
    : undefined

const progressOptions = (
  input: EmbeddingRefreshInput,
  showProgress: boolean,
): Pick<BuildEmbeddingsOptions, 'onBatchProgress' | 'onFileProgress'> => ({
  onFileProgress: (progress) => {
    if (!input.json && showProgress) {
      process.stdout.write(
        `\x1b[2K\r  [${progress.fileIndex}/${progress.totalFiles}] ${progress.filePath} (${progress.sectionCount} sections)...`,
      )
    }
  },
  onBatchProgress: (progress) => {
    if (!input.json && showProgress) {
      process.stdout.write(
        `\x1b[2K\r  Embedding [${progress.processedSections}/${progress.totalSections}] sections (batch ${progress.batchIndex}/${progress.totalBatches})...`,
      )
    }
  },
})

export const semanticRefreshOptions = (
  input: EmbeddingRefreshInput,
  showProgress: boolean,
): SemanticRefreshOptions => {
  if (input.noEmbed) return { mode: 'skip' }
  const progress = progressOptions(input, showProgress)
  if (!input.embed) return { mode: 'active', ...progress }
  return {
    mode: 'build',
    options: {
      force: input.force,
      providerConfig: providerConfig(input),
      hnswOptions: hnswOptions(input),
      ...progress,
    },
  }
}

const renderEmbeddingResult = (result: BuildEmbeddingsResult) =>
  Effect.gen(function* () {
    yield* Console.log('')
    if (result.cacheHit) {
      yield* Console.log(
        `Embeddings already exist (${result.existingVectors} vectors)`,
      )
      yield* Console.log('  Use --force to rebuild')
      return
    }

    yield* Console.log(`Completed in ${(result.duration / 1000).toFixed(1)}s`)
    yield* Console.log(`  Files: ${result.filesProcessed}`)
    yield* Console.log(`  Sections: ${result.sectionsEmbedded}`)
    yield* Console.log(`  Tokens: ${result.tokensUsed.toLocaleString()}`)
    yield* Console.log(`  Cost: $${result.cost.toFixed(6)}`)
  })

export const renderSemanticRefresh = (
  result: BuildEmbeddingsResult | null,
  input: EmbeddingRefreshInput,
  showProgress: boolean,
) => {
  if (showProgress) {
    process.stdout.write(`\r${' '.repeat(process.stdout.columns ?? 80)}\r`)
  }
  if (result === null || input.json || !process.stdout.isTTY) return Effect.void
  return renderEmbeddingResult(result)
}
