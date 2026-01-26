/**
 * SEARCH Command
 *
 * Search markdown content by meaning or heading pattern.
 */

import * as path from 'node:path'
import * as readline from 'node:readline'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect, Option } from 'effect'
import { ConfigService, defaultConfig } from '../../config/index.js'
import type {
  BuildEmbeddingsResult,
  EmbeddingEstimate,
} from '../../embeddings/semantic-search.js'
import {
  buildEmbeddings,
  estimateEmbeddingCost,
  semanticSearchWithStats,
} from '../../embeddings/semantic-search.js'
import type { SearchQuality } from '../../embeddings/types.js'
import { INDEX_DIR } from '../../index/types.js'
import { initializeReranker } from '../../search/cross-encoder.js'
import {
  detectSearchModes,
  hybridSearch,
  type SearchMode,
} from '../../search/hybrid-search.js'
import { isAdvancedQuery } from '../../search/query-parser.js'
import { search, searchContent } from '../../search/searcher.js'
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
import { jsonOption, prettyOption } from '../options.js'
import {
  createCostEstimateErrorHandler,
  createEmbeddingErrorHandler,
} from '../shared-error-handling.js'
import { formatJson, getIndexInfo, isRegexPattern } from '../utils.js'

// Auto-index threshold is now configurable via search.autoIndexThreshold

