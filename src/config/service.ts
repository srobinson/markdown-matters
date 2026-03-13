/**
 * ConfigService Layer
 *
 * Wraps configuration in an Effect Context.Tag and Layer, enabling
 * dependency injection throughout the application. Services access
 * config via `yield* ConfigService` rather than direct function parameters.
 *
 * ## Benefits
 *
 * - Test isolation without mocking (just provide different Layer)
 * - Consistent config access across all commands and services
 * - Effect best practices for dependency management
 * - Type-safe configuration access
 *
 * ## Usage
 *
 * ```typescript
 * import { ConfigService, ConfigServiceLive } from './config/service.js'
 * import { Effect, Layer } from 'effect'
 *
 * const program = Effect.gen(function* () {
 *   const config = yield* ConfigService
 *   console.log(`Max depth: ${config.index.maxDepth}`)
 * })
 *
 * // Run with live config
 * Effect.runPromise(program.pipe(Effect.provide(ConfigServiceLive)))
 * ```
 */

import { type ConfigError, Context, Effect, Layer } from 'effect'
import type { MdmConfig } from './schema.js'
import { defaultConfig, MdmConfig as MdmConfigSchema } from './schema.js'

// ============================================================================
// Service Definition
// ============================================================================

/**
 * ConfigService provides access to the application configuration.
 *
 * Use this service to access configuration values throughout the application.
 * The service is provided via a Layer, enabling different configurations
 * for production, testing, and development environments.
 */
export class ConfigService extends Context.Tag('ConfigService')<
  ConfigService,
  MdmConfig
>() {}

// ============================================================================
// Layer Implementations
// ============================================================================

/**
 * Live ConfigService layer that loads configuration from the Effect
 * ConfigProvider (environment variables, config files, etc.)
 *
 * This layer reads from the current ConfigProvider in the Effect context.
 * By default, this is the environment, but it can be customized using
 * Effect.withConfigProvider.
 *
 * Note: This layer may fail with ConfigError if required configuration
 * is missing or invalid. Use ConfigServiceDefault for a guaranteed-success layer.
 */
export const ConfigServiceLive: Layer.Layer<
  ConfigService,
  ConfigError.ConfigError
> = Layer.effect(ConfigService, MdmConfigSchema)

/**
 * Create a ConfigService layer with a custom configuration object.
 *
 * Useful for:
 * - Testing with specific config values
 * - CLI flag overrides
 * - Programmatic configuration
 *
 * @param config - The configuration object to use
 * @returns A Layer that provides the ConfigService with the given config
 *
 * @example
 * ```typescript
 * const testConfig = {
 *   ...defaultConfig,
 *   index: { ...defaultConfig.index, maxDepth: 5 }
 * }
 * const TestConfigLayer = makeConfigLayer(testConfig)
 *
 * const program = Effect.gen(function* () {
 *   const config = yield* ConfigService
 *   console.log(config.index.maxDepth) // 5
 * })
 *
 * Effect.runPromise(program.pipe(Effect.provide(TestConfigLayer)))
 * ```
 */
export const makeConfigLayer = (
  config: MdmConfig,
): Layer.Layer<ConfigService> => Layer.succeed(ConfigService, config)

/**
 * Default ConfigService layer with all default values.
 *
 * Useful for:
 * - Quick testing without external dependencies
 * - Fallback when no config file or environment is available
 */
export const ConfigServiceDefault: Layer.Layer<ConfigService> =
  makeConfigLayer(defaultConfig)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Access the full configuration object.
 *
 * @returns An Effect that yields the full MdmConfig
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const config = yield* getConfig
 *   console.log(config.index.maxDepth)
 * })
 * ```
 */
export const getConfig: Effect.Effect<MdmConfig, never, ConfigService> =
  ConfigService

/**
 * Access a specific section of the configuration.
 *
 * @param section - The section key to access
 * @returns An Effect that yields the specified config section
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const indexConfig = yield* getConfigSection('index')
 *   console.log(indexConfig.maxDepth)
 * })
 * ```
 */
export const getConfigSection = <K extends keyof MdmConfig>(
  section: K,
): Effect.Effect<MdmConfig[K], never, ConfigService> =>
  Effect.map(ConfigService, (config) => config[section])

/**
 * Access a specific value from the configuration.
 *
 * @param section - The section key
 * @param key - The key within the section
 * @returns An Effect that yields the specified config value
 *
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const maxDepth = yield* getConfigValue('index', 'maxDepth')
 *   console.log(maxDepth)
 * })
 * ```
 */
export const getConfigValue = <
  K extends keyof MdmConfig,
  V extends keyof MdmConfig[K],
>(
  section: K,
  key: V,
): Effect.Effect<MdmConfig[K][V], never, ConfigService> =>
  Effect.map(ConfigService, (config) => config[section][key])

// ============================================================================
// Partial Config Utilities
// ============================================================================

/**
 * Deeply partial type for MdmConfig
 */
export type PartialMdmConfig = {
  [K in keyof MdmConfig]?: Partial<MdmConfig[K]>
}

/**
 * Merge partial configuration with defaults.
 *
 * Creates a complete MdmConfig by merging user-provided values
 * with the default configuration. Useful for applying config file values
 * or CLI overrides.
 *
 * @param partial - Partial configuration to merge
 * @returns Complete MdmConfig with defaults filled in
 *
 * @example
 * ```typescript
 * const userConfig = {
 *   index: { maxDepth: 5 },
 *   output: { verbose: true }
 * }
 * const fullConfig = mergeWithDefaults(userConfig)
 * // fullConfig.index.maxDepth === 5
 * // fullConfig.index.excludePatterns === defaultConfig.index.excludePatterns
 * ```
 */
export const mergeWithDefaults = (partial: PartialMdmConfig): MdmConfig => ({
  index: { ...defaultConfig.index, ...partial.index },
  search: { ...defaultConfig.search, ...partial.search },
  embeddings: { ...defaultConfig.embeddings, ...partial.embeddings },
  summarization: { ...defaultConfig.summarization, ...partial.summarization },
  aiSummarization: {
    ...defaultConfig.aiSummarization,
    ...partial.aiSummarization,
  },
  output: { ...defaultConfig.output, ...partial.output },
  paths: { ...defaultConfig.paths, ...partial.paths },
})

/**
 * Create a ConfigService layer from partial configuration.
 *
 * Combines makeConfigLayer with mergeWithDefaults for convenience.
 *
 * @param partial - Partial configuration to use
 * @returns A Layer that provides ConfigService with merged config
 *
 * @example
 * ```typescript
 * const TestLayer = makeConfigLayerPartial({
 *   index: { maxDepth: 5 },
 *   output: { debug: true }
 * })
 * ```
 */
export const makeConfigLayerPartial = (
  partial: PartialMdmConfig,
): Layer.Layer<ConfigService> => makeConfigLayer(mergeWithDefaults(partial))
