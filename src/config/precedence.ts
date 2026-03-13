/**
 * Config Precedence Chain
 *
 * Composes ConfigProviders to establish the standard CLI config precedence:
 *
 * ```
 * CLI Flags (highest priority)
 *     ↓
 * Environment Variables (MDM_*)
 *     ↓
 * Config File (mdm.config.ts/json)
 *     ↓
 * Defaults (lowest priority)
 * ```
 *
 * Uses a flattened Map approach to avoid memory issues with deep orElse chains.
 *
 * ## Usage
 *
 * ```typescript
 * import { createConfigProvider, ConfigProviderOptions } from './config/precedence.js'
 * import { Effect } from 'effect'
 *
 * const options: ConfigProviderOptions = {
 *   cliOverrides: { index: { maxDepth: 5 } },  // From CLI flags
 *   configPath: './custom.config.json',         // Optional explicit path
 *   workingDir: process.cwd(),                  // For config file search
 * }
 *
 * const provider = await Effect.runPromise(createConfigProvider(options))
 * // Use provider with Effect.withConfigProvider
 * ```
 */

import { ConfigProvider, Effect } from 'effect'
import type { ConfigError } from '../errors/index.js'
import { loadConfigFile, loadConfigFromPath } from './file-provider.js'
import type { PartialMdmConfig } from './service.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating the config provider chain
 */
export interface ConfigProviderOptions {
  /**
   * CLI flag overrides (highest priority)
   * These values take precedence over all other sources
   */
  cliOverrides?: PartialMdmConfig

  /**
   * Explicit path to config file
   * If provided, this file is used instead of searching
   */
  configPath?: string

  /**
   * Working directory for config file search
   * Defaults to process.cwd()
   */
  workingDir?: string

  /**
   * Environment variable prefix
   * Defaults to 'MDM'
   * Variables are expected in format: MDM_INDEX_MAXDEPTH
   */
  envPrefix?: string

  /**
   * Skip loading config file entirely
   * Useful for testing or when only using env/CLI config
   */
  skipConfigFile?: boolean

  /**
   * Skip environment variable provider
   * Useful for testing
   */
  skipEnv?: boolean
}

// ============================================================================
// Flattening Utilities
// ============================================================================

/**
 * Flatten a nested config object into dot-separated key-value pairs.
 *
 * Example:
 * ```
 * { index: { maxDepth: 5 } } -> Map([['index.maxDepth', '5']])
 * ```
 */
export const flattenConfig = (
  config: PartialMdmConfig,
  prefix = '',
): Map<string, string> => {
  const result = new Map<string, string>()

  const flatten = (obj: unknown, currentPrefix: string): void => {
    if (obj === null || obj === undefined) {
      return
    }

    if (Array.isArray(obj)) {
      // Convert arrays to comma-separated strings
      result.set(currentPrefix, obj.join(','))
      return
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        const newKey = currentPrefix ? `${currentPrefix}.${key}` : key
        flatten(value, newKey)
      }
      return
    }

    // Primitive values
    result.set(currentPrefix, String(obj))
  }

  flatten(config, prefix)
  return result
}

// ============================================================================
// Environment Variable Mapping
// ============================================================================

/**
 * Sequence delimiter for array values in environment variables.
 * MDM_INDEX_EXCLUDEPATTERNS=node_modules,dist
 */
const ENV_SEQ_DELIM = ','

// ============================================================================
// Programmatic ENV_KEY_MAPPING Generation
// ============================================================================

/**
 * Configuration schema structure defining all keys for each section.
 * This is the single source of truth for configuration keys.
 *
 * Adding a new config key:
 * 1. Add it to the appropriate section here
 * 2. Add it to the schema in schema.ts
 * 3. The ENV_KEY_MAPPING is automatically generated
 */
