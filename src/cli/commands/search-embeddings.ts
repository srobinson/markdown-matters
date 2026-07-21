import { Console, Effect, Option } from 'effect'
import type {
  BuildEmbeddingsResult,
  EmbeddingEstimate,
} from '../../embeddings/semantic-search.js'
import {
  buildEmbeddings,
  estimateEmbeddingCost,
} from '../../embeddings/semantic-search.js'
import { resolveMdmHome } from '../../home.js'
import {
  getRerankerCacheDir,
  initializeReranker,
} from '../../search/cross-encoder.js'
import {
  createCostEstimateErrorHandler,
  createEmbeddingErrorHandler,
} from '../shared-error-handling.js'
import { promptUser } from './search-output.js'

export const initializeSearchReranker = (): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* Console.log('Initializing cross-encoder model (~90MB download)...')
    const available = yield* initializeReranker(
      getRerankerCacheDir(resolveMdmHome({ create: true })),
      (progress) => {
        if (
          progress.status === 'loading' &&
          progress.file &&
          process.stdout.isTTY
        ) {
          const percent = progress.progress
            ? ` (${Math.round(progress.progress)}%)`
            : ''
          process.stdout.write(`\r  Downloading: ${progress.file}${percent}`)
        }
      },
    ).pipe(
      Effect.map(() => true),
      Effect.catchTag('RerankerError', (error) =>
        error.reason === 'DependencyMissing'
          ? Effect.succeed(false)
          : Effect.fail(error),
      ),
    )
    if (!available) {
      yield* Console.log('')
      yield* Console.log('Error: @huggingface/transformers not installed.')
      yield* Console.log('Install with: npm install @huggingface/transformers')
      return
    }
    yield* Console.log('')
    yield* Console.log('Cross-encoder model initialized successfully.')
    yield* Console.log('Use --rerank on searches for improved precision.')
  })

const buildSemanticIndex = (
  resolvedDir: string,
  indexRoot: string,
  json: boolean,
): Effect.Effect<BuildEmbeddingsResult | null, Error> =>
  buildEmbeddings(resolvedDir, {
    indexRoot,
    force: false,
    onFileProgress: (progress) => {
      if (!json) {
        console.log(
          `  [${progress.fileIndex}/${progress.totalFiles}] ${progress.filePath}`,
        )
      }
    },
  }).pipe(
    Effect.map((result): BuildEmbeddingsResult | null => result),
    Effect.catchTags(createEmbeddingErrorHandler({ silent: json })),
  )

const reportBuiltIndex = (
  result: BuildEmbeddingsResult,
  json: boolean,
): Effect.Effect<void> =>
  json
    ? Effect.void
    : Console.log(
        `Index created (${result.sectionsEmbedded} sections, $${result.cost.toFixed(6)})`,
      ).pipe(Effect.andThen(Console.log('')))

export const handleMissingEmbeddings = (
  resolvedDir: string,
  indexRoot: string,
  autoIndexThreshold: number,
  json: boolean,
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    const estimate = yield* estimateEmbeddingCost(resolvedDir, {
      indexRoot,
    }).pipe(
      Effect.map((result): EmbeddingEstimate | null => result),
      Effect.catchTags(createCostEstimateErrorHandler()),
    )
    if (!estimate) {
      yield* Console.error(
        'No semantic index found and could not estimate cost.',
      )
      yield* Console.error('Run "mdm index --embed" first.')
      return false
    }

    if (estimate.estimatedTimeSeconds <= autoIndexThreshold) {
      if (!json) {
        yield* Console.log(
          `Creating semantic index (~${estimate.estimatedTimeSeconds}s, ~$${estimate.totalCost.toFixed(4)})...`,
        )
      }
      const result = yield* buildSemanticIndex(resolvedDir, indexRoot, json)
      if (!result) return false
      yield* reportBuiltIndex(result, json)
      return true
    }

    if (!json) {
      yield* Console.log('')
      yield* Console.log('No semantic index found.')
      yield* Console.log('')
      yield* Console.log('Options:')
      yield* Console.log(
        `  1. Create now (recommended, ~${estimate.estimatedTimeSeconds}s, ~$${estimate.totalCost.toFixed(4)})`,
      )
      yield* Console.log('  2. Use keyword search instead')
      yield* Console.log('')
    }
    const answer = yield* Effect.promise(() => promptUser('Choice [1]: '))
    const choice = answer === '' || answer === '1' ? '1' : answer
    if (choice === '1') {
      if (!json) {
        yield* Console.log('')
        yield* Console.log('Building embeddings...')
      }
      const result = yield* buildSemanticIndex(resolvedDir, indexRoot, json)
      if (!result) return false
      yield* reportBuiltIndex(result, json)
      return true
    }
    yield* Console.log('')
    yield* Console.log('Falling back to keyword search.')
    return false
  })

export type SearchProvider =
  | 'openai'
  | 'ollama'
  | 'lm-studio'
  | 'openrouter'
  | 'voyage'

export const resolveProviderConfig = (
  provider: Option.Option<SearchProvider>,
  timeout: Option.Option<number>,
) => {
  const timeoutValue = Option.getOrUndefined(timeout)
  return Option.isSome(provider)
    ? { provider: provider.value, timeout: timeoutValue }
    : timeoutValue !== undefined
      ? { provider: 'openai' as const, timeout: timeoutValue }
      : undefined
}
