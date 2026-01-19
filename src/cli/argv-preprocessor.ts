/**
 * Argv Preprocessor - Enables flexible flag positioning
 *
 * Effect CLI requires flags before positional args, but users expect
 * to be able to do either:
 *   mdtldr search "query" --limit 5
 *   mdtldr search --limit 5 "query"
 *
 * This preprocessor reorders argv so flags always come first for each
 * subcommand, while preserving the user's intended positional arg order.
 *
 * It also validates flags against per-command schemas and provides
 * helpful error messages for unknown flags with typo suggestions.
 */

import {
  type CommandSchema,
  flagTakesValue as schemaFlagTakesValue,
  getCommandSchema,
  getValidFlags,
} from './flag-schemas.js'
import { formatValidFlags, suggestFlag } from './typo-suggester.js'

/**
 * Result of preprocessing
 */
export interface PreprocessResult {
  /** Processed argv (reordered) */
  argv: string[]
  /** Error if unknown flag detected */
  error?: string
}

/**
 * Check if an argument looks like a flag
 */
const isFlag = (arg: string): boolean => {
  return arg.startsWith('-')
}

/**
 * Extract the base flag name (handles --flag=value syntax)
 */
const extractFlagName = (arg: string): string => {
  const eqIndex = arg.indexOf('=')
  return eqIndex >= 0 ? arg.slice(0, eqIndex) : arg
}

/**
 * Validate a flag against a command schema
 * Returns an error message if invalid, undefined if valid
 */
const validateFlag = (
  flag: string,
  schema: CommandSchema,
): string | undefined => {
  const flagName = extractFlagName(flag)
  const validFlags = getValidFlags(schema)

  if (validFlags.has(flagName)) {
    return undefined // Valid flag
  }

  // Unknown flag - build error message with suggestion
  const suggestion = suggestFlag(flagName, schema)

  let errorMsg = `Unknown option '${flagName}' for '${schema.name}'`

  if (suggestion) {
    errorMsg += `\nDid you mean '${suggestion.flag}'?`
  }

  errorMsg += `\n\nValid options for '${schema.name}':\n${formatValidFlags(schema)}`

  return errorMsg
}

/**
 * Preprocess argv to put flags before positional arguments
 *
 * Transforms: ['search', 'query', '--limit', '5', 'path']
 * Into:       ['search', '--limit', '5', 'query', 'path']
 *
 * Also validates flags and returns error for unknown flags.
 */
export const preprocessArgv = (argv: string[]): string[] => {
  const result = preprocessArgvWithValidation(argv)

  if (result.error) {
    // Print error and exit
    console.error(`\nError: ${result.error}`)
    console.error('\nRun "mdtldr <command> --help" for usage information.')
    process.exit(1)
  }

  return result.argv
}

/**
 * Preprocess argv with validation (for testing)
 */
export const preprocessArgvWithValidation = (argv: string[]): PreprocessResult => {
  // argv[0] = node, argv[1] = script, rest = user args
  const nodeAndScript = argv.slice(0, 2)
  const userArgs = argv.slice(2)

  if (userArgs.length === 0) {
    return { argv }
  }

  // Check if first arg is a subcommand (not a flag)
  const firstArg = userArgs[0]
  if (!firstArg || isFlag(firstArg)) {
    // No subcommand, return as-is
    return { argv }
  }

  const subcommand = firstArg
  const restArgs = userArgs.slice(1)

  // Get schema for this command
  const schema = getCommandSchema(subcommand)

  // If no schema, use legacy behavior (pass through)
  if (!schema) {
    return { argv }
  }

  // Separate flags (with their values) from positional args
  const flags: string[] = []
  const positionals: string[] = []

  let i = 0
  while (i < restArgs.length) {
    const arg = restArgs[i]
    if (!arg) {
      i++
      continue
    }

    if (isFlag(arg)) {
      // Skip --help/-h, let Effect CLI handle it
      if (arg === '--help' || arg === '-h') {
        flags.push(arg)
        i++
        continue
      }

      // Skip -- (end of flags marker)
      if (arg === '--') {
        // Everything after -- is positional
        i++
        while (i < restArgs.length) {
          const remaining = restArgs[i]
          if (remaining) positionals.push(remaining)
          i++
        }
        continue
      }

      // Validate the flag
      const error = validateFlag(arg, schema)
      if (error) {
        return { argv, error }
      }

      // It's a valid flag
      if (arg.includes('=')) {
        // --flag=value syntax, keep as single arg
        flags.push(arg)
        i++
      } else if (schemaFlagTakesValue(schema, arg)) {
        // Flag with separate value
        flags.push(arg)
        i++
        // Grab the value if it exists and isn't another flag
        if (i < restArgs.length) {
          const nextArg = restArgs[i]
          if (nextArg && !isFlag(nextArg)) {
            flags.push(nextArg)
            i++
          }
        }
      } else {
        // Boolean flag
        flags.push(arg)
        i++
      }
    } else {
      // Positional argument
      positionals.push(arg)
      i++
    }
  }

  // Reconstruct: node, script, subcommand, flags, positionals
  return {
    argv: [...nodeAndScript, subcommand, ...flags, ...positionals],
  }
}
