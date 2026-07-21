import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect, Fiber } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getMetaPath,
  getVectorPath,
} from '../embeddings/embedding-namespace-paths.js'
import {
  createStorage,
  loadDocumentIndex,
  saveDocumentIndex,
} from '../index/storage.js'
import {
  generationHomeLayout,
  generationLayout,
  parseGenerationName,
  portablePath,
  readCurrentGeneration,
} from './generation-paths.js'
import { initializeLeaseGate } from './generation-reader.js'
import { seedGenerationArtifacts } from './generation-test-fixture.js'
import { validateGeneration } from './generation-validation.js'
import {
  type GenerationBuildContext,
  type GenerationWriterFileSystem,
  type GenerationWriterRuntime,
  nodeGenerationWriterFileSystem,
  writeGeneration,
} from './generation-writer.js'
import type { ProcessInspector } from './process-identity.js'

const cleanup: string[] = []

const createHome = async (): Promise<string> => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-writer-'))
  cleanup.push(home)
  return home
}

const exists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

const readTitle = async (indexRoot: string): Promise<string> => {
  const index = await Effect.runPromise(
    loadDocumentIndex(createStorage(indexRoot, indexRoot)),
  )
  const document = index && Object.values(index.documents)[0]
  if (!document) throw new Error('Seeded document is missing')
  return document.title
}

const writeTitle = (
  context: GenerationBuildContext,
  title: string,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const storage = createStorage(context.indexRoot, context.indexRoot)
    const index = yield* loadDocumentIndex(storage).pipe(
      Effect.mapError((cause) => new Error(String(cause))),
    )
    if (index === null) return yield* Effect.fail(new Error('Index is missing'))
    const documents = Object.fromEntries(
      Object.entries(index.documents).map(([key, document]) => [
        key,
        { ...document, title },
      ]),
    )
    yield* saveDocumentIndex(storage, { ...index, documents }).pipe(
      Effect.mapError((cause) => new Error(String(cause))),
    )
    return title
  })

const testRuntime = (
  runtime: GenerationWriterRuntime = {},
): GenerationWriterRuntime => ({
  ...runtime,
  scheduleReap: () => undefined,
})

const seedCurrent = async (
  home: string,
  rawName = 'gen-1',
): Promise<string> => {
  const name = await Effect.runPromise(parseGenerationName(rawName))
  const layout = generationLayout(home, name)
  await seedGenerationArtifacts(layout.root)
  await Effect.runPromise(initializeLeaseGate(layout))
  await fs.writeFile(generationHomeLayout(home).current, name)
  return layout.root
}

const validatedWrite = (
  home: string,
  title: string,
  runtime: GenerationWriterRuntime = {},
) =>
  writeGeneration(
    {
      home,
      build: (context) => writeTitle(context, title),
      validate: (context) =>
        validateGeneration(context.indexRoot).pipe(Effect.asVoid),
    },
    testRuntime(runtime),
  )

const failingFileSystem = (
  shouldFail: (sourcePath: string, targetPath: string) => boolean,
): GenerationWriterFileSystem => ({
  ...nodeGenerationWriterFileSystem,
  rename: async (sourcePath, targetPath) => {
    if (shouldFail(sourcePath, targetPath)) {
      throw new Error(`Injected rename failure for ${targetPath}`)
    }
    await nodeGenerationWriterFileSystem.rename(sourcePath, targetPath)
  },
})

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

