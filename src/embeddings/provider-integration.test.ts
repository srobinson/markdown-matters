/**
 * Provider Switching Integration Tests
 *
 * Tests for provider switching, configuration precedence, and cross-provider
 * compatibility. These tests verify the full integration of embedding providers
 * with the configuration system.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect, Option } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { load, mergeWithDefaults } from '../config/index.js'
import {
  createEmbeddingProviderDirect,
  getProviderBaseURL,
  PROVIDER_BASE_URLS,
} from './provider-factory.js'
import type { VectorIndex } from './types.js'

// ============================================================================
// Test Setup
// ============================================================================

/**
 * Write a nested config object as TOML to .mdm.toml in the given directory.
 */
const writeTomlConfig = (
  dir: string,
  config: Record<string, Record<string, unknown>>,
) => {
  const lines: string[] = []
  for (const [section, values] of Object.entries(config)) {
    lines.push(`[${section}]`)
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'string') {
        lines.push(`${key} = "${value}"`)
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        lines.push(`${key} = ${value}`)
      }
    }
    lines.push('')
  }
  fs.writeFileSync(path.join(dir, '.mdm.toml'), lines.join('\n'))
}

describe('Provider Integration Tests', () => {
  let tempDir: string
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-provider-int-'))

    // Save and clear relevant env vars
    const envKeys = [
      'MDM_EMBEDDINGS_PROVIDER',
      'MDM_EMBEDDINGS_BASEURL',
      'MDM_EMBEDDINGS_MODEL',
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
    ]
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })

    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // Configuration Precedence Tests
  // ==========================================================================

  describe('Configuration Precedence (CLI > Env > File > Defaults)', () => {
    it('uses default provider (openai) when nothing specified', () => {
      const result = mergeWithDefaults({})

      expect(result.embeddings.provider).toBe('openai')
      expect(result.embeddings.model).toBe('text-embedding-3-small')
    })

    it('config file overrides defaults', () => {
      const fileConfig = {
        embeddings: { provider: 'ollama', model: 'nomic-embed-text' },
      }
      writeTomlConfig(
        tempDir,
        fileConfig as Record<string, Record<string, unknown>>,
      )

      const result = load({
        workingDir: tempDir,
        skipEnv: true,
      })

      expect(result.embeddings.provider).toBe('ollama')
      expect(result.embeddings.model).toBe('nomic-embed-text')
    })

    it('environment variable overrides config file', () => {
      // Config file says openai
      const fileConfig = {
        embeddings: { provider: 'openai', model: 'text-embedding-3-small' },
      }
      writeTomlConfig(
        tempDir,
        fileConfig as Record<string, Record<string, unknown>>,
      )

      // Env says ollama
      process.env.MDM_EMBEDDINGS_PROVIDER = 'ollama'

      const result = load({
        workingDir: tempDir,
        skipEnv: false,
      })

      expect(result.embeddings.provider).toBe('ollama')
    })

    it('CLI flag overrides environment variable', () => {
      // Env says openai
      process.env.MDM_EMBEDDINGS_PROVIDER = 'openai'

      // CLI says ollama
      const result = load({
        skipConfigFile: true,
        skipEnv: false,
        cliOverrides: { embeddings: { provider: 'ollama' } },
      })

      // CLI wins
      expect(result.embeddings.provider).toBe('ollama')
    })

    it('CLI baseURL overrides provider default', () => {
      const customURL = 'http://custom:9999/v1'

      const result = load({
        skipConfigFile: true,
        skipEnv: true,
        cliOverrides: {
          embeddings: {
            provider: 'ollama',
            baseURL: customURL,
          },
        },
      })

      expect(result.embeddings.provider).toBe('ollama')
      expect(Option.getOrNull(result.embeddings.baseURL)).toBe(customURL)
    })

    it('complete precedence chain works correctly', () => {
      // Config file: provider=openai, model=text-embedding-3-large
      const fileConfig = {
        embeddings: {
          provider: 'openai',
          model: 'text-embedding-3-large',
          batchSize: 50,
        },
      }
      writeTomlConfig(
        tempDir,
        fileConfig as Record<string, Record<string, unknown>>,
      )

      // Env: provider=ollama
      process.env.MDM_EMBEDDINGS_PROVIDER = 'ollama'

      // CLI: provider=openrouter
      const result = load({
        workingDir: tempDir,
        skipEnv: false,
        cliOverrides: { embeddings: { provider: 'openrouter' } },
      })

      // CLI wins for provider
      expect(result.embeddings.provider).toBe('openrouter')
      // File config used for unoverridden values
      expect(result.embeddings.model).toBe('text-embedding-3-large')
      expect(result.embeddings.batchSize).toBe(50)
    })
  })

  // ==========================================================================
  // Provider BaseURL Resolution Tests
  // ==========================================================================

  describe('Provider BaseURL Resolution', () => {
    it('returns undefined for openai (uses SDK default)', () => {
      const result = getProviderBaseURL('openai', Option.none())
      expect(result).toBeUndefined()
    })

    it('returns correct default for ollama', () => {
      const result = getProviderBaseURL('ollama', Option.none())
      expect(result).toBe('http://localhost:11434/v1')
    })

    it('returns correct default for lm-studio', () => {
      const result = getProviderBaseURL('lm-studio', Option.none())
      expect(result).toBe('http://localhost:1234/v1')
    })

    it('returns correct default for openrouter', () => {
      const result = getProviderBaseURL('openrouter', Option.none())
      expect(result).toBe('https://openrouter.ai/api/v1')
    })

    it('config baseURL overrides provider default', () => {
      const customURL = 'http://custom-ollama:11434/v1'
      const result = getProviderBaseURL('ollama', Option.some(customURL))
      expect(result).toBe(customURL)
    })

    it('config baseURL works for openai (custom proxy)', () => {
      const proxyURL = 'https://openai-proxy.example.com/v1'
      const result = getProviderBaseURL('openai', Option.some(proxyURL))
      expect(result).toBe(proxyURL)
    })
  })

  // ==========================================================================
  // Provider Factory Tests
  // ==========================================================================

  describe('Provider Factory', () => {
    it('creates provider with ollama configuration', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'ollama',
        model: 'nomic-embed-text',
        apiKey: 'dummy-key', // Ollama doesn't require API key but we pass one for testing
      })

      const provider = await Effect.runPromise(program)

      expect(provider.name).toContain('ollama')
      expect(provider.name).toContain('nomic-embed-text')
    })

    it('creates provider with lm-studio configuration', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'lm-studio',
        apiKey: 'dummy-key',
      })

      const provider = await Effect.runPromise(program)

      expect(provider.name).toContain('lm-studio')
    })

    it('creates provider with openrouter configuration', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'openrouter',
        model: 'text-embedding-3-small',
        apiKey: 'sk-or-test-key',
      })

      const provider = await Effect.runPromise(program)

      expect(provider.name).toContain('openrouter')
    })

    it('creates provider with custom baseURL', async () => {
      const customURL = 'https://custom-api.example.com/v1'

      const program = createEmbeddingProviderDirect({
        provider: 'openai',
        baseURL: customURL,
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)

      expect(provider).toBeDefined()
      expect(provider.name).toContain('openai')
    })

    it('accepts baseURL as Option.some', async () => {
      const customURL = 'https://custom-api.example.com/v1'

      const program = createEmbeddingProviderDirect({
        provider: 'openai',
        baseURL: Option.some(customURL),
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)
      expect(provider).toBeDefined()
    })

    it('uses provider default when baseURL is Option.none', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'ollama',
        baseURL: Option.none(),
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)
      expect(provider.name).toContain('ollama')
    })
  })

  // ==========================================================================
  // Provider Metadata Tests
  // ==========================================================================

  describe('Provider Metadata in Index', () => {
    it('VectorIndex type includes provider fields', () => {
      const index: VectorIndex = {
        version: 1,
        provider: 'ollama',
        providerModel: 'nomic-embed-text',
        providerBaseURL: 'http://localhost:11434/v1',
        dimensions: 768,
        entries: {},
        totalCost: 0,
        totalTokens: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      expect(index.provider).toBe('ollama')
      expect(index.providerModel).toBe('nomic-embed-text')
      expect(index.providerBaseURL).toBe('http://localhost:11434/v1')
    })

    it('VectorIndex supports optional provider fields', () => {
      const index: VectorIndex = {
        version: 1,
        provider: 'openai',
        dimensions: 512,
        entries: {},
        totalCost: 0.005,
        totalTokens: 10000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      expect(index.provider).toBe('openai')
      expect(index.providerModel).toBeUndefined()
      expect(index.providerBaseURL).toBeUndefined()
    })

    it('simulates reading index metadata for provider mismatch detection', () => {
      // Simulate index created with Ollama
      const indexMeta: VectorIndex = {
        version: 1,
        provider: 'ollama',
        providerModel: 'nomic-embed-text',
        dimensions: 768,
        entries: {},
        totalCost: 0,
        totalTokens: 1000,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      // Function to check provider mismatch
      const checkProviderMismatch = (
        indexProvider: string,
        queryProvider: string,
      ): boolean => {
        return indexProvider !== queryProvider
      }

      // Querying with different provider should warn
      expect(checkProviderMismatch(indexMeta.provider, 'openai')).toBe(true)
      expect(checkProviderMismatch(indexMeta.provider, 'ollama')).toBe(false)
    })
  })

  // ==========================================================================
  // All Provider Types Test
  // ==========================================================================

  describe('All Provider Types', () => {
    const providers = [
      'openai',
      'ollama',
      'lm-studio',
      'openrouter',
      'voyage',
    ] as const

    for (const providerType of providers) {
      it(`${providerType} provider can be created with factory`, async () => {
        const program = createEmbeddingProviderDirect({
          provider: providerType,
          apiKey: 'test-key',
        })

        const provider = await Effect.runPromise(program)

        expect(provider).toBeDefined()
        expect(provider.name).toContain(providerType)
        expect(typeof provider.dimensions).toBe('number')
        expect(typeof provider.embed).toBe('function')
      })

      it(`${providerType} has correct default baseURL`, () => {
        const expectedURL = PROVIDER_BASE_URLS[providerType]
        const actualURL = getProviderBaseURL(providerType, Option.none())

        expect(actualURL).toBe(expectedURL)
      })
    }
  })

  // ==========================================================================
  // Config File Provider Selection Tests
  // ==========================================================================

  describe('Config File Provider Selection', () => {
    it('supports provider: "ollama" in config file', () => {
      const fileConfig = {
        embeddings: { provider: 'ollama' },
      }
      writeTomlConfig(
        tempDir,
        fileConfig as Record<string, Record<string, unknown>>,
      )

      const result = load({
        workingDir: tempDir,
        skipEnv: true,
      })

      expect(result.embeddings.provider).toBe('ollama')
    })

    it('supports provider: "lm-studio" in config file', () => {
      const fileConfig = {
        embeddings: { provider: 'lm-studio' },
      }
      writeTomlConfig(
        tempDir,
        fileConfig as Record<string, Record<string, unknown>>,
      )

      const result = load({
        workingDir: tempDir,
        skipEnv: true,
      })

      expect(result.embeddings.provider).toBe('lm-studio')
    })

    it('supports provider: "openrouter" in config file', () => {
      const fileConfig = {
        embeddings: { provider: 'openrouter' },
      }
      writeTomlConfig(
        tempDir,
        fileConfig as Record<string, Record<string, unknown>>,
      )

      const result = load({
        workingDir: tempDir,
        skipEnv: true,
      })

      expect(result.embeddings.provider).toBe('openrouter')
    })

    it('supports custom baseURL in config file', () => {
      const customURL = 'http://custom:8080/v1'
      const fileConfig = {
        embeddings: {
          provider: 'ollama',
          baseURL: customURL,
        },
      }
      writeTomlConfig(
        tempDir,
        fileConfig as Record<string, Record<string, unknown>>,
      )

      const result = load({
        workingDir: tempDir,
        skipEnv: true,
      })

      expect(result.embeddings.provider).toBe('ollama')
      expect(Option.getOrNull(result.embeddings.baseURL)).toBe(customURL)
    })
  })

  // ==========================================================================
  // Environment Variable Tests
  // ==========================================================================

  describe('Environment Variable Provider Selection', () => {
    it('MDM_EMBEDDINGS_PROVIDER=ollama works', () => {
      process.env.MDM_EMBEDDINGS_PROVIDER = 'ollama'

      const result = load({
        skipConfigFile: true,
        skipEnv: false,
      })

      expect(result.embeddings.provider).toBe('ollama')
    })

    it('MDM_EMBEDDINGS_PROVIDER=lm-studio works', () => {
      process.env.MDM_EMBEDDINGS_PROVIDER = 'lm-studio'

      const result = load({
        skipConfigFile: true,
        skipEnv: false,
      })

      expect(result.embeddings.provider).toBe('lm-studio')
    })

    it('MDM_EMBEDDINGS_PROVIDER=openrouter works', () => {
      process.env.MDM_EMBEDDINGS_PROVIDER = 'openrouter'

      const result = load({
        skipConfigFile: true,
        skipEnv: false,
      })

      expect(result.embeddings.provider).toBe('openrouter')
    })

    it('MDM_EMBEDDINGS_MODEL works', () => {
      process.env.MDM_EMBEDDINGS_PROVIDER = 'ollama'
      process.env.MDM_EMBEDDINGS_MODEL = 'mxbai-embed-large'

      const result = load({
        skipConfigFile: true,
        skipEnv: false,
      })

      expect(result.embeddings.provider).toBe('ollama')
      expect(result.embeddings.model).toBe('mxbai-embed-large')
    })
  })

  // ==========================================================================
  // Provider Switching Scenarios
  // ==========================================================================

  describe('Provider Switching Scenarios', () => {
    it('simulates switching from OpenAI to Ollama config', () => {
      // Start with OpenAI config
      const openaiConfig = {
        embeddings: {
          provider: 'openai',
          model: 'text-embedding-3-small',
        },
      }

      writeTomlConfig(
        tempDir,
        openaiConfig as Record<string, Record<string, unknown>>,
      )

      let result = load({ workingDir: tempDir, skipEnv: true })

      expect(result.embeddings.provider).toBe('openai')

      // Switch to Ollama config
      const ollamaConfig = {
        embeddings: {
          provider: 'ollama',
          model: 'nomic-embed-text',
        },
      }

      writeTomlConfig(
        tempDir,
        ollamaConfig as Record<string, Record<string, unknown>>,
      )

      result = load({ workingDir: tempDir, skipEnv: true })

      expect(result.embeddings.provider).toBe('ollama')
      expect(result.embeddings.model).toBe('nomic-embed-text')
    })

    it('simulates temporary CLI override without changing config', () => {
      // Persistent config uses OpenAI
      const fileConfig = {
        embeddings: {
          provider: 'openai',
          model: 'text-embedding-3-small',
        },
      }

      writeTomlConfig(
        tempDir,
        fileConfig as Record<string, Record<string, unknown>>,
      )

      // One-off CLI override to use Ollama
      const result = load({
        workingDir: tempDir,
        skipEnv: true,
        cliOverrides: {
          embeddings: {
            provider: 'ollama',
            model: 'nomic-embed-text',
          },
        },
      })

      // CLI override active
      expect(result.embeddings.provider).toBe('ollama')
      expect(result.embeddings.model).toBe('nomic-embed-text')

      // Verify config file unchanged
      const fileContent = fs.readFileSync(
        path.join(tempDir, '.mdm.toml'),
        'utf-8',
      )
      expect(fileContent).toContain('provider = "openai"')
    })
  })

  // ==========================================================================
  // Cross-Provider Compatibility Tests
  // ==========================================================================

  describe('Cross-Provider Compatibility', () => {
    it('detects provider mismatch between index and query config', () => {
      // Simulate checking index metadata against query config
      const indexMetadata: Pick<
        VectorIndex,
        'provider' | 'providerModel' | 'dimensions'
      > = {
        provider: 'ollama',
        providerModel: 'nomic-embed-text',
        dimensions: 768,
      }

      const queryConfig = {
        provider: 'openai' as const,
        model: 'text-embedding-3-small',
      }

      // Check for mismatch
      const isMismatch = indexMetadata.provider !== queryConfig.provider

      expect(isMismatch).toBe(true)

      // Generate warning message
      const warningMessage = `Index was created with ${indexMetadata.provider} (${indexMetadata.providerModel}), but querying with ${queryConfig.provider} (${queryConfig.model}). Results may be inconsistent. Consider re-indexing.`

      expect(warningMessage).toContain('Index was created with ollama')
      expect(warningMessage).toContain('querying with openai')
      expect(warningMessage).toContain('re-indexing')
    })

    it('no warning when provider matches', () => {
      const indexMetadata = {
        provider: 'openai',
        providerModel: 'text-embedding-3-small',
        dimensions: 512,
      }

      const queryConfig = {
        provider: 'openai' as const,
        model: 'text-embedding-3-small',
      }

      const isMismatch = indexMetadata.provider !== queryConfig.provider

      expect(isMismatch).toBe(false)
    })

    it('different models on same provider should still warn', () => {
      const indexMetadata = {
        provider: 'openai',
        providerModel: 'text-embedding-3-small',
        dimensions: 512,
      }

      const queryConfig = {
        provider: 'openai' as const,
        model: 'text-embedding-3-large', // Different model
      }

      // Provider matches but model differs
      const providerMatch = indexMetadata.provider === queryConfig.provider
      const modelMatch = indexMetadata.providerModel === queryConfig.model

      expect(providerMatch).toBe(true)
      expect(modelMatch).toBe(false)

      // Should still warn about model mismatch
      const shouldWarn = !modelMatch
      expect(shouldWarn).toBe(true)
    })
  })
})
