#!/usr/bin/env node

/**
 * mdcontext CLI - Token-efficient markdown analysis
 *
 * CORE COMMANDS
 *   mdcontext index [path]           Index markdown files (default: .)
 *   mdcontext search <query> [path]  Search by meaning or structure
 *   mdcontext context <files...>     Get LLM-ready summary
 *   mdcontext tree [path|file]       Show files or document outline
 *
 * LINK ANALYSIS
 *   mdcontext links <file>           What does this link to?
 *   mdcontext backlinks <file>       What links to this?
 *
 * INSPECTION
 *   mdcontext stats [path]           Index statistics
 */

import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'

// Read version from package.json using createRequire for ESM compatibility
const require = createRequire(import.meta.url)
const packageJson = require('../../package.json') as { version: string }
const CLI_VERSION: string = packageJson.version

import { CliConfig, Command } from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { ConfigService, createConfigProviderSync } from '../config/index.js'
import { MdContextConfig } from '../config/schema.js'
import type { PartialMdContextConfig } from '../config/service.js'
import { preprocessArgv } from './argv-preprocessor.js'
import {
  backlinksCommand,
  configCommand,
  contextCommand,
  duplicatesCommand,
  indexCommand,
  linksCommand,
  searchCommand,
  statsCommand,
  treeCommand,
} from './commands/index.js'
import { defaultCliConfigLayerSync } from './config-layer.js'
import {
  formatEffectCliError,
  isEffectCliValidationError,
} from './error-handler.js'
import {
  checkBareSubcommandHelp,
  checkSubcommandHelp,
  shouldShowMainHelp,
  showMainHelp,
} from './help.js'

// ============================================================================
// Main CLI
// ============================================================================

const mainCommand = Command.make('mdcontext').pipe(
  Command.withDescription('Token-efficient markdown analysis for LLMs'),
  Command.withSubcommands([
    indexCommand,
    searchCommand,
    contextCommand,
    treeCommand,
    linksCommand,
    backlinksCommand,
    duplicatesCommand,
    statsCommand,
    configCommand,
  ]),
)

const cli = Command.run(mainCommand, {
  name: 'mdcontext',
  version: CLI_VERSION,
})

// Clean CLI config: hide built-in options from help
const cliConfigLayer = CliConfig.layer({
  showBuiltIns: false,
})

// ============================================================================
// Error Handling
// ============================================================================

// Note: Error formatting and validation checking moved to error-handler.ts

// ============================================================================
// Custom Help Handling
// ============================================================================

// Check for subcommand help before anything else
checkSubcommandHelp()

// Check for bare subcommand that has nested subcommands (e.g., "config")
checkBareSubcommandHelp()

// Check if we should show main help
if (shouldShowMainHelp()) {
  showMainHelp()
  process.exit(0)
}

// Preprocess argv to allow flexible flag positioning
const processedArgv = preprocessArgv(process.argv)

// ============================================================================
// Global --config Flag Handling
// ============================================================================

/**
 * Extract --config or -c flag from argv before CLI parsing.
 * This allows loading custom config files before the CLI runs.
 */
const extractConfigPath = (
  argv: string[],
): { configPath: string | undefined; filteredArgv: string[] } => {
  const filteredArgv: string[] = []
  let configPath: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue

    // --config=path or -c=path
    if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length)
      if (value.length === 0) {
        console.error('\nError: --config requires a path')
        console.error('  Usage: --config=path/to/config.js')
        process.exit(1)
      }
      configPath = value
      continue
    }
    if (arg.startsWith('-c=')) {
      const value = arg.slice('-c='.length)
      if (value.length === 0) {
        console.error('\nError: -c requires a path')
        console.error('  Usage: -c=path/to/config.js')
        process.exit(1)
      }
      configPath = value
      continue
    }

    // --config path or -c path
    if (arg === '--config' || arg === '-c') {
      const nextArg = argv[i + 1]
      if (!nextArg || nextArg.startsWith('-')) {
        console.error('\nError: --config requires a path')
        console.error('  Usage: --config path/to/config.js')
        process.exit(1)
      }
      if (nextArg.length === 0) {
        console.error('\nError: --config path cannot be empty')
        process.exit(1)
      }
      configPath = nextArg
      i++ // Skip the path argument
      continue
    }

    filteredArgv.push(arg)
  }

  return { configPath, filteredArgv }
}

// Extract config path from processed argv
const { configPath: customConfigPath, filteredArgv } =
  extractConfigPath(processedArgv)

// ============================================================================
// Config Loading Utilities (shared between async and sync paths)
// ============================================================================

/**
 * Validate config file exists and exit with error if not found.
 */
function validateConfigFileExists(resolvedPath: string): void {
  if (!fs.existsSync(resolvedPath)) {
    console.error(`\nError: Config file not found: ${resolvedPath}`)
    process.exit(1)
  }
}

/**
 * Handle config loading error with consistent formatting.
 */
const handleConfigLoadError = (error: unknown, resolvedPath: string): never => {
  console.error(`\nError: Failed to load config file: ${resolvedPath}`)
  if (error instanceof Error) {
    console.error(`  ${error.message}`)
  }
  process.exit(1)
}

/**
 * Valid top-level config keys that the config system recognizes.
 */
const VALID_CONFIG_KEYS = [
  'index',
  'search',
  'embeddings',
  'summarization',
  'output',
  'paths',
] as const

/**
 * Validate that a loaded config is a valid object (not null, not array).
 * Also validates that if it has keys, at least one is a recognized config key.
 * Uses assertion function to narrow type for TypeScript.
 */
