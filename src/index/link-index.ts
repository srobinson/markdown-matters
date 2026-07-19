import * as path from 'node:path'
import { Effect } from 'effect'
import type { FileReadError, IndexCorruptedError } from '../errors/index.js'
import { dbIndexDir, resolveMdmHome } from '../home.js'
import { createStorage, loadLinkIndex } from './storage.js'

export const resolveInternalLink = (
  href: string,
  fromPath: string,
  rootPath: string,
): string | null => {
  if (href.startsWith('#')) return fromPath
  if (href.startsWith('http://') || href.startsWith('https://')) return null

  const linkPath = href.split('#')[0] ?? ''
  if (!linkPath) return null

  const resolved = path.resolve(path.dirname(fromPath), linkPath)
  if (!resolved.startsWith(rootPath)) return null
  return path.relative(rootPath, resolved)
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
    const relativePath = path.relative(
      storage.sourceRoot,
      path.resolve(filePath),
    )
    return linkIndex[direction][relativePath] ?? []
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
