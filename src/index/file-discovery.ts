import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import {
  type CanonicalSource,
  type CanonicalSourceSelection,
  type CaseSensitivityProbe,
  canonicalizeSourceFile,
  fileIdentityKey,
  isPathWithin,
  probeCaseSensitivity,
  selectCanonicalSource,
} from '../db/canonical.js'
import { DirectoryWalkError, type FileReadError } from '../errors/index.js'
import {
  extendIgnoreHierarchy,
  type IgnoreHierarchy,
  shouldIgnore,
} from './ignore-patterns.js'

interface WalkResult {
  readonly files: string[]
  readonly skipped: { hidden: number; excluded: number }
}

interface WalkOptions {
  readonly followSymlinks?: boolean | undefined
}

export interface FileDiscoveryOptions extends WalkOptions {
  readonly changedPaths?: readonly string[] | undefined
  readonly recurse?: boolean | undefined
  readonly depth?: number | undefined
}

export interface FileDiscoveryResult extends WalkResult {
  readonly deletedPaths: string[]
}

export interface CanonicalizedDiscovery {
  readonly selections: readonly CanonicalSourceSelection[]
  readonly canonicalize: (
    value: string,
  ) => Effect.Effect<CanonicalSource, FileReadError>
}

const groupCanonicalSources = (
  sources: readonly CanonicalSource[],
): CanonicalSourceSelection[] => {
  const groups = new Map<string, CanonicalSource[]>()
  for (const source of sources) {
    const key = fileIdentityKey(source.identity)
    const group = groups.get(key) ?? []
    group.push(source)
    groups.set(key, group)
  }
  return [...groups.values()].map(selectCanonicalSource).sort((left, right) => {
    if (left.key < right.key) return -1
    if (left.key > right.key) return 1
    return 0
  })
}

export const canonicalizeDiscoveredFiles = (
  files: readonly string[],
  probe: CaseSensitivityProbe = probeCaseSensitivity,
): Effect.Effect<CanonicalizedDiscovery, FileReadError> => {
  const caseSensitivityByDevice = new Map<string, boolean>()
  const pendingByDevice = new Map<string, Promise<boolean>>()
  const cachedProbe: CaseSensitivityProbe = async (key, device, inode) => {
    const deviceKey = String(device)
    if (caseSensitivityByDevice.has(deviceKey)) {
      return caseSensitivityByDevice.get(deviceKey)!
    }
    const pending =
      pendingByDevice.get(deviceKey) ??
      probe(key, device, inode).then((caseSensitive) => {
        caseSensitivityByDevice.set(deviceKey, caseSensitive)
        pendingByDevice.delete(deviceKey)
        return caseSensitive
      })
    pendingByDevice.set(deviceKey, pending)
    return pending
  }
  const canonicalize = (value: string) =>
    canonicalizeSourceFile(value, cachedProbe)

  return Effect.all(files.map(canonicalize), { concurrency: 50 }).pipe(
    Effect.map((sources) => ({
      selections: groupCanonicalSources(sources),
      canonicalize,
    })),
  )
}

export const isMarkdownFile = (filename: string): boolean =>
  filename.endsWith('.md') || filename.endsWith('.mdx')

const walkDirectory = async (
  dir: string,
  rootPath: string,
  canonicalRoot: string,
  hierarchy: IgnoreHierarchy,
  options: FileDiscoveryOptions = {},
  currentDepth = 0,
): Promise<WalkResult> => {
  const files: string[] = []
  let hiddenCount = 0
  let excludedCount = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(rootPath, fullPath)

    // Deliberate git divergence: all hidden entries are skipped before ignore
    // evaluation, so hidden directories cannot opt back in through nested rules.
    if (entry.name.startsWith('.')) {
      if (entry.isDirectory()) hiddenCount++
      continue
    }

    let isDirectory = entry.isDirectory()
    let isFile = entry.isFile()
    if (entry.isSymbolicLink()) {
      if (!options.followSymlinks) continue
      try {
        const realPath = await fs.realpath(fullPath)
        if (!isPathWithin(realPath, canonicalRoot, true)) {
          continue
        }
        const stat = await fs.stat(realPath)
        isDirectory = stat.isDirectory()
        isFile = stat.isFile()
      } catch {
        // Broken and unreadable symbolic links are ignored.
        continue
      }
    }

    if (shouldIgnore(relativePath, hierarchy, isDirectory)) {
      excludedCount++
      continue
    }
    if (isDirectory) {
      if (
        options.recurse === false ||
        (options.depth !== undefined && currentDepth >= options.depth)
      ) {
        continue
      }
      const childHierarchy = await Effect.runPromise(
        extendIgnoreHierarchy(hierarchy, fullPath),
      )
      const nested = await walkDirectory(
        fullPath,
        rootPath,
        canonicalRoot,
        childHierarchy,
        options,
        currentDepth + 1,
      )
      files.push(...nested.files)
      hiddenCount += nested.skipped.hidden
      excludedCount += nested.skipped.excluded
    } else if (isFile && isMarkdownFile(entry.name)) {
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
  hierarchy: IgnoreHierarchy,
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
          hierarchy,
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
