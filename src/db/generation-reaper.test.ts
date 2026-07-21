import { type ChildProcess, spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearHnswCache,
  getHnswCacheEntry,
  hnswCacheKey,
  setHnswCacheEntry,
} from '../embeddings/hnsw-cache.js'
import type { VectorStore } from '../embeddings/vector-store.js'
import {
  generationHomeLayout,
  generationLayout,
  parseGenerationName,
} from './generation-paths.js'
import {
  initializeLeaseGate,
  withCurrentGeneration,
} from './generation-reader.js'
import {
  type GenerationReaperFileSystem,
  type GenerationReaperRuntime,
  nodeGenerationReaperFileSystem,
  reapGeneration,
  reapOldGenerations,
} from './generation-reaper.js'
import type {
  GenerationLeaseRecord,
  GenerationName,
} from './generation-types.js'
import type { ProcessIdentity, ProcessInspector } from './process-identity.js'

const CHILD_HOME = process.env.MDM_REAPER_CHILD_HOME
const CHILD_READY = process.env.MDM_REAPER_CHILD_READY
const CHILD_RELEASE = process.env.MDM_REAPER_CHILD_RELEASE
const cleanup: string[] = []

const identity = (
  pid: number,
  startedAt = `started-${pid}`,
): ProcessIdentity => ({ pid, startedAt, bootId: 'boot-1' })

const inspector = (
  identities: ReadonlyMap<number, ProcessIdentity | null>,
): ProcessInspector => ({
  current: () => Effect.succeed(identity(999)),
  inspect: (pid) => Effect.succeed(identities.get(pid) ?? null),
})

const createHome = async (): Promise<string> => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-reaper-'))
  cleanup.push(home)
  return home
}

const createGeneration = async (
  home: string,
  rawName: string,
): Promise<ReturnType<typeof generationLayout>> => {
  const name = await Effect.runPromise(parseGenerationName(rawName))
  const layout = generationLayout(home, name)
  await fs.mkdir(layout.root, { recursive: true })
  await Effect.runPromise(initializeLeaseGate(layout))
  return layout
}

const setCurrent = async (
  home: string,
  name: GenerationName,
): Promise<void> => {
  await fs.writeFile(generationHomeLayout(home).current, name)
}

const writeLease = async (
  directoryPath: string,
  leaseId: string,
  value: GenerationLeaseRecord | string,
): Promise<void> => {
  await fs.writeFile(
    path.join(directoryPath, leaseId),
    typeof value === 'string' ? value : JSON.stringify(value),
  )
}

const exists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