describe('writeGeneration', () => {
  it('builds a fresh gen-1 without importing direct-root artifacts', async () => {
    const home = await createHome()
    await seedGenerationArtifacts(home)
    const legacyNamespace = 'legacy_model_2'
    const legacyVector = getVectorPath(home, legacyNamespace)
    const legacyMetadata = getMetaPath(home, legacyNamespace)
    await fs.mkdir(path.dirname(legacyVector), { recursive: true })
    await fs.writeFile(legacyVector, 'legacy-vector')
    await fs.writeFile(legacyMetadata, 'legacy-metadata')
    const contexts: GenerationBuildContext[] = []

    const published = await Effect.runPromise(
      writeGeneration(
        {
          home,
          build: (context) => {
            contexts.push(context)
            return Effect.promise(() =>
              seedGenerationArtifacts(context.indexRoot),
            ).pipe(Effect.andThen(writeTitle(context, 'fresh')))
          },
          validate: (context) =>
            validateGeneration(context.indexRoot).pipe(Effect.asVoid),
        },
        testRuntime(),
      ),
    )

    expect(published.generation).toBe('gen-1')
    expect(published.indexRoot).toBe(
      generationLayout(home, published.generation).root,
    )
    expect(published.value).toBe('fresh')
    expect(contexts).toHaveLength(1)
    expect(contexts[0]).toMatchObject({
      home: generationHomeLayout(home).home,
      previous: null,
      generation: 'gen-1',
    })
    expect(contexts[0]!.indexRoot).toContain(
      `${generationHomeLayout(home).staging}/`,
    )
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-1')
    expect(await readTitle(home)).toBe('old')
    expect(await readTitle(published.indexRoot)).toBe('fresh')
    expect(await fs.readFile(legacyVector, 'utf8')).toBe('legacy-vector')
    expect(
      await exists(getVectorPath(published.indexRoot, legacyNamespace)),
    ).toBe(false)
    expect(
      await exists(getMetaPath(published.indexRoot, legacyNamespace)),
    ).toBe(false)
  })

  it('allocates after every finalized generation without reusing an orphan', async () => {
    const home = await createHome()
    await seedCurrent(home)
    await fs.mkdir(path.join(home, 'gen-2'))

    const published = await Effect.runPromise(validatedWrite(home, 'gen-3'))

    expect(published.generation).toBe('gen-3')
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-3')
    expect(await exists(path.join(home, 'gen-2'))).toBe(true)
  })

  it('allocates fresh transaction state each time an Effect is run', async () => {
    const home = await createHome()
    await seedCurrent(home)
    const write = validatedWrite(home, 'reused-effect')

    const first = await Effect.runPromise(write)
    const second = await Effect.runPromise(write)

    expect([first.generation, second.generation]).toEqual(['gen-2', 'gen-3'])
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-3')
  })

  it('copies only database artifacts with independent file identities', async () => {
    const home = await createHome()
    const oldRoot = await seedCurrent(home)
    await fs.writeFile(
      path.join(oldRoot, 'leases', 'open', 'old-lease'),
      'lease',
    )
    await fs.mkdir(path.join(oldRoot, 'cache'))
    await fs.writeFile(path.join(oldRoot, 'cache', 'old-cache'), 'cache')
    await fs.writeFile(path.join(oldRoot, 'old.tmp'), 'temporary')
    const oldDocuments = createStorage(oldRoot, oldRoot).paths.documents
    const oldStat = await fs.stat(oldDocuments)

    const published = await Effect.runPromise(validatedWrite(home, 'new'))
    const newDocuments = createStorage(published.indexRoot, published.indexRoot)
      .paths.documents
    const newStat = await fs.stat(newDocuments)

    expect(newStat.ino).not.toBe(oldStat.ino)
    expect(
      await fs.readdir(path.join(published.indexRoot, 'leases', 'open')),
    ).toEqual([])
    expect(await exists(path.join(published.indexRoot, 'cache'))).toBe(false)
    expect(await exists(path.join(published.indexRoot, 'old.tmp'))).toBe(false)
  })

  it('removes stale unpublished staging directories before building', async () => {
    const home = await createHome()
    await seedCurrent(home)
    const stale = path.join(home, 'staging', 'gen-77-crashed')
    await fs.mkdir(stale, { recursive: true })
    await fs.writeFile(path.join(stale, 'partial'), 'partial')

    const published = await Effect.runPromise(validatedWrite(home, 'fresh'))

    expect(await exists(stale)).toBe(false)
    expect(await readTitle(published.indexRoot)).toBe('fresh')
  })
})

