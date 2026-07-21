import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect, Either } from 'effect'
import { evictHnswGeneration } from '../embeddings/hnsw-cache.js'
import { clearIndexCache } from '../index/storage.js'
import {
  removeFileSystemPath,
  syncDirectory,
  syncFile,
} from './fs-durability.js'
import {
  errorCode,
  GenerationReaperError,
  type GenerationReaperOperation,
  type ProcessIdentityError,
} from './generation-errors.js'
import {
  generationHomeLayout,
  generationLayout,
  isGenerationName,
  portablePath,
  readCurrentGeneration,
} from './generation-paths.js'
import {
  type GenerationReaderFileSystem,
  nodeGenerationReaderFileSystem,
  parseGenerationLeaseRecord,
} from './generation-reader.js'
import type {
  GenerationLayout,
  GenerationName,
  GenerationReaperOptions,
  ReapResult,
} from './generation-types.js'
import {
  isAbandoned,
  nodeProcessInspector,
  type ProcessInspector,
} from './process-identity.js'

export type { GenerationReaperOptions, ReapResult }

const DEFAULT_REAP_GRACE_MS = 30_000
const GATE_STATE_FILE = '.reap-state'
const GATE_PENDING = 'pending'
const GATE_READY = 'ready'

export interface GenerationReaperFileSystem extends GenerationReaderFileSystem {
  readonly readFile: (filePath: string) => Promise<string>
  readonly statMtime: (targetPath: string) => Promise<number>
  readonly touchDirectory: (
    directoryPath: string,
    timestampMs: number,
  ) => Promise<void>
  readonly remove: (targetPath: string, recursive: boolean) => Promise<void>
}

export interface GenerationReaperRuntime {
  readonly fileSystem?: GenerationReaperFileSystem
  readonly beforeDelete?: (layout: GenerationLayout) => Promise<void>
}

export const nodeGenerationReaperFileSystem: GenerationReaperFileSystem = {
  ...nodeGenerationReaderFileSystem,
  readFile: (filePath) => fs.readFile(filePath, 'utf8'),
  statMtime: async (targetPath) => (await fs.stat(targetPath)).mtimeMs,
  touchDirectory: async (directoryPath, timestampMs) => {
    const timestamp = new Date(timestampMs)
    await fs.utimes(directoryPath, timestamp, timestamp)
  },
  remove: removeFileSystemPath,
}

