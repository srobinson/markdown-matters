/**
 * INDEX Command
 *
 * Index markdown files for fast searching.
 */

import * as path from 'node:path'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect } from 'effect'
import { buildEmbeddings } from '../../embeddings/semantic-search.js'
import { buildIndex } from '../../index/indexer.js'
import { watchDirectory } from '../../index/watcher.js'
import { forceOption, jsonOption, prettyOption } from '../options.js'
import { formatJson } from '../utils.js'

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
    watch: Options.boolean('watch').pipe(
      Options.withAlias('w'),
      Options.withDescription('Watch for changes'),
      Options.withDefault(false),
    ),
    force: forceOption,
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ path: dirPath, embed, watch: watchMode, force, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dirPath)

      if (watchMode) {
        yield* Console.log(`Watching ${resolvedDir} for changes...`)
        yield* Console.log('Press Ctrl+C to stop.')
        yield* Console.log('')

        const watcher = yield* watchDirectory(resolvedDir, {
          force,
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

        const result = yield* buildIndex(resolvedDir, { force })

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

          if (result.errors.length > 0) {
            yield* Console.log('')
            yield* Console.log(`Errors (${result.errors.length}):`)
            for (const error of result.errors) {
              yield* Console.log(`  ${error.path}: ${error.message}`)
            }
          }
        }

        // Build embeddings if requested
        if (embed) {
          yield* Console.log('')
          yield* Console.log('Building embeddings...')

          const embedResult = yield* buildEmbeddings(resolvedDir, { force })

          if (!json) {
            yield* Console.log(
              `Embedded ${embedResult.sectionsEmbedded} sections`,
            )
            yield* Console.log(`  Tokens used: ${embedResult.tokensUsed}`)
            yield* Console.log(`  Cost: $${embedResult.cost.toFixed(6)}`)
            yield* Console.log(`  Duration: ${embedResult.duration}ms`)
          }
        }

        if (json) {
          yield* Console.log(formatJson(result, pretty))
        }
      }
    }),
).pipe(Command.withDescription('Index markdown files'))
