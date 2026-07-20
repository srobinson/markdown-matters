import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  generationHomeLayout,
  generationLayout,
  parseGenerationName,
} from './generation-paths.js'
import {
  type GenerationReaderCheckpoint,
  type GenerationReaderFileSystem,
  initializeLeaseGate,
  nodeGenerationReaderFileSystem,
  withCurrentGeneration,
} from './generation-reader.js'
import type { GenerationLayout } from './generation-types.js'
import type { ProcessIdentity, ProcessInspector } from './process-identity.js'

const processIdentity: ProcessIdentity = {
  pid: 100,
  startedAt: 'started-100',
  bootId: 'boot-1',
}

const processInspector: ProcessInspector = {
  current: () => Effect.succeed(processIdentity),
  inspect: () => Effect.succeed(processIdentity),
}

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect)

const createHome = (): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), 'mdm-generation-reader-'))

const generation = async (
  home: string,
  rawName: string,
): Promise<GenerationLayout> => {
  const name = await run(parseGenerationName(rawName))
  const layout = generationLayout(home, name)
  await fs.mkdir(layout.root, { recursive: true })
  await run(initializeLeaseGate(layout))
  return layout
}

const publish = async (home: string, name: string): Promise<void> => {
  const layout = generationHomeLayout(home)
  await fs.mkdir(layout.home, { recursive: true })
  await fs.writeFile(layout.current, name)
}

const listDirectory = async (directoryPath: string): Promise<string[]> => {
  try {
    return await fs.readdir(directoryPath)
  } catch (cause) {
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      cause.code === 'ENOENT'
    ) {
      return []
    }
    throw cause
  }
}

const listAllLeases = async (
  layouts: readonly GenerationLayout[],
): Promise<string[]> => {
  const leases = await Promise.all(
    layouts.flatMap((layout) => [
      listDirectory(layout.openLeases),
      listDirectory(layout.closedLeases),
    ]),
  )
  return leases.flat().sort()
}

const fileSystemWithCheckpoint = (
  checkpoint: (
    phase: GenerationReaderCheckpoint,
    layout: GenerationLayout,
  ) => Promise<void>,
): GenerationReaderFileSystem => ({
  ...nodeGenerationReaderFileSystem,
  checkpoint,
})

