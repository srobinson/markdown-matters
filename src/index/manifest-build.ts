import * as fs from 'node:fs/promises'

import { Effect } from 'effect'

import {
  isPathWithin,
  resolveCanonicalPathOrFallback,
} from '../db/canonical.js'
import { pruneVectorNamespaces } from '../embeddings/vector-prune.js'
import { FileWriteError } from '../errors/index.js'
import { legacyIndexDir } from '../home.js'
import type { ManifestDirectory, MdmManifest } from '../manifest.js'
import { buildBM25Index } from './bm25-build.js'
import { canonicalizeDiscoveredFiles, discoverFiles } from './file-discovery.js'
import { createIgnoreFilter } from './ignore-patterns.js'
import { buildDiscoveredIndex, type IndexOptions } from './index-build.js'
import { createStorage, loadSectionIndex } from './storage.js'

const containsCanonicalPath = (parent: string, candidate: string): boolean =>
  isPathWithin(
    resolveCanonicalPathOrFallback(candidate),
    resolveCanonicalPathOrFallback(parent),
    true,
  )

export const removeStaleSourceIndex = (
  sourceRoot: string,
  activeIndexRoot: string,
): Effect.Effect<void, FileWriteError> => {
  const staleIndexRoot = legacyIndexDir(sourceRoot)
  if (containsCanonicalPath(staleIndexRoot, activeIndexRoot)) {
    return Effect.void
  }

  return Effect.tryPromise({
    try: () => fs.rm(staleIndexRoot, { recursive: true, force: true }),
    catch: (cause) =>
      new FileWriteError({
        path: staleIndexRoot,
        message: 'Cannot remove stale source index',
        cause,
      }),
  })
}

const discoverManifestDirectory = (
  directory: ManifestDirectory,
  options: IndexOptions,
) =>
  createIgnoreFilter({
    rootPath: directory.path,
    cliPatterns: options.exclude,
    honorGitignore: options.honorGitignore ?? true,
    honorMdmignore: options.honorMdmignore ?? true,
  }).pipe(
    Effect.flatMap((hierarchy) =>
      discoverFiles(directory.path, hierarchy, {
        recurse: directory.recurse,
        depth: directory.depth,
        followSymlinks: options.followSymlinks,
      }),
    ),
  )

export const buildManifestIndex = (
  manifest: MdmManifest,
  options: IndexOptions,
) =>
  Effect.gen(function* () {
    const roots = manifest.directories.map((directory) => directory.path)
    yield* Effect.all(
      roots.map((root) => removeStaleSourceIndex(root, options.indexRoot)),
      { concurrency: 8 },
    )
    const results = yield* Effect.all(
      manifest.directories.map((directory) =>
        discoverManifestDirectory(directory, options),
      ),
      { concurrency: 8 },
    )
    const files = [...new Set(results.flatMap((result) => result.files))]
    const discovery = yield* canonicalizeDiscoveredFiles(files)
    const skipped = results.reduce(
      (sum, result) => ({
        hidden: sum.hidden + result.skipped.hidden,
        excluded: sum.excluded + result.skipped.excluded,
      }),
      { hidden: 0, excluded: 0 },
    )
    const result = yield* buildDiscoveredIndex(
      {
        roots,
        discovery,
        deletedPaths: [],
        skipped,
        complete: true,
      },
      options,
    )
    const sectionIndex = yield* loadSectionIndex(
      createStorage(options.indexRoot, options.indexRoot),
    )
    yield* pruneVectorNamespaces(
      options.indexRoot,
      new Set(Object.keys(sectionIndex?.sections ?? {})),
    )
    yield* buildBM25Index(options.indexRoot, { force: true })
    return result
  })
