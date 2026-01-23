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
      const error = new IndexNotFoundError({ path: '/.mdcontext/index.json' })
      expect(error._tag).toBe('IndexNotFoundError')
      expect(error.code).toBe(ErrorCode.INDEX_NOT_FOUND)
      expect(error.code).toBe('E400')
    })

    it('generates dynamic message', () => {
      const error = new IndexNotFoundError({ path: '/.mdcontext/index.json' })
      expect(error.message).toBe('Index not found at /.mdcontext/index.json')
    })
  })

  describe('IndexCorruptedError', () => {
    it('has correct _tag and error code', () => {
      const error = new IndexCorruptedError({
        path: '/.mdcontext/index.json',
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
        indexPath: '/.mdcontext/index.json',
      })
      expect(error.indexPath).toBe('/.mdcontext/index.json')
    })
  })

  describe('EmbeddingsNotFoundError', () => {
    it('has correct _tag and error code', () => {
      const error = new EmbeddingsNotFoundError({
        path: '/.mdcontext/embeddings',
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
