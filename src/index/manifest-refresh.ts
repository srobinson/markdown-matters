import { Effect } from 'effect'

import type {
  GenerationWriteError,
  ProcessIdentityError,
  WriterLockError,
} from '../db/generation-errors.js'
import { generationLayout } from '../db/generation-paths.js'
import type {
  GenerationPreflight,
  PublishedGeneration,
} from '../db/generation-types.js'
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
import {
  buildManifestIndex,
  type ManifestBuildResult,
  semanticIndexChanged,
} from './manifest-build.js'
import {
  refreshSemanticGeneration,
  type SemanticRefreshError,
  type SemanticRefreshOptions,
} from './semantic-refresh.js'
import type { IndexResult } from './types.js'

interface ManifestGenerationResult {
  readonly index: ManifestBuildResult
  readonly semantic: BuildEmbeddingsResult | null
  readonly mutation: ManifestMutationSummary
}

export interface ManifestMutationSummary {
  readonly structural: boolean
  readonly semantic: boolean
  readonly changed: boolean
}

export interface ManifestRefreshResult
  extends PublishedGeneration<IndexResult> {
  readonly semantic: BuildEmbeddingsResult | null
  readonly mutation: ManifestMutationSummary
}

export interface ManifestRefreshOptions<P = never>
  extends Omit<IndexOptions, 'indexRoot'> {
  readonly semantic?: SemanticRefreshOptions | undefined
  readonly preflight?: GenerationPreflight<P> | undefined
}

export type ManifestRefreshError<P = never> =
  | ManifestError
  | GenerationWriteError
  | WriterLockError
  | ProcessIdentityError
  | GenerationValidationFailure
  | Effect.Effect.Error<ReturnType<typeof buildManifestIndex>>
  | SemanticRefreshError
  | P

export const refreshManifestIndex = <P = never>(
  home: string,
  requestedPath: string | undefined,
  options: ManifestRefreshOptions<P>,
): Effect.Effect<ManifestRefreshResult, ManifestRefreshError<P>> => {
  const { semantic = { mode: 'active' }, preflight, ...indexOptions } = options
  return writeGeneration<
    ManifestGenerationResult,
    ManifestRefreshError<P>,
    never,
    P
  >({
    home,
    ...(preflight ? { preflight } : {}),
    ...(requestedPath === undefined
      ? {}
      : {
          prepare: () => appendManifestDirectory(home, { path: requestedPath }),
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

        const currentIndexRoot = generation.previous
          ? generationLayout(home, generation.previous).root
          : undefined
        const index = yield* buildManifestIndex(manifest, {
          ...indexOptions,
          indexRoot: generation.indexRoot,
          currentIndexRoot,
          reconcileVectors: semantic.mode !== 'skip',
        })
        const semanticResult = yield* refreshSemanticGeneration(
          home,
          generation.indexRoot,
          semantic,
        )
        const semanticChanged = currentIndexRoot
          ? yield* semanticIndexChanged(currentIndexRoot, generation.indexRoot)
          : true
        const mutation: ManifestMutationSummary = {
          structural: index.mutation.structural,
          semantic: semanticChanged,
          changed: index.mutation.structural || semanticChanged,
        }
        return { index, semantic: semanticResult, mutation }
      }),
    validate: () => Effect.void,
    shouldPublish: (_, result) => result.mutation.changed,
  }).pipe(
    Effect.map((published) => ({
      generation: published.generation,
      indexRoot: published.indexRoot,
      value: published.value.index,
      semantic: published.value.semantic,
      mutation: published.value.mutation,
    })),
  )
}
