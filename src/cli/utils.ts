/**
 * CLI Utility Functions
 *
 * Shared helper functions used across CLI commands.
 */

import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { DirectoryWalkError } from '../errors/index.js'

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
 * Check if embeddings exist for a directory
 */
export const hasEmbeddings = async (dir: string): Promise<boolean> => {
  const vectorsPath = path.join(dir, '.mdcontext', 'vectors.bin')
  try {
    await fsPromises.access(vectorsPath)
    return true
  } catch {
    return false
  }
}

/**
 * Find the nearest parent directory containing an mdcontext index.
 * Searches from the specified directory up to the filesystem root.
 *
 * @param startDir - Directory to start searching from
 * @returns The directory containing the index, or null if not found
 */
export const findIndexRoot = async (
  startDir: string,
): Promise<string | null> => {
  let currentDir = path.resolve(startDir)
  const root = path.parse(currentDir).root

  while (currentDir !== root) {
    const sectionsPath = path.join(
      currentDir,
      '.mdcontext',
      'indexes',
      'sections.json',
    )
    try {
      await fsPromises.access(sectionsPath)
      return currentDir // Found an index
    } catch {
      // No index here, try parent
      const parent = path.dirname(currentDir)
      if (parent === currentDir) break // Reached root
      currentDir = parent
    }
  }

  // Also check root
  const rootSectionsPath = path.join(
    root,
    '.mdcontext',
    'indexes',
    'sections.json',
  )
  try {
    await fsPromises.access(rootSectionsPath)
    return root
  } catch {
    return null
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
  /** The actual directory where the index was found (may differ from requested dir) */
  indexRoot?: string | undefined
}

export const getIndexInfo = async (dir: string): Promise<IndexInfo> => {
  // First try the specified directory
  let indexRoot = dir
  let sectionsPath = path.join(dir, '.mdcontext', 'indexes', 'sections.json')
  let vectorsMetaPath = path.join(dir, '.mdcontext', 'vectors.meta.json')

  let exists = false
  let lastUpdated: string | undefined
  let sectionCount: number | undefined
  let embeddingsExist = false
  let vectorCount: number | undefined

  // Check sections index in specified directory
  try {
    const stat = await fsPromises.stat(sectionsPath)
    exists = true
    lastUpdated = stat.mtime.toISOString()

    const content = await fsPromises.readFile(sectionsPath, 'utf-8')
    const sections = JSON.parse(content)
    sectionCount = Object.keys(sections.sections || {}).length
  } catch {
    // Index doesn't exist in specified directory, try to find in parent directories
    const foundRoot = await findIndexRoot(dir)
    if (foundRoot) {
      indexRoot = foundRoot
      sectionsPath = path.join(
        foundRoot,
        '.mdcontext',
        'indexes',
        'sections.json',
      )
      vectorsMetaPath = path.join(foundRoot, '.mdcontext', 'vectors.meta.json')

      try {
        const stat = await fsPromises.stat(sectionsPath)
        exists = true
        lastUpdated = stat.mtime.toISOString()

        const content = await fsPromises.readFile(sectionsPath, 'utf-8')
        const sections = JSON.parse(content)
        sectionCount = Object.keys(sections.sections || {}).length
      } catch {
        // Still failed
      }
    }
  }

  // Check vectors metadata
  try {
    const content = await fsPromises.readFile(vectorsMetaPath, 'utf-8')
    const meta = JSON.parse(content)
    embeddingsExist = true
    vectorCount = Object.keys(meta.entries || {}).length
    // Use vector meta updatedAt if available
    if (meta.updatedAt) {
      lastUpdated = meta.updatedAt
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
    indexRoot: exists && indexRoot !== dir ? indexRoot : undefined,
  }
}
