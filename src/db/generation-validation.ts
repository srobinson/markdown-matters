import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { readActiveProvider } from '../embeddings/embedding-namespace-catalog.js'
import {
  generateNamespace,
  getActiveProviderPath,
  getEmbeddingsDir,
  getMetaPath,
  getVectorPath,
} from '../embeddings/embedding-namespace-paths.js'
import type { EmbeddingNamespaceError } from '../embeddings/embedding-namespace-types.js'
import { createNamespacedVectorStore } from '../embeddings/vector-store.js'
import { loadVectorIndex } from '../embeddings/vector-store-codec.js'
import type {
  FileReadError,
  IndexCorruptedError,
  VectorStoreError,
} from '../errors/index.js'
import {
  clearIndexCache,
  createStorage,
  loadDocumentIndex,
  loadLinkIndex,
  loadSectionIndex,
} from '../index/storage.js'
import { createBM25Store } from '../search/bm25-store.js'
import { errorCode, GenerationValidationError } from './generation-errors.js'
import { portablePath } from './generation-paths.js'

export interface GenerationArtifactSummary {
  readonly documents: number
  readonly sections: number
  readonly links: number
  readonly bm25Sections: number
  readonly activeNamespace: string | null
  readonly vectors: number
}

export type GenerationValidationFailure =
  | GenerationValidationError
  | FileReadError
  | IndexCorruptedError
  | VectorStoreError
  | EmbeddingNamespaceError

const validationError = (
  targetPath: string,
  message: string,
  cause?: unknown,
): GenerationValidationError =>
  new GenerationValidationError({
    path: portablePath(targetPath),
    message,
    cause,
  })

const isMissing = (cause: unknown): boolean => errorCode(cause) === 'ENOENT'

const isContained = (rootPath: string, targetPath: string): boolean => {
  const relative = path.relative(rootPath, targetPath)
  return (
    relative !== '' &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  )
}

const requireRegularArtifact = (
  rootPath: string,
  targetPath: string,
): Effect.Effect<void, GenerationValidationError> =>
  Effect.tryPromise({
    try: async () => {
      const lexicalRoot = path.resolve(rootPath)
      const lexicalTarget = path.resolve(targetPath)
      if (!isContained(lexicalRoot, lexicalTarget)) {
        throw validationError(
          targetPath,
          'Generation artifact resolves outside the generation root',
        )
      }

      const stat = await fs.lstat(lexicalTarget)
      if (!stat.isFile()) {
        throw validationError(
          targetPath,
          'Generation artifact must be a regular file',
        )
      }

      const [realRoot, realTarget] = await Promise.all([
        fs.realpath(lexicalRoot),
        fs.realpath(lexicalTarget),
      ])
      if (!isContained(realRoot, realTarget)) {
        throw validationError(
          targetPath,
          'Generation artifact resolves outside the generation root',
        )
      }
    },
    catch: (cause) =>
      cause instanceof GenerationValidationError
        ? cause
        : validationError(
            targetPath,
            `Generation artifact is unavailable: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
            cause,
          ),
  })

const wrapLoad = <A, E>(
  targetPath: string,
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, GenerationValidationError> =>
  effect.pipe(
    Effect.mapError((cause) =>
      validationError(
        targetPath,
        `Generation artifact is invalid: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        cause,
      ),
    ),
  )

const inspectOptionalArtifact = (
  rootPath: string,
  targetPath: string,
): Effect.Effect<boolean, GenerationValidationError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        return await fs.lstat(targetPath)
      } catch (cause) {
        if (isMissing(cause)) return null
        throw cause
      }
    },
    catch: (cause) =>
      validationError(
        targetPath,
        'Unable to inspect generation artifact',
        cause,
      ),
  }).pipe(
    Effect.flatMap((stat) =>
      stat === null
        ? Effect.succeed(false)
        : requireRegularArtifact(rootPath, targetPath).pipe(Effect.as(true)),
    ),
  )

const requireAbsentSemanticSet = (
  rootPath: string,
): Effect.Effect<void, GenerationValidationError> => {
  const embeddingsPath = getEmbeddingsDir(rootPath)
  return Effect.tryPromise({
    try: async () => {
      try {
        const stat = await fs.lstat(embeddingsPath)
        if (!stat.isDirectory()) {
          throw validationError(
            embeddingsPath,
            'Embeddings root must be a directory',
          )
        }
        const entries = await fs.readdir(embeddingsPath)
        if (entries.length > 0) {
          throw validationError(
            embeddingsPath,
            'Semantic artifacts require an active provider',
          )
        }
      } catch (cause) {
        if (isMissing(cause)) return
        throw cause
      }
    },
    catch: (cause) =>
      cause instanceof GenerationValidationError
        ? cause
        : validationError(
            embeddingsPath,
            'Unable to inspect semantic artifacts',
            cause,
          ),
  })
}

