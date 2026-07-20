/**
 * Direct tests for `resolveClient` — the runtime-layer entry point
 * for capability client resolution.
 *
 * The file lives under `src/providers/` next to the code it tests.
 * That co-location lets the mock target the openai-compatible
 * transport directly (`./transports/openai-compatible.js`), which is
 * the exact path `resolve-client.ts` imports from. Mocking the
 * providers barrel would not intercept that import.
 *
 * Two code paths are exercised:
 *
 *  1. Fast path: no overrides, or overrides supplied for a provider
 *     outside the openai-compatible transport. `getProvider(id)` +
 *     `getCapability(runtime, capability)` returns a pre-registered
 *     client. Tests populate the registry with fake runtimes via
 *     `registerProvider` so the fast path returns a known client
 *     without calling the transport mock.
 *  2. Override path: overrides present AND provider is
 *     openai-compatible AND capability has a transport factory.
 *     The transport factory is invoked directly. Tests assert the
 *     mock received the caller-supplied overrides and that
 *     `MissingApiKey` from the transport is remapped to the CLI's
 *     `ApiKeyMissingError`.
 *
 * Covers both `embed` and `generateText` capabilities. `rerank` is
 * included for the fall-through-to-fast-path case — it has no
 * openai-compatible transport so overrides cannot take the override
 * path regardless of provider id.
 */

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiKeyMissingError } from '../errors/index.js'
import type { EmbeddingClient, EmbeddingResult } from './capabilities/embed.js'
import type {
  TextClient,
  TextGenerationResult,
} from './capabilities/generate-text.js'
import { MissingApiKey } from './errors.js'
import { clearRegistry, registerProvider } from './registry.js'
import { getResolvedBaseURL, resolveClient } from './resolve-client.js'
import type { OpenAICompatibleProviderId } from './transports/openai-compatible.js'

// ============================================================================
// Transport mock: stubs createEmbedClient and createGenerateTextClient
// ============================================================================
//
// `resolve-client.ts` imports both factories directly from this
// sibling module, so mocking it here intercepts the exact symbols the
// override path calls. `importActual` preserves the real
// `ClientOverrides` type, provider config, and every helper that the
// runtime-layer code relies on.

vi.mock('./transports/openai-compatible.js', async () => {
  const actual = await vi.importActual<
    typeof import('./transports/openai-compatible.js')
  >('./transports/openai-compatible.js')
  return {
    ...actual,
    createEmbedClient: vi.fn(),
    createGenerateTextClient: vi.fn(),
  }
})

const {
  createEmbedClient: mockCreateEmbedClient,
  createGenerateTextClient: mockCreateGenerateTextClient,
} = await import('./transports/openai-compatible.js')
const createEmbedClientMock = vi.mocked(mockCreateEmbedClient)
const createGenerateTextClientMock = vi.mocked(mockCreateGenerateTextClient)

interface ConstructionCall {
  readonly id: OpenAICompatibleProviderId
  readonly overrides:
    | Readonly<{
        baseURL?: string | undefined
        apiKey?: string | undefined
      }>
    | undefined
}

const embedConstructionCalls: ConstructionCall[] = []
const generateTextConstructionCalls: ConstructionCall[] = []

// ============================================================================
// Fakes: EmbeddingClient and TextClient used for both the mock returns
// and the registry fast path
// ============================================================================

const fakeEmbedClient: EmbeddingClient = {
  embed: (_texts, options) =>
    Effect.succeed({
      embeddings: [[0, 0, 0]],
      model: options?.model ?? 'mock-embed',
    } satisfies EmbeddingResult),
}

const fakeTextClient: TextClient = {
  generateText: (_prompt, options) =>
    Effect.succeed({
      text: 'mock text',
      model: options?.model ?? 'mock-gt',
    } satisfies TextGenerationResult),
}

const installFakeEmbedFactory = (): void => {
  createEmbedClientMock.mockImplementation((id, overrides) => {
    embedConstructionCalls.push({ id, overrides })
    return Effect.succeed(fakeEmbedClient)
  })
}

const installFakeGenerateTextFactory = (): void => {
  createGenerateTextClientMock.mockImplementation((id, overrides) => {
    generateTextConstructionCalls.push({ id, overrides })
    return Effect.succeed(fakeTextClient)
  })
}

const ALL_OPENAI_COMPATIBLE_IDS: readonly OpenAICompatibleProviderId[] = [
  'openai',
  'ollama',
  'lm-studio',
  'openrouter',
]

// Populate the registry via `registerProvider` (not
// `registerDefaultProviders`) so the mock factories are not invoked
// during setup — fast-path tests can assert `not.toHaveBeenCalled()`
// without a bootstrap noise to clear. Registry is wiped in
// `beforeEach` and `afterEach` to avoid state bleeding between test
// files that share the module-level registry Map.
const registerFakeRuntimes = (): void => {
  clearRegistry()
  for (const id of ALL_OPENAI_COMPATIBLE_IDS) {
    registerProvider({
      id,
      capabilities: {
        embed: fakeEmbedClient,
        generateText: fakeTextClient,
      },
    })
  }
  registerProvider({
    id: 'voyage',
    capabilities: { embed: fakeEmbedClient },
  })
}

