/**
 * Index storage operations
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect, Schema } from 'effect'
import {
  DeclaredPathSchema,
  DocumentKeySchema,
  isDocumentKey,
} from '../db/canonical.js'
import {
  DirectoryCreateError,
  FileReadError,
  FileWriteError,
  IndexCorruptedError,
} from '../errors/index.js'
import type { DocumentIndex, LinkIndex, SectionIndex } from './types.js'
import { getIndexPaths, INDEX_VERSION } from './types.js'

// ============================================================================
// Runtime Schemas for Index Validation
// ============================================================================

const DocumentEntrySchema = Schema.Struct({
  id: Schema.String,
  path: DocumentKeySchema,
  paths: Schema.Array(DocumentKeySchema),
  declaredPaths: Schema.Array(DeclaredPathSchema),
  identity: Schema.Struct({
    device: Schema.String,
    inode: Schema.String,
  }),
  comparisonKey: Schema.String,
  title: Schema.String,
  mtime: Schema.Number,
  hash: Schema.String,
  tokenCount: Schema.Number,
  sectionCount: Schema.Number,
})

const documentKeyRecord = <A, I, R>(value: Schema.Schema<A, I, R>) =>
  Schema.Record({ key: Schema.String, value }).pipe(
    Schema.filter((record) => Object.keys(record).every(isDocumentKey), {
      identifier: 'DocumentKeyRecord',
    }),
  )

const DocumentIndexSchema = Schema.Struct({
  version: Schema.Literal(INDEX_VERSION),
  documents: documentKeyRecord(DocumentEntrySchema),
})

const SectionEntrySchema = Schema.Struct({
  id: Schema.String,
  documentId: Schema.String,
  documentPath: DocumentKeySchema,
  heading: Schema.String,
  level: Schema.Literal(1, 2, 3, 4, 5, 6),
  startLine: Schema.Number,
  endLine: Schema.Number,
  tokenCount: Schema.Number,
  hasCode: Schema.Boolean,
  hasList: Schema.Boolean,
  hasTable: Schema.Boolean,
})

const SectionIndexSchema = Schema.Struct({
  version: Schema.Literal(INDEX_VERSION),
  sections: Schema.Record({ key: Schema.String, value: SectionEntrySchema }),
  byHeading: Schema.Record({
    key: Schema.String,
    value: Schema.Array(Schema.String),
  }),
  byDocument: Schema.Record({
    key: Schema.String,
    value: Schema.Array(Schema.String),
  }),
})

const LinkIndexSchema = Schema.Struct({
  version: Schema.Literal(INDEX_VERSION),
  forward: documentKeyRecord(Schema.Array(DocumentKeySchema)),
  backward: documentKeyRecord(Schema.Array(DocumentKeySchema)),
  brokenBySource: documentKeyRecord(Schema.Array(DeclaredPathSchema)),
  broken: Schema.Array(DeclaredPathSchema),
})

// ============================================================================
// Module-level Index Cache (mtime-invalidated)
// ============================================================================

/**
 * Caches parsed index data keyed by file path, invalidated when the
 * file's mtime changes. Avoids repeated JSON.parse on every search
 * request in long-lived processes (MCP server).
 */
type CacheEntry<T> = { mtimeMs: number; data: T }
const indexCache = new Map<string, CacheEntry<unknown>>()

/** Clear one index root, or the entire in-memory cache when omitted. */
export const clearIndexCache = (indexRoot?: string): void => {
  if (indexRoot === undefined) {
    indexCache.clear()
    return
  }
  const root = path.resolve(indexRoot)
  for (const filePath of indexCache.keys()) {
    const relative = path.relative(root, filePath)
    if (
      relative === '' ||
      (!path.isAbsolute(relative) &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`))
    ) {
      indexCache.delete(filePath)
    }
  }
}

/**
 * Read and parse a JSON file with mtime-based caching.
 * Returns cached data if the file mtime has not changed.
 */
const readJsonFileCached = <A, I>(
  filePath: string,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A | null, FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    // Check mtime to determine if cache is still valid
    const stat = yield* Effect.tryPromise({
      try: () => fs.stat(filePath),
      catch: (e) => {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
          return { notFound: true as const }
        }
        return new FileReadError({
          path: filePath,
          message: e instanceof Error ? e.message : String(e),
          cause: e,
        })
      },
    }).pipe(
      Effect.catchAll((e) =>
        e && 'notFound' in e
          ? Effect.succeed({ notFound: true as const })
          : Effect.fail(e),
      ),
    )

    if ('notFound' in stat) {
      indexCache.delete(filePath)
      return null
    }

    const cached = indexCache.get(filePath)
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.data as A
    }

    // Cache miss or stale: full read + parse
    const data = yield* readJsonFile(filePath, schema)
    if (data !== null) {
      indexCache.set(filePath, { mtimeMs: stat.mtimeMs, data })
    } else {
      indexCache.delete(filePath)
    }
    return data
  })

// ============================================================================
// File System Helpers
// ============================================================================

const ensureDir = (
  dirPath: string,
): Effect.Effect<void, DirectoryCreateError> =>
  Effect.tryPromise({
    try: () => fs.mkdir(dirPath, { recursive: true }),
    catch: (e) =>
      new DirectoryCreateError({
        path: dirPath,
        message: e instanceof Error ? e.message : String(e),
        cause: e,
      }),
  }).pipe(Effect.map(() => undefined))

const readJsonFile = <A, I>(
  filePath: string,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A | null, FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    // Try to read file content
    const contentResult = yield* Effect.tryPromise({
      try: () => fs.readFile(filePath, 'utf-8'),
      catch: (e) => {
        // File not found is not an error - return null
        if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
          return { notFound: true as const }
        }
        return new FileReadError({
          path: filePath,
          message: e instanceof Error ? e.message : String(e),
          cause: e,
        })
      },
    }).pipe(
      Effect.map((content) =>
        typeof content === 'string' ? { content } : content,
      ),
      // Note: catchAll here filters out "file not found" as expected case (returns null),
      // while other errors are re-thrown to propagate as typed FileReadError
      Effect.catchAll((e) =>
        e && 'notFound' in e
          ? Effect.succeed({ notFound: true as const })
          : Effect.fail(e),
      ),
    )

    // Handle not found
    if ('notFound' in contentResult) {
      return null
    }

    // Parse JSON - corrupted files should fail with IndexCorruptedError
    const parsed = yield* Effect.try({
      try: () => JSON.parse(contentResult.content) as unknown,
      catch: (e) =>
        new IndexCorruptedError({
          path: filePath,
          reason: 'InvalidJson',
          details: e instanceof Error ? e.message : String(e),
        }),
    })

    // Validate against schema
    return yield* Schema.decodeUnknown(schema)(parsed).pipe(
      Effect.mapError(
        (parseError) =>
          new IndexCorruptedError({
            path: filePath,
            reason: 'MissingData',
            details: `Schema validation failed: ${String(parseError)}`,
          }),
      ),
    )
  })

const writeJsonFile = <T>(
  filePath: string,
  data: T,
): Effect.Effect<void, DirectoryCreateError | FileWriteError> =>
  Effect.gen(function* () {
    yield* ensureDir(path.dirname(filePath))

    const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`

    yield* Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => fs.writeFile(tmpPath, JSON.stringify(data)),
        catch: (e) =>
          new FileWriteError({
            path: filePath,
            message: e instanceof Error ? e.message : String(e),
            cause: e,
          }),
      })
      yield* Effect.tryPromise({
        try: () => fs.rename(tmpPath, filePath),
        catch: (e) =>
          new FileWriteError({
            path: filePath,
            message: e instanceof Error ? e.message : String(e),
            cause: e,
          }),
      })
    }).pipe(
      Effect.tapError(() =>
        // Best-effort cleanup. The .catch is required: Effect.promise needs a never-rejecting promise.
        Effect.promise(() => fs.unlink(tmpPath).catch(() => undefined)),
      ),
    )
  })