const reaperError = (
  operation: GenerationReaperOperation,
  targetPath: string,
  cause: unknown,
): GenerationReaperError =>
  new GenerationReaperError({
    operation,
    path: portablePath(targetPath),
    message: `${operation} failed for ${portablePath(targetPath)}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    cause,
  })

const attempt = <A>(
  operation: GenerationReaperOperation,
  targetPath: string,
  action: () => Promise<A>,
): Effect.Effect<A, GenerationReaperError> =>
  Effect.tryPromise({
    try: action,
    catch: (cause) => reaperError(operation, targetPath, cause),
  })

const generationOrdinal = (generation: GenerationName): bigint =>
  BigInt(generation.slice('gen-'.length))

const currentGeneration = (
  home: string,
): Effect.Effect<GenerationName | null, GenerationReaperError> =>
  readCurrentGeneration(home).pipe(
    Effect.mapError((cause) =>
      reaperError(
        'inspect-generation',
        generationHomeLayout(home).current,
        cause,
      ),
    ),
  )

const touchGate = (
  layout: GenerationLayout,
  now: number,
  fileSystem: GenerationReaperFileSystem,
): Effect.Effect<void, GenerationReaperError> =>
  Effect.gen(function* () {
    yield* attempt('close-gate', layout.closedLeases, () =>
      fileSystem.touchDirectory(layout.closedLeases, now),
    )
    yield* syncDirectory(layout.closedLeases, fileSystem).pipe(
      Effect.mapError((cause) =>
        reaperError('close-gate', layout.closedLeases, cause),
      ),
    )
  })

const gateStatePath = (layout: GenerationLayout): string =>
  path.join(layout.leasesRoot, GATE_STATE_FILE)

const ensureGateState = (
  layout: GenerationLayout,
  fileSystem: GenerationReaperFileSystem,
): Effect.Effect<void, GenerationReaperError> =>
  Effect.gen(function* () {
    const statePath = gateStatePath(layout)
    const created = yield* attempt('close-gate', statePath, async () => {
      try {
        await fileSystem.writeFile(statePath, GATE_PENDING, true)
        return true
      } catch (cause) {
        if (errorCode(cause) === 'EEXIST') return false
        throw cause
      }
    })
    if (created) {
      yield* syncFile(statePath, fileSystem).pipe(
        Effect.mapError((cause) => reaperError('close-gate', statePath, cause)),
      )
      yield* syncDirectory(layout.leasesRoot, fileSystem).pipe(
        Effect.mapError((cause) =>
          reaperError('close-gate', layout.leasesRoot, cause),
        ),
      )
      return
    }
    const kind = yield* attempt('close-gate', statePath, () =>
      fileSystem.pathKind(statePath),
    )
    if (kind !== 'file') {
      return yield* Effect.fail(
        reaperError(
          'close-gate',
          statePath,
          new Error('Gate state must be a regular file'),
        ),
      )
    }
  })

const finalizeGateState = (
  layout: GenerationLayout,
  now: number,
  fileSystem: GenerationReaperFileSystem,
): Effect.Effect<void, GenerationReaperError> =>
  Effect.gen(function* () {
    yield* ensureGateState(layout, fileSystem)
    yield* syncDirectory(layout.leasesRoot, fileSystem).pipe(
      Effect.mapError((cause) =>
        reaperError('close-gate', layout.leasesRoot, cause),
      ),
    )
    const statePath = gateStatePath(layout)
    const state = yield* attempt('close-gate', statePath, () =>
      fileSystem.readFile(statePath),
    )
    if (state === GATE_READY) return

    yield* touchGate(layout, now, fileSystem)
    yield* attempt('close-gate', statePath, () =>
      fileSystem.writeFile(statePath, GATE_READY, false),
    )
    yield* syncFile(statePath, fileSystem).pipe(
      Effect.mapError((cause) => reaperError('close-gate', statePath, cause)),
    )
  })

const closeGate = (
  layout: GenerationLayout,
  now: number,
  fileSystem: GenerationReaperFileSystem,
): Effect.Effect<boolean, GenerationReaperError> =>
  Effect.gen(function* () {
    const closedKind = yield* attempt('close-gate', layout.closedLeases, () =>
      fileSystem.pathKind(layout.closedLeases),
    )
    if (closedKind === 'directory') {
      yield* finalizeGateState(layout, now, fileSystem)
      return true
    }
    if (closedKind !== 'missing') {
      return yield* Effect.fail(
        reaperError(
          'close-gate',
          layout.closedLeases,
          new Error('Closed lease gate must be a directory'),
        ),
      )
    }

    const openKind = yield* attempt('close-gate', layout.openLeases, () =>
      fileSystem.pathKind(layout.openLeases),
    )
    if (openKind === 'missing') {
      const racedClosed = yield* attempt(
        'close-gate',
        layout.closedLeases,
        () => fileSystem.pathKind(layout.closedLeases),
      )
      if (racedClosed === 'directory') {
        yield* finalizeGateState(layout, now, fileSystem)
        return true
      }
      const rootKind = yield* attempt('close-gate', layout.root, () =>
        fileSystem.pathKind(layout.root),
      )
      if (rootKind === 'missing') return false
    }
    if (openKind !== 'directory') {
      return yield* Effect.fail(
        reaperError(
          'close-gate',
          layout.openLeases,
          new Error('Open lease gate must be a directory'),
        ),
      )
    }

    yield* ensureGateState(layout, fileSystem)
    const renamed = yield* Effect.either(
      attempt('close-gate', layout.closedLeases, () =>
        fileSystem.rename(layout.openLeases, layout.closedLeases),
      ),
    )
    if (Either.isLeft(renamed)) {
      const racedKind = yield* attempt('close-gate', layout.closedLeases, () =>
        fileSystem.pathKind(layout.closedLeases),
      )
      if (errorCode(renamed.left) === 'ENOENT' && racedKind === 'directory') {
        yield* finalizeGateState(layout, now, fileSystem)
        return true
      }
      const rootKind = yield* attempt('close-gate', layout.root, () =>
        fileSystem.pathKind(layout.root),
      )
      if (rootKind === 'missing') return false
      return yield* Effect.fail(renamed.left)
    }
    yield* finalizeGateState(layout, now, fileSystem)
    return true
  })

interface LeaseScan {
  readonly retained: number
  readonly removed: number
}

const removeLease = (
  leasePath: string,
  fileSystem: GenerationReaperFileSystem,
): Effect.Effect<boolean, GenerationReaperError> =>
  attempt('remove-lease', leasePath, async () => {
    try {
      await fileSystem.unlink(leasePath)
      return true
    } catch (cause) {
      if (errorCode(cause) === 'ENOENT') return false
      throw cause
    }
  })

const inspectLeases = (
  layout: GenerationLayout,
  inspector: ProcessInspector,
  fileSystem: GenerationReaperFileSystem,
): Effect.Effect<LeaseScan, GenerationReaperError | ProcessIdentityError> =>
  Effect.gen(function* () {
    const entries = yield* attempt('inspect-lease', layout.closedLeases, () =>
      fileSystem.readDirectory(layout.closedLeases),
    )
    let retained = 0
    let removed = 0
    for (const entry of entries) {
      if (entry.kind !== 'file') {
        retained += 1
        continue
      }
      const leasePath = path.join(layout.closedLeases, entry.name)
      const content = yield* Effect.either(
        attempt('inspect-lease', leasePath, () =>
          fileSystem.readFile(leasePath),
        ),
      )
      if (Either.isLeft(content)) {
        retained += 1
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(content.right) as unknown
      } catch {
        retained += 1
        continue
      }
      const lease = parseGenerationLeaseRecord(parsed)
      if (lease === null || !(yield* isAbandoned(lease.holder, inspector))) {
        retained += 1
        continue
      }
      if (yield* removeLease(leasePath, fileSystem)) removed += 1
    }
    return { retained, removed }
  })

const protectedResult = (generation: GenerationName): ReapResult => ({
  generation,
  status: 'current',
})

const isProtected = (
  generation: GenerationName,
  current: GenerationName | null,
): boolean =>
  current === null ||
  generationOrdinal(generation) >= generationOrdinal(current)

const evictGenerationCaches = (layout: GenerationLayout): void => {
  evictHnswGeneration(layout.home, layout.name)
  clearIndexCache(layout.root)
}

export const reapGeneration = (
  home: string,
  generation: GenerationName,
  options: GenerationReaperOptions,
  runtime: GenerationReaperRuntime = {},
): Effect.Effect<ReapResult, GenerationReaperError | ProcessIdentityError> => {
  const fileSystem = runtime.fileSystem ?? nodeGenerationReaperFileSystem
  const inspector = options.inspector ?? nodeProcessInspector
  const now = options.now ?? Date.now
  const graceMs = Math.max(0, options.graceMs)
  const layout = generationLayout(home, generation)

  return Effect.gen(function* () {
    const initialCurrent = yield* currentGeneration(home)
    if (isProtected(generation, initialCurrent))
      return protectedResult(generation)
    const rootKind = yield* attempt('inspect-generation', layout.root, () =>
      fileSystem.pathKind(layout.root),
    )
    if (rootKind === 'missing') return { generation, status: 'reaped' }
    if (rootKind !== 'directory') {
      return yield* Effect.fail(
        reaperError(
          'inspect-generation',
          layout.root,
          new Error('Generation root must be a directory'),
        ),
      )
    }

    if (!(yield* closeGate(layout, now(), fileSystem))) {
      return { generation, status: 'reaped' }
    }
    const leases = yield* inspectLeases(layout, inspector, fileSystem)
    if (leases.retained > 0) return { generation, status: 'leased' }
    if (leases.removed > 0) yield* touchGate(layout, now(), fileSystem)

    const drainedAt = yield* attempt(
      'inspect-generation',
      layout.closedLeases,
      () => fileSystem.statMtime(layout.closedLeases),
    )
    if (now() - drainedAt < graceMs) return { generation, status: 'grace' }

    if (runtime.beforeDelete) {
      yield* attempt('delete-generation', layout.root, () =>
        runtime.beforeDelete!(layout),
      )
    }
    const confirmedCurrent = yield* currentGeneration(home)
    if (isProtected(generation, confirmedCurrent)) {
      return protectedResult(generation)
    }
    yield* Effect.sync(() => evictGenerationCaches(layout))
    yield* attempt('delete-generation', layout.root, () =>
      fileSystem.remove(layout.root, true),
    )
    if (options.onReaped) {
      yield* Effect.try({
        try: () => options.onReaped!(layout),
        catch: (cause) => reaperError('delete-generation', layout.root, cause),
      })
    }
    return { generation, status: 'reaped' }
  })
}

export const reapOldGenerations = (
  home: string,
  options: GenerationReaperOptions,
  runtime: GenerationReaperRuntime = {},
): Effect.Effect<
  readonly ReapResult[],
  GenerationReaperError | ProcessIdentityError
> =>
  Effect.gen(function* () {
    const current = yield* currentGeneration(home)
    if (current === null) return []
    const layout = generationHomeLayout(home)
    const entries = yield* attempt('inspect-generation', layout.home, () =>
      (runtime.fileSystem ?? nodeGenerationReaperFileSystem).readDirectory(
        layout.home,
      ),
    )
    const candidates = entries
      .flatMap((entry) =>
        entry.kind === 'directory' &&
        isGenerationName(entry.name) &&
        generationOrdinal(entry.name) < generationOrdinal(current)
          ? [entry.name]
          : [],
      )
      .sort((left, right) =>
        generationOrdinal(left) < generationOrdinal(right) ? -1 : 1,
      )
    return yield* Effect.forEach(candidates, (generation) =>
      reapGeneration(home, generation, options, runtime),
    )
  })

export const scheduleGenerationReap = (home: string): void => {
  Effect.runFork(
    reapOldGenerations(home, { graceMs: DEFAULT_REAP_GRACE_MS }).pipe(
      Effect.catchAll(() => Effect.void),
    ),
  )
}
