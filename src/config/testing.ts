/**
 * Configuration Testing Utilities
 *
 * Provides helpers for testing code that depends on ConfigService.
 * Use these utilities to create isolated test environments without
 * environment pollution.
 *
 * ## Usage
 *
 * ```typescript
 * import { TestConfigLayer, withTestConfig } from './config/testing.js'
 *
 * // Use default test config
 * const result = await Effect.runPromise(
 *   myProgram.pipe(Effect.provide(TestConfigLayer))
 * )
 *
 * // Override specific values
 * const result = await Effect.runPromise(
 *   myProgram.pipe(Effect.provide(withTestConfig({
 *     index: { maxDepth: 5 }
 *   })))
 * )
 * ```
 */

import { Effect, Layer } from 'effect'
import { defaultConfig } from './schema.js'
import {
  ConfigService,
  makeConfigLayerPartial,
  type PartialMdmConfig,
} from './service.js'

/**
 * Default test configuration layer.
 * Uses all default values - suitable for most tests.
 */
export const TestConfigLayer: Layer.Layer<ConfigService> = Layer.succeed(
  ConfigService,
  defaultConfig,
)

/**
 * Create a test config layer with specific overrides.
 *
 * @param overrides - Partial config to merge with defaults
 * @returns Layer providing ConfigService with merged config
 *
 * @example
 * const layer = withTestConfig({
 *   index: { maxDepth: 5 },
 *   output: { debug: true }
 * })
 */
export const withTestConfig = (
  overrides: PartialMdmConfig,
): Layer.Layer<ConfigService> => makeConfigLayerPartial(overrides)

/**
 * Run an Effect with a specific configuration.
 *
 * Convenience function that provides the config layer and runs the effect.
 *
 * @param effect - The Effect to run
 * @param config - Optional partial config overrides
 * @returns Promise with the effect result
 *
 * @example
 * const result = await runWithConfig(
 *   Effect.gen(function* () {
 *     const config = yield* ConfigService
 *     return config.index.maxDepth
 *   }),
 *   { index: { maxDepth: 5 } }
 * )
 * // result === 5
 */
export const runWithConfig = <A, E>(
  effect: Effect.Effect<A, E, ConfigService>,
  config?: PartialMdmConfig,
): Promise<A> => {
  const layer = config ? withTestConfig(config) : TestConfigLayer
  return Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

/**
 * Run an Effect with a specific configuration synchronously.
 *
 * @param effect - The Effect to run
 * @param config - Optional partial config overrides
 * @returns The effect result
 *
 * @example
 * const result = runWithConfigSync(
 *   Effect.gen(function* () {
 *     const config = yield* ConfigService
 *     return config.index.maxDepth
 *   }),
 *   { index: { maxDepth: 5 } }
 * )
 * // result === 5
 */
export const runWithConfigSync = <A, E>(
  effect: Effect.Effect<A, E, ConfigService>,
  config?: PartialMdmConfig,
): A => {
  const layer = config ? withTestConfig(config) : TestConfigLayer
  return Effect.runSync(effect.pipe(Effect.provide(layer)))
}