function validateConfigObject(
  config: unknown,
  resolvedPath: string,
): asserts config is PartialMdContextConfig {
  // Check it's a non-null, non-array object
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    console.error(
      `\nError: Config file must export a default object or named "config" export`,
    )
    console.error(`  File: ${resolvedPath}`)
    process.exit(1)
  }

  // Validate structure - if there are keys, at least one should be recognized
  const configKeys = Object.keys(config)
  const hasValidKey = configKeys.some((key) =>
    VALID_CONFIG_KEYS.includes(key as (typeof VALID_CONFIG_KEYS)[number]),
  )

  if (configKeys.length > 0 && !hasValidKey) {
    console.error(`\nError: Config file has no recognized configuration keys`)
    console.error(`  File: ${resolvedPath}`)
    console.error(`  Found keys: ${configKeys.join(', ')}`)
    console.error(`  Expected at least one of: ${VALID_CONFIG_KEYS.join(', ')}`)
    process.exit(1)
  }
}

/**
 * Create a ConfigService Layer from a validated config object.
 */
const createConfigLayerFromConfig = (
  fileConfig: PartialMdContextConfig,
): Layer.Layer<ConfigService, never, never> => {
  const provider = createConfigProviderSync({
    fileConfig,
    skipEnv: false,
  })
  const configResult = Effect.runSync(
    MdContextConfig.pipe(Effect.withConfigProvider(provider)),
  )
  return Layer.succeed(ConfigService, configResult)
}

/**
 * Load a TS/JS/MJS config file asynchronously using dynamic import.
 * Returns a promise that resolves to a ConfigService Layer.
 */
async function loadConfigAsync(
  configPath: string,
): Promise<Layer.Layer<ConfigService, never, never>> {
  const resolvedPath = path.resolve(configPath)
  validateConfigFileExists(resolvedPath)

  try {
    // Use dynamic import to load TS/JS/MJS files
    const fileUrl = `file://${resolvedPath}`
    const module = (await import(fileUrl)) as {
      default?: PartialMdContextConfig
      config?: PartialMdContextConfig
    }
    const fileConfig = module.default ?? module.config

    validateConfigObject(fileConfig, resolvedPath)
    return createConfigLayerFromConfig(fileConfig)
  } catch (error) {
    // handleConfigLoadError calls process.exit(1) and never returns
    // TypeScript needs explicit return for type checking - this is unreachable
    return handleConfigLoadError(error, resolvedPath)
  }
}

/**
 * Determine if we need async loading (for TS/JS config files).
 * All non-JSON config files need async loading via dynamic import.
 */
const needsAsyncLoading = (configPath: string | undefined): boolean => {
  if (!configPath) return false
  const ext = path.extname(configPath).toLowerCase()
  // Async load for all JS/TS variants, sync for JSON only
  return ext !== '.json'
}

/**
 * Create config layer synchronously (for JSON or no custom config).
 */
function createConfigLayerSync(): Layer.Layer<ConfigService, never, never> {
  if (!customConfigPath) {
    return defaultCliConfigLayerSync
  }

  const resolvedPath = path.resolve(customConfigPath)
  validateConfigFileExists(resolvedPath)

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8')

    // Parse JSON with proper validation
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (parseError) {
      console.error(`\nError: Invalid JSON in config file: ${resolvedPath}`)
      console.error(
        `  ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      )
      process.exit(1)
    }

    // Validate structure before using
    validateConfigObject(parsed, resolvedPath)
    return createConfigLayerFromConfig(parsed)
  } catch (error) {
    // handleConfigLoadError calls process.exit(1) and never returns
    return handleConfigLoadError(error, resolvedPath)
  }
}

/**
 * Run the CLI with error handling.
 */
const runCli = (
  configLayer: Layer.Layer<ConfigService, never, never>,
): void => {
  const appLayers = Layer.mergeAll(
    NodeContext.layer,
    cliConfigLayer,
    configLayer,
  )

  Effect.suspend(() => cli(filteredArgv)).pipe(
    Effect.provide(appLayers),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        if (isEffectCliValidationError(error)) {
          const message = formatEffectCliError(error)
          console.error(`\nError: ${message}`)
          console.error('\nRun "mdcontext --help" for usage information.')
          process.exit(1)
        }
        // Handle all other unexpected errors instead of rethrowing
        console.error('\nUnexpected error:')
        console.error(error)
        process.exit(2)
      }),
    ),
    NodeRuntime.runMain,
  )
}

// Handle async vs sync config loading based on file type
if (needsAsyncLoading(customConfigPath)) {
  // Async path for TS/JS/MJS config files using async/await with proper error handling
  ;(async () => {
    // Runtime check for config path - TypeScript can't verify needsAsyncLoading's guard
    if (!customConfigPath) {
      console.error('\nError: Config path is required for async loading')
      process.exit(1)
    }

    try {
      const configLayer = await loadConfigAsync(customConfigPath)
      runCli(configLayer)
    } catch (error) {
      // This catches errors from runCli, not loadConfigAsync
      // (loadConfigAsync has its own error handling that calls process.exit)
      console.error(`\nError: Failed to initialize CLI`)
      if (error instanceof Error) {
        console.error(`  ${error.message}`)
        if (error.stack) {
          console.error(`\nStack trace:`)
          console.error(error.stack)
        }
      }
      process.exit(1)
    }
  })().catch((error) => {
    // Catch any errors that escape the try-catch (e.g., errors before try block)
    console.error('\nUnexpected error during initialization')
    console.error(error)
    process.exit(1)
  })
} else {
  // Sync path for JSON configs or no custom config
  const configLayer = createConfigLayerSync()
  runCli(configLayer)
}
