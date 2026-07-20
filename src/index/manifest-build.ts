import { Effect } from 'effect'

import { isPathWithin } from '../db/canonical.js'
import {
  pruneVectorNamespaces,
  sectionDocumentHashes,
} from '../embeddings/vector-prune.js'
import type { ManifestDirectory, MdmManifest } from '../manifest.js'
import { buildBM25Index } from './bm25-build.js'
import {
  canonicalizeDiscoveredFiles,
  discoverFiles,
  type FileDiscoveryResult,
} from './file-discovery.js'
import { createIgnoreFilter } from './ignore-patterns.js'
import { buildDiscoveredIndex, type IndexOptions } from './index-build.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from './storage.js'

export interface ManifestBuildOptions extends IndexOptions {
  readonly reconcileVectors?: boolean | undefined
}

const emptyDiscovery = (): FileDiscoveryResult => ({
  files: [],
  deletedPaths: [],
  skipped: { hidden: 0, excluded: 0 },
})

const discoverManifestDirectory = (
  directory: ManifestDirectory,
  options: ManifestBuildOptions,
) => {
  const incremental = (options.changedPaths?.length ?? 0) > 0
  const changedPaths = incremental
    ? options.changedPaths?.filter((changedPath) =>
        isPathWithin(changedPath, directory.path, true),
      )
    : undefined
  if (incremental && changedPaths?.length === 0) {
    return Effect.succeed(emptyDiscovery())
  }
  return createIgnoreFilter({
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
        changedPaths,
      }),
    ),
  )
}

export const buildManifestIndex = (
  manifest: MdmManifest,
  options: ManifestBuildOptions,
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
    const deletedPaths = [
      ...new Set(results.flatMap((result) => result.deletedPaths)),
    ]
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
        deletedPaths,
        skipped,
        complete: (options.changedPaths?.length ?? 0) === 0,
      },
      options,
    )
    const storage = createStorage(options.indexRoot, options.indexRoot)
    const [documentIndex, sectionIndex] = yield* Effect.all([
      loadDocumentIndex(storage),
      loadSectionIndex(storage),
    ])
    const corpusKnown =
      documentIndex !== null &&
      sectionIndex !== null &&
      Object.keys(documentIndex.documents).length > 0 &&
      Object.keys(sectionIndex.sections).length > 0
    if (options.reconcileVectors !== false && corpusKnown) {
      yield* pruneVectorNamespaces(
        options.indexRoot,
        sectionDocumentHashes(sectionIndex, documentIndex),
      )
    }
    yield* buildBM25Index(options.indexRoot, { force: true })
    return result
  })
