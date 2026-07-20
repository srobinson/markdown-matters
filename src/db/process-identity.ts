import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { Effect } from 'effect'
import {
  errorCode,
  ProcessIdentityError,
  type ProcessIdentityOperation,
} from './generation-errors.js'

const COMMAND_TIMEOUT_MS = 30_000
const WINDOWS_DEAD_PROCESS_EXIT_CODE = 3

const WINDOWS_INSPECT_SCRIPT = [
  '& { param([uint32]$targetPid)',
  "$ErrorActionPreference = 'Stop'",
  "$target = Get-CimInstance Win32_Process -Filter ('ProcessId = {0}' -f $targetPid)",
  'if ($null -eq $target) { exit 3 }',
  '$system = Get-CimInstance Win32_OperatingSystem',
  "$identity = [pscustomobject]@{ startedAt = $target.CreationDate.ToUniversalTime().ToString('O'); bootId = $system.LastBootUpTime.ToUniversalTime().ToString('O') }",
  '$identity | ConvertTo-Json -Compress',
  '}',
].join('; ')

export interface ProcessIdentity {
  readonly pid: number
  readonly startedAt: string
  readonly bootId: string
}

export interface ProcessInspector {
  readonly current: () => Effect.Effect<ProcessIdentity, ProcessIdentityError>
  readonly inspect: (
    pid: number,
  ) => Effect.Effect<ProcessIdentity | null, ProcessIdentityError>
}

export interface ProcessCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface ProcessSource {
  readonly platform: NodeJS.Platform
  readonly currentPid: number
  readonly readText: (filePath: string) => Promise<string>
  readonly runCommand: (
    command: string,
    args: readonly string[],
  ) => Promise<ProcessCommandResult>
}

const runCommand = (
  command: string,
  args: readonly string[],
): Promise<ProcessCommandResult> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: 'utf8',
        env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
        maxBuffer: 1024 * 1024,
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, exitCode: 0 })
          return
        }
        if (typeof error.code === 'number') {
          resolve({ stdout, stderr, exitCode: error.code })
          return
        }
        reject(error)
      },
    )
  })

const nodeProcessSource: ProcessSource = {
  platform: process.platform,
  currentPid: process.pid,
  readText: (filePath) => fs.readFile(filePath, 'utf8'),
  runCommand,
}

const normalizeText = (value: string): string =>
  value.trim().replace(/\s+/g, ' ')

const identityValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = normalizeText(value)
  return normalized.length > 0 ? normalized : null
}

export const hasValidIdentity = (
  identity: unknown,
): identity is ProcessIdentity => {
  if (typeof identity !== 'object' || identity === null) return false
  const candidate = identity as Partial<ProcessIdentity>
  return (
    Number.isSafeInteger(candidate.pid) &&
    (candidate.pid ?? 0) > 0 &&
    identityValue(candidate.startedAt) !== null &&
    identityValue(candidate.bootId) !== null
  )
}

