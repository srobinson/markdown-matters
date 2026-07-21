import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as msgpack from '@msgpack/msgpack'
import { Effect, Schema } from 'effect'
import {
  getActiveProviderPath,
  getEmbeddingsDir,
  getMetaPath,
  getNamespaceDir,
  getVectorPath,
  parseNamespace,
} from './embedding-namespace-paths.js'
import {
  type ActiveProvider,
  type EmbeddingNamespace,
  EmbeddingNamespaceError,
} from './embedding-namespace-types.js'
import type { VectorIndex } from './types.js'

const ActiveProviderSchema: Schema.Schema<ActiveProvider> = Schema.Struct({
  namespace: Schema.NonEmptyTrimmedString,
  provider: Schema.NonEmptyTrimmedString,
  model: Schema.NonEmptyTrimmedString,
  dimensions: Schema.Number.pipe(Schema.int(), Schema.positive()),
  activatedAt: Schema.String.pipe(
    Schema.filter(
      (value) =>
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString() === value,
      { message: () => 'Expected an ISO 8601 UTC timestamp' },
    ),
  ),
})

export const readActiveProvider = (
  rootPath: string,
): Effect.Effect<ActiveProvider | null, EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    const filePath = getActiveProviderPath(rootPath)
    const contentResult = yield* Effect.either(
      Effect.tryPromise({
        try: () => fs.readFile(filePath, 'utf-8'),
        catch: (cause) =>
          new EmbeddingNamespaceError({
            operation: 'readActiveProvider',
            message: `Failed to read active provider: ${cause}`,
            cause,
          }),
      }),
    )
    if (contentResult._tag === 'Left') {
      const cause = contentResult.left.cause as NodeJS.ErrnoException
      if (cause?.code === 'ENOENT') return null
      return yield* Effect.fail(contentResult.left)
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(contentResult.right) as unknown,
      catch: (cause) =>
        new EmbeddingNamespaceError({
          operation: 'readActiveProvider',
          message: `Failed to parse active provider: ${cause}`,
          cause,
        }),
    })
    return yield* Schema.decodeUnknown(ActiveProviderSchema)(parsed).pipe(
      Effect.mapError(
        (cause) =>
          new EmbeddingNamespaceError({
            operation: 'readActiveProvider',
            message: `Invalid active provider: ${cause}`,
            cause,
          }),
      ),
    )
  })

export const writeActiveProvider = (
  rootPath: string,
  activeProvider: ActiveProvider,
): Effect.Effect<void, EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    const filePath = getActiveProviderPath(rootPath)
    yield* Effect.tryPromise({
      try: () => fs.mkdir(path.dirname(filePath), { recursive: true }),
      catch: (cause) =>
        new EmbeddingNamespaceError({
          operation: 'writeActiveProvider',
          message: `Failed to create directory: ${cause}`,
          cause,
        }),
    })
    yield* Effect.tryPromise({
      try: () =>
        fs.writeFile(filePath, JSON.stringify(activeProvider, null, 2)),
      catch: (cause) =>
        new EmbeddingNamespaceError({
          operation: 'writeActiveProvider',
          message: `Failed to write active provider: ${cause}`,
          cause,
        }),
    })
  })

const fileExists = (
  filePath: string,
  operation: string,
): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      await fs.access(filePath)
      return true
    },
    catch: () =>
      new EmbeddingNamespaceError({ operation, message: 'Not found' }),
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))

export const listNamespaces = (
  rootPath: string,
): Effect.Effect<EmbeddingNamespace[], EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    const embeddingsDir = getEmbeddingsDir(rootPath)
    if (!(yield* fileExists(embeddingsDir, 'listNamespaces'))) return []

    const activeProvider = yield* readActiveProvider(rootPath).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    )
    const entries = yield* Effect.tryPromise({
      try: () => fs.readdir(embeddingsDir, { withFileTypes: true }),
      catch: (cause) =>
        new EmbeddingNamespaceError({
          operation: 'listNamespaces',
          message: `Failed to read embeddings directory: ${cause}`,
          cause,
        }),
    })
    const namespaces: EmbeddingNamespace[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const namespace = entry.name
      const parsed = parseNamespace(namespace)
      if (!parsed) continue

      const metaPath = getMetaPath(rootPath, namespace)
      const vectorPath = getVectorPath(rootPath, namespace)
      if (!(yield* fileExists(metaPath, 'listNamespaces'))) continue

      const meta = yield* Effect.tryPromise({
        try: async () =>
          msgpack.decode(await fs.readFile(metaPath)) as VectorIndex,
        catch: (cause) =>
          new EmbeddingNamespaceError({
            operation: 'listNamespaces',
            message: `Failed to read metadata: ${cause}`,
            cause,
          }),
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))
      if (!meta) continue

      const [metaStats, vectorStats] = yield* Effect.all([
        Effect.tryPromise({
          try: () => fs.stat(metaPath),
          catch: () =>
            new EmbeddingNamespaceError({
              operation: 'listNamespaces',
              message: 'Failed to stat meta',
            }),
        }).pipe(Effect.catchAll(() => Effect.succeed(null))),
        Effect.tryPromise({
          try: () => fs.stat(vectorPath),
          catch: () =>
            new EmbeddingNamespaceError({
              operation: 'listNamespaces',
              message: 'Failed to stat vector',
            }),
        }).pipe(Effect.catchAll(() => Effect.succeed(null))),
      ])

      namespaces.push({
        namespace,
        provider: meta.provider || parsed.provider,
        model: meta.providerModel || parsed.model,
        dimensions: meta.dimensions || parsed.dimensions,
        vectorCount: Object.keys(meta.entries).length,
        totalCost: meta.totalCost ?? 0,
        totalTokens: meta.totalTokens ?? 0,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        isActive: activeProvider?.namespace === namespace,
        sizeBytes: (metaStats?.size ?? 0) + (vectorStats?.size ?? 0),
      })
    }

    namespaces.sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    )
    return namespaces
  })

