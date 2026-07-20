import { spawn } from 'node:child_process'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { ProcessIdentityError } from './generation-errors.js'
import {
  createProcessInspector,
  isAbandoned,
  nodeProcessInspector,
  type ProcessCommandResult,
  type ProcessIdentity,
  type ProcessInspector,
  type ProcessSource,
  sameProcessInstance,
} from './process-identity.js'

const holder: ProcessIdentity = {
  pid: 42,
  startedAt: 'process-start-1',
  bootId: 'boot-1',
}

const inspectorReturning = (
  inspected: ProcessIdentity | null,
): ProcessInspector => ({
  current: () => Effect.succeed(holder),
  inspect: () => Effect.succeed(inspected),
})

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect)

describe('process instance identity', () => {
  it('captures the current process through the injected source', async () => {
    const source = linuxSource(
      new Map([
        ['/proc/42/stat', linuxStat(42, '991')],
        ['/proc/sys/kernel/random/boot_id', ' boot-1\n'],
      ]),
    )

    await expect(
      run(createProcessInspector(source).current()),
    ).resolves.toEqual({
      pid: 42,
      startedAt: '991',
      bootId: 'boot-1',
    })
  })

  it('retains a live matching holder indefinitely', async () => {
    const ancientHolder: ProcessIdentity & { readonly acquiredAt: string } = {
      ...holder,
      acquiredAt: '1970-01-01T00:00:00.000Z',
    }

    await expect(
      run(isAbandoned(ancientHolder, inspectorReturning(holder))),
    ).resolves.toBe(false)
  })

  it('abandons a holder whose PID is dead', async () => {
    await expect(
      run(isAbandoned(holder, inspectorReturning(null))),
    ).resolves.toBe(true)
  })

  it('abandons a holder after PID reuse changes its start identity', async () => {
    const reused = { ...holder, startedAt: 'process-start-2' }

    await expect(
      run(isAbandoned(holder, inspectorReturning(reused))),
    ).resolves.toBe(true)
  })

  it('abandons a holder when the boot identity changes', async () => {
    const afterReboot = { ...holder, bootId: 'boot-2' }

    await expect(
      run(isAbandoned(holder, inspectorReturning(afterReboot))),
    ).resolves.toBe(true)
  })

  it('retains malformed holder records conservatively', async () => {
    const malformed = { ...holder, startedAt: '' }

    await expect(
      run(isAbandoned(malformed, inspectorReturning(holder))),
    ).resolves.toBe(false)
  })

  it('retains a holder when inspection is unreadable', async () => {
    const unreadable: ProcessInspector = {
      current: () => Effect.succeed(holder),
      inspect: (pid) =>
        Effect.fail(
          new ProcessIdentityError({
            operation: 'inspect',
            pid,
            message: 'permission denied',
          }),
        ),
    }

    await expect(run(isAbandoned(holder, unreadable))).resolves.toBe(false)
  })

  it('retains a holder when the observed identity is malformed', async () => {
    const source = linuxSource(
      new Map([
        ['/proc/42/stat', 'malformed'],
        ['/proc/sys/kernel/random/boot_id', 'boot-1'],
      ]),
    )

    await expect(
      run(isAbandoned(holder, createProcessInspector(source))),
    ).resolves.toBe(false)
  })

  it('compares every process instance discriminator', () => {
    expect(sameProcessInstance(holder, { ...holder })).toBe(true)
    expect(sameProcessInstance(holder, { ...holder, pid: 43 })).toBe(false)
    expect(sameProcessInstance(holder, { ...holder, startedAt: 'other' })).toBe(
      false,
    )
    expect(sameProcessInstance(holder, { ...holder, bootId: 'other' })).toBe(
      false,
    )
  })

  it('rejects invalid PIDs instead of reporting them dead', async () => {
    const error = await run(
      Effect.flip(createProcessInspector(linuxSource(new Map())).inspect(-1)),
    )

    expect(error).toMatchObject({
      _tag: 'ProcessIdentityError',
      operation: 'inspect',
      pid: -1,
    })
  })
})

