import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import {
  getActiveProviderPath,
  getEmbeddingsDir,
  getMetaPath,
  getVectorPath,
} from '../embeddings/embedding-namespace-paths.js'
import { getIndexPaths } from '../index/types.js'
import { durableReplaceText, syncDirectory, syncTree } from './fs-durability.js'
import {
  type GenerationCommitState,
  GenerationWriteError,
  type ProcessIdentityError,
  type WriterLockError,
} from './generation-errors.js'
import {
  generationHomeLayout,
  generationLayout,
  isGenerationName,
  nextGenerationName,
  portablePath,
  readCurrentGeneration,
  stagingGenerationLayout,
} from './generation-paths.js'
import {
  type GenerationReaderFileSystem,
  initializeLeaseGate,
  nodeGenerationReaderFileSystem,
} from './generation-reader.js'
import { scheduleGenerationReap } from './generation-reaper.js'
import type {
  GenerationBuildContext,
  GenerationName,
  PublishedGeneration,
} from './generation-types.js'
import {
  type GenerationValidationFailure,
  validateGeneration,
} from './generation-validation.js'
import { type WriterLockOptions, withWriterLock } from './writer-lock.js'

export type { GenerationBuildContext, PublishedGeneration }

export interface GenerationWriteOptions<A, E, V> {
  readonly home: string
  readonly prepare?: () => Effect.Effect<void, E>
  readonly build: (context: GenerationBuildContext) => Effect.Effect<A, E>
  readonly validate: (
    context: GenerationBuildContext,
    value: A,
  ) => Effect.Effect<void, V>
}

export interface GenerationWriterFileSystem extends GenerationReaderFileSystem {
  readonly copyFile: (sourcePath: string, targetPath: string) => Promise<void>
  readonly remove: (targetPath: string, recursive: boolean) => Promise<void>
}

export interface GenerationWriterRuntime {
  readonly fileSystem?: GenerationWriterFileSystem
  readonly writerLock?: WriterLockOptions
  readonly scheduleReap?: (home: string) => void
}

export const nodeGenerationWriterFileSystem: GenerationWriterFileSystem = {
  ...nodeGenerationReaderFileSystem,
  copyFile: (sourcePath, targetPath) => fs.copyFile(sourcePath, targetPath),
  remove: async (targetPath, recursive) => {
    await fs.rm(targetPath, { recursive, force: true })
  },
}

interface WriteState {
  commitState: GenerationCommitState
  generation: GenerationName | null
  stagingRoot: string | null
}

