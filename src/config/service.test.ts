/**
 * ConfigService Unit Tests
 *
 * Comprehensive tests for the Effect-based ConfigService layer and related
 * utilities. This suite verifies how configuration is loaded, merged, and
 * accessed across different Effect layers.
 *
 * Patterns under test:
 * - Default configuration via `ConfigServiceDefault`
 * - Live configuration via `ConfigServiceLive` combined with `ConfigProvider`
 * - Creating ad-hoc layers with `makeConfigLayer` and `makeConfigLayerPartial`
 * - Merging user-provided values with `defaultConfig` using `mergeWithDefaults`
 * - Reading configuration through the `ConfigService` tag and helpers
 *   (`getConfig`, `getConfigSection`, `getConfigValue`)
 *
 * Key scenarios:
 * - Ensuring all top-level sections (index, search, embeddings, output, paths)
 *   receive correct default values when no overrides are provided
 * - Overriding selected values via `ConfigProvider.fromMap` while preserving
 *   defaults for unspecified keys
 * - Providing fully-specified configs and partially-specified configs and
 *   verifying correct fallback/merge behavior
 * - Validating lookup helpers return the expected values and handle missing
 *   keys using Effect/Option semantics
 *
 * Test organization and setup:
 * - Uses Vitest (`describe`/`it`) with Effect programs composed via
 *   `Effect.gen` and executed through `Effect.runPromise`
 * - Layers and config providers are attached on a per-test basis using
 *   `Effect.provide` and `Effect.withConfigProvider`, so tests are isolated
 *   and do not share state between runs
 */