describe('generation read leases', () => {
  it('holds one lease through the complete callback', async () => {
    const home = await createHome()
    const gen1 = await generation(home, 'gen-1')
    await publish(home, 'gen-1')
    const phases: GenerationReaderCheckpoint[] = []

    try {
      const session = await run(
        withCurrentGeneration(
          home,
          (session) =>
            Effect.promise(async () => {
              expect(await listAllLeases([gen1])).toEqual([session.leaseId])
              return session
            }),
          {
            inspector: processInspector,
            fileSystem: fileSystemWithCheckpoint(async (phase) => {
              phases.push(phase)
            }),
          },
        ),
      )

      expect(session).toMatchObject({
        home: gen1.home,
        generation: gen1.name,
        indexRoot: gen1.root,
      })
      expect(phases).toEqual([
        'after-current-read',
        'before-lease-insert',
        'after-lease-insert',
        'before-current-reread',
      ])
      expect(await listAllLeases([gen1])).toEqual([])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it.each([
    'after-current-read',
    'before-lease-insert',
  ] as const)('retries when the gate closes at %s', async (racePhase) => {
    const home = await createHome()
    const gen1 = await generation(home, 'gen-1')
    const gen2 = await generation(home, 'gen-2')
    await publish(home, 'gen-1')
    let raced = false
    const callbackGenerations: string[] = []
    const fileSystem = fileSystemWithCheckpoint(async (phase, layout) => {
      if (!raced && layout.name === gen1.name && phase === racePhase) {
        raced = true
        await publish(home, 'gen-2')
        await fs.rename(gen1.openLeases, gen1.closedLeases)
      }
    })

    try {
      await run(
        withCurrentGeneration(
          home,
          (session) =>
            Effect.sync(() => {
              callbackGenerations.push(session.generation)
            }),
          { inspector: processInspector, fileSystem },
        ),
      )

      expect(callbackGenerations).toEqual(['gen-2'])
      expect(await listAllLeases([gen1, gen2])).toEqual([])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it.each([
    'after-lease-insert',
    'before-current-reread',
  ] as const)('retries when current changes at %s', async (racePhase) => {
    const home = await createHome()
    const gen1 = await generation(home, 'gen-1')
    const gen2 = await generation(home, 'gen-2')
    await publish(home, 'gen-1')
    let raced = false
    const callbackGenerations: string[] = []
    const fileSystem = fileSystemWithCheckpoint(async (phase, layout) => {
      if (!raced && layout.name === gen1.name && phase === racePhase) {
        raced = true
        await publish(home, 'gen-2')
        await fs.rename(gen1.openLeases, gen1.closedLeases)
      }
    })

    try {
      await run(
        withCurrentGeneration(
          home,
          (session) =>
            Effect.sync(() => {
              callbackGenerations.push(session.generation)
            }),
          { inspector: processInspector, fileSystem },
        ),
      )

      expect(callbackGenerations).toEqual(['gen-2'])
      expect(await listAllLeases([gen1, gen2])).toEqual([])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})

describe('generation read lease release', () => {
  it('releases a lease when the gate moves after the hard link', async () => {
    const home = await createHome()
    const gen1 = await generation(home, 'gen-1')
    const gen2 = await generation(home, 'gen-2')
    await publish(home, 'gen-1')
    let raced = false
    const fileSystem: GenerationReaderFileSystem = {
      ...nodeGenerationReaderFileSystem,
      link: async (sourcePath, targetPath) => {
        await nodeGenerationReaderFileSystem.link(sourcePath, targetPath)
        if (!raced && targetPath.startsWith(`${gen1.openLeases}/`)) {
          raced = true
          await publish(home, 'gen-2')
          await fs.rename(gen1.openLeases, gen1.closedLeases)
        }
      },
    }

    try {
      const callbackGenerations: string[] = []
      await run(
        withCurrentGeneration(
          home,
          (session) =>
            Effect.sync(() => {
              callbackGenerations.push(session.generation)
            }),
          { inspector: processInspector, fileSystem },
        ),
      )

      expect(callbackGenerations).toEqual(['gen-2'])
      expect(await listAllLeases([gen1, gen2])).toEqual([])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('retains gen-1 when admission linearizes before publication', async () => {
    const home = await createHome()
    const gen1 = await generation(home, 'gen-1')
    const gen2 = await generation(home, 'gen-2')
    await publish(home, 'gen-1')
    const callbackGenerations: string[] = []

    try {
      await run(
        withCurrentGeneration(
          home,
          (session) =>
            Effect.promise(async () => {
              callbackGenerations.push(session.generation)
              await publish(home, 'gen-2')
              await fs.rename(gen1.openLeases, gen1.closedLeases)
              expect(await listAllLeases([gen1, gen2])).toEqual([
                session.leaseId,
              ])
            }),
          { inspector: processInspector },
        ),
      )

      expect(callbackGenerations).toEqual(['gen-1'])
      expect(await listAllLeases([gen1, gen2])).toEqual([])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('releases the lease after callback failure', async () => {
    const home = await createHome()
    const gen1 = await generation(home, 'gen-1')
    await publish(home, 'gen-1')

    try {
      await expect(
        run(
          withCurrentGeneration(
            home,
            () => Effect.fail(new Error('read failed')),
            { inspector: processInspector },
          ),
        ),
      ).rejects.toThrow('read failed')
      expect(await listAllLeases([gen1])).toEqual([])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })

  it('releases the lease after callback cancellation', async () => {
    const home = await createHome()
    const gen1 = await generation(home, 'gen-1')
    await publish(home, 'gen-1')
    let admitted: (() => void) | undefined
    const didAdmit = new Promise<void>((resolve) => {
      admitted = resolve
    })
    const fiber = Effect.runFork(
      withCurrentGeneration(
        home,
        () =>
          Effect.gen(function* () {
            admitted?.()
            yield* Effect.never
          }),
        { inspector: processInspector },
      ),
    )

    try {
      await didAdmit
      expect(await listAllLeases([gen1])).toHaveLength(1)
      await run(Fiber.interrupt(fiber))
      expect(await listAllLeases([gen1])).toEqual([])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})

describe('generation read lease gate movement', () => {
  it('releases when the gate moves after lease removal', async () => {
    const home = await createHome()
    const gen1 = await generation(home, 'gen-1')
    await generation(home, 'gen-2')
    await publish(home, 'gen-1')
    let gateMoved = false
    const fileSystem: GenerationReaderFileSystem = {
      ...nodeGenerationReaderFileSystem,
      unlink: async (targetPath) => {
        await nodeGenerationReaderFileSystem.unlink(targetPath)
        if (!gateMoved && targetPath.startsWith(`${gen1.openLeases}/`)) {
          gateMoved = true
          await fs.rename(gen1.openLeases, gen1.closedLeases)
        }
      },
    }

    try {
      await run(
        withCurrentGeneration(
          home,
          () => Effect.promise(() => publish(home, 'gen-2')),
          { inspector: processInspector, fileSystem },
        ),
      )

      expect(gateMoved).toBe(true)
      expect(await listAllLeases([gen1])).toEqual([])
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})

describe('lease gate initialization', () => {
  it('never reopens a closed gate', async () => {
    const home = await createHome()
    const gen1 = await generation(home, 'gen-1')
    await fs.rename(gen1.openLeases, gen1.closedLeases)

    try {
      const error = await run(Effect.flip(initializeLeaseGate(gen1)))
      expect(error).toMatchObject({
        _tag: 'GenerationReadError',
      })
      await expect(fs.access(gen1.openLeases)).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  })
})
