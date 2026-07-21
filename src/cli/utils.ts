/**
 * CLI Utility Functions
 *
 * Shared helper functions used across CLI commands.
 */

import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import { Console, Effect } from 'effect'
import { GenerationReadError } from '../db/generation-errors.js'
import {
  type GenerationReadSession,
  withCurrentGeneration,
} from '../db/generation-reader.js'
import { listNamespaces } from '../embeddings/embedding-namespace.js'
import { getEmbeddingStats } from '../embeddings/semantic-search.js'
import {
  DirectoryWalkError,
  FileReadError,
  type IndexCorruptedError,
} from '../errors/index.js'
import { createStorage, loadSectionIndex } from '../index/storage.js'

/**
 * Format object as JSON string
 */
export const formatJson = (obj: unknown, pretty: boolean): string => {
  return pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj)
}

export const renderNoIndexGuidance = (
  json: boolean,
  pretty: boolean,
): Effect.Effect<void> =>
  json
    ? Console.log(
        formatJson(
          {
            error: 'No index found.',
            guidance: 'Run: mdm index /path/to/docs',
            hint: 'Add --embed for semantic search capabilities',
          },
          pretty,
        ),
      )
    : Effect.gen(function* () {
        yield* Console.log('No index found.')
        yield* Console.log('')
        yield* Console.log('Run: mdm index /path/to/docs')
        yield* Console.log('  Add --embed for semantic search capabilities')
      })

export const withCurrentGenerationGuidance = <A, E>(
  home: string,
  json: boolean,
  pretty: boolean,
  use: (session: GenerationReadSession) => Effect.Effect<A, E>,
  renderMissingGeneration: (
    json: boolean,
    pretty: boolean,
  ) => Effect.Effect<void> = renderNoIndexGuidance,
) =>
  withCurrentGeneration(home, use).pipe(
    Effect.catchIf(
      (error): error is GenerationReadError =>
        error instanceof GenerationReadError &&
        error.reason === 'NoCurrentGeneration',
      () => renderMissingGeneration(json, pretty),
    ),
  )

/**
 * Check if filename is a markdown file
 */
export const isMarkdownFile = (filename: string): boolean => {
  return filename.endsWith('.md') || filename.endsWith('.mdx')
}

/**
 * Recursively walk directory and collect markdown files (async version).
 * @deprecated Use walkDirEffect for typed error handling
 */
export const walkDir = async (dir: string): Promise<string[]> => {
  const files: string[] = []
  const entries = await fsPromises.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    // Skip hidden directories and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue
    }

    if (entry.isDirectory()) {
      const subFiles = await walkDir(fullPath)
      files.push(...subFiles)
    } else if (entry.isFile() && isMarkdownFile(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Recursively walk directory and collect markdown files.
 *
 * @param dir - Directory to walk
 * @returns List of markdown file paths
 *
 * @throws DirectoryWalkError - Cannot read or traverse directory
 */
export const walkDirEffect = (
  dir: string,
): Effect.Effect<readonly string[], DirectoryWalkError> =>
  Effect.gen(function* () {
    const files: string[] = []

    const entries = yield* Effect.tryPromise({
      try: () => fsPromises.readdir(dir, { withFileTypes: true }),
      catch: (e) =>
        new DirectoryWalkError({
          path: dir,
          message: `Cannot read directory: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        }),
    })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      // Skip hidden directories and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue
      }

      if (entry.isDirectory()) {
        const subFiles = yield* walkDirEffect(fullPath)
        files.push(...subFiles)
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        files.push(fullPath)
      }
    }

    return files
  })

/**
 * Check if a query looks like a regex pattern
 */
export const isRegexPattern = (query: string): boolean => {
  // Has regex special characters (excluding simple spaces and common punctuation)
  return /[.*+?^${}()|[\]\\]/.test(query)
}

/**
 * Check if embeddings exist for a directory.
 * Checks for namespaced embeddings in the supplied database index root.
 */
export const hasEmbeddings = async (indexRoot: string): Promise<boolean> => {
  try {
    const namespaces = await Effect.runPromise(
      listNamespaces(indexRoot).pipe(Effect.catchAll(() => Effect.succeed([]))),
    )
    return namespaces.length > 0
  } catch {
    return false
  }
}

/**
 * Get index information for display
 */
export interface IndexInfo {
  exists: boolean
  lastUpdated?: string | undefined
  sectionCount?: number | undefined
  embeddingsExist: boolean
  vectorCount?: number | undefined
}

export const getIndexInfo = (
  session: GenerationReadSession,
): Effect.Effect<IndexInfo, FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    const storage = createStorage(session.indexRoot, session.indexRoot)
    const sectionIndex = yield* loadSectionIndex(storage)
    const embeddingStats = yield* getEmbeddingStats(session)
    if (!sectionIndex) {
      return {
        exists: false,
        embeddingsExist: embeddingStats.hasEmbeddings,
        ...(embeddingStats.hasEmbeddings
          ? { vectorCount: embeddingStats.count }
          : {}),
      }
    }

    const stat = yield* Effect.tryPromise({
      try: () => fsPromises.stat(storage.paths.sections),
      catch: (cause) =>
        new FileReadError({
          path: storage.paths.sections,
          message: `Cannot inspect section index: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
    })
    return {
      exists: true,
      lastUpdated: stat.mtime.toISOString(),
      sectionCount: Object.keys(sectionIndex.sections).length,
      embeddingsExist: embeddingStats.hasEmbeddings,
      ...(embeddingStats.hasEmbeddings
        ? { vectorCount: embeddingStats.count }
        : {}),
    }
  })
