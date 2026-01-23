# Error Handling Patterns

This document describes the error handling conventions used in mdcontext, following Effect's "errors as values" philosophy.

## Error Type Taxonomy

All domain errors are defined in `src/errors/index.ts` using Effect's `Data.TaggedError`:

```typescript
export class FileReadError extends Data.TaggedError('FileReadError')<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {
  get code() { return ErrorCode.FILE_READ }
}
```

### Error Categories

- **File System**: `FileReadError`, `FileWriteError`, `DirectoryCreateError`, `DirectoryWalkError`
- **Parsing**: `ParseError` (for markdown parsing failures)
- **API**: `ApiKeyMissingError`, `ApiKeyInvalidError`
- **Embeddings**: `EmbeddingError` (rate limits, quota, network failures)
- **Index**: `IndexNotFoundError`, `IndexCorruptedError`, `IndexBuildError`
- **Search**: `DocumentNotFoundError`, `EmbeddingsNotFoundError`
- **Config**: `ConfigError`
- **Vector Store**: `VectorStoreError`
- **Watch**: `WatchError`
- **CLI**: `CliValidationError`

## Error Codes

Each error type has a unique error code for programmatic handling. Error codes are stable identifiers that don't change when messages are updated.

### Code Format

Codes follow the pattern `E{category}{number}`:

| Category | Code Range | Description |
|----------|------------|-------------|
| File System | E1xx | File and directory operations |
| Parse | E2xx | Markdown parsing errors |
| API | E3xx | API authentication and embedding errors |
| Index | E4xx | Index operations |
| Search | E5xx | Search operations |
| Vector Store | E6xx | Vector store operations |
| Config | E7xx | Configuration errors |
| Watch | E8xx | File watcher errors |
| CLI | E9xx | CLI validation errors |

### Error Code Reference

| Code | Error Type | Description |
|------|------------|-------------|
| E100 | FileReadError | Cannot read file |
| E101 | FileWriteError | Cannot write file |
| E102 | DirectoryCreateError | Cannot create directory |
| E103 | DirectoryWalkError | Cannot traverse directory |
| E200 | ParseError | Markdown parsing failed |
| E300 | ApiKeyMissingError | API key not set in environment |
| E301 | ApiKeyInvalidError | API key rejected by provider |
| E310 | EmbeddingError (RateLimit) | Rate limit exceeded |
| E311 | EmbeddingError (QuotaExceeded) | API quota exceeded |
| E312 | EmbeddingError (Network) | Network error during embedding |
| E313 | EmbeddingError (ModelError) | Model error |
| E319 | EmbeddingError (Unknown) | Unknown embedding error |
| E400 | IndexNotFoundError | Index does not exist |
| E401 | IndexCorruptedError | Index is corrupted |
| E402 | IndexBuildError | Failed to build index |
| E500 | DocumentNotFoundError | Document not in index |
| E501 | EmbeddingsNotFoundError | Embeddings not found |
| E600 | VectorStoreError | Vector store operation failed |
| E700 | ConfigError | Configuration error |
| E800 | WatchError | File watcher error |
| E900 | CliValidationError | Invalid CLI arguments |

### Exit Codes

CLI exit codes map to error categories:

| Exit Code | Category | Description |
|-----------|----------|-------------|
| 0 | Success | Operation completed successfully |
| 1 | User Error | Invalid arguments, missing config, etc. |
| 2 | System Error | File system, network, etc. |
| 3 | API Error | Authentication, rate limits, etc. |

### Usage in Scripts

Error codes enable reliable scripting and CI/CD integration:

```bash
# Check for specific error codes in output
mdcontext search "query" 2>&1 | grep -q "\[E400\]" && echo "Index not found"

# Use exit codes for control flow
mdcontext index || {
  case $? in
    1) echo "User error - check arguments" ;;
    2) echo "System error - check permissions" ;;
    3) echo "API error - check credentials" ;;
  esac
}
```

### Programmatic Access

```typescript
import { FileReadError, ErrorCode } from './errors/index.js'

const error = new FileReadError({ path: '/file.md', message: 'ENOENT' })
console.log(error.code) // 'E100'
console.log(error._tag) // 'FileReadError'
```

## Transformation Patterns

### 1. `mapError` - Transform Error Types

Use `mapError` to convert low-level errors to domain errors. This preserves error specificity while adapting the error type.

```typescript
// GOOD - Maps to domain error with context
parse(content, options).pipe(
  Effect.mapError((e) =>
    new ParseError({
      message: e.message,
      path: filePath,
      cause: e,
    })
  )
)

// BAD - Loses type information
Effect.mapError((e) => new Error(`${e._tag}: ${e.message}`))
```

**When to use:**
- Converting library errors to domain errors
- Adding context (path, operation) to errors
- Translating between error domains

### 2. `catchTag` / `catchTags` - Handle Specific Errors

