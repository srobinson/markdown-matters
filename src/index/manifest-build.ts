import { Effect } from 'effect'

import { pruneVectorNamespaces } from '../embeddings/vector-prune.js'
import type { ManifestDirectory, MdmManifest } from '../manifest.js'
import { buildBM25Index } from './bm25-build.js'
import { canonicalizeDiscoveredFiles, discoverFiles } from './file-discovery.js'
import { createIgnoreFilter } from './ignore-patterns.js'
import { buildDiscoveredIndex, type IndexOptions } from './index-build.js'
import { createStorage, loadSectionIndex } from './storage.js'

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