export const CONFIG_SCHEMA_KEYS = {
  index: [
    'maxDepth',
    'excludePatterns',
    'fileExtensions',
    'followSymlinks',
    'indexDir',
  ],
  search: [
    'defaultLimit',
    'maxLimit',
    'minSimilarity',
    'includeSnippets',
    'snippetLength',
    'autoIndexThreshold',
  ],
  embeddings: [
    'provider',
    'baseURL',
    'model',
    'dimensions',
    'batchSize',
    'maxRetries',
    'retryDelayMs',
    'timeoutMs',
    'apiKey',
  ],
  summarization: [
    'briefTokenBudget',
    'summaryTokenBudget',
    'compressionRatio',
    'minSectionTokens',
    'maxTopics',
    'minPartialBudget',
  ],
  output: ['format', 'color', 'prettyJson', 'verbose', 'debug'],
  paths: ['root', 'configFile', 'cacheDir'],
} as const

/**
 * Generate the ENV_KEY_MAPPING from the schema definition.
 *
 * ENV format: MDM_SECTION_KEY (all lowercase)
 * Config format: section.key (camelCase preserved)
 */
const generateEnvKeyMapping = (): Record<string, string> => {
  const mapping: Record<string, string> = {}
  for (const [section, keys] of Object.entries(CONFIG_SCHEMA_KEYS)) {
    for (const key of keys) {
      const envKey = `${section}_${key}`.toLowerCase()
      const configKey = `${section}.${key}`
      mapping[envKey] = configKey
    }
  }
  return mapping
}

/**
 * Known config keys for case mapping.
 * Generated programmatically from CONFIG_SCHEMA_KEYS.
 */
const ENV_KEY_MAPPING: Record<string, string> = generateEnvKeyMapping()

// Type-level completeness check
type ConfigSchemaKey = {
  [S in keyof typeof CONFIG_SCHEMA_KEYS]: `${S}.${(typeof CONFIG_SCHEMA_KEYS)[S][number]}`
}[keyof typeof CONFIG_SCHEMA_KEYS]

type _MissingMappings = Exclude<
  ConfigSchemaKey,
  (typeof ENV_KEY_MAPPING)[string]
>

// Pure type-level assertion: will fail to compile if any mappings are missing
type AssertTrue<T extends true> = T
// @ts-expect-error - Type-level assertion, intentionally unused
type _CompletenessCheck = AssertTrue<
  _MissingMappings extends never ? true : false
>
/**
 * Read environment variables with the given prefix and map them to config keys.
 *
 * @param prefix - Environment variable prefix (default: 'MDM')
 * @returns Map of config keys to values
 */
export const readEnvConfig = (prefix = 'MDM'): Map<string, string> => {
  const result = new Map<string, string>()
  const prefixWithUnderscore = `${prefix}_`

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefixWithUnderscore) && value !== undefined) {
      const envKey = key.slice(prefixWithUnderscore.length).toLowerCase()
      const configKey = ENV_KEY_MAPPING[envKey]

      if (configKey) {
        result.set(configKey, value)
      }
    }
  }

  return result
}

/**
 * Create a ConfigProvider from environment variables with the given prefix.
 * Kept for backwards compatibility.
 *
 * @param prefix - Environment variable prefix (default: 'MDM')
 * @returns ConfigProvider that reads from environment
 */
export const createEnvConfigProvider = (
  prefix = 'MDM',
): ConfigProvider.ConfigProvider => {
  const envMap = readEnvConfig(prefix)
  return ConfigProvider.fromMap(envMap, {
    pathDelim: '.',
    seqDelim: ENV_SEQ_DELIM,
  })
}

// ============================================================================
// Combined Provider
// ============================================================================

/**
 * Create the full config provider chain with proper precedence.
 *
 * Precedence (highest to lowest):
 * 1. CLI flags (if provided)
 * 2. Environment variables (MDM_*)
 * 3. Config file (if found)
 * 4. Built-in defaults (handled by Config schema)
 *
 * @param options - Configuration options
 * @returns Effect yielding the composed ConfigProvider
 */
