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
  CONFIG_FILE_NAMES,
  defaultConfig,
  findConfigFile,
  loadConfigFile,
  readEnvConfig,
} from '../../config/index.js'
import type { PartialMdmConfig } from '../../config/service.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson } from '../utils.js'

/**
 * Generate the default config file content.
 * Uses JavaScript with JSDoc types for type safety without requiring TypeScript loader.
 */
const generateConfigContent = (format: 'js' | 'json'): string => {
  if (format === 'json') {
    return `{
  "$schema": "https://mdm.dev/schema.json",
  "index": {
    "maxDepth": 10,
    "excludePatterns": ["node_modules", ".git", "dist", "build"],
    "fileExtensions": [".md", ".mdx"],
    "followSymlinks": false,
    "indexDir": ".mdm"
  },
  "search": {
    "defaultLimit": 10,
    "maxLimit": 100,
    "minSimilarity": 0.35,
    "includeSnippets": true,
    "snippetLength": 200,
    "autoIndexThreshold": 10
  },
  "embeddings": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 512,
    "batchSize": 100,
    "maxRetries": 3,
    "retryDelayMs": 1000,
    "timeoutMs": 30000
  },
  "summarization": {
    "briefTokenBudget": 100,
    "summaryTokenBudget": 500,
    "compressionRatio": 0.3,
    "minSectionTokens": 20,
    "maxTopics": 10,
    "minPartialBudget": 50
  },
  "output": {
    "format": "text",
    "color": true,
    "prettyJson": true,
    "verbose": false,
    "debug": false
  }
}
`
  }

  // JavaScript format with JSDoc type annotation for type safety
  return `/**
 * mdm Configuration
 *
 * This file configures mdm behavior for this project.
 * See https://mdm.dev/config for full documentation.
 *
 * @type {import('mdm').PartialMdmConfig}
 */
export default {
  // Index settings - control how markdown files are discovered and parsed
  index: {
    // Maximum directory depth to traverse (default: 10)
    maxDepth: 10,

    // Patterns to exclude from indexing (default: common build/dep dirs)
    excludePatterns: ['node_modules', '.git', 'dist', 'build'],

    // File extensions to index (default: markdown files)
    fileExtensions: ['.md', '.mdx'],

    // Whether to follow symbolic links (default: false)
    followSymlinks: false,

    // Directory for index storage (default: '.mdm')
    indexDir: '.mdm',
  },

  // Search settings - configure search behavior and defaults
  search: {
    // Default number of results to return (default: 10)
    defaultLimit: 10,

    // Maximum results allowed (default: 100)
    maxLimit: 100,

    // Minimum similarity score for semantic search (default: 0.35)
    minSimilarity: 0.35,

    // Include content snippets in results (default: true)
    includeSnippets: true,

    // Maximum snippet length in characters (default: 200)
    snippetLength: 200,

    // Auto-create semantic index if under this many seconds (default: 10)
    autoIndexThreshold: 10,
  },

  // Embeddings settings - configure semantic search
  embeddings: {
    // Embedding provider: 'openai' (default), 'ollama', 'lm-studio', 'openrouter', or 'voyage'
    provider: 'openai',

    // Embedding model (varies by provider - default for OpenAI: 'text-embedding-3-small')
    // Ollama: 'nomic-embed-text', LM Studio: depends on loaded model
    model: 'text-embedding-3-small',

    // Vector dimensions (lower = faster, higher = more accurate) (default: 512)
    dimensions: 512,

    // Batch size for API calls (default: 100)
    batchSize: 100,

    // Max retries for failed API calls (default: 3)
    maxRetries: 3,

    // Delay between retries in ms (default: 1000)
    retryDelayMs: 1000,

    // Request timeout in ms (default: 30000)
    timeoutMs: 30000,

    // API key - set via provider-specific environment variable:
    // - OpenAI: OPENAI_API_KEY
    // - OpenRouter: OPENROUTER_API_KEY
    // - Ollama/LM Studio: No API key needed (local providers)
    // apiKey: process.env.OPENAI_API_KEY,
  },

  // Summarization settings - configure context assembly
  summarization: {
    // Token budget for 'brief' compression level (default: 100)
    briefTokenBudget: 100,

    // Token budget for 'summary' compression level (default: 500)
    summaryTokenBudget: 500,

    // Target compression ratio for summaries (default: 0.3)
    compressionRatio: 0.3,

    // Minimum tokens for any section summary (default: 20)
    minSectionTokens: 20,

    // Maximum topics to extract from a document (default: 10)
    maxTopics: 10,

    // Minimum remaining budget for partial content (default: 50)
    minPartialBudget: 50,
  },

  // Output settings - configure CLI output formatting
  output: {
    // Default output format: 'text' or 'json' (default: 'text')
    format: 'text',

    // Use colors in terminal output (default: true)
    color: true,

    // Pretty-print JSON output (default: true)
    prettyJson: true,

    // Show verbose output (default: false)
    verbose: false,

    // Show debug information (default: false)
    debug: false,
  },
}
`
}