// ============================================================================
// Test suite
// ============================================================================

beforeEach(() => {
  createEmbedClientMock.mockReset()
  createGenerateTextClientMock.mockReset()
  embedConstructionCalls.length = 0
  generateTextConstructionCalls.length = 0
  installFakeEmbedFactory()
  installFakeGenerateTextFactory()
  registerFakeRuntimes()
})

afterEach(() => {
  clearRegistry()
})

// ==========================================================================
// Override path: embed capability
// ==========================================================================

describe('embed override path', () => {
  it('forwards a baseURL override to createEmbedClient for openai', async () => {
    await Effect.runPromise(
      resolveClient('embed', 'openai', {
        baseURL: 'https://my-openai-proxy.example/v1',
      }),
    )

    expect(createEmbedClientMock).toHaveBeenCalledTimes(1)
    expect(embedConstructionCalls[0]?.id).toBe('openai')
    expect(embedConstructionCalls[0]?.overrides?.baseURL).toBe(
      'https://my-openai-proxy.example/v1',
    )
  })

  it('forwards a baseURL override for ollama', async () => {
    await Effect.runPromise(
      resolveClient('embed', 'ollama', {
        baseURL: 'http://my-ollama:9999/v1',
      }),
    )

    expect(embedConstructionCalls[0]?.id).toBe('ollama')
    expect(embedConstructionCalls[0]?.overrides?.baseURL).toBe(
      'http://my-ollama:9999/v1',
    )
  })

  it('forwards a baseURL override for lm-studio', async () => {
    await Effect.runPromise(
      resolveClient('embed', 'lm-studio', {
        baseURL: 'http://my-workstation:1234/v1',
      }),
    )

    expect(embedConstructionCalls[0]?.id).toBe('lm-studio')
    expect(embedConstructionCalls[0]?.overrides?.baseURL).toBe(
      'http://my-workstation:1234/v1',
    )
  })

  it('forwards an apiKey override alongside baseURL', async () => {
    await Effect.runPromise(
      resolveClient('embed', 'ollama', {
        baseURL: 'http://ollama:11434/v1',
        apiKey: 'custom-token',
      }),
    )

    expect(embedConstructionCalls[0]?.overrides?.baseURL).toBe(
      'http://ollama:11434/v1',
    )
    expect(embedConstructionCalls[0]?.overrides?.apiKey).toBe('custom-token')
  })

  it('remaps MissingApiKey into ApiKeyMissingError', async () => {
    createEmbedClientMock.mockReturnValueOnce(
      Effect.fail(
        new MissingApiKey({
          provider: 'openrouter',
          envVar: 'OPENROUTER_API_KEY',
        }),
      ),
    )

    const result = await Effect.runPromise(
      resolveClient('embed', 'openrouter', {
        baseURL: 'https://my-proxy.example/v1',
      }).pipe(Effect.either),
    )

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(ApiKeyMissingError)
      if (result.left instanceof ApiKeyMissingError) {
        expect(result.left.provider).toBe('openrouter')
        expect(result.left.envVar).toBe('OPENROUTER_API_KEY')
      }
    }
  })
})

// ==========================================================================
// Override path: generateText capability
// ==========================================================================

describe('generateText override path', () => {
  it('forwards a baseURL override to createGenerateTextClient', async () => {
    await Effect.runPromise(
      resolveClient('generateText', 'openai', {
        baseURL: 'https://my-openai-proxy.example/v1',
      }),
    )

    expect(createGenerateTextClientMock).toHaveBeenCalledTimes(1)
    expect(generateTextConstructionCalls[0]?.id).toBe('openai')
    expect(generateTextConstructionCalls[0]?.overrides?.baseURL).toBe(
      'https://my-openai-proxy.example/v1',
    )
  })

  it('forwards an apiKey override alongside baseURL', async () => {
    await Effect.runPromise(
      resolveClient('generateText', 'openrouter', {
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-custom',
      }),
    )

    expect(generateTextConstructionCalls[0]?.overrides?.apiKey).toBe(
      'sk-custom',
    )
    expect(generateTextConstructionCalls[0]?.overrides?.baseURL).toBe(
      'https://openrouter.ai/api/v1',
    )
  })

  it('remaps MissingApiKey into ApiKeyMissingError', async () => {
    createGenerateTextClientMock.mockReturnValueOnce(
      Effect.fail(
        new MissingApiKey({
          provider: 'openai',
          envVar: 'OPENAI_API_KEY',
        }),
      ),
    )

    const result = await Effect.runPromise(
      resolveClient('generateText', 'openai', {
        baseURL: 'https://ignore.example/v1',
      }).pipe(Effect.either),
    )

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(ApiKeyMissingError)
      if (result.left instanceof ApiKeyMissingError) {
        expect(result.left.provider).toBe('openai')
        expect(result.left.envVar).toBe('OPENAI_API_KEY')
      }
    }
  })
})

