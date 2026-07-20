import { Effect } from 'effect'

import { dbIndexDir } from '../home.js'
import {
  appendManifestDirectory,
  loadManifest,
  ManifestError,
  manifestPath,
} from '../manifest.js'
import type { IndexOptions } from './index-build.js'
import { buildManifestIndex } from './manifest-build.js'

export type ManifestRefreshOptions = Omit<IndexOptions, 'indexRoot'>

export const refreshManifestIndex = (
  home: string,
  requestedPath: string | undefined,
  options: ManifestRefreshOptions,
) =>
  Effect.gen(function* () {
    if (requestedPath !== undefined) {
      yield* appendManifestDirectory(home, { path: requestedPath })
    }

    const manifest = yield* loadManifest(home)
    if (manifest.directories.length === 0) {
      return yield* Effect.fail(
        new ManifestError({
          path: manifestPath(home),
          message: 'Manifest has no directories. Run mdm index <dir> first.',
        }),
      )
    }

    return yield* buildManifestIndex(manifest, {
      ...options,
      indexRoot: dbIndexDir(home),
    })
  })