describe('platform process sources', () => {
  it('reads Linux proc start ticks and boot identity', async () => {
    const source = linuxSource(
      new Map([
        ['/proc/71/stat', linuxStat(71, '12345')],
        ['/proc/sys/kernel/random/boot_id', '  linux-boot-id  \n'],
      ]),
    )

    await expect(
      run(createProcessInspector(source).inspect(71)),
    ).resolves.toEqual({
      pid: 71,
      startedAt: '12345',
      bootId: 'linux-boot-id',
    })
  })

  it('uses macOS ps and boot time commands with argument arrays', async () => {
    const source = commandSource('darwin', {
      ps: success(' Mon   Jul 21 10:20:30 2026\n'),
      sysctl: success(
        '{ sec = 1770000000, usec = 0 } Mon Jul 21 00:00:00 2026\n',
      ),
    })

    await expect(
      run(createProcessInspector(source).inspect(71)),
    ).resolves.toEqual({
      pid: 71,
      startedAt: String(Date.parse('Mon Jul 21 10:20:30 2026 UTC')),
      bootId: '1770000000:000000',
    })
    expect(source.commands).toEqual([
      ['ps', ['-p', '71', '-o', 'lstart=']],
      ['sysctl', ['-n', 'kern.boottime']],
    ])
  })

  it('uses Windows CIM with the PID as a separate argument', async () => {
    const source = commandSource('win32', {
      'powershell.exe': success(
        '{"startedAt":"2026-07-21T10:20:30.0000000Z","bootId":"2026-07-20T08:00:00.0000000Z"}\r\n',
      ),
    })

    await expect(
      run(createProcessInspector(source).inspect(71)),
    ).resolves.toEqual({
      pid: 71,
      startedAt: '2026-07-21T10:20:30.0000000Z',
      bootId: '2026-07-20T08:00:00.0000000Z',
    })
    expect(source.commands).toHaveLength(1)
    expect(source.commands[0]?.[0]).toBe('powershell.exe')
    expect(source.commands[0]?.[1].at(-2)).toMatch(
      /^& \{ param\(\[uint32\]\$targetPid\)/,
    )
    expect(source.commands[0]?.[1].at(-2)).toMatch(/\}$/)
    expect(source.commands[0]?.[1].at(-1)).toBe('71')
  })

  it.each([
    ['darwin', 'ps', 1],
    ['win32', 'powershell.exe', 3],
  ] as const)('returns null for a dead PID on %s', async (platform, command, exitCode) => {
    const source = commandSource(platform, {
      [command]: { stdout: '', stderr: '', exitCode },
    })

    await expect(
      run(createProcessInspector(source).inspect(404)),
    ).resolves.toBeNull()
  })
})

describe('native process inspection', () => {
  it('captures the same identity through current and inspect', async () => {
    const current = await run(nodeProcessInspector.current())
    const inspected = await run(nodeProcessInspector.inspect(process.pid))

    expect(inspected).not.toBeNull()
    expect(sameProcessInstance(current, inspected as ProcessIdentity)).toBe(
      true,
    )
  })

  it('distinguishes a live child instance from its terminated PID', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    const pid = child.pid
    if (pid === undefined) throw new Error('Child process has no PID')

    try {
      const first = await waitForIdentity(pid)
      const second = await run(nodeProcessInspector.inspect(pid))

      expect(second).not.toBeNull()
      expect(sameProcessInstance(first, second as ProcessIdentity)).toBe(true)
    } finally {
      child.kill()
    }

    await waitForDeath(pid)
  }, 45_000)
})

interface RecordingProcessSource extends ProcessSource {
  readonly commands: Array<readonly [string, readonly string[]]>
}

const success = (stdout: string): ProcessCommandResult => ({
  stdout,
  stderr: '',
  exitCode: 0,
})

const linuxStat = (pid: number, startedAt: string): string =>
  `${pid} (test process) S ${Array.from({ length: 18 }, () => '0').join(' ')} ${startedAt}`

const linuxSource = (
  files: ReadonlyMap<string, string>,
): RecordingProcessSource => ({
  platform: 'linux',
  currentPid: 42,
  commands: [],
  readText: async (filePath) => {
    const contents = files.get(filePath)
    if (contents === undefined) {
      throw Object.assign(new Error(`Missing ${filePath}`), { code: 'ENOENT' })
    }
    return contents
  },
  runCommand: async () => success(''),
})

const commandSource = (
  platform: 'darwin' | 'win32',
  results: Readonly<Record<string, ProcessCommandResult>>,
): RecordingProcessSource => {
  const commands: Array<readonly [string, readonly string[]]> = []
  return {
    platform,
    currentPid: 42,
    commands,
    readText: async () => {
      throw new Error('Unexpected filesystem read')
    },
    runCommand: async (command, args) => {
      commands.push([command, args])
      const result = results[command]
      if (result === undefined) throw new Error(`Unexpected command ${command}`)
      return result
    },
  }
}

const waitForIdentity = async (pid: number): Promise<ProcessIdentity> => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const identity = await run(nodeProcessInspector.inspect(pid))
    if (identity !== null) return identity
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Process ${pid} did not become inspectable`)
}

const waitForDeath = async (pid: number): Promise<void> => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if ((await run(nodeProcessInspector.inspect(pid))) === null) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Process ${pid} remained inspectable after termination`)
}
