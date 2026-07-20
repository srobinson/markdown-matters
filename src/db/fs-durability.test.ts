import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  type DurabilityDirectoryEntry,
  type DurabilityFileHandle,
  type DurabilityFileSystem,
  durableReplaceText,
  linkPreparedRecord,
  prepareDurableRecord,
  syncDirectory,
  syncFile,
  syncTree,
} from './fs-durability.js'
import type { GenerationDurabilityOperation } from './generation-errors.js'

interface RecordingFileSystem extends DurabilityFileSystem {
  readonly events: string[]
  failAt: GenerationDurabilityOperation | null
}

const basename = (value: string): string => path.basename(value)

const failure = (
  operation: GenerationDurabilityOperation,
  targetPath: string,
): Error =>
  Object.assign(new Error(`${operation} unsupported for ${targetPath}`), {
    code: 'ENOTSUP',
  })

const entry = (
  name: string,
  kind: DurabilityDirectoryEntry['kind'],
): DurabilityDirectoryEntry => ({ name, kind })

const recordingFileSystem = (
  directories: ReadonlyMap<
    string,
    readonly DurabilityDirectoryEntry[]
  > = new Map(),
  platform: NodeJS.Platform = 'linux',
): RecordingFileSystem => {
  const events: string[] = []
  const adapter: RecordingFileSystem = {
    events,
    failAt: null,
    platform,
    temporaryPath: (directoryPath) => path.join(directoryPath, 'record.tmp'),
    openFile: async (filePath) =>
      recordingHandle(adapter, 'sync-file', filePath),
    openDirectory: async (directoryPath) =>
      recordingHandle(adapter, 'sync-directory', directoryPath),
    readDirectory: async (directoryPath) => {
      if (adapter.failAt === 'read-directory') {
        throw failure('read-directory', directoryPath)
      }
      return directories.get(directoryPath) ?? []
    },
    writeFile: async (filePath) => {
      if (adapter.failAt === 'write-file') {
        throw failure('write-file', filePath)
      }
      events.push(`write:${basename(filePath)}`)
    },
    rename: async (sourcePath, targetPath) => {
      if (adapter.failAt === 'rename') {
        throw failure('rename', targetPath)
      }
      events.push(`rename:${basename(sourcePath)}:${basename(targetPath)}`)
    },
    link: async (sourcePath, targetPath) => {
      if (adapter.failAt === 'link') {
        throw failure('link', targetPath)
      }
      events.push(`link:${basename(sourcePath)}:${basename(targetPath)}`)
    },
  }
  return adapter
}

const recordingHandle = (
  adapter: RecordingFileSystem,
  operation: 'sync-file' | 'sync-directory',
  targetPath: string,
): DurabilityFileHandle => ({
  sync: async () => {
    if (adapter.failAt === operation) {
      throw failure(operation, targetPath)
    }
    const event = operation === 'sync-file' ? 'sync-file' : 'sync-dir'
    adapter.events.push(`${event}:${basename(targetPath)}`)
  },
  close: async () => undefined,
})

const expectDurabilityFailure = async (
  effect: Effect.Effect<unknown, unknown>,
  operation: GenerationDurabilityOperation,
  failedPath: string,
): Promise<void> => {
  const error = await Effect.runPromise(Effect.flip(effect))
  expect(error).toMatchObject({
    _tag: 'GenerationDurabilityError',
    operation,
    path: failedPath.split(path.sep).join('/'),
  })
}

