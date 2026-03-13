/**
 * Config Schema Unit Tests
 *
 * Tests for the Effect Config schema module ensuring all config
 * definitions work correctly with ConfigProvider.
 */

import { ConfigProvider, Effect, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  defaultConfig,
  EmbeddingsConfig,
  IndexConfig,
  MdContextConfig,
  OutputConfig,
  PathsConfig,
  SearchConfig,
} from './schema.js'

describe('Config Schema', () => {
  describe('IndexConfig', () => {
    it('should use default values when no config provided', async () => {
      const program = Effect.gen(function* () {
        return yield* IndexConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, ConfigProvider.fromMap(new Map())),
      )

      expect(result.maxDepth).toBe(10)
      expect(result.excludePatterns).toEqual([
        'node_modules',
        '.git',
        'dist',
        'build',
      ])
      expect(result.fileExtensions).toEqual(['.md', '.mdx'])
      expect(result.followSymlinks).toBe(false)
      expect(result.indexDir).toBe('.mdm')
    })

    it('should read values from ConfigProvider', async () => {
      const program = Effect.gen(function* () {
        return yield* IndexConfig
      })

      const provider = ConfigProvider.fromMap(
        new Map([
          ['maxDepth', '5'],
          ['excludePatterns', 'vendor,tmp'],
          ['fileExtensions', '.md,.markdown'],
          ['followSymlinks', 'true'],
          ['indexDir', '.index'],
        ]),
      )

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.maxDepth).toBe(5)
      expect(result.excludePatterns).toEqual(['vendor', 'tmp'])
      expect(result.fileExtensions).toEqual(['.md', '.markdown'])
      expect(result.followSymlinks).toBe(true)
      expect(result.indexDir).toBe('.index')
    })
  })

  describe('SearchConfig', () => {
    it('should use default values when no config provided', async () => {
      const program = Effect.gen(function* () {
        return yield* SearchConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, ConfigProvider.fromMap(new Map())),
      )

      expect(result.defaultLimit).toBe(10)
      expect(result.maxLimit).toBe(100)
      expect(result.minSimilarity).toBe(0.35)
      expect(result.includeSnippets).toBe(true)
      expect(result.snippetLength).toBe(200)
    })

    it('should read values from ConfigProvider', async () => {
      const program = Effect.gen(function* () {
        return yield* SearchConfig
      })

      const provider = ConfigProvider.fromMap(
        new Map([
          ['defaultLimit', '20'],
          ['maxLimit', '50'],
          ['minSimilarity', '0.7'],
          ['includeSnippets', 'false'],
          ['snippetLength', '300'],
        ]),
      )

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.defaultLimit).toBe(20)
      expect(result.maxLimit).toBe(50)
      expect(result.minSimilarity).toBe(0.7)
      expect(result.includeSnippets).toBe(false)
      expect(result.snippetLength).toBe(300)
    })
  })

  describe('EmbeddingsConfig', () => {
    it('should use default values when no config provided', async () => {
      const program = Effect.gen(function* () {
        return yield* EmbeddingsConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, ConfigProvider.fromMap(new Map())),
      )

      expect(result.provider).toBe('openai')
      expect(result.model).toBe('text-embedding-3-small')
      expect(result.batchSize).toBe(100)
      expect(result.maxRetries).toBe(3)
      expect(result.retryDelayMs).toBe(1000)
      expect(result.timeoutMs).toBe(30000)
      expect(Option.isNone(result.apiKey)).toBe(true)
    })

    it('should read values from ConfigProvider', async () => {
      const program = Effect.gen(function* () {
        return yield* EmbeddingsConfig
      })

      const provider = ConfigProvider.fromMap(
        new Map([
          ['provider', 'openai'],
          ['model', 'text-embedding-3-large'],
          ['batchSize', '50'],
          ['maxRetries', '5'],
          ['retryDelayMs', '2000'],
          ['timeoutMs', '60000'],
          ['apiKey', 'sk-test-key'],
        ]),
      )

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.provider).toBe('openai')
      expect(result.model).toBe('text-embedding-3-large')
      expect(result.batchSize).toBe(50)
      expect(result.maxRetries).toBe(5)
      expect(result.retryDelayMs).toBe(2000)
      expect(result.timeoutMs).toBe(60000)
      expect(Option.isSome(result.apiKey)).toBe(true)
      expect(Option.getOrThrow(result.apiKey)).toBe('sk-test-key')
    })
  })

  describe('OutputConfig', () => {
    it('should use default values when no config provided', async () => {
      const program = Effect.gen(function* () {
        return yield* OutputConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, ConfigProvider.fromMap(new Map())),
      )

      expect(result.format).toBe('text')
      expect(result.color).toBe(true)
      expect(result.prettyJson).toBe(true)
      expect(result.verbose).toBe(false)
      expect(result.debug).toBe(false)
    })

    it('should read values from ConfigProvider', async () => {
      const program = Effect.gen(function* () {
        return yield* OutputConfig
      })

      const provider = ConfigProvider.fromMap(
        new Map([
          ['format', 'json'],
          ['color', 'false'],
          ['prettyJson', 'false'],
          ['verbose', 'true'],
          ['debug', 'true'],
        ]),
      )

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.format).toBe('json')
      expect(result.color).toBe(false)
      expect(result.prettyJson).toBe(false)
      expect(result.verbose).toBe(true)
      expect(result.debug).toBe(true)
    })
  })

  describe('PathsConfig', () => {
    it('should use default values when no config provided', async () => {
      const program = Effect.gen(function* () {
        return yield* PathsConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, ConfigProvider.fromMap(new Map())),
      )

      expect(Option.isNone(result.root)).toBe(true)
      expect(Option.isNone(result.configFile)).toBe(true)
      expect(result.cacheDir).toBe('.mdm/cache')
    })

    it('should read values from ConfigProvider', async () => {
      const program = Effect.gen(function* () {
        return yield* PathsConfig
      })

      const provider = ConfigProvider.fromMap(
        new Map([
          ['root', '/home/user/docs'],
          ['configFile', './custom.config.json'],
          ['cacheDir', '.cache/mdcontext'],
        ]),
      )

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(Option.isSome(result.root)).toBe(true)
      expect(Option.getOrThrow(result.root)).toBe('/home/user/docs')
      expect(Option.isSome(result.configFile)).toBe(true)
      expect(Option.getOrThrow(result.configFile)).toBe('./custom.config.json')
      expect(result.cacheDir).toBe('.cache/mdcontext')
    })
  })

  describe('MdContextConfig (nested)', () => {
    it('should use default values when no config provided', async () => {
      const program = Effect.gen(function* () {
        return yield* MdContextConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, ConfigProvider.fromMap(new Map())),
      )

      // Verify nested structure
      expect(result.index.maxDepth).toBe(10)
      expect(result.search.defaultLimit).toBe(10)
      expect(result.embeddings.provider).toBe('openai')
      expect(result.output.format).toBe('text')
      expect(result.paths.cacheDir).toBe('.mdm/cache')
    })

    it('should read nested values from ConfigProvider with dot notation', async () => {
      const program = Effect.gen(function* () {
        return yield* MdContextConfig
      })

      const provider = ConfigProvider.fromMap(
        new Map([
          ['index.maxDepth', '20'],
          ['search.defaultLimit', '25'],
          ['embeddings.model', 'text-embedding-ada-002'],
          ['output.format', 'json'],
          ['paths.cacheDir', '.custom-cache'],
        ]),
      )

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.index.maxDepth).toBe(20)
      expect(result.search.defaultLimit).toBe(25)
      expect(result.embeddings.model).toBe('text-embedding-ada-002')
      expect(result.output.format).toBe('json')
      expect(result.paths.cacheDir).toBe('.custom-cache')
    })

    it('should work with ConfigProvider.fromJson for file-like config', async () => {
      const program = Effect.gen(function* () {
        return yield* MdContextConfig
      })

      const jsonConfig = {
        index: {
          maxDepth: 15,
          excludePatterns: ['custom_exclude'],
        },
        search: {
          minSimilarity: 0.8,
        },
        embeddings: {
          model: 'text-embedding-3-large',
        },
        output: {
          verbose: true,
        },
        paths: {
          root: '/custom/path',
        },
      }

      const provider = ConfigProvider.fromJson(jsonConfig)

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.index.maxDepth).toBe(15)
      expect(result.index.excludePatterns).toEqual(['custom_exclude'])
      expect(result.search.minSimilarity).toBe(0.8)
      expect(result.embeddings.model).toBe('text-embedding-3-large')
      expect(result.output.verbose).toBe(true)
      expect(Option.getOrThrow(result.paths.root)).toBe('/custom/path')
    })
  })

  describe('defaultConfig', () => {
    it('should have all expected default values', () => {
      expect(defaultConfig.index.maxDepth).toBe(10)
      expect(defaultConfig.index.excludePatterns).toEqual([
        'node_modules',
        '.git',
        'dist',
        'build',
      ])
      expect(defaultConfig.index.fileExtensions).toEqual(['.md', '.mdx'])
      expect(defaultConfig.index.followSymlinks).toBe(false)
      expect(defaultConfig.index.indexDir).toBe('.mdm')

      expect(defaultConfig.search.defaultLimit).toBe(10)
      expect(defaultConfig.search.maxLimit).toBe(100)
      expect(defaultConfig.search.minSimilarity).toBe(0.35)
      expect(defaultConfig.search.includeSnippets).toBe(true)
      expect(defaultConfig.search.snippetLength).toBe(200)

      expect(defaultConfig.embeddings.provider).toBe('openai')
      expect(defaultConfig.embeddings.model).toBe('text-embedding-3-small')
      expect(defaultConfig.embeddings.batchSize).toBe(100)
      expect(defaultConfig.embeddings.maxRetries).toBe(3)
      expect(defaultConfig.embeddings.retryDelayMs).toBe(1000)
      expect(defaultConfig.embeddings.timeoutMs).toBe(30000)
      expect(Option.isNone(defaultConfig.embeddings.apiKey)).toBe(true)

      expect(defaultConfig.output.format).toBe('text')
      expect(defaultConfig.output.color).toBe(true)
      expect(defaultConfig.output.prettyJson).toBe(true)
      expect(defaultConfig.output.verbose).toBe(false)
      expect(defaultConfig.output.debug).toBe(false)

      expect(Option.isNone(defaultConfig.paths.root)).toBe(true)
      expect(Option.isNone(defaultConfig.paths.configFile)).toBe(true)
      expect(defaultConfig.paths.cacheDir).toBe('.mdm/cache')
    })
  })

  describe('Config validation', () => {
    it('should fail when invalid literal value provided', async () => {
      const program = Effect.gen(function* () {
        return yield* OutputConfig
      })

      const provider = ConfigProvider.fromMap(
        new Map([['format', 'invalid_format']]),
      )

      await expect(
        Effect.runPromise(Effect.withConfigProvider(program, provider)),
      ).rejects.toThrow()
    })

    it('should fail when invalid number provided', async () => {
      const program = Effect.gen(function* () {
        return yield* SearchConfig
      })

      const provider = ConfigProvider.fromMap(
        new Map([['defaultLimit', 'not_a_number']]),
      )

      await expect(
        Effect.runPromise(Effect.withConfigProvider(program, provider)),
      ).rejects.toThrow()
    })

    it('should fail when invalid boolean provided', async () => {
      const program = Effect.gen(function* () {
        return yield* IndexConfig
      })

      const provider = ConfigProvider.fromMap(
        new Map([['followSymlinks', 'not_a_boolean']]),
      )

      await expect(
        Effect.runPromise(Effect.withConfigProvider(program, provider)),
      ).rejects.toThrow()
    })
  })
})
