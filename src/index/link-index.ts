import * as path from 'node:path'
import { Effect } from 'effect'
import {
  canonicalizeSourceFile,
  type DeclaredPath,
  expandDeclaredPath,
  isPathWithin,
} from '../db/canonical.js'
import type { FileReadError, IndexCorruptedError } from '../errors/index.js'
import { dbIndexDir, resolveMdmHome } from '../home.js'
import { createStorage, loadLinkIndex } from './storage.js'

export const resolveInternalLink = (
  href: string,
  fromPath: string,
  rootPath: string,
  caseSensitive = true,
): DeclaredPath | null => {
  if (href.startsWith('#')) return expandDeclaredPath(fromPath)
  if (href.startsWith('http://') || href.startsWith('https://')) return null

  const linkPath = href.split('#')[0] ?? ''
  if (!linkPath) return null

  const resolved = path.resolve(path.dirname(fromPath), linkPath)
  if (!isPathWithin(resolved, rootPath, caseSensitive)) return null
  return expandDeclaredPath(resolved)
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
