/**
 * CONFIG Command
 *
 * Configuration management commands: init, check, etc.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { Command, Options } from '@effect/cli'
import { Console, Effect, Option } from 'effect'
import {
  type ConfigIssue,
  formatConfigIssue,
  loadConfigFile,
  loadDetailed,
  type MdmConfig,
  type PartialMdmConfig,
} from '../../config/index.js'
import { ConfigError } from '../../errors/index.js'
import { resolveMdmHome } from '../../home.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson } from '../utils.js'

/**
 * Config init subcommand - creates a starter .mdm.toml config file.
 */
const initCommand = Command.make(
  'init',
  {
    force: Options.boolean('force').pipe(
      Options.withDescription('Overwrite existing config file'),
      Options.withDefault(false),
    ),
    global: Options.boolean('global').pipe(
      Options.withAlias('g'),
      Options.withDescription('Write to the active MDM_HOME instead of PWD'),
      Options.withDefault(false),
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ force, global: useGlobal, json, pretty }) =>
    Effect.gen(function* () {
      const targetDir = useGlobal
        ? resolveMdmHome({ create: true })
        : process.cwd()

      const filepath = path.join(targetDir, '.mdm.toml')

      // Check if a config file already exists
      if (fs.existsSync(filepath) && !force) {
        if (json) {
          yield* Console.log(
            formatJson(
              {
                error: 'Config file already exists',
                path: filepath,
                hint: 'Use --force to overwrite',
              },
              pretty,
            ),
          )
        } else {
          yield* Console.error(`Config file already exists: ${filepath}`)
          yield* Console.error('')
          yield* Console.error('Use --force to overwrite.')
        }
        return
      }

      // Generate TOML content from defaults
      const { generateDefaultToml } = yield* Effect.tryPromise({
        try: () => import('./init-toml.js'),
        catch: (e) => new Error(`Failed to load TOML generator: ${e}`),
      })
      const content = generateDefaultToml()

      // Write the file
      yield* Effect.try({
        try: () => fs.writeFileSync(filepath, content, 'utf-8'),
        catch: (e) => new Error(`Failed to write config file: ${e}`),
      })

      if (json) {
        yield* Console.log(
          formatJson(
            {
              created: filepath,
              format: 'toml',
            },
            pretty,
          ),
        )
      } else {
        yield* Console.log(`Created ${filepath}`)
        yield* Console.log('')
        yield* Console.log('Edit the file to customize mdm for your project.')
      }
    }),
).pipe(Command.withDescription('Create a starter .mdm.toml config file'))

/**
 * Config show subcommand - displays current config.
 */
const showCommand = Command.make(
  'show',
  {
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ json, pretty }) =>
    Effect.gen(function* () {
      const cwd = process.cwd()

      // Find existing config file
      const configResult = loadConfigFile(cwd)

      if (!configResult) {
        if (json) {
          yield* Console.log(
            formatJson(
              {
                error: 'No config file found',
                searchedIn: cwd,
                searchedFor: ['.mdm.toml'],
              },
              pretty,
            ),
          )
        } else {
          yield* Console.log('No config file found.')
          yield* Console.log('')
          yield* Console.log('Searched for:')
          yield* Console.log('  - .mdm.toml (project-local)')
          yield* Console.log(
            `  - ${path.join(resolveMdmHome(), '.mdm.toml')} (active home)`,
          )
          yield* Console.log('')
          yield* Console.log("Run 'mdm config init' to create one.")
        }
        return
      }

      if (json) {
        yield* Console.log(
          formatJson(
            {
              configFile: configResult.path,
            },
            pretty,
          ),
        )
      } else {
        yield* Console.log(`Config file: ${configResult.path}`)
      }
    }),
).pipe(Command.withDescription('Show config file location'))

// ============================================================================
// Config Check Types
// ============================================================================

type ConfigSource = 'default' | 'file' | 'env'

interface ConfigValueWithSource<T> {
  value: T
  source: ConfigSource
  valid: boolean
  errors?: string[]
}

type ConfigSectionWithSources<T> = {
  [K in keyof T]: ConfigValueWithSource<T[K]>
}

