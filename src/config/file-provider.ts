/**
 * File-based ConfigProvider
 *
 * Creates a custom ConfigProvider that reads from config files:
 * - mdm.config.ts (TypeScript - dynamic import)
 * - mdm.config.js (JavaScript - dynamic import)
 * - mdm.config.json (JSON - file read)
 * - .mdmrc (JSON - file read)
 * - .mdmrc.json (JSON - file read)
 *
 * ## Usage
 *
 * ```typescript
 * import { loadConfigFile, createFileConfigProvider } from './config/file-provider.js'
 * import { Effect, ConfigProvider } from 'effect'
 *
 * // Load config and create provider
 * const result = await loadConfigFile('/path/to/project')
 * if (result.found) {
 *   const provider = createFileConfigProvider(result.config)
 *   // Use with Effect.withConfigProvider
 * }
 * ```
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { ConfigProvider, Effect } from 'effect'
import { ConfigError } from '../errors/index.js'
import type { PartialMdmConfig } from './service.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Supported config file names in order of precedence
 */
export const CONFIG_FILE_NAMES = [
  'mdm.config.ts',
  'mdm.config.js',
  'mdm.config.mjs',
  'mdm.config.json',
  '.mdmrc',
  '.mdmrc.json',
] as const

export type ConfigFileName = (typeof CONFIG_FILE_NAMES)[number]

/**
 * Result of loading a config file
 */
export type LoadConfigResult =
  | { found: true; path: string; config: PartialMdmConfig }
  | { found: false; searched: string[] }

/**
 * Config file format
 */
export type ConfigFileFormat = 'ts' | 'js' | 'json'

// ============================================================================
// File Detection
// ============================================================================

/**
 * Find the git repository root by walking up from startDir looking for a .git
 * directory. Returns null if no git root is found.
 */
const findGitRoot = (startDir: string): string | null => {
  let dir = path.resolve(startDir)
  const root = path.parse(dir).root

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return null
}

/**
 * Find a config file starting from the given directory.
 *
 * When inside a git repository, searches up from startDir to the repository
 * root. When outside a git repository, searches only the startDir itself.
 * This prevents a malicious config file in an ancestor directory from being
 * executed via dynamic import when there is no repository boundary to
 * constrain the walk.
 *
 * @param startDir - Directory to start searching from
 * @returns The path to the config file if found, or null
 */
export const findConfigFile = (
  startDir: string,
): { path: string; format: ConfigFileFormat } | null => {
  let currentDir = path.resolve(startDir)
  const gitRoot = findGitRoot(currentDir)

  // Without a git boundary, only check the starting directory.
  // Traversing to filesystem root would allow arbitrary ancestor
  // directories to inject executable config files.
  if (!gitRoot) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const configPath = path.join(currentDir, fileName)
      if (fs.existsSync(configPath)) {
        return { path: configPath, format: getConfigFormat(fileName) }
      }
    }
    return null
  }

  // Walk up from startDir to git root (inclusive)
  while (true) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const configPath = path.join(currentDir, fileName)
      if (fs.existsSync(configPath)) {
        return { path: configPath, format: getConfigFormat(fileName) }
      }
    }

    if (currentDir === gitRoot) break

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return null
}

/**
 * Get the format of a config file based on its name
 */
const getConfigFormat = (fileName: string): ConfigFileFormat => {
  if (fileName.endsWith('.ts')) return 'ts'
  if (fileName.endsWith('.js') || fileName.endsWith('.mjs')) return 'js'
  return 'json'
}

// ============================================================================
// File Loading
// ============================================================================

/**
 * Load configuration from a JSON file
 */
