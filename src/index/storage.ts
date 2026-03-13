/**
 * Index storage operations
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'

import {
  DirectoryCreateError,
  FileReadError,
  FileWriteError,
  IndexCorruptedError,
} from '../errors/index.js'
import type {
  DocumentIndex,
  IndexConfig,
  LinkIndex,
  SectionIndex,
} from './types.js'
import { getIndexPaths, INDEX_VERSION } from './types.js'

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

const readJsonFile = <T>(
  filePath: string,
): Effect.Effect<T | null, FileReadError | IndexCorruptedError> =>
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
    return yield* Effect.try({
      try: () => JSON.parse(contentResult.content) as T,
      catch: (e) =>
        new IndexCorruptedError({
          path: filePath,
          reason: 'InvalidJson',
          details: e instanceof Error ? e.message : String(e),
        }),
    })
  })

const writeJsonFile = <T>(
  filePath: string,
  data: T,
): Effect.Effect<void, DirectoryCreateError | FileWriteError> =>
  Effect.gen(function* () {
    const dir = path.dirname(filePath)
    yield* ensureDir(dir)
    yield* Effect.tryPromise({
      try: () => fs.writeFile(filePath, JSON.stringify(data)),
      catch: (e) =>
        new FileWriteError({
          path: filePath,
          message: e instanceof Error ? e.message : String(e),
          cause: e,
        }),
    })
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
  readonly rootPath: string
  readonly paths: ReturnType<typeof getIndexPaths>
}

export const createStorage = (rootPath: string): IndexStorage => ({
  rootPath: path.resolve(rootPath),
  paths: getIndexPaths(path.resolve(rootPath)),
})

export const initializeIndex = (
  storage: IndexStorage,
): Effect.Effect<
  void,
  DirectoryCreateError | FileReadError | FileWriteError | IndexCorruptedError
> =>
  Effect.gen(function* () {
    yield* ensureDir(storage.paths.root)
    yield* ensureDir(storage.paths.parsed)
    yield* ensureDir(path.dirname(storage.paths.documents))

    // Create default config if it doesn't exist
    const existingConfig = yield* loadConfig(storage)
    if (!existingConfig) {
      const config: IndexConfig = {
        version: INDEX_VERSION,
        rootPath: storage.rootPath,
        include: ['**/*.md', '**/*.mdx'],
        exclude: ['**/node_modules/**', '**/.*/**'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      yield* saveConfig(storage, config)
    }
  })

// ============================================================================
// Config Operations
// ============================================================================

export const loadConfig = (
  storage: IndexStorage,
): Effect.Effect<IndexConfig | null, FileReadError | IndexCorruptedError> =>
  readJsonFile<IndexConfig>(storage.paths.config)

export const saveConfig = (
  storage: IndexStorage,
  config: IndexConfig,
): Effect.Effect<void, DirectoryCreateError | FileWriteError> =>
  writeJsonFile(storage.paths.config, {
    ...config,
    updatedAt: new Date().toISOString(),
  })

// ============================================================================
// Document Index Operations
// ============================================================================

export const loadDocumentIndex = (
  storage: IndexStorage,
): Effect.Effect<DocumentIndex | null, FileReadError | IndexCorruptedError> =>
  readJsonFile<DocumentIndex>(storage.paths.documents)

export const saveDocumentIndex = (
  storage: IndexStorage,
  index: DocumentIndex,
): Effect.Effect<void, DirectoryCreateError | FileWriteError> =>
  writeJsonFile(storage.paths.documents, index)

export const createEmptyDocumentIndex = (rootPath: string): DocumentIndex => ({
  version: INDEX_VERSION,
  rootPath,
  documents: {},
})

// ============================================================================
// Section Index Operations
// ============================================================================

export const loadSectionIndex = (
  storage: IndexStorage,
): Effect.Effect<SectionIndex | null, FileReadError | IndexCorruptedError> =>
  readJsonFile<SectionIndex>(storage.paths.sections)

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
  readJsonFile<LinkIndex>(storage.paths.links)

export const saveLinkIndex = (
  storage: IndexStorage,
  index: LinkIndex,
): Effect.Effect<void, DirectoryCreateError | FileWriteError> =>
  writeJsonFile(storage.paths.links, index)

export const createEmptyLinkIndex = (): LinkIndex => ({
  version: INDEX_VERSION,
  forward: Object.create(null),
  backward: Object.create(null),
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
      try {
        await fs.access(storage.paths.config)
        return true
      } catch {
        return false
      }
    },
    catch: (e) =>
      new FileReadError({
        path: storage.paths.config,
        message: e instanceof Error ? e.message : String(e),
        cause: e,
      }),
  })
