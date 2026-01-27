/**
 * EMBEDDINGS Command
 *
 * Manage embedding providers and namespaces.
 * Allows listing, switching, and removing embedding indexes
 * for different providers/models.
 */

import * as path from 'node:path'
import * as p from '@clack/prompts'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect } from 'effect'
import {
  type EmbeddingNamespace,
  getActiveNamespace,
  listNamespaces,
  removeNamespace,
  switchNamespace,
  writeActiveProvider,
} from '../../embeddings/embedding-namespace.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson } from '../utils.js'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if we're running in an interactive TTY
 */
const isInteractiveTTY = (): boolean =>
  process.stdout.isTTY && process.stdin.isTTY

/**
 * Format a namespace for display in the picker
 */
const formatNamespaceOption = (ns: EmbeddingNamespace): string => {
  const sizeMB = (ns.sizeBytes / 1024 / 1024).toFixed(1)
  const active = ns.isActive ? ' ★' : ''
  return `${ns.provider}/${ns.model}${active} (${ns.vectorCount} vectors, ${sizeMB}MB, $${ns.totalCost.toFixed(4)})`
}

/**
 * Show interactive namespace picker using @clack/prompts
 */
const showNamespacePicker = async (
  namespaces: EmbeddingNamespace[],
  message: string,
): Promise<EmbeddingNamespace | null> => {
  const result = await p.select({
    message,
    options: namespaces.map((ns) => ({
      value: ns.namespace,
      label: formatNamespaceOption(ns),
      hint: ns.namespace,
    })),
  })

  if (p.isCancel(result)) {
    return null
  }

  return namespaces.find((ns) => ns.namespace === result) ?? null
}

/**
 * Fuzzy match namespaces against a query
 */
const fuzzyMatchNamespaces = (
  namespaces: EmbeddingNamespace[],
  query: string,
): EmbeddingNamespace[] => {
  const queryLower = query.toLowerCase()
  return namespaces.filter(
    (ns) =>
      ns.namespace.toLowerCase().includes(queryLower) ||
      ns.provider.toLowerCase().includes(queryLower) ||
      ns.model.toLowerCase().includes(queryLower),
  )
}

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
  ({ path: dirPath, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dirPath)

      const namespaces = yield* listNamespaces(resolvedDir).pipe(
        Effect.catchAll(() => Effect.succeed([] as EmbeddingNamespace[])),
      )

      if (namespaces.length === 0) {
        if (json) {
          yield* Console.log(formatJson({ namespaces: [] }, pretty))
        } else {
          yield* Console.log('No embedding namespaces found.')
          yield* Console.log('')
          yield* Console.log('Run: mdcontext index --embed')
        }
        return
      }

      if (json) {
        yield* Console.log(formatJson({ namespaces }, pretty))
        return
      }

      // Interactive picker when multiple namespaces exist and TTY is available
      if (namespaces.length > 1 && isInteractiveTTY()) {
        const selected = yield* Effect.promise(() =>
          showNamespacePicker(
            namespaces,
            'Select a namespace to switch to (or Ctrl+C to cancel):',
          ),
        )

        if (selected) {
          // Switch to the selected namespace
          const writeResult = yield* writeActiveProvider(resolvedDir, {
            namespace: selected.namespace,
            provider: selected.provider,
            model: selected.model,
            dimensions: selected.dimensions,
            activatedAt: new Date().toISOString(),
          }).pipe(
            Effect.map(() => ({ ok: true as const })),
            Effect.catchAll((e) =>
              Effect.succeed({ ok: false as const, error: e.message }),
            ),
          )

          if (!writeResult.ok) {
            yield* Console.error(
              `Error: Failed to switch namespace: ${writeResult.error}`,
            )
            process.exit(1)
            return
          }

          yield* Console.log('')
          yield* Console.log(`Switched to: ${selected.namespace}`)
          yield* Console.log(`  Provider: ${selected.provider}`)
          yield* Console.log(`  Model: ${selected.model}`)
          yield* Console.log(`  Dimensions: ${selected.dimensions}`)
        } else {
          // User cancelled, show plain list
          yield* Console.log('')
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
        }
        return
      }

      // Non-interactive: plain list output
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
).pipe(Command.withDescription('List available embedding namespaces'))

