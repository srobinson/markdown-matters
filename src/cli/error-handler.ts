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

import { Console, Effect, Match } from 'effect'
import type { EmbeddingProvider } from '../config/schema.js'
import {
  detectProviderError,
  getProviderErrorTitle,
  getProviderSuggestions,
} from '../embeddings/provider-errors.js'
import type {
  ApiKeyInvalidError,
  ApiKeyMissingError,
  CliValidationError,
  ConfigError,
  DirectoryCreateError,
  DirectoryWalkError,
  DocumentNotFoundError,
  EmbeddingError,
  EmbeddingsNotFoundError,
  FileReadError,
  FileWriteError,
  IndexBuildError,
  IndexCorruptedError,
  IndexNotFoundError,
  MdContextError,
  ParseError,
  VectorStoreError,
  WatchError,
} from '../errors/index.js'

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
  suggestions.push("Run 'mdcontext config check' to validate configuration")

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
export const formatError = (error: MdContextError): FormattedError =>
  Match.value(error).pipe(
    // File system errors
    Match.tag('FileReadError', (e) => ({
      code: e.code,
      message: `Cannot read file: ${e.path}`,
      details: e.message,
      suggestions: [
        'Check that the file exists',
        'Check file permissions',
      ] as const,
      exitCode: EXIT_CODE.SYSTEM_ERROR,
    })),
    Match.tag('FileWriteError', (e) => ({
      code: e.code,
      message: `Cannot write file: ${e.path}`,
      details: e.message,
      suggestions: [
        'Check that the directory exists',
        'Check write permissions',
        'Check disk space',
      ] as const,
      exitCode: EXIT_CODE.SYSTEM_ERROR,
    })),
    Match.tag('DirectoryCreateError', (e) => ({
      code: e.code,
      message: `Cannot create directory: ${e.path}`,
      details: e.message,
      suggestions: [
        'Check parent directory permissions',
        'Check disk space',
      ] as const,
      exitCode: EXIT_CODE.SYSTEM_ERROR,
    })),
    Match.tag('DirectoryWalkError', (e) => ({
      code: e.code,
      message: `Cannot traverse directory: ${e.path}`,
      details: e.message,
      suggestions: [
        'Check directory permissions',
        'Check that the path exists',
      ] as const,
      exitCode: EXIT_CODE.SYSTEM_ERROR,
    })),

    // Parse errors
    Match.tag('ParseError', (e) => ({
      code: e.code,
      message: e.path
        ? `Parse error in ${e.path}${e.line ? `:${e.line}` : ''}`
        : 'Parse error',
      details: e.message,
      suggestions: ['Check the file syntax'] as const,
      exitCode: EXIT_CODE.USER_ERROR,
    })),

    // API key errors
    Match.tag('ApiKeyMissingError', (e) => ({
      code: e.code,
      message: `${e.envVar} not set`,
      suggestions: [
        `export ${e.envVar}=your-api-key`,
        'Or add to .env file in project root',
      ] as const,
      exitCode: EXIT_CODE.API_ERROR,
    })),
    Match.tag('ApiKeyInvalidError', (e) => ({
      code: e.code,
      message: `Invalid API key for ${e.provider}`,
      details: e.details,
      suggestions: [
        'Check that your API key is correct',
        'Verify your API key has not expired',
        'Check your API account status',
      ] as const,
      exitCode: EXIT_CODE.API_ERROR,
    })),

    // Embedding errors - enhanced with provider-specific detection
    Match.tag('EmbeddingError', (e) => {
      // Try to detect provider-specific error for better messaging
      const provider = (e.provider ?? 'openai') as EmbeddingProvider
      const providerError = detectProviderError(provider, e.cause)

      if (providerError) {
        // Use provider-specific error formatting
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

      // Fall back to reason-based handling
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
          // Check for provider-specific network errors
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
    }),

    // Index errors
    Match.tag('IndexNotFoundError', (e) => ({
      code: e.code,
      message: 'Index not found',
      details: `No index at ${e.path}`,
      suggestions: ["Run 'mdcontext index' first to build the index"] as const,
      exitCode: EXIT_CODE.USER_ERROR,
    })),
    Match.tag('IndexCorruptedError', (e) => ({
      code: e.code,
      message: 'Index is corrupted',
      details: e.details ?? `Corruption reason: ${e.reason}`,
      suggestions: [
        "Delete the .mdcontext folder and run 'mdcontext index' again",
      ] as const,
      exitCode: EXIT_CODE.USER_ERROR,
    })),
    Match.tag('IndexBuildError', (e) => ({
      code: e.code,
      message: `Failed to build index for: ${e.path}`,
      details: e.message,
      suggestions: ['Check the file is valid markdown'] as const,
      exitCode: EXIT_CODE.USER_ERROR,
    })),

    // Search errors
    Match.tag('DocumentNotFoundError', (e) => ({
      code: e.code,
      message: `Document not found in index: ${e.path}`,
      suggestions: [
        "Run 'mdcontext index' to update the index",
        'Check the file path is correct',
      ] as const,
      exitCode: EXIT_CODE.USER_ERROR,
    })),
    Match.tag('EmbeddingsNotFoundError', (e) => ({
      code: e.code,
      message: 'Embeddings not found',
      details: `No embeddings at ${e.path}`,
      suggestions: [
        "Run 'mdcontext index --embed' to build embeddings for semantic search",
        'Use -k flag for keyword search instead',
      ] as const,
      exitCode: EXIT_CODE.USER_ERROR,
    })),

    // Dimension mismatch errors
    Match.tag('DimensionMismatchError', (e) => ({
      code: e.code,
      message: 'Embedding dimension mismatch',
      details: e.message,
      suggestions: [
        e.corpusProvider
          ? `Switch back to original provider: --provider ${e.corpusProvider.split(':')[0]} --provider-model ${e.corpusProvider.split(':')[1] ?? ''}`
          : 'Check your embedding provider configuration',
        "Rebuild corpus with current provider: 'mdcontext index --embed --force'",
        'The corpus was created with different embedding dimensions than your current provider',
      ] as const,
      exitCode: EXIT_CODE.USER_ERROR,
    })),

    // Vector store errors
    Match.tag('VectorStoreError', (e) => ({
      code: e.code,
      message: `Vector store error during ${e.operation}`,
      details: e.message,
      suggestions: [
        "Delete .mdcontext/embeddings and run 'mdcontext index --embed' again",
      ] as const,
      exitCode: EXIT_CODE.SYSTEM_ERROR,
    })),

    // Config errors
    Match.tag('ConfigError', (e) => formatConfigError(e)),

    // Watch errors
    Match.tag('WatchError', (e) => ({
      code: e.code,
      message: `File watcher error: ${e.path}`,
      details: e.message,
      suggestions: [
        'Check directory permissions',
        'Check disk space',
        'Try restarting the watch command',
      ] as const,
      exitCode: EXIT_CODE.SYSTEM_ERROR,
    })),

    // CLI validation errors
    Match.tag('CliValidationError', (e) => ({
      code: e.code,
      message: e.message,
      details:
        e.argument && e.expected
          ? `Expected ${e.expected}${e.received ? `, got ${e.received}` : ''}`
          : undefined,
      suggestions: ["Run 'mdcontext --help' for usage information"] as const,
      exitCode: EXIT_CODE.USER_ERROR,
    })),

    Match.exhaustive,
  )

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

/**
 * Sensitive field patterns that should be redacted from debug output.
 * Matches keys containing these substrings (case-insensitive).
 */
const SENSITIVE_KEY_PATTERN =
  /api[_-]?key|authorization|token|secret|password|credential/i

/**
 * JSON.stringify replacer that redacts sensitive fields from error objects.
 * Prevents API keys from leaking when the error cause chain contains HTTP
 * request context (e.g. from the OpenAI SDK).
 */
const sensitiveFieldReplacer = (_key: string, value: unknown): unknown => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sanitized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      sanitized[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : v
    }
    return sanitized
  }
  return value
}

