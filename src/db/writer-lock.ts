import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { Effect, Exit } from 'effect'
import { createDurableRecordLink, syncDirectory } from './fs-durability.js'
import {
  errorCode,
  type ProcessIdentityError,
  WriterLockError,
  type WriterLockOperation,
} from './generation-errors.js'
import { generationHomeLayout, portablePath } from './generation-paths.js'
import type { WriterLockRecord } from './generation-types.js'
import {
  isAbandoned,
  nodeProcessInspector,
  type ProcessInspector,
  sameProcessInstance,
} from './process-identity.js'

const DEFAULT_RETRY_MS = 25
const INVALID_RECORD = Symbol('invalid-writer-lock-record')

export type { WriterLockRecord } from './generation-types.js'

export interface WriterLock {
  readonly record: WriterLockRecord
  readonly release: Effect.Effect<void, WriterLockError>
}

export interface WriterLockOptions {
  readonly inspector?: ProcessInspector
  readonly retryMs?: number
}

type ReadLockRecord = WriterLockRecord | null | typeof INVALID_RECORD

const writerLockError = (
  operation: WriterLockOperation,
  targetPath: string,
  cause: unknown,
): WriterLockError =>
  new WriterLockError({
    operation,
    path: portablePath(targetPath),
    message: `${operation} writer lock failed for ${portablePath(targetPath)}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    cause,
  })

const attempt = <A>(
  operation: WriterLockOperation,
  targetPath: string,
  action: () => Promise<A>,
): Effect.Effect<A, WriterLockError> =>
  Effect.tryPromise({
    try: action,
    catch: (cause) => writerLockError(operation, targetPath, cause),
  })

const isMissing = (cause: unknown): boolean => errorCode(cause) === 'ENOENT'

const validRecord = (value: unknown): value is WriterLockRecord => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<WriterLockRecord>
  return (
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    typeof candidate.createdAt === 'string' &&
    Number.isFinite(Date.parse(candidate.createdAt)) &&
    candidate.holder !== undefined &&
    sameProcessInstance(candidate.holder, candidate.holder)
  )
}

const encodeRecord = (record: WriterLockRecord): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(record))

const readRecord = (
  filePath: string,
): Effect.Effect<ReadLockRecord, WriterLockError> =>
  attempt('read', filePath, async () => {
    try {
      const stat = await fs.lstat(filePath)
      if (!stat.isFile()) return INVALID_RECORD
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
      return validRecord(parsed) ? parsed : INVALID_RECORD
    } catch (cause) {
      if (isMissing(cause)) return null
      if (cause instanceof SyntaxError) return INVALID_RECORD
      throw cause
    }
  })

const removeFromHome = (
  home: string,
  filePath: string,
  operation: 'reclaim' | 'release',
): Effect.Effect<void, WriterLockError> =>
  Effect.gen(function* () {
    const removed = yield* attempt(operation, filePath, async () => {
      try {
        await fs.unlink(filePath)
        return true
      } catch (cause) {
        if (isMissing(cause)) return false
        throw cause
      }
    })
    if (removed) {
      yield* syncDirectory(home).pipe(
        Effect.mapError((cause) => writerLockError(operation, filePath, cause)),
      )
    }
  })

const releaseMatching = (
  home: string,
  filePath: string,
  token: string,
  operation: 'reclaim' | 'release',
): Effect.Effect<void, WriterLockError> =>
  Effect.gen(function* () {
    const existing = yield* readRecord(filePath)
    if (
      existing === null ||
      existing === INVALID_RECORD ||
      existing.token !== token
    ) {
      return
    }
    yield* removeFromHome(home, filePath, operation)
  })

const tryLinkRecord = (
  home: string,
  targetPath: string,
  record: WriterLockRecord,
  operation: 'acquire' | 'reclaim',
): Effect.Effect<boolean, WriterLockError> =>
  Effect.gen(function* () {
    const result = yield* createDurableRecordLink(
      home,
      targetPath,
      encodeRecord(record),
    ).pipe(
      Effect.mapError((cause) => writerLockError(operation, targetPath, cause)),
    )
    if (result === 'linked') return true
    if (result === 'exists') return false
    return yield* Effect.fail(
      writerLockError(
        operation,
        targetPath,
        new Error('Writer lock parent directory disappeared'),
      ),
    )
  })

const sameRecord = (left: WriterLockRecord, right: WriterLockRecord): boolean =>
  left.token === right.token &&
  left.createdAt === right.createdAt &&
  sameProcessInstance(left.holder, right.holder)

const effectFromExit = <A, E>(exit: Exit.Exit<A, E>): Effect.Effect<A, E> =>
  Exit.match(exit, {
    onFailure: Effect.failCause,
    onSuccess: Effect.succeed,
  })

const reclaimWriterLock = (
  home: string,
  lockPath: string,
  reclaimPath: string,
  reclaimer: WriterLockRecord,
  inspector: ProcessInspector,
): Effect.Effect<void, WriterLockError | ProcessIdentityError> =>
  Effect.gen(function* () {
    const observed = yield* readRecord(lockPath)
    if (observed === null || observed === INVALID_RECORD) return
    if (!(yield* isAbandoned(observed.holder, inspector))) return

    const hasAuthority = yield* tryLinkRecord(
      home,
      reclaimPath,
      reclaimer,
      'reclaim',
    )
    if (!hasAuthority) {
      const authority = yield* readRecord(reclaimPath)
      if (
        authority !== null &&
        authority !== INVALID_RECORD &&
        (yield* isAbandoned(authority.holder, inspector))
      ) {
        yield* releaseMatching(home, reclaimPath, authority.token, 'reclaim')
      }
      return
    }

    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const result = yield* Effect.exit(
          Effect.gen(function* () {
            const confirmed = yield* readRecord(lockPath)
            if (
              confirmed !== null &&
              confirmed !== INVALID_RECORD &&
              sameRecord(observed, confirmed) &&
              (yield* isAbandoned(confirmed.holder, inspector))
            ) {
              yield* releaseMatching(home, lockPath, confirmed.token, 'reclaim')
            }
          }),
        )
        yield* releaseMatching(home, reclaimPath, reclaimer.token, 'release')
        yield* effectFromExit(result)
      }),
    )
  })

const acquireWriterLock = (
  home: string,
  options: WriterLockOptions,
): Effect.Effect<WriterLock, WriterLockError | ProcessIdentityError> =>
  Effect.gen(function* () {
    const layout = generationHomeLayout(home)
    const inspector = options.inspector ?? nodeProcessInspector
    const retryMs = Math.max(1, options.retryMs ?? DEFAULT_RETRY_MS)
    yield* Effect.interruptible(
      attempt('acquire', layout.home, () =>
        fs.mkdir(layout.home, { recursive: true }),
      ),
    )
    const holder = yield* Effect.interruptible(inspector.current())
    const record: WriterLockRecord = {
      token: randomUUID(),
      holder,
      createdAt: new Date().toISOString(),
    }
    const reclaimer: WriterLockRecord = {
      token: randomUUID(),
      holder,
      createdAt: record.createdAt,
    }

    while (true) {
      if (
        yield* tryLinkRecord(layout.home, layout.writerLock, record, 'acquire')
      ) {
        return {
          record,
          release: releaseMatching(
            layout.home,
            layout.writerLock,
            record.token,
            'release',
          ),
        }
      }
      yield* reclaimWriterLock(
        layout.home,
        layout.writerLock,
        layout.writerReclaim,
        reclaimer,
        inspector,
      )
      yield* Effect.interruptible(Effect.sleep(`${retryMs} millis`))
    }
  })

export const withWriterLock = <A, E>(
  home: string,
  use: (lock: WriterLock) => Effect.Effect<A, E>,
  options: WriterLockOptions = {},
): Effect.Effect<A, E | WriterLockError | ProcessIdentityError> =>
  Effect.uninterruptibleMask((restore) =>
    acquireWriterLock(home, options).pipe(
      Effect.flatMap((lock) =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(restore(use(lock)))
          yield* lock.release
          return yield* effectFromExit(result)
        }),
      ),
    ),
  )