// ============================================================================
// Switch Subcommand
// ============================================================================

const switchSubcommand = Command.make(
  'switch',
  {
    namespace: Args.text({ name: 'namespace' }).pipe(
      Args.withDescription(
        'Namespace to switch to (provider name or full namespace)',
      ),
      Args.optional,
    ),
    path: Args.directory({ name: 'path' }).pipe(
      Args.withDescription('Directory containing embeddings'),
      Args.withDefault('.'),
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ namespace: namespaceOpt, path: dirPath, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dirPath)

      // Get all available namespaces first
      const namespaces = yield* listNamespaces(resolvedDir).pipe(
        Effect.catchAll(() => Effect.succeed([] as EmbeddingNamespace[])),
      )

      if (namespaces.length === 0) {
        if (json) {
          yield* Console.log(
            formatJson(
              {
                error:
                  'No embedding namespaces found. Run "mdcontext index --embed" first.',
              },
              pretty,
            ),
          )
        } else {
          yield* Console.log(
            'No embedding namespaces found. Run "mdcontext index --embed" first.',
          )
        }
        return
      }

      // If no namespace argument provided and we're in a TTY, show interactive picker
      if (namespaceOpt._tag === 'None' && isInteractiveTTY()) {
        const selected = yield* Effect.promise(() =>
          showNamespacePicker(namespaces, 'Select a namespace to switch to:'),
        )

        if (!selected) {
          yield* Console.log('Cancelled.')
          return
        }

        // Switch to selected namespace
        const writeResult = yield* writeActiveProvider(resolvedDir, {
          namespace: selected.namespace,
          provider: selected.provider,
          model: selected.model,
          dimensions: selected.dimensions,
          activatedAt: new Date().toISOString(),
        }).pipe(
          Effect.map(() => ({ ok: true as const })),
          Effect.catchAll((e) =>
            Effect.succeed({ ok: false as const, error: e.message }),
          ),
        )

        if (!writeResult.ok) {
          if (json) {
            yield* Console.log(formatJson({ error: writeResult.error }, pretty))
          } else {
            yield* Console.error(
              `Error: Failed to switch namespace: ${writeResult.error}`,
            )
          }
          process.exit(1)
          return
        }

        if (json) {
          yield* Console.log(formatJson({ switched: selected }, pretty))
        } else {
          yield* Console.log(`Switched to: ${selected.namespace}`)
          yield* Console.log(`  Provider: ${selected.provider}`)
          yield* Console.log(`  Model: ${selected.model}`)
          yield* Console.log(`  Dimensions: ${selected.dimensions}`)
        }
        return
      }

      // If no namespace argument and not a TTY, error out
      if (namespaceOpt._tag === 'None') {
        if (json) {
          yield* Console.log(
            formatJson({ error: 'Namespace argument required' }, pretty),
          )
        } else {
          yield* Console.log(
            'Error: Namespace argument required. Available namespaces:',
          )
          for (const ns of namespaces) {
            yield* Console.log(`  ${ns.namespace}`)
          }
        }
        process.exit(1)
        return
      }

      const namespace = namespaceOpt.value

      // Fuzzy match the namespace query
      const matches = fuzzyMatchNamespaces(namespaces, namespace)

      if (matches.length === 0) {
        if (json) {
          yield* Console.log(
            formatJson(
              {
                error: `No namespace matching "${namespace}". Available: ${namespaces.map((n) => n.namespace).join(', ')}`,
              },
              pretty,
            ),
          )
        } else {
          yield* Console.log(`Error: No namespace matching "${namespace}".`)
          yield* Console.log('Available namespaces:')
          for (const ns of namespaces) {
            yield* Console.log(`  ${ns.namespace}`)
          }
        }
        process.exit(1)
        return
      }

      // If multiple matches and TTY available, show picker
      if (matches.length > 1 && isInteractiveTTY()) {
        yield* Console.log(
          `Multiple namespaces match "${namespace}". Please select one:`,
        )
        const selected = yield* Effect.promise(() =>
          showNamespacePicker(matches, 'Select a namespace:'),
        )

        if (!selected) {
          yield* Console.log('Cancelled.')
          return
        }

        // Switch to selected namespace
        const writeResult = yield* writeActiveProvider(resolvedDir, {
          namespace: selected.namespace,
          provider: selected.provider,
          model: selected.model,
          dimensions: selected.dimensions,
          activatedAt: new Date().toISOString(),
        }).pipe(
          Effect.map(() => ({ ok: true as const })),
          Effect.catchAll((e) =>
            Effect.succeed({ ok: false as const, error: e.message }),
          ),
        )

        if (!writeResult.ok) {
          if (json) {
            yield* Console.log(formatJson({ error: writeResult.error }, pretty))
          } else {
            yield* Console.error(
              `Error: Failed to switch namespace: ${writeResult.error}`,
            )
          }
          process.exit(1)
          return
        }

        if (json) {
          yield* Console.log(formatJson({ switched: selected }, pretty))
        } else {
          yield* Console.log(`Switched to: ${selected.namespace}`)
          yield* Console.log(`  Provider: ${selected.provider}`)
          yield* Console.log(`  Model: ${selected.model}`)
          yield* Console.log(`  Dimensions: ${selected.dimensions}`)
        }
        return
      }

      // Multiple matches but not a TTY - use the existing switchNamespace logic
      const result = yield* switchNamespace(resolvedDir, namespace).pipe(
        Effect.catchAll((e) => {
          if (json) {
            console.log(formatJson({ error: e.message }, pretty))
          } else {
            console.error(`Error: ${e.message}`)
          }
          process.exit(1)
          return Effect.succeed(null)
        }),
      )

      if (!result) {
        return
      }

      if (json) {
        yield* Console.log(formatJson({ switched: result }, pretty))
      } else {
        yield* Console.log(`Switched to: ${result.namespace}`)
        yield* Console.log(`  Provider: ${result.provider}`)
        yield* Console.log(`  Model: ${result.model}`)
        yield* Console.log(`  Dimensions: ${result.dimensions}`)
      }
    }),
).pipe(Command.withDescription('Switch to a different embedding namespace'))

