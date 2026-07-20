import * as readline from 'node:readline'

import { Console, Effect } from 'effect'

import type {
  BuildEmbeddingsResult,
  EmbeddingEstimate,
  EmbeddingProviderConfig,
} from '../../embeddings/semantic-search.js'
import {
  buildEmbeddings,
  checkPricingFreshness,
  estimateEmbeddingCost,
  getPricingDate,
} from '../../embeddings/semantic-search.js'
import { hasAnyRemoteApiKey, type ProviderId } from '../../providers/index.js'
import {
  createCostEstimateErrorHandler,
  createEmbeddingErrorHandler,
} from '../shared-error-handling.js'
import { hasEmbeddings } from '../utils.js'

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

export interface EmbeddingRefreshContext {
  readonly sourceRoot: string
  readonly indexRoot: string
  readonly showProgress: boolean
}

const isInteractiveTTY = (): boolean =>
  Boolean(process.stdout.isTTY && process.stdin.isTTY)

const promptUser = (message: string): Promise<string> => {
  if (!isInteractiveTTY()) return Promise.resolve('n')

  return new Promise((resolve) => {
    const prompt = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    prompt.question(message, (answer) => {
      prompt.close()
      resolve(answer.trim().toLowerCase())
    })
  })
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

const renderEstimate = (estimate: EmbeddingEstimate) =>
  Effect.gen(function* () {
    yield* Console.log(`Found ${estimate.totalFiles} files to embed:`)
    for (const directory of estimate.byDirectory) {
      const cost =
        directory.estimatedCost < 0.001
          ? '<$0.001'
          : `~$${directory.estimatedCost.toFixed(4)}`
      yield* Console.log(
        `  ${directory.directory.padEnd(20)} ${String(directory.fileCount).padStart(3)} files   ${cost}`,
      )
    }
    yield* Console.log('')
    yield* Console.log(
      `Total: ~${estimate.totalTokens.toLocaleString()} tokens, ~$${estimate.totalCost.toFixed(4)} (pricing as of ${getPricingDate()}), ~${estimate.estimatedTimeSeconds}s`,
    )
    const warning = checkPricingFreshness()
    if (warning) yield* Console.log(`  Warning: ${warning}`)
    yield* Console.log('')
  })

const renderEmbeddingResult = (result: BuildEmbeddingsResult) =>
  Effect.gen(function* () {
    yield* Console.log('')
    if (result.cacheHit) {
      yield* Console.log(
        `Embeddings already exist (${result.existingVectors} vectors)`,
      )
      yield* Console.log('  Use --force to rebuild')
      yield* Console.log('')
      yield* Console.log(
        `Skipped embedding generation (saved ~$${(result.estimatedSavings ?? 0).toFixed(4)})`,
      )
      return
    }

    yield* Console.log(`Completed in ${(result.duration / 1000).toFixed(1)}s`)
    yield* Console.log(`  Files: ${result.filesProcessed}`)
    yield* Console.log(`  Sections: ${result.sectionsEmbedded}`)
    yield* Console.log(`  Tokens: ${result.tokensUsed.toLocaleString()}`)
    yield* Console.log(`  Cost: $${result.cost.toFixed(6)}`)
  })

const clearEmbeddingProgress = (showProgress: boolean): void => {
  if (!showProgress) return
  process.stdout.write(`\r${' '.repeat(process.stdout.columns ?? 80)}\r`)
}

const runRequestedEmbeddingRefresh = (
  input: EmbeddingRefreshInput,
  context: EmbeddingRefreshContext,
) =>
  Effect.gen(function* () {
    yield* Console.log('')
    const estimate = yield* estimateEmbeddingCost(context.sourceRoot, {
      indexRoot: context.indexRoot,
    })
    if (!input.json) yield* renderEstimate(estimate)

    yield* Console.log(
      input.force
        ? 'Rebuilding embeddings (--force specified)...'
        : 'Checking embeddings...',
    )

    const result = yield* buildEmbeddings(context.sourceRoot, {
      indexRoot: context.indexRoot,
      force: input.force,
      providerConfig: providerConfig(input),
      hnswOptions: hnswOptions(input),
      onFileProgress: (progress) => {
        if (!input.json && context.showProgress) {
          process.stdout.write(
            `\x1b[2K\r  [${progress.fileIndex}/${progress.totalFiles}] ${progress.filePath} (${progress.sectionCount} sections)...`,
          )
        }
      },
      onBatchProgress: (progress) => {
        if (!input.json && context.showProgress) {
          process.stdout.write(
            `\x1b[2K\r  Embedding [${progress.processedSections}/${progress.totalSections}] sections (batch ${progress.batchIndex}/${progress.totalBatches})...`,
          )
        }
      },
    })

    clearEmbeddingProgress(!input.json && context.showProgress)
    if (!input.json && process.stdout.isTTY)
      yield* renderEmbeddingResult(result)
  })

const renderProviderGuidance = () =>
  Effect.gen(function* () {
    yield* Console.log('Requires an embedding provider. Options:')
    yield* Console.log(
      '  - OpenAI (cloud): Set OPENAI_API_KEY environment variable',
    )
    yield* Console.log(
      '  - Ollama (free, local): Run "ollama serve" - no API key needed',
    )
    yield* Console.log(
      '  - LM Studio (free, local): Start the server - no API key needed',
    )
    yield* Console.log(
      '  - OpenRouter (cloud): Set OPENROUTER_API_KEY environment variable',
    )
    yield* Console.log('')
    yield* Console.log('See CONFIG.md for detailed setup instructions.')
    yield* Console.log('')
  })

const renderMissingProvider = () =>
  Effect.gen(function* () {
    yield* Console.log('')
    yield* Console.log('No embedding provider configured.')
    yield* Console.log('')
    yield* Console.log('Choose a provider:')
    yield* Console.log('')
    yield* Console.log('  Cloud (requires API key):')
    yield* Console.log('    export OPENAI_API_KEY=sk-...')
    yield* Console.log('    export OPENROUTER_API_KEY=sk-...')
    yield* Console.log('')
    yield* Console.log('  Local (free, no API key needed):')
    yield* Console.log(
      '    Ollama: ollama serve && ollama pull nomic-embed-text',
    )
    yield* Console.log('    LM Studio: Start the server GUI')
    yield* Console.log('')
    yield* Console.log('Then run: mdm index --embed [--provider <name>]')
    yield* Console.log('See CONFIG.md for detailed setup.')
  })

const runPromptedEmbeddingRefresh = (
  input: EmbeddingRefreshInput,
  context: EmbeddingRefreshContext,
) =>
  Effect.gen(function* () {
    yield* Console.log('')
    yield* Console.log(
      'Enable semantic search? This allows natural language queries like:',
    )
    yield* Console.log(
      '  "how does authentication work" instead of exact keyword matches',
    )
    yield* Console.log('')

    const estimate = yield* estimateEmbeddingCost(context.sourceRoot, {
      indexRoot: context.indexRoot,
    }).pipe(
      Effect.map((result): EmbeddingEstimate | null => result),
      Effect.catchTags(createCostEstimateErrorHandler()),
    )
    if (estimate) {
      yield* Console.log(
        `Cost: ~$${estimate.totalCost.toFixed(4)} for this corpus (~${estimate.estimatedTimeSeconds}s)`,
      )
    }
    yield* renderProviderGuidance()

    const answer = yield* Effect.promise(() =>
      promptUser('Create semantic index? [y/N]: '),
    )
    if (answer !== 'y' && answer !== 'yes') return
    if (!hasAnyRemoteApiKey()) return yield* renderMissingProvider()

    yield* Console.log('')
    yield* Console.log('Building embeddings...')
    const result = yield* buildEmbeddings(context.sourceRoot, {
      indexRoot: context.indexRoot,
      force: false,
      hnswOptions: hnswOptions(input),
      providerConfig:
        input.timeout === undefined
          ? undefined
          : { provider: 'openai', timeout: input.timeout },
      onFileProgress: (progress) => {
        console.log(
          `  [${progress.fileIndex}/${progress.totalFiles}] ${progress.filePath}`,
        )
      },
    }).pipe(
      Effect.map((value): BuildEmbeddingsResult | null => value),
      Effect.catchTags(createEmbeddingErrorHandler()),
    )
    if (result) yield* renderEmbeddingResult(result)
  })

export const runEmbeddingRefresh = (
  input: EmbeddingRefreshInput,
  context: EmbeddingRefreshContext,
) =>
  Effect.gen(function* () {
    if (input.embed) {
      return yield* runRequestedEmbeddingRefresh(input, context)
    }
    if (input.noEmbed || input.json) return

    const embeddingsExist = yield* Effect.promise(() =>
      hasEmbeddings(context.indexRoot),
    )
    if (embeddingsExist) return
    return yield* runPromptedEmbeddingRefresh(input, context)
  })