// ============================================================================
// Hash Computation
// ============================================================================

export const computeHash = (content: string): string => {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

// ============================================================================
// Index Storage Operations
// ============================================================================

export interface IndexStorage {
  readonly sourceRoot: string
  readonly indexRoot: string
  readonly paths: ReturnType<typeof getIndexPaths>
}

export const createStorage = (
  sourceRoot: string,
  indexRoot: string,
): IndexStorage => ({
  sourceRoot: path.resolve(sourceRoot),
  indexRoot: path.resolve(indexRoot),
  paths: getIndexPaths(indexRoot),
})

export const initializeIndex = (
  storage: IndexStorage,
): Effect.Effect<void, DirectoryCreateError> =>
  Effect.gen(function* () {
    yield* ensureDir(storage.paths.root)
    yield* ensureDir(path.dirname(storage.paths.documents))
  })

// ============================================================================
// Document Index Operations
// ============================================================================

export const loadDocumentIndex = (
  storage: IndexStorage,
): Effect.Effect<DocumentIndex | null, FileReadError | IndexCorruptedError> =>
  readJsonFileCached(storage.paths.documents, DocumentIndexSchema)

export const saveDocumentIndex = (
  storage: IndexStorage,
  index: DocumentIndex,
): Effect.Effect<void, DirectoryCreateError | FileWriteError> =>
  writeJsonFile(storage.paths.documents, index)

export const createEmptyDocumentIndex = (): DocumentIndex => ({
  version: INDEX_VERSION,
  documents: {},
})

// ============================================================================
// Section Index Operations
// ============================================================================

export const loadSectionIndex = (
  storage: IndexStorage,
): Effect.Effect<SectionIndex | null, FileReadError | IndexCorruptedError> =>
  readJsonFileCached(storage.paths.sections, SectionIndexSchema)

export const saveSectionIndex = (
  storage: IndexStorage,
  index: SectionIndex,
): Effect.Effect<void, DirectoryCreateError | FileWriteError> =>
  writeJsonFile(storage.paths.sections, index)

export const createEmptySectionIndex = (): SectionIndex => ({
  version: INDEX_VERSION,
  sections: {},
  byHeading: Object.create(null),
  byDocument: Object.create(null),
})

// ============================================================================
// Link Index Operations
// ============================================================================

export const loadLinkIndex = (
  storage: IndexStorage,
): Effect.Effect<LinkIndex | null, FileReadError | IndexCorruptedError> =>
  readJsonFileCached(storage.paths.links, LinkIndexSchema)

export const saveLinkIndex = (
  storage: IndexStorage,
  index: LinkIndex,
): Effect.Effect<void, DirectoryCreateError | FileWriteError> =>
  writeJsonFile(storage.paths.links, index)

export const createEmptyLinkIndex = (): LinkIndex => ({
  version: INDEX_VERSION,
  forward: Object.create(null),
  backward: Object.create(null),
  brokenBySource: Object.create(null),
  broken: [],
})

// ============================================================================
// Index Existence Check
// ============================================================================

export const indexExists = (
  storage: IndexStorage,
): Effect.Effect<boolean, FileReadError> =>
  Effect.tryPromise({
    try: async () => {
      const indexesDir = path.dirname(storage.paths.documents)
      try {
        await fs.access(indexesDir)
        return true
      } catch {
        return false
      }
    },
    catch: (e) =>
      new FileReadError({
        path: path.dirname(storage.paths.documents),
        message: e instanceof Error ? e.message : String(e),
        cause: e,
      }),
  })