const waitForPath = async (targetPath: string): Promise<void> => {
  const deadline = Date.now() + 30_000
  while (!(await exists(targetPath))) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${targetPath}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const waitForChild = (child: ChildProcess): Promise<void> =>
  new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Child exited ${code ?? signal}: ${stderr}`))
    })
  })

afterEach(async () => {
  clearHnswCache()
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

describe.skipIf(CHILD_HOME !== undefined)('generation reaper', () => {
  it('protects current and higher numbered generations without closing gates', async () => {
    const home = await createHome()
    const gen2 = await createGeneration(home, 'gen-2')
    const gen3 = await createGeneration(home, 'gen-3')
    await setCurrent(home, gen2.name)
    const options = { graceMs: 0, inspector: inspector(new Map()) }

    await expect(
      Effect.runPromise(reapGeneration(home, gen2.name, options)),
    ).resolves.toEqual({ generation: 'gen-2', status: 'current' })
    await expect(
      Effect.runPromise(reapGeneration(home, gen3.name, options)),
    ).resolves.toEqual({ generation: 'gen-3', status: 'current' })
    expect(await exists(gen2.openLeases)).toBe(true)
    expect(await exists(gen3.openLeases)).toBe(true)
    expect(await exists(gen3.root)).toBe(true)
  })

  it('retains live and malformed leases indefinitely after closing the gate', async () => {
    const home = await createHome()
    const gen1 = await createGeneration(home, 'gen-1')
    const gen2 = await createGeneration(home, 'gen-2')
    await setCurrent(home, gen2.name)
    const live = identity(101)
    await writeLease(gen1.openLeases, 'live', {
      leaseId: 'live',
      holder: live,
      createdAt: '1970-01-01T00:00:00.000Z',
    })
    await writeLease(gen1.openLeases, 'malformed', 'not-json')
    let now = 1_000
    const options = {
      graceMs: 10,
      inspector: inspector(new Map([[live.pid, live]])),
      now: () => now,
    }

    await expect(
      Effect.runPromise(reapGeneration(home, gen1.name, options)),
    ).resolves.toEqual({ generation: 'gen-1', status: 'leased' })
    now = 1_000_000_000
    await expect(
      Effect.runPromise(reapGeneration(home, gen1.name, options)),
    ).resolves.toEqual({ generation: 'gen-1', status: 'leased' })
    expect((await fs.readdir(gen1.closedLeases)).sort()).toEqual([
      'live',
      'malformed',
    ])
  })

  it('removes dead and PID-reused leases while retaining a matching holder', async () => {
    const home = await createHome()
    const gen1 = await createGeneration(home, 'gen-1')
    const gen2 = await createGeneration(home, 'gen-2')
    await setCurrent(home, gen2.name)
    const reused = identity(202, 'original')
    const live = identity(203)
    for (const [leaseId, holder] of [
      ['dead', identity(201)],
      ['reused', reused],
      ['live', live],
    ] as const) {
      await writeLease(gen1.openLeases, leaseId, {
        leaseId,
        holder,
        createdAt: '1970-01-01T00:00:00.000Z',
      })
    }
    const source = inspector(
      new Map([
        [201, null],
        [202, identity(202, 'replacement')],
        [203, live],
      ]),
    )

    await expect(
      Effect.runPromise(
        reapGeneration(home, gen1.name, { graceMs: 0, inspector: source }),
      ),
    ).resolves.toEqual({ generation: 'gen-1', status: 'leased' })
    expect(await fs.readdir(gen1.closedLeases)).toEqual(['live'])
  })
})

describe.skipIf(CHILD_HOME !== undefined)('generation reaper grace', () => {
  it('starts grace when the gate closes and deletes only after it expires', async () => {
    const home = await createHome()
    const gen1 = await createGeneration(home, 'gen-1')
    const gen2 = await createGeneration(home, 'gen-2')
    await setCurrent(home, gen2.name)
    let now = 1_000
    let reaped: string | null = null
    const options = {
      graceMs: 100,
      inspector: inspector(new Map()),
      now: () => now,
      onReaped: (layout: typeof gen1) => {
        reaped = layout.name
      },
    }

    await expect(
      Effect.runPromise(reapGeneration(home, gen1.name, options)),
    ).resolves.toEqual({ generation: 'gen-1', status: 'grace' })
    now = 1_099
    await expect(
      Effect.runPromise(reapGeneration(home, gen1.name, options)),
    ).resolves.toEqual({ generation: 'gen-1', status: 'grace' })
    now = 1_100
    await expect(
      Effect.runPromise(reapGeneration(home, gen1.name, options)),
    ).resolves.toEqual({ generation: 'gen-1', status: 'reaped' })
    expect(await exists(gen1.root)).toBe(false)
    expect(reaped).toBe('gen-1')
  })

  it('makes a concurrent reaper observe pending close state as grace', async () => {
    const home = await createHome()
    const gen1 = await createGeneration(home, 'gen-1')
    const gen2 = await createGeneration(home, 'gen-2')
    await setCurrent(home, gen2.name)
    let renamedGate: (() => void) | undefined
    const gateWasRenamed = new Promise<void>((resolve) => {
      renamedGate = resolve
    })
    let releaseRename: (() => void) | undefined
    const renameCanReturn = new Promise<void>((resolve) => {
      releaseRename = resolve
    })
    const syncedDirectories: string[] = []
    const fileSystem: GenerationReaperFileSystem = {
      ...nodeGenerationReaperFileSystem,
      platform: 'linux',
      openDirectory: async (directoryPath) => {
        syncedDirectories.push(directoryPath)
        return { sync: async () => undefined, close: async () => undefined }
      },
      rename: async (sourcePath, targetPath) => {
        await nodeGenerationReaperFileSystem.rename(sourcePath, targetPath)
        renamedGate?.()
        await renameCanReturn
      },
    }
    const options = { graceMs: 100, now: () => 1_000 }
    const first = Effect.runPromise(
      reapGeneration(home, gen1.name, options, { fileSystem }),
    )
    await gateWasRenamed
    syncedDirectories.length = 0

    const second = await Effect.runPromise(
      reapGeneration(home, gen1.name, options, { fileSystem }),
    )
    expect(syncedDirectories).toContain(gen1.leasesRoot)
    releaseRename?.()

    await expect(first).resolves.toEqual({
      generation: 'gen-1',
      status: 'grace',
    })
    expect(second).toEqual({ generation: 'gen-1', status: 'grace' })
    expect(await exists(gen1.root)).toBe(true)
  })
})

describe.skipIf(CHILD_HOME !== undefined)('generation reaper safety', () => {
  it('keeps a generation until an admitted reader releases its closed lease', async () => {
    const home = await createHome()
    const gen1 = await createGeneration(home, 'gen-1')
    const gen2 = await createGeneration(home, 'gen-2')
    await setCurrent(home, gen1.name)
    let releaseReader: (() => void) | undefined
    const readerCanFinish = new Promise<void>((resolve) => {
      releaseReader = resolve
    })
    let readerEntered: (() => void) | undefined
    const readerDidEnter = new Promise<void>((resolve) => {
      readerEntered = resolve
    })
    const reader = Effect.runPromise(
      withCurrentGeneration(home, () =>
        Effect.promise(() => {
          readerEntered?.()
          return readerCanFinish
        }),
      ),
    )
    await readerDidEnter
    await setCurrent(home, gen2.name)

    await expect(
      Effect.runPromise(reapGeneration(home, gen1.name, { graceMs: 0 })),
    ).resolves.toEqual({ generation: 'gen-1', status: 'leased' })
    releaseReader?.()
    await reader
    await expect(
      Effect.runPromise(reapGeneration(home, gen1.name, { graceMs: 0 })),
    ).resolves.toEqual({ generation: 'gen-1', status: 'reaped' })
  })

  it('rereads current immediately before deletion and retains a flipped candidate', async () => {
    const home = await createHome()
    const gen1 = await createGeneration(home, 'gen-1')
    const gen2 = await createGeneration(home, 'gen-2')
    await setCurrent(home, gen2.name)
    const runtime: GenerationReaperRuntime = {
      beforeDelete: async () => setCurrent(home, gen1.name),
    }

    await expect(
      Effect.runPromise(
        reapGeneration(home, gen1.name, { graceMs: 0 }, runtime),
      ),
    ).resolves.toEqual({ generation: 'gen-1', status: 'current' })
    expect(await exists(gen1.root)).toBe(true)
  })

  it('evicts a generation cache before deletion', async () => {
    const home = await createHome()
    const gen1 = await createGeneration(home, 'gen-1')
    const gen2 = await createGeneration(home, 'gen-2')
    await setCurrent(home, gen2.name)
    const key = hnswCacheKey(gen1.home, 'provider_model_8', gen1.name)
    const retainedKey = hnswCacheKey(gen2.home, 'provider_model_8', gen2.name)
    setHnswCacheEntry(key, {} as VectorStore)
    setHnswCacheEntry(retainedKey, {} as VectorStore)

    await expect(
      Effect.runPromise(reapGeneration(home, gen1.name, { graceMs: 0 })),
    ).resolves.toEqual({ generation: gen1.name, status: 'reaped' })

    expect(getHnswCacheEntry(key)).toBeUndefined()
    expect(getHnswCacheEntry(retainedKey)).toBeDefined()
  })

  it('sweeps only finalized generations below current in numeric order', async () => {
    const home = await createHome()
    const gen2 = await createGeneration(home, 'gen-2')
    const gen10 = await createGeneration(home, 'gen-10')
    const gen11 = await createGeneration(home, 'gen-11')
    await setCurrent(home, gen11.name)

    await expect(
      Effect.runPromise(reapOldGenerations(home, { graceMs: 0 })),
    ).resolves.toEqual([
      { generation: gen2.name, status: 'reaped' },
      { generation: gen10.name, status: 'reaped' },
    ])
  })
})

describe.skipIf(CHILD_HOME !== undefined)(
  'generation reaper integration',
  () => {
    it('wires one nonblocking sweep into writer, CLI, and MCP startup', async () => {
      const [writer, cli, mcp] = await Promise.all([
        fs.readFile(path.resolve('src/db/generation-writer.ts'), 'utf8'),
        fs.readFile(path.resolve('src/cli/main.ts'), 'utf8'),
        fs.readFile(path.resolve('src/mcp/server.ts'), 'utf8'),
      ])

      for (const source of [writer, cli, mcp]) {
        expect(source.match(/scheduleGenerationReap\(/g)).toHaveLength(1)
      }
    })

    it('retains a live cross-process lease on every supported CI platform', async () => {
      const home = await createHome()
      const gen1 = await createGeneration(home, 'gen-1')
      const gen2 = await createGeneration(home, 'gen-2')
      await setCurrent(home, gen1.name)
      const readyPath = path.join(home, 'child.ready')
      const releasePath = path.join(home, 'child.release')
      const child = spawn(
        process.execPath,
        [
          path.resolve('node_modules/vitest/vitest.mjs'),
          'run',
          'src/db/generation-reaper.test.ts',
        ],
        {
          env: {
            ...process.env,
            MDM_REAPER_CHILD_HOME: home,
            MDM_REAPER_CHILD_READY: readyPath,
            MDM_REAPER_CHILD_RELEASE: releasePath,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )
      const completed = waitForChild(child)

      try {
        await Promise.race([
          waitForPath(readyPath),
          completed.then(() => {
            throw new Error('Lease child exited before acquiring its lease')
          }),
        ])
        await setCurrent(home, gen2.name)
        await expect(
          Effect.runPromise(reapGeneration(home, gen1.name, { graceMs: 0 })),
        ).resolves.toEqual({ generation: 'gen-1', status: 'leased' })

        await fs.writeFile(releasePath, 'release')
        await completed
        await expect(
          Effect.runPromise(reapGeneration(home, gen1.name, { graceMs: 0 })),
        ).resolves.toEqual({ generation: 'gen-1', status: 'reaped' })
      } finally {
        child.kill()
      }
    }, 30_000)
  },
)

describe.runIf(CHILD_HOME !== undefined)('generation reaper child', () => {
  it('holds one live lease until released', async () => {
    if (
      CHILD_HOME === undefined ||
      CHILD_READY === undefined ||
      CHILD_RELEASE === undefined
    ) {
      throw new Error('Incomplete generation reaper child environment')
    }
    await Effect.runPromise(
      withCurrentGeneration(CHILD_HOME, () =>
        Effect.promise(async () => {
          await fs.writeFile(CHILD_READY, 'ready')
          await waitForPath(CHILD_RELEASE)
        }),
      ),
    )
  })
})
