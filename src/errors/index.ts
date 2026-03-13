/**
 * Centralized error types for mdcontext
 *
 * This module defines all domain errors using Effect's Data.TaggedError pattern.
 * Each error has a unique `_tag` discriminant that enables:
 * - Exhaustive error handling with `catchTag` / `catchTags`
 * - Type-safe error composition in Effect pipelines
 * - Pattern matching for user-friendly error messages at CLI boundary
 *
 * ## Error Message Convention
 *
 * The `message` field in errors should contain **technical details** from the
 * underlying operation, NOT user-facing formatted messages.
 *
 * **Good (technical):**
 * ```typescript
 * new FileReadError({
 *   path: '/path/to/file',
 *   message: e.message,  // e.g., "ENOENT: no such file or directory"
 *   cause: e,
 * })
 * ```
 *
 * **Bad (user-facing):**
 * ```typescript
 * new FileReadError({
 *   path: '/path/to/file',
 *   message: 'Cannot read file. Please check permissions.',  // NO!
 * })
 * ```
 *
 * User-friendly messages are generated at the CLI boundary by the error handler
 * in `src/cli/error-handler.ts`. This separation enables:
 * - i18n/localization in the future
 * - Testing error data without string matching
 * - Consistent formatting in one place
 *
 * ## Error Taxonomy
 *
 * - File System: FileReadError, FileWriteError, DirectoryCreateError, DirectoryWalkError
 * - Parsing: ParseError (for markdown parsing failures)
 * - API: ApiKeyMissingError, ApiKeyInvalidError
 * - Embeddings: EmbeddingError (rate limits, quota, network failures)
 * - Index: IndexNotFoundError, IndexCorruptedError, IndexBuildError
 * - Search: DocumentNotFoundError, EmbeddingsNotFoundError
 * - Vector Store: VectorStoreError
 * - Config: ConfigError
 * - CLI: CliValidationError
 *
 * ## Usage
 *
 * ```typescript
 * import { FileReadError, ApiKeyMissingError } from './errors/index.js'
 * import { Effect } from 'effect'
 *
 * const program = Effect.gen(function* () {
 *   // ... operations that may fail
 * }).pipe(
 *   Effect.catchTag('FileReadError', (e) => ...),
 *   Effect.catchTag('ApiKeyMissingError', (e) => ...)
 * )
 * ```
 */

import { Data } from 'effect'
import type { SummarizationError } from '../summarization/types.js'

// ============================================================================
// Error Codes
// ============================================================================

/**
 * Standardized error codes for programmatic handling.
 *
 * Error codes enable:
 * - Scripting and automation (check error codes in CI/CD)
 * - Machine-readable error handling without parsing messages
 * - Stable identifiers that don't change when messages are updated
 *
 * Naming convention: E{category}{number}
 * - E1xx: File system errors
 * - E2xx: Parse errors
 * - E3xx: API/authentication errors
 * - E4xx: Index errors
 * - E5xx: Search errors
 * - E6xx: Vector store errors
 * - E7xx: Config errors
 * - E8xx: Watch errors
 * - E9xx: CLI errors
 */
