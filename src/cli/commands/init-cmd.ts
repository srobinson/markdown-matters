/**
 * INIT Command
 *
 * Top-level `mdm init` command for initializing mdm in a directory.
 * Handles two-tier setup: local (.mdm/ in PWD) or global (~/.mdm/).
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { Command, Options } from '@effect/cli'
import { Console, Effect } from 'effect'
import { loadConfigFile } from '../../config/index.js'
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
// Sources Management
// ============================================================================

/**
 * Append a source path to the global config's [[sources]] array.
 * Creates the config file if it does not exist.
 */
const appendSource = (
  globalConfigPath: string,
  sourcePath: string,
  name?: string | undefined,
): void => {
  let content = ''
  if (fs.existsSync(globalConfigPath)) {
    content = fs.readFileSync(globalConfigPath, 'utf-8')
  }

  // Check if this path is already registered
  if (content.includes(`path = "${sourcePath}"`)) {
    return
  }

  const sourceEntry = name
    ? `\n[[sources]]\npath = "${sourcePath}"\nname = "${name}"\n`
    : `\n[[sources]]\npath = "${sourcePath}"\n`

  fs.writeFileSync(globalConfigPath, content + sourceEntry, 'utf-8')
}

/**
 * Append .mdm/ to .gitignore if it exists, or create one.
 */
const addToGitignore = (dir: string): void => {
  const gitignorePath = path.join(dir, '.gitignore')
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8')
    if (content.includes('.mdm/') || content.includes('.mdm\n')) {
      return // Already in gitignore
    }
    fs.appendFileSync(gitignorePath, '\n# mdm index directory\n.mdm/\n')
  } else {
    fs.writeFileSync(gitignorePath, '# mdm index directory\n.mdm/\n')
  }
}

// ============================================================================
// Init Command
// ============================================================================

export const initCommand = Command.make(
  'init',
  {
    local: Options.boolean('local').pipe(
      Options.withAlias('l'),
      Options.withDescription('Initialize locally in current directory'),
      Options.withDefault(false),
    ),
    global: Options.boolean('global').pipe(
      Options.withAlias('g'),
      Options.withDescription('Initialize globally in ~/.mdm/'),
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
      const localMdmDir = path.join(cwd, '.mdm')
      const globalMdmDir = path.join(os.homedir(), '.mdm')
      const globalConfigPath = path.join(globalMdmDir, '.mdm.toml')

      // Check existing state
      const hasLocalDir = fs.existsSync(localMdmDir)
      const hasGlobalDir = fs.existsSync(globalMdmDir)
      const existingConfig = loadConfigFile(cwd)

      // Case 1: Already initialized locally
      if (hasLocalDir && !useGlobal) {
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
            'Global ~/.mdm/ exists. Add this directory as a source?',
          ))
        if (shouldAdd) {
          appendSource(globalConfigPath, cwd)
          yield* Console.log(`Added ${cwd} to global sources.`)
          yield* Console.log('')
          yield* Console.log('Run "mdm index" to build the index.')
        }
        return
      }

      // Case 3: Neither exists, or explicit flag
      if (local || useGlobal) {
        // Explicit choice via flag
        if (local) {
          yield* initLocal(cwd, localMdmDir, yes)
        } else {
          yield* initGlobal(cwd, globalMdmDir, globalConfigPath, yes)
        }
        return
      }

      // Interactive choice
      yield* Console.log('Where should the index live?')
      yield* Console.log('')
      yield* Console.log('  1. Local  - .mdm/ in this directory (project-only)')
      yield* Console.log(
        '  2. Global - ~/.mdm/ (shared across all your documents)',
      )
      yield* Console.log('')

      const choice = yes ? '1' : yield* prompt('Choose [1/2]: ')

      if (choice === '2' || choice.toLowerCase() === 'global') {
        yield* initGlobal(cwd, globalMdmDir, globalConfigPath, yes)
      } else {
        yield* initLocal(cwd, localMdmDir, yes)
      }
    }),
).pipe(Command.withDescription('Initialize mdm in a directory'))

// ============================================================================
// Init Strategies
// ============================================================================

const initLocal = (
  cwd: string,
  mdmDir: string,
  yes: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Create .mdm/ directory
    fs.mkdirSync(mdmDir, { recursive: true })
    yield* Console.log(`Created ${path.relative(cwd, mdmDir)}/`)

    // Write default config
    const configPath = path.join(cwd, '.mdm.toml')
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, generateDefaultToml(), 'utf-8')
      yield* Console.log('Created .mdm.toml')
    }

    // Offer to add to .gitignore
    const gitDir = path.join(cwd, '.git')
    if (fs.existsSync(gitDir)) {
      const shouldAdd = yes || (yield* confirm('Add .mdm/ to .gitignore?'))
      if (shouldAdd) {
        addToGitignore(cwd)
        yield* Console.log('Updated .gitignore')
      }
    }

    yield* Console.log('')
    yield* Console.log('Run "mdm index" to build the index.')
  })

const initGlobal = (
  cwd: string,
  globalDir: string,
  globalConfigPath: string,
  _yes: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Create ~/.mdm/ if absent
    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true })
      yield* Console.log(`Created ${globalDir}/`)
    }

    // Create ~/.mdm/.mdm.toml if absent
    if (!fs.existsSync(globalConfigPath)) {
      fs.writeFileSync(globalConfigPath, generateDefaultToml(), 'utf-8')
      yield* Console.log(`Created ${globalConfigPath}`)
    }

    // Register this directory as a source
    appendSource(globalConfigPath, cwd)
    yield* Console.log(`Added ${cwd} to global sources.`)

    yield* Console.log('')
    yield* Console.log('Run "mdm index" to build the index.')
  })
