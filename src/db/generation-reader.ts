import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect, Either } from 'effect'
import {
  createDurableRecordLink,
  type DurabilityFileSystem,
  nodeDurabilityFileSystem,
  syncDirectory,
} from './fs-durability.js'
import {
  errorCode,
  GenerationReadError,
  type GenerationReadOperation,
  type ProcessIdentityError,
} from './generation-errors.js'
import {
  generationHomeLayout,
  generationLayout,
  portablePath,
  readCurrentGeneration,
} from './generation-paths.js'
import type {
  GenerationLayout,
  GenerationLeaseRecord,
  GenerationReadSession,
} from './generation-types.js'
import {
  hasValidIdentity,
  nodeProcessInspector,
  type ProcessInspector,
} from './process-identity.js'

export type { GenerationLeaseRecord, GenerationReadSession }

export type GenerationReaderCheckpoint =
  | 'after-current-read'
  | 'after-lease-insert'
  | 'before-current-reread'
  | 'before-lease-insert'

type ReaderPathKind = 'directory' | 'file' | 'missing' | 'other'

export interface GenerationReaderFileSystem extends DurabilityFileSystem {
  readonly checkpoint: (
    phase: GenerationReaderCheckpoint,
    layout: GenerationLayout,
  ) => Promise<void>
  readonly makeDirectory: (
    directoryPath: string,
    recursive: boolean,
  ) => Promise<void>
  readonly pathKind: (targetPath: string) => Promise<ReaderPathKind>
}

export interface GenerationReaderOptions {
  readonly inspector?: ProcessInspector
  readonly fileSystem?: GenerationReaderFileSystem
}

export const nodeGenerationReaderFileSystem: GenerationReaderFileSystem = {
  ...nodeDurabilityFileSystem,
  checkpoint: async () => undefined,
  makeDirectory: async (directoryPath, recursive) => {
    await fs.mkdir(directoryPath, { recursive })
  },
  pathKind: async (targetPath) => {
    try {
      const stat = await fs.lstat(targetPath)
      if (stat.isDirectory()) return 'directory'
      if (stat.isFile()) return 'file'
      return 'other'
    } catch (cause) {
      if (errorCode(cause) === 'ENOENT') return 'missing'
      throw cause
    }
  },
}

interface AcquiredLease {
  readonly session: GenerationReadSession
  readonly release: Effect.Effect<void, GenerationReadError>
}

