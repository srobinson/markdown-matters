import { Effect } from 'effect'

import type {
  GenerationWriteError,
  ProcessIdentityError,
  WriterLockError,
} from '../db/generation-errors.js'
import type { PublishedGeneration } from '../db/generation-types.js'
import type { GenerationValidationFailure } from '../db/generation-validation.js'
import { writeGeneration } from '../db/generation-writer.js'
import type { BuildEmbeddingsResult } from '../embeddings/semantic-search.js'
import {
  appendManifestDirectory,
  loadManifest,
  ManifestError,
  manifestPath,
} from '../manifest.js'
import type { IndexOptions } from './index-build.js'
import { buildManifestIndex } from './manifest-build.js'
import {
  refreshSemanticGeneration,
  type SemanticRefreshError,
  type SemanticRefreshOptions,
} from './semantic-refresh.js'
import type { IndexResult } from './types.js'

interface ManifestGenerationResult {
  readonly index: IndexResult
  readonly semantic: BuildEmbeddingsResult | null
}

export interface ManifestRefreshResult
  extends PublishedGeneration<IndexResult> {
  readonly semantic: BuildEmbeddingsResult | null
}

export interface ManifestRefreshOptions
  extends Omit<IndexOptions, 'indexRoot'> {
  readonly semantic?: SemanticRefreshOptions | undefined
}

export type ManifestRefreshError =
  | ManifestError
  | GenerationWriteError
  | WriterLockError
  | ProcessIdentityError
  | GenerationValidationFailure
  | Effect.Effect.Error<ReturnType<typeof buildManifestIndex>>
  | SemanticRefreshError

export const refreshManifestIndex = (
  home: string,
  requestedPath: string | undefined,
  options: ManifestRefreshOptions,
): Effect.Effect<ManifestRefreshResult, ManifestRefreshError> => {
  const { semantic = { mode: 'active' }, ...indexOptions } = options
  return writeGeneration<ManifestGenerationResult, ManifestRefreshError, never>(
    {
      home,
      ...(requestedPath === undefined
        ? {}
        : {
            prepare: () =>
              appendManifestDirectory(home, { path: requestedPath }),
          }),
      build: (generation) =>
        Effect.gen(function* () {
          const manifest = yield* loadManifest(home)
          if (manifest.directories.length === 0) {
            return yield* Effect.fail(
              new ManifestError({
                path: manifestPath(home),
                message:
                  'Manifest has no directories. Run mdm index <dir> first.',
              }),
            )
          }

          const index = yield* buildManifestIndex(manifest, {
            ...indexOptions,
            indexRoot: generation.indexRoot,
            reconcileVectors: semantic.mode !== 'skip',
          })
          const semanticResult = yield* refreshSemanticGeneration(
            home,
            generation.indexRoot,
            semantic,
          )
          return { index, semantic: semanticResult }
        }),
      validate: () => Effect.void,
    },
  ).pipe(
    Effect.map((published) => ({
      generation: published.generation,
      indexRoot: published.indexRoot,
      value: published.value.index,
      semantic: published.value.semantic,
    })),
  )
}
