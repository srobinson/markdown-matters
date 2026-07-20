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
  documentHash: Schema.String,
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

export const decodeVectorIndex = (
  raw: unknown,
): Effect.Effect<VectorIndex, VectorStoreError> =>
  Schema.decodeUnknown(VectorIndexSchema)(raw).pipe(
    Effect.mapError(
      (parseError) =>
        new VectorStoreError({
          operation: 'load',
          message: `Corrupted vector metadata (binary): schema validation failed: ${String(parseError)}`,
        }),
    ),
    Effect.map((validated) => validated as unknown as VectorIndex),
  )

const readRawVectorIndex = (
  metaPath: string,
): Effect.Effect<unknown, VectorStoreError> =>
  Effect.tryPromise({
    try: async () => msgpack.decode(await fs.readFile(metaPath)) as unknown,
    catch: (cause) =>
      new VectorStoreError({
        operation: 'load',
        message: `Failed to read metadata: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  })

export const loadVectorIndex = (
  metaPath: string,
): Effect.Effect<VectorIndex, VectorStoreError> =>
  readRawVectorIndex(metaPath).pipe(Effect.flatMap(decodeVectorIndex))

export const writeVectorIndex = (
  metaPath: string,
  meta: VectorIndex,
): Promise<void> => fs.writeFile(metaPath, msgpack.encode(meta))
