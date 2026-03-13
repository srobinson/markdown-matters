/**
 * File watcher for automatic re-indexing
 *
 * ## Why Not Effect Streams?
 *
 * We evaluated using Effect Streams (ALP-101) but decided the current approach is better:
 *
 * 1. **chokidar is battle-tested** - Handles OS-specific quirks (FSEvents on macOS,
 *    inotify on Linux, ReadDirectoryChangesW on Windows)
 *
 * 2. **Debouncing handles backpressure** - The 300ms debounce already batches rapid
 *    changes, so Stream backpressure isn't needed
 *
 * 3. **Simple use case** - File change → rebuild index. No complex transformations
 *    or compositions that would benefit from Stream operators
 *
 * 4. **Already Effect-based** - The setup/teardown is wrapped in Effect for proper
 *    error handling, and we use typed errors (WatchError, IndexBuildError)
 *
 * If future requirements need more sophisticated event processing (filtering by
 * content type, incremental updates, event replay), reconsider Streams then.
 */

import * as path from 'node:path'
import { watch } from 'chokidar'
import { Effect } from 'effect'

import {
  type DirectoryCreateError,
  type DirectoryWalkError,
  type FileReadError,
  type FileWriteError,
  type IndexCorruptedError,
  WatchError,
} from '../errors/index.js'
import { getChokidarIgnorePatterns } from './ignore-patterns.js'
import { buildIndex, type IndexOptions } from './indexer.js'
import { createStorage, indexExists } from './storage.js'

/**
 * Union of errors that can occur during watch operations
 */
export type WatchDirectoryError =
  | WatchError
  | DirectoryWalkError
  | DirectoryCreateError
  | FileReadError
  | FileWriteError
  | IndexCorruptedError

// ============================================================================
// Watcher Types
// ============================================================================

export interface WatcherOptions extends IndexOptions {
  readonly debounceMs?: number
  readonly onIndex?: (result: {
    documentsIndexed: number
    duration: number
  }) => void
  readonly onError?: (error: WatchError) => void
  /** Whether to honor .gitignore for file watching (default: true) */
  readonly honorGitignore?: boolean
  /** Whether to honor .mdmignore for file watching (default: true) */
  readonly honorMdmignore?: boolean
}

export interface Watcher {
  readonly stop: () => void
}

// ============================================================================
// Watcher Implementation
// ============================================================================

const isMarkdownFile = (filePath: string): boolean =>
  filePath.endsWith('.md') || filePath.endsWith('.mdx')

export const watchDirectory = (
  rootPath: string,
  options: WatcherOptions = {},
): Effect.Effect<Watcher, WatchDirectoryError> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath)
    const storage = createStorage(resolvedRoot)
    const debounceMs = options.debounceMs ?? 300

    // Ensure index exists
    const exists = yield* indexExists(storage)
    if (!exists) {
      // Build initial index
      const result = yield* buildIndex(resolvedRoot, options)
      options.onIndex?.({
        documentsIndexed: result.documentsIndexed,
        duration: result.duration,
      })
    }

    // Create a debounce queue
    const pendingPaths = new Set<string>()
    let debounceTimer: NodeJS.Timeout | null = null

    const scheduleReindex = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }

      debounceTimer = setTimeout(async () => {
        if (pendingPaths.size === 0) return

        // Capture and clear changed paths before async work
        const changedPaths = [...pendingPaths]
        pendingPaths.clear()

        try {
          const result = await Effect.runPromise(
            buildIndex(resolvedRoot, { ...options, changedPaths }),
          )
          options.onIndex?.({
            documentsIndexed: result.documentsIndexed,
            duration: result.duration,
          })
        } catch (error) {
          options.onError?.(
            new WatchError({
              path: resolvedRoot,
              message:
                error instanceof Error ? error.message : 'Index rebuild failed',
              cause: error,
            }),
          )
        }
      }, debounceMs)
    }

    // Build ignore patterns for chokidar
    const ignorePatterns = yield* getChokidarIgnorePatterns({
      rootPath: resolvedRoot,
      cliPatterns: options.exclude,
      honorGitignore: options.honorGitignore ?? true,
      honorMdmignore: options.honorMdmignore ?? true,
    })

    // Set up chokidar watcher with dynamic ignore patterns
    const watcher = watch(resolvedRoot, {
      ignored: ignorePatterns,
      persistent: true,
      ignoreInitial: true,
    })

    watcher.on('add', (filePath) => {
      if (isMarkdownFile(filePath)) {
        pendingPaths.add(filePath)
        scheduleReindex()
      }
    })

    watcher.on('change', (filePath) => {
      if (isMarkdownFile(filePath)) {
        pendingPaths.add(filePath)
        scheduleReindex()
      }
    })

    watcher.on('unlink', (filePath) => {
      if (isMarkdownFile(filePath)) {
        pendingPaths.add(filePath)
        scheduleReindex()
      }
    })

    watcher.on('error', (error: unknown) => {
      options.onError?.(
        new WatchError({
          path: resolvedRoot,
          message:
            error instanceof Error ? error.message : 'File watcher error',
          cause: error,
        }),
      )
    })

    return {
      stop: () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer)
        }
        watcher.close()
      },
    }
  })
