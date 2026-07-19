import * as path from 'node:path'
import { Effect } from 'effect'
import {
  type CanonicalSource,
  canonicalizeSourceFile,
  type DeclaredPath,
  type DocumentKey,
  expandDeclaredPath,
  fileIdentityKey,
  isPathWithin,
} from '../db/canonical.js'
import type { FileReadError, IndexCorruptedError } from '../errors/index.js'
import { dbIndexDir, resolveMdmHome } from '../home.js'
import { createStorage, loadDocumentIndex, loadLinkIndex } from './storage.js'

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
    const [documentIndex, linkIndex] = yield* Effect.all([
      loadDocumentIndex(storage),
      loadLinkIndex(storage),
    ])
    if (!linkIndex) return []
    const source = yield* canonicalizeSourceFile(filePath).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    )
    if (!source) return []
    const identity = fileIdentityKey(source.identity)
    const survivor = Object.values(documentIndex?.documents ?? {}).find(
      (entry) =>
        fileIdentityKey(entry.identity) === identity ||
        entry.paths.includes(source.key),
    )?.path
    return linkIndex[direction][survivor ?? source.key] ?? []
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