interface ConfigWithSources {
  index: ConfigSectionWithSources<MdmConfig['index']>
  search: ConfigSectionWithSources<MdmConfig['search']>
  embeddings: ConfigSectionWithSources<MdmConfig['embeddings']>
  summarization: ConfigSectionWithSources<MdmConfig['summarization']>
  aiSummarization: ConfigSectionWithSources<MdmConfig['aiSummarization']>
  output: ConfigSectionWithSources<MdmConfig['output']>
  paths: ConfigSectionWithSources<MdmConfig['paths']>
}

interface CheckResultJson {
  valid: boolean
  sourceFile: string | null
  errors?: string[]
  config: ConfigWithSources
}

// ============================================================================
// Config Check Helpers
// ============================================================================

const getValueSource = <T>(
  key: keyof T & string,
  fileSection: Partial<T> | undefined,
  envSection: Partial<T> | undefined,
): ConfigSource => {
  if (envSection?.[key] !== undefined) return 'env'
  if (fileSection?.[key] !== undefined) return 'file'
  return 'default'
}

const getPartialSection = <T extends object>(
  config: PartialMdmConfig,
  sectionName: keyof PartialMdmConfig,
): Partial<T> | undefined => config[sectionName] as Partial<T> | undefined

/**
 * Build config section with effective values, sources, and validation state.
 */
const buildSectionWithSources = <T extends object>(
  sectionName: keyof PartialMdmConfig,
  effectiveSection: T,
  fileSection: Partial<T> | undefined,
  envConfig: PartialMdmConfig,
  issuesByPath: Map<string, string[]>,
): ConfigSectionWithSources<T> => {
  const result: Record<string, ConfigValueWithSource<unknown>> = {}
  const effective = effectiveSection as unknown as Record<string, unknown>
  const envSection = getPartialSection<T>(envConfig, sectionName)

  for (const [key, value] of Object.entries(effective)) {
    const issueMessages = issuesByPath.get(`${sectionName}.${key}`)

    result[key] = {
      value,
      source: getValueSource(key as keyof T & string, fileSection, envSection),
      valid: issueMessages === undefined,
      ...(issueMessages ? { errors: issueMessages } : {}),
    }
  }

  return result as ConfigSectionWithSources<T>
}

const buildIssuesByPath = (issues: ConfigIssue[]): Map<string, string[]> => {
  const result = new Map<string, string[]>()
  for (const issue of issues) {
    const messages = result.get(issue.path) ?? []
    messages.push(formatConfigIssue(issue))
    result.set(issue.path, messages)
  }
  return result
}

const parseErrorMessages = (loadResult: ReturnType<typeof loadDetailed>) =>
  loadResult.parseErrors.map(
    (error) => `Failed to parse config file ${error.path}: ${error.message}`,
  )

/**
 * Format a value for text display.
 */
const formatValue = (value: unknown): string => {
  if (Option.isOption(value)) {
    return Option.isSome(value) ? String(value.value) : '(not set)'
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    return value
  }
  return String(value)
}

/**
 * Format source annotation for text display.
 */
const formatSourceAnnotation = (source: ConfigSource): string => {
  switch (source) {
    case 'file':
      return '(from config file)'
    case 'env':
      return '(from environment)'
    case 'default':
      return '(default)'
  }
}

const formatValidationAnnotation = (
  entry: ConfigValueWithSource<unknown>,
): string => (entry.valid ? '' : ` (invalid: ${entry.errors?.join('; ')})`)

/**
 * Convert config with sources to JSON format.
 * Handles Option values by converting them to their underlying value or null.
 */
const configToJsonFormat = (config: ConfigWithSources): ConfigWithSources => {
  const convertSection = <
    T extends Record<string, ConfigValueWithSource<unknown>>,
  >(
    section: T,
  ): T => {
    const result: Record<string, ConfigValueWithSource<unknown>> = {}
    for (const [key, entry] of Object.entries(section)) {
      let value = entry.value
      if (Option.isOption(value)) {
        value = Option.isSome(value) ? value.value : null
      }
      result[key] = {
        value,
        source: entry.source,
        valid: entry.valid,
        ...(entry.errors ? { errors: entry.errors } : {}),
      }
    }
    return result as T
  }

  return {
    index: convertSection(config.index),
    search: convertSection(config.search),
    embeddings: convertSection(config.embeddings),
    summarization: convertSection(config.summarization),
    aiSummarization: convertSection(config.aiSummarization),
    output: convertSection(config.output),
    paths: convertSection(config.paths),
  }
}