const generationReadError = (
  operation: GenerationReadOperation,
  targetPath: string,
  cause: unknown,
): GenerationReadError =>
  new GenerationReadError({
    operation,
    path: portablePath(targetPath),
    message: `${operation} generation read failed for ${portablePath(
      targetPath,
    )}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  })

const attempt = <A>(
  operation: GenerationReadOperation,
  targetPath: string,
  action: () => Promise<A>,
): Effect.Effect<A, GenerationReadError> =>
  Effect.tryPromise({
    try: action,
    catch: (cause) => generationReadError(operation, targetPath, cause),
  })

const encodeLease = (record: GenerationLeaseRecord): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(record))

export const parseGenerationLeaseRecord = (
  value: unknown,
): GenerationLeaseRecord | null => {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<GenerationLeaseRecord>
  if (
    typeof candidate.leaseId !== 'string' ||
    candidate.leaseId.length === 0 ||
    typeof candidate.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.createdAt)) ||
    candidate.holder === undefined ||
    !hasValidIdentity(candidate.holder)
  ) {
    return null
  }
  return candidate as GenerationLeaseRecord
}

const checkpoint = (
  phase: GenerationReaderCheckpoint,
  layout: GenerationLayout,
  fileSystem: GenerationReaderFileSystem,
): Effect.Effect<void, GenerationReadError> =>
  attempt('verify-lease', layout.root, () =>
    fileSystem.checkpoint(phase, layout),
  )

const pathKind = (
  targetPath: string,
  fileSystem: GenerationReaderFileSystem,
): Effect.Effect<ReaderPathKind, GenerationReadError> =>
  attempt('verify-lease', targetPath, () => fileSystem.pathKind(targetPath))

const removeLeaseAt = (
  targetPath: string,
  movedTargetPath: string,
  fileSystem: GenerationReaderFileSystem,
): Effect.Effect<boolean, GenerationReadError> =>
  Effect.gen(function* () {
    const removed = yield* attempt('release-lease', targetPath, async () => {
      try {
        await fileSystem.unlink(targetPath)
        return true
      } catch (cause) {
        if (errorCode(cause) === 'ENOENT') return false
        throw cause
      }
    })
    if (removed) {
      const primarySync = yield* Effect.either(
        syncDirectory(path.dirname(targetPath), fileSystem),
      )
      if (Either.isLeft(primarySync)) {
        if (errorCode(primarySync.left) !== 'ENOENT') {
          return yield* Effect.fail(
            generationReadError('release-lease', targetPath, primarySync.left),
          )
        }
        const movedSync = yield* Effect.either(
          syncDirectory(path.dirname(movedTargetPath), fileSystem),
        )
        if (
          Either.isLeft(movedSync) &&
          errorCode(movedSync.left) !== 'ENOENT'
        ) {
          return yield* Effect.fail(
            generationReadError(
              'release-lease',
              movedTargetPath,
              movedSync.left,
            ),
          )
        }
      }
    }
    return removed
  })

const leasePaths = (
  layout: GenerationLayout,
  leaseId: string,
): readonly [string, string] => [
  portablePath(path.join(layout.openLeases, leaseId)),
  portablePath(path.join(layout.closedLeases, leaseId)),
]

const releaseLease = (
  layout: GenerationLayout,
  leaseId: string,
  fileSystem: GenerationReaderFileSystem,
): Effect.Effect<void, GenerationReadError> =>
  Effect.gen(function* () {
    const [openPath, closedPath] = leasePaths(layout, leaseId)
    if (yield* removeLeaseAt(openPath, closedPath, fileSystem)) return
    yield* removeLeaseAt(closedPath, openPath, fileSystem)
  })

const leasePresent = (
  layout: GenerationLayout,
  leaseId: string,
  fileSystem: GenerationReaderFileSystem,
): Effect.Effect<boolean, GenerationReadError> =>
  Effect.gen(function* () {
    const [openPath, closedPath] = leasePaths(layout, leaseId)
    if ((yield* pathKind(openPath, fileSystem)) === 'file') return true
    return (yield* pathKind(closedPath, fileSystem)) === 'file'
  })

const currentGeneration = (
  home: string,
): Effect.Effect<
  import('./generation-types.js').GenerationName | null,
  GenerationReadError
> =>
  readCurrentGeneration(home).pipe(
    Effect.mapError((cause) =>
      generationReadError(
        'read-current',
        generationHomeLayout(home).current,
        cause,
      ),
    ),
  )

const acquireLease = (
  home: string,
  inspector: ProcessInspector,
  fileSystem: GenerationReaderFileSystem,
): Effect.Effect<AcquiredLease, GenerationReadError | ProcessIdentityError> =>
  Effect.gen(function* () {
    const holder = yield* inspector.current()
    const homeLayout = generationHomeLayout(home)

    while (true) {
      const current = yield* currentGeneration(home)
      if (current === null) {
        return yield* Effect.fail(
          generationReadError(
            'read-current',
            homeLayout.current,
            new Error('No current generation exists'),
          ),
        )
      }
      const layout = generationLayout(home, current)
      yield* checkpoint('after-current-read', layout, fileSystem)
      const record: GenerationLeaseRecord = {
        leaseId: randomUUID(),
        holder,
        createdAt: new Date().toISOString(),
      }
      const [openPath, closedPath] = leasePaths(layout, record.leaseId)
      yield* checkpoint('before-lease-insert', layout, fileSystem)
      const linkResult = yield* createDurableRecordLink(
        layout.leasesRoot,
        openPath,
        encodeLease(record),
        fileSystem,
        { movedTargetPath: closedPath },
      ).pipe(
        Effect.mapError((cause) =>
          generationReadError('insert-lease', openPath, cause),
        ),
      )
      if (linkResult !== 'linked') {
        yield* Effect.yieldNow()
        continue
      }

      yield* checkpoint('after-lease-insert', layout, fileSystem)
      yield* checkpoint('before-current-reread', layout, fileSystem)
      const confirmedCurrent = yield* currentGeneration(home)
      const admitted = yield* leasePresent(layout, record.leaseId, fileSystem)
      if (confirmedCurrent !== current || !admitted) {
        yield* releaseLease(layout, record.leaseId, fileSystem)
        continue
      }

      return {
        session: {
          home: layout.home,
          generation: layout.name,
          indexRoot: layout.root,
          leaseId: record.leaseId,
        },
        release: releaseLease(layout, record.leaseId, fileSystem),
      }
    }
  })

const initializeLeaseGateWith = (
  layout: GenerationLayout,
  fileSystem: GenerationReaderFileSystem,
): Effect.Effect<void, GenerationReadError> =>
  Effect.gen(function* () {
    const closedKind = yield* pathKind(layout.closedLeases, fileSystem)
    if (closedKind !== 'missing') {
      return yield* Effect.fail(
        generationReadError(
          'initialize-gate',
          layout.closedLeases,
          new Error('Closed lease gate cannot be reopened'),
        ),
      )
    }
    yield* attempt('initialize-gate', layout.leasesRoot, () =>
      fileSystem.makeDirectory(layout.leasesRoot, true),
    )
    const openKind = yield* pathKind(layout.openLeases, fileSystem)
    if (openKind === 'missing') {
      yield* attempt('initialize-gate', layout.openLeases, () =>
        fileSystem.makeDirectory(layout.openLeases, false),
      )
    } else if (openKind !== 'directory') {
      return yield* Effect.fail(
        generationReadError(
          'initialize-gate',
          layout.openLeases,
          new Error('Open lease gate must be a directory'),
        ),
      )
    }
    yield* syncDirectory(layout.leasesRoot, fileSystem).pipe(
      Effect.mapError((cause) =>
        generationReadError('initialize-gate', layout.leasesRoot, cause),
      ),
    )
  })

export const initializeLeaseGate = (
  layout: GenerationLayout,
  fileSystem: GenerationReaderFileSystem = nodeGenerationReaderFileSystem,
): Effect.Effect<void, GenerationReadError> =>
  initializeLeaseGateWith(layout, fileSystem)

export const withCurrentGeneration = <A, E>(
  home: string,
  use: (session: GenerationReadSession) => Effect.Effect<A, E>,
  options: GenerationReaderOptions = {},
): Effect.Effect<A, E | GenerationReadError | ProcessIdentityError> => {
  const fileSystem = options.fileSystem ?? nodeGenerationReaderFileSystem
  const inspector = options.inspector ?? nodeProcessInspector
  return Effect.acquireUseRelease(
    acquireLease(home, inspector, fileSystem),
    (lease) => use(lease.session),
    (lease) => lease.release.pipe(Effect.orDie),
  )
}
