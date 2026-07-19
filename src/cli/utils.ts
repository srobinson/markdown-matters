/**
 * CLI Utility Functions
 *
 * Shared helper functions used across CLI commands.
 */

import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { listNamespaces } from '../embeddings/embedding-namespace.js'
import { DirectoryWalkError } from '../errors/index.js'
import { dbIndexDir, resolveMdmHome } from '../home.js'
import { getIndexPaths } from '../index/types.js'

/**
 * Format object as JSON string
 */
export const formatJson = (obj: unknown, pretty: boolean): string => {
  return pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj)
}

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

export const getIndexInfo = async (): Promise<IndexInfo> => {
  const indexRoot = dbIndexDir(resolveMdmHome())
  const sectionsPath = getIndexPaths(indexRoot).sections
  let exists = false
  let lastUpdated: string | undefined
  let sectionCount: number | undefined
  let embeddingsExist = false
  let vectorCount: number | undefined

  try {
    const stat = await fsPromises.stat(sectionsPath)
    exists = true
    lastUpdated = stat.mtime.toISOString()

    const content = await fsPromises.readFile(sectionsPath, 'utf-8')
    const sections = JSON.parse(content)
    sectionCount = Object.keys(sections.sections || {}).length
  } catch {}

  // Check namespaced embeddings
  try {
    const namespaces = await Effect.runPromise(
      listNamespaces(indexRoot).pipe(Effect.catchAll(() => Effect.succeed([]))),
    )

    if (namespaces.length > 0) {
      embeddingsExist = true
      // Find active namespace or use first one
      const activeNs = namespaces.find((ns) => ns.isActive) ?? namespaces[0]
      if (activeNs) {
        vectorCount = activeNs.vectorCount
        // Use namespace's updatedAt if more recent
        if (activeNs.updatedAt) {
          const nsDate = new Date(activeNs.updatedAt)
          const currentDate = lastUpdated ? new Date(lastUpdated) : new Date(0)
          if (nsDate > currentDate) {
            lastUpdated = activeNs.updatedAt
          }
        }
      }
    }
  } catch {
    // Embeddings don't exist
  }

  return {
    exists,
    lastUpdated,
    sectionCount,
    embeddingsExist,
    vectorCount,
  }
}