// ============================================================================
// Remove Subcommand
// ============================================================================

const removeSubcommand = Command.make(
  'remove',
  {
    namespace: Args.text({ name: 'namespace' }).pipe(
      Args.withDescription('Namespace to remove'),
    ),
    path: Args.directory({ name: 'path' }).pipe(
      Args.withDescription('Directory containing embeddings'),
      Args.withDefault('.'),
    ),
    force: Options.boolean('force').pipe(
      Options.withAlias('f'),
      Options.withDescription('Remove even if this is the active namespace'),
      Options.withDefault(false),
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ namespace, path: dirPath, force, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dirPath)

      const result = yield* removeNamespace(resolvedDir, namespace, {
        force,
      }).pipe(
        Effect.catchAll((e) => {
          if (json) {
            console.log(formatJson({ error: e.message }, pretty))
          } else {
            console.error(`Error: ${e.message}`)
          }
          process.exit(1)
          return Effect.succeed(null)
        }),
      )

      if (!result) {
        return
      }

      if (json) {
        yield* Console.log(formatJson({ removed: result }, pretty))
      } else {
        yield* Console.log(`Removed namespace: ${result.removed}`)
        if (result.wasActive) {
          yield* Console.log(
            'Note: This was the active namespace. Run "mdcontext embeddings list" to see remaining namespaces.',
          )
        }
      }
    }),
).pipe(Command.withDescription('Remove an embedding namespace'))

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
  ({ path: dirPath, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dirPath)

      const active = yield* getActiveNamespace(resolvedDir).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      )

      if (!active) {
        if (json) {
          yield* Console.log(formatJson({ active: null }, pretty))
        } else {
          yield* Console.log('No active embedding namespace.')
          yield* Console.log('')
          yield* Console.log('Run: mdcontext index --embed')
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
).pipe(Command.withDescription('Show the current active embedding namespace'))

// ============================================================================
// Main Command
// ============================================================================

export const embeddingsCommand = Command.make('embeddings', {}).pipe(
  Command.withDescription('Manage embedding namespaces'),
  Command.withSubcommands([
    listSubcommand,
    switchSubcommand,
    removeSubcommand,
    currentSubcommand,
  ]),
)
