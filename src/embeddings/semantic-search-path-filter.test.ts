import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { expect, it } from 'vitest'
import type { DocumentKey } from '../db/canonical.js'
import { testGenerationSession } from '../db/generation-test-fixture.js'
import {
  createEmptyDocumentIndex,
  createStorage,
  initializeIndex,
  saveDocumentIndex,
} from '../index/storage.js'
import { postProcessResults } from './semantic-search-pipeline.js'
import type { VectorSearchResult } from './vector-store.js'

it('filters semantic results with a source relative path pattern', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-semantic-path-'))
  const sourceRoot = path.join(parent, 'source')
  const indexRoot = path.join(parent, 'index')

  try {
    await fs.mkdir(sourceRoot)
    const storage = createStorage(sourceRoot, indexRoot)
    await Effect.runPromise(initializeIndex(storage))
    await Effect.runPromise(
      saveDocumentIndex(storage, createEmptyDocumentIndex()),
    )
    const canonicalRoot = await fs.realpath(sourceRoot)
    const nested = path.resolve(
      canonicalRoot,
      'docs',
      'guide.md',
    ) as DocumentKey
    const topLevel = path.resolve(canonicalRoot, 'README.md') as DocumentKey
    const rawResults: VectorSearchResult[] = [nested, topLevel].map(
      (documentPath, index) => ({
        id: `path-filter-${index}`,
        sectionId: `section-${index}`,
        documentPath,
        heading: `Heading ${index}`,
        similarity: 0.9 - index * 0.1,
      }),
    )

    const result = await Effect.runPromise(
      postProcessResults(
        testGenerationSession(indexRoot),
        sourceRoot,
        rawResults,
        'guide',
        { pathPattern: 'docs/*.md', headingBoost: false },
        10,
      ),
    )

    expect(result.results.map(({ documentPath }) => documentPath)).toEqual([
      nested,
    ])
    expect(result.totalAvailable).toBe(1)
  } finally {
    await fs.rm(parent, { recursive: true, force: true })
  }
})
