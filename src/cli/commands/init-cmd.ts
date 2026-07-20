/**
 * INIT Command
 *
 * Top-level `mdm init` command for initializing mdm in a directory.
 * Handles project config and active home setup.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { Command, Options } from '@effect/cli'
import { Console, Effect } from 'effect'
import { loadConfigFile } from '../../config/index.js'
import { resolveMdmHome } from '../../home.js'
import { appendManifestDirectory } from '../../manifest.js'
import { generateDefaultToml } from './init-toml.js'

// ============================================================================
// Prompting Helpers
// ============================================================================

const prompt = (question: string): Effect.Effect<string> =>
  Effect.async<string>((resume) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(question, (answer) => {
      rl.close()
      resume(Effect.succeed(answer.trim()))
    })
  })

const confirm = (question: string, defaultYes = true): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const suffix = defaultYes ? '[Y/n]' : '[y/N]'
    const answer = yield* prompt(`${question} ${suffix} `)
    if (answer === '') return defaultYes
    return answer.toLowerCase().startsWith('y')
  })

// ============================================================================
// Init Command
// ============================================================================

export const initCommand = Command.make(
  'init',
  {
    local: Options.boolean('local').pipe(
      Options.withAlias('l'),
      Options.withDescription('Create project config in current directory'),
      Options.withDefault(false),
    ),
    global: Options.boolean('global').pipe(
      Options.withAlias('g'),
      Options.withDescription('Initialize the active MDM_HOME'),
      Options.withDefault(false),
    ),
    yes: Options.boolean('yes').pipe(
      Options.withAlias('y'),
      Options.withDescription('Accept all defaults without prompting'),
      Options.withDefault(false),
    ),
  },
  ({ local, global: useGlobal, yes }) =>
    Effect.gen(function* () {
      const cwd = process.cwd()
      const localConfigPath = path.join(cwd, '.mdm.toml')
      const globalMdmDir = resolveMdmHome()

      // Check existing state
      const hasLocalConfig = fs.existsSync(localConfigPath)
      const hasGlobalDir = fs.existsSync(globalMdmDir)

      // Case 1: Already initialized locally
      if (hasLocalConfig && !useGlobal) {
        const existingConfig = loadConfigFile(cwd)
        yield* Console.log('Already initialized locally.')
        if (existingConfig) {
          yield* Console.log(`Config: ${existingConfig.path}`)
        }
        yield* Console.log('')
        yield* Console.log('Run "mdm index" to build the index.')
        return
      }

      // Case 2: Global exists, offer to add this directory as a source
      if (hasGlobalDir && !local && !useGlobal) {
        const shouldAdd =
          yes ||
          (yield* confirm(
            'The active MDM_HOME exists. Add this directory to the manifest?',
          ))
        if (shouldAdd) {
          yield* appendManifestDirectory(globalMdmDir, { path: cwd })
          yield* Console.log(`Added ${cwd} to manifest.`)
          yield* Console.log('')
          yield* Console.log('Run "mdm index" to build the index.')
        }
        return
      }

      // Case 3: Neither exists, or explicit flag
      if (local || useGlobal) {
        // Explicit choice via flag
        if (local) {
          yield* initLocal(cwd)
        } else {
          yield* initGlobal(cwd)
        }
        return
      }

      // Interactive choice
      yield* Console.log('Where should the config live?')
      yield* Console.log('')
      yield* Console.log('  1. Local  - .mdm.toml in this directory')
      yield* Console.log('  2. Global - .mdm.toml in the active MDM_HOME')
      yield* Console.log('')

      const choice = yes ? '1' : yield* prompt('Choose [1/2]: ')

      if (choice === '2' || choice.toLowerCase() === 'global') {
        yield* initGlobal(cwd)
      } else {
        yield* initLocal(cwd)
      }
    }),
).pipe(Command.withDescription('Initialize mdm in a directory'))

// ============================================================================
// Init Strategies
// ============================================================================

const initLocal = (cwd: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Write default config
    const configPath = path.join(cwd, '.mdm.toml')
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, generateDefaultToml(), 'utf-8')
      yield* Console.log('Created .mdm.toml')
    }

    yield* Console.log('')
    yield* Console.log('Run "mdm index" to build the index.')
  })

const initGlobal = (cwd: string) =>
  Effect.gen(function* () {
    const globalDir = resolveMdmHome({ create: true })
    const globalConfigPath = path.join(globalDir, '.mdm.toml')

    // Create the active home config if absent.
    if (!fs.existsSync(globalConfigPath)) {
      fs.writeFileSync(globalConfigPath, generateDefaultToml(), 'utf-8')
      yield* Console.log(`Created ${globalConfigPath}`)
    }

    yield* appendManifestDirectory(globalDir, { path: cwd })
    yield* Console.log(`Added ${cwd} to manifest.`)

    yield* Console.log('')
    yield* Console.log('Run "mdm index" to build the index.')
  })
