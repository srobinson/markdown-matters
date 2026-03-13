/**
 * Shared CLI Options
 *
 * Common options used across multiple commands.
 */

import { Options } from '@effect/cli'

/**
 * Global config file path override
 * Allows specifying a custom config file instead of auto-detection.
 */
export const configOption = Options.file('config').pipe(
  Options.withAlias('c'),
  Options.withDescription('Path to config file'),
  Options.optional,
)

/**
 * Output as JSON
 */
export const jsonOption = Options.boolean('json').pipe(
  Options.withDescription('Output as JSON'),
  Options.withDefault(false),
)

/**
 * Pretty-print JSON output
 */
export const prettyOption = Options.boolean('pretty').pipe(
  Options.withDescription('Pretty-print JSON output'),
  Options.withDefault(true),
)

/**
 * Bypass mtime/hash checks and re-process every file.
 * Does NOT delete the index directory.
 */
export const forceOption = Options.boolean('force').pipe(
  Options.withAlias('f'),
  Options.withDescription('Bypass mtime/hash cache and re-process every file'),
  Options.withDefault(false),
)
