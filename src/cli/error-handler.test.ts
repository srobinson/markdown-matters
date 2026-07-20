/**
 * Unit tests for CLI error handler
 */

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CapabilityNotSupported,
  EmbeddingError,
  isMdmError,
  MDM_ERROR_TAGS,
  ProviderNotFound,
} from '../errors/index.js'
import { ManifestError } from '../manifest.js'
import {
  EFFECT_CLI_ERROR_TAGS,
  formatEffectCliError,
  isEffectCliValidationError,
} from './effect-cli-errors.js'
import { formatError, handleCliTopLevelError } from './error-handler.js'

describe('formatEffectCliError', () => {
  let originalArgv: string[]

  beforeEach(() => {
    originalArgv = process.argv
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  describe('mode validation errors with suggestions', () => {
    it('suggests "semantic" for "semantics"', () => {
      process.argv = ['node', 'cli', 'search', '--mode', 'semantics', 'test']

      const error = {
        _tag: 'ValidationError',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value:
              'Expected one of the following cases: hybrid, semantic, keyword',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).toContain("Did you mean '--mode semantic'?")
    })

    it('suggests "keyword" for "keywords"', () => {
      process.argv = ['node', 'cli', 'search', '--mode', 'keywords', 'test']

      const error = {
        _tag: 'ValidationError',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value:
              'Expected one of the following cases: hybrid, semantic, keyword',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).toContain("Did you mean '--mode keyword'?")
    })

    it('suggests "hybrid" for "hybrit"', () => {
      process.argv = ['node', 'cli', 'search', '--mode', 'hybrit', 'test']

      const error = {
        _tag: 'ValidationError',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value:
              'Expected one of the following cases: hybrid, semantic, keyword',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).toContain("Did you mean '--mode hybrid'?")
    })

    it('suggests "semantic" for "semant"', () => {
      process.argv = ['node', 'cli', 'search', '--mode', 'semant', 'test']

      const error = {
        _tag: 'ValidationError',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value:
              'Expected one of the following cases: hybrid, semantic, keyword',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).toContain("Did you mean '--mode semantic'?")
    })

    it('suggests "keyword" for "keywordd"', () => {
      process.argv = ['node', 'cli', 'search', '--mode', 'keywordd', 'test']

      const error = {
        _tag: 'ValidationError',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value:
              'Expected one of the following cases: hybrid, semantic, keyword',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).toContain("Did you mean '--mode keyword'?")
    })

    it('does not suggest for typos too far off', () => {
      process.argv = ['node', 'cli', 'search', '--mode', 'xyz', 'test']

      const error = {
        _tag: 'ValidationError',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value:
              'Expected one of the following cases: hybrid, semantic, keyword',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).not.toContain('Did you mean')
    })

    it('handles --mode=value syntax', () => {
      process.argv = ['node', 'cli', 'search', '--mode=semantics', 'test']

      const error = {
        _tag: 'ValidationError',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value:
              'Expected one of the following cases: hybrid, semantic, keyword',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).toContain("Did you mean '--mode semantic'?")
    })

    it('handles -m short flag', () => {
      process.argv = ['node', 'cli', 'search', '-m', 'semantics', 'test']

      const error = {
        _tag: 'ValidationError',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value:
              'Expected one of the following cases: hybrid, semantic, keyword',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).toContain("Did you mean '--mode semantic'?")
    })

    it('does not suggest for non-mode validation errors', () => {
      process.argv = ['node', 'cli', 'search', 'test']

      const error = {
        _tag: 'ValidationError',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value: 'Some other validation error',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).toBe('Some other validation error')
      expect(result).not.toContain('Did you mean')
    })
  })

  describe('other error types', () => {
    it('handles MissingValue errors', () => {
      process.argv = ['node', 'cli', 'search']

      const error = {
        _tag: 'MissingValue',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value: 'Missing required argument',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).toBe('Missing required argument')
    })

    it('handles InvalidValue errors', () => {
      process.argv = ['node', 'cli', 'search']

      const error = {
        _tag: 'InvalidValue',
        error: {
          _tag: 'Paragraph',
          value: {
            _tag: 'Text',
            value: 'Invalid value provided',
          },
        },
      }

      const result = formatEffectCliError(error)
      expect(result).toBe('Invalid value provided')
    })

    it('handles unknown error types', () => {
      const error = { message: 'Unknown error' }
      const result = formatEffectCliError(error)
      expect(result).toBe('[object Object]')
    })
  })
})

// ============================================================================
// Security: API key redaction (ALP-1237 / ALP-1201)
// ============================================================================

describe('security: API key redaction in formatError output', () => {
  it('formatError does not include raw API key in formatted output', () => {
    const error = new EmbeddingError({
      reason: 'Unknown',
      message: 'Request failed',
      cause: { apiKey: 'sk-live-SUPERSECRETKEY123' },
    })

    const formatted = formatError(error)
    const output = JSON.stringify(formatted)

    expect(output).not.toContain('sk-live-SUPERSECRETKEY123')
  })

  it('formatError result does not leak sensitive fields from error details', () => {
    const error = new EmbeddingError({
      reason: 'Network',
      message: 'Connection refused',
      cause: {
        authorization: 'Bearer sk-secret-token',
        password: 'my-password',
        url: 'https://api.openai.com/v1/embeddings',
      },
    })

    const formatted = formatError(error)
    // The formatted output should contain user-facing info but not raw secrets
    expect(formatted.message).toBeDefined()
    // Suggestions should not contain the secret values
    const suggestionsStr = JSON.stringify(formatted.suggestions)
    expect(suggestionsStr).not.toContain('sk-secret-token')
    expect(suggestionsStr).not.toContain('my-password')
  })
})

// ============================================================================
// Provider runtime errors at the CLI boundary (ALP-1715)
//
// These tests pin the actionable-remediation contract for provider
// runtime failures. Before ALP-1715, `CapabilityNotSupported` and
// `ProviderNotFound` escaped `src/embeddings/semantic-search*.ts` and
// fell through `main.ts` into the generic `Unexpected error` branch.
// The tests below assert that `formatError` now produces typed,
// user-facing output for both shapes, and that `isMdmError` correctly
// classifies them so main.ts can route them through the formatter.
// ============================================================================

describe('formatError: CapabilityNotSupported (ALP-1715)', () => {
  it('renders actionable message with alternatives (voyage + HyDE scenario)', () => {
    // The spec's canonical example: voyage is requested for HyDE but
    // voyage only supports embed, not generateText.
    const error = new CapabilityNotSupported({
      provider: 'voyage',
      capability: 'generateText',
      supportedAlternatives: ['openai', 'ollama', 'lm-studio'],
    })

    const formatted = formatError(error)

    expect(formatted.code).toBe('E321')
    expect(formatted.message).toBe('voyage does not support generateText')
    expect(formatted.suggestions).toEqual([
      'Use one of: openai, ollama, lm-studio',
      'Switch provider: --provider openai',
    ])
    // Capability mismatches are user errors — the user chose the wrong
    // provider — not system faults, so exit code is USER_ERROR.
    expect(formatted.exitCode).toBe(1)
  })

  it('renders remediation when no alternatives exist', () => {
    const error = new CapabilityNotSupported({
      provider: 'voyage',
      capability: 'generateText',
      supportedAlternatives: [],
    })

    const formatted = formatError(error)

    expect(formatted.code).toBe('E321')
    expect(formatted.message).toBe('voyage does not support generateText')
    expect(formatted.suggestions).toEqual([
      'No providers currently support generateText',
      'Check your provider configuration',
    ])
    expect(formatted.exitCode).toBe(1)
  })

  it('does not fall through to the generic Unexpected error branch', () => {
    const error = new CapabilityNotSupported({
      provider: 'voyage',
      capability: 'generateText',
      supportedAlternatives: ['openai'],
    })

    // The FormattedError must carry a real code and suggestions — the
    // "Unexpected error" path produces neither.
    const formatted = formatError(error)
    expect(formatted.code).toMatch(/^E\d{3}$/)
    expect(formatted.suggestions).toBeDefined()
    expect(formatted.suggestions?.length).toBeGreaterThan(0)
  })
})

describe('formatError: ProviderNotFound (ALP-1715)', () => {
  it('renders remediation listing known providers', () => {
    const error = new ProviderNotFound({
      id: 'cohere',
      known: ['openai', 'voyage', 'ollama'],
    })

    const formatted = formatError(error)

    expect(formatted.code).toBe('E320')
    expect(formatted.message).toBe('Provider "cohere" is not registered')
    expect(formatted.details).toBe('Known providers: openai, voyage, ollama')
    expect(formatted.suggestions).toEqual([
      'Use one of: openai, voyage, ollama',
    ])
    expect(formatted.exitCode).toBe(1)
  })

  it('renders unbootstrapped-registry hint when known is empty', () => {
    // This is the shape an unbootstrapped registry returns — the
    // ALP-1713/ALP-1714 regression. The CLI must still render
    // actionable remediation pointing at the bootstrap step, not
    // dump a generic "Unexpected error".
    const error = new ProviderNotFound({
      id: 'openai',
      known: [],
    })

    const formatted = formatError(error)

    expect(formatted.code).toBe('E320')
    expect(formatted.message).toBe('Provider "openai" is not registered')
    expect(formatted.details).toBe('No providers are registered')
    expect(formatted.suggestions).toEqual([
      'Ensure provider runtime bootstrap ran before this call',
    ])
    expect(formatted.exitCode).toBe(1)
  })
})

describe('isMdmError: CLI boundary type guard (ALP-1715)', () => {
  it('classifies CapabilityNotSupported as an MdmError', () => {
    const error = new CapabilityNotSupported({
      provider: 'voyage',
      capability: 'generateText',
      supportedAlternatives: ['openai'],
    })
    expect(isMdmError(error)).toBe(true)
  })

  it('classifies ProviderNotFound as an MdmError', () => {
    const error = new ProviderNotFound({ id: 'missing', known: [] })
    expect(isMdmError(error)).toBe(true)
  })

  it('classifies EmbeddingError as an MdmError', () => {
    const error = new EmbeddingError({
      reason: 'RateLimit',
      message: 'Too many requests',
    })
    expect(isMdmError(error)).toBe(true)
  })

  it('rejects plain Error instances', () => {
    expect(isMdmError(new Error('boom'))).toBe(false)
  })

  it('rejects untagged objects', () => {
    expect(isMdmError({ message: 'boom' })).toBe(false)
  })

  it('rejects objects with unknown tags', () => {
    // A tagged error from outside the MdmError union (e.g. an Effect
    // CLI ValidationError) must not be misclassified — main.ts routes
    // those through a separate branch.
    expect(isMdmError({ _tag: 'ValidationError' })).toBe(false)
  })

  it('rejects null and primitives', () => {
    expect(isMdmError(null)).toBe(false)
    expect(isMdmError(undefined)).toBe(false)
    expect(isMdmError('string')).toBe(false)
    expect(isMdmError(42)).toBe(false)
  })
})

// ============================================================================
// Top-level CLI error dispatcher (ALP-1717)
//
// These tests exercise the routing logic in `handleCliTopLevelError` —
// the three-branch dispatcher extracted from `src/cli/main.ts`. The
// prior ALP-1715 tests above cover the `formatError` and `isMdmError`
// contracts in isolation; they do not verify which branch of the
// dispatcher invokes them, the exit codes that each branch emits, or
// the disjointness between the `@effect/cli` validation branch and
// the `MdmError` branch. This block closes those gaps.
// ============================================================================

describe('handleCliTopLevelError (ALP-1717)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  const stderrOutput = (): string =>
    errorSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n')

  describe('branch 1: effect-cli validation errors', () => {
    it('exits with code 1 and prints usage hint for ValidationError', async () => {
      const error = {
        _tag: 'ValidationError',
        error: {
          _tag: 'Paragraph',
          value: { _tag: 'Text', value: 'Missing required flag --path' },
        },
      }

      await Effect.runPromise(handleCliTopLevelError(error))

      expect(exitSpy).toHaveBeenCalledWith(1)
      const output = stderrOutput()
      expect(output).toContain('Error: Missing required flag --path')
      expect(output).toContain('Run "mdm --help" for usage information')
      expect(output).not.toContain('Stack trace:')
      expect(output).not.toContain('Unexpected error:')
    })
  })

  describe('typed domain errors', () => {
    it('renders manifest guidance without an unexpected stack trace', async () => {
      const error = new ManifestError({
        path: '/tmp/mdm/manifest.toml',
        message: 'Manifest has no directories. Run mdm index <dir> first.',
      })

      await Effect.runPromise(handleCliTopLevelError(error))

      expect(exitSpy).toHaveBeenCalledWith(1)
      const output = stderrOutput()
      expect(output).toContain('Run mdm index <dir> first')
      expect(output).toContain('/tmp/mdm/manifest.toml')
      expect(output).not.toContain('Unexpected error:')
      expect(output).not.toContain('Stack trace:')
    })

    it('routes CapabilityNotSupported with formatter exit code and remediation', async () => {
      const error = new CapabilityNotSupported({
        provider: 'voyage',
        capability: 'generateText',
        supportedAlternatives: ['openai', 'ollama', 'lm-studio'],
      })

      await Effect.runPromise(handleCliTopLevelError(error))

      const expectedExitCode = formatError(error).exitCode
      expect(exitSpy).toHaveBeenCalledWith(expectedExitCode)
      const output = stderrOutput()
      expect(output).toContain('voyage does not support generateText')
      expect(output).toContain('Use one of: openai, ollama, lm-studio')
      expect(output).toContain('Switch provider: --provider openai')
      expect(output).not.toContain('Unexpected error:')
    })

    it('routes ProviderNotFound with formatter exit code and known providers', async () => {
      const error = new ProviderNotFound({
        id: 'cohere',
        known: ['openai', 'voyage'],
      })

      await Effect.runPromise(handleCliTopLevelError(error))

      const expectedExitCode = formatError(error).exitCode
      expect(exitSpy).toHaveBeenCalledWith(expectedExitCode)
      const output = stderrOutput()
      expect(output).toContain('Provider "cohere" is not registered')
      expect(output).toContain('Known providers: openai, voyage')
      expect(output).toContain('Use one of: openai, voyage')
      expect(output).not.toContain('Unexpected error:')
    })

    it('routes ProviderNotFound with empty known to bootstrap hint', async () => {
      const error = new ProviderNotFound({ id: 'openai', known: [] })

      await Effect.runPromise(handleCliTopLevelError(error))

      expect(exitSpy).toHaveBeenCalledWith(formatError(error).exitCode)
      const output = stderrOutput()
      expect(output).toContain('Provider "openai" is not registered')
      expect(output).toContain(
        'Ensure provider runtime bootstrap ran before this call',
      )
    })
  })

  describe('branch 3: unexpected errors', () => {
    it('prints stack trace and exits with code 2 for plain Error', async () => {
      const error = new Error('boom')

      await Effect.runPromise(handleCliTopLevelError(error))

      expect(exitSpy).toHaveBeenCalledWith(2)
      const output = stderrOutput()
      expect(output).toContain('Unexpected error:')
      expect(output).toContain('boom')
      expect(output).toContain('Stack trace:')
      // The actual stack trace must include this test frame.
      expect(output).toContain('error-handler.test')
    })

    it('uses util.inspect and exits with code 2 for string value', async () => {
      await Effect.runPromise(handleCliTopLevelError('raw string error'))

      expect(exitSpy).toHaveBeenCalledWith(2)
      const output = stderrOutput()
      expect(output).toContain('Unexpected error:')
      // util.inspect quotes string values with single quotes.
      expect(output).toContain("'raw string error'")
      expect(output).not.toContain('Stack trace:')
    })

    it('uses util.inspect and exits with code 2 for null', async () => {
      await Effect.runPromise(handleCliTopLevelError(null))

      expect(exitSpy).toHaveBeenCalledWith(2)
      const output = stderrOutput()
      expect(output).toContain('Unexpected error:')
      expect(output).toContain('null')
    })

    it('uses util.inspect and exits with code 2 for number', async () => {
      await Effect.runPromise(handleCliTopLevelError(42))

      expect(exitSpy).toHaveBeenCalledWith(2)
      const output = stderrOutput()
      expect(output).toContain('Unexpected error:')
      expect(output).toContain('42')
    })
  })
})

// ============================================================================
// Dispatcher predicate disjointness (ALP-1717)
//
// The ALP-1715 commit message claimed "Tag sets for (1) and (2) are
// disjoint (effect-cli uses ValidationError/MissingValue/..., MdmError
// uses ...)". The tests below back that claim mechanically. A future
// `@effect/cli` release that introduced a `_tag` colliding with an
// `MdmError` variant, or a new `MdmError` variant that accidentally
// reused an effect-cli tag, would fail one of these assertions
// instead of silently misrouting the error at runtime.
// ============================================================================

describe('dispatcher predicate disjointness (ALP-1717)', () => {
  it('no MdmError tag is also an effect-cli validation tag', () => {
    const collisions = [...MDM_ERROR_TAGS].filter((tag) =>
      (EFFECT_CLI_ERROR_TAGS as ReadonlySet<string>).has(tag),
    )
    expect(collisions).toEqual([])
  })

  it('no effect-cli validation tag is also an MdmError tag', () => {
    const collisions = [...EFFECT_CLI_ERROR_TAGS].filter((tag) =>
      (MDM_ERROR_TAGS as ReadonlySet<string>).has(tag),
    )
    expect(collisions).toEqual([])
  })

  it('isEffectCliValidationError rejects live MdmError instances', () => {
    const capability = new CapabilityNotSupported({
      provider: 'voyage',
      capability: 'generateText',
      supportedAlternatives: [],
    })
    const provider = new ProviderNotFound({ id: 'cohere', known: [] })
    const embedding = new EmbeddingError({
      reason: 'RateLimit',
      message: 'slow down',
    })

    expect(isEffectCliValidationError(capability)).toBe(false)
    expect(isEffectCliValidationError(provider)).toBe(false)
    expect(isEffectCliValidationError(embedding)).toBe(false)
  })

  it('isMdmError rejects every effect-cli validation tag shape', () => {
    for (const tag of EFFECT_CLI_ERROR_TAGS) {
      expect(isMdmError({ _tag: tag, error: null })).toBe(false)
    }
  })
})