/**
 * Config check subcommand - validates config and shows effective values with sources.
 */
const checkCommand = Command.make(
  'check',
  {
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ json, pretty }) =>
    Effect.gen(function* () {
      const cwd = process.cwd()
      const loadResult = loadDetailed({
        workingDir: cwd,
        suppressWarnings: true,
      })
      const issuesByPath = buildIssuesByPath(loadResult.validationIssues)
      const errors = [
        ...parseErrorMessages(loadResult),
        ...Array.from(issuesByPath.values()).flat(),
      ]
      const sourceFile =
        loadResult.sourceFile ?? loadResult.parseError?.path ?? null
      const fileConfig = loadResult.fileConfig
      const envConfig = loadResult.envConfig
      const config = loadResult.config

      // Build config with source annotations
      const configWithSources: ConfigWithSources = {
        index: buildSectionWithSources(
          'index',
          config.index,
          fileConfig.index,
          envConfig,
          issuesByPath,
        ),
        search: buildSectionWithSources(
          'search',
          config.search,
          fileConfig.search,
          envConfig,
          issuesByPath,
        ),
        embeddings: buildSectionWithSources(
          'embeddings',
          config.embeddings,
          fileConfig.embeddings as Partial<MdmConfig['embeddings']> | undefined,
          envConfig,
          issuesByPath,
        ),
        summarization: buildSectionWithSources(
          'summarization',
          config.summarization,
          fileConfig.summarization,
          envConfig,
          issuesByPath,
        ),
        aiSummarization: buildSectionWithSources(
          'aiSummarization',
          config.aiSummarization,
          fileConfig.aiSummarization as
            | Partial<MdmConfig['aiSummarization']>
            | undefined,
          envConfig,
          issuesByPath,
        ),
        output: buildSectionWithSources(
          'output',
          config.output,
          fileConfig.output,
          envConfig,
          issuesByPath,
        ),
        paths: buildSectionWithSources(
          'paths',
          config.paths,
          fileConfig.paths as Partial<MdmConfig['paths']> | undefined,
          envConfig,
          issuesByPath,
        ),
      }

      const isValid = errors.length === 0

      if (json) {
        const result: CheckResultJson = {
          valid: isValid,
          sourceFile,
          config: configToJsonFormat(configWithSources),
        }
        if (errors.length > 0) {
          result.errors = errors
        }
        yield* Console.log(formatJson(result, pretty))
      } else {
        // Text format output
        if (isValid) {
          yield* Console.log('Configuration validated successfully!')
        } else {
          yield* Console.log('Configuration has errors:')
          for (const error of errors) {
            yield* Console.log(`  - ${error}`)
          }
        }
        yield* Console.log('')

        if (sourceFile) {
          yield* Console.log(`Source: ${sourceFile}`)
        } else {
          yield* Console.log('Source: No config file found (using defaults)')
        }
        yield* Console.log('')

        yield* Console.log('Effective configuration:')

        // Display each section
        for (const [sectionName, section] of Object.entries(
          configWithSources,
        )) {
          yield* Console.log(`  ${sectionName}:`)
          for (const [key, entry] of Object.entries(
            section as Record<string, ConfigValueWithSource<unknown>>,
          )) {
            const valueStr = formatValue(entry.value)
            const sourceStr = formatSourceAnnotation(entry.source)
            const validationStr = formatValidationAnnotation(entry)
            yield* Console.log(
              `    ${key}: ${valueStr} ${sourceStr}${validationStr}`,
            )
          }
        }
      }

      if (!isValid) {
        return yield* Effect.fail(
          new ConfigError({
            message: 'Configuration check failed',
            ...(sourceFile ? { sourceFile } : {}),
          }),
        )
      }
    }),
).pipe(Command.withDescription('Validate and display effective configuration'))

/**
 * Main config command with subcommands.
 */
export const configCommand = Command.make('config').pipe(
  Command.withDescription('Configuration management'),
  Command.withSubcommands([initCommand, showCommand, checkCommand]),
)