describe('filesystem durability primitives', () => {
  it('syncs explicit files and directories through the adapter', async () => {
    const fileSystem = recordingFileSystem()

    await Effect.runPromise(syncFile('/home/gen/index.json', fileSystem))
    await Effect.runPromise(syncDirectory('/home/gen', fileSystem))

    expect(fileSystem.events).toEqual(['sync-file:index.json', 'sync-dir:gen'])
  })

  it('skips directory sync on Windows without opening a handle', async () => {
    const fileSystem = recordingFileSystem(new Map(), 'win32')
    fileSystem.failAt = 'sync-directory'

    await Effect.runPromise(syncDirectory('/home/gen', fileSystem))

    expect(fileSystem.events).toEqual([])
  })

  it.each([
    'linux',
    'darwin',
  ] as const)('attempts directory sync on %s', async (platform) => {
    const fileSystem = recordingFileSystem(new Map(), platform)

    await Effect.runPromise(syncDirectory('/home/gen', fileSystem))

    expect(fileSystem.events).toEqual(['sync-dir:gen'])
  })

  it('fails clearly for an unhandled directory sync platform', async () => {
    const fileSystem = recordingFileSystem(new Map(), 'aix')

    await expectDurabilityFailure(
      syncDirectory('/home/gen', fileSystem),
      'sync-directory',
      '/home/gen',
    )
  })

  it('surfaces unexpected directory sync errors on Linux', async () => {
    const fileSystem = recordingFileSystem(new Map(), 'linux')
    fileSystem.failAt = 'sync-directory'

    await expectDurabilityFailure(
      syncDirectory('/home/gen', fileSystem),
      'sync-directory',
      '/home/gen',
    )
  })

  it('syncs child files before their containing directories', async () => {
    const root = '/home/gen'
    const nested = path.join(root, 'indexes')
    const fileSystem = recordingFileSystem(
      new Map([
        [root, [entry('root.json', 'file'), entry('indexes', 'directory')]],
        [nested, [entry('documents.json', 'file')]],
      ]),
    )

    await Effect.runPromise(syncTree(root, fileSystem))

    expect(fileSystem.events.indexOf('sync-file:documents.json')).toBeLessThan(
      fileSystem.events.indexOf('sync-dir:indexes'),
    )
    expect(fileSystem.events.indexOf('sync-file:root.json')).toBeLessThan(
      fileSystem.events.indexOf('sync-dir:gen'),
    )
    expect(fileSystem.events.indexOf('sync-dir:indexes')).toBeLessThan(
      fileSystem.events.indexOf('sync-dir:gen'),
    )
  })
})

describe('durable filesystem mutations', () => {
  it('syncs and durably replaces a real filesystem file', async () => {
    const directoryPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mdm-durability-'),
    )
    try {
      const filePath = path.join(directoryPath, 'generation.json')
      const pointerPath = path.join(directoryPath, 'current')
      await fs.writeFile(filePath, 'complete')

      await Effect.runPromise(syncFile(filePath))
      await Effect.runPromise(durableReplaceText(pointerPath, 'gen-2'))

      expect(await fs.readFile(pointerPath, 'utf8')).toBe('gen-2')
      await expect(fs.access(`${pointerPath}.tmp`)).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await fs.rm(directoryPath, { recursive: true, force: true })
    }
  })

  it('durably replaces text with a same-directory rename', async () => {
    const fileSystem = recordingFileSystem()

    await Effect.runPromise(
      durableReplaceText('/home/current', 'gen-2', fileSystem),
    )

    expect(fileSystem.events).toEqual([
      'write:current.tmp',
      'sync-file:current.tmp',
      'rename:current.tmp:current',
      'sync-dir:home',
    ])
  })

  it('retains file sync and rename when Windows skips directory sync', async () => {
    const fileSystem = recordingFileSystem(new Map(), 'win32')

    await Effect.runPromise(
      durableReplaceText('/home/current', 'gen-2', fileSystem),
    )

    expect(fileSystem.events).toEqual([
      'write:current.tmp',
      'sync-file:current.tmp',
      'rename:current.tmp:current',
    ])
  })

  it.each([
    ['write-file', '/home/current.tmp'],
    ['sync-file', '/home/current.tmp'],
    ['rename', '/home/current'],
    ['sync-directory', '/home'],
  ] as const)('reports %s replacement failures', async (operation, failedPath) => {
    const fileSystem = recordingFileSystem()
    fileSystem.failAt = operation

    await expectDurabilityFailure(
      durableReplaceText('/home/current', 'gen-2', fileSystem),
      operation,
      failedPath,
    )
  })

  it('prepares, syncs, and links an immutable record', async () => {
    const fileSystem = recordingFileSystem()
    const record = await Effect.runPromise(
      prepareDurableRecord('/home/leases', new Uint8Array([1, 2]), fileSystem),
    )

    expect(record).toEqual({ path: '/home/leases/record.tmp' })
    await Effect.runPromise(
      linkPreparedRecord(record, '/home/leases/open/lease-1', fileSystem),
    )
    expect(fileSystem.events).toEqual([
      'write:record.tmp',
      'sync-file:record.tmp',
      'link:record.tmp:lease-1',
      'sync-dir:open',
    ])
  })

  it.each([
    ['read-directory', '/home/gen'],
    ['link', '/home/leases/open/lease-1'],
  ] as const)('reports %s adapter failures', async (operation, failedPath) => {
    const fileSystem = recordingFileSystem()
    fileSystem.failAt = operation
    const effect =
      operation === 'read-directory'
        ? syncTree('/home/gen', fileSystem)
        : linkPreparedRecord(
            { path: '/home/leases/record.tmp' },
            failedPath,
            fileSystem,
          )

    await expectDurabilityFailure(effect, operation, failedPath)
  })
})