const loadJsonConfig = (
  filePath: string,
): Effect.Effect<PartialMdmConfig, ConfigError> =>
  Effect.try({
    try: () => {
      const content = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(content) as PartialMdmConfig
    },
    catch: (error) =>
      new ConfigError({
        field: 'configFile',
        message: `Failed to load config from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      }),
  })

/**
 * Load configuration from a JavaScript/TypeScript file using dynamic import
 */
const loadJsConfig = (
  filePath: string,
): Effect.Effect<PartialMdmConfig, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      // Convert to file URL for dynamic import
      const fileUrl = `file://${filePath}`
      const module = await import(fileUrl)
      // Support both default export and named 'config' export
      const config = module.default ?? module.config
      if (!config || typeof config !== 'object') {
        throw new Error(
          'Config file must export a default object or named "config" export',
        )
      }
      return config as PartialMdmConfig
    },
    catch: (error) =>
      new ConfigError({
        field: 'configFile',
        message: `Failed to load config from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      }),
  })

/**
 * Load configuration from a file based on its format
 */
export const loadConfigFromFile = (
  filePath: string,
  format: ConfigFileFormat,
): Effect.Effect<PartialMdmConfig, ConfigError> => {
  switch (format) {
    case 'json':
      return loadJsonConfig(filePath)
    case 'ts':
    case 'js':
      return loadJsConfig(filePath)
  }
}

/**
 * Search for and load a config file starting from the given directory.
 *
 * @param startDir - Directory to start searching from
 * @returns LoadConfigResult indicating whether a config was found
 */
export const loadConfigFile = (
  startDir: string,
): Effect.Effect<LoadConfigResult, ConfigError> =>
  Effect.gen(function* () {
    const found = findConfigFile(startDir)

    if (!found) {
      return {
        found: false,
        searched: CONFIG_FILE_NAMES.map((name) => path.join(startDir, name)),
      } as LoadConfigResult
    }

    yield* Effect.logInfo(`Loading config from ${found.path}`)

    const config = yield* loadConfigFromFile(found.path, found.format)

    return {
      found: true,
      path: found.path,
      config,
    } as LoadConfigResult
  })

/**
 * Load a config file from a specific path (not searching up directories)
 *
 * @param configPath - Explicit path to the config file
 * @returns The loaded configuration
 */
export const loadConfigFromPath = (
  configPath: string,
): Effect.Effect<PartialMdmConfig, ConfigError> =>
  Effect.gen(function* () {
    const resolvedPath = path.resolve(configPath)

    if (!fs.existsSync(resolvedPath)) {
      return yield* Effect.fail(
        new ConfigError({
          field: 'configFile',
          message: `Config file not found: ${resolvedPath}`,
        }),
      )
    }

    const format = getConfigFormat(path.basename(configPath))
    return yield* loadConfigFromFile(resolvedPath, format)
  })

// ============================================================================
// ConfigProvider Creation
// ============================================================================

/**
 * Create a ConfigProvider from a partial configuration object.
 *
 * The provider uses ConfigProvider.fromJson to map the nested config
 * structure to Effect's config namespace.
 *
 * @param config - Partial configuration object
 * @returns A ConfigProvider that provides the config values
 */
export const createFileConfigProvider = (
  config: PartialMdmConfig,
): ConfigProvider.ConfigProvider => ConfigProvider.fromJson(config)

/**
 * Load config file and create a ConfigProvider in one step.
 *
 * If no config file is found, returns a ConfigProvider that provides no values
 * (Effect will use defaults from the Config schema).
 *
 * @param startDir - Directory to start searching for config files
 * @returns Effect yielding a ConfigProvider
 */
export const loadFileConfigProvider = (
  startDir: string,
): Effect.Effect<ConfigProvider.ConfigProvider, ConfigError> =>
  Effect.gen(function* () {
    const result = yield* loadConfigFile(startDir)

    if (!result.found) {
      // Return empty provider - defaults will be used
      return ConfigProvider.fromMap(new Map())
    }

    return createFileConfigProvider(result.config)
  })

/**
 * Load config from a specific file and create a ConfigProvider.
 *
 * @param configPath - Path to the config file
 * @returns Effect yielding a ConfigProvider
 */
export const loadFileConfigProviderFromPath = (
  configPath: string,
): Effect.Effect<ConfigProvider.ConfigProvider, ConfigError> =>
  Effect.map(loadConfigFromPath(configPath), createFileConfigProvider)