const processIdentity = (
  pid: number,
  startedAt: unknown,
  bootId: unknown,
): ProcessIdentity => {
  const normalizedStart = identityValue(startedAt)
  const normalizedBoot = identityValue(bootId)
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid process PID: ${pid}`)
  }
  if (normalizedStart === null) {
    throw new Error(`Process ${pid} has no readable start identity`)
  }
  if (normalizedBoot === null) {
    throw new Error(`Process ${pid} has no readable boot identity`)
  }
  return { pid, startedAt: normalizedStart, bootId: normalizedBoot }
}

const isMissingFile = (cause: unknown): boolean => {
  const code = errorCode(cause)
  return code === 'ENOENT' || code === 'ESRCH'
}

const linuxStartedAt = (stat: string, pid: number): string => {
  const closingName = stat.lastIndexOf(')')
  if (closingName < 0) throw new Error(`Malformed /proc/${pid}/stat`)
  const fields = stat
    .slice(closingName + 1)
    .trim()
    .split(/\s+/)
  const startTicks = fields[19]
  if (startTicks === undefined || !/^\d+$/.test(startTicks)) {
    throw new Error(`Malformed /proc/${pid}/stat start time`)
  }
  return startTicks
}

const inspectLinux = async (
  pid: number,
  source: ProcessSource,
): Promise<ProcessIdentity | null> => {
  let stat: string
  try {
    stat = await source.readText(`/proc/${pid}/stat`)
  } catch (cause) {
    if (isMissingFile(cause)) return null
    throw cause
  }
  const bootId = await source.readText('/proc/sys/kernel/random/boot_id')
  return processIdentity(pid, linuxStartedAt(stat, pid), bootId)
}

const commandFailure = (command: string, result: ProcessCommandResult): Error =>
  new Error(
    `${command} exited ${result.exitCode}: ${normalizeText(result.stderr)}`,
  )

const darwinStartedAt = (value: string): string => {
  const timestamp = Date.parse(`${normalizeText(value)} UTC`)
  if (!Number.isFinite(timestamp)) {
    throw new Error('macOS process start identity is malformed')
  }
  return String(timestamp)
}

const darwinBootId = (value: string): string => {
  const match = /\bsec\s*=\s*(\d+)\s*,\s*usec\s*=\s*(\d+)/.exec(value)
  const seconds = match?.[1]
  const microseconds = match?.[2]
  if (seconds === undefined || microseconds === undefined) {
    throw new Error('macOS boot identity is malformed')
  }
  return `${seconds}:${microseconds.padStart(6, '0')}`
}

const inspectDarwin = async (
  pid: number,
  source: ProcessSource,
): Promise<ProcessIdentity | null> => {
  const processResult = await source.runCommand('ps', [
    '-p',
    String(pid),
    '-o',
    'lstart=',
  ])
  if (processResult.exitCode === 1) return null
  if (processResult.exitCode !== 0) {
    throw commandFailure('ps', processResult)
  }
  const bootResult = await source.runCommand('sysctl', ['-n', 'kern.boottime'])
  if (bootResult.exitCode !== 0) {
    throw commandFailure('sysctl', bootResult)
  }
  return processIdentity(
    pid,
    darwinStartedAt(processResult.stdout),
    darwinBootId(bootResult.stdout),
  )
}

interface WindowsProcessIdentity {
  readonly startedAt?: unknown
  readonly bootId?: unknown
}

const parseWindowsIdentity = (pid: number, stdout: string): ProcessIdentity => {
  const parsed = JSON.parse(stdout) as WindowsProcessIdentity
  return processIdentity(pid, parsed.startedAt, parsed.bootId)
}

const inspectWindows = async (
  pid: number,
  source: ProcessSource,
): Promise<ProcessIdentity | null> => {
  const result = await source.runCommand('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_INSPECT_SCRIPT,
    String(pid),
  ])
  if (result.exitCode === WINDOWS_DEAD_PROCESS_EXIT_CODE) return null
  if (result.exitCode !== 0) throw commandFailure('powershell.exe', result)
  return parseWindowsIdentity(pid, result.stdout)
}

const inspectProcess = (
  pid: number,
  source: ProcessSource,
): Promise<ProcessIdentity | null> => {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid process PID: ${pid}`)
  }
  switch (source.platform) {
    case 'linux':
      return inspectLinux(pid, source)
    case 'darwin':
      return inspectDarwin(pid, source)
    case 'win32':
      return inspectWindows(pid, source)
    default:
      throw new Error(
        `Unsupported process identity platform: ${source.platform}`,
      )
  }
}

const identityError = (
  operation: ProcessIdentityOperation,
  pid: number,
  cause: unknown,
): ProcessIdentityError =>
  new ProcessIdentityError({
    operation,
    pid,
    message: `${operation} process identity failed for PID ${pid}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    cause,
  })

const inspectWith = (
  pid: number,
  source: ProcessSource,
  operation: ProcessIdentityOperation,
): Effect.Effect<ProcessIdentity | null, ProcessIdentityError> =>
  Effect.tryPromise({
    try: () => inspectProcess(pid, source),
    catch: (cause) => identityError(operation, pid, cause),
  })

export const createProcessInspector = (
  source: ProcessSource,
): ProcessInspector => ({
  current: () =>
    Effect.gen(function* () {
      const identity = yield* inspectWith(source.currentPid, source, 'current')
      if (identity === null) {
        return yield* Effect.fail(
          identityError(
            'current',
            source.currentPid,
            new Error('Current process is not alive'),
          ),
        )
      }
      return identity
    }),
  inspect: (pid) => inspectWith(pid, source, 'inspect'),
})

export const nodeProcessInspector: ProcessInspector =
  createProcessInspector(nodeProcessSource)

export const sameProcessInstance = (
  left: ProcessIdentity,
  right: ProcessIdentity,
): boolean =>
  hasValidIdentity(left) &&
  hasValidIdentity(right) &&
  left.pid === right.pid &&
  identityValue(left.startedAt) === identityValue(right.startedAt) &&
  identityValue(left.bootId) === identityValue(right.bootId)

export const isAbandoned = (
  holder: ProcessIdentity,
  inspector: ProcessInspector,
): Effect.Effect<boolean, ProcessIdentityError> => {
  if (!hasValidIdentity(holder)) return Effect.succeed(false)
  return inspector.inspect(holder.pid).pipe(
    Effect.map((identity) => {
      if (identity === null) return true
      if (!hasValidIdentity(identity)) return false
      return !sameProcessInstance(holder, identity)
    }),
    Effect.catchAll(() => Effect.succeed(false)),
  )
}