const promptUser = (message: string): Promise<string> => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(message, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

export const searchCommand = Command.make(
  'search',
  {
    query: Args.text({ name: 'query' }).pipe(
      Args.withDescription('Search query (natural language or regex pattern)'),
    ),
    path: Args.directory({ name: 'path' }).pipe(
      Args.withDescription('Directory to search in'),
      Args.withDefault('.'),
    ),
    keyword: Options.boolean('keyword').pipe(
      Options.withAlias('k'),
      Options.withDescription('Force keyword search (content text match)'),
      Options.withDefault(false),
    ),
    headingOnly: Options.boolean('heading-only').pipe(
      Options.withAlias('H'),
      Options.withDescription('Search headings only (not content)'),
      Options.withDefault(false),
    ),
    mode: Options.choice('mode', ['hybrid', 'semantic', 'keyword']).pipe(
      Options.withAlias('m'),
      Options.withDescription(
        'Search mode: hybrid (BM25+semantic), semantic, or keyword',
      ),
      Options.optional,
    ),
    limit: Options.integer('limit').pipe(
      Options.withAlias('n'),
      Options.withDescription('Maximum results'),
      Options.withDefault(10),
    ),
    threshold: Options.float('threshold').pipe(
      Options.withDescription('Similarity threshold for semantic search (0-1)'),
      Options.withDefault(0.35),
    ),
    context: Options.integer('context').pipe(
      Options.withAlias('C'),
      Options.withDescription('Lines of context around matches (like grep -C)'),
      Options.optional,
    ),
    beforeContext: Options.integer('before-context').pipe(
      Options.withAlias('B'),
      Options.withDescription('Lines of context before matches (like grep -B)'),
      Options.optional,
    ),
    afterContext: Options.integer('after-context').pipe(
      Options.withAlias('A'),
      Options.withDescription('Lines of context after matches (like grep -A)'),
      Options.optional,
    ),
    autoIndexThreshold: Options.integer('auto-index-threshold').pipe(
      Options.withDescription(
        'Auto-create semantic index if estimated time is under this threshold (seconds)',
      ),
      Options.optional,
    ),
    provider: Options.choice('provider', [
      'openai',
      'ollama',
      'lm-studio',
      'openrouter',
      'voyage',
    ]).pipe(
      Options.withDescription(
        'Embedding provider for semantic search: openai, ollama, lm-studio, openrouter, or voyage',
      ),
      Options.optional,
    ),
    rerank: Options.boolean('rerank').pipe(
      Options.withAlias('r'),
      Options.withDescription(
        'Re-rank results using cross-encoder for improved precision. Downloads ~90MB model on first use. Requires @huggingface/transformers.',
      ),
      Options.withDefault(false),
    ),
    quality: Options.choice('quality', ['fast', 'balanced', 'thorough']).pipe(
      Options.withAlias('q'),
      Options.withDescription(
        'Search quality mode: fast (quicker, lower recall), balanced (default), thorough (slower, better recall)',
      ),
      Options.optional,
    ),
    hyde: Options.boolean('hyde').pipe(
      Options.withDescription(
        'Use HyDE (Hypothetical Document Embeddings) for complex queries. Generates a hypothetical answer with LLM, then searches using that embedding. Improves recall 10-30% on complex/ambiguous queries at cost of ~1-2s latency and LLM API usage.',
      ),
      Options.withDefault(false),
    ),
    rerankInit: Options.boolean('rerank-init').pipe(
      Options.withDescription(
        'Pre-download the cross-encoder model (~90MB) for re-ranking. Use this before first search to avoid latency.',
      ),
      Options.withDefault(false),
    ),
    json: jsonOption,
    pretty: prettyOption,
    summarize: Options.boolean('summarize').pipe(
      Options.withAlias('s'),
      Options.withDescription('Generate AI summary of search results'),
      Options.withDefault(false),
    ),
    yes: Options.boolean('yes').pipe(
      Options.withAlias('y'),
      Options.withDescription('Skip cost confirmation for paid AI providers'),
      Options.withDefault(false),
    ),
    stream: Options.boolean('stream').pipe(
      Options.withDescription('Stream AI summary output in real-time'),
      Options.withDefault(false),
    ),
  },
  ({
    query,
    path: dirPath,
    keyword,
    headingOnly,
    mode,
    limit,
    threshold,
    context,
    beforeContext,
    afterContext,
    autoIndexThreshold,
    provider,
    rerank,
    quality,
    hyde,
    rerankInit,
    json,
    pretty,
    summarize,
    yes,
    stream,
  }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dirPath)

      // Handle --rerank-init: pre-download model and exit
      if (rerankInit) {
        yield* Console.log(
          'Initializing cross-encoder model (~90MB download)...',
        )

        const cacheDir = path.join(resolvedDir, INDEX_DIR, 'models')

        const result = yield* initializeReranker(cacheDir, (progress) => {
          if (progress.status === 'loading' && progress.file) {
            const pct = progress.progress
              ? ` (${Math.round(progress.progress)}%)`
              : ''
            process.stdout.write(`\r  Downloading: ${progress.file}${pct}`)
          }
        }).pipe(
          Effect.map(() => true),
          Effect.catchTag('RerankerError', (e) => {
            if (e.reason === 'DependencyMissing') {
              return Effect.succeed(false)
            }
            return Effect.fail(e)
          }),
        )

        if (!result) {
          yield* Console.log('')
          yield* Console.log('Error: @huggingface/transformers not installed.')
          yield* Console.log(
            'Install with: npm install @huggingface/transformers',
          )
          return
        }

        yield* Console.log('')
        yield* Console.log('Cross-encoder model initialized successfully.')
        yield* Console.log('Use --rerank on searches for improved precision.')
        return
      }

      // Get configuration (with fallback to defaults if not available)
      const config = yield* Effect.serviceOption(ConfigService).pipe(
        Effect.map(Option.getOrElse(() => defaultConfig)),
      )
      const searchConfig = config.search

      // Apply config-based defaults when CLI options use their static defaults
      // Note: CLI options have static defaults for help text; config overrides those defaults
      const effectiveLimit = limit === 10 ? searchConfig.defaultLimit : limit
      const effectiveThreshold =
        threshold === 0.35 ? searchConfig.minSimilarity : threshold
      const effectiveAutoIndexThreshold = Option.getOrElse(
        autoIndexThreshold,
        () => searchConfig.autoIndexThreshold,
      )

      // Get index info for display
      const indexInfo = yield* Effect.promise(() => getIndexInfo(resolvedDir))

      // Check if no index exists
      if (!indexInfo.exists && !json) {
        yield* Console.log('No index found.')
        yield* Console.log('')
        yield* Console.log('Run: mdcontext index /path/to/docs')
        yield* Console.log('  Add --embed for semantic search capabilities')
        return
      }

      // Check available search modes
      const searchModes = yield* detectSearchModes(resolvedDir)
      let embedsExist = searchModes.hasEmbeddings

      // Determine search mode
      // Priority: --mode flag > --keyword flag > advanced query > auto-detect
      let effectiveMode: SearchMode
      let modeReason: string

      const modeValue = Option.getOrUndefined(mode)

      if (modeValue === 'hybrid') {
        effectiveMode = 'hybrid'
        modeReason = '--mode hybrid'
      } else if (modeValue === 'semantic') {
        if (!embedsExist) {
          embedsExist = yield* handleMissingEmbeddings(
            resolvedDir,
            effectiveAutoIndexThreshold,
            json,
          )
          if (!embedsExist) {
            return
          }
        }
        effectiveMode = 'semantic'
        modeReason = '--mode semantic'
      } else if (modeValue === 'keyword') {
        effectiveMode = 'keyword'
        modeReason = '--mode keyword'
      } else if (keyword) {
        effectiveMode = 'keyword'
        modeReason = '--keyword flag'
      } else if (isAdvancedQuery(query)) {
        effectiveMode = 'keyword'
        modeReason = 'boolean/phrase pattern detected'
      } else if (isRegexPattern(query)) {
        effectiveMode = 'keyword'
        modeReason = 'regex pattern detected'
      } else {
        // Auto-detect best mode based on available indexes
        effectiveMode = searchModes.recommendedMode
        if (effectiveMode === 'hybrid') {
          modeReason = 'both indexes available'
        } else if (effectiveMode === 'semantic') {
          modeReason = 'embeddings available'
        } else {
          modeReason = 'no embeddings'
        }
      }

      const modeIndicator = `[${effectiveMode}]`

      // Show index info (non-JSON mode)
      if (!json && indexInfo.lastUpdated) {
        const lastUpdatedDate = new Date(indexInfo.lastUpdated)
        const dateStr = lastUpdatedDate.toLocaleDateString('en-CA')
        const timeStr = lastUpdatedDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
        yield* Console.log(`Using index from ${dateStr} ${timeStr}`)
        yield* Console.log(`  Sections: ${indexInfo.sectionCount ?? 0}`)
        if (indexInfo.embeddingsExist) {
          yield* Console.log(
            `  Embeddings: yes (${indexInfo.vectorCount ?? 0} vectors)`,
          )
        } else {
          yield* Console.log('  Embeddings: no')
        }
        yield* Console.log('')
      }

      // Calculate context lines
      // -C sets both before and after; -B and -A override individual sides
      const contextValue = Option.getOrUndefined(context)
      const beforeValue = Option.getOrUndefined(beforeContext)
      const afterValue = Option.getOrUndefined(afterContext)

      const contextBefore = beforeValue ?? contextValue ?? 1
      const contextAfter = afterValue ?? contextValue ?? 1

      if (effectiveMode === 'hybrid') {
        // Hybrid search - combines BM25 and semantic with RRF
        const effectiveQuality = Option.getOrUndefined(quality) as
          | SearchQuality
          | undefined
        const { results, stats } = yield* hybridSearch(resolvedDir, query, {
          limit: effectiveLimit,
          threshold: effectiveThreshold,
          mode: 'hybrid',
          rerank,
          quality: effectiveQuality,
        })

        // Warn if reranking was requested but not applied
        if (rerank && !stats.reranked && !json) {
          yield* Console.log(
            'Note: --rerank requested but @huggingface/transformers not installed',
          )
          yield* Console.log(
            '      Install with: npm install @huggingface/transformers',
          )
          yield* Console.log('')
        }

        if (json) {
          const output = {
            mode: 'hybrid',
            modeReason,
            query,
            stats,
            results: results.map((r) => ({
              path: r.documentPath,
              heading: r.heading,
              score: r.score,
              similarity: r.similarity,
              bm25Score: r.bm25Score,
              sources: r.sources,
            })),
          }
          yield* Console.log(formatJson(output, pretty))
        } else {
          const showReason = !modeReason.startsWith('--mode')
          const modeStr = showReason
            ? `${modeIndicator} (${modeReason})`
            : modeIndicator
          yield* Console.log(`${modeStr} Searching: "${query}"`)
          yield* Console.log(`Results: ${results.length}`)
          yield* Console.log('')

          for (const result of results) {
            const sources = result.sources.join('+')
            const score = (result.score * 100).toFixed(1)
            yield* Console.log(`  ${result.documentPath}`)
            yield* Console.log(
              `    ${result.heading} (${score} RRF, ${sources})`,
            )
            yield* Console.log('')
          }
        }

        // Summarization for hybrid search
        if (summarize && results.length > 0) {
          const summarizableResults: SummarizableResult[] = results.map(
            (r) => ({
              documentPath: r.documentPath,
              heading: r.heading,
              score: r.score,
              ...(r.similarity !== undefined && { similarity: r.similarity }),
            }),
          )
          yield* runSummarization({
            results: summarizableResults,
            query,
            searchMode: 'hybrid',
            json,
            yes,
            stream,
            config: {
              mode: config.aiSummarization.mode,
              provider: config.aiSummarization.provider,
            },
          })
        }
      } else if (effectiveMode === 'keyword') {
        // Keyword search - content by default, heading-only if flag set
        const results = headingOnly
          ? yield* search(resolvedDir, {
              heading: query,
              limit: effectiveLimit,
            })
          : yield* searchContent(resolvedDir, {
              content: query,
              limit: effectiveLimit,
              contextBefore,
              contextAfter,
            })

        if (json) {
          const output = {
            mode: 'keyword',
            modeReason,
            query,
            contextBefore,
            contextAfter,
            results: results.map((r) => ({
              path: r.section.documentPath,
              heading: r.section.heading,
              level: r.section.level,
              tokens: r.section.tokenCount,
              line: r.section.startLine,
              matches: r.matches?.map((m) => ({
                lineNumber: m.lineNumber,
                line: m.line,
                contextLines: m.contextLines,
              })),
            })),
          }
          yield* Console.log(formatJson(output, pretty))
        } else {
          const searchType = headingOnly ? 'Heading' : 'Content'
          const showReason =
            modeReason !== '--mode keyword' && modeReason !== '--keyword flag'
          const modeStr = showReason
            ? `${modeIndicator} (${modeReason})`
            : modeIndicator
          yield* Console.log(`${modeStr} ${searchType} search: "${query}"`)
          yield* Console.log(`Results: ${results.length}`)
          yield* Console.log('')

          for (const result of results) {
            const levelMarker = '#'.repeat(result.section.level)
            yield* Console.log(
              `  ${result.section.documentPath}:${result.section.startLine}`,
            )
            yield* Console.log(
              `    ${levelMarker} ${result.section.heading} (${result.section.tokenCount} tokens)`,
            )

            if (result.matches && result.matches.length > 0) {
              yield* Console.log('')
              for (const match of result.matches.slice(0, 3)) {
                if (match.contextLines && match.contextLines.length > 0) {
                  for (const ctxLine of match.contextLines) {
                    const marker = ctxLine.isMatch ? '>' : ' '
                    yield* Console.log(
                      `  ${marker} ${ctxLine.lineNumber}: ${ctxLine.line}`,
                    )
                  }
                } else {
                  yield* Console.log(`    Line ${match.lineNumber}:`)
                  const snippetLines = match.snippet.split('\n')
                  for (const line of snippetLines) {
                    yield* Console.log(`      ${line}`)
                  }
                }
                yield* Console.log('')
              }
              if (result.matches.length > 3) {
                yield* Console.log(
                  `    ... and ${result.matches.length - 3} more matches`,
                )
              }
            }
            yield* Console.log('')
          }

          if (!indexInfo.embeddingsExist) {
            yield* Console.log(
              "Tip: Run 'mdcontext index --embed' to enable semantic search",
            )
          }
        }

        // Summarization for keyword search
        if (summarize && results.length > 0) {
          const summarizableResults: SummarizableResult[] = results.map(
            (r) => ({
              documentPath: r.section.documentPath,
              heading: r.section.heading,
            }),
          )
          yield* runSummarization({
            results: summarizableResults,
            query,
            searchMode: 'keyword',
            json,
            yes,
            stream,
            config: {
              mode: config.aiSummarization.mode,
              provider: config.aiSummarization.provider,
            },
          })
        }
      } else {
        // Build provider config from CLI flag if specified
        const providerConfig = Option.isSome(provider)
          ? {
              provider: provider.value as
                | 'openai'
                | 'ollama'
                | 'lm-studio'
                | 'openrouter'
                | 'voyage',
            }
          : undefined

        // Semantic search with stats for below-threshold feedback
        const semanticQuality = Option.getOrUndefined(quality) as
          | SearchQuality
          | undefined
        const searchResult = yield* semanticSearchWithStats(
          resolvedDir,
          query,
          {
            limit: effectiveLimit,
            threshold: effectiveThreshold,
            providerConfig,
            quality: semanticQuality,
            hyde,
          },
        )
        const { results, belowThresholdCount, belowThresholdHighest } =
          searchResult

        if (json) {
          const output = {
            mode: 'semantic',
            modeReason,
            query,
            hyde,
            results,
            belowThresholdCount,
            belowThresholdHighest,
          }
          yield* Console.log(formatJson(output, pretty))
        } else {
          const showSemanticReason = modeReason !== '--mode semantic'
          const semanticModeStr = showSemanticReason
            ? `${modeIndicator} (${modeReason})`
            : modeIndicator
          const hydeIndicator = hyde ? ' [HyDE]' : ''
          yield* Console.log(
            `${semanticModeStr}${hydeIndicator} Semantic search: "${query}"`,
          )
          yield* Console.log(`Results: ${results.length}`)
          yield* Console.log('')

          for (const result of results) {
            const similarity = (result.similarity * 100).toFixed(1)
            yield* Console.log(`  ${result.documentPath}`)
            yield* Console.log(`    ${result.heading} (${similarity}% match)`)
            yield* Console.log('')
          }

          // Show below-threshold feedback when 0 results but content exists
          if (
            results.length === 0 &&
            belowThresholdCount !== undefined &&
            belowThresholdCount > 0 &&
            belowThresholdHighest !== undefined
          ) {
            const highestPct = (belowThresholdHighest * 100).toFixed(1)
            const suggestedThreshold = Math.max(
              0.1,
              belowThresholdHighest - 0.05,
            ).toFixed(2)
            yield* Console.log(
              `Note: ${belowThresholdCount} results found below ${(effectiveThreshold * 100).toFixed(0)}% threshold (highest: ${highestPct}%)`,
            )
            yield* Console.log(
              `Tip: Use --threshold ${suggestedThreshold} to see more results`,
            )
            yield* Console.log('')
          }

          yield* Console.log('Tip: Use --mode keyword for exact text matching')
        }

        // Summarization for semantic search
        if (summarize && results.length > 0) {
          const summarizableResults: SummarizableResult[] = results.map(
            (r) => ({
              documentPath: r.documentPath,
              heading: r.heading,
              similarity: r.similarity,
            }),
          )
          yield* runSummarization({
            results: summarizableResults,
            query,
            searchMode: 'semantic',
            json,
            yes,
            stream,
            config: {
              mode: config.aiSummarization.mode,
              provider: config.aiSummarization.provider,
            },
          })
        }
      }
    }),
).pipe(Command.withDescription('Search by meaning or structure'))

