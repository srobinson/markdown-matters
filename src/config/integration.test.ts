/**
 * Config Integration Tests
 *
 * Tests verifying the full config precedence chain works correctly:
 * 1. CLI flags override config file
 * 2. Environment variables override config file
 * 3. Config file overrides defaults
 * 4. Invalid config produces friendly errors
 *
 * These tests exercise the complete config loading stack, not just
 * individual providers in isolation.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createConfigProvider,
  createConfigProviderSync,
  loadConfigFile,
  loadConfigFromPath,
} from './index.js'
import { defaultConfig, MdContextConfig } from './schema.js'
import {
  ConfigService,
  makeConfigLayerPartial,
  mergeWithDefaults,
} from './service.js'

describe('Config Integration Tests', () => {
  let tempDir: string
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdcontext-integration-'))
    // Save and clear MDCONTEXT_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MDCONTEXT_')) {
        savedEnv[key] = process.env[key]
        delete process.env[key]
      }
    }
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    // Restore env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MDCONTEXT_')) {
        delete process.env[key]
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      }
    }
  })

  describe('Precedence: CLI > Env > File > Defaults', () => {
    it('should use defaults when no other source is provided', async () => {
      const provider = createConfigProviderSync({
        skipEnv: true,
        skipConfigFile: true,
      })

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      // All values should match defaults
      expect(result.index.maxDepth).toBe(defaultConfig.index.maxDepth)
      expect(result.index.excludePatterns).toEqual(
        defaultConfig.index.excludePatterns,
      )
      expect(result.search.defaultLimit).toBe(defaultConfig.search.defaultLimit)
      expect(result.output.format).toBe(defaultConfig.output.format)
    })

    it('should let config file override defaults', async () => {
      // Create config file with custom values
      const fileConfig = {
        index: { maxDepth: 20 },
        search: { defaultLimit: 50 },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(fileConfig),
      )

      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: true,
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      // File values should override defaults
      expect(result.index.maxDepth).toBe(20)
      expect(result.search.defaultLimit).toBe(50)
      // Non-specified values should use defaults
      expect(result.output.format).toBe(defaultConfig.output.format)
    })

    it('should let environment variables override config file', async () => {
      // Create config file
      const fileConfig = {
        index: { maxDepth: 20 },
        search: { defaultLimit: 50 },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(fileConfig),
      )

      // Set env vars (should override file)
      process.env.MDCONTEXT_INDEX_MAXDEPTH = '30'

      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: false,
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      // Env var should override file config
      expect(result.index.maxDepth).toBe(30)
      // Non-env values should still come from file
      expect(result.search.defaultLimit).toBe(50)
    })

    it('should let CLI flags override environment variables', async () => {
      // Create config file
      const fileConfig = {
        index: { maxDepth: 20 },
        search: { defaultLimit: 50 },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(fileConfig),
      )

      // Set env var
      process.env.MDCONTEXT_INDEX_MAXDEPTH = '30'

      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: false,
          cliOverrides: { index: { maxDepth: 5 } },
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      // CLI should override everything
      expect(result.index.maxDepth).toBe(5)
      // Non-CLI values should use env/file chain
      expect(result.search.defaultLimit).toBe(50)
    })

    it('should handle complete precedence chain (CLI > Env > File > Default)', async () => {
      // Create config file with all sections
      const fileConfig = {
        index: { maxDepth: 20, followSymlinks: true },
        search: { defaultLimit: 50, minSimilarity: 0.7 },
        output: { verbose: true },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(fileConfig),
      )

      // Set env vars (should override some file values)
      process.env.MDCONTEXT_INDEX_MAXDEPTH = '30'
      process.env.MDCONTEXT_SEARCH_DEFAULTLIMIT = '75'

      // CLI overrides (should override both env and file)
      const cliOverrides = {
        index: { maxDepth: 5 },
        output: { debug: true },
      }

      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: false,
          cliOverrides,
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      // CLI wins over all: index.maxDepth=5 (from CLI)
      expect(result.index.maxDepth).toBe(5)
      // output.debug=true (from CLI)
      expect(result.output.debug).toBe(true)
      // Env wins over file: search.defaultLimit=75 (from env)
      expect(result.search.defaultLimit).toBe(75)
      // File wins over defaults: index.followSymlinks=true, search.minSimilarity=0.7
      expect(result.index.followSymlinks).toBe(true)
      expect(result.search.minSimilarity).toBe(0.7)
      // output.verbose=true (from file)
      expect(result.output.verbose).toBe(true)
      // Default for unspecified: output.format='text'
      expect(result.output.format).toBe('text')
    })
  })

  describe('Array value handling', () => {
    it('should merge exclude patterns from config file', async () => {
      const fileConfig = {
        index: { excludePatterns: ['custom-ignore', '*.bak'] },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(fileConfig),
      )

      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: true,
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.index.excludePatterns).toEqual(['custom-ignore', '*.bak'])
    })

    it('should override arrays via environment variable', async () => {
      const fileConfig = {
        index: { excludePatterns: ['custom-ignore', '*.bak'] },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(fileConfig),
      )

      // Env vars use comma-separated format
      process.env.MDCONTEXT_INDEX_EXCLUDEPATTERNS = 'env-ignore,env-pattern'

      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: false,
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.index.excludePatterns).toEqual([
        'env-ignore',
        'env-pattern',
      ])
    })

    it('should override arrays via CLI', async () => {
      process.env.MDCONTEXT_INDEX_EXCLUDEPATTERNS = 'env-ignore'

      const provider = createConfigProviderSync({
        skipConfigFile: true,
        skipEnv: false,
        cliOverrides: {
          index: { excludePatterns: ['cli-ignore', 'cli-pattern'] },
        },
      })

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.index.excludePatterns).toEqual([
        'cli-ignore',
        'cli-pattern',
      ])
    })
  })

  describe('ConfigService integration', () => {
    it('should work with ConfigService layer and custom config', async () => {
      const program = Effect.gen(function* () {
        const config = yield* ConfigService
        return {
          maxDepth: config.index.maxDepth,
          defaultLimit: config.search.defaultLimit,
        }
      })

      const layer = makeConfigLayerPartial({
        index: { maxDepth: 42 },
        search: { defaultLimit: 99 },
      })

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(layer)),
      )

      expect(result.maxDepth).toBe(42)
      expect(result.defaultLimit).toBe(99)
    })

    it('should merge partial config with defaults correctly', () => {
      const partial = {
        index: { maxDepth: 25 },
        output: { debug: true },
      }

      const merged = mergeWithDefaults(partial)

      // Partial values override
      expect(merged.index.maxDepth).toBe(25)
      expect(merged.output.debug).toBe(true)
      // Other values from defaults
      expect(merged.index.excludePatterns).toEqual(
        defaultConfig.index.excludePatterns,
      )
      expect(merged.search.defaultLimit).toBe(defaultConfig.search.defaultLimit)
      expect(merged.output.format).toBe('text')
    })
  })

  describe('Invalid config error handling', () => {
    it('should produce ConfigError for invalid JSON in config file', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        'not valid json { broken',
      )

      const result = await Effect.runPromiseExit(loadConfigFile(tempDir))

      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        const errorStr = String(result.cause)
        expect(errorStr).toContain('ConfigError')
      }
    })

    it('should produce ConfigError when explicit config file is missing', async () => {
      const nonexistentPath = path.join(tempDir, 'nonexistent.json')

      const result = await Effect.runPromiseExit(
        loadConfigFromPath(nonexistentPath),
      )

      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        const errorStr = String(result.cause)
        expect(errorStr).toContain('ConfigError')
        expect(errorStr).toContain('not found')
      }
    })

    it('should produce ConfigError with helpful details for malformed config', async () => {
      // Write config with invalid type (maxDepth should be number)
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify({ index: { maxDepth: 'not-a-number' } }),
      )

      // When we try to load this into the full config schema, it should fail
      // because maxDepth needs to be parsed as a number
      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: true,
        }),
      )

      // This should fail because maxDepth is not a valid number
      const result = await Effect.runPromiseExit(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result._tag).toBe('Failure')
    })

    it('should include source file path in error for file-based errors', async () => {
      const configPath = path.join(tempDir, 'mdm.config.json')
      fs.writeFileSync(configPath, '{ invalid json }')

      const result = await Effect.runPromiseExit(loadConfigFromPath(configPath))

      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        const errorStr = String(result.cause)
        // Error should mention the file path
        expect(errorStr).toContain('mdm.config.json')
      }
    })
  })

  describe('Config file format support', () => {
    it('should load JSON config file', async () => {
      const config = { index: { maxDepth: 15 } }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(config),
      )

      const result = await Effect.runPromise(loadConfigFile(tempDir))
      expect(result.found).toBe(true)
      if (result.found) {
        expect(result.config.index?.maxDepth).toBe(15)
      }
    })

    it('should load .mdmrc file (JSON format)', async () => {
      const config = { search: { defaultLimit: 25 } }
      fs.writeFileSync(path.join(tempDir, '.mdmrc'), JSON.stringify(config))

      const result = await Effect.runPromise(loadConfigFile(tempDir))
      expect(result.found).toBe(true)
      if (result.found) {
        expect(result.config.search?.defaultLimit).toBe(25)
      }
    })

    it('should load .mjs config with default export', async () => {
      const configPath = path.join(tempDir, 'mdm.config.mjs')
      fs.writeFileSync(
        configPath,
        `export default { output: { verbose: true } }`,
      )

      const result = await Effect.runPromise(loadConfigFile(tempDir))
      expect(result.found).toBe(true)
      if (result.found) {
        expect(result.config.output?.verbose).toBe(true)
      }
    })

    it('should load .mjs config with named export', async () => {
      const configPath = path.join(tempDir, 'mdm.config.mjs')
      fs.writeFileSync(
        configPath,
        `export const config = { embeddings: { batchSize: 50 } }`,
      )

      const result = await Effect.runPromise(loadConfigFile(tempDir))
      expect(result.found).toBe(true)
      if (result.found) {
        expect(result.config.embeddings?.batchSize).toBe(50)
      }
    })
  })

  describe('Real-world usage scenarios', () => {
    it('should support project-specific config with team defaults', async () => {
      // Scenario: Team has default settings in config file,
      // but developer overrides verbosity via env var for debugging
      const teamConfig = {
        index: {
          maxDepth: 5,
          excludePatterns: ['node_modules', 'dist', '.git', 'vendor'],
        },
        search: { defaultLimit: 25 },
        output: { prettyJson: true },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(teamConfig),
      )

      // Developer enables debug mode
      process.env.MDCONTEXT_OUTPUT_DEBUG = 'true'
      process.env.MDCONTEXT_OUTPUT_VERBOSE = 'true'

      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: false,
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      // Team settings preserved
      expect(result.index.maxDepth).toBe(5)
      expect(result.index.excludePatterns).toEqual([
        'node_modules',
        'dist',
        '.git',
        'vendor',
      ])
      expect(result.search.defaultLimit).toBe(25)
      expect(result.output.prettyJson).toBe(true)
      // Developer overrides active
      expect(result.output.debug).toBe(true)
      expect(result.output.verbose).toBe(true)
    })

    it('should support CI environment with minimal config', async () => {
      // Scenario: CI uses env vars only, no config file
      process.env.MDCONTEXT_OUTPUT_FORMAT = 'json'
      process.env.MDCONTEXT_OUTPUT_COLOR = 'false'
      process.env.MDCONTEXT_INDEX_MAXDEPTH = '100'

      const provider = createConfigProviderSync({
        skipConfigFile: true,
        skipEnv: false,
      })

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.output.format).toBe('json')
      expect(result.output.color).toBe(false)
      expect(result.index.maxDepth).toBe(100)
      // Defaults for unset values
      expect(result.search.defaultLimit).toBe(defaultConfig.search.defaultLimit)
    })

    it('should support CLI one-off override without modifying config', async () => {
      // Scenario: User has config file but wants to run with different settings once
      const fileConfig = {
        index: { maxDepth: 10 },
        search: { defaultLimit: 20 },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(fileConfig),
      )

      // One-off CLI override
      const cliOverrides = {
        search: { defaultLimit: 100 },
        output: { format: 'json' as const },
      }

      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: true,
          cliOverrides,
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      // CLI override active
      expect(result.search.defaultLimit).toBe(100)
      // File config still applies where not overridden
      expect(result.index.maxDepth).toBe(10)
    })
  })

  describe('Custom config path', () => {
    it('should load config from explicit path', async () => {
      const customPath = path.join(tempDir, 'custom', 'my-config.json')
      fs.mkdirSync(path.dirname(customPath), { recursive: true })
      fs.writeFileSync(customPath, JSON.stringify({ index: { maxDepth: 99 } }))

      const result = await Effect.runPromise(loadConfigFromPath(customPath))
      expect(result.index?.maxDepth).toBe(99)
    })

    it('should use explicit config path over auto-detected config', async () => {
      // Create auto-detected config
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify({ index: { maxDepth: 10 } }),
      )

      // Create custom config
      const customPath = path.join(tempDir, 'custom.json')
      fs.writeFileSync(customPath, JSON.stringify({ index: { maxDepth: 99 } }))

      const provider = await Effect.runPromise(
        createConfigProvider({
          configPath: customPath,
          skipEnv: true,
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      // Custom path should be used
      expect(result.index.maxDepth).toBe(99)
    })

    it('should load TypeScript config from explicit path', async () => {
      // Note: We can't actually test .ts files without tsx runtime,
      // but we can test .mjs files which use the same dynamic import path
      const customPath = path.join(tempDir, 'custom.config.mjs')
      fs.writeFileSync(
        customPath,
        `export default { index: { maxDepth: 77 }, search: { defaultLimit: 33 } }`,
      )

      const result = await Effect.runPromise(loadConfigFromPath(customPath))
      expect(result.index?.maxDepth).toBe(77)
      expect(result.search?.defaultLimit).toBe(33)
    })

    it('should load JavaScript config from explicit path with named export', async () => {
      const customPath = path.join(tempDir, 'custom.config.mjs')
      fs.writeFileSync(
        customPath,
        `export const config = { output: { verbose: true, debug: true } }`,
      )

      const result = await Effect.runPromise(loadConfigFromPath(customPath))
      expect(result.output?.verbose).toBe(true)
      expect(result.output?.debug).toBe(true)
    })

    it('should work with createConfigProvider for TS/JS paths', async () => {
      const customPath = path.join(tempDir, 'custom.config.mjs')
      fs.writeFileSync(customPath, `export default { index: { maxDepth: 88 } }`)

      const provider = await Effect.runPromise(
        createConfigProvider({
          configPath: customPath,
          skipEnv: true,
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.index.maxDepth).toBe(88)
    })

    it('should provide helpful error for invalid TS/JS config', async () => {
      const customPath = path.join(tempDir, 'broken.config.mjs')
      fs.writeFileSync(customPath, `export default "not-an-object"`)

      const result = await Effect.runPromiseExit(loadConfigFromPath(customPath))
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        const errorStr = String(result.cause)
        expect(errorStr).toContain('ConfigError')
      }
    })
  })
})