describe('writeGeneration validation', () => {
  it('discards a validated no-op staging generation', async () => {
    const home = await createHome()
    const oldRoot = await seedCurrent(home)
    const events: string[] = []

    const published = await Effect.runPromise(
      writeGeneration(
        {
          home,
          build: (context) => writeTitle(context, 'discarded'),
          validate: (context) =>
            validateGeneration(context.indexRoot).pipe(
              Effect.tap(() => Effect.sync(() => events.push('validated'))),
              Effect.asVoid,
            ),
          shouldPublish: () => false,
        },
        { scheduleReap: () => events.push('reaped') },
      ),
    )

    expect(published).toMatchObject({
      generation: 'gen-1',
      indexRoot: oldRoot,
      value: 'discarded',
    })
    expect(events).toEqual(['validated'])
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-1')
    expect(await readTitle(oldRoot)).toBe('old')
    expect(await exists(path.join(home, 'gen-2'))).toBe(false)
    expect(await fs.readdir(path.join(home, 'staging'))).toEqual([])
  })

  it('runs prepare, build, and validation under the transaction in order', async () => {
    const home = await createHome()
    await seedCurrent(home)
    const events: string[] = []
    const inspector: ProcessInspector = {
      current: () =>
        Effect.sync(() => {
          events.push('lock')
          return { pid: process.pid, startedAt: 'test', bootId: 'test' }
        }),
      inspect: () => Effect.succeed(null),
    }
    let staged = false
    const fileSystem: GenerationWriterFileSystem = {
      ...nodeGenerationWriterFileSystem,
      makeDirectory: async (directoryPath, recursive) => {
        if (
          !staged &&
          !recursive &&
          portablePath(directoryPath).split('/').includes('staging')
        ) {
          staged = true
          events.push('stage')
        }
        await nodeGenerationWriterFileSystem.makeDirectory(
          directoryPath,
          recursive,
        )
      },
      rename: async (sourcePath, targetPath) => {
        if (path.basename(targetPath) === 'gen-2') events.push('publish')
        await nodeGenerationWriterFileSystem.rename(sourcePath, targetPath)
      },
    }

    await Effect.runPromise(
      writeGeneration(
        {
          home,
          preflight: () => Effect.sync(() => events.push('preflight')),
          prepare: () => Effect.sync(() => events.push('prepare')),
          build: (context) =>
            Effect.sync(() => events.push('build')).pipe(
              Effect.andThen(writeTitle(context, 'ordered')),
            ),
          validate: (context) =>
            Effect.sync(() => events.push('validate')).pipe(
              Effect.andThen(validateGeneration(context.indexRoot)),
              Effect.asVoid,
            ),
        },
        testRuntime({ fileSystem, writerLock: { inspector } }),
      ),
    )

    expect(events).toEqual([
      'lock',
      'preflight',
      'prepare',
      'stage',
      'build',
      'validate',
      'publish',
    ])
  })

  it('runs preflight before prepare and creates no state when it rejects', async () => {
    const home = await createHome()
    await seedCurrent(home)
    const manifest = path.join(home, 'manifest.toml')
    await fs.writeFile(manifest, 'before')
    const beforeManifest = await fs.readFile(manifest, 'utf8')
    const beforeEntries = (await fs.readdir(home)).sort()
    const currentPath = generationHomeLayout(home).current
    const beforeCurrent = await fs.readFile(currentPath, 'utf8')
    const failure = new Error('preflight rejected')

    const exit = await Effect.runPromiseExit(
      writeGeneration(
        {
          home,
          preflight: () => Effect.fail(failure),
          prepare: () =>
            Effect.promise(() => fs.appendFile(manifest, 'changed')),
          build: (context) => writeTitle(context, 'unreachable'),
          validate: () => Effect.void,
        },
        testRuntime(),
      ),
    )

    expect(exit).toMatchObject({
      _tag: 'Failure',
      cause: { _tag: 'Fail', error: failure },
    })
    expect(await fs.readFile(manifest, 'utf8')).toBe(beforeManifest)
    expect((await fs.readdir(home)).sort()).toEqual(beforeEntries)
    expect(await fs.readFile(currentPath, 'utf8')).toBe(beforeCurrent)
  })

  it.each([
    'build',
    'validate',
  ] as const)('retains current when %s rejects', async (failurePoint) => {
    const home = await createHome()
    const oldRoot = await seedCurrent(home)
    const failure = new Error(`${failurePoint} rejected`)

    const exit = await Effect.runPromiseExit(
      writeGeneration(
        {
          home,
          build: (context) =>
            failurePoint === 'build'
              ? Effect.fail(failure)
              : writeTitle(context, 'rejected'),
          validate: (context) =>
            failurePoint === 'validate'
              ? Effect.fail(failure)
              : validateGeneration(context.indexRoot).pipe(Effect.asVoid),
        },
        testRuntime(),
      ),
    )

    expect(exit).toMatchObject({
      _tag: 'Failure',
      cause: { _tag: 'Fail', error: failure },
    })
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-1')
    expect(await readTitle(oldRoot)).toBe('old')
  })

  it('always rejects an incomplete artifact set before publication', async () => {
    const home = await createHome()
    await seedCurrent(home)

    const exit = await Effect.runPromiseExit(
      writeGeneration(
        {
          home,
          build: (context) =>
            Effect.promise(async () => {
              const storage = createStorage(
                context.indexRoot,
                context.indexRoot,
              )
              await fs.unlink(storage.paths.bm25Metadata)
              return 'incomplete'
            }),
          validate: () => Effect.void,
        },
        testRuntime(),
      ),
    )

    expect(exit).toMatchObject({
      _tag: 'Failure',
      cause: {
        _tag: 'Fail',
        error: { _tag: 'GenerationValidationError' },
      },
    })
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-1')
  })
})