const validateStructuralArtifacts = (
  indexRoot: string,
): Effect.Effect<
  Pick<GenerationArtifactSummary, 'documents' | 'sections' | 'links'>,
  GenerationValidationError
> =>
  Effect.gen(function* () {
    const storage = createStorage(indexRoot, indexRoot)
    yield* Effect.forEach(
      [storage.paths.documents, storage.paths.sections, storage.paths.links],
      (artifactPath) => requireRegularArtifact(indexRoot, artifactPath),
      { discard: true },
    )

    const documents = yield* wrapLoad(
      storage.paths.documents,
      loadDocumentIndex(storage),
    )
    const sections = yield* wrapLoad(
      storage.paths.sections,
      loadSectionIndex(storage),
    )
    const links = yield* wrapLoad(storage.paths.links, loadLinkIndex(storage))
    if (documents === null || sections === null || links === null) {
      return yield* Effect.fail(
        validationError(
          indexRoot,
          'Structural generation artifacts are incomplete',
        ),
      )
    }

    return {
      documents: Object.keys(documents.documents).length,
      sections: Object.keys(sections.sections).length,
      links: Object.values(links.forward).reduce(
        (count, targets) => count + targets.length,
        0,
      ),
    }
  })

const validateBM25Artifacts = (
  indexRoot: string,
): Effect.Effect<number, GenerationValidationError> =>
  Effect.gen(function* () {
    const storage = createStorage(indexRoot, indexRoot)
    yield* requireRegularArtifact(indexRoot, storage.paths.bm25)
    yield* requireRegularArtifact(indexRoot, storage.paths.bm25Metadata)
    const store = createBM25Store(indexRoot)
    const loaded = yield* wrapLoad(storage.paths.bm25, store.load())
    if (!loaded) {
      return yield* Effect.fail(
        validationError(storage.paths.bm25, 'BM25 artifacts are incomplete'),
      )
    }
    return store.getStats().count
  })

const validateSemanticArtifacts = (
  indexRoot: string,
): Effect.Effect<
  Pick<GenerationArtifactSummary, 'activeNamespace' | 'vectors'>,
  GenerationValidationError
> =>
  Effect.gen(function* () {
    const activeProviderPath = getActiveProviderPath(indexRoot)
    const activeProviderPresent = yield* inspectOptionalArtifact(
      indexRoot,
      activeProviderPath,
    )
    if (!activeProviderPresent) {
      yield* requireAbsentSemanticSet(indexRoot)
      return { activeNamespace: null, vectors: 0 }
    }

    const active = yield* wrapLoad(
      activeProviderPath,
      readActiveProvider(indexRoot),
    )
    if (active === null) {
      return yield* Effect.fail(
        validationError(activeProviderPath, 'Active provider is missing'),
      )
    }

    const expectedNamespace = generateNamespace(
      active.provider,
      active.model,
      active.dimensions,
    )
    if (active.namespace !== expectedNamespace) {
      return yield* Effect.fail(
        validationError(
          activeProviderPath,
          'Active provider namespace does not match its provider configuration',
        ),
      )
    }

    const metadataPath = getMetaPath(indexRoot, active.namespace)
    const vectorPath = getVectorPath(indexRoot, active.namespace)
    yield* requireRegularArtifact(indexRoot, metadataPath)
    yield* requireRegularArtifact(indexRoot, vectorPath)

    const metadata = yield* wrapLoad(
      metadataPath,
      loadVectorIndex(metadataPath),
    )
    if (
      metadata.provider !== active.provider ||
      metadata.providerModel !== active.model ||
      metadata.dimensions !== active.dimensions
    ) {
      return yield* Effect.fail(
        validationError(
          metadataPath,
          'Vector metadata does not match the active provider',
        ),
      )
    }

    const store = createNamespacedVectorStore(
      indexRoot,
      active.provider,
      active.model,
      active.dimensions,
    )
    const loaded = yield* wrapLoad(vectorPath, store.load())
    if (!loaded.loaded) {
      return yield* Effect.fail(
        validationError(vectorPath, 'Active vector artifacts are incomplete'),
      )
    }

    return {
      activeNamespace: active.namespace,
      vectors: Object.keys(metadata.entries).length,
    }
  })

export const validateGeneration = (
  indexRoot: string,
): Effect.Effect<GenerationArtifactSummary, GenerationValidationFailure> =>
  Effect.gen(function* () {
    yield* Effect.sync(() => clearIndexCache(indexRoot))
    const structural = yield* validateStructuralArtifacts(indexRoot)
    const bm25Sections = yield* validateBM25Artifacts(indexRoot)
    const semantic = yield* validateSemanticArtifacts(indexRoot)
    return { ...structural, bm25Sections, ...semantic }
  })