const writeError = (
  state: WriteState,
  targetPath: string,
  cause: unknown,
): GenerationWriteError =>
  new GenerationWriteError({
    commitState: state.commitState,
    generation: state.generation,
    path: portablePath(targetPath),
    message: `Generation write failed for ${portablePath(targetPath)}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    cause,
  })

const attempt = <A>(
  state: WriteState,
  targetPath: string,
  action: () => Promise<A>,
): Effect.Effect<A, GenerationWriteError> =>
  Effect.tryPromise({
    try: action,
    catch: (cause) => writeError(state, targetPath, cause),
  })

const wrapWriteError = <A, E>(
  state: WriteState,
  targetPath: string,
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, GenerationWriteError> =>
  effect.pipe(Effect.mapError((cause) => writeError(state, targetPath, cause)))

const removePath = (
  state: WriteState,
  targetPath: string,
  fileSystem: GenerationWriterFileSystem,
): Effect.Effect<void, GenerationWriteError> =>
  attempt(state, targetPath, () => fileSystem.remove(targetPath, true))

const prepareStagingRoot = (
  state: WriteState,
  stagingRoot: string,
  fileSystem: GenerationWriterFileSystem,
): Effect.Effect<void, GenerationWriteError> =>
  Effect.gen(function* () {
    const stagingParent = path.dirname(stagingRoot)
    yield* attempt(state, stagingParent, () =>
      fileSystem.makeDirectory(stagingParent, true),
    )
    const entries = yield* attempt(state, stagingParent, () =>
      fileSystem.readDirectory(stagingParent),
    )
    yield* Effect.forEach(
      entries,
      (entry) =>
        removePath(state, path.join(stagingParent, entry.name), fileSystem),
      { discard: true },
    )
    yield* attempt(state, stagingRoot, () =>
      fileSystem.makeDirectory(stagingRoot, false),
    )
  })

const copyRegularFile = (
  state: WriteState,
  sourcePath: string,
  targetPath: string,
  fileSystem: GenerationWriterFileSystem,
): Effect.Effect<void, GenerationWriteError> =>
  Effect.gen(function* () {
    const kind = yield* attempt(state, sourcePath, () =>
      fileSystem.pathKind(sourcePath),
    )
    if (kind === 'missing') return
    if (kind !== 'file') {
      return yield* Effect.fail(
        writeError(
          state,
          sourcePath,
          new Error('Database artifact must be a regular file'),
        ),
      )
    }
    yield* attempt(state, path.dirname(targetPath), () =>
      fileSystem.makeDirectory(path.dirname(targetPath), true),
    )
    yield* attempt(state, targetPath, () =>
      fileSystem.copyFile(sourcePath, targetPath),
    )
  })

const structuralArtifactPairs = (
  sourceRoot: string,
  targetRoot: string,
): readonly (readonly [string, string])[] => {
  const source = getIndexPaths(sourceRoot)
  const target = getIndexPaths(targetRoot)
  return [
    [source.documents, target.documents],
    [source.sections, target.sections],
    [source.links, target.links],
    [source.bm25, target.bm25],
    [source.bm25Metadata, target.bm25Metadata],
    [getActiveProviderPath(sourceRoot), getActiveProviderPath(targetRoot)],
  ]
}

const copyEmbeddingArtifacts = (
  state: WriteState,
  sourceRoot: string,
  targetRoot: string,
  fileSystem: GenerationWriterFileSystem,
): Effect.Effect<void, GenerationWriteError> =>
  Effect.gen(function* () {
    const sourceEmbeddings = getEmbeddingsDir(sourceRoot)
    const kind = yield* attempt(state, sourceEmbeddings, () =>
      fileSystem.pathKind(sourceEmbeddings),
    )
    if (kind === 'missing') return
    if (kind !== 'directory') {
      return yield* Effect.fail(
        writeError(
          state,
          sourceEmbeddings,
          new Error('Embeddings root must be a directory'),
        ),
      )
    }

    const namespaces = yield* attempt(state, sourceEmbeddings, () =>
      fileSystem.readDirectory(sourceEmbeddings),
    )
    for (const namespace of namespaces) {
      if (namespace.kind !== 'directory') continue
      const pairs = yield* Effect.try({
        try: () =>
          [
            [
              getVectorPath(sourceRoot, namespace.name),
              getVectorPath(targetRoot, namespace.name),
            ],
            [
              getMetaPath(sourceRoot, namespace.name),
              getMetaPath(targetRoot, namespace.name),
            ],
          ] as const,
        catch: (cause) => writeError(state, sourceEmbeddings, cause),
      })
      yield* Effect.forEach(
        pairs,
        ([sourcePath, targetPath]) =>
          copyRegularFile(state, sourcePath, targetPath, fileSystem),
        { discard: true },
      )
    }
  })

const copyCurrentArtifacts = (
  state: WriteState,
  sourceRoot: string,
  targetRoot: string,
  fileSystem: GenerationWriterFileSystem,
): Effect.Effect<void, GenerationWriteError> =>
  Effect.gen(function* () {
    yield* Effect.forEach(
      structuralArtifactPairs(sourceRoot, targetRoot),
      ([sourcePath, targetPath]) =>
        copyRegularFile(state, sourcePath, targetPath, fileSystem),
      { discard: true },
    )
    yield* copyEmbeddingArtifacts(state, sourceRoot, targetRoot, fileSystem)
  })

const listFinalizedGenerations = (
  state: WriteState,
  home: string,
  fileSystem: GenerationWriterFileSystem,
): Effect.Effect<readonly GenerationName[], GenerationWriteError> =>
  attempt(state, home, () => fileSystem.readDirectory(home)).pipe(
    Effect.map((entries) =>
      entries.flatMap((entry) =>
        entry.kind === 'directory' && isGenerationName(entry.name)
          ? [entry.name]
          : [],
      ),
    ),
  )

const transactGeneration = <A, E, V>(
  options: GenerationWriteOptions<A, E, V>,
  fileSystem: GenerationWriterFileSystem,
  state: WriteState,
  scheduleReap: (home: string) => void,
): Effect.Effect<
  PublishedGeneration<A>,
  E | V | GenerationValidationFailure | GenerationWriteError
> => {
  const homeLayout = generationHomeLayout(options.home)
  const transaction = Effect.gen(function* () {
    const previous = yield* wrapWriteError(
      state,
      homeLayout.current,
      readCurrentGeneration(homeLayout.home),
    )
    if (options.prepare) yield* options.prepare()

    const existing = yield* listFinalizedGenerations(
      state,
      homeLayout.home,
      fileSystem,
    )
    const generation = nextGenerationName(existing)
    state.generation = generation
    const staging = stagingGenerationLayout(
      homeLayout.home,
      generation,
      randomUUID(),
    )
    const published = generationLayout(homeLayout.home, generation)
    state.stagingRoot = staging.root

    yield* prepareStagingRoot(state, staging.root, fileSystem)
    const sourceRoot =
      previous === null
        ? homeLayout.home
        : generationLayout(homeLayout.home, previous).root
    yield* copyCurrentArtifacts(state, sourceRoot, staging.root, fileSystem)
    yield* wrapWriteError(
      state,
      staging.leasesRoot,
      initializeLeaseGate(staging, fileSystem),
    )

    const context: GenerationBuildContext = {
      home: homeLayout.home,
      previous,
      generation,
      indexRoot: staging.root,
    }
    const value = yield* options.build(context)
    yield* options.validate(context, value)
    yield* validateGeneration(context.indexRoot)
    yield* wrapWriteError(
      state,
      staging.root,
      syncTree(staging.root, fileSystem),
    )
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* attempt(state, published.root, () =>
          fileSystem.rename(staging.root, published.root),
        )
        yield* wrapWriteError(
          state,
          homeLayout.home,
          syncDirectory(homeLayout.home, fileSystem),
        )
        yield* wrapWriteError(
          state,
          homeLayout.current,
          durableReplaceText(homeLayout.current, generation, fileSystem, {
            afterRename: () => (state.commitState = 'published'),
          }),
        )
        yield* wrapWriteError(
          state,
          homeLayout.home,
          syncDirectory(homeLayout.home, fileSystem),
        )
        yield* Effect.sync(() => scheduleReap(homeLayout.home))
      }),
    )

    return { generation, indexRoot: published.root, value }
  })

  return transaction.pipe(
    Effect.onError(() =>
      state.commitState === 'not-published' && state.stagingRoot !== null
        ? removePath(state, state.stagingRoot, fileSystem).pipe(
            Effect.catchAll(() => Effect.void),
          )
        : Effect.void,
    ),
  )
}

export const writeGeneration = <A, E, V>(
  options: GenerationWriteOptions<A, E, V>,
  runtime: GenerationWriterRuntime = {},
): Effect.Effect<
  PublishedGeneration<A>,
  | E
  | V
  | GenerationValidationFailure
  | GenerationWriteError
  | WriterLockError
  | ProcessIdentityError
> =>
  Effect.suspend(() => {
    const fileSystem = runtime.fileSystem ?? nodeGenerationWriterFileSystem
    const scheduleReap =
      runtime.scheduleReap ?? ((home) => scheduleGenerationReap(home))
    const state: WriteState = {
      commitState: 'not-published',
      generation: null,
      stagingRoot: null,
    }
    return withWriterLock(
      options.home,
      () => transactGeneration(options, fileSystem, state, scheduleReap),
      runtime.writerLock,
    )
  })
