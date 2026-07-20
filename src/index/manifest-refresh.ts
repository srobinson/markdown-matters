import { Effect } from 'effect'

import type {
  GenerationWriteError,
  ProcessIdentityError,
  WriterLockError,
} from '../db/generation-errors.js'
import type {
  GenerationName,
  PublishedGeneration,
} from '../db/generation-types.js'
import type { GenerationValidationFailure } from '../db/generation-validation.js'
import { writeGeneration } from '../db/generation-writer.js'
import {
  appendManifestDirectory,
  loadManifest,
  ManifestError,
  manifestPath,
} from '../manifest.js'
import type { IndexOptions } from './index-build.js'
import { buildManifestIndex } from './manifest-build.js'
import type { IndexResult } from './types.js'

export interface ManifestRefreshContext {
  readonly home: string
  readonly generation: GenerationName
  readonly sourceRoot: string
  readonly indexRoot: string
}

export interface ManifestRefreshOptions<E>
  extends Omit<IndexOptions, 'indexRoot'> {
  readonly complete?: (
    context: ManifestRefreshContext,
  ) => Effect.Effect<void, E>
}

export type ManifestRefreshError =
  | ManifestError
  | GenerationWriteError
  | WriterLockError
  | ProcessIdentityError
  | GenerationValidationFailure
  | Effect.Effect.Error<ReturnType<typeof buildManifestIndex>>

export const refreshManifestIndex = <E = never>(
  home: string,
  requestedPath: string | undefined,
  options: ManifestRefreshOptions<E>,
): Effect.Effect<
  PublishedGeneration<IndexResult>,
  ManifestRefreshError | E
> => {
  const { complete, ...indexOptions } = options
  return writeGeneration({
    home,
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

        const result = yield* buildManifestIndex(manifest, {
          ...indexOptions,
          indexRoot: generation.indexRoot,
        })
        if (complete) {
          yield* complete({
            home,
            generation: generation.generation,
            sourceRoot: home,
            indexRoot: generation.indexRoot,
          })
        }
        return result
      }),
    validate: () => Effect.void,
  })
}