Use `catchTag` when you need to handle a specific known error type. This enables exhaustive error handling and type-safe recovery.

```typescript
// Handle specific error with recovery
estimateEmbeddingCost(dir).pipe(
  Effect.catchTag('IndexNotFoundError', () =>
    Effect.succeed(null)  // Index doesn't exist, return null estimate
  )
)

// Handle multiple specific errors
buildEmbeddings(dir).pipe(
  Effect.catchTags({
    ApiKeyMissingError: (e) => {
      console.error(e.message)
      return Effect.succeed(null)
    },
    ApiKeyInvalidError: (e) => {
      console.error(e.message)
      return Effect.succeed(null)
    },
  })
)
```

**When to use:**
- Recovering from expected error conditions
- Providing fallback values for specific failures
- Implementing retry logic for transient errors
- Filtering/handling known error types mid-pipeline

### 3. `catchAll` - Boundary Error Handling

Use `catchAll` **only at system boundaries** where all errors must be converted to a final format (user message, JSON response, etc.).

```typescript
// GOOD - At CLI boundary (main.ts)
program.pipe(
  Effect.catchAll((error) => {
    console.error(formatError(error))
    return Effect.succeed(ExitCode.failure)
  })
)

// GOOD - At MCP boundary (server.ts)
// MCP protocol requires JSON responses for all operations
handler.pipe(
  Effect.catchAll((e) =>
    Effect.succeed({
      isError: true,
      content: [{ type: 'text', text: `Error: ${e.message}` }]
    })
  )
)

// BAD - In middle of pipeline (loses type information)
readFile(path).pipe(
  Effect.catchAll(() => Effect.succeed(null))  // Silent failure!
)
```

**When to use:**
- CLI entry points (converting to exit codes)
- MCP/API handlers (converting to protocol responses)
- Top-level program error handling

**When NOT to use:**
- Middle of pipelines (use `catchTag` instead)
- When error type information is needed downstream
- For silent failures without logging

### 4. `Effect.tryPromise` / `Effect.try` - Lift External Operations

Use these to wrap promise-based or synchronous operations, converting thrown errors to Effect failures.

```typescript
// For promises
Effect.tryPromise({
  try: () => fs.readFile(path, 'utf-8'),
  catch: (e) => new FileReadError({
    path,
    message: e instanceof Error ? e.message : String(e),
    cause: e,
  })
})

// For synchronous code that may throw
Effect.try({
  try: () => JSON.parse(content),
  catch: (e) => new IndexCorruptedError({
    path,
    reason: 'InvalidJson',
    details: e instanceof Error ? e.message : undefined,
  })
})
```

## Best Practices

### Do's

- **Always use domain errors** - Never map to generic `Error`
- **Preserve cause chains** - Include `cause` field for debugging
- **Add context** - Include path, operation, and relevant metadata
- **Document error types** - Use JSDoc to specify thrown errors
- **Log at boundaries** - When swallowing errors, log for debugging

### Don'ts

- **Don't swallow errors silently** - Always log or handle explicitly
- **Don't use `catchAll` mid-pipeline** - Use `catchTag` instead
- **Don't mix paradigms** - Avoid try/catch inside Effect.gen
- **Don't map to generic Error** - Always use typed domain errors

### Batch Processing Pattern

When processing multiple items where individual failures shouldn't stop the batch:

```typescript
const processFile = Effect.gen(function* () {
  // ... processing logic
}).pipe(
  // Note: catchAll intentional for batch processing
  // Individual file failures collected in errors array
  // rather than stopping the entire operation
  Effect.catchAll((error) => {
    errors.push({ path, message: error.message })
    return Effect.void
  })
)
```

Always add a comment explaining why `catchAll` is appropriate.

### Graceful Degradation Pattern

When a feature is optional and failure shouldn't block the main operation:

```typescript
// Optional embedding cost estimate for user prompt
const estimate = yield* estimateEmbeddingCost(dir).pipe(
  Effect.catchTag('IndexNotFoundError', () => Effect.succeed(null)),
  // Note: catchAll for graceful degradation
  // This is optional information - failure shouldn't block indexing
  Effect.catchAll((e) => {
    Effect.runSync(Effect.logWarning(`Could not estimate: ${e.message}`))
    return Effect.succeed(null)
  })
)
```

## Error Formatting

Error formatting (user-friendly messages) should only happen at the CLI boundary in `src/cli/error-handler.ts`. Internal errors carry structured data; presentation is separate from logic.

```typescript
// src/cli/error-handler.ts
const formatError = (error: MdContextError): string => {
  switch (error._tag) {
    case 'FileReadError':
      return `Cannot read file: ${error.path}\n${error.message}`
    case 'ApiKeyMissingError':
      return `API key not configured.\n\nSet ${error.envVar} environment variable.`
    // ... other error types
  }
}
```
