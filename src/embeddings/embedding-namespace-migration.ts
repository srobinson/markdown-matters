import * as fs from 'node:fs/promises'
import * as msgpack from '@msgpack/msgpack'
import { Effect } from 'effect'
import type { VectorIndex } from './types.js'
import { writeActiveProvider } from './embedding-namespace-catalog.js'
import {
  generateNamespace,
  getEmbeddingsDir,
  getLegacyMetaJsonPath,
  getLegacyMetaPath,
  getLegacyVectorPath,
  getMetaPath,
  getNamespaceDir,
  getVectorPath,
} from './embedding-namespace-paths.js'
import { EmbeddingNamespaceError } from './embedding-namespace-types.js'

const fileExists = (filePath: string): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      await fs.access(filePath)
      return true
    },
    catch: () =>
      new EmbeddingNamespaceError({
        operation: 'hasLegacyEmbeddings',
        message: 'File check failed',
      }),
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))

export const hasLegacyEmbeddings = (
  rootPath: string,
): Effect.Effect<boolean, EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    if (yield* fileExists(getEmbeddingsDir(rootPath))) return false
    if (!(yield* fileExists(getLegacyVectorPath(rootPath)))) return false
    return (
      (yield* fileExists(getLegacyMetaPath(rootPath))) ||
      (yield* fileExists(getLegacyMetaJsonPath(rootPath)))
    )
  })

const readLegacyMetadata = (
  rootPath: string,
): Effect.Effect<VectorIndex | null, never> =>
  Effect.gen(function* () {
    const binary = yield* Effect.tryPromise({
      try: async () =>
        msgpack.decode(await fs.readFile(getLegacyMetaPath(rootPath))) as VectorIndex,
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: 'Failed to read binary meta',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(null)))
    if (binary) return binary

    return yield* Effect.tryPromise({
      try: async () =>
        JSON.parse(
          await fs.readFile(getLegacyMetaJsonPath(rootPath), 'utf-8'),
        ) as VectorIndex,
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: 'Failed to read JSON meta',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(null)))
  })

const resolveProvider = (
  meta: VectorIndex,
): { provider: string; model: string } => {
  let provider = meta.provider || 'openai'
  let model = meta.providerModel || 'text-embedding-3-small'
  if (provider.includes(':') && !meta.providerModel) {
    const parts = provider.split(':')
    provider = parts[0]!
    model = parts[1] || model
  }
  return { provider, model }
}

export const migrateLegacyEmbeddings = (
  rootPath: string,
): Effect.Effect<
  { namespace: string; vectorCount: number } | null,
  EmbeddingNamespaceError
> =>
  Effect.gen(function* () {
    if (!(yield* hasLegacyEmbeddings(rootPath))) return null

    const meta = yield* readLegacyMetadata(rootPath)
    if (!meta) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message:
            'Could not read legacy metadata. Embeddings may be corrupted.',
        }),
      )
    }

    const { provider, model } = resolveProvider(meta)
    const namespace = generateNamespace(provider, model, meta.dimensions)
    yield* Effect.tryPromise({
      try: () => fs.mkdir(getNamespaceDir(rootPath, namespace), { recursive: true }),
      catch: (cause) =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: `Failed to create namespace directory: ${cause}`,
          cause,
        }),
    })
    yield* Effect.tryPromise({
      try: () =>
        fs.rename(
          getLegacyVectorPath(rootPath),
          getVectorPath(rootPath, namespace),
        ),
      catch: (cause) =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: `Failed to move vector file: ${cause}`,
          cause,
        }),
    })
    yield* Effect.tryPromise({
      try: () =>
        fs.writeFile(
          getMetaPath(rootPath, namespace),
          msgpack.encode({ ...meta, provider, providerModel: model }),
        ),
      catch: (cause) =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: `Failed to write metadata: ${cause}`,
          cause,
        }),
    })

    yield* Effect.tryPromise({
      try: () => fs.unlink(getLegacyMetaPath(rootPath)).catch(() => {}),
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: 'Failed to remove legacy bin meta',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    yield* Effect.tryPromise({
      try: () => fs.unlink(getLegacyMetaJsonPath(rootPath)).catch(() => {}),
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: 'Failed to remove legacy json meta',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    yield* writeActiveProvider(rootPath, {
      namespace,
      provider,
      model,
      dimensions: meta.dimensions,
      activatedAt: new Date().toISOString(),
    })
    return { namespace, vectorCount: Object.keys(meta.entries).length }
  })
