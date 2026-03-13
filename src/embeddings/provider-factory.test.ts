/**
 * Provider Factory Unit Tests
 *
 * Tests for the embedding provider factory module ensuring correct
 * provider creation with appropriate baseURL mapping.
 */

import { Effect, Option, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  createEmbeddingProviderDirect,
  getProviderBaseURL,
  PROVIDER_BASE_URLS,
} from './provider-factory.js'

describe('Provider Factory', () => {
  describe('PROVIDER_BASE_URLS constant', () => {
    it('should have undefined for openai (uses SDK default)', () => {
      expect(PROVIDER_BASE_URLS.openai).toBeUndefined()
    })

    it('should have correct URL for ollama', () => {
      expect(PROVIDER_BASE_URLS.ollama).toBe('http://localhost:11434/v1')
    })

    it('should have correct URL for lm-studio', () => {
      expect(PROVIDER_BASE_URLS['lm-studio']).toBe('http://localhost:1234/v1')
    })

    it('should have correct URL for openrouter', () => {
      expect(PROVIDER_BASE_URLS.openrouter).toBe('https://openrouter.ai/api/v1')
    })

    it('should have all five providers defined', () => {
      const providers = Object.keys(PROVIDER_BASE_URLS)
      expect(providers).toHaveLength(5)
      expect(providers).toContain('openai')
      expect(providers).toContain('ollama')
      expect(providers).toContain('lm-studio')
      expect(providers).toContain('openrouter')
      expect(providers).toContain('voyage')
    })
  })

  describe('getProviderBaseURL', () => {
    it('should return config baseURL when Option.some is provided', () => {
      const customURL = 'https://custom.api.com/v1'
      const result = getProviderBaseURL('openai', Option.some(customURL))
      expect(result).toBe(customURL)
    })

    it('should return config baseURL over provider default', () => {
      const customURL = 'https://custom-ollama.example.com/v1'
      const result = getProviderBaseURL('ollama', Option.some(customURL))
      expect(result).toBe(customURL)
    })

    it('should return provider default when Option.none for ollama', () => {
      const result = getProviderBaseURL('ollama', Option.none())
      expect(result).toBe('http://localhost:11434/v1')
    })

    it('should return provider default when Option.none for lm-studio', () => {
      const result = getProviderBaseURL('lm-studio', Option.none())
      expect(result).toBe('http://localhost:1234/v1')
    })

    it('should return provider default when Option.none for openrouter', () => {
      const result = getProviderBaseURL('openrouter', Option.none())
      expect(result).toBe('https://openrouter.ai/api/v1')
    })

    it('should return undefined for openai when Option.none', () => {
      const result = getProviderBaseURL('openai', Option.none())
      expect(result).toBeUndefined()
    })
  })

  describe('createEmbeddingProviderDirect', () => {
    it('should create provider with ollama default baseURL', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'ollama',
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)
      expect(provider.name).toContain('ollama')
    })

    it('should create provider with lm-studio default baseURL', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'lm-studio',
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)
      expect(provider.name).toContain('lm-studio')
    })

    it('should create provider with openrouter default baseURL', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'openrouter',
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)
      expect(provider.name).toContain('openrouter')
    })

    it('should create openai provider with SDK default (no baseURL)', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'openai',
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)
      expect(provider.name).toContain('openai')
    })

    it('should respect custom baseURL override for any provider', async () => {
      const customURL = 'https://my-proxy.example.com/v1'
      const program = createEmbeddingProviderDirect({
        provider: 'openai',
        baseURL: customURL,
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)
      expect(provider).toBeDefined()
    })

    it('should accept baseURL as Option.some', async () => {
      const customURL = 'https://custom.api.com/v1'
      const program = createEmbeddingProviderDirect({
        provider: 'openai',
        baseURL: Option.some(customURL),
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)
      expect(provider).toBeDefined()
    })

    it('should use provider default when baseURL is Option.none', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'ollama',
        baseURL: Option.none(),
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)
      expect(provider.name).toContain('ollama')
    })

    it('should pass custom model to provider', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'openai',
        model: 'text-embedding-3-large',
        apiKey: 'test-key',
      })

      const provider = await Effect.runPromise(program)
      expect(provider.name).toContain('text-embedding-3-large')
    })

    it('should accept apiKey as Option.some', async () => {
      const program = createEmbeddingProviderDirect({
        provider: 'openai',
        apiKey: Option.some('test-key'),
      })

      const provider = await Effect.runPromise(program)
      expect(provider).toBeDefined()
    })

    it('should fail when no API key provided', async () => {
      const originalEnv = process.env.OPENAI_API_KEY
      delete process.env.OPENAI_API_KEY

      try {
        const program = createEmbeddingProviderDirect({
          provider: 'openai',
        })

        await expect(Effect.runPromise(program)).rejects.toThrow()
      } finally {
        if (originalEnv) {
          process.env.OPENAI_API_KEY = originalEnv
        }
      }
    })

    it('should fail when apiKey is Option.none and no env var', async () => {
      const originalEnv = process.env.OPENAI_API_KEY
      delete process.env.OPENAI_API_KEY

      try {
        const program = createEmbeddingProviderDirect({
          provider: 'openai',
          apiKey: Option.none(),
        })

        await expect(Effect.runPromise(program)).rejects.toThrow()
      } finally {
        if (originalEnv) {
          process.env.OPENAI_API_KEY = originalEnv
        }
      }
    })

    it('should accept apiKey as Redacted<string>', async () => {
      const redactedKey = Redacted.make('test-redacted-key')
      const program = createEmbeddingProviderDirect({
        provider: 'openai',
        apiKey: redactedKey,
      })

      const provider = await Effect.runPromise(program)
      expect(provider).toBeDefined()
      expect(provider.name).toContain('openai')
    })

    it('should not expose Redacted API key when stringified', () => {
      const redactedKey = Redacted.make('sk-secret-key-12345')
      const stringified = String(redactedKey)

      // Redacted type shows <redacted> when stringified
      expect(stringified).not.toContain('sk-secret-key-12345')
      expect(stringified).toContain('<redacted>')
    })

    it('should preserve API key value in Redacted wrapper', () => {
      const secretKey = 'sk-secret-key-12345'
      const redactedKey = Redacted.make(secretKey)

      // Value can still be extracted when needed
      expect(Redacted.value(redactedKey)).toBe(secretKey)
    })

    it('should pass retry configuration to providers', async () => {
      const provider = await Effect.runPromise(
        createEmbeddingProviderDirect({
          provider: 'voyage',
          apiKey: 'test-key',
          maxRetries: 7,
          retryDelayMs: 250,
        }),
      )

      expect((provider as unknown as { maxRetries: number }).maxRetries).toBe(7)
      expect(
        (provider as unknown as { retryDelayMs: number }).retryDelayMs,
      ).toBe(250)
    })
  })
})