// ==========================================================================
// Fast path: no overrides, or override is a no-op
// ==========================================================================

describe('registry fast path', () => {
  it('returns the registered embed client when no overrides are supplied', async () => {
    await Effect.runPromise(resolveClient('embed', 'openai'))

    expect(createEmbedClientMock).not.toHaveBeenCalled()
  })

  it('returns the registered embed client when overrides is an empty object', async () => {
    await Effect.runPromise(resolveClient('embed', 'openai', {}))

    expect(createEmbedClientMock).not.toHaveBeenCalled()
  })

  it('treats { baseURL: undefined } as no override', async () => {
    // Consumers commonly spread provider config into overrides, so
    // `{ baseURL: undefined }` is the normal shape when the caller
    // has not set a custom host. The runtime must take the fast
    // path, not construct a fresh transport client.
    await Effect.runPromise(
      resolveClient('embed', 'openai', { baseURL: undefined }),
    )

    expect(createEmbedClientMock).not.toHaveBeenCalled()
  })

  it('returns the registered generateText client when no overrides are supplied', async () => {
    await Effect.runPromise(resolveClient('generateText', 'openai'))

    expect(createGenerateTextClientMock).not.toHaveBeenCalled()
  })
})

// ==========================================================================
// Voyage exclusion: overrides are dropped for voyage (fast path)
// ==========================================================================

describe('voyage exclusion from override path', () => {
  it('takes the registry fast path for voyage even when baseURL is supplied', async () => {
    // Voyage is not served by the openai-compatible transport, so
    // the override path (which only handles openai-compatible
    // providers) must not be used. The registry path returns the
    // pre-registered voyage embed client and the caller's baseURL
    // is silently dropped at this layer.
    await Effect.runPromise(
      resolveClient('embed', 'voyage', {
        baseURL: 'http://ignored.example',
      }),
    )

    expect(createEmbedClientMock).not.toHaveBeenCalled()
  })
})

// ==========================================================================
// Rerank fall-through: no openai-compatible transport for rerank
// ==========================================================================

describe('rerank capability falls through to registry', () => {
  it('does not route rerank requests through the openai-compatible transport even with overrides', async () => {
    // Rerank has no openai-compatible transport factory today, so
    // even when overrides are supplied for an openai-compatible
    // provider, the override path is skipped and the registry is
    // consulted. The registry has no rerank capability registered
    // for openai in this test, so the call surfaces
    // `CapabilityNotSupported` — the important invariant is that
    // the transport mocks are NOT called.
    const result = await Effect.runPromise(
      resolveClient('rerank', 'openai', {
        baseURL: 'https://ignored.example/v1',
      }).pipe(Effect.either),
    )

    expect(createEmbedClientMock).not.toHaveBeenCalled()
    expect(createGenerateTextClientMock).not.toHaveBeenCalled()
    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left._tag).toBe('CapabilityNotSupported')
    }
  })
})

describe('getResolvedBaseURL', () => {
  // Sync helper; no registry or mock state needed. These tests lock in
  // the "voyage has no custom-host concept" contract so feature-layer
  // callers like `semantic-search-build.ts:prepareEmbeddingRuntime` can
  // hand off the decision entirely to the runtime.

  it('returns the caller override when set for an openai-compatible provider', () => {
    expect(
      getResolvedBaseURL('openai', { baseURL: 'https://proxy.example/v1' }),
    ).toBe('https://proxy.example/v1')
  })

  it('returns the transport default when no override is supplied for a provider that has one', () => {
    expect(getResolvedBaseURL('ollama')).toBe('http://localhost:11434/v1')
    expect(getResolvedBaseURL('lm-studio')).toBe('http://localhost:1234/v1')
    expect(getResolvedBaseURL('openrouter')).toBe(
      'https://openrouter.ai/api/v1',
    )
  })

  it('returns undefined for openai which has no transport default', () => {
    // The upstream SDK picks its own default for openai, so the
    // provider's transport default is undefined. Persisted metadata
    // records that "no explicit endpoint" was used.
    expect(getResolvedBaseURL('openai')).toBeUndefined()
  })

  it('returns undefined for voyage even when a baseURL override is supplied', () => {
    // Voyage has no custom-host concept at the vector-store-metadata
    // layer. The runtime hides this from feature callers so they do
    // not need a `providerName === 'voyage'` branch of their own.
    expect(
      getResolvedBaseURL('voyage', { baseURL: 'https://ignored.example/v1' }),
    ).toBeUndefined()
  })

  it('returns undefined for voyage with no overrides', () => {
    expect(getResolvedBaseURL('voyage')).toBeUndefined()
  })

  it('treats { baseURL: undefined } the same as no override', () => {
    // Consumers commonly spread `providerConfig` into the overrides
    // object, leaving baseURL as an explicit undefined when the caller
    // did not set one. The helper must fall back to the transport
    // default in that case, not return undefined.
    expect(getResolvedBaseURL('ollama', { baseURL: undefined })).toBe(
      'http://localhost:11434/v1',
    )
  })
})
