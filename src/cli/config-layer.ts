/**
 * CLI Configuration Layer
 *
 * Creates a configuration layer for use in CLI commands.
 * Loads config with precedence: CLI flags > Environment > Config file > Defaults
 */

import { Effect, Layer } from 'effect'
import {
  type ConfigProviderOptions,
  ConfigService,
  ConfigServiceDefault,
  createConfigProvider,
  type MdmConfig,
} from '../config/index.js'

/**
 * Create a ConfigService layer from options.
 *
 * This loads configuration with the standard precedence chain:
 * 1. CLI flags (highest priority)
 * 2. Environment variables (MDCONTEXT_*)
 * 3. Config file (if found)
 * 4. Defaults
 *
 * @param options - Configuration provider options
 * @returns A Layer that provides ConfigService
 */
export const makeCliConfigLayer = (
  options: ConfigProviderOptions = {},
): Effect.Effect<Layer.Layer<ConfigService, never, never>, never, never> =>
  Effect.gen(function* () {
    // Create the config provider with precedence chain
    const providerResult = yield* createConfigProvider(options).pipe(
      Effect.catchAll(() =>
        // If config loading fails, use empty provider (defaults will apply)
        Effect.succeed(null),
      ),
    )

    if (!providerResult) {
      // Fall back to default config if provider creation failed
      return ConfigServiceDefault
    }

    // Load the config using the provider
    const configResult = yield* Effect.gen(function* () {
      // Import the schema to load config
      const { MdmConfig: MdmConfigSchema } = yield* Effect.promise(
        async () => import('../config/schema.js'),
      )
      return yield* MdmConfigSchema
    }).pipe(
      Effect.withConfigProvider(providerResult),
      Effect.catchAll(() => Effect.succeed(null)),
    )

    if (!configResult) {
      // Fall back to default config if loading failed
      return ConfigServiceDefault
    }

    // Create a layer with the loaded config
    return Layer.succeed(ConfigService, configResult)
  })

/**
 * Create the default CLI configuration layer.
 *
 * This loads configuration from:
 * - Environment variables (MDCONTEXT_*)
 * - Config file (mdcontext.config.ts/json)
 * - Built-in defaults
 *
 * No CLI flags are applied at this level - commands handle their own flag overrides.
 */
export const defaultCliConfigLayer: Effect.Effect<
  Layer.Layer<ConfigService, never, never>,
  never,
  never
> = makeCliConfigLayer({
  workingDir: process.cwd(),
})

/**
 * Synchronously create a default config layer.
 *
 * For use in cases where async config loading isn't possible.
 * Uses only environment variables and defaults.
 */
export const defaultCliConfigLayerSync: Layer.Layer<
  ConfigService,
  never,
  never
> = ConfigServiceDefault

/**
 * Get config value with CLI flag override.
 *
 * Helper function for commands to get a config value, preferring
 * an explicit CLI flag value if provided.
 *
 * @param cliValue - Value from CLI flag (may be undefined)
 * @param configValue - Value from config
 * @returns The CLI value if provided, otherwise the config value
 */
export const withCliOverride = <T>(
  cliValue: T | undefined,
  configValue: T,
): T => {
  return cliValue !== undefined ? cliValue : configValue
}

/**
 * Extract relevant config sections for a command.
 */
export type SearchConfigValues = {
  defaultLimit: number
  maxLimit: number
  minSimilarity: number
  includeSnippets: boolean
  snippetLength: number
}

export type IndexConfigValues = {
  maxDepth: number
  excludePatterns: readonly string[]
  fileExtensions: readonly string[]
  followSymlinks: boolean
  indexDir: string
}

export type OutputConfigValues = {
  format: 'text' | 'json'
  color: boolean
  prettyJson: boolean
  verbose: boolean
  debug: boolean
}

/**
 * Extract search config from full config.
 */
export const getSearchConfig = (config: MdmConfig): SearchConfigValues => ({
  defaultLimit: config.search.defaultLimit,
  maxLimit: config.search.maxLimit,
  minSimilarity: config.search.minSimilarity,
  includeSnippets: config.search.includeSnippets,
  snippetLength: config.search.snippetLength,
})

/**
 * Extract index config from full config.
 */
export const getIndexConfig = (config: MdmConfig): IndexConfigValues => ({
  maxDepth: config.index.maxDepth,
  excludePatterns: config.index.excludePatterns,
  fileExtensions: config.index.fileExtensions,
  followSymlinks: config.index.followSymlinks,
  indexDir: config.index.indexDir,
})

/**
 * Extract output config from full config.
 */
export const getOutputConfig = (config: MdmConfig): OutputConfigValues => ({
  format: config.output.format,
  color: config.output.color,
  prettyJson: config.output.prettyJson,
  verbose: config.output.verbose,
  debug: config.output.debug,
})