describe('writeGeneration publication', () => {
  it.each([
    [
      'generation rename',
      (targetPath: string) => path.basename(targetPath) === 'gen-2',
    ],
    [
      'pointer rename',
      (targetPath: string) => path.basename(targetPath) === 'current',
    ],
  ] as const)('reports an unpublished %s fault', async (_, matchesTarget) => {
    const home = await createHome()
    await seedCurrent(home)
    const fileSystem = failingFileSystem((__, targetPath) =>
      matchesTarget(targetPath),
    )

    const error = await Effect.runPromise(
      Effect.flip(validatedWrite(home, 'faulted', { fileSystem })),
    )

    expect(error).toMatchObject({
      _tag: 'GenerationWriteError',
      commitState: 'not-published',
      generation: 'gen-2',
    })
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-1')
  })

  it('removes an unpublished generation after its final rename', async () => {
    const home = await createHome()
    const oldRoot = await seedCurrent(home)
    const normalizedHome = generationHomeLayout(home).home
    let generationRenamed = false
    const fileSystem: GenerationWriterFileSystem = {
      ...nodeGenerationWriterFileSystem,
      platform: 'linux',
      rename: async (sourcePath, targetPath) => {
        await nodeGenerationWriterFileSystem.rename(sourcePath, targetPath)
        if (path.basename(targetPath) === 'gen-2') generationRenamed = true
      },
      openDirectory: async (directoryPath) => {
        if (generationRenamed && directoryPath === normalizedHome) {
          throw new Error('Injected pre-pointer home sync failure')
        }
        return { sync: async () => undefined, close: async () => undefined }
      },
    }

    const error = await Effect.runPromise(
      Effect.flip(validatedWrite(home, 'unpublished', { fileSystem })),
    )

    expect(error).toMatchObject({
      _tag: 'GenerationWriteError',
      commitState: 'not-published',
      generation: 'gen-2',
    })
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-1')
    expect(await exists(path.join(home, 'gen-2'))).toBe(false)
    expect(await readTitle(oldRoot)).toBe('old')
  })

  it('reports published when home sync fails after the pointer rename', async () => {
    const home = await createHome()
    await seedCurrent(home)
    const normalizedHome = generationHomeLayout(home).home
    const currentPath = generationHomeLayout(home).current
    let pointerRenamed = false
    const fileSystem: GenerationWriterFileSystem = {
      ...nodeGenerationWriterFileSystem,
      platform: 'linux',
      rename: async (sourcePath, targetPath) => {
        await nodeGenerationWriterFileSystem.rename(sourcePath, targetPath)
        if (targetPath === currentPath) pointerRenamed = true
      },
      openDirectory: async (directoryPath) => {
        if (pointerRenamed && directoryPath === normalizedHome) {
          throw new Error('Injected final home sync failure')
        }
        return { sync: async () => undefined, close: async () => undefined }
      },
    }

    const error = await Effect.runPromise(
      Effect.flip(validatedWrite(home, 'published', { fileSystem })),
    )

    expect(error).toMatchObject({
      _tag: 'GenerationWriteError',
      commitState: 'published',
      generation: 'gen-2',
    })
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-2')
    await expect(
      Effect.runPromise(validateGeneration(path.join(home, 'gen-2'))),
    ).resolves.toMatchObject({ documents: 1, sections: 1 })
  })

  it('finishes an uninterruptible publication after the commit phase begins', async () => {
    const home = await createHome()
    await seedCurrent(home)
    let enteredRename: (() => void) | undefined
    const renameStarted = new Promise<void>((resolve) => {
      enteredRename = resolve
    })
    let continueRename: (() => void) | undefined
    const canRename = new Promise<void>((resolve) => {
      continueRename = resolve
    })
    const fileSystem: GenerationWriterFileSystem = {
      ...nodeGenerationWriterFileSystem,
      rename: async (sourcePath, targetPath) => {
        if (path.basename(targetPath) === 'gen-2') {
          enteredRename?.()
          await canRename
        }
        await nodeGenerationWriterFileSystem.rename(sourcePath, targetPath)
      },
    }
    const fiber = Effect.runFork(
      validatedWrite(home, 'interrupt-safe', { fileSystem }),
    )

    await renameStarted
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber))
    continueRename?.()
    await interrupted

    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-2')
    await expect(
      Effect.runPromise(validateGeneration(path.join(home, 'gen-2'))),
    ).resolves.toMatchObject({ documents: 1, sections: 1 })
  })
})