/**
 * Display error with debug information (stack trace, full context)
 */
export const displayErrorDebug = (
  error: MdContextError,
  formatted: FormattedError,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    yield* displayError(formatted)

    yield* Console.error('--- Debug Info ---')
    yield* Console.error(`Code: ${formatted.code}`)
    yield* Console.error(`Tag: ${error._tag}`)
    yield* Console.error(
      `Error: ${JSON.stringify(error, sensitiveFieldReplacer, 2)}`,
    )

    // Show cause/stack if available
    if ('cause' in error && error.cause) {
      yield* Console.error(`Cause: ${String(error.cause)}`)
      if (error.cause instanceof Error && error.cause.stack) {
        yield* Console.error(`Stack: ${error.cause.stack}`)
      }
    }
  })

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle a typed error: format, display, and return appropriate exit code.
 */
export const handleError = (
  error: MdContextError,
  options: { debug?: boolean } = {},
): Effect.Effect<never, never, never> =>
  Effect.gen(function* () {
    const formatted = formatError(error)

    if (options.debug) {
      yield* displayErrorDebug(error, formatted)
    } else {
      yield* displayError(formatted)
    }

    return yield* Effect.fail(formatted.exitCode as never)
  })

/**
 * Create an error handler that can be piped into an Effect.
 * Handles all MdContextError types with proper formatting and exit codes.
 *
 * Usage:
 * ```typescript
 * program.pipe(
 *   Effect.catchTags(createErrorHandler())
 * )
 * ```
 */
