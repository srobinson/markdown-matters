import * as path from 'node:path'

import { Data, Effect } from 'effect'

import { candidatesWithinRoots } from '../db/canonical.js'
import type { GenerationReadSession } from '../db/generation-reader.js'
import { resolveIndexedDocumentKey } from '../index/link-index.js'
import { loadManifest } from '../manifest.js'

export class PathNotInIndexedCorpusError extends Data.TaggedError(
  'PathNotInIndexedCorpusError',
)<{
  readonly path: string
  readonly message: string
}> {}

const notInCorpus = (filePath: string): PathNotInIndexedCorpusError =>
  new PathNotInIndexedCorpusError({
    path: filePath,
    message: `Path not in indexed corpus: ${filePath}`,
  })

export const resolveMcpDocumentPath = (
  session: GenerationReadSession,
  filePath: string,
) =>
  Effect.gen(function* () {
    const manifest = yield* loadManifest(session.home)
    const roots = manifest.directories.map((directory) => directory.path)
    const candidates = yield* Effect.promise(() =>
      candidatesWithinRoots(roots, filePath),
    )

    if (candidates.length === 0)
      return yield* Effect.fail(notInCorpus(filePath))

    for (const candidate of path.isAbsolute(filePath)
      ? candidates.slice(0, 1)
      : candidates) {
      const documentKey = yield* resolveIndexedDocumentKey(session, candidate)
      if (documentKey !== null) return documentKey
    }

    return candidates[0]!
  })
