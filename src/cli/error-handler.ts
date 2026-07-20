/**
 * Centralized CLI error handler
 *
 * This module provides a single point of error formatting and display for the CLI.
 * It maps tagged errors to user-friendly messages with appropriate exit codes.
 *
 * Usage:
 * ```typescript
 * program.pipe(handleCliErrors)
 * ```
 *
 * Exit Codes:
 * - 0: Success
 * - 1: User error (invalid arguments, missing config, etc.)
 * - 2: System error (file system, network, etc.)
 * - 3: API error (authentication, rate limits)
 */

import * as util from 'node:util'
import { Console, Effect, Match } from 'effect'
import type { EmbeddingProviderName } from '../config/schema.js'
import {
  detectProviderError,
  getProviderErrorTitle,
  getProviderSuggestions,
} from '../embeddings/provider-errors.js'
import {
  type ConfigError,
  type EmbeddingError,
  isMdmError,
  type MdmError,
} from '../errors/index.js'
import { ManifestError } from '../manifest.js'
import {
  formatEffectCliError,
  isEffectCliValidationError,
} from './effect-cli-errors.js'

// ============================================================================
// Exit Codes
// ============================================================================

export const EXIT_CODE = {
  SUCCESS: 0,
  USER_ERROR: 1,
  SYSTEM_ERROR: 2,
  API_ERROR: 3,
} as const

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE]

// ============================================================================
// Formatted Error
// ============================================================================

export interface FormattedError {
  readonly code: string
  readonly message: string
  readonly details?: string | undefined
  readonly suggestions?: readonly string[] | undefined
  readonly exitCode: ExitCode
}

// ============================================================================
// Config Error Formatter
// ============================================================================

/**
 * Format a ConfigError with enhanced context information.
 * Builds a detailed error message including source file, type expectations,
 * and valid values when available.
 */
const formatConfigError = (e: ConfigError): FormattedError => {
  const message = e.field
    ? `Invalid configuration: ${e.field}`
    : 'Configuration error'

  const detailParts: string[] = []

  if (e.sourceFile) {
    detailParts.push(`Source: ${e.sourceFile}`)
  }

  if (e.expectedType) {
    detailParts.push(`Expected: ${e.expectedType}`)
  }

  if (e.actualValue !== undefined) {
    const actualStr =
      typeof e.actualValue === 'string'
        ? `"${e.actualValue}"`
        : String(e.actualValue)
    detailParts.push(`Got: ${actualStr}`)
  }

  if (e.validValues && e.validValues.length > 0) {
    detailParts.push(`Valid values: ${e.validValues.join(', ')}`)
  }

  if (e.message && detailParts.length === 0) {
    detailParts.push(e.message)
  } else if (e.message && !detailParts.some((p) => p.includes(e.message))) {
    detailParts.unshift(e.message)
  }

  const suggestions: string[] = []
  suggestions.push('Check your config file syntax')
  suggestions.push("Run 'mdm config check' to validate configuration")

  return {
    code: e.code,
    message,
    details: detailParts.length > 0 ? detailParts.join('\n  ') : undefined,
    suggestions,
    exitCode: EXIT_CODE.USER_ERROR,
  }
}

// ============================================================================
// Error Formatter
// ============================================================================

/**
 * Format an error for user display.
 * Returns a structured object with message, suggestions, and exit code.
 */