/**
 * Config init subcommand - creates a starter config file.
 */
const initCommand = Command.make(
  'init',
  {
    format: Options.choice('format', ['js', 'json']).pipe(
      Options.withAlias('f'),
      Options.withDescription(
        'Config file format (js recommended for type safety)',
      ),
      Options.withDefault('js' as const),
    ),
    force: Options.boolean('force').pipe(
      Options.withDescription('Overwrite existing config file'),
      Options.withDefault(false),
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ format, force, json, pretty }) =>
    Effect.gen(function* () {
      const cwd = process.cwd()

      // Check if a config file already exists
      const existingConfig = findConfigFile(cwd)

      if (existingConfig && !force) {
        if (json) {
          yield* Console.log(
            formatJson(
              {
                error: 'Config file already exists',
                path: existingConfig.path,
                hint: 'Use --force to overwrite',
              },
              pretty,
            ),
          )
        } else {
          yield* Console.error(
            `Config file already exists: ${existingConfig.path}`,
          )
          yield* Console.error('')
          yield* Console.error('Use --force to overwrite.')
        }
        return
      }

      // Determine filename based on format
      const filename = format === 'json' ? 'mdm.config.json' : 'mdm.config.js'
      const filepath = path.join(cwd, filename)

      // Generate content
      const content = generateConfigContent(format)

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
              format,
            },
            pretty,
          ),
        )
      } else {
        yield* Console.log(`Created ${filename}`)
        yield* Console.log('')
        if (format === 'js') {
          yield* Console.log('The config file includes:')
          yield* Console.log(
            '  - JSDoc type annotations for IDE autocompletion',
          )
          yield* Console.log('  - Documented default values')
          yield* Console.log(
            '  - All available options including summarization',
          )
          yield* Console.log('')
          yield* Console.log('Edit the file to customize mdm for your project.')
        } else {
          yield* Console.log('Edit the file to customize mdm for your project.')
        }
      }
    }),
).pipe(Command.withDescription('Create a starter config file'))

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
      const configPath = findConfigFile(cwd)

      if (!configPath) {
        if (json) {
          yield* Console.log(
            formatJson(
              {
                error: 'No config file found',
                searchedIn: cwd,
                searchedFor: CONFIG_FILE_NAMES,
              },
              pretty,
            ),
          )
        } else {
          yield* Console.log('No config file found.')
          yield* Console.log('')
          yield* Console.log('Searched for:')
          for (const name of CONFIG_FILE_NAMES) {
            yield* Console.log(`  - ${name}`)
          }
          yield* Console.log('')
          yield* Console.log("Run 'mdm config init' to create one.")
        }
        return
      }

      if (json) {
        yield* Console.log(
          formatJson(
            {
              configFile: configPath.path,
            },
            pretty,
          ),
        )
      } else {
        yield* Console.log(`Config file: ${configPath.path}`)
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
}

type ConfigSectionWithSources<T> = {
  [K in keyof T]: ConfigValueWithSource<T[K]>
}

