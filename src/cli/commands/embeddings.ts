/**
 * EMBEDDINGS Command
 *
 * Inspect embedding provider namespaces in the current generation.
 */

import { Args, Command } from '@effect/cli'
import { Console, Effect } from 'effect'
import {
  type EmbeddingNamespace,
  getActiveNamespace,
  listNamespaces,
} from '../../embeddings/embedding-namespace.js'
import { resolveMdmHome } from '../../home.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson, withCurrentGenerationGuidance } from '../utils.js'

// ============================================================================
// List Subcommand
// ============================================================================

const listSubcommand = Command.make(
  'list',
  {
    path: Args.directory({ name: 'path' }).pipe(
      Args.withDescription('Directory containing embeddings'),
      Args.withDefault('.'),
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ path: _dirPath, json, pretty }) =>
    withCurrentGenerationGuidance(resolveMdmHome(), json, pretty, (session) =>
      Effect.gen(function* () {
        const indexRoot = session.indexRoot

        const namespaces = yield* listNamespaces(indexRoot).pipe(
          Effect.catchAll(() => Effect.succeed([] as EmbeddingNamespace[])),
        )

        if (namespaces.length === 0) {
          if (json) {
            yield* Console.log(formatJson({ namespaces: [] }, pretty))
          } else {
            yield* Console.log('No embedding namespaces found.')
            yield* Console.log('')
            yield* Console.log('Run: mdm index --embed')
          }
          return
        }

        if (json) {
          yield* Console.log(formatJson({ namespaces }, pretty))
          return
        }

        yield* Console.log('Available embedding namespaces:')
        yield* Console.log('')

        for (const ns of namespaces) {
          const active = ns.isActive ? ' (active)' : ''
          const sizeMB = (ns.sizeBytes / 1024 / 1024).toFixed(1)
          yield* Console.log(`  ${ns.namespace}${active}`)
          yield* Console.log(`    Provider: ${ns.provider}`)
          yield* Console.log(`    Model: ${ns.model}`)
          yield* Console.log(`    Dimensions: ${ns.dimensions}`)
          yield* Console.log(`    Vectors: ${ns.vectorCount}`)
          yield* Console.log(`    Size: ${sizeMB} MB`)
          yield* Console.log(`    Cost: $${ns.totalCost.toFixed(4)}`)
          yield* Console.log('')
        }
      }),
    ),
).pipe(Command.withDescription('List available embedding namespaces'))

// ============================================================================
// Current Subcommand
// ============================================================================

const currentSubcommand = Command.make(
  'current',
  {
    path: Args.directory({ name: 'path' }).pipe(
      Args.withDescription('Directory containing embeddings'),
      Args.withDefault('.'),
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ path: _dirPath, json, pretty }) =>
    withCurrentGenerationGuidance(resolveMdmHome(), json, pretty, (session) =>
      Effect.gen(function* () {
        const indexRoot = session.indexRoot

        const active = yield* getActiveNamespace(indexRoot).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        )

        if (!active) {
          if (json) {
            yield* Console.log(formatJson({ active: null }, pretty))
          } else {
            yield* Console.log('No active embedding namespace.')
            yield* Console.log('')
            yield* Console.log('Run: mdm index --embed')
          }
          return
        }

        if (json) {
          yield* Console.log(formatJson({ active }, pretty))
        } else {
          yield* Console.log(`Active namespace: ${active.namespace}`)
          yield* Console.log(`  Provider: ${active.provider}`)
          yield* Console.log(`  Model: ${active.model}`)
          yield* Console.log(`  Dimensions: ${active.dimensions}`)
        }
      }),
    ),
).pipe(Command.withDescription('Show the current active embedding namespace'))

// ============================================================================
// Main Command
// ============================================================================

export const embeddingsCommand = Command.make('embeddings', {}).pipe(
  Command.withDescription('Inspect embedding namespaces'),
  Command.withSubcommands([listSubcommand, currentSubcommand]),
)