export const formatError = (error: MdmError): FormattedError =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      // File system errors
      FileReadError: (e) => ({
        code: e.code,
        message: `Cannot read file: ${e.path}`,
        details: e.message,
        suggestions: [
          'Check that the file exists',
          'Check file permissions',
        ] as const,
        exitCode: EXIT_CODE.SYSTEM_ERROR,
      }),
      FileWriteError: (e) => ({
        code: e.code,
        message: `Cannot write file: ${e.path}`,
        details: e.message,
        suggestions: [
          'Check that the directory exists',
          'Check write permissions',
          'Check disk space',
        ] as const,
        exitCode: EXIT_CODE.SYSTEM_ERROR,
      }),
      DirectoryCreateError: (e) => ({
        code: e.code,
        message: `Cannot create directory: ${e.path}`,
        details: e.message,
        suggestions: [
          'Check parent directory permissions',
          'Check disk space',
        ] as const,
        exitCode: EXIT_CODE.SYSTEM_ERROR,
      }),
      DirectoryWalkError: (e) => ({
        code: e.code,
        message: `Cannot traverse directory: ${e.path}`,
        details: e.message,
        suggestions: [
          'Check directory permissions',
          'Check that the path exists',
        ] as const,
        exitCode: EXIT_CODE.SYSTEM_ERROR,
      }),

      // Parse errors
      ParseError: (e) => ({
        code: e.code,
        message: e.path
          ? `Parse error in ${e.path}${e.line ? `:${e.line}` : ''}`
          : 'Parse error',
        details: e.message,
        suggestions: ['Check the file syntax'] as const,
        exitCode: EXIT_CODE.USER_ERROR,
      }),

      // API key errors
      ApiKeyMissingError: (e) => ({
        code: e.code,
        message: `${e.envVar} not set`,
        suggestions: [
          `export ${e.envVar}=your-api-key`,
          'Or add to .env file in project root',
        ] as const,
        exitCode: EXIT_CODE.API_ERROR,
      }),
      ApiKeyInvalidError: (e) => ({
        code: e.code,
        message: `Invalid API key for ${e.provider}`,
        details: e.details,
        suggestions: [
          'Check that your API key is correct',
          'Verify your API key has not expired',
          'Check your API account status',
        ] as const,
        exitCode: EXIT_CODE.API_ERROR,
      }),

      // Provider runtime errors - registry lookup and capability mismatches
      CapabilityNotSupported: (e) => ({
        code: e.code,
        message: `${e.provider} does not support ${e.capability}`,
        suggestions:
          e.supportedAlternatives.length > 0
            ? ([
                `Use one of: ${e.supportedAlternatives.join(', ')}`,
                `Switch provider: --provider ${e.supportedAlternatives[0]}`,
              ] as const)
            : ([
                `No providers currently support ${e.capability}`,
                'Check your provider configuration',
              ] as const),
        exitCode: EXIT_CODE.USER_ERROR,
      }),
      ProviderNotFound: (e) => ({
        code: e.code,
        message: `Provider "${e.id}" is not registered`,
        details:
          e.known.length > 0
            ? `Known providers: ${e.known.join(', ')}`
            : 'No providers are registered',
        suggestions: [
          e.known.length > 0
            ? `Use one of: ${e.known.join(', ')}`
            : 'Ensure provider runtime bootstrap ran before this call',
        ] as const,
        exitCode: EXIT_CODE.USER_ERROR,
      }),

      // Embedding errors - enhanced with provider-specific detection
      EmbeddingError: (e) => formatEmbeddingError(e),

      // Index errors
      IndexNotFoundError: (e) => ({
        code: e.code,
        message: 'Index not found',
        details: `No index at ${e.path}`,
        suggestions: ["Run 'mdm index' first to build the index"] as const,
        exitCode: EXIT_CODE.USER_ERROR,
      }),
      IndexCorruptedError: (e) => ({
        code: e.code,
        message: 'Index is corrupted',
        details: e.details ?? `Corruption reason: ${e.reason}`,
        suggestions: [
          "Delete the .mdm folder and run 'mdm index' again",
        ] as const,
        exitCode: EXIT_CODE.USER_ERROR,
      }),
      IndexBuildError: (e) => ({
        code: e.code,
        message: `Failed to build index for: ${e.path}`,
        details: e.message,
        suggestions: ['Check the file is valid markdown'] as const,
        exitCode: EXIT_CODE.USER_ERROR,
      }),

      // Search errors
      DocumentNotFoundError: (e) => ({
        code: e.code,
        message: `Document not found in index: ${e.path}`,
        suggestions: [
          "Run 'mdm index' to update the index",
          'Check the file path is correct',
        ] as const,
        exitCode: EXIT_CODE.USER_ERROR,
      }),
      EmbeddingsNotFoundError: (e) => ({
        code: e.code,
        message: 'Embeddings not found',
        details: `No embeddings at ${e.path}`,
        suggestions: [
          "Run 'mdm index --embed' to build embeddings for semantic search",
          'Use -k flag for keyword search instead',
        ] as const,
        exitCode: EXIT_CODE.USER_ERROR,
      }),

      // Dimension mismatch errors
      DimensionMismatchError: (e) => ({
        code: e.code,
        message: 'Embedding dimension mismatch',
        details: e.message,
        suggestions: [
          e.corpusProvider
            ? `Switch back to original provider: --provider ${e.corpusProvider.split(':')[0]} --provider-model ${e.corpusProvider.split(':')[1] ?? ''}`
            : 'Check your embedding provider configuration',
          "Rebuild corpus with current provider: 'mdm index --embed --force'",
          'The corpus was created with different embedding dimensions than your current provider',
        ] as const,
        exitCode: EXIT_CODE.USER_ERROR,
      }),

      // Vector store errors
      VectorStoreError: (e) => ({
        code: e.code,
        message: `Vector store error during ${e.operation}`,
        details: e.message,
        suggestions: [
          "Delete .mdm/embeddings and run 'mdm index --embed' again",
        ] as const,
        exitCode: EXIT_CODE.SYSTEM_ERROR,
      }),

      // Config errors
      ConfigError: (e) => formatConfigError(e),

      // Watch errors
      WatchError: (e) => ({
        code: e.code,
        message: `File watcher error: ${e.path}`,
        details: e.message,
        suggestions: [
          'Check directory permissions',
          'Check disk space',
          'Try restarting the watch command',
        ] as const,
        exitCode: EXIT_CODE.SYSTEM_ERROR,
      }),

      // CLI validation errors
      CliValidationError: (e) => ({
        code: e.code,
        message: e.message,
        details:
          e.argument && e.expected
            ? `Expected ${e.expected}${e.received ? `, got ${e.received}` : ''}`
            : undefined,
        suggestions: ["Run 'mdm --help' for usage information"] as const,
        exitCode: EXIT_CODE.USER_ERROR,
      }),

      // Summarization errors
      SummarizationError: (e) => ({
        code: e.code,
        message: e.message,
        details: e.provider ? `Provider: ${e.provider}` : undefined,
        suggestions: [
          'Try a different provider with --provider',
          "Run 'mdm search' without --summarize",
        ] as const,
        exitCode: EXIT_CODE.SYSTEM_ERROR,
      }),
    }),
  )