export const ErrorCode = {
  // File system errors (E1xx)
  FILE_READ: 'E100',
  FILE_WRITE: 'E101',
  DIRECTORY_CREATE: 'E102',
  DIRECTORY_WALK: 'E103',

  // Parse errors (E2xx)
  PARSE: 'E200',

  // API/authentication errors (E3xx)
  API_KEY_MISSING: 'E300',
  API_KEY_INVALID: 'E301',
  EMBEDDING_RATE_LIMIT: 'E310',
  EMBEDDING_QUOTA: 'E311',
  EMBEDDING_NETWORK: 'E312',
  EMBEDDING_MODEL: 'E313',
  EMBEDDING_UNKNOWN: 'E319',

  // Index errors (E4xx)
  INDEX_NOT_FOUND: 'E400',
  INDEX_CORRUPTED: 'E401',
  INDEX_BUILD: 'E402',

  // Search errors (E5xx)
  DOCUMENT_NOT_FOUND: 'E500',
  EMBEDDINGS_NOT_FOUND: 'E501',

  // Vector store errors (E6xx)
  VECTOR_STORE: 'E600',
  DIMENSION_MISMATCH: 'E601',

  // Config errors (E7xx)
  CONFIG: 'E700',

  // Watch errors (E8xx)
  WATCH: 'E800',

  // CLI errors (E9xx)
  CLI_VALIDATION: 'E900',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

// ============================================================================
// File System Errors
// ============================================================================

/**
 * Error reading a file from the filesystem
 */
export class FileReadError extends Data.TaggedError('FileReadError')<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {
  get code(): typeof ErrorCode.FILE_READ {
    return ErrorCode.FILE_READ
  }
}

/**
 * Error writing a file to the filesystem
 */
export class FileWriteError extends Data.TaggedError('FileWriteError')<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {
  get code(): typeof ErrorCode.FILE_WRITE {
    return ErrorCode.FILE_WRITE
  }
}

/**
 * Error creating a directory
 */
export class DirectoryCreateError extends Data.TaggedError(
  'DirectoryCreateError',
)<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {
  get code(): typeof ErrorCode.DIRECTORY_CREATE {
    return ErrorCode.DIRECTORY_CREATE
  }
}

/**
 * Error walking/traversing a directory tree
 */
export class DirectoryWalkError extends Data.TaggedError('DirectoryWalkError')<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {
  get code(): typeof ErrorCode.DIRECTORY_WALK {
    return ErrorCode.DIRECTORY_WALK
  }
}

// ============================================================================
// Parse Errors
// ============================================================================

/**
 * Error parsing a markdown document
 */
export class ParseError extends Data.TaggedError('ParseError')<{
  readonly message: string
  readonly path?: string
  readonly line?: number
  readonly column?: number
  readonly cause?: unknown
}> {
  get code(): typeof ErrorCode.PARSE {
    return ErrorCode.PARSE
  }
}

// ============================================================================
// API Key Errors
// ============================================================================

/**
 * API key is not set in environment
 */
export class ApiKeyMissingError extends Data.TaggedError('ApiKeyMissingError')<{
  readonly provider: string
  readonly envVar: string
}> {
  get code(): typeof ErrorCode.API_KEY_MISSING {
    return ErrorCode.API_KEY_MISSING
  }
  get message(): string {
    return `${this.envVar} not set`
  }
}

/**
 * API key was rejected by the provider
 */
export class ApiKeyInvalidError extends Data.TaggedError('ApiKeyInvalidError')<{
  readonly provider: string
  readonly details?: string
}> {
  get code(): typeof ErrorCode.API_KEY_INVALID {
    return ErrorCode.API_KEY_INVALID
  }
  get message(): string {
    return this.details ?? `Invalid API key for ${this.provider}`
  }
}

// ============================================================================
// Embedding Errors
// ============================================================================

/**
 * Embedding operation failure causes
 */
export type EmbeddingErrorCause =
  | 'RateLimit'
  | 'QuotaExceeded'
  | 'Network'
  | 'ModelError'
  | 'Unknown'

/**
 * Error generating embeddings
 */
export class EmbeddingError extends Data.TaggedError('EmbeddingError')<{
  readonly reason: EmbeddingErrorCause
  readonly message: string
  readonly provider?: string
  readonly cause?: unknown
}> {
  get code(): ErrorCodeValue {
    switch (this.reason) {
      case 'RateLimit':
        return ErrorCode.EMBEDDING_RATE_LIMIT
      case 'QuotaExceeded':
        return ErrorCode.EMBEDDING_QUOTA
      case 'Network':
        return ErrorCode.EMBEDDING_NETWORK
      case 'ModelError':
        return ErrorCode.EMBEDDING_MODEL
      default:
        // 'Unknown' and any future unknown reasons
        return ErrorCode.EMBEDDING_UNKNOWN
    }
  }
}

// ============================================================================
// Index Errors
// ============================================================================

/**
 * Index does not exist at the expected location
 */
export class IndexNotFoundError extends Data.TaggedError('IndexNotFoundError')<{
  readonly path: string
}> {
  get code(): typeof ErrorCode.INDEX_NOT_FOUND {
    return ErrorCode.INDEX_NOT_FOUND
  }
  get message(): string {
    return `Index not found at ${this.path}`
  }
}

/**
 * Index exists but is corrupted or invalid
 */
export class IndexCorruptedError extends Data.TaggedError(
  'IndexCorruptedError',
)<{
  readonly path: string
  readonly reason: 'InvalidJson' | 'VersionMismatch' | 'MissingData' | 'Unknown'
  readonly details?: string
}> {
  get code(): typeof ErrorCode.INDEX_CORRUPTED {
    return ErrorCode.INDEX_CORRUPTED
  }
  get message(): string {
    return `Index corrupted at ${this.path}: ${this.reason}`
  }
}

/**
 * Error building/updating the index
 */
export class IndexBuildError extends Data.TaggedError('IndexBuildError')<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {
  get code(): typeof ErrorCode.INDEX_BUILD {
    return ErrorCode.INDEX_BUILD
  }
}

// ============================================================================
// Search Errors
// ============================================================================

/**
 * Document not found in the index
 */
export class DocumentNotFoundError extends Data.TaggedError(
  'DocumentNotFoundError',
)<{
  readonly path: string
  readonly indexPath?: string
}> {
  get code(): typeof ErrorCode.DOCUMENT_NOT_FOUND {
    return ErrorCode.DOCUMENT_NOT_FOUND
  }
  get message(): string {
    return `Document not found in index: ${this.path}`
  }
}

// ============================================================================
// Config Errors
// ============================================================================

/**
 * Configuration error with rich context for user-friendly formatting.
 *
 * Fields:
 * - `field`: The config field name (e.g., "index.maxDepth")
 * - `message`: Technical error message
 * - `sourceFile`: Path to the config file where the error occurred
 * - `expectedType`: Expected type (e.g., "number", "boolean")
 * - `actualValue`: The actual invalid value
 * - `validValues`: List of valid values for enum-like fields
 */
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly field?: string
  readonly message: string
  readonly cause?: unknown
  readonly sourceFile?: string
  readonly expectedType?: string
  readonly actualValue?: unknown
  readonly validValues?: readonly string[]
}> {
  get code(): typeof ErrorCode.CONFIG {
    return ErrorCode.CONFIG
  }
}

