import * as path from 'node:path'
import { Effect } from 'effect'
import {
  type CanonicalSource,
  canonicalizeSourceFile,
  type DeclaredPath,
  type DocumentKey,
  expandDeclaredPath,
  isPathWithin,
} from '../db/canonical.js'
import type { FileReadError, IndexCorruptedError } from '../errors/index.js'
import { dbIndexDir, resolveMdmHome } from '../home.js'
import { createStorage, loadLinkIndex } from './storage.js'

export type InternalLinkResolution =
  | { readonly kind: 'resolved'; readonly path: DocumentKey }
  | { readonly kind: 'broken'; readonly path: DeclaredPath }

export interface InternalLinkResolutionOptions {
  readonly canonicalize?: (
    value: string,
  ) => ReturnType<typeof canonicalizeSourceFile>
  readonly selectDocumentKey?: (source: CanonicalSource) => DocumentKey
}

export const resolveInternalLink = (
  href: string,
  fromPath: string,
  rootPath: string,
  caseSensitive = true,
  options: InternalLinkResolutionOptions = {},
): Effect.Effect<InternalLinkResolution | null> => {
  const canonicalize = options.canonicalize ?? canonicalizeSourceFile
  const selectDocumentKey =
    options.selectDocumentKey ?? ((source: CanonicalSource) => source.key)
  const classify = (declaredPath: DeclaredPath) =>
    canonicalize(declaredPath).pipe(
      Effect.map(
        (target): InternalLinkResolution => ({
          kind: 'resolved',
          path: selectDocumentKey(target),
        }),
      ),
      Effect.catchAll(() =>
        Effect.succeed<InternalLinkResolution>({
          kind: 'broken',
          path: declaredPath,
        }),
      ),
    )

  if (href.startsWith('#')) return classify(expandDeclaredPath(fromPath))
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return Effect.succeed(null)
  }

  const linkPath = href.split('#')[0] ?? ''
  if (!linkPath) return Effect.succeed(null)

  const resolved = path.resolve(path.dirname(fromPath), linkPath)
  if (!isPathWithin(resolved, rootPath, caseSensitive)) {
    return Effect.succeed(null)
  }
  return classify(expandDeclaredPath(resolved))
}

const loadLinksFor = (
  rootPath: string,
  filePath: string,
  direction: 'forward' | 'backward',
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath, dbIndexDir(resolveMdmHome()))
    const linkIndex = yield* loadLinkIndex(storage)
    if (!linkIndex) return []
    const source = yield* canonicalizeSourceFile(filePath).pipe(
      Effect.map((canonical) => canonical.key),
      Effect.catchAll(() => Effect.succeed(null)),
    )
    return source ? (linkIndex[direction][source] ?? []) : []
  })

export const getOutgoingLinks = (
  rootPath: string,
  filePath: string,
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  loadLinksFor(rootPath, filePath, 'forward')

export const getIncomingLinks = (
  rootPath: string,
  filePath: string,
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  loadLinksFor(rootPath, filePath, 'backward')

export const getBrokenLinks = (
  rootPath: string,
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    const linkIndex = yield* loadLinkIndex(
      createStorage(rootPath, dbIndexDir(resolveMdmHome())),
    )
    return linkIndex?.broken ?? []
  })
