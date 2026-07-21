import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getActiveProviderPath,
  getEmbeddingsDir,
  getMetaPath,
  getVectorPath,
} from '../embeddings/embedding-namespace-paths.js'
import { getIndexPaths } from '../index/types.js'
import { GenerationPathError } from './generation-errors.js'
import {
  generationHomeLayout,
  generationLayout,
  nextGenerationName,
  parseGenerationName,
  readCurrentGeneration,
  stagingGenerationPath,
} from './generation-paths.js'
import type { GenerationName } from './generation-types.js'

const cleanup: string[] = []

const createHome = async (): Promise<string> => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-generation-'))
  cleanup.push(home)
  return home
}

const portable = (value: string): string => value.split(path.sep).join('/')

const expectGenerationPathFailure = async <A, E>(
  effect: Effect.Effect<A, E>,
): Promise<void> => {
  const exit = await Effect.runPromiseExit(effect)
  expect(exit).toMatchObject({
    _tag: 'Failure',
    cause: {
      _tag: 'Fail',
      error: { _tag: 'GenerationPathError' },
    },
  })
}

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

describe('generation names', () => {
  it('accepts a positive canonical generation name', async () => {
    expect(await Effect.runPromise(parseGenerationName('gen-1'))).toBe('gen-1')
  })

  it.each([
    'gen-0',
    'gen-01',
    'gen--1',
    '../gen-1',
    '/gen-1',
    ' gen-1',
    'gen-1\n',
    'gen-1/x',
    'gen-%2e%2e',
    '%2e%2e/',
    'gen-..%2f',
    'gen-..%5c',
  ])('rejects malformed generation name %j', async (raw) => {
    await expectGenerationPathFailure(parseGenerationName(raw))
  })

  it('allocates monotonically with integer precision', async () => {
    const first = await Effect.runPromise(parseGenerationName('gen-1'))
    const large = await Effect.runPromise(
      parseGenerationName('gen-9007199254740993'),
    )

    expect(nextGenerationName([])).toBe('gen-1')
    expect(nextGenerationName([large, first])).toBe('gen-9007199254740994')
  })
})

describe('generation layouts', () => {
  it('constructs contained portable paths from a normalized home', async () => {
    const home = await createHome()
    const name = await Effect.runPromise(parseGenerationName('gen-1'))
    const homeLayout = generationHomeLayout(path.join(home, '.'))
    const layout = generationLayout(home, name)
    const normalizedHome = homeLayout.home

    expect(homeLayout).toEqual({
      home: normalizedHome,
      current: portable(path.join(normalizedHome, 'current')),
      staging: portable(path.join(normalizedHome, 'staging')),
      writerLock: portable(path.join(normalizedHome, 'writer.lock')),
      writerReclaim: portable(path.join(normalizedHome, 'writer.reclaim')),
    })
    expect(layout).toEqual({
      home: normalizedHome,
      name: 'gen-1',
      root: portable(path.join(normalizedHome, 'gen-1')),
      leasesRoot: portable(path.join(normalizedHome, 'gen-1', 'leases')),
      openLeases: portable(
        path.join(normalizedHome, 'gen-1', 'leases', 'open'),
      ),
      closedLeases: portable(
        path.join(normalizedHome, 'gen-1', 'leases', 'closed'),
      ),
    })
    expect(path.relative(layout.home, layout.root)).not.toMatch(
      /^\.\.(?:[\\/]|$)/,
    )
  })

  it('builds staged structural and embedding paths against an explicit root', async () => {
    const home = await createHome()
    const name = await Effect.runPromise(parseGenerationName('gen-2'))
    const stagedRoot = stagingGenerationPath(home, name, 'build-token_2')
    const indexPaths = getIndexPaths(stagedRoot)
    const normalizedHome = generationHomeLayout(home).home

    expect(stagedRoot).toBe(
      portable(path.join(normalizedHome, 'staging', 'gen-2-build-token_2')),
    )
    expect(indexPaths.documents).toBe(
      path.join(stagedRoot, 'indexes', 'documents.json'),
    )
    expect(getEmbeddingsDir(stagedRoot)).toBe(
      path.join(stagedRoot, 'embeddings'),
    )
    expect(getActiveProviderPath(stagedRoot)).toBe(
      path.join(stagedRoot, 'active-provider.json'),
    )
    expect(getVectorPath(stagedRoot, 'ollama_model_32')).toBe(
      path.join(stagedRoot, 'embeddings', 'ollama_model_32', 'vectors.bin'),
    )
    expect(getMetaPath(stagedRoot, 'ollama_model_32')).toBe(
      path.join(
        stagedRoot,
        'embeddings',
        'ollama_model_32',
        'vectors.meta.bin',
      ),
    )
  })

  it('rejects a staging token that could escape its explicit root', async () => {
    const home = await createHome()
    const name = await Effect.runPromise(parseGenerationName('gen-1'))

    expect(() => stagingGenerationPath(home, name, '../escape')).toThrowError(
      GenerationPathError,
    )
  })
})

describe('current generation pointer', () => {
  it('returns null for a missing pointer despite direct root artifacts', async () => {
    const home = await createHome()
    await fs.mkdir(path.join(home, 'indexes'))

    expect(await Effect.runPromise(readCurrentGeneration(home))).toBeNull()
  })

  it('decodes the entire regular file contents', async () => {
    const home = await createHome()
    await fs.writeFile(path.join(home, 'current'), 'gen-12')

    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-12')
  })

  it.each([
    '../gen-1',
    '/gen-1',
    ' gen-1',
    'gen-0',
    'gen-1\n',
    'malformed',
    'gen-%2e%2e',
    '%2e%2e/',
    'gen-..%2f',
    'gen-..%5c',
  ])('rejects invalid pointer contents %j', async (contents) => {
    const home = await createHome()
    await fs.writeFile(path.join(home, 'current'), contents)

    await expectGenerationPathFailure(readCurrentGeneration(home))
  })

  it('rejects a directory at the pointer path', async () => {
    const home = await createHome()
    await fs.mkdir(path.join(home, 'current'))

    await expectGenerationPathFailure(readCurrentGeneration(home))
  })

  it('rejects a symlink at the pointer path', async () => {
    const home = await createHome()
    const target = path.join(home, 'pointer-target')
    await fs.writeFile(target, 'gen-1')
    await fs.symlink(target, path.join(home, 'current'))

    await expectGenerationPathFailure(readCurrentGeneration(home))
  })

  it('keeps a decoded generation beneath the normalized home', async () => {
    const home = await createHome()
    await fs.writeFile(path.join(home, 'current'), 'gen-3')
    const current = await Effect.runPromise(readCurrentGeneration(home))
    const layout = generationLayout(home, current as GenerationName)

    expect(path.relative(layout.home, layout.root)).not.toMatch(
      /^\.\.(?:[\\/]|$)/,
    )
  })
})
