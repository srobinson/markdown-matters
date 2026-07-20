import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import {
  generateNamespace,
  getActiveProviderPath,
  getMetaPath,
  getVectorPath,
} from '../embeddings/embedding-namespace.js'
import { seedFreshVectorFixture } from '../embeddings/vector-store-test-fixture.js'
import { getIndexPaths } from '../index/types.js'
import { seedGenerationArtifacts } from './generation-test-fixture.js'
import { validateGeneration } from './generation-validation.js'

const cleanup: string[] = []
const dimensions = 8
const provider = 'test-provider'
const model = 'test-model'

const createRoot = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-validation-'))
  cleanup.push(root)
  return root
}

const seedSemanticArtifacts = async (root: string): Promise<void> => {
  await seedFreshVectorFixture({ indexRoot: root, provider, model, dimensions })
}

type Mutation = 'missing' | 'corrupt' | 'symlink'

const mutateArtifact = async (
  root: string,
  artifactPath: string,
  mutation: Mutation,
): Promise<void> => {
  if (mutation === 'missing') {
    await fs.unlink(artifactPath)
    return
  }
  if (mutation === 'corrupt') {
    await fs.writeFile(artifactPath, 'corrupt')
    return
  }

  const target = path.join(
    root,
    `.symlink-target-${path.basename(artifactPath)}`,
  )
  await fs.writeFile(target, 'corrupt')
  await fs.unlink(artifactPath)
  await fs.symlink(target, artifactPath, 'file')
}

const expectValidationFailure = async (root: string): Promise<void> => {
  await expect(
    Effect.runPromiseExit(validateGeneration(root)),
  ).resolves.toMatchObject({
    _tag: 'Failure',
    cause: {
      _tag: 'Fail',
      error: { _tag: 'GenerationValidationError' },
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

describe('validateGeneration', () => {
  it('summarizes complete structural artifacts without semantics', async () => {
    const root = await createRoot()
    await seedGenerationArtifacts(root)

    await expect(Effect.runPromise(validateGeneration(root))).resolves.toEqual({
      documents: 1,
      sections: 1,
      links: 1,
      bm25Sections: 1,
      activeNamespace: null,
      vectors: 0,
    })
  })

  it('loads and summarizes the active semantic namespace', async () => {
    const root = await createRoot()
    await seedGenerationArtifacts(root)
    await seedSemanticArtifacts(root)

    await expect(
      Effect.runPromise(validateGeneration(root)),
    ).resolves.toMatchObject({
      activeNamespace: generateNamespace(provider, model, dimensions),
      vectors: 12,
    })
  })

  it('reloads structural bytes when a mutation preserves mtime', async () => {
    const root = await createRoot()
    await seedGenerationArtifacts(root)
    const documentsPath = getIndexPaths(root).documents
    const cachedMtime = new Date(1_700_000_000_000)
    await fs.utimes(documentsPath, cachedMtime, cachedMtime)
    await Effect.runPromise(validateGeneration(root))
    await fs.writeFile(documentsPath, 'corrupt')
    await fs.utimes(documentsPath, cachedMtime, cachedMtime)
    expect((await fs.stat(documentsPath)).mtimeMs).toBe(cachedMtime.getTime())

    await expectValidationFailure(root)
  })

  it('allows complete inactive Plan 3 namespaces beside the active namespace', async () => {
    const root = await createRoot()
    await seedGenerationArtifacts(root)
    await seedFreshVectorFixture({
      indexRoot: root,
      provider: 'inactive-provider',
      model: 'inactive-model',
      dimensions,
    })
    await seedSemanticArtifacts(root)

    await expect(
      Effect.runPromise(validateGeneration(root)),
    ).resolves.toMatchObject({
      activeNamespace: generateNamespace(provider, model, dimensions),
      vectors: 12,
    })
  })

  it.each([
    'documents',
    'sections',
    'links',
  ] as const)('rejects every invalid %s structural artifact', async (artifact) => {
    for (const mutation of ['missing', 'corrupt', 'symlink'] as const) {
      const root = await createRoot()
      await seedGenerationArtifacts(root)
      await mutateArtifact(root, getIndexPaths(root)[artifact], mutation)
      await expectValidationFailure(root)
    }
  })

  it.each([
    'bm25',
    'bm25Metadata',
  ] as const)('rejects every invalid %s artifact', async (artifact) => {
    for (const mutation of ['missing', 'corrupt', 'symlink'] as const) {
      const root = await createRoot()
      await seedGenerationArtifacts(root)
      await mutateArtifact(root, getIndexPaths(root)[artifact], mutation)
      await expectValidationFailure(root)
    }
  })

  it('rejects semantic artifacts without an active provider', async () => {
    const root = await createRoot()
    await seedGenerationArtifacts(root)
    await seedSemanticArtifacts(root)
    await fs.unlink(getActiveProviderPath(root))

    await expectValidationFailure(root)
  })

  it.each([
    'corrupt',
    'symlink',
  ] as const)('rejects a %s active provider artifact', async (mutation) => {
    const root = await createRoot()
    await seedGenerationArtifacts(root)
    await seedSemanticArtifacts(root)
    await mutateArtifact(root, getActiveProviderPath(root), mutation)

    await expectValidationFailure(root)
  })

  it.each([
    'metadata',
    'binary',
  ] as const)('rejects every invalid active vector %s artifact', async (artifact) => {
    for (const mutation of ['missing', 'corrupt', 'symlink'] as const) {
      const root = await createRoot()
      await seedGenerationArtifacts(root)
      await seedSemanticArtifacts(root)
      const namespace = generateNamespace(provider, model, dimensions)
      const artifactPath =
        artifact === 'metadata'
          ? getMetaPath(root, namespace)
          : getVectorPath(root, namespace)
      await mutateArtifact(root, artifactPath, mutation)

      await expectValidationFailure(root)
    }
  })
})