import { ConfigProvider, Effect, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from './schema.js'
import {
  ConfigService,
  ConfigServiceDefault,
  ConfigServiceLive,
  getConfig,
  getConfigSection,
  getConfigValue,
  makeConfigLayer,
  makeConfigLayerPartial,
  mergeWithDefaults,
} from './service.js'

describe('ConfigService', () => {
  describe('ConfigServiceDefault', () => {
    it('should provide default configuration values', async () => {
      const program = Effect.gen(function* () {
        return yield* ConfigService
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(ConfigServiceDefault)),
      )

      expect(result.index.maxDepth).toBe(10)
      expect(result.search.defaultLimit).toBe(10)
      expect(result.embeddings.provider).toBe('openai')
      expect(result.output.format).toBe('text')
      expect(result.paths.cacheDir).toBe('.mdm/cache')
    })
  })

  describe('ConfigServiceLive', () => {
    it('should load configuration from ConfigProvider', async () => {
      const program = Effect.gen(function* () {
        return yield* ConfigService
      })

      const provider = ConfigProvider.fromMap(
        new Map([
          ['index.maxDepth', '20'],
          ['search.defaultLimit', '25'],
        ]),
      )

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(ConfigServiceLive),
          Effect.withConfigProvider(provider),
        ),
      )

      expect(result.index.maxDepth).toBe(20)
      expect(result.search.defaultLimit).toBe(25)
      // Other values should use defaults
      expect(result.embeddings.provider).toBe('openai')
    })
  })

  describe('makeConfigLayer', () => {
    it('should create a layer with the provided config', async () => {
      const customConfig = {
        ...defaultConfig,
        index: { ...defaultConfig.index, maxDepth: 5 },
      }

      const program = Effect.gen(function* () {
        return yield* ConfigService
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(makeConfigLayer(customConfig))),
      )

      expect(result.index.maxDepth).toBe(5)
      expect(result.search.defaultLimit).toBe(10) // unchanged
    })
  })

  describe('makeConfigLayerPartial', () => {
    it('should merge partial config with defaults', async () => {
      const program = Effect.gen(function* () {
        return yield* ConfigService
      })

      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(
            makeConfigLayerPartial({
              index: { maxDepth: 3 },
              output: { verbose: true },
            }),
          ),
        ),
      )

      expect(result.index.maxDepth).toBe(3)
      expect(result.index.excludePatterns).toEqual([
        'node_modules',
        '.git',
        'dist',
        'build',
      ])
      expect(result.output.verbose).toBe(true)
      expect(result.output.format).toBe('text')
    })
  })

  describe('getConfig', () => {
    it('should return the full configuration', async () => {
      const program = Effect.gen(function* () {
        return yield* getConfig
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(ConfigServiceDefault)),
      )

      expect(result).toEqual(defaultConfig)
    })
  })

  describe('getConfigSection', () => {
    it('should return a specific config section', async () => {
      const program = Effect.gen(function* () {
        return yield* getConfigSection('index')
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(ConfigServiceDefault)),
      )

      expect(result.maxDepth).toBe(10)
      expect(result.excludePatterns).toEqual([
        'node_modules',
        '.git',
        'dist',
        'build',
      ])
    })

    it('should work for all sections', async () => {
      const getAll = Effect.gen(function* () {
        const index = yield* getConfigSection('index')
        const search = yield* getConfigSection('search')
        const embeddings = yield* getConfigSection('embeddings')
        const output = yield* getConfigSection('output')
        const paths = yield* getConfigSection('paths')
        return { index, search, embeddings, output, paths }
      })

      const result = await Effect.runPromise(
        getAll.pipe(Effect.provide(ConfigServiceDefault)),
      )

      expect(result.index.maxDepth).toBe(10)
      expect(result.search.defaultLimit).toBe(10)
      expect(result.embeddings.provider).toBe('openai')
      expect(result.output.format).toBe('text')
      expect(result.paths.cacheDir).toBe('.mdm/cache')
    })
  })

  describe('getConfigValue', () => {
    it('should return a specific config value', async () => {
      const program = Effect.gen(function* () {
        return yield* getConfigValue('index', 'maxDepth')
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(ConfigServiceDefault)),
      )

      expect(result).toBe(10)
    })

    it('should work with nested values', async () => {
      const program = Effect.gen(function* () {
        const maxDepth = yield* getConfigValue('index', 'maxDepth')
        const format = yield* getConfigValue('output', 'format')
        const provider = yield* getConfigValue('embeddings', 'provider')
        return { maxDepth, format, provider }
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(ConfigServiceDefault)),
      )

      expect(result.maxDepth).toBe(10)
      expect(result.format).toBe('text')
      expect(result.provider).toBe('openai')
    })
  })

  describe('mergeWithDefaults', () => {
    it('should merge empty partial with defaults', () => {
      const result = mergeWithDefaults({})
      expect(result).toEqual(defaultConfig)
    })

    it('should override specific values', () => {
      const result = mergeWithDefaults({
        index: { maxDepth: 5 },
      })

      expect(result.index.maxDepth).toBe(5)
      expect(result.index.excludePatterns).toEqual([
        'node_modules',
        '.git',
        'dist',
        'build',
      ])
    })

    it('should merge multiple sections', () => {
      const result = mergeWithDefaults({
        index: { maxDepth: 5, followSymlinks: true },
        search: { defaultLimit: 20 },
        output: { verbose: true, debug: true },
      })

      expect(result.index.maxDepth).toBe(5)
      expect(result.index.followSymlinks).toBe(true)
      expect(result.index.excludePatterns).toEqual([
        'node_modules',
        '.git',
        'dist',
        'build',
      ])
      expect(result.search.defaultLimit).toBe(20)
      expect(result.search.maxLimit).toBe(100)
      expect(result.output.verbose).toBe(true)
      expect(result.output.debug).toBe(true)
      expect(result.output.format).toBe('text')
    })

    it('should preserve Option values from defaults', () => {
      const result = mergeWithDefaults({
        paths: { cacheDir: '/custom/cache' },
      })

      // Verify the merge preserves defaults for unspecified values
      expect(Option.isNone(result.paths.root)).toBe(true)
      expect(Option.isNone(result.paths.configFile)).toBe(true)
      expect(result.paths.cacheDir).toBe('/custom/cache')
    })
  })

  describe('service composition', () => {
    it('should allow services to depend on ConfigService', async () => {
      // Example of a service that uses config
      const myService = Effect.gen(function* () {
        const config = yield* ConfigService
        return `Max depth is ${config.index.maxDepth}`
      })

      const result = await Effect.runPromise(
        myService.pipe(Effect.provide(ConfigServiceDefault)),
      )

      expect(result).toBe('Max depth is 10')
    })

    it('should allow testing with different configs', async () => {
      const myService = Effect.gen(function* () {
        const config = yield* ConfigService
        return config.index.maxDepth > 5 ? 'deep' : 'shallow'
      })

      // Test with default (maxDepth = 10)
      const defaultResult = await Effect.runPromise(
        myService.pipe(Effect.provide(ConfigServiceDefault)),
      )
      expect(defaultResult).toBe('deep')

      // Test with custom config (maxDepth = 3)
      const customResult = await Effect.runPromise(
        myService.pipe(
          Effect.provide(makeConfigLayerPartial({ index: { maxDepth: 3 } })),
        ),
      )
      expect(customResult).toBe('shallow')
    })
  })
})
