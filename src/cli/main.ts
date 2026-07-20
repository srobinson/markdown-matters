#!/usr/bin/env node

/**
 * mdm CLI - Token-efficient markdown analysis
 *
 * SETUP
 *   mdm init                   Initialize mdm in a directory
 *
 * CORE COMMANDS
 *   mdm index [path]           Refresh the active manifest index
 *   mdm fix [path]             Repair malformed YAML frontmatter
 *   mdm search <query> [path]  Search by meaning or structure
 *   mdm context <files...>     Get LLM-ready summary
 *   mdm tree [path|file]       Show files or document outline
 *
 * LINK ANALYSIS
 *   mdm links <file>           What does this link to?
 *   mdm backlinks <file>       What links to this?
 *
 * INSPECTION
 *   mdm stats [path]           Index statistics
 */

import { createRequire } from 'node:module'

// Read version from package.json using createRequire for ESM compatibility
const require = createRequire(import.meta.url)
const packageJson = require('../../package.json') as { version: string }
const CLI_VERSION: string = packageJson.version

import { CliConfig, Command } from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import type { ConfigService } from '../config/service.js'
import { registerDefaultProviders } from '../providers/index.js'
import { preprocessArgv } from './argv-preprocessor.js'
import {
  backlinksCommand,
  configCommand,
  contextCommand,
  duplicatesCommand,
  embeddingsCommand,
  fixCommand,
  indexCommand,
  initCommand,
  linksCommand,
  searchCommand,
  statsCommand,
  treeCommand,
} from './commands/index.js'
import { makeCliConfigLayer } from './config-layer.js'
import { handleCliTopLevelError } from './error-handler.js'
import {
  checkBareSubcommandHelp,
  checkSubcommandHelp,
  shouldShowMainHelp,
  showMainHelp,
} from './help.js'

// ============================================================================
// Main CLI
// ============================================================================

const mainCommand = Command.make('mdm').pipe(
  Command.withDescription('Token-efficient markdown analysis for LLMs'),
  Command.withSubcommands([
    initCommand,
    indexCommand,
    fixCommand,
    searchCommand,
    contextCommand,
    treeCommand,
    linksCommand,
    backlinksCommand,
    duplicatesCommand,
    statsCommand,
    configCommand,
    embeddingsCommand,
  ]),
)

const cli = Command.run(mainCommand, {
  name: 'mdm',
  version: CLI_VERSION,
})

// Clean CLI config: hide built-in options from help
const cliConfigLayer = CliConfig.layer({
  showBuiltIns: false,
})

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
const filteredArgv = preprocessArgv(process.argv)

// ============================================================================
// Config Loading & CLI Execution
// ============================================================================

const configLayer: Layer.Layer<ConfigService> = makeCliConfigLayer({
  workingDir: process.cwd(),
})

const appLayers = Layer.mergeAll(NodeContext.layer, cliConfigLayer, configLayer)

Effect.suspend(() =>
  Effect.gen(function* () {
    yield* registerDefaultProviders()
    return yield* cli(filteredArgv)
  }),
).pipe(
  Effect.provide(appLayers),
  Effect.tap(() =>
    Effect.sync(() => {
      // Force exit after successful completion to prevent hanging
      // This is necessary because some dependencies (like OpenAI SDK)
      // may keep the event loop alive with HTTP keep-alive connections
      setImmediate(() => process.exit(0))
    }),
  ),
  Effect.catchAll(handleCliTopLevelError),
  NodeRuntime.runMain,
)
