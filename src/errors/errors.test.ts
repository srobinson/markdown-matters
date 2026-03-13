/**
 * Unit tests for error types
 *
 * Tests verify:
 * - Error construction with correct _tag
 * - Error code getter returns correct codes
 * - Error data access (fields)
 * - Cause chain preservation
 * - catchTag matching by _tag
 * - Dynamic message generation
 */

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { EXIT_CODE, formatError } from '../cli/error-handler.js'
import {
  ApiKeyInvalidError,
  ApiKeyMissingError,
  CliValidationError,
  ConfigError,
  DirectoryCreateError,
  DirectoryWalkError,
  DocumentNotFoundError,
  EmbeddingError,
  EmbeddingsNotFoundError,
  ErrorCode,
  FileReadError,
  FileWriteError,
  IndexBuildError,
  IndexCorruptedError,
  IndexNotFoundError,
  ParseError,
  VectorStoreError,
  WatchError,
} from './index.js'

describe('Error Types', () => {
  // ==========================================================================
  // File System Errors
  // ==========================================================================

  describe('FileReadError', () => {
    it('has correct _tag for catchTag', () => {
      const error = new FileReadError({
        path: '/test/file.md',
        message: 'ENOENT: no such file or directory',
      })
      expect(error._tag).toBe('FileReadError')
    })

    it('has correct error code', () => {
      const error = new FileReadError({
        path: '/test/file.md',
        message: 'ENOENT',
      })
      expect(error.code).toBe(ErrorCode.FILE_READ)
      expect(error.code).toBe('E100')
    })

    it('preserves error data fields', () => {
      const error = new FileReadError({
        path: '/test/file.md',
        message: 'Permission denied',
      })
      expect(error.path).toBe('/test/file.md')
      expect(error.message).toBe('Permission denied')
    })

    it('preserves cause chain', () => {
      const cause = new Error('underlying error')
      const error = new FileReadError({
        path: '/test/file.md',
        message: 'ENOENT',
        cause,
      })
      expect(error.cause).toBe(cause)
    })

    it('can be caught with catchTag', async () => {
      const effect = Effect.fail(
        new FileReadError({ path: '/test.md', message: 'error' }),
      )
      const result = await Effect.runPromise(
        effect.pipe(
          Effect.catchTag('FileReadError', (e) => Effect.succeed(e.path)),
        ),
      )
      expect(result).toBe('/test.md')
    })
  })

  describe('FileWriteError', () => {
    it('has correct _tag and error code', () => {
      const error = new FileWriteError({
        path: '/test/output.md',
        message: 'EACCES',
      })
      expect(error._tag).toBe('FileWriteError')
      expect(error.code).toBe(ErrorCode.FILE_WRITE)
      expect(error.code).toBe('E101')
    })

    it('can be caught with catchTag', async () => {
      const effect = Effect.fail(
        new FileWriteError({ path: '/out.md', message: 'err' }),
      )
      const result = await Effect.runPromise(
        effect.pipe(
          Effect.catchTag('FileWriteError', (e) => Effect.succeed(e.path)),
        ),
      )
      expect(result).toBe('/out.md')
    })
  })

  describe('DirectoryCreateError', () => {
    it('has correct _tag and error code', () => {
      const error = new DirectoryCreateError({
        path: '/test/dir',
        message: 'EEXIST',
      })
      expect(error._tag).toBe('DirectoryCreateError')
      expect(error.code).toBe(ErrorCode.DIRECTORY_CREATE)
      expect(error.code).toBe('E102')
    })
  })

  describe('DirectoryWalkError', () => {
    it('has correct _tag and error code', () => {
      const error = new DirectoryWalkError({
        path: '/test/dir',
        message: 'EACCES',
      })
      expect(error._tag).toBe('DirectoryWalkError')
      expect(error.code).toBe(ErrorCode.DIRECTORY_WALK)
      expect(error.code).toBe('E103')
    })
  })

  // ==========================================================================
  // Parse Errors
  // ==========================================================================

  describe('ParseError', () => {
    it('has correct _tag and error code', () => {
      const error = new ParseError({ message: 'Invalid syntax' })
      expect(error._tag).toBe('ParseError')
      expect(error.code).toBe(ErrorCode.PARSE)
      expect(error.code).toBe('E200')
    })

    it('supports optional location fields', () => {
      const error = new ParseError({
        message: 'Unexpected token',
        path: '/doc.md',
        line: 10,
        column: 5,
      })
      expect(error.path).toBe('/doc.md')
      expect(error.line).toBe(10)
      expect(error.column).toBe(5)
    })

    it('handles missing optional fields', () => {
      const error = new ParseError({ message: 'error' })
      expect(error.path).toBeUndefined()
      expect(error.line).toBeUndefined()
      expect(error.column).toBeUndefined()
    })
  })

  // ==========================================================================
  // API Key Errors
  // ==========================================================================

  describe('ApiKeyMissingError', () => {
    it('has correct _tag and error code', () => {
      const error = new ApiKeyMissingError({
        provider: 'openai',
        envVar: 'OPENAI_API_KEY',
      })
      expect(error._tag).toBe('ApiKeyMissingError')
      expect(error.code).toBe(ErrorCode.API_KEY_MISSING)
      expect(error.code).toBe('E300')
    })

    it('generates dynamic message', () => {
      const error = new ApiKeyMissingError({
        provider: 'openai',
        envVar: 'OPENAI_API_KEY',
      })
      expect(error.message).toBe('OPENAI_API_KEY not set')
    })

    it('can be caught with catchTag', async () => {
      const effect = Effect.fail(
        new ApiKeyMissingError({
          provider: 'openai',
          envVar: 'OPENAI_API_KEY',
        }),
      )
      const result = await Effect.runPromise(
        effect.pipe(
          Effect.catchTag('ApiKeyMissingError', (e) =>
            Effect.succeed(e.provider),
          ),
        ),
      )
      expect(result).toBe('openai')
    })
  })

  describe('ApiKeyInvalidError', () => {
    it('has correct _tag and error code', () => {
      const error = new ApiKeyInvalidError({ provider: 'openai' })
      expect(error._tag).toBe('ApiKeyInvalidError')
      expect(error.code).toBe(ErrorCode.API_KEY_INVALID)
      expect(error.code).toBe('E301')
    })

    it('generates dynamic message without details', () => {
      const error = new ApiKeyInvalidError({ provider: 'openai' })
      expect(error.message).toBe('Invalid API key for openai')
    })

    it('uses details when provided', () => {
      const error = new ApiKeyInvalidError({
        provider: 'openai',
        details: 'API key expired',
      })
      expect(error.message).toBe('API key expired')
    })
  })

  // ==========================================================================
  // Embedding Errors
  // ==========================================================================

  describe('EmbeddingError', () => {
    it('has correct _tag', () => {
      const error = new EmbeddingError({
        reason: 'RateLimit',
        message: 'Rate limit hit',
      })
      expect(error._tag).toBe('EmbeddingError')
    })

    it('returns correct code for RateLimit', () => {
      const error = new EmbeddingError({
        reason: 'RateLimit',
        message: 'Rate limit hit',
      })
      expect(error.code).toBe(ErrorCode.EMBEDDING_RATE_LIMIT)
      expect(error.code).toBe('E310')
    })

    it('returns correct code for QuotaExceeded', () => {
      const error = new EmbeddingError({
        reason: 'QuotaExceeded',
        message: 'Quota exceeded',
      })
      expect(error.code).toBe(ErrorCode.EMBEDDING_QUOTA)
      expect(error.code).toBe('E311')
    })

    it('returns correct code for Network', () => {
      const error = new EmbeddingError({
        reason: 'Network',
        message: 'Connection failed',
      })
      expect(error.code).toBe(ErrorCode.EMBEDDING_NETWORK)
      expect(error.code).toBe('E312')
    })

    it('returns correct code for ModelError', () => {
      const error = new EmbeddingError({
        reason: 'ModelError',
        message: 'Model unavailable',
      })
      expect(error.code).toBe(ErrorCode.EMBEDDING_MODEL)
      expect(error.code).toBe('E313')
    })

    it('returns correct code for Unknown', () => {
      const error = new EmbeddingError({
        reason: 'Unknown',
        message: 'Something went wrong',
      })
      expect(error.code).toBe(ErrorCode.EMBEDDING_UNKNOWN)
      expect(error.code).toBe('E319')
    })

    it('preserves optional provider field', () => {
      const error = new EmbeddingError({
        reason: 'RateLimit',
        message: 'error',
        provider: 'openai',
      })
      expect(error.provider).toBe('openai')
    })

    it('can be caught with catchTag', async () => {
      const effect = Effect.fail(
        new EmbeddingError({ reason: 'Network', message: 'timeout' }),
      )
      const result = await Effect.runPromise(
        effect.pipe(
          Effect.catchTag('EmbeddingError', (e) => Effect.succeed(e.reason)),
        ),
      )
      expect(result).toBe('Network')
    })
  })

  // ==========================================================================
  // Index Errors
  // ==========================================================================

  describe('IndexNotFoundError', () => {
    it('has correct _tag and error code', () => {
      const error = new IndexNotFoundError({ path: '/.mdm/index.json' })
      expect(error._tag).toBe('IndexNotFoundError')
      expect(error.code).toBe(ErrorCode.INDEX_NOT_FOUND)
      expect(error.code).toBe('E400')
    })

    it('generates dynamic message', () => {
      const error = new IndexNotFoundError({ path: '/.mdm/index.json' })
      expect(error.message).toBe('Index not found at /.mdm/index.json')
    })
  })

  describe('IndexCorruptedError', () => {
    it('has correct _tag and error code', () => {
      const error = new IndexCorruptedError({
        path: '/.mdm/index.json',
        reason: 'InvalidJson',
      })
      expect(error._tag).toBe('IndexCorruptedError')
      expect(error.code).toBe(ErrorCode.INDEX_CORRUPTED)
      expect(error.code).toBe('E401')
    })

    it('generates dynamic message with reason', () => {
      const error = new IndexCorruptedError({
        path: '/index.json',
        reason: 'VersionMismatch',
      })
      expect(error.message).toBe(
        'Index corrupted at /index.json: VersionMismatch',
      )
    })

    it('supports optional details field', () => {
      const error = new IndexCorruptedError({
        path: '/index.json',
        reason: 'MissingData',
        details: 'documents array is missing',
      })
      expect(error.details).toBe('documents array is missing')
    })
  })

  describe('IndexBuildError', () => {
    it('has correct _tag and error code', () => {
      const error = new IndexBuildError({
        path: '/docs',
        message: 'Build failed',
      })
      expect(error._tag).toBe('IndexBuildError')
      expect(error.code).toBe(ErrorCode.INDEX_BUILD)
      expect(error.code).toBe('E402')
    })
  })

  // ==========================================================================
  // Search Errors
  // ==========================================================================

  describe('DocumentNotFoundError', () => {
    it('has correct _tag and error code', () => {
      const error = new DocumentNotFoundError({ path: '/doc.md' })
      expect(error._tag).toBe('DocumentNotFoundError')
      expect(error.code).toBe(ErrorCode.DOCUMENT_NOT_FOUND)
      expect(error.code).toBe('E500')
    })

    it('generates dynamic message', () => {
      const error = new DocumentNotFoundError({ path: '/missing.md' })
      expect(error.message).toBe('Document not found in index: /missing.md')
    })

    it('supports optional indexPath field', () => {
      const error = new DocumentNotFoundError({
        path: '/doc.md',
        indexPath: '/.mdm/index.json',
      })
      expect(error.indexPath).toBe('/.mdm/index.json')
    })
  })

  describe('EmbeddingsNotFoundError', () => {
    it('has correct _tag and error code', () => {
      const error = new EmbeddingsNotFoundError({
        path: '/.mdm/embeddings',
      })
      expect(error._tag).toBe('EmbeddingsNotFoundError')
      expect(error.code).toBe(ErrorCode.EMBEDDINGS_NOT_FOUND)
      expect(error.code).toBe('E501')
    })

    it('generates dynamic message with instructions', () => {
      const error = new EmbeddingsNotFoundError({ path: '/embeddings' })
      expect(error.message).toBe(
        "Embeddings not found at /embeddings. Run 'mdcontext index --embed' first.",
      )
    })
  })

  // ==========================================================================
  // Vector Store Errors
  // ==========================================================================

  describe('VectorStoreError', () => {
    it('has correct _tag and error code', () => {
      const error = new VectorStoreError({
        operation: 'init',
        message: 'Failed to initialize',
      })
      expect(error._tag).toBe('VectorStoreError')
      expect(error.code).toBe(ErrorCode.VECTOR_STORE)
      expect(error.code).toBe('E600')
    })

    it('preserves operation field', () => {
      const operations = ['init', 'add', 'search', 'save', 'load'] as const
      for (const op of operations) {
        const error = new VectorStoreError({ operation: op, message: 'error' })
        expect(error.operation).toBe(op)
      }
    })
  })

  // ==========================================================================
  // Config Errors
  // ==========================================================================

  describe('ConfigError', () => {
    it('has correct _tag and error code', () => {
      const error = new ConfigError({ message: 'Invalid config' })
      expect(error._tag).toBe('ConfigError')
      expect(error.code).toBe(ErrorCode.CONFIG)
      expect(error.code).toBe('E700')
    })

    it('supports optional field', () => {
      const error = new ConfigError({
        field: 'embeddingProvider',
        message: 'Invalid provider',
      })
      expect(error.field).toBe('embeddingProvider')
    })

    it('handles missing field', () => {
      const error = new ConfigError({ message: 'error' })
      expect(error.field).toBeUndefined()
    })

    it('supports sourceFile field', () => {
      const error = new ConfigError({
        message: 'Invalid value',
        field: 'index.maxDepth',
        sourceFile: '/path/to/mdcontext.config.json',
      })
      expect(error.sourceFile).toBe('/path/to/mdcontext.config.json')
    })

    it('supports expectedType field', () => {
      const error = new ConfigError({
        message: 'Invalid type',
        field: 'index.maxDepth',
        expectedType: 'number',
      })
      expect(error.expectedType).toBe('number')
    })

    it('supports actualValue field with string value', () => {
      const error = new ConfigError({
        message: 'Invalid value',
        field: 'index.maxDepth',
        actualValue: 'ten',
      })
      expect(error.actualValue).toBe('ten')
    })

    it('supports actualValue field with number value', () => {
      const error = new ConfigError({
        message: 'Invalid value',
        field: 'index.maxDepth',
        actualValue: -5,
      })
      expect(error.actualValue).toBe(-5)
    })

    it('supports validValues field', () => {
      const error = new ConfigError({
        message: 'Invalid provider',
        field: 'embeddingProvider',
        validValues: ['openai', 'cohere', 'local'],
      })
      expect(error.validValues).toEqual(['openai', 'cohere', 'local'])
    })

    it('supports all enhanced fields together', () => {
      const error = new ConfigError({
        field: 'index.maxDepth',
        message: 'Value must be a positive integer',
        sourceFile: '/path/to/config.json',
        expectedType: 'number',
        actualValue: 'ten',
        validValues: ['Any positive integer'],
        cause: new Error('underlying error'),
      })
      expect(error.field).toBe('index.maxDepth')
      expect(error.message).toBe('Value must be a positive integer')
      expect(error.sourceFile).toBe('/path/to/config.json')
      expect(error.expectedType).toBe('number')
      expect(error.actualValue).toBe('ten')
      expect(error.validValues).toEqual(['Any positive integer'])
      expect(error.cause).toBeInstanceOf(Error)
    })

    it('handles all optional fields being undefined', () => {
      const error = new ConfigError({ message: 'error' })
      expect(error.field).toBeUndefined()
      expect(error.sourceFile).toBeUndefined()
      expect(error.expectedType).toBeUndefined()
      expect(error.actualValue).toBeUndefined()
      expect(error.validValues).toBeUndefined()
    })

    it('can be caught with catchTag', async () => {
      const effect = Effect.fail(
        new ConfigError({
          field: 'test.field',
          message: 'test error',
          sourceFile: '/test/config.json',
        }),
      )
      const result = await Effect.runPromise(
        effect.pipe(
          Effect.catchTag('ConfigError', (e) =>
            Effect.succeed({ field: e.field, sourceFile: e.sourceFile }),
          ),
        ),
      )
      expect(result).toEqual({
        field: 'test.field',
        sourceFile: '/test/config.json',
      })
    })
  })

  // ==========================================================================
  // Watch Errors
  // ==========================================================================

  describe('WatchError', () => {
    it('has correct _tag and error code', () => {
      const error = new WatchError({
        path: '/docs',
        message: 'Watcher failed',
      })
      expect(error._tag).toBe('WatchError')
      expect(error.code).toBe(ErrorCode.WATCH)
      expect(error.code).toBe('E800')
    })
  })

  // ==========================================================================
  // CLI Errors
  // ==========================================================================

  describe('CliValidationError', () => {
    it('has correct _tag and error code', () => {
      const error = new CliValidationError({ message: 'Invalid argument' })
      expect(error._tag).toBe('CliValidationError')
      expect(error.code).toBe(ErrorCode.CLI_VALIDATION)
      expect(error.code).toBe('E900')
    })

    it('supports optional fields', () => {
      const error = new CliValidationError({
        message: 'Invalid value',
        argument: '--limit',
        expected: 'number',
        received: 'abc',
      })
      expect(error.argument).toBe('--limit')
      expect(error.expected).toBe('number')
      expect(error.received).toBe('abc')
    })

    it('handles missing optional fields', () => {
      const error = new CliValidationError({ message: 'error' })
      expect(error.argument).toBeUndefined()
      expect(error.expected).toBeUndefined()
      expect(error.received).toBeUndefined()
    })
  })

  // ==========================================================================
  // catchTags Integration
  // ==========================================================================

  describe('catchTags integration', () => {
    it('can handle multiple error types with catchTags', async () => {
      const program = (shouldFail: 'file' | 'api' | 'index') =>
        Effect.gen(function* () {
          if (shouldFail === 'file') {
            yield* Effect.fail(
              new FileReadError({ path: '/file.md', message: 'not found' }),
            )
          }
          if (shouldFail === 'api') {
            yield* Effect.fail(
              new ApiKeyMissingError({
                provider: 'openai',
                envVar: 'OPENAI_API_KEY',
              }),
            )
          }
          if (shouldFail === 'index') {
            yield* Effect.fail(new IndexNotFoundError({ path: '/index' }))
          }
          return 'success'
        }).pipe(
          Effect.catchTags({
            FileReadError: () => Effect.succeed('file_error'),
            ApiKeyMissingError: () => Effect.succeed('api_error'),
            IndexNotFoundError: () => Effect.succeed('index_error'),
          }),
        )

      expect(await Effect.runPromise(program('file'))).toBe('file_error')
      expect(await Effect.runPromise(program('api'))).toBe('api_error')
      expect(await Effect.runPromise(program('index'))).toBe('index_error')
    })
  })

  // ==========================================================================
  // Error Code Constants
  // ==========================================================================

  describe('ErrorCode constants', () => {
    it('has unique codes for each error type', () => {
      const codes = Object.values(ErrorCode)
      const uniqueCodes = new Set(codes)
      expect(uniqueCodes.size).toBe(codes.length)
    })

    it('follows E{category}{number} format', () => {
      for (const code of Object.values(ErrorCode)) {
        expect(code).toMatch(/^E[1-9]\d{2}$/)
      }
    })

    it('groups codes by category', () => {
      // File system E1xx
      expect(ErrorCode.FILE_READ).toMatch(/^E1\d{2}$/)
      expect(ErrorCode.FILE_WRITE).toMatch(/^E1\d{2}$/)
      expect(ErrorCode.DIRECTORY_CREATE).toMatch(/^E1\d{2}$/)
      expect(ErrorCode.DIRECTORY_WALK).toMatch(/^E1\d{2}$/)

      // Parse E2xx
      expect(ErrorCode.PARSE).toMatch(/^E2\d{2}$/)

      // API E3xx
      expect(ErrorCode.API_KEY_MISSING).toMatch(/^E3\d{2}$/)
      expect(ErrorCode.API_KEY_INVALID).toMatch(/^E3\d{2}$/)
      expect(ErrorCode.EMBEDDING_RATE_LIMIT).toMatch(/^E3\d{2}$/)

      // Index E4xx
      expect(ErrorCode.INDEX_NOT_FOUND).toMatch(/^E4\d{2}$/)
      expect(ErrorCode.INDEX_CORRUPTED).toMatch(/^E4\d{2}$/)
      expect(ErrorCode.INDEX_BUILD).toMatch(/^E4\d{2}$/)

      // Search E5xx
      expect(ErrorCode.DOCUMENT_NOT_FOUND).toMatch(/^E5\d{2}$/)
      expect(ErrorCode.EMBEDDINGS_NOT_FOUND).toMatch(/^E5\d{2}$/)

      // Vector Store E6xx
      expect(ErrorCode.VECTOR_STORE).toMatch(/^E6\d{2}$/)

      // Config E7xx
      expect(ErrorCode.CONFIG).toMatch(/^E7\d{2}$/)

      // Watch E8xx
      expect(ErrorCode.WATCH).toMatch(/^E8\d{2}$/)

      // CLI E9xx
      expect(ErrorCode.CLI_VALIDATION).toMatch(/^E9\d{2}$/)
    })
  })
})