interface ConfigWithSources {
  index: ConfigSectionWithSources<typeof defaultConfig.index>
  search: ConfigSectionWithSources<typeof defaultConfig.search>
  embeddings: ConfigSectionWithSources<typeof defaultConfig.embeddings>
  summarization: ConfigSectionWithSources<typeof defaultConfig.summarization>
  output: ConfigSectionWithSources<typeof defaultConfig.output>
  paths: ConfigSectionWithSources<typeof defaultConfig.paths>
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

/**
 * Determine the source of a config value by checking env, file, and defaults.
 */
const getValueSource = <T>(
  key: string,
  envConfig: Map<string, string>,
  fileValue: T | undefined,
  _defaultValue: T,
): ConfigSource => {
  if (envConfig.has(key)) {
    return 'env'
  }
  if (fileValue !== undefined) {
    return 'file'
  }
  return 'default'
}

/**
 * Get effective value from the precedence chain.
 */
const getEffectiveValue = <T>(
  key: string,
  envConfig: Map<string, string>,
  fileValue: T | undefined,
  defaultValue: T,
): T => {
  const envValue = envConfig.get(key)
  if (envValue !== undefined) {
    // Parse env value based on type of default
    if (typeof defaultValue === 'boolean') {
      return (envValue === 'true') as unknown as T
    }
    if (typeof defaultValue === 'number') {
      return Number(envValue) as unknown as T
    }
    if (Array.isArray(defaultValue)) {
      return envValue.split(',') as unknown as T
    }
    return envValue as unknown as T
  }
  if (fileValue !== undefined) {
    return fileValue
  }
  return defaultValue
}

/**
 * Build config section with source annotations.
 */
const buildSectionWithSources = <T extends Record<string, unknown>>(
  sectionName: string,
  defaultSection: T,
  fileSection: Partial<T> | undefined,
  envConfig: Map<string, string>,
): ConfigSectionWithSources<T> => {
  const result: Record<string, ConfigValueWithSource<unknown>> = {}

  for (const [key, defaultValue] of Object.entries(defaultSection)) {
    const envKey = `${sectionName}.${key}`
    const fileValue = fileSection?.[key as keyof T]

    result[key] = {
      value: getEffectiveValue(envKey, envConfig, fileValue, defaultValue),
      source: getValueSource(envKey, envConfig, fileValue, defaultValue),
    }
  }

  return result as ConfigSectionWithSources<T>
}

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
      result[key] = { value, source: entry.source }
    }
    return result as T
  }

  return {
    index: convertSection(config.index),
    search: convertSection(config.search),
    embeddings: convertSection(config.embeddings),
    summarization: convertSection(config.summarization),
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
      const errors: string[] = []

      // Load config file if present
      const configResult = yield* loadConfigFile(cwd).pipe(
        Effect.catchTag('ConfigError', (e) => {
          errors.push(e.message)
          return Effect.succeed({ found: false, searched: [] } as const)
        }),
      )

      const sourceFile = configResult.found ? configResult.path : null
      const fileConfig: PartialMdmConfig = configResult.found
        ? configResult.config
        : {}

      // Read environment variables
      const envConfig = readEnvConfig('MDM')

      // Build config with source annotations
      const configWithSources: ConfigWithSources = {
        index: buildSectionWithSources(
          'index',
          defaultConfig.index,
          fileConfig.index,
          envConfig,
        ),
        search: buildSectionWithSources(
          'search',
          defaultConfig.search,
          fileConfig.search,
          envConfig,
        ),
        embeddings: buildSectionWithSources(
          'embeddings',
          defaultConfig.embeddings,
          fileConfig.embeddings,
          envConfig,
        ),
        summarization: buildSectionWithSources(
          'summarization',
          defaultConfig.summarization,
          fileConfig.summarization,
          envConfig,
        ),
        output: buildSectionWithSources(
          'output',
          defaultConfig.output,
          fileConfig.output,
          envConfig,
        ),
        paths: buildSectionWithSources(
          'paths',
          defaultConfig.paths,
          fileConfig.paths,
          envConfig,
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
            yield* Console.log(`    ${key}: ${valueStr} ${sourceStr}`)
          }
        }
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
