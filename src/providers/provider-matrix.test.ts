/**
 * Provider-capability matrix tests.
 *
 * Parameterized coverage of the `(provider, capability)` grid exposed
 * by the runtime. Every cell either constructs a working capability
 * client or fails fast with `CapabilityNotSupported`. There is no
 * silent fallback and no "close enough" provider substitution.
 *
 * This file replaces the pre-refactor `provider-constants` sync test
 * that only compared constant sets across modules. Constant-set
 * equality catches drift in two lists at once but does not catch the
 * behavioral bugs that let PR #24 ship:
 *
 *   Finding #1: HyDE reached OPENAI_API_KEY even when the caller
 *               pinned provider=openrouter and set OPENROUTER_API_KEY.
 *   Finding #2: A custom baseURL on the embedding side was dropped
 *               when HyDE was routed through the same provider.
 *   Finding #3: Unknown models fabricated a cost from gpt-4o-mini
 *               pricing instead of reporting zero.
 *
 * Findings #1 and #2 live in `hyde.test.ts` where the consumer's full
 * options pipeline is exercised. Finding #3 is covered in
 * `pricing.test.ts` (the lookup layer) and `hyde.test.ts` (the
 * consumer layer).
 */

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EmbeddingClient } from './capabilities/embed.js'
import type { TextClient } from './capabilities/generate-text.js'
import {
  CapabilityNotSupported,
  clearRegistry,
  getCapability,
  getProvider,
  MissingApiKey,
  registerDefaultProviders,
} from './index.js'
import type { Capability, ProviderId } from './runtime.js'

// ============================================================================
// Env snapshot helpers
// ============================================================================

const TRACKED_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'VOYAGE_API_KEY',
] as const

const ALL_KEYS_SET: Record<(typeof TRACKED_ENV_KEYS)[number], string> = {
  OPENAI_API_KEY: 'sk-test-openai',
  OPENROUTER_API_KEY: 'sk-or-test',
  VOYAGE_API_KEY: 'voyage-test',
}

const snapshotEnv = (): Record<string, string | undefined> => {
  const snapshot: Record<string, string | undefined> = {}
  for (const key of TRACKED_ENV_KEYS) {
    snapshot[key] = process.env[key]
  }
  return snapshot
}