// ============================================================================
// ConfigError Formatting Tests
// ============================================================================

describe('ConfigError Formatting', () => {
  it('formats basic config error with field', () => {
    const error = new ConfigError({
      field: 'index.maxDepth',
      message: 'Value must be a positive integer',
    })
    const formatted = formatError(error)

    expect(formatted.code).toBe('E700')
    expect(formatted.message).toBe('Invalid configuration: index.maxDepth')
    expect(formatted.exitCode).toBe(EXIT_CODE.USER_ERROR)
    expect(formatted.suggestions).toContain('Check your config file syntax')
    expect(formatted.suggestions).toContain(
      "Run 'mdcontext config check' to validate configuration",
    )
  })

  it('formats config error without field', () => {
    const error = new ConfigError({
      message: 'Invalid configuration format',
    })
    const formatted = formatError(error)

    expect(formatted.message).toBe('Configuration error')
    expect(formatted.details).toContain('Invalid configuration format')
  })

  it('formats config error with sourceFile', () => {
    const error = new ConfigError({
      field: 'index.maxDepth',
      message: 'Invalid value',
      sourceFile: '/path/to/mdcontext.config.json',
    })
    const formatted = formatError(error)

    expect(formatted.details).toContain(
      'Source: /path/to/mdcontext.config.json',
    )
  })

  it('formats config error with expectedType and actualValue', () => {
    const error = new ConfigError({
      field: 'index.maxDepth',
      message: 'Type mismatch',
      expectedType: 'number',
      actualValue: 'ten',
    })
    const formatted = formatError(error)

    expect(formatted.details).toContain('Expected: number')
    expect(formatted.details).toContain('Got: "ten"')
  })

  it('formats config error with number actualValue', () => {
    const error = new ConfigError({
      field: 'index.maxDepth',
      message: 'Value out of range',
      expectedType: 'positive integer',
      actualValue: -5,
    })
    const formatted = formatError(error)

    expect(formatted.details).toContain('Expected: positive integer')
    expect(formatted.details).toContain('Got: -5')
  })

  it('formats config error with validValues', () => {
    const error = new ConfigError({
      field: 'embeddingProvider',
      message: 'Invalid provider',
      validValues: ['openai', 'cohere', 'local'],
    })
    const formatted = formatError(error)

    expect(formatted.details).toContain('Valid values: openai, cohere, local')
  })

  it('formats config error with all enhanced fields', () => {
    const error = new ConfigError({
      field: 'index.maxDepth',
      message: 'Value must be a positive integer',
      sourceFile: '/path/to/mdcontext.config.json',
      expectedType: 'number',
      actualValue: 'ten',
      validValues: ['Any positive integer'],
    })
    const formatted = formatError(error)

    expect(formatted.code).toBe('E700')
    expect(formatted.message).toBe('Invalid configuration: index.maxDepth')
    expect(formatted.details).toContain(
      'Source: /path/to/mdcontext.config.json',
    )
    expect(formatted.details).toContain('Expected: number')
    expect(formatted.details).toContain('Got: "ten"')
    expect(formatted.details).toContain('Valid values: Any positive integer')
    expect(formatted.exitCode).toBe(EXIT_CODE.USER_ERROR)
  })

  it('includes message in details when other fields present', () => {
    const error = new ConfigError({
      field: 'test.field',
      message: 'Technical error details',
      sourceFile: '/config.json',
    })
    const formatted = formatError(error)

    expect(formatted.details).toContain('Technical error details')
    expect(formatted.details).toContain('Source: /config.json')
  })

  it('uses only message as details when no enhanced fields', () => {
    const error = new ConfigError({
      field: 'test.field',
      message: 'Simple error message',
    })
    const formatted = formatError(error)

    expect(formatted.details).toBe('Simple error message')
  })

  it('always includes standard suggestions', () => {
    const error = new ConfigError({
      message: 'Any error',
    })
    const formatted = formatError(error)

    expect(formatted.suggestions).toBeDefined()
    expect(formatted.suggestions).toHaveLength(2)
    expect(formatted.suggestions).toContain('Check your config file syntax')
    expect(formatted.suggestions).toContain(
      "Run 'mdcontext config check' to validate configuration",
    )
  })
})
