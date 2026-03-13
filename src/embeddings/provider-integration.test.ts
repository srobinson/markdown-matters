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
import {
  createConfigProvider,
  createConfigProviderSync,
} from '../config/index.js'
import { MdContextConfig } from '../config/schema.js'
import {
  createEmbeddingProviderDirect,
  getProviderBaseURL,
  PROVIDER_BASE_URLS,
} from './provider-factory.js'
import type { VectorIndex } from './types.js'

// ============================================================================
// Test Setup
// ============================================================================

describe('Provider Integration Tests', () => {
  let tempDir: string
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdcontext-provider-int-'))

    // Save and clear relevant env vars
    const envKeys = [
      'MDCONTEXT_EMBEDDINGS_PROVIDER',
      'MDCONTEXT_EMBEDDINGS_BASEURL',
      'MDCONTEXT_EMBEDDINGS_MODEL',
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
    it('uses default provider (openai) when nothing specified', async () => {
      const provider = createConfigProviderSync({
        skipConfigFile: true,
        skipEnv: true,
      })

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.embeddings.provider).toBe('openai')
      expect(result.embeddings.model).toBe('text-embedding-3-small')
    })

    it('config file overrides defaults', async () => {
      const fileConfig = {
        embeddings: { provider: 'ollama', model: 'nomic-embed-text' },
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

      expect(result.embeddings.provider).toBe('ollama')
      expect(result.embeddings.model).toBe('nomic-embed-text')
    })

    it('environment variable overrides config file', async () => {
      // Config file says openai
      const fileConfig = {
        embeddings: { provider: 'openai', model: 'text-embedding-3-small' },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(fileConfig),
      )

      // Env says ollama
      process.env.MDCONTEXT_EMBEDDINGS_PROVIDER = 'ollama'

      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: false,
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.embeddings.provider).toBe('ollama')
    })

    it('CLI flag overrides environment variable', async () => {
      // Env says openai
      process.env.MDCONTEXT_EMBEDDINGS_PROVIDER = 'openai'

      // CLI says ollama
      const provider = createConfigProviderSync({
        skipConfigFile: true,
        skipEnv: false,
        cliOverrides: { embeddings: { provider: 'ollama' } },
      })

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      // CLI wins
      expect(result.embeddings.provider).toBe('ollama')
    })

    it('CLI baseURL overrides provider default', async () => {
      const customURL = 'http://custom:9999/v1'

      // Note: CLI overrides use plain strings, which get flattened to config keys.
      // The flattenConfig function converts any value to a string, so this works at runtime
      // even though the type expects Option<string>. Using 'as never' for test simplicity.
      const provider = createConfigProviderSync({
        skipConfigFile: true,
        skipEnv: true,
        cliOverrides: {
          embeddings: {
            provider: 'ollama',
            baseURL: customURL as never, // Type workaround for flattened config
          },
        },
      })

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.embeddings.provider).toBe('ollama')
      expect(Option.getOrNull(result.embeddings.baseURL)).toBe(customURL)
    })

    it('complete precedence chain works correctly', async () => {
      // Config file: provider=openai, model=text-embedding-3-large
      const fileConfig = {
        embeddings: {
          provider: 'openai',
          model: 'text-embedding-3-large',
          batchSize: 50,
        },
      }
      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(fileConfig),
      )

      // Env: provider=ollama
      process.env.MDCONTEXT_EMBEDDINGS_PROVIDER = 'ollama'

      // CLI: provider=openrouter
      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: false,
          cliOverrides: { embeddings: { provider: 'openrouter' } },
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

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
    it('supports provider: "ollama" in config file', async () => {
      const fileConfig = {
        embeddings: { provider: 'ollama' },
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

      expect(result.embeddings.provider).toBe('ollama')
    })

    it('supports provider: "lm-studio" in config file', async () => {
      const fileConfig = {
        embeddings: { provider: 'lm-studio' },
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

      expect(result.embeddings.provider).toBe('lm-studio')
    })

    it('supports provider: "openrouter" in config file', async () => {
      const fileConfig = {
        embeddings: { provider: 'openrouter' },
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

      expect(result.embeddings.provider).toBe('openrouter')
    })

    it('supports custom baseURL in config file', async () => {
      const customURL = 'http://custom:8080/v1'
      const fileConfig = {
        embeddings: {
          provider: 'ollama',
          baseURL: customURL,
        },
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

      expect(result.embeddings.provider).toBe('ollama')
      expect(Option.getOrNull(result.embeddings.baseURL)).toBe(customURL)
    })
  })

  // ==========================================================================
  // Environment Variable Tests
  // ==========================================================================

  describe('Environment Variable Provider Selection', () => {
    it('MDCONTEXT_EMBEDDINGS_PROVIDER=ollama works', async () => {
      process.env.MDCONTEXT_EMBEDDINGS_PROVIDER = 'ollama'

      const provider = createConfigProviderSync({
        skipConfigFile: true,
        skipEnv: false,
      })

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.embeddings.provider).toBe('ollama')
    })

    it('MDCONTEXT_EMBEDDINGS_PROVIDER=lm-studio works', async () => {
      process.env.MDCONTEXT_EMBEDDINGS_PROVIDER = 'lm-studio'

      const provider = createConfigProviderSync({
        skipConfigFile: true,
        skipEnv: false,
      })

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.embeddings.provider).toBe('lm-studio')
    })

    it('MDCONTEXT_EMBEDDINGS_PROVIDER=openrouter works', async () => {
      process.env.MDCONTEXT_EMBEDDINGS_PROVIDER = 'openrouter'

      const provider = createConfigProviderSync({
        skipConfigFile: true,
        skipEnv: false,
      })

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.embeddings.provider).toBe('openrouter')
    })

    it('MDCONTEXT_EMBEDDINGS_MODEL works', async () => {
      process.env.MDCONTEXT_EMBEDDINGS_PROVIDER = 'ollama'
      process.env.MDCONTEXT_EMBEDDINGS_MODEL = 'mxbai-embed-large'

      const provider = createConfigProviderSync({
        skipConfigFile: true,
        skipEnv: false,
      })

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.embeddings.provider).toBe('ollama')
      expect(result.embeddings.model).toBe('mxbai-embed-large')
    })
  })

  // ==========================================================================
  // Provider Switching Scenarios
  // ==========================================================================

  describe('Provider Switching Scenarios', () => {
    it('simulates switching from OpenAI to Ollama config', async () => {
      // Start with OpenAI config
      const openaiConfig = {
        embeddings: {
          provider: 'openai',
          model: 'text-embedding-3-small',
        },
      }

      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(openaiConfig),
      )

      let provider = await Effect.runPromise(
        createConfigProvider({ workingDir: tempDir, skipEnv: true }),
      )

      let result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.embeddings.provider).toBe('openai')

      // Switch to Ollama config
      const ollamaConfig = {
        embeddings: {
          provider: 'ollama',
          model: 'nomic-embed-text',
        },
      }

      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(ollamaConfig),
      )

      provider = await Effect.runPromise(
        createConfigProvider({ workingDir: tempDir, skipEnv: true }),
      )

      result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      expect(result.embeddings.provider).toBe('ollama')
      expect(result.embeddings.model).toBe('nomic-embed-text')
    })

    it('simulates temporary CLI override without changing config', async () => {
      // Persistent config uses OpenAI
      const fileConfig = {
        embeddings: {
          provider: 'openai',
          model: 'text-embedding-3-small',
        },
      }

      fs.writeFileSync(
        path.join(tempDir, 'mdm.config.json'),
        JSON.stringify(fileConfig),
      )

      // One-off CLI override to use Ollama
      const provider = await Effect.runPromise(
        createConfigProvider({
          workingDir: tempDir,
          skipEnv: true,
          cliOverrides: {
            embeddings: {
              provider: 'ollama',
              model: 'nomic-embed-text',
            },
          },
        }),
      )

      const result = await Effect.runPromise(
        MdContextConfig.pipe(Effect.withConfigProvider(provider)),
      )

      // CLI override active
      expect(result.embeddings.provider).toBe('ollama')
      expect(result.embeddings.model).toBe('nomic-embed-text')

      // Verify config file unchanged
      const fileContent = fs.readFileSync(
        path.join(tempDir, 'mdm.config.json'),
        'utf-8',
      )
      const savedConfig = JSON.parse(fileContent)
      expect(savedConfig.embeddings.provider).toBe('openai')
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
