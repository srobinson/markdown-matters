import { Console, Effect } from 'effect'
import {
  type APIProviderName,
  buildPrompt,
  type CLIProviderName,
  displaySummarizationError,
  estimateSummaryCost,
  formatResultsForSummary,
  getBestAvailableSummarizer,
  type SummarizableResult,
} from '../../summarization/index.js'
import { promptUser } from './search-output.js'

export interface SummarizationOptions {
  readonly results: readonly SummarizableResult[]
  readonly query: string
  readonly searchMode: 'hybrid' | 'semantic' | 'keyword'
  readonly json: boolean
  readonly yes: boolean
  readonly stream: boolean
  readonly config: {
    readonly mode: 'cli' | 'api'
    readonly provider: CLIProviderName | APIProviderName
  }
}

const runSummarizationUnsafe = (
  options: SummarizationOptions,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const { results, query, searchMode, json, yes, stream, config } = options
    if (results.length === 0) {
      if (!json) yield* Console.log('No results to summarize.')
      return
    }

    const summarizerData = yield* Effect.tryPromise({
      try: async () => {
        const result = await getBestAvailableSummarizer({
          mode: config.mode,
          provider: config.provider,
        })
        if (!result) throw new Error('No summarization providers available')
        return result
      },
      catch: (cause) => new Error(`Failed to get summarizer: ${cause}`),
    })
    const { summarizer, config: resolvedConfig } = summarizerData
    const resultsText = formatResultsForSummary(results)
    const costEstimate = estimateSummaryCost(
      resultsText,
      resolvedConfig.mode,
      resolvedConfig.provider,
    )

    if (!json) {
      if (costEstimate.isPaid) {
        yield* Console.log('')
        yield* Console.log('Cost Estimate:')
        yield* Console.log(`  Provider: ${costEstimate.provider}`)
        yield* Console.log(
          `  Input tokens: ~${costEstimate.inputTokens.toLocaleString()}`,
        )
        yield* Console.log(
          `  Output tokens: ~${costEstimate.outputTokens.toLocaleString()}`,
        )
        yield* Console.log(`  Estimated cost: ${costEstimate.formattedCost}`)
        if (!yes) {
          const answer = yield* Effect.promise(() =>
            promptUser('Continue with summarization? [Y/n]: '),
          )
          if (answer === 'n' || answer === 'no') {
            yield* Console.log('Summarization cancelled.')
            return
          }
        }
      } else {
        yield* Console.log('')
        yield* Console.log(
          `Using ${resolvedConfig.provider} (subscription - FREE)`,
        )
      }
    }

    const prompt = buildPrompt({
      query,
      resultCount: results.length,
      searchMode,
    })
    if (!json) {
      yield* Console.log('')
      yield* Console.log('--- AI Summary ---')
      yield* Console.log('')
    }
    const startTime = Date.now()
    if (stream && 'summarizeStream' in summarizer) {
      yield* Effect.tryPromise({
        try: () =>
          (
            summarizer as {
              summarizeStream: (
                input: string,
                prompt: string,
                options: { onChunk: (chunk: string) => void },
              ) => Promise<void>
            }
          ).summarizeStream(resultsText, prompt, {
            onChunk: (chunk) => process.stdout.write(chunk),
          }),
        catch: (cause) => new Error(`Summarization failed: ${cause}`),
      })
      if (!json) yield* Console.log('')
    } else {
      const result = yield* Effect.tryPromise({
        try: () => summarizer.summarize(resultsText, prompt),
        catch: (cause) => new Error(`Summarization failed: ${cause}`),
      })
      if (json) {
        yield* Console.log(
          JSON.stringify(
            {
              summary: result.summary,
              provider: result.provider,
              mode: result.mode,
              durationMs: result.durationMs,
              cost: costEstimate.isPaid ? costEstimate.formattedCost : 'FREE',
            },
            null,
            2,
          ),
        )
      } else {
        yield* Console.log(result.summary)
      }
    }

    const durationMs = Date.now() - startTime
    if (!json) {
      yield* Console.log('')
      yield* Console.log('------------------')
      yield* Console.log(
        `Generated in ${(durationMs / 1000).toFixed(1)}s | ${costEstimate.isPaid ? costEstimate.formattedCost : 'FREE'}`,
      )
    }
  })

export const runSummarization = (
  options: SummarizationOptions,
): Effect.Effect<void, never> =>
  runSummarizationUnsafe(options).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        if (!options.json) displaySummarizationError(error)
      }),
    ),
  )
