import { Console, Effect, Option } from 'effect'

import type { EmbeddingsConfig } from '../../config/schema.js'
import type {
  BuildEmbeddingsOptions,
  BuildEmbeddingsResult,
  EmbeddingExecutionOptions,
  EmbeddingProviderConfig,
} from '../../embeddings/semantic-search.js'
import type { SemanticRefreshOptions } from '../../index/semantic-refresh.js'
import type { ProviderId } from '../../providers/index.js'

export interface EmbeddingRefreshInput {
  readonly embed: boolean
  readonly noEmbed: boolean
  readonly forceEmbed: boolean
  readonly force: boolean
  readonly json: boolean
  readonly provider: ProviderId | undefined
  readonly providerBaseUrl: string | undefined
  readonly providerModel: string | undefined
  readonly hnswM: number | undefined
  readonly hnswEfConstruction: number | undefined
}

const providerConfig = (
  input: EmbeddingRefreshInput,
  config: EmbeddingsConfig,
): EmbeddingProviderConfig => ({
  provider: input.provider ?? config.provider,
  baseURL: input.providerBaseUrl ?? Option.getOrUndefined(config.baseURL),
  model: input.providerModel ?? config.model,
  dimensions: config.dimensions,
})

const hnswOptions = (
  input: EmbeddingRefreshInput,
  config: EmbeddingsConfig,
) => ({
  m: input.hnswM ?? config.hnswM,
  efConstruction: input.hnswEfConstruction ?? config.hnswEfConstruction,
})

const executionOptions = (
  config: EmbeddingsConfig,
): EmbeddingExecutionOptions => ({
  batchSize: config.batchSize,
  concurrency: config.concurrency,
  maxRetries: config.maxRetries,
  retryDelayMs: config.retryDelayMs,
  timeoutMs: config.timeoutMs,
})

const progressOptions = (
  input: EmbeddingRefreshInput,
  showProgress: boolean,
): Pick<
  BuildEmbeddingsOptions,
  'onBatchProgress' | 'onFileProgress' | 'onSectionChunked' | 'onSectionSkipped'
> => ({
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
  onSectionChunked: (progress) => {
    if (input.json) return
    if (showProgress) process.stdout.write('\x1b[2K\r')
    process.stderr.write(
      `  Chunking oversized section: ${progress.documentPath} > ${progress.heading} (${progress.tokenCount} tokens into ${progress.chunkCount} inputs)\n`,
    )
  },
  onSectionSkipped: (progress) => {
    if (input.json) return
    if (showProgress) process.stdout.write('\x1b[2K\r')
    process.stderr.write(
      `  Skipped section rejected by provider: ${progress.documentPath} > ${progress.heading} (${progress.reason})\n`,
    )
  },
})

export const semanticRefreshOptions = (
  input: EmbeddingRefreshInput,
  showProgress: boolean,
  config: EmbeddingsConfig,
): SemanticRefreshOptions => {
  if (input.noEmbed) return { mode: 'skip' }
  const progress = progressOptions(input, showProgress)
  const execution = executionOptions(config)
  if (!input.embed && !input.forceEmbed) {
    return { mode: 'active', execution, ...progress }
  }
  return {
    mode: 'build',
    options: {
      force: input.forceEmbed,
      providerConfig: providerConfig(input, config),
      hnswOptions: hnswOptions(input, config),
      execution,
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
      yield* Console.log('  Use --force-embed to rebuild')
      return
    }

    yield* Console.log(`Completed in ${(result.duration / 1000).toFixed(1)}s`)
    yield* Console.log(`  Files: ${result.filesProcessed}`)
    yield* Console.log(`  Sections: ${result.sectionsEmbedded}`)
    if (result.sectionsSkipped > 0) {
      yield* Console.log(`  Skipped: ${result.sectionsSkipped} (rejected)`)
    }
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
