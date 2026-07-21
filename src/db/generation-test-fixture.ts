import * as path from 'node:path'
import { Effect } from 'effect'
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
import { createBM25Store } from '../search/bm25-store.js'
import type { DocumentKey } from './canonical.js'
import type {
  GenerationName,
  GenerationReadSession,
} from './generation-types.js'

export const testGenerationSession = (
  indexRoot: string,
): GenerationReadSession => ({
  home: path.dirname(indexRoot),
  generation: path.basename(indexRoot) as GenerationName,
  indexRoot,
  leaseId: 'test-lease',
})

export const seedGenerationArtifacts = async (root: string): Promise<void> => {
  const documentPath = path.join(root, 'document.md') as DocumentKey
  const storage = createStorage(root, root)
  await Effect.runPromise(initializeIndex(storage))
  await Effect.runPromise(
    saveDocumentIndex(storage, {
      ...createEmptyDocumentIndex(),
      documents: {
        [documentPath]: {
          id: 'document-1',
          path: documentPath,
          paths: [documentPath],
          declaredPaths: [],
          identity: { device: '1', inode: '1' },
          comparisonKey: documentPath,
          title: 'old',
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
          documentPath,
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
        [documentPath]: [path.join(root, 'target.md') as DocumentKey],
      },
    }),
  )

  const bm25 = createBM25Store(root)
  await Effect.runPromise(
    bm25.add([
      {
        id: 'section-1',
        sectionId: 'section-1',
        documentPath,
        heading: 'Document',
        content: 'complete generation artifact',
      },
    ]),
  )
  await Effect.runPromise(bm25.consolidate())
  await Effect.runPromise(bm25.save())
}
