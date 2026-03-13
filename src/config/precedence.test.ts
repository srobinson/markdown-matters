/**
 * Config Precedence Chain Unit Tests
 *
 * Tests for the config provider precedence chain.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ConfigProvider, Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createCliConfigProvider,
  createConfigProviderSync,
  createEnvConfigProvider,
  createTestConfigProvider,
  flattenConfig,
  readEnvConfig,
} from './precedence.js'
import { MdmConfig } from './schema.js'

describe('Config Precedence Chain', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdcontext-precedence-'))
    // Clear any MDM env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MDM_') || key.startsWith('CUSTOM_')) {
        delete process.env[key]
      }
    }
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MDM_') || key.startsWith('CUSTOM_')) {
        delete process.env[key]
      }
    }
  })

  describe('ConfigProvider.fromMap basics', () => {
    it('should read values from a simple map', async () => {
      const provider = ConfigProvider.fromMap(
        new Map([['index.maxDepth', '25']]),
        { pathDelim: '.' },
      )

      const program = Effect.gen(function* () {
        return yield* MdmConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.index.maxDepth).toBe(25)
    })
  })

  describe('createConfigProviderSync', () => {
    it('should apply CLI overrides with highest priority', async () => {
      const provider = createConfigProviderSync({
        cliOverrides: { index: { maxDepth: 5 } },
        fileConfig: { index: { maxDepth: 15 } },
        skipEnv: true,
      })

      const program = Effect.gen(function* () {
        return yield* MdmConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.index.maxDepth).toBe(5) // CLI wins
    })

    it('should fall back to file config when CLI not specified', async () => {
      const provider = createConfigProviderSync({
        cliOverrides: { output: { verbose: true } },
        fileConfig: { index: { maxDepth: 15 } },
        skipEnv: true,
      })

      const program = Effect.gen(function* () {
        return yield* MdmConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.index.maxDepth).toBe(15) // File value used
      expect(result.output.verbose).toBe(true) // CLI value used
    })
  })

  describe('flattenConfig', () => {
    it('should flatten simple nested objects', () => {
      const result = flattenConfig({ index: { maxDepth: 5 } })
      expect(result.get('index.maxDepth')).toBe('5')
    })

    it('should flatten deeply nested objects', () => {
      const result = flattenConfig({
        index: { maxDepth: 5, followSymlinks: true },
        search: { defaultLimit: 100 },
      })
      expect(result.get('index.maxDepth')).toBe('5')
      expect(result.get('index.followSymlinks')).toBe('true')
      expect(result.get('search.defaultLimit')).toBe('100')
    })

    it('should handle arrays as comma-separated values', () => {
      const result = flattenConfig({
        index: { excludePatterns: ['node_modules', 'dist', '.git'] },
      })
      expect(result.get('index.excludePatterns')).toBe('node_modules,dist,.git')
    })

    it('should handle null and undefined values', () => {
      const result = flattenConfig({
        index: { maxDepth: null as unknown as number },
        search: { defaultLimit: undefined as unknown as number },
      })
      expect(result.has('index.maxDepth')).toBe(false)
      expect(result.has('search.defaultLimit')).toBe(false)
    })

    it('should handle string values', () => {
      const result = flattenConfig({
        embeddings: { model: 'text-embedding-3-small' },
      })
      expect(result.get('embeddings.model')).toBe('text-embedding-3-small')
    })
  })

  describe('readEnvConfig', () => {
    it('should read MDM_ prefixed env vars', () => {
      process.env.MDM_INDEX_MAXDEPTH = '25'
      const result = readEnvConfig()
      expect(result.get('index.maxDepth')).toBe('25')
    })

    it('should map env vars to correct config keys', () => {
      process.env.MDM_SEARCH_DEFAULTLIMIT = '50'
      process.env.MDM_OUTPUT_VERBOSE = 'true'
      const result = readEnvConfig()
      expect(result.get('search.defaultLimit')).toBe('50')
      expect(result.get('output.verbose')).toBe('true')
    })

    it('should support custom prefix', () => {
      process.env.CUSTOM_INDEX_MAXDEPTH = '30'
      const result = readEnvConfig('CUSTOM')
      expect(result.get('index.maxDepth')).toBe('30')
    })

    it('should ignore unknown env vars', () => {
      process.env.MDM_UNKNOWN_SETTING = 'value'
      const result = readEnvConfig()
      expect(result.has('unknown.setting')).toBe(false)
    })
  })

  describe('createEnvConfigProvider', () => {
    it('should create provider from env vars', async () => {
      process.env.MDM_INDEX_MAXDEPTH = '42'
      const provider = createEnvConfigProvider()

      const program = Effect.gen(function* () {
        return yield* MdmConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.index.maxDepth).toBe(42)
    })
  })

  describe('createCliConfigProvider', () => {
    it('should create provider from CLI overrides', async () => {
      const provider = createCliConfigProvider({
        index: { maxDepth: 7 },
        output: { verbose: true },
      })

      const program = Effect.gen(function* () {
        return yield* MdmConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.index.maxDepth).toBe(7)
      expect(result.output.verbose).toBe(true)
    })
  })

  describe('CONFIG_SCHEMA_KEYS mapping completeness', () => {
    it('should have all schema keys mapped correctly to defaultConfig', async () => {
      const { CONFIG_SCHEMA_KEYS } = await import('./precedence.js')
      const { defaultConfig } = await import('./schema.js')

      // Verify CONFIG_SCHEMA_KEYS matches defaultConfig structure
      for (const [section, keys] of Object.entries(CONFIG_SCHEMA_KEYS)) {
        const sectionConfig =
          defaultConfig[section as keyof typeof defaultConfig]
        expect(sectionConfig).toBeDefined()
        for (const key of keys as readonly string[]) {
          expect(sectionConfig).toHaveProperty(key)
        }
      }
    })

    it('should generate correct env key format', () => {
      process.env.MDM_INDEX_MAXDEPTH = '42'
      const result = readEnvConfig()
      expect(result.get('index.maxDepth')).toBe('42')
    })
  })

  describe('createTestConfigProvider', () => {
    it('should create provider with CLI overrides', async () => {
      const provider = createTestConfigProvider({ index: { maxDepth: 5 } })

      const program = Effect.gen(function* () {
        return yield* MdmConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.index.maxDepth).toBe(5)
    })

    it('should work with only file config', async () => {
      const provider = createTestConfigProvider(undefined, {
        search: { defaultLimit: 100 },
      })

      const program = Effect.gen(function* () {
        return yield* MdmConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.search.defaultLimit).toBe(100)
    })

    it('should work with empty options', async () => {
      const provider = createTestConfigProvider()

      const program = Effect.gen(function* () {
        return yield* MdmConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      // All defaults
      expect(result.index.maxDepth).toBe(10)
      expect(result.search.defaultLimit).toBe(10)
    })
  })
})