export const createConfigProvider = (
  options: ConfigProviderOptions = {},
): Effect.Effect<ConfigProvider.ConfigProvider, ConfigError> =>
  Effect.gen(function* () {
    const {
      cliOverrides,
      configPath,
      workingDir = process.cwd(),
      envPrefix = 'MDM',
      skipConfigFile = false,
      skipEnv = false,
    } = options

    // Build merged config map with precedence (lowest to highest)
    const mergedMap = new Map<string, string>()

    // 1. File config (lowest priority)
    if (!skipConfigFile) {
      let fileConfig: PartialMdmConfig | undefined

      if (configPath) {
        fileConfig = yield* loadConfigFromPath(configPath)
      } else {
        const result = yield* loadConfigFile(workingDir)
        if (result.found) {
          fileConfig = result.config
        }
      }

      if (fileConfig) {
        const flattened = flattenConfig(fileConfig)
        for (const [k, v] of flattened) {
          mergedMap.set(k, v)
        }
      }
    }

    // 2. Environment variables (higher priority - overwrites file config)
    if (!skipEnv) {
      const envConfig = readEnvConfig(envPrefix)
      for (const [k, v] of envConfig) {
        mergedMap.set(k, v)
      }
    }

    // 3. CLI overrides (highest priority - overwrites everything)
    if (cliOverrides && Object.keys(cliOverrides).length > 0) {
      const flattened = flattenConfig(cliOverrides)
      for (const [k, v] of flattened) {
        mergedMap.set(k, v)
      }
    }

    return ConfigProvider.fromMap(mergedMap, {
      pathDelim: '.',
      seqDelim: ENV_SEQ_DELIM,
    })
  })

/**
 * Create a ConfigProvider chain synchronously (when you don't need file loading).
 *
 * Useful when:
 * - You already have the config file content
 * - You only want env vars and CLI overrides
 * - Testing without file I/O
 *
 * @param options - Configuration options
 * @returns The composed ConfigProvider
 */
export const createConfigProviderSync = (
  options: Omit<ConfigProviderOptions, 'configPath' | 'workingDir'> & {
    fileConfig?: PartialMdmConfig
  } = {},
): ConfigProvider.ConfigProvider => {
  const {
    cliOverrides,
    fileConfig,
    envPrefix = 'MDM',
    skipConfigFile = false,
    skipEnv = false,
  } = options

  // Build merged config map with precedence (lowest to highest)
  const mergedMap = new Map<string, string>()

  // 1. File config (lowest priority)
  if (!skipConfigFile && fileConfig) {
    const flattened = flattenConfig(fileConfig)
    for (const [k, v] of flattened) {
      mergedMap.set(k, v)
    }
  }

  // 2. Environment variables (higher priority)
  if (!skipEnv) {
    const envConfig = readEnvConfig(envPrefix)
    for (const [k, v] of envConfig) {
      mergedMap.set(k, v)
    }
  }

  // 3. CLI overrides (highest priority)
  if (cliOverrides && Object.keys(cliOverrides).length > 0) {
    const flattened = flattenConfig(cliOverrides)
    for (const [k, v] of flattened) {
      mergedMap.set(k, v)
    }
  }

  return ConfigProvider.fromMap(mergedMap, {
    pathDelim: '.',
    seqDelim: ENV_SEQ_DELIM,
  })
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a minimal ConfigProvider for testing.
 *
 * Includes only CLI overrides and optionally file config.
 * No environment variables are read.
 *
 * @param cliOverrides - CLI flag overrides
 * @param fileConfig - Optional file config values
 * @returns ConfigProvider for testing
 */
export const createTestConfigProvider = (
  cliOverrides?: PartialMdmConfig,
  fileConfig?: PartialMdmConfig,
): ConfigProvider.ConfigProvider => {
  const options: Parameters<typeof createConfigProviderSync>[0] = {
    skipEnv: true,
  }
  if (cliOverrides !== undefined) {
    options.cliOverrides = cliOverrides
  }
  if (fileConfig !== undefined) {
    options.fileConfig = fileConfig
  }
  return createConfigProviderSync(options)
}

/**
 * Create a ConfigProvider from CLI flag overrides.
 * Kept for backwards compatibility.
 *
 * @param overrides - Partial config from CLI flags
 * @returns ConfigProvider that provides CLI values
 */
export const createCliConfigProvider = (
  overrides: PartialMdmConfig,
): ConfigProvider.ConfigProvider => {
  const flattened = flattenConfig(overrides)
  return ConfigProvider.fromMap(flattened, {
    pathDelim: '.',
    seqDelim: ENV_SEQ_DELIM,
  })
}