// ============================================================================
// Vector Store Errors
// ============================================================================

/**
 * Error with vector store operations (HNSW index)
 */
export class VectorStoreError extends Data.TaggedError('VectorStoreError')<{
  readonly operation:
    | 'init'
    | 'add'
    | 'search'
    | 'save'
    | 'load'
    | 'removeEntries'
  readonly message: string
  readonly cause?: unknown
}> {
  get code(): typeof ErrorCode.VECTOR_STORE {
    return ErrorCode.VECTOR_STORE
  }
}

/**
 * Embeddings not found for semantic search
 */
export class EmbeddingsNotFoundError extends Data.TaggedError(
  'EmbeddingsNotFoundError',
)<{
  readonly path: string
}> {
  get code(): typeof ErrorCode.EMBEDDINGS_NOT_FOUND {
    return ErrorCode.EMBEDDINGS_NOT_FOUND
  }
  get message(): string {
    return `Embeddings not found at ${this.path}. Run 'mdcontext index --embed' first.`
  }
}

/**
 * Embedding dimension mismatch between corpus and current provider.
 *
 * This happens when trying to search a corpus that was created with a different
 * embedding configuration (different dimensions or provider).
 */
export class DimensionMismatchError extends Data.TaggedError(
  'DimensionMismatchError',
)<{
  /** Dimensions stored in the corpus */
  readonly corpusDimensions: number
  /** Dimensions expected by the current provider */
  readonly providerDimensions: number
  /** Provider that created the corpus (e.g., "openai:text-embedding-3-small") */
  readonly corpusProvider?: string
  /** Current provider being used */
  readonly currentProvider?: string
  /** Path to the corpus */
  readonly path: string
}> {
  get code(): typeof ErrorCode.DIMENSION_MISMATCH {
    return ErrorCode.DIMENSION_MISMATCH
  }
  get message(): string {
    const corpusInfo = this.corpusProvider
      ? `${this.corpusDimensions} (${this.corpusProvider})`
      : `${this.corpusDimensions}`
    const currentInfo = this.currentProvider
      ? `${this.providerDimensions} (${this.currentProvider})`
      : `${this.providerDimensions}`
    return `Embedding dimension mismatch: corpus has ${corpusInfo}, current provider expects ${currentInfo}`
  }
}

// ============================================================================
// Watch Errors
// ============================================================================

/**
 * File watcher error
 */
export class WatchError extends Data.TaggedError('WatchError')<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {
  get code(): typeof ErrorCode.WATCH {
    return ErrorCode.WATCH
  }
}

// ============================================================================
// CLI Errors
// ============================================================================

/**
 * CLI validation error (invalid arguments, missing options, etc.)
 */
export class CliValidationError extends Data.TaggedError('CliValidationError')<{
  readonly message: string
  readonly argument?: string
  readonly expected?: string
  readonly received?: string
}> {
  get code(): typeof ErrorCode.CLI_VALIDATION {
    return ErrorCode.CLI_VALIDATION
  }
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * All file system related errors
 */
export type FileSystemError =
  | FileReadError
  | FileWriteError
  | DirectoryCreateError
  | DirectoryWalkError

/**
 * All API-related errors
 */
export type ApiError = ApiKeyMissingError | ApiKeyInvalidError | EmbeddingError

/**
 * All index-related errors
 */
export type IndexError =
  | IndexNotFoundError
  | IndexCorruptedError
  | IndexBuildError

/**
 * All search-related errors
 */
export type SearchError =
  | DocumentNotFoundError
  | EmbeddingsNotFoundError
  | DimensionMismatchError

/**
 * Union of all mdcontext errors
 * Use this for exhaustive error handling at the CLI boundary
 */
export type MdContextError =
  | FileSystemError
  | ParseError
  | ApiError
  | IndexError
  | SearchError
  | VectorStoreError
  | ConfigError
  | WatchError
  | CliValidationError
  | SummarizationError

// Re-export SummarizationError for centralized error handling
export { SummarizationError } from '../summarization/types.js'
