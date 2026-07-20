import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import {
  GenerationDurabilityError,
  type GenerationDurabilityOperation,
} from './generation-errors.js'
import { portablePath } from './generation-paths.js'

export interface DurabilityFileHandle {
  readonly sync: () => Promise<void>
  readonly close: () => Promise<void>
}

export interface DurabilityDirectoryEntry {
  readonly name: string
  readonly kind: 'directory' | 'file' | 'unsupported'
}

export interface DurabilityFileSystem {
  readonly platform: NodeJS.Platform
  readonly temporaryPath: (directoryPath: string) => string
  readonly openFile: (filePath: string) => Promise<DurabilityFileHandle>
  readonly openDirectory: (
    directoryPath: string,
  ) => Promise<DurabilityFileHandle>
  readonly readDirectory: (
    directoryPath: string,
  ) => Promise<readonly DurabilityDirectoryEntry[]>
  readonly writeFile: (
    filePath: string,
    contents: string | Uint8Array,
    exclusive: boolean,
  ) => Promise<void>
  readonly rename: (sourcePath: string, targetPath: string) => Promise<void>
  readonly link: (sourcePath: string, targetPath: string) => Promise<void>
}

export interface PreparedRecord {
  readonly path: string
}

const directoryEntry = (entry: Dirent): DurabilityDirectoryEntry => ({
  name: entry.name,
  kind: entry.isDirectory()
    ? 'directory'
    : entry.isFile()
      ? 'file'
      : 'unsupported',
})

export const nodeDurabilityFileSystem: DurabilityFileSystem = {
  platform: process.platform,
  temporaryPath: (directoryPath) =>
    path.join(directoryPath, `.record-${randomUUID()}.tmp`),
  // Node does not expose macOS F_FULLFSYNC, so these syncs are best effort there.
  openFile: (filePath) => fs.open(filePath, 'r+'),
  openDirectory: (directoryPath) => fs.open(directoryPath, 'r'),
  readDirectory: async (directoryPath) =>
    (await fs.readdir(directoryPath, { withFileTypes: true })).map(
      directoryEntry,
    ),
  writeFile: async (filePath, contents, exclusive) => {
    await fs.writeFile(filePath, contents, { flag: exclusive ? 'wx' : 'w' })
  },
  rename: (sourcePath, targetPath) => fs.rename(sourcePath, targetPath),
  link: (sourcePath, targetPath) => fs.link(sourcePath, targetPath),
}

const durabilityError = (
  operation: GenerationDurabilityOperation,
  targetPath: string,
  cause: unknown,
): GenerationDurabilityError =>
  new GenerationDurabilityError({
    operation,
    path: portablePath(targetPath),
    message: `${operation} failed for ${portablePath(targetPath)}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    cause,
  })

const attempt = <A>(
  operation: GenerationDurabilityOperation,
  targetPath: string,
  action: () => Promise<A>,
): Effect.Effect<A, GenerationDurabilityError> =>
  Effect.tryPromise({
    try: action,
    catch: (cause) => durabilityError(operation, targetPath, cause),
  })

const syncPath = (
  targetPath: string,
  operation: 'sync-directory' | 'sync-file',
  open: () => Promise<DurabilityFileHandle>,
): Effect.Effect<void, GenerationDurabilityError> =>
  attempt(operation, targetPath, async () => {
    const handle = await open()
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  })

export const syncFile = (
  filePath: string,
  fileSystem: DurabilityFileSystem = nodeDurabilityFileSystem,
): Effect.Effect<void, GenerationDurabilityError> =>
  syncPath(filePath, 'sync-file', () => fileSystem.openFile(filePath))

export const syncDirectory = (
  directoryPath: string,
  fileSystem: DurabilityFileSystem = nodeDurabilityFileSystem,
): Effect.Effect<void, GenerationDurabilityError> => {
  if (fileSystem.platform === 'win32') return Effect.void
  if (fileSystem.platform === 'linux' || fileSystem.platform === 'darwin') {
    return syncPath(directoryPath, 'sync-directory', () =>
      fileSystem.openDirectory(directoryPath),
    )
  }
  return Effect.fail(
    durabilityError(
      'sync-directory',
      directoryPath,
      new Error(
        `Directory sync has no defined policy for ${fileSystem.platform}`,
      ),
    ),
  )
}

const syncTreeWith = (
  rootPath: string,
  fileSystem: DurabilityFileSystem,
): Effect.Effect<void, GenerationDurabilityError> =>
  Effect.gen(function* () {
    const entries = yield* attempt('read-directory', rootPath, () =>
      fileSystem.readDirectory(rootPath),
    )

    for (const entry of [...entries].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const childPath = path.join(rootPath, entry.name)
      if (entry.kind === 'directory') {
        yield* syncTreeWith(childPath, fileSystem)
      } else if (entry.kind === 'file') {
        yield* syncFile(childPath, fileSystem)
      } else {
        return yield* Effect.fail(
          durabilityError(
            'read-directory',
            childPath,
            new Error('Unsupported filesystem entry type'),
          ),
        )
      }
    }

    yield* syncDirectory(rootPath, fileSystem)
  })

export const syncTree = (
  rootPath: string,
  fileSystem: DurabilityFileSystem = nodeDurabilityFileSystem,
): Effect.Effect<void, GenerationDurabilityError> =>
  syncTreeWith(rootPath, fileSystem)

export const durableReplaceText = (
  targetPath: string,
  contents: string,
  fileSystem: DurabilityFileSystem = nodeDurabilityFileSystem,
): Effect.Effect<void, GenerationDurabilityError> =>
  Effect.gen(function* () {
    const directoryPath = path.dirname(targetPath)
    const temporaryPath = path.join(
      directoryPath,
      `${path.basename(targetPath)}.tmp`,
    )
    yield* attempt('write-file', temporaryPath, () =>
      fileSystem.writeFile(temporaryPath, contents, false),
    )
    yield* syncFile(temporaryPath, fileSystem)
    yield* attempt('rename', targetPath, () =>
      fileSystem.rename(temporaryPath, targetPath),
    )
    yield* syncDirectory(directoryPath, fileSystem)
  })

export const prepareDurableRecord = (
  directoryPath: string,
  contents: Uint8Array,
  fileSystem: DurabilityFileSystem = nodeDurabilityFileSystem,
): Effect.Effect<PreparedRecord, GenerationDurabilityError> =>
  Effect.gen(function* () {
    const temporaryPath = fileSystem.temporaryPath(directoryPath)
    yield* attempt('write-file', temporaryPath, () =>
      fileSystem.writeFile(temporaryPath, contents, true),
    )
    yield* syncFile(temporaryPath, fileSystem)
    return { path: portablePath(temporaryPath) }
  })

export const linkPreparedRecord = (
  record: PreparedRecord,
  targetPath: string,
  fileSystem: DurabilityFileSystem = nodeDurabilityFileSystem,
): Effect.Effect<void, GenerationDurabilityError> =>
  Effect.gen(function* () {
    yield* attempt('link', targetPath, () =>
      fileSystem.link(record.path, targetPath),
    )
    yield* syncDirectory(path.dirname(targetPath), fileSystem)
  })
