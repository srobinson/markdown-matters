/**
 * File-based ConfigProvider Unit Tests
 *
 * Tests for loading configuration from files and creating ConfigProviders.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONFIG_FILE_NAMES,
  createFileConfigProvider,
  findConfigFile,
  loadConfigFile,
  loadConfigFromPath,
  loadFileConfigProvider,
} from './file-provider.js'
import { MdContextConfig } from './schema.js'

describe('File-based ConfigProvider', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('CONFIG_FILE_NAMES', () => {
    it('should have the expected file names in order of precedence', () => {
      expect(CONFIG_FILE_NAMES).toEqual([
        'mdm.config.ts',
        'mdm.config.js',
        'mdm.config.mjs',
        'mdm.config.json',
        '.mdmrc',
        '.mdmrc.json',
      ])
    })
  })

  describe('findConfigFile', () => {
    it('should return null when no config file exists', () => {
      const result = findConfigFile(tempDir)
      expect(result).toBeNull()
    })

    it('should find mdm.config.json', () => {
      const configPath = path.join(tempDir, 'mdm.config.json')
      fs.writeFileSync(configPath, '{}')

      const result = findConfigFile(tempDir)
      expect(result).not.toBeNull()
      expect(result?.path).toBe(configPath)
      expect(result?.format).toBe('json')
    })

    it('should find .mdmrc', () => {
      const configPath = path.join(tempDir, '.mdmrc')
      fs.writeFileSync(configPath, '{}')

      const result = findConfigFile(tempDir)
      expect(result).not.toBeNull()
      expect(result?.path).toBe(configPath)
      expect(result?.format).toBe('json')
    })

    it('should find config in parent directory within a git repo', () => {
      // Create a git root marker so upward traversal is allowed
      fs.mkdirSync(path.join(tempDir, '.git'))
      const subDir = path.join(tempDir, 'subdir')
      fs.mkdirSync(subDir)
      const configPath = path.join(tempDir, 'mdm.config.json')
      fs.writeFileSync(configPath, '{}')

      const result = findConfigFile(subDir)
      expect(result).not.toBeNull()
      expect(result?.path).toBe(configPath)
    })

    it('should not traverse to parent directory outside a git repo', () => {
      // Without a .git marker, findConfigFile only checks startDir
      const subDir = path.join(tempDir, 'subdir')
      fs.mkdirSync(subDir)
      fs.writeFileSync(path.join(tempDir, 'mdm.config.json'), '{}')

      const result = findConfigFile(subDir)
      expect(result).toBeNull()
    })

    it('should prefer higher precedence files', () => {
      // Create both .ts and .json files
      fs.writeFileSync(path.join(tempDir, 'mdm.config.ts'), 'export default {}')
      fs.writeFileSync(path.join(tempDir, 'mdm.config.json'), '{}')

      const result = findConfigFile(tempDir)
      expect(result).not.toBeNull()
      expect(result?.path).toBe(path.join(tempDir, 'mdm.config.ts'))
      expect(result?.format).toBe('ts')
    })

    it('should identify .js format correctly', () => {
      const configPath = path.join(tempDir, 'mdm.config.js')
      fs.writeFileSync(configPath, 'module.exports = {}')

      const result = findConfigFile(tempDir)
      expect(result?.format).toBe('js')
    })

    it('should identify .mjs format correctly', () => {
      const configPath = path.join(tempDir, 'mdm.config.mjs')
      fs.writeFileSync(configPath, 'export default {}')

      const result = findConfigFile(tempDir)
      expect(result?.format).toBe('js')
    })
  })

  describe('loadConfigFile', () => {
    it('should return found: false when no config exists', async () => {
      const result = await Effect.runPromise(loadConfigFile(tempDir))
      expect(result.found).toBe(false)
      if (!result.found) {
        expect(result.searched.length).toBeGreaterThan(0)
      }
    })

    it('should load JSON config file', async () => {
      const config = {
        index: { maxDepth: 5 },
        output: { verbose: true },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(config),
      )

      const result = await Effect.runPromise(loadConfigFile(tempDir))
      expect(result.found).toBe(true)
      if (result.found) {
        expect(result.config).toEqual(config)
        expect(result.path).toContain('mdm.config.json')
      }
    })

    it('should load .mdmrc file', async () => {
      const config = { search: { defaultLimit: 20 } }
      fs.writeFileSync(path.join(tempDir, '.mdmrc'), JSON.stringify(config))

      const result = await Effect.runPromise(loadConfigFile(tempDir))
      expect(result.found).toBe(true)
      if (result.found) {
        expect(result.config).toEqual(config)
      }
    })

    it('should fail with ConfigError for invalid JSON', async () => {
      fs.writeFileSync(path.join(tempDir, 'mdm.config.json'), 'not valid json')

      const result = await Effect.runPromiseExit(loadConfigFile(tempDir))
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        const error = result.cause
        expect(String(error)).toContain('ConfigError')
      }
    })
  })

  describe('loadConfigFromPath', () => {
    it('should load config from explicit path', async () => {
      const configPath = path.join(tempDir, 'custom.json')
      const config = { index: { maxDepth: 15 } }
      fs.writeFileSync(configPath, JSON.stringify(config))

      const result = await Effect.runPromise(loadConfigFromPath(configPath))
      expect(result).toEqual(config)
    })

    it('should fail with ConfigError when file does not exist', async () => {
      const configPath = path.join(tempDir, 'nonexistent.json')

      const result = await Effect.runPromiseExit(loadConfigFromPath(configPath))
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        const error = String(result.cause)
        expect(error).toContain('ConfigError')
        expect(error).toContain('not found')
      }
    })

    it('should fail with ConfigError for invalid JSON', async () => {
      const configPath = path.join(tempDir, 'invalid.json')
      fs.writeFileSync(configPath, 'invalid json content')

      const result = await Effect.runPromiseExit(loadConfigFromPath(configPath))
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        expect(String(result.cause)).toContain('ConfigError')
      }
    })
  })

  describe('createFileConfigProvider', () => {
    it('should create a ConfigProvider from partial config', async () => {
      const config = {
        index: { maxDepth: 25 },
        search: { minSimilarity: 0.8 },
      }
      const provider = createFileConfigProvider(config)

      const program = Effect.gen(function* () {
        return yield* MdContextConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.index.maxDepth).toBe(25)
      expect(result.search.minSimilarity).toBe(0.8)
      // Defaults should be used for unspecified values
      expect(result.output.format).toBe('text')
    })

    it('should work with nested config structure', async () => {
      const config = {
        embeddings: {
          model: 'text-embedding-3-large',
          batchSize: 50,
        },
        paths: {
          cacheDir: '/custom/cache',
        },
      }
      const provider = createFileConfigProvider(config)

      const program = Effect.gen(function* () {
        return yield* MdContextConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.embeddings.model).toBe('text-embedding-3-large')
      expect(result.embeddings.batchSize).toBe(50)
      expect(result.paths.cacheDir).toBe('/custom/cache')
    })
  })

  describe('loadFileConfigProvider', () => {
    it('should return empty provider when no config file exists', async () => {
      const provider = await Effect.runPromise(loadFileConfigProvider(tempDir))

      // Provider should exist but provide no overrides
      const program = Effect.gen(function* () {
        return yield* MdContextConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      // All defaults should be used
      expect(result.index.maxDepth).toBe(10)
    })

    it('should load config and create provider in one step', async () => {
      const config = {
        index: { maxDepth: 30 },
        output: { debug: true },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(config),
      )

      const provider = await Effect.runPromise(loadFileConfigProvider(tempDir))

      const program = Effect.gen(function* () {
        return yield* MdContextConfig
      })

      const result = await Effect.runPromise(
        Effect.withConfigProvider(program, provider),
      )

      expect(result.index.maxDepth).toBe(30)
      expect(result.output.debug).toBe(true)
    })
  })

  describe('JavaScript/TypeScript config loading', () => {
    it('should load .mjs config with default export', async () => {
      const configPath = path.join(tempDir, 'mdm.config.mjs')
      fs.writeFileSync(configPath, `export default { index: { maxDepth: 42 } }`)

      const result = await Effect.runPromise(loadConfigFile(tempDir))
      expect(result.found).toBe(true)
      if (result.found) {
        expect(result.config.index?.maxDepth).toBe(42)
      }
    })

    it('should load .mjs config with named export', async () => {
      const configPath = path.join(tempDir, 'mdm.config.mjs')
      fs.writeFileSync(
        configPath,
        `export const config = { search: { defaultLimit: 50 } }`,
      )

      const result = await Effect.runPromise(loadConfigFile(tempDir))
      expect(result.found).toBe(true)
      if (result.found) {
        expect(result.config.search?.defaultLimit).toBe(50)
      }
    })
  })

  // Security: config traversal boundary (ALP-1237 / ALP-1198)
  describe('security: config search respects git root boundary', () => {
    it('stops searching at .git boundary and does not traverse above it', () => {
      // Create a nested directory structure with a .git marker
      const gitRoot = path.join(tempDir, 'project')
      const subDir = path.join(gitRoot, 'src', 'deep')
      const aboveGit = tempDir

      fs.mkdirSync(path.join(gitRoot, '.git'), { recursive: true })
      fs.mkdirSync(subDir, { recursive: true })

      // Place a config file ABOVE the git root (should not be found)
      fs.writeFileSync(
        path.join(aboveGit, 'mdm.config.json'),
        JSON.stringify({ search: { defaultLimit: 999 } }),
      )

      // Search starting from deep inside the project
      const result = findConfigFile(subDir)

      // Should NOT find the config above .git
      expect(result).toBeNull()
    })

    it('finds config at git root level', () => {
      const gitRoot = path.join(tempDir, 'project2')
      const subDir = path.join(gitRoot, 'src')

      fs.mkdirSync(path.join(gitRoot, '.git'), { recursive: true })
      fs.mkdirSync(subDir, { recursive: true })

      // Place config at the git root itself
      fs.writeFileSync(
        path.join(gitRoot, 'mdm.config.json'),
        JSON.stringify({ index: { maxDepth: 5 } }),
      )

      const result = findConfigFile(subDir)
      expect(result).not.toBeNull()
      expect(result!.path).toBe(path.join(gitRoot, 'mdm.config.json'))
    })
  })
})