const restoreEnv = (snapshot: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

// ============================================================================
// Matrix fixture
// ============================================================================

type MatrixOutcome = 'constructs' | 'CapabilityNotSupported'

interface MatrixCell {
  readonly provider: ProviderId
  readonly capability: Capability
  readonly expected: MatrixOutcome
}

/**
 * Expected outcome for every `(provider, capability)` pair with the
 * full set of credentials present. Only `embed` and `generateText`
 * are enumerated; `rerank` is a typed slot with no registered
 * clients today.
 *
 * Voyage is the only asymmetric row: its transport exposes `embed`
 * but explicitly leaves the `generateText` slot empty because Voyage
 * AI has no chat completion API. Asking for generateText on voyage
 * must surface `CapabilityNotSupported` with the actionable list of
 * alternatives.
 */
const MATRIX: readonly MatrixCell[] = [
  { provider: 'openai', capability: 'embed', expected: 'constructs' },
  { provider: 'openai', capability: 'generateText', expected: 'constructs' },
  { provider: 'openrouter', capability: 'embed', expected: 'constructs' },
  {
    provider: 'openrouter',
    capability: 'generateText',
    expected: 'constructs',
  },
  { provider: 'ollama', capability: 'embed', expected: 'constructs' },
  { provider: 'ollama', capability: 'generateText', expected: 'constructs' },
  { provider: 'lm-studio', capability: 'embed', expected: 'constructs' },
  { provider: 'lm-studio', capability: 'generateText', expected: 'constructs' },
  { provider: 'voyage', capability: 'embed', expected: 'constructs' },
  {
    provider: 'voyage',
    capability: 'generateText',
    expected: 'CapabilityNotSupported',
  },
]

/**
 * Expected outcome for every `(provider, capability)` pair when NO
 * remote credentials are set. The local transports (`ollama`,
 * `lm-studio`) do not need keys and must still construct; every
 * remote provider must fail at `getProvider` with `MissingApiKey`
 * regardless of which capability was asked for.
 *
 * This is the parity claim the matrix is here to prove: embed and
 * generateText share one resolution surface, so the error raised by
 * the same precondition (missing key) is consistent across
 * capabilities.
 */
const NO_CREDENTIALS_MATRIX: readonly {
  readonly provider: ProviderId
  readonly capability: Capability
  readonly expected: 'constructs' | 'MissingApiKey'
}[] = [
  { provider: 'openai', capability: 'embed', expected: 'MissingApiKey' },
  { provider: 'openai', capability: 'generateText', expected: 'MissingApiKey' },
  { provider: 'openrouter', capability: 'embed', expected: 'MissingApiKey' },
  {
    provider: 'openrouter',
    capability: 'generateText',
    expected: 'MissingApiKey',
  },
  { provider: 'ollama', capability: 'embed', expected: 'constructs' },
  { provider: 'ollama', capability: 'generateText', expected: 'constructs' },
  { provider: 'lm-studio', capability: 'embed', expected: 'constructs' },
  { provider: 'lm-studio', capability: 'generateText', expected: 'constructs' },
  { provider: 'voyage', capability: 'embed', expected: 'MissingApiKey' },
  {
    provider: 'voyage',
    capability: 'generateText',
    expected: 'MissingApiKey',
  },
]

// ============================================================================
// Matrix body
// ============================================================================

describe('provider-capability matrix (all credentials set)', () => {
  let envSnapshot: Record<string, string | undefined>

  beforeEach(() => {
    clearRegistry()
    envSnapshot = snapshotEnv()
    for (const [key, value] of Object.entries(ALL_KEYS_SET)) {
      process.env[key] = value
    }
    Effect.runSync(registerDefaultProviders())
  })

  afterEach(() => {
    clearRegistry()
    restoreEnv(envSnapshot)
  })

  it.each(MATRIX)(
    '$provider + $capability -> $expected',
    ({ provider, capability, expected }) => {
      const runtime = Effect.runSync(getProvider(provider))
      const result = Effect.runSync(
        Effect.either(getCapability(runtime, capability)),
      )

      if (expected === 'constructs') {
        expect(result._tag).toBe('Right')
        if (result._tag === 'Right') {
          // Every constructed client exposes the capability-named method
          // as a function. The precise signatures are pinned in the
          // capability contract tests.
          if (capability === 'embed') {
            expect(typeof (result.right as EmbeddingClient).embed).toBe(
              'function',
            )
          } else if (capability === 'generateText') {
            expect(typeof (result.right as TextClient).generateText).toBe(
              'function',
            )
          }
        }
        return
      }

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(CapabilityNotSupported)
      }
    },
  )
})

describe('provider-capability matrix (no remote credentials)', () => {
  let envSnapshot: Record<string, string | undefined>

  beforeEach(() => {
    clearRegistry()
    envSnapshot = snapshotEnv()
    for (const key of TRACKED_ENV_KEYS) {
      delete process.env[key]
    }
    Effect.runSync(registerDefaultProviders())
  })

  afterEach(() => {
    clearRegistry()
    restoreEnv(envSnapshot)
  })

  it.each(NO_CREDENTIALS_MATRIX)(
    '$provider + $capability -> $expected',
    ({ provider, capability, expected }) => {
      const providerResult = Effect.runSync(
        Effect.either(getProvider(provider)),
      )

      if (expected === 'MissingApiKey') {
        // The parity claim: embed and generateText share the same
        // resolution surface, so the same precondition (no remote
        // credentials) produces the same error for both capabilities.
        // The error surfaces at `getProvider` — it never reaches
        // `getCapability` — because the runtime is never registered.
        expect(providerResult._tag).toBe('Left')
        if (providerResult._tag === 'Left') {
          expect(providerResult.left).toBeInstanceOf(MissingApiKey)
        }
        return
      }

      // Local providers (ollama, lm-studio) do not need credentials;
      // both capabilities must still resolve via the same pipeline.
      expect(providerResult._tag).toBe('Right')
      if (providerResult._tag === 'Right') {
        const capResult = Effect.runSync(
          Effect.either(getCapability(providerResult.right, capability)),
        )
        expect(capResult._tag).toBe('Right')
        if (capResult._tag === 'Right') {
          if (capability === 'embed') {
            expect(typeof (capResult.right as EmbeddingClient).embed).toBe(
              'function',
            )
          } else if (capability === 'generateText') {
            expect(typeof (capResult.right as TextClient).generateText).toBe(
              'function',
            )
          }
        }
      }
    },
  )
})