const matchingNamespaces = (
  namespaces: readonly EmbeddingNamespace[],
  query: string,
  includeProviderAndModel: boolean,
): EmbeddingNamespace[] => {
  const queryLower = query.toLowerCase()
  return namespaces.filter((namespace) => {
    const name = namespace.namespace.toLowerCase()
    return (
      name === queryLower ||
      name.includes(queryLower) ||
      (includeProviderAndModel &&
        (namespace.provider.toLowerCase() === queryLower ||
          namespace.model.toLowerCase().includes(queryLower)))
    )
  })
}

const selectNamespace = (
  operation: 'switchNamespace' | 'removeNamespace',
  namespaces: readonly EmbeddingNamespace[],
  query: string,
  includeProviderAndModel: boolean,
): Effect.Effect<EmbeddingNamespace, EmbeddingNamespaceError> => {
  const matches = matchingNamespaces(namespaces, query, includeProviderAndModel)
  if (matches.length === 0) {
    return Effect.fail(
      new EmbeddingNamespaceError({
        operation,
        message: `No namespace matching "${query}". Available: ${namespaces
          .map((namespace) => namespace.namespace)
          .join(', ')}`,
      }),
    )
  }
  if (matches.length === 1) return Effect.succeed(matches[0]!)

  const queryLower = query.toLowerCase()
  const exact = matches.find(
    (namespace) =>
      namespace.namespace.toLowerCase() === queryLower ||
      (includeProviderAndModel &&
        namespace.provider.toLowerCase() === queryLower),
  )
  if (exact) return Effect.succeed(exact)

  return Effect.fail(
    new EmbeddingNamespaceError({
      operation,
      message: `Multiple namespaces match "${query}": ${matches
        .map((namespace) => namespace.namespace)
        .join(', ')}. Be more specific.`,
    }),
  )
}

export const switchNamespace = (
  rootPath: string,
  namespaceQuery: string,
): Effect.Effect<EmbeddingNamespace, EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    const namespaces = yield* listNamespaces(rootPath)
    if (namespaces.length === 0) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'switchNamespace',
          message:
            'No embedding namespaces found. Run "mdm index --embed" first.',
        }),
      )
    }
    const target = yield* selectNamespace(
      'switchNamespace',
      namespaces,
      namespaceQuery,
      true,
    )
    yield* writeActiveProvider(rootPath, {
      namespace: target.namespace,
      provider: target.provider,
      model: target.model,
      dimensions: target.dimensions,
      activatedAt: new Date().toISOString(),
    })
    return { ...target, isActive: true }
  })

export const removeNamespace = (
  rootPath: string,
  namespaceQuery: string,
  options: { force?: boolean } = {},
): Effect.Effect<
  { removed: string; wasActive: boolean },
  EmbeddingNamespaceError
> =>
  Effect.gen(function* () {
    const namespaces = yield* listNamespaces(rootPath)
    if (namespaces.length === 0) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'removeNamespace',
          message: 'No embedding namespaces found.',
        }),
      )
    }
    const target = yield* selectNamespace(
      'removeNamespace',
      namespaces,
      namespaceQuery,
      false,
    )
    if (target.isActive && !options.force) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'removeNamespace',
          message: `Cannot remove active namespace "${target.namespace}". Use --force to override or switch to another namespace first.`,
        }),
      )
    }

    yield* Effect.tryPromise({
      try: () =>
        fs.rm(getNamespaceDir(rootPath, target.namespace), {
          recursive: true,
          force: true,
        }),
      catch: (cause) =>
        new EmbeddingNamespaceError({
          operation: 'removeNamespace',
          message: `Failed to remove namespace directory: ${cause}`,
          cause,
        }),
    })
    if (target.isActive) {
      yield* Effect.tryPromise({
        try: () => fs.unlink(getActiveProviderPath(rootPath)),
        catch: (cause) =>
          new EmbeddingNamespaceError({
            operation: 'removeNamespace',
            message: `Failed to clear active provider: ${cause}`,
            cause,
          }),
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    }
    return { removed: target.namespace, wasActive: target.isActive }
  })

export const getActiveNamespace = (
  rootPath: string,
): Effect.Effect<ActiveProvider | null, EmbeddingNamespaceError> =>
  readActiveProvider(rootPath)