// ============================================================================
// Embedding Error Formatter
// ============================================================================

/**
 * Format an EmbeddingError with provider-specific detection and
 * reason-based fallback. Extracted from `formatError` to keep the
 * top-level exhaustive dispatch readable.
 */
const formatEmbeddingError = (e: EmbeddingError): FormattedError => {
  // Try to detect provider-specific error for better messaging
  const provider = (e.provider ?? 'openai') as EmbeddingProviderName
  const providerError = detectProviderError(provider, e.cause)

  if (providerError) {
    return {
      code: e.code,
      message: getProviderErrorTitle(providerError),
      details: e.message,
      suggestions: getProviderSuggestions(providerError),
      exitCode:
        providerError.type === 'daemon-not-running' ||
        providerError.type === 'gui-not-running' ||
        providerError.type === 'connection-refused'
          ? EXIT_CODE.SYSTEM_ERROR
          : EXIT_CODE.API_ERROR,
    }
  }

  return Match.value(e.reason).pipe(
    Match.when('RateLimit', () => ({
      code: e.code,
      message: 'Rate limit exceeded',
      details: e.message,
      suggestions: [
        'Wait a few minutes and try again',
        'Consider using a smaller batch size',
      ] as const,
      exitCode: EXIT_CODE.API_ERROR,
    })),
    Match.when('QuotaExceeded', () => ({
      code: e.code,
      message: 'API quota exceeded',
      details: e.message,
      suggestions: [
        'Check your API usage limits',
        'Consider upgrading your API plan',
      ] as const,
      exitCode: EXIT_CODE.API_ERROR,
    })),
    Match.when('Network', () => {
      const networkSuggestions =
        provider === 'ollama'
          ? [
              'Start the Ollama daemon: ollama serve',
              'Install Ollama: https://ollama.com/download',
            ]
          : provider === 'lm-studio'
            ? [
                'Open LM Studio application',
                'Start the local server in Developer tab',
              ]
            : ['Check your internet connection', 'Try again later']

      return {
        code: e.code,
        message:
          provider === 'ollama'
            ? 'Cannot connect to Ollama'
            : provider === 'lm-studio'
              ? 'Cannot connect to LM Studio'
              : 'Network error during embedding',
        details: e.message,
        suggestions: networkSuggestions,
        exitCode: EXIT_CODE.SYSTEM_ERROR,
      }
    }),
    Match.when('ModelError', () => ({
      code: e.code,
      message:
        provider === 'ollama'
          ? 'Ollama model not found'
          : provider === 'lm-studio'
            ? 'LM Studio model not loaded'
            : 'Model error',
      details: e.message,
      suggestions:
        provider === 'ollama'
          ? [
              'Download an embedding model: ollama pull nomic-embed-text',
              'List available models: ollama list',
            ]
          : provider === 'lm-studio'
            ? [
                'Load an embedding model in LM Studio',
                'Go to Models tab and download an embedding model',
              ]
            : ['Check that the model name is correct'],
      exitCode: EXIT_CODE.USER_ERROR,
    })),
    Match.orElse(() => ({
      code: e.code,
      message: 'Embedding generation failed',
      details: e.message,
      exitCode: EXIT_CODE.API_ERROR,
    })),
  )
}

