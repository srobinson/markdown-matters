import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import type { Ignore } from 'ignore'
import { isPathWithin } from '../db/canonical.js'
import { DirectoryWalkError } from '../errors/index.js'
import { shouldIgnore } from './ignore-patterns.js'

interface WalkResult {
  readonly files: string[]
  readonly skipped: { hidden: number; excluded: number }
}

interface WalkOptions {
  readonly followSymlinks?: boolean | undefined
}

export interface FileDiscoveryOptions extends WalkOptions {
  readonly changedPaths?: readonly string[] | undefined
}

export interface FileDiscoveryResult extends WalkResult {
  readonly deletedPaths: string[]
}

export const isMarkdownFile = (filename: string): boolean =>
  filename.endsWith('.md') || filename.endsWith('.mdx')

const walkDirectory = async (
  dir: string,
  rootPath: string,
  canonicalRoot: string,
  filter: Ignore,
  options: WalkOptions = {},
): Promise<WalkResult> => {
  const files: string[] = []
  let hiddenCount = 0
  let excludedCount = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(rootPath, fullPath)

    if (entry.name.startsWith('.')) {
      if (entry.isDirectory()) hiddenCount++
      continue
    }
    if (shouldIgnore(relativePath, filter)) {
      excludedCount++
      continue
    }
    if (entry.isSymbolicLink() && options.followSymlinks) {
      try {
        const realPath = await fs.realpath(fullPath)
        if (!isPathWithin(realPath, canonicalRoot, true)) {
          continue
        }
        const stat = await fs.stat(realPath)
        if (stat.isDirectory()) {
          const nested = await walkDirectory(
            fullPath,
            rootPath,
            canonicalRoot,
            filter,
            options,
          )
          files.push(...nested.files)
          hiddenCount += nested.skipped.hidden
          excludedCount += nested.skipped.excluded
        } else if (stat.isFile() && isMarkdownFile(entry.name)) {
          files.push(fullPath)
        }
      } catch {
        // Broken and unreadable symbolic links are ignored.
      }
      continue
    }
    if (entry.isDirectory()) {
      const nested = await walkDirectory(
        fullPath,
        rootPath,
        canonicalRoot,
        filter,
        options,
      )
      files.push(...nested.files)
      hiddenCount += nested.skipped.hidden
      excludedCount += nested.skipped.excluded
    } else if (entry.isFile() && isMarkdownFile(entry.name)) {
      files.push(fullPath)
    }
  }

  return { files, skipped: { hidden: hiddenCount, excluded: excludedCount } }
}

const classifyChangedPaths = async (
  changedPaths: readonly string[],
): Promise<FileDiscoveryResult> => {
  const markdownPaths = changedPaths.filter(isMarkdownFile)
  const existResults = await Promise.all(
    markdownPaths.map((filePath) =>
      fs
        .stat(filePath)
        .then(() => true)
        .catch(() => false),
    ),
  )
  const files: string[] = []
  const deletedPaths: string[] = []
  for (let index = 0; index < markdownPaths.length; index++) {
    const filePath = markdownPaths[index]!
    if (existResults[index]) files.push(filePath)
    else deletedPaths.push(filePath)
  }
  return {
    files,
    deletedPaths,
    skipped: { excluded: 0, hidden: 0 },
  }
}

export const discoverFiles = (
  rootPath: string,
  filter: Ignore,
  options: FileDiscoveryOptions,
): Effect.Effect<FileDiscoveryResult, DirectoryWalkError> => {
  if (options.changedPaths && options.changedPaths.length > 0) {
    return Effect.promise(() => classifyChangedPaths(options.changedPaths!))
  }
  return Effect.tryPromise({
    try: async () => {
      const canonicalRoot = await fs.realpath(rootPath)
      return {
        ...(await walkDirectory(
          rootPath,
          rootPath,
          canonicalRoot,
          filter,
          options,
        )),
        deletedPaths: [],
      }
    },
    catch: (cause) =>
      new DirectoryWalkError({
        path: rootPath,
        message: `Failed to traverse directory: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  })
}
