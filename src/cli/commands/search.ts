/**
 * SEARCH Command
 *
 * Search markdown content by meaning or heading pattern.
 */

import * as path from 'node:path'
import * as readline from 'node:readline'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect, Option } from 'effect'
import {
  type BuildEmbeddingsResult,
  buildEmbeddings,
  estimateEmbeddingCost,
  semanticSearch,
} from '../../embeddings/semantic-search.js'
import { isAdvancedQuery } from '../../search/query-parser.js'
import { search, searchContent } from '../../search/searcher.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson, getIndexInfo, isRegexPattern } from '../utils.js'

// Auto-index threshold in seconds
const AUTO_INDEX_THRESHOLD_SECONDS = 10

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
    mode: Options.choice('mode', ['semantic', 'keyword']).pipe(
      Options.withAlias('m'),
      Options.withDescription('Force search mode: semantic or keyword'),
      Options.optional,
    ),
    limit: Options.integer('limit').pipe(
      Options.withAlias('n'),
      Options.withDescription('Maximum results'),
      Options.withDefault(10),
    ),
    threshold: Options.float('threshold').pipe(
      Options.withDescription('Similarity threshold for semantic search (0-1)'),
      Options.withDefault(0.45),
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
      Options.withDefault(AUTO_INDEX_THRESHOLD_SECONDS),
    ),
    json: jsonOption,
    pretty: prettyOption,
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
    json,
    pretty,
  }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dirPath)

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

      // Check for embeddings
      let embedsExist = indexInfo.embeddingsExist

      // Determine search mode
      // Priority: --mode flag > --keyword flag > regex pattern > embeddings availability
      let useKeyword: boolean
      let modeReason: string

      const modeValue = Option.getOrUndefined(mode)

      if (modeValue === 'semantic') {
        // User explicitly requested semantic search
        if (!embedsExist) {
          // Try to auto-create index
          embedsExist = yield* handleMissingEmbeddings(
            resolvedDir,
            autoIndexThreshold,
            json,
          )
          if (!embedsExist) {
            // User declined or error
            return
          }
        }
        useKeyword = false
        modeReason = '--mode semantic'
      } else if (modeValue === 'keyword') {
        useKeyword = true
        modeReason = '--mode keyword'
      } else if (keyword) {
        useKeyword = true
        modeReason = '--keyword flag'
      } else if (isAdvancedQuery(query)) {
        // Detect quoted phrases and boolean operators (AND, OR, NOT)
        useKeyword = true
        modeReason = 'boolean/phrase pattern detected'
      } else if (isRegexPattern(query)) {
        useKeyword = true
        modeReason = 'regex pattern detected'
      } else if (!embedsExist) {
        useKeyword = true
        modeReason = 'no embeddings'
      } else {
        useKeyword = false
        modeReason = 'embeddings available'
      }

      const modeIndicator = useKeyword ? '[keyword]' : '[semantic]'

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

      if (useKeyword) {
        // Keyword search - content by default, heading-only if flag set
        const results = headingOnly
          ? yield* search(resolvedDir, { heading: query, limit })
          : yield* searchContent(resolvedDir, {
              content: query,
              limit,
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
          // Show mode with explanation for auto-detected modes
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

            // Show match snippets with line numbers
            if (result.matches && result.matches.length > 0) {
              yield* Console.log('')
              for (const match of result.matches.slice(0, 3)) {
                // Show first 3 matches per section
                // Use contextLines for formatted output with line numbers
                if (match.contextLines && match.contextLines.length > 0) {
                  for (const ctxLine of match.contextLines) {
                    const marker = ctxLine.isMatch ? '>' : ' '
                    yield* Console.log(
                      `  ${marker} ${ctxLine.lineNumber}: ${ctxLine.line}`,
                    )
                  }
                } else {
                  // Fallback to simple snippet display
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

          // Show tip for enabling semantic search if no embeddings
          if (!indexInfo.embeddingsExist) {
            yield* Console.log(
              "Tip: Run 'mdcontext index --embed' to enable semantic search",
            )
          }
        }
      } else {
        // Semantic search - errors will propagate to CLI boundary
        const results = yield* semanticSearch(resolvedDir, query, {
          limit,
          threshold,
        })

        if (json) {
          const output = {
            mode: 'semantic',
            modeReason,
            query,
            results,
          }
          yield* Console.log(formatJson(output, pretty))
        } else {
          // Show mode with explanation for auto-detected modes
          const showSemanticReason = modeReason !== '--mode semantic'
          const semanticModeStr = showSemanticReason
            ? `${modeIndicator} (${modeReason})`
            : modeIndicator
          yield* Console.log(`${semanticModeStr} Semantic search: "${query}"`)
          yield* Console.log(`Results: ${results.length}`)
          yield* Console.log('')

          for (const result of results) {
            const similarity = (result.similarity * 100).toFixed(1)
            yield* Console.log(`  ${result.documentPath}`)
            yield* Console.log(`    ${result.heading} (${similarity}% match)`)
            yield* Console.log('')
          }

          // Show tip for keyword search alternative
          yield* Console.log('Tip: Use --mode keyword for exact text matching')
        }
      }
    }),
).pipe(Command.withDescription('Search by meaning or structure'))

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
      Effect.catchTags({
        IndexNotFoundError: () => Effect.succeed(null),
        FileReadError: (e) => {
          // Log file read errors for debugging
          Effect.runSync(
            Effect.logWarning(
              `Could not read index files: ${e.message}`,
            ),
          )
          return Effect.succeed(null)
        },
        IndexCorruptedError: (e) => {
          // Log corruption errors for debugging
          Effect.runSync(
            Effect.logWarning(
              `Index is corrupted: ${e.details ?? e.reason}`,
            ),
          )
          return Effect.succeed(null)
        },
      }),
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
        Effect.catchTags({
          ApiKeyMissingError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\n${e.message}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
          ApiKeyInvalidError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\n${e.message}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
          IndexNotFoundError: () =>
            Effect.succeed(null as BuildEmbeddingsResult | null),
          FileReadError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\nCannot read index files: ${e.message}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
          IndexCorruptedError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\nIndex is corrupted: ${e.details ?? e.reason}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
          EmbeddingError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\nEmbedding failed: ${e.message}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
          VectorStoreError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\nVector store error: ${e.message}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
        }),
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
        Effect.catchTags({
          ApiKeyMissingError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\n${e.message}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
          ApiKeyInvalidError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\n${e.message}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
          IndexNotFoundError: () =>
            Effect.succeed(null as BuildEmbeddingsResult | null),
          FileReadError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\nCannot read index files: ${e.message}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
          IndexCorruptedError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\nIndex is corrupted: ${e.details ?? e.reason}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
          EmbeddingError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\nEmbedding failed: ${e.message}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
          VectorStoreError: (e) => {
            if (!json) {
              Effect.runSync(Console.error(`\nVector store error: ${e.message}`))
            }
            return Effect.succeed(null as BuildEmbeddingsResult | null)
          },
        }),
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
