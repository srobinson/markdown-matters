/**
 * INDEX Command
 *
 * Index markdown files for fast searching.
 */

import * as path from 'node:path'
import * as readline from 'node:readline'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect, Option } from 'effect'
import type {
  BuildEmbeddingsResult,
  EmbeddingEstimate,
} from '../../embeddings/semantic-search.js'
import {
  buildEmbeddings,
  checkPricingFreshness,
  estimateEmbeddingCost,
  getPricingDate,
} from '../../embeddings/semantic-search.js'
import { buildIndex } from '../../index/indexer.js'
import { watchDirectory } from '../../index/watcher.js'
import { shouldUseColor } from '../help.js'
import { forceOption, jsonOption, prettyOption } from '../options.js'
import {
  createCostEstimateErrorHandler,
  createEmbeddingErrorHandler,
} from '../shared-error-handling.js'
import { formatJson, hasEmbeddings } from '../utils.js'

const isInteractiveTTY = (): boolean =>
  Boolean(process.stdout.isTTY && process.stdin.isTTY)

const promptUser = (message: string): Promise<string> => {
  if (!isInteractiveTTY()) {
    // Non-interactive: default to declining prompts.
    // Users should pass --embed or --no-embed explicitly in CI/piped contexts.
    return Promise.resolve('n')
  }
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

export const indexCommand = Command.make(
  'index',
  {
    path: Args.directory({ name: 'path' }).pipe(
      Args.withDescription('Directory to index'),
      Args.withDefault('.'),
    ),
    embed: Options.boolean('embed').pipe(
      Options.withAlias('e'),
      Options.withDescription('Also build semantic embeddings'),
      Options.withDefault(false),
    ),
    noEmbed: Options.boolean('no-embed').pipe(
      Options.withDescription('Skip semantic search prompt'),
      Options.withDefault(false),
    ),
    exclude: Options.text('exclude').pipe(
      Options.withAlias('x'),
      Options.withDescription(
        'Additional patterns to exclude (comma-separated). Patterns from .gitignore and .mdcontextignore are honored automatically.',
      ),
      Options.optional,
    ),
    noGitignore: Options.boolean('no-gitignore').pipe(
      Options.withDescription('Ignore .gitignore file'),
      Options.withDefault(false),
    ),
    provider: Options.choice('provider', [
      'openai',
      'ollama',
      'lm-studio',
      'openrouter',
      'voyage',
    ]).pipe(
      Options.withDescription(
        'Embedding provider: openai, ollama, lm-studio, openrouter, or voyage',
      ),
      Options.optional,
    ),
    providerBaseUrl: Options.text('provider-base-url').pipe(
      Options.withDescription('Custom provider API base URL'),
      Options.optional,
    ),
    providerModel: Options.text('provider-model').pipe(
      Options.withDescription('Embedding model to use'),
      Options.optional,
    ),
    hnswM: Options.integer('hnsw-m').pipe(
      Options.withDescription(
        'HNSW M parameter: max connections per node. Higher = better recall, larger index. Recommended: 12 (speed), 16 (balanced, default), 24 (quality)',
      ),
      Options.optional,
    ),
    hnswEfConstruction: Options.integer('hnsw-ef-construction').pipe(
      Options.withDescription(
        'HNSW efConstruction: construction-time search width. Higher = better quality, slower builds. Recommended: 128 (speed), 200 (balanced, default), 256 (quality)',
      ),
      Options.optional,
    ),
    timeout: Options.integer('timeout').pipe(
      Options.withAlias('t'),
      Options.withDescription(
        'Request timeout in milliseconds for embedding API calls (default: 30000)',
      ),
      Options.optional,
    ),
    watch: Options.boolean('watch').pipe(
      Options.withAlias('w'),
      Options.withDescription('Watch for changes'),
      Options.withDefault(false),
    ),
    force: forceOption,
    json: jsonOption,
    pretty: prettyOption,
  },
  ({
    path: dirPath,
    embed,
    noEmbed,
    exclude,
    noGitignore,
    provider,
    providerBaseUrl,
    providerModel,
    hnswM,
    hnswEfConstruction,
    timeout,
    watch: watchMode,
    force,
    json,
    pretty,
  }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dirPath)

      // Parse exclude patterns - CLI adds to ignore files
      // Note: buildIndex now honors .gitignore and .mdcontextignore by default
      const cliExcludePatterns =
        exclude._tag === 'Some'
          ? exclude.value.split(',').map((p) => p.trim())
          : undefined

      if (watchMode) {
        yield* Console.log(`Watching ${resolvedDir} for changes...`)
        yield* Console.log('Press Ctrl+C to stop.')
        yield* Console.log('')

        const watcher = yield* watchDirectory(resolvedDir, {
          force,
          exclude: cliExcludePatterns,
          honorGitignore: !noGitignore,
          onIndex: (result) => {
            if (json) {
              console.log(formatJson(result, pretty))
            } else {
              console.log(
                `Re-indexed ${result.documentsIndexed} documents (${result.duration}ms)`,
              )
            }
          },
          onError: (error) => {
            console.error(`Watch error: ${error.message}`)
          },
        })

        yield* Effect.async<never, never>(() => {
          process.on('SIGINT', () => {
            watcher.stop()
            console.log('\nStopped watching.')
            process.exit(0)
          })
        })
      } else {
        yield* Console.log(`Indexing ${resolvedDir}...`)

        const isTTY = process.stdout.isTTY
        const useColor = shouldUseColor()

        const result = yield* buildIndex(resolvedDir, {
          force,
          exclude: cliExcludePatterns,
          honorGitignore: !noGitignore,
          onProgress: (progress) => {
            if (!json && isTTY && useColor) {
              const progressMsg = `  [${progress.current}/${progress.total}] ${progress.filePath}`
              process.stdout.write(`\x1b[2K\r${progressMsg}`)
            }
          },
        })

        // Clear the progress line after indexing completes
        if (!json && isTTY && useColor) {
          process.stdout.write('\x1b[2K\r')
        }

        if (!json) {
          yield* Console.log('')
          // Show totals, with "newly indexed" count if incremental
          const newlyIndexed =
            result.documentsIndexed < result.totalDocuments
              ? ` (${result.documentsIndexed} updated)`
              : ''
          yield* Console.log(
            `Indexed ${result.totalDocuments} documents${newlyIndexed}`,
          )
          yield* Console.log(`  Sections: ${result.totalSections}`)
          yield* Console.log(`  Links: ${result.totalLinks}`)
          yield* Console.log(`  Duration: ${result.duration}ms`)

          // Show skip summary if any files were skipped
          if (result.skipped.total > 0) {
            const skipParts: string[] = []
            if (result.skipped.unchanged > 0) {
              skipParts.push(`${result.skipped.unchanged} unchanged`)
            }
            if (result.skipped.hidden > 0) {
              skipParts.push(`${result.skipped.hidden} hidden`)
            }
            if (result.skipped.excluded > 0) {
              skipParts.push(`${result.skipped.excluded} excluded`)
            }
            yield* Console.log(`  Skipped: ${skipParts.join(', ')}`)
          }

          if (result.errors.length > 0) {
            yield* Console.log('')
            yield* Console.log(`Errors (${result.errors.length}):`)
            for (const error of result.errors) {
              yield* Console.log(`  ${error.path}: ${error.message}`)
            }
          }
        }

        // Check if we should prompt for semantic search
        const embedsExist = yield* Effect.promise(() =>
          hasEmbeddings(resolvedDir),
        )

        // Build embeddings if requested or after user prompt
        if (embed) {
          yield* Console.log('')

          // Show cost estimate first - errors propagate to CLI boundary
          const estimate = yield* estimateEmbeddingCost(resolvedDir, {
            excludePatterns: cliExcludePatterns,
          })

          if (!json) {
            yield* Console.log(`Found ${estimate.totalFiles} files to embed:`)
            for (const dir of estimate.byDirectory) {
              const costStr =
                dir.estimatedCost < 0.001
                  ? '<$0.001'
                  : `~$${dir.estimatedCost.toFixed(4)}`
              yield* Console.log(
                `  ${dir.directory.padEnd(20)} ${String(dir.fileCount).padStart(3)} files   ${costStr}`,
              )
            }
            yield* Console.log('')
            yield* Console.log(
              `Total: ~${estimate.totalTokens.toLocaleString()} tokens, ~$${estimate.totalCost.toFixed(4)} (pricing as of ${getPricingDate()}), ~${estimate.estimatedTimeSeconds}s`,
            )

            // Check for stale pricing data
            const stalenessWarning = checkPricingFreshness()
            if (stalenessWarning) {
              yield* Console.log(`  Warning: ${stalenessWarning}`)
            }
            yield* Console.log('')
          }

          if (!force) {
            yield* Console.log('Checking embeddings...')
          } else {
            yield* Console.log('Rebuilding embeddings (--force specified)...')
          }

          // Build provider config from CLI flags if specified
          const cliTimeout = Option.getOrUndefined(timeout)
          const providerConfig = Option.isSome(provider)
            ? {
                provider: provider.value as
                  | 'openai'
                  | 'ollama'
                  | 'lm-studio'
                  | 'openrouter'
                  | 'voyage',
                baseURL: Option.getOrUndefined(providerBaseUrl),
                model: Option.getOrUndefined(providerModel),
                timeout: cliTimeout,
              }
            : cliTimeout !== undefined
              ? { provider: 'openai' as const, timeout: cliTimeout }
              : undefined

          // Build HNSW options from CLI flags if specified
          const hnswOptions =
            Option.isSome(hnswM) || Option.isSome(hnswEfConstruction)
              ? {
                  m: Option.getOrUndefined(hnswM),
                  efConstruction: Option.getOrUndefined(hnswEfConstruction),
                }
              : undefined

          // Build embeddings - errors propagate to CLI boundary
          const embedResult = yield* buildEmbeddings(resolvedDir, {
            force,
            excludePatterns: cliExcludePatterns,
            providerConfig,
            hnswOptions,
            onFileProgress: (progress) => {
              if (!json && isTTY && useColor) {
                const progressMsg = `  [${progress.fileIndex}/${progress.totalFiles}] ${progress.filePath} (${progress.sectionCount} sections)...`
                process.stdout.write(`\x1b[2K\r${progressMsg}`)
              }
            },
            onBatchProgress: (progress) => {
              if (!json && isTTY && useColor) {
                const progressMsg = `  Embedding [${progress.processedSections}/${progress.totalSections}] sections (batch ${progress.batchIndex}/${progress.totalBatches})...`
                process.stdout.write(`\x1b[2K\r${progressMsg}`)
              }
            },
          })

          if (!json && isTTY && useColor) {
            // Clear the progress line completely
            process.stdout.write(
              `\r${' '.repeat(process.stdout.columns ?? 80)}\r`,
            )
            yield* Console.log('')

            if (embedResult.cacheHit) {
              // Cache hit - embeddings already exist
              yield* Console.log(
                `Embeddings already exist (${embedResult.existingVectors} vectors)`,
              )
              yield* Console.log('  Use --force to rebuild')
              yield* Console.log('')
              yield* Console.log(
                `Skipped embedding generation (saved ~$${(embedResult.estimatedSavings ?? 0).toFixed(4)})`,
              )
            } else {
              // New embeddings were created
              yield* Console.log(
                `Completed in ${(embedResult.duration / 1000).toFixed(1)}s`,
              )
              yield* Console.log(`  Files: ${embedResult.filesProcessed}`)
              yield* Console.log(`  Sections: ${embedResult.sectionsEmbedded}`)
              yield* Console.log(
                `  Tokens: ${embedResult.tokensUsed.toLocaleString()}`,
              )
              yield* Console.log(`  Cost: $${embedResult.cost.toFixed(6)}`)
            }
          }
        } else if (!noEmbed && !embedsExist && !json) {
          // Prompt user to enable semantic search
          yield* Console.log('')
          yield* Console.log(
            'Enable semantic search? This allows natural language queries like:',
          )
          yield* Console.log(
            '  "how does authentication work" instead of exact keyword matches',
          )
          yield* Console.log('')

          // Get cost estimate for the prompt
          // Note: We gracefully handle errors here since this is optional information
          // for the user prompt. IndexNotFoundError is expected if index doesn't exist.
          const estimate = yield* estimateEmbeddingCost(resolvedDir).pipe(
            Effect.map((r): EmbeddingEstimate | null => r),
            Effect.catchTags(createCostEstimateErrorHandler()),
          )

          if (estimate) {
            yield* Console.log(
              `Cost: ~$${estimate.totalCost.toFixed(4)} for this corpus (~${estimate.estimatedTimeSeconds}s)`,
            )
          }
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

          const answer = yield* Effect.promise(() =>
            promptUser('Create semantic index? [y/N]: '),
          )

          if (answer === 'y' || answer === 'yes') {
            // Check for API key (only required for cloud providers)
            // Note: When no provider is configured, we default to OpenAI which needs a key
            // Local providers (Ollama, LM Studio) don't need API keys
            if (!process.env.OPENAI_API_KEY) {
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
              yield* Console.log(
                'Then run: mdcontext index --embed [--provider <name>]',
              )
              yield* Console.log('See CONFIG.md for detailed setup.')
            } else {
              yield* Console.log('')
              yield* Console.log('Building embeddings...')

              // Build HNSW options from CLI flags if specified
              const hnswOptionsPrompt =
                Option.isSome(hnswM) || Option.isSome(hnswEfConstruction)
                  ? {
                      m: Option.getOrUndefined(hnswM),
                      efConstruction: Option.getOrUndefined(hnswEfConstruction),
                    }
                  : undefined

              // Build provider config if timeout specified
              const promptTimeout = Option.getOrUndefined(timeout)
              const providerConfigPrompt =
                promptTimeout !== undefined
                  ? { provider: 'openai' as const, timeout: promptTimeout }
                  : undefined

              // Note: We gracefully handle errors here since embedding failure
              // shouldn't block the main index operation. Errors are logged for debugging.
              const embedResult = yield* buildEmbeddings(resolvedDir, {
                force: false,
                hnswOptions: hnswOptionsPrompt,
                providerConfig: providerConfigPrompt,
                onFileProgress: (progress) => {
                  console.log(
                    `  [${progress.fileIndex}/${progress.totalFiles}] ${progress.filePath}`,
                  )
                },
              }).pipe(
                Effect.map((r): BuildEmbeddingsResult | null => r),
                Effect.catchTags(createEmbeddingErrorHandler()),
              )

              if (embedResult) {
                yield* Console.log('')
                yield* Console.log(
                  `Completed in ${(embedResult.duration / 1000).toFixed(1)}s`,
                )
                yield* Console.log(`  Files: ${embedResult.filesProcessed}`)
                yield* Console.log(
                  `  Sections: ${embedResult.sectionsEmbedded}`,
                )
                yield* Console.log(
                  `  Tokens: ${embedResult.tokensUsed.toLocaleString()}`,
                )
                yield* Console.log(`  Cost: $${embedResult.cost.toFixed(6)}`)
              }
            }
          }
        }

        if (json) {
          yield* Console.log(formatJson(result, pretty))
        }
      }
    }),
).pipe(Command.withDescription('Index markdown files'))