/**
 * Options for running AI summarization
 */
interface SummarizationOptions {
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

/**
 * Run AI summarization on search results.
 * Handles cost estimation, user consent, and output formatting.
 *
 * GRACEFUL DEGRADATION: This function never fails - on error, it displays
 * an error message and returns, allowing search results to still be shown.
 */
const runSummarization = (
  options: SummarizationOptions,
): Effect.Effect<void, never> =>
  runSummarizationUnsafe(options).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        if (!options.json) {
          displaySummarizationError(error)
        }
      }),
    ),
  )

/**
 * Internal implementation that may fail.
 * Wrapped by runSummarization for graceful error handling.
 */
const runSummarizationUnsafe = (
  options: SummarizationOptions,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const { results, query, searchMode, json, yes, stream, config } = options

    if (results.length === 0) {
      if (!json) {
        yield* Console.log('No results to summarize.')
      }
      return
    }

    // Get summarizer
    const summarizerData = yield* Effect.tryPromise({
      try: async () => {
        const result = await getBestAvailableSummarizer({
          mode: config.mode,
          provider: config.provider,
        })
        if (!result) {
          throw new Error('No summarization providers available')
        }
        return result
      },
      catch: (e) => new Error(`Failed to get summarizer: ${e}`),
    })

    const { summarizer, config: resolvedConfig } = summarizerData

    // Format results for summary input
    const resultsText = formatResultsForSummary(results)

    // Estimate cost
    const costEstimate = estimateSummaryCost(
      resultsText,
      resolvedConfig.mode,
      resolvedConfig.provider,
    )

    // Display cost info
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

        // Get user consent if needed
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

    // Build prompt
    const prompt = buildPrompt({
      query,
      resultCount: results.length,
      searchMode,
    })

    // Generate summary
    if (!json) {
      yield* Console.log('')
      yield* Console.log('--- AI Summary ---')
      yield* Console.log('')
    }

    const startTime = Date.now()

    if (stream && 'summarizeStream' in summarizer) {
      // Streaming output
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
            onChunk: (chunk) => {
              process.stdout.write(chunk)
            },
          }),
        catch: (e) => new Error(`Summarization failed: ${e}`),
      })
      if (!json) {
        yield* Console.log('') // Final newline
      }
    } else {
      // Non-streaming output
      const summaryResult = yield* Effect.tryPromise({
        try: () => summarizer.summarize(resultsText, prompt),
        catch: (e) => new Error(`Summarization failed: ${e}`),
      })

      if (json) {
        yield* Console.log(
          JSON.stringify(
            {
              summary: summaryResult.summary,
              provider: summaryResult.provider,
              mode: summaryResult.mode,
              durationMs: summaryResult.durationMs,
              cost: costEstimate.isPaid ? costEstimate.formattedCost : 'FREE',
            },
            null,
            2,
          ),
        )
      } else {
        yield* Console.log(summaryResult.summary)
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

/**
 * Handle the case when embeddings don't exist.
 * Returns true if embeddings were created (or already exist), false to fall back to keyword search.
 */
const handleMissingEmbeddings = (
  resolvedDir: string,
  autoIndexThreshold: number,
  json: boolean,
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    // Get cost estimate
    // Note: We gracefully handle errors since this is an optional auto-index feature.
    // IndexNotFoundError is expected if index doesn't exist.
    const estimate = yield* estimateEmbeddingCost(resolvedDir).pipe(
      Effect.map((r): EmbeddingEstimate | null => r),
      Effect.catchTags(createCostEstimateErrorHandler()),
    )

    if (!estimate) {
      yield* Console.error(
        'No semantic index found and could not estimate cost.',
      )
      yield* Console.error('Run "mdcontext index --embed" first.')
      return false
    }

    // Check if we should auto-index
    if (estimate.estimatedTimeSeconds <= autoIndexThreshold) {
      if (!json) {
        yield* Console.log(
          `Creating semantic index (~${estimate.estimatedTimeSeconds}s, ~$${estimate.totalCost.toFixed(4)})...`,
        )
      }

      // Note: Graceful degradation - embedding errors fall back to keyword search
      const result = yield* buildEmbeddings(resolvedDir, {
        force: false,
        onFileProgress: (progress) => {
          if (!json) {
            process.stdout.write(
              `\r  [${progress.fileIndex}/${progress.totalFiles}] ${progress.filePath}...`,
            )
          }
        },
      }).pipe(
        Effect.map((r): BuildEmbeddingsResult | null => r),
        Effect.catchTags(createEmbeddingErrorHandler({ silent: json })),
      )

      if (!result) {
        return false
      }

      if (!json) {
        process.stdout.write(`\r${' '.repeat(80)}\r`)
        yield* Console.log(
          `Index created (${result.sectionsEmbedded} sections, $${result.cost.toFixed(6)})`,
        )
        yield* Console.log('')
      }

      return true
    }

    // Prompt user for larger indexes
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

      // Note: Graceful degradation - embedding errors fall back to keyword search
      const result = yield* buildEmbeddings(resolvedDir, {
        force: false,
        onFileProgress: (progress) => {
          if (!json) {
            process.stdout.write(
              `\r  [${progress.fileIndex}/${progress.totalFiles}] ${progress.filePath}...`,
            )
          }
        },
      }).pipe(
        Effect.map((r): BuildEmbeddingsResult | null => r),
        Effect.catchTags(createEmbeddingErrorHandler({ silent: json })),
      )

      if (!result) {
        return false
      }

      if (!json) {
        process.stdout.write(`\r${' '.repeat(80)}\r`)
        yield* Console.log(
          `Index created (${result.sectionsEmbedded} sections, $${result.cost.toFixed(6)})`,
        )
        yield* Console.log('')
      }

      return true
    }

    // User chose keyword search
    yield* Console.log('')
    yield* Console.log('Falling back to keyword search.')
    return false
  })