// ============================================================================
// Error Display
// ============================================================================

/**
 * Display a formatted error to stderr.
 * This is the only place in the CLI that should output error messages.
 */
export const displayError = (
  formatted: FormattedError,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    yield* Console.error('')
    yield* Console.error(`Error [${formatted.code}]: ${formatted.message}`)

    if (formatted.details) {
      yield* Console.error(`  ${formatted.details}`)
    }

    if (formatted.suggestions && formatted.suggestions.length > 0) {
      yield* Console.error('')
      for (const suggestion of formatted.suggestions) {
        yield* Console.error(`  ${suggestion}`)
      }
    }

    yield* Console.error('')
  })

// ============================================================================
// Top-Level CLI Error Dispatcher (ALP-1717)
// ============================================================================

/**
 * Top-level CLI error dispatcher. Routes every error that escapes the
 * effect program into one of three branches:
 *
 *   1. `@effect/cli` validation errors → short error + usage hint, exit 1.
 *   2. Typed manifest errors → concise guidance with exit 1.
 *   3. Typed `MdmError` variants → `formatError` + `displayError` with
 *      actionable remediation, exit code from the formatter.
 *   4. Everything else → diagnostic `Unexpected error` dump, exit 2.
 *
 * Extracted from `src/cli/main.ts` so the routing logic is testable
 * without importing the CLI entrypoint. The disjointness between
 * branches (1) and (2) is asserted mechanically in
 * `error-handler.test.ts` via the intersection of
 * `EFFECT_CLI_ERROR_TAGS` and `MDM_ERROR_TAGS` — a future dependency
 * bump that introduced a colliding `_tag` would fail that test
 * instead of silently misrouting errors at runtime.
 */
export const handleCliTopLevelError = (
  error: unknown,
): Effect.Effect<void, never> => {
  if (isEffectCliValidationError(error)) {
    return Effect.sync(() => {
      const message = formatEffectCliError(error)
      console.error(`\nError: ${message}`)
      console.error('\nRun "mdm --help" for usage information.')
      process.exit(1)
    })
  }

  if (error instanceof ManifestError) {
    return Effect.sync(() => {
      console.error(`\nError: ${error.message}`)
      console.error(`\nManifest: ${error.path}`)
      process.exit(EXIT_CODE.USER_ERROR)
    })
  }

  if (isMdmError(error)) {
    const formatted = formatError(error)
    return displayError(formatted).pipe(
      Effect.flatMap(() =>
        Effect.sync(() => {
          process.exit(formatted.exitCode)
        }),
      ),
    )
  }

  return Effect.sync(() => {
    console.error('\nUnexpected error:')
    if (error instanceof Error) {
      console.error(`  ${error.message}`)
      if (error.stack) {
        console.error('\nStack trace:')
        console.error(error.stack)
      }
    } else {
      console.error(util.inspect(error, { depth: null }))
    }
    process.exit(2)
  })
}