export const createErrorHandler = (options: { debug?: boolean } = {}) => ({
  FileReadError: (e: FileReadError) => handleError(e, options),
  FileWriteError: (e: FileWriteError) => handleError(e, options),
  DirectoryCreateError: (e: DirectoryCreateError) => handleError(e, options),
  DirectoryWalkError: (e: DirectoryWalkError) => handleError(e, options),
  ParseError: (e: ParseError) => handleError(e, options),
  ApiKeyMissingError: (e: ApiKeyMissingError) => handleError(e, options),
  ApiKeyInvalidError: (e: ApiKeyInvalidError) => handleError(e, options),
  EmbeddingError: (e: EmbeddingError) => handleError(e, options),
  IndexNotFoundError: (e: IndexNotFoundError) => handleError(e, options),
  IndexCorruptedError: (e: IndexCorruptedError) => handleError(e, options),
  IndexBuildError: (e: IndexBuildError) => handleError(e, options),
  DocumentNotFoundError: (e: DocumentNotFoundError) => handleError(e, options),
  EmbeddingsNotFoundError: (e: EmbeddingsNotFoundError) =>
    handleError(e, options),
  VectorStoreError: (e: VectorStoreError) => handleError(e, options),
  WatchError: (e: WatchError) => handleError(e, options),
  ConfigError: (e: ConfigError) => handleError(e, options),
  CliValidationError: (e: CliValidationError) => handleError(e, options),
})

// ============================================================================
// Legacy Error Handling (for transition period)
// ============================================================================

/**
 * Check if an error is an Effect CLI validation error.
 * Used during transition to catch @effect/cli errors.
 */
export const isEffectCliValidationError = (error: unknown): boolean => {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>
    return (
      err._tag === 'ValidationError' ||
      err._tag === 'MissingValue' ||
      err._tag === 'InvalidValue' ||
      err._tag === 'CommandDirective'
    )
  }
  return false
}

/**
 * Extract the error message from an Effect CLI error structure.
 */
const extractEffectCliMessage = (error: unknown): string | null => {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>
    if (err._tag === 'Paragraph' && err.value) {
      const paragraph = err.value as Record<string, unknown>
      if (paragraph._tag === 'Text' && typeof paragraph.value === 'string') {
        return paragraph.value
      }
    }
  }
  return null
}

/**
 * Extract user's invalid input from CLI arguments.
 * Looks for --mode value in process.argv.
 */
const extractModeValue = (): string | null => {
  const args = process.argv
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--mode' || arg === '-m') {
      return args[i + 1] ?? null
    }
    if (arg?.startsWith('--mode=')) {
      return arg.slice('--mode='.length) || null
    }
  }
  return null
}

/**
 * Suggest a correction for mode flag using Levenshtein distance.
 */
const suggestModeCorrection = (invalidMode: string): string | null => {
  const validModes = ['hybrid', 'semantic', 'keyword']

  const levenshtein = (a: string, b: string): number => {
    const matrix: number[][] = []
    for (let i = 0; i <= a.length; i++) matrix[i] = [i]
    for (let j = 0; j <= b.length; j++) matrix[0]![j] = j

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j - 1]! + cost,
        )
      }
    }
    return matrix[a.length]![b.length]!
  }

  let bestMatch: string | null = null
  let bestDistance = Infinity
  const maxDistance = 2

  for (const mode of validModes) {
    const distance = levenshtein(invalidMode.toLowerCase(), mode)
    if (distance <= maxDistance && distance < bestDistance) {
      bestDistance = distance
      bestMatch = mode
    }
  }

  return bestMatch
}

/**
 * Check if error is a mode validation error and enhance message with suggestion.
 */
const enhanceModeError = (baseMessage: string): string => {
  const modeValue = extractModeValue()
  if (!modeValue) return baseMessage

  const suggestion = suggestModeCorrection(modeValue)
  if (!suggestion) return baseMessage

  return `${baseMessage}\n\nDid you mean '--mode ${suggestion}'?`
}

/**
 * Format an Effect CLI validation error for display.
 */
export const formatEffectCliError = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>

    if (
      (err._tag === 'ValidationError' ||
        err._tag === 'MissingValue' ||
        err._tag === 'InvalidValue') &&
      err.error
    ) {
      const message = extractEffectCliMessage(err.error)
      if (message) {
        return enhanceModeError(message)
      }
    }
  }
  return String(error)
}
