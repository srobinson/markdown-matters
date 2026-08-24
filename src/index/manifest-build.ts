import { isDeepStrictEqual } from 'node:util'
import { Effect } from 'effect'

import {
  type DeclaredPath,
  expandDeclaredPath,
  isPathWithin,
} from '../db/canonical.js'
import {
  listNamespaces,
  readActiveProvider,
} from '../embeddings/embedding-namespace.js'
import { getMetaPath } from '../embeddings/embedding-namespace-paths.js'
import type { VectorIndex } from '../embeddings/types.js'
import {
  pruneVectorNamespaces,
  sectionDocumentHashes,
} from '../embeddings/vector-prune.js'
import { loadVectorIndex } from '../embeddings/vector-store-codec.js'
import type { ManifestDirectory, MdmManifest } from '../manifest.js'
import { buildBM25Index } from './bm25-build.js'
import {
  canonicalizeDiscoveredFiles,
  discoverFiles,
  type FileDiscoveryResult,
} from './file-discovery.js'
import { createIgnoreFilter } from './ignore-patterns.js'
import {
  buildDiscoveredIndex,
  type IndexOptions,
  structuralIndexRequiresRebuild,
} from './index-build.js'
import {
  createStorage,
  loadDocumentIndex,
  loadLinkIndex,
  loadSectionIndex,
} from './storage.js'
import type { DocumentEntry, DocumentIndex, IndexResult } from './types.js'

export interface ManifestBuildOptions extends IndexOptions {
  readonly reconcileVectors?: boolean | undefined
  readonly currentIndexRoot?: string | undefined
  readonly scopePaths?: readonly DeclaredPath[] | undefined
}

export interface ManifestBuildResult extends IndexResult {
  readonly mutation: {
    readonly structural: boolean
  }
}

const logicalDocuments = (index: DocumentIndex | null) =>
  index === null
    ? null
    : {
        ...index,
        documents: Object.fromEntries(
          Object.entries(index.documents).map(([key, entry]) => [
            key,
            { ...entry, mtime: undefined },
          ]),
        ),
      }

const loadStructuralState = (indexRoot: string) => {
  const storage = createStorage(indexRoot, indexRoot)
  return Effect.all({
    documents: loadDocumentIndex(storage).pipe(Effect.map(logicalDocuments)),
    sections: loadSectionIndex(storage),
    links: loadLinkIndex(storage),
  })
}

const loadCurrentStructuralState = (indexRoot: string | undefined) => {
  if (indexRoot === undefined) return Effect.succeed(null)
  return loadStructuralState(indexRoot).pipe(
    Effect.catchTag('IndexCorruptedError', (error) =>
      error.reason === 'VersionMismatch'
        ? Effect.succeed(null)
        : Effect.fail(error),
    ),
  )
}

const logicalVectorIndex = (index: VectorIndex) => ({
  ...index,
  createdAt: undefined,
  updatedAt: undefined,
  totalCost: undefined,
  totalTokens: undefined,
})

const loadSemanticState = (indexRoot: string) =>
  Effect.gen(function* () {
    const active = yield* readActiveProvider(indexRoot)
    const namespaces = yield* listNamespaces(indexRoot)
    const vectors = yield* Effect.all(
      [...namespaces]
        .sort((left, right) => left.namespace.localeCompare(right.namespace))
        .map((namespace) =>
          loadVectorIndex(getMetaPath(indexRoot, namespace.namespace)).pipe(
            Effect.map((index) => ({
              namespace: namespace.namespace,
              index: logicalVectorIndex(index),
            })),
          ),
        ),
      { concurrency: 4 },
    )
    return {
      active: active === null ? null : { ...active, activatedAt: undefined },
      vectors,
    }
  })

export const semanticIndexChanged = (
  currentIndexRoot: string,
  stagedIndexRoot: string,
) =>
  Effect.all({
    current: loadSemanticState(currentIndexRoot),
    staged: loadSemanticState(stagedIndexRoot),
  }).pipe(
    Effect.map(({ current, staged }) => !isDeepStrictEqual(current, staged)),
  )

const withinAnyScope = (
  candidate: string,
  scopePaths: readonly DeclaredPath[],
): boolean =>
  scopePaths.some((scopePath) => isPathWithin(candidate, scopePath, true))

const collectScopedDeletions = (
  documents: Readonly<Record<string, Pick<DocumentEntry, 'declaredPaths'>>>,
  scopePaths: readonly DeclaredPath[],
  discovered: readonly string[],
): DeclaredPath[] => {
  const discoveredSet = new Set(discovered.map(expandDeclaredPath))
  const deleted: DeclaredPath[] = []
  for (const entry of Object.values(documents)) {
    for (const alias of entry.declaredPaths) {
      if (
        withinAnyScope(alias, scopePaths) &&
        !discoveredSet.has(expandDeclaredPath(alias))
      ) {
        deleted.push(alias)
      }
    }
  }
  return deleted
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
  if (
    !incremental &&
    options.scopePaths !== undefined &&
    options.scopePaths.length > 0 &&
    !options.scopePaths.some(
      (scopePath) =>
        isPathWithin(scopePath, directory.path, true) ||
        isPathWithin(directory.path, scopePath, true),
    )
  ) {
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
    const requiresRebuild = yield* structuralIndexRequiresRebuild(
      options.indexRoot,
    )
    const discoveryOptions = requiresRebuild
      ? { ...options, changedPaths: undefined, scopePaths: undefined }
      : options
    const scopePaths =
      (discoveryOptions.changedPaths?.length ?? 0) > 0 ||
      (discoveryOptions.scopePaths?.length ?? 0) === 0
        ? undefined
        : discoveryOptions.scopePaths
    const currentStructural = yield* loadCurrentStructuralState(
      options.currentIndexRoot,
    )
    const roots = manifest.directories.map((directory) => directory.path)
    const results = yield* Effect.all(
      manifest.directories.map((directory) =>
        discoverManifestDirectory(directory, discoveryOptions),
      ),
      { concurrency: 8 },
    )
    const discoveredFiles = [
      ...new Set(results.flatMap((result) => result.files)),
    ]
    const files =
      scopePaths === undefined
        ? discoveredFiles
        : discoveredFiles.filter((file) => withinAnyScope(file, scopePaths))
    const scopedDeletions =
      scopePaths === undefined || currentStructural?.documents == null
        ? []
        : collectScopedDeletions(
            currentStructural.documents.documents,
            scopePaths,
            files,
          )
    const deletedPaths = [
      ...new Set([
        ...results.flatMap((result) => result.deletedPaths),
        ...scopedDeletions,
      ]),
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
        complete:
          (discoveryOptions.changedPaths?.length ?? 0) === 0 &&
          scopePaths === undefined,
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
    const stagedStructural = yield* loadStructuralState(options.indexRoot)
    return {
      ...result,
      mutation: {
        structural:
          currentStructural === null ||
          !isDeepStrictEqual(currentStructural, stagedStructural),
      },
    } satisfies ManifestBuildResult
  })
