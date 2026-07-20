import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'
import { generationHomeLayout } from './generation-paths.js'
import type { ProcessIdentity, ProcessInspector } from './process-identity.js'
import { type WriterLockRecord, withWriterLock } from './writer-lock.js'

const CHILD_HOME = process.env.MDM_WRITER_LOCK_CHILD_HOME
const CHILD_LOG = process.env.MDM_WRITER_LOCK_CHILD_LOG
const CHILD_ROLE = process.env.MDM_WRITER_LOCK_CHILD_ROLE

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect)

const identity = (
  pid: number,
  startedAt = `started-${pid}`,
): ProcessIdentity => ({ pid, startedAt, bootId: 'boot-1' })

const inspector = (
  current: ProcessIdentity,
  inspect: (pid: number) => ProcessIdentity | null,
): ProcessInspector => ({
  current: () => Effect.succeed(current),
  inspect: (pid) => Effect.succeed(inspect(pid)),
})

const record = (
  token: string,
  holder: ProcessIdentity,
  createdAt = '1970-01-01T00:00:00.000Z',
): WriterLockRecord => ({ token, holder, createdAt })

const createHome = (): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), 'mdm-writer-lock-'))

const writeRecord = async (
  filePath: string,
  value: WriterLockRecord | string,
): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(
    filePath,
    typeof value === 'string' ? value : JSON.stringify(value),
  )
}

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe.skipIf(CHILD_HOME !== undefined)('writer lock', () => {
  it('serializes concurrent callbacks and releases in order', async () => {
    const home = await createHome()
    const source = inspector(identity(100), () => identity(100))
    const order: string[] = []
    let concurrent = 0
    let maxConcurrent = 0
    let releaseFirst: (() => void) | undefined
    const firstCanExit = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstEntered: (() => void) | undefined
    const firstDidEnter = new Promise<void>((resolve) => {
      firstEntered = resolve
    })

    try {
      const first = run(
        withWriterLock(
          home,
          () =>
            Effect.gen(function* () {
              concurrent += 1
              maxConcurrent = Math.max(maxConcurrent, concurrent)
              order.push('first-enter')
              firstEntered?.()
              yield* Effect.promise(() => firstCanExit)
              order.push('first-exit')
              concurrent -= 1
            }),
          { inspector: source, retryMs: 5 },
        ),
      )
      await firstDidEnter
      const second = run(
        withWriterLock(
          home,
          () =>
            Effect.sync(() => {
              concurrent += 1
              maxConcurrent = Math.max(maxConcurrent, concurrent)
              order.push('second-enter')
              order.push('second-exit')
              concurrent -= 1
            }),
          { inspector: source, retryMs: 5 },
        ),
      )

      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(order).toEqual(['first-enter'])
      releaseFirst?.()
      await Promise.all([first, second])

      expect(maxConcurrent).toBe(1)
      expect(order).toEqual([
        'first-enter',
        'first-exit',
        'second-enter',
        'second-exit',
      ])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it.each([
    ['dead holder', null],
    ['reused PID', identity(41, 'new-start')],
  ] as const)('reclaims a lock from a %s', async (_label, observed) => {
    const home = await createHome()
    const layout = generationHomeLayout(home)
    await writeRecord(layout.writerLock, record('old', identity(41)))

    try {
      const acquired = await run(
        withWriterLock(home, () => Effect.succeed(true), {
          inspector: inspector(identity(100), (pid) =>
            pid === 41 ? observed : identity(pid),
          ),
          retryMs: 5,
        }),
      )

      expect(acquired).toBe(true)
      expect(await exists(layout.writerLock)).toBe(false)
      expect(await exists(layout.writerReclaim)).toBe(false)
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})

describe.skipIf(CHILD_HOME !== undefined)('writer lock liveness', () => {
  it.each([
    ['old live record', JSON.stringify(record('live', identity(41)))],
    ['malformed record', '{'],
  ])('retains %s regardless of age', async (_label, contents) => {
    const home = await createHome()
    const layout = generationHomeLayout(home)
    await writeRecord(layout.writerLock, contents)
    let acquiredWhileLive = false
    const fiber = Effect.runFork(
      withWriterLock(
        home,
        () =>
          Effect.sync(() => {
            acquiredWhileLive = true
          }),
        {
          inspector: inspector(identity(100), (pid) => identity(pid)),
          retryMs: 5,
        },
      ),
    )

    try {
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(acquiredWhileLive).toBe(false)
      expect(await exists(layout.writerLock)).toBe(true)
    } finally {
      await run(Fiber.interrupt(fiber))
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('does not bypass a live reclaim authority', async () => {
    const home = await createHome()
    const layout = generationHomeLayout(home)
    await writeRecord(layout.writerLock, record('old', identity(41)))
    await writeRecord(layout.writerReclaim, record('reclaimer', identity(42)))
    let acquired = false
    const fiber = Effect.runFork(
      withWriterLock(
        home,
        () =>
          Effect.sync(() => {
            acquired = true
          }),
        {
          inspector: inspector(identity(100), (pid) =>
            pid === 41 ? null : identity(pid),
          ),
          retryMs: 5,
        },
      ),
    )

    try {
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(acquired).toBe(false)
      expect(await exists(layout.writerLock)).toBe(true)
    } finally {
      await run(Fiber.interrupt(fiber))
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('reclaims an abandoned reclaim authority before the lock', async () => {
    const home = await createHome()
    const layout = generationHomeLayout(home)
    await writeRecord(layout.writerLock, record('old', identity(41)))
    await writeRecord(layout.writerReclaim, record('stale', identity(42)))

    try {
      await run(
        withWriterLock(home, () => Effect.void, {
          inspector: inspector(identity(100), () => null),
          retryMs: 5,
        }),
      )

      expect(await exists(layout.writerLock)).toBe(false)
      expect(await exists(layout.writerReclaim)).toBe(false)
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})

describe.skipIf(CHILD_HOME !== undefined)('writer lock release', () => {
  it('releases after callback cancellation', async () => {
    const home = await createHome()
    const layout = generationHomeLayout(home)
    let entered: (() => void) | undefined
    const didEnter = new Promise<void>((resolve) => {
      entered = resolve
    })
    const fiber = Effect.runFork(
      withWriterLock(
        home,
        () =>
          Effect.gen(function* () {
            entered?.()
            yield* Effect.never
          }),
        { inspector: inspector(identity(100), () => identity(100)) },
      ),
    )

    try {
      await didEnter
      expect(await exists(layout.writerLock)).toBe(true)
      await run(Fiber.interrupt(fiber))
      expect(await exists(layout.writerLock)).toBe(false)
    } finally {
      await run(Fiber.interrupt(fiber))
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('releases after callback failure', async () => {
    const home = await createHome()
    const layout = generationHomeLayout(home)

    try {
      await expect(
        run(
          withWriterLock(
            home,
            () => Effect.fail(new Error('callback failed')),
            { inspector: inspector(identity(100), () => identity(100)) },
          ),
        ),
      ).rejects.toThrow('callback failed')
      expect(await exists(layout.writerLock)).toBe(false)
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('releases only a matching token', async () => {
    const home = await createHome()
    const layout = generationHomeLayout(home)
    const replacement = record('replacement', identity(200))

    try {
      await run(
        withWriterLock(
          home,
          () =>
            Effect.promise(async () => {
              await fs.unlink(layout.writerLock)
              await writeRecord(layout.writerLock, replacement)
            }),
          { inspector: inspector(identity(100), () => identity(100)) },
        ),
      )

      await expect(fs.readFile(layout.writerLock, 'utf8')).resolves.toBe(
        JSON.stringify(replacement),
      )
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('serializes separate processes with the hard-link lock', async () => {
    const home = await createHome()
    const logPath = path.join(home, 'order.log')
    const first = spawnLockChild('first', home, logPath)

    try {
      await Promise.race([
        waitForLog(logPath, 'first-enter'),
        first.completed.then(() => {
          throw new Error('First writer lock child exited before admission')
        }),
      ])
      const second = spawnLockChild('second', home, logPath)
      await Promise.all([first.completed, second.completed])

      await expect(fs.readFile(logPath, 'utf8')).resolves.toBe(
        'first-enter\nfirst-exit\nsecond-enter\nsecond-exit\n',
      )
    } finally {
      first.process.kill()
      await fs.rm(home, { recursive: true, force: true })
    }
  }, 30_000)
})

describe.runIf(CHILD_HOME !== undefined)('writer lock child', () => {
  it('holds the cross-process lock', async () => {
    if (
      CHILD_HOME === undefined ||
      CHILD_LOG === undefined ||
      CHILD_ROLE === undefined
    ) {
      throw new Error('Incomplete writer lock child environment')
    }
    await run(
      withWriterLock(CHILD_HOME, () =>
        Effect.gen(function* () {
          yield* appendChildEvent(`${CHILD_ROLE}-enter`)
          if (CHILD_ROLE === 'first') yield* Effect.sleep('3 seconds')
          yield* appendChildEvent(`${CHILD_ROLE}-exit`)
        }),
      ),
    )
  })
})

const appendChildEvent = (event: string): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: () => fs.appendFile(CHILD_LOG as string, `${event}\n`),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  })

const spawnLockChild = (
  role: 'first' | 'second',
  home: string,
  logPath: string,
): RunningChild => {
  const child = spawn(
    process.execPath,
    [
      path.resolve('node_modules/vitest/vitest.mjs'),
      'run',
      'src/db/writer-lock.test.ts',
    ],
    {
      env: childEnvironment({
        MDM_WRITER_LOCK_CHILD_HOME: home,
        MDM_WRITER_LOCK_CHILD_LOG: logPath,
        MDM_WRITER_LOCK_CHILD_ROLE: role,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  return { process: child, completed: waitForChild(child) }
}

interface RunningChild {
  readonly process: ChildProcess
  readonly completed: Promise<void>
}

const childEnvironment = (
  additions: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv => {
  const environment = { ...process.env, ...additions }
  for (const name of Object.keys(environment)) {
    if (name.startsWith('VITEST')) delete environment[name]
  }
  return environment
}

const waitForChild = (child: ChildProcess): Promise<void> =>
  new Promise((resolve, reject) => {
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Writer lock child exited ${code}: ${output}`))
    })
  })

const waitForLog = async (logPath: string, value: string): Promise<void> => {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const contents = await fs.readFile(logPath, 'utf8').catch(() => '')
    if (contents.includes(value)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${value}`)
}
