import * as fs from 'node:fs/promises'
import * as msgpack from '@msgpack/msgpack'
import { Effect, Schema } from 'effect'
import { CANONICAL_SCHEMA_VERSION, DocumentKeySchema } from '../db/canonical.js'
import { VectorStoreError } from '../errors/index.js'
import type { VectorIndex } from './types.js'

const NullishString = Schema.Union(Schema.String, Schema.Null, Schema.Undefined)

const VectorEntrySchema = Schema.Struct({
  id: Schema.String,
  sectionId: Schema.String,
  documentPath: DocumentKeySchema,
  heading: Schema.String,
  embedding: Schema.Array(Schema.Number),
})

const HnswIndexParamsSchema = Schema.Struct({
  m: Schema.Number,
  efConstruction: Schema.Number,
})

const VectorIndexSchema = Schema.Struct({
  version: Schema.Literal(CANONICAL_SCHEMA_VERSION),
  provider: Schema.String,
  providerModel: Schema.optional(NullishString),
  providerBaseURL: Schema.optional(NullishString),
  dimensions: Schema.Number,
  entries: Schema.Record({ key: Schema.String, value: VectorEntrySchema }),
  totalCost: Schema.Number,
  totalTokens: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  hnswParams: Schema.optional(
    Schema.Union(HnswIndexParamsSchema, Schema.Null, Schema.Undefined),
  ),
})

export type VectorIndexSource = 'binary' | 'json'

export interface LoadedVectorIndex {
  readonly meta: VectorIndex
  readonly source: VectorIndexSource
}

export const decodeVectorIndex = (
  raw: unknown,
  source: VectorIndexSource,
): Effect.Effect<VectorIndex, VectorStoreError> =>
  Schema.decodeUnknown(VectorIndexSchema)(raw).pipe(
    Effect.mapError(
      (parseError) =>
        new VectorStoreError({
          operation: 'load',
          message: `Corrupted vector metadata (${source}): schema validation failed: ${String(parseError)}`,
        }),
    ),
    Effect.map((validated) => validated as unknown as VectorIndex),
  )

const readRawVectorIndex = (
  metaPath: string,
): Effect.Effect<
  { data: unknown; source: VectorIndexSource },
  VectorStoreError
> =>
  Effect.tryPromise({
    try: async () => {
      try {
        await fs.access(metaPath)
        return {
          data: msgpack.decode(await fs.readFile(metaPath)) as unknown,
          source: 'binary' as const,
        }
      } catch {
        const jsonPath = metaPath.replace('.bin', '.json')
        try {
          await fs.access(jsonPath)
          return {
            data: JSON.parse(await fs.readFile(jsonPath, 'utf-8')) as unknown,
            source: 'json' as const,
          }
        } catch {
          throw new Error('Metadata file not found')
        }
      }
    },
    catch: (cause) =>
      new VectorStoreError({
        operation: 'load',
        message: `Failed to read metadata: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  })

export const loadVectorIndex = (
  metaPath: string,
): Effect.Effect<LoadedVectorIndex, VectorStoreError> =>
  Effect.gen(function* () {
    const raw = yield* readRawVectorIndex(metaPath)
    const patched =
      raw.data &&
      typeof raw.data === 'object' &&
      !(
        'provider' in raw.data && (raw.data as Record<string, unknown>).provider
      )
        ? { ...raw.data, provider: 'openai' }
        : raw.data
    return {
      meta: yield* decodeVectorIndex(patched, raw.source),
      source: raw.source,
    }
  })

export const writeVectorIndex = (
  metaPath: string,
  meta: VectorIndex,
): Promise<void> => fs.writeFile(metaPath, msgpack.encode(meta))

export const migrateJsonVectorIndex = (
  metaPath: string,
  meta: VectorIndex,
): Effect.Effect<void, never> =>
  Effect.tryPromise({
    try: async () => {
      await writeVectorIndex(metaPath, meta)
      await fs.unlink(metaPath.replace('.bin', '.json')).catch(() => {})
    },
    catch: () =>
      new VectorStoreError({
        operation: 'load',
        message: 'Failed to migrate metadata to binary format',
      }),
  }).pipe(Effect.catchAll(() => Effect.void))
