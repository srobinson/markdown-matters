import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { expect, it, vi } from 'vitest'
import { getActiveProviderPath } from './embedding-namespace.js'
import { persistEmbeddingBuild } from './semantic-search-persistence.js'
import type { VectorStore } from './vector-store.js'

it('propagates an active provider write failure after saving vectors', async () => {
  const indexRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'mdm-embedding-persist-'),
  )
  const save = vi.fn(() => Effect.void)
  const vectorStore = { save } as unknown as VectorStore

  try {
    await fs.mkdir(getActiveProviderPath(indexRoot))
    const error = await Effect.runPromise(
      Effect.flip(
        persistEmbeddingBuild({
          indexRoot,
          vectorStore,
          namespace: 'openai_test-model_2',
          activeProvider: {
            namespace: 'openai_test-model_2',
            provider: 'openai',
            model: 'test-model',
            dimensions: 2,
            activatedAt: '2026-07-20T00:00:00.000Z',
          },
        }),
      ),
    )

    expect(error).toMatchObject({ _tag: 'EmbeddingNamespaceError' })
    expect(save).toHaveBeenCalledOnce()
    const buildSource = await fs.readFile(
      new URL('./semantic-search-build.ts', import.meta.url),
      'utf-8',
    )
    expect(buildSource).not.toContain('saveEmbeddingBuild')
  } finally {
    await fs.rm(indexRoot, { recursive: true, force: true })
  }
})
