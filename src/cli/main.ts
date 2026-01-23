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

import { CliConfig, Command } from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { preprocessArgv } from './argv-preprocessor.js'
import {
  backlinksCommand,
  contextCommand,
  indexCommand,
  linksCommand,
  searchCommand,
  statsCommand,
  treeCommand,
} from './commands/index.js'
import {
  formatEffectCliError,
  isEffectCliValidationError,
} from './error-handler.js'
import {
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
    statsCommand,
  ]),
)

const cli = Command.run(mainCommand, {
  name: 'mdcontext',
  version: '0.1.0',
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

// Check if we should show main help
if (shouldShowMainHelp()) {
  showMainHelp()
  process.exit(0)
}

// Preprocess argv to allow flexible flag positioning
const processedArgv = preprocessArgv(process.argv)

// Run with clean config and friendly errors
Effect.suspend(() => cli(processedArgv)).pipe(
  Effect.provide(Layer.merge(NodeContext.layer, cliConfigLayer)),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      // Only show friendly error for Effect CLI validation errors
      if (isEffectCliValidationError(error)) {
        const message = formatEffectCliError(error)
        console.error(`\nError: ${message}`)
        console.error('\nRun "mdcontext --help" for usage information.')
        process.exit(1)
      }
      // Re-throw other errors to be handled normally
      throw error
    }),
  ),
  NodeRuntime.runMain,
)
