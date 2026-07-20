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
import {
  createEmptyDocumentIndex,
  createEmptyLinkIndex,
  createEmptySectionIndex,
  createStorage,
  initializeIndex,
  saveDocumentIndex,
  saveLinkIndex,
  saveSectionIndex,
} from '../index/storage.js'
import { getIndexPaths } from '../index/types.js'
import { createBM25Store } from '../search/bm25-store.js'
import type { DocumentKey } from './canonical.js'
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

const seedStructuralArtifacts = async (root: string): Promise<void> => {
  const storage = createStorage(root, root)
  await Effect.runPromise(initializeIndex(storage))
  await Effect.runPromise(
    saveDocumentIndex(storage, {
      ...createEmptyDocumentIndex(),
      documents: {
        [path.join(root, 'document.md') as DocumentKey]: {
          id: 'document-1',
          path: path.join(root, 'document.md') as DocumentKey,
          paths: [path.join(root, 'document.md') as DocumentKey],
          declaredPaths: [],
          identity: { device: '1', inode: '1' },
          comparisonKey: path.join(root, 'document.md'),
          title: 'Document',
          mtime: 1,
          hash: 'hash-1',
          tokenCount: 1,
          sectionCount: 1,
        },
      },
    }),
  )
  await Effect.runPromise(
    saveSectionIndex(storage, {
      ...createEmptySectionIndex(),
      sections: {
        'section-1': {
          id: 'section-1',
          documentId: 'document-1',
          documentPath: path.join(root, 'document.md') as DocumentKey,
          heading: 'Document',
          level: 1,
          startLine: 1,
          endLine: 1,
          tokenCount: 1,
          hasCode: false,
          hasList: false,
          hasTable: false,
        },
      },
    }),
  )
  await Effect.runPromise(
    saveLinkIndex(storage, {
      ...createEmptyLinkIndex(),
      forward: {
        [path.join(root, 'document.md') as DocumentKey]: [
          path.join(root, 'target.md') as DocumentKey,
        ],
      },
    }),
  )

  const bm25 = createBM25Store(root)
  await Effect.runPromise(
    bm25.add([
      {
        id: 'section-1',
        sectionId: 'section-1',
        documentPath: path.join(root, 'document.md') as DocumentKey,
        heading: 'Document',
        content: 'complete generation artifact',
      },
    ]),
  )
  await Effect.runPromise(bm25.consolidate())
  await Effect.runPromise(bm25.save())
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
    await seedStructuralArtifacts(root)

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
    await seedStructuralArtifacts(root)
    await seedSemanticArtifacts(root)

    await expect(
      Effect.runPromise(validateGeneration(root)),
    ).resolves.toMatchObject({
      activeNamespace: generateNamespace(provider, model, dimensions),
      vectors: 12,
    })
  })

  it('allows complete inactive Plan 3 namespaces beside the active namespace', async () => {
    const root = await createRoot()
    await seedStructuralArtifacts(root)
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
      await seedStructuralArtifacts(root)
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
      await seedStructuralArtifacts(root)
      await mutateArtifact(root, getIndexPaths(root)[artifact], mutation)
      await expectValidationFailure(root)
    }
  })

  it('rejects semantic artifacts without an active provider', async () => {
    const root = await createRoot()
    await seedStructuralArtifacts(root)
    await seedSemanticArtifacts(root)
    await fs.unlink(getActiveProviderPath(root))

    await expectValidationFailure(root)
  })

  it.each([
    'corrupt',
    'symlink',
  ] as const)('rejects a %s active provider artifact', async (mutation) => {
    const root = await createRoot()
    await seedStructuralArtifacts(root)
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
      await seedStructuralArtifacts(root)
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
