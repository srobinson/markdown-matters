import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect, Option } from 'effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { defaultConfig } from '../config/schema.js'
import type { DocumentKey } from '../db/canonical.js'
import { testGenerationSession } from '../db/generation-test-fixture.js'
import { buildBM25Index } from '../index/bm25-build.js'
import { buildIndex } from '../index/indexer.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'
import {
  type EmbeddingClient,
  EmbeddingError as ProviderEmbeddingError,
  type ProviderId,
} from '../providers/index.js'
import { clearRegistry, registerProvider } from '../providers/registry.js'
import { hybridSearch } from '../search/hybrid-search.js'
import { writeActiveProvider } from './embedding-namespace.js'
import {
  generateNamespace,
  getActiveProviderPath,
} from './embedding-namespace-paths.js'
import { resolveQueryProviderConfig } from './query-provider-config.js'
import { createNamespacedVectorStore } from './vector-store.js'

vi.mock('../providers/transports/openai-compatible.js', async () => {
  const actual = await vi.importActual<
    typeof import('../providers/transports/openai-compatible.js')
  >('../providers/transports/openai-compatible.js')
  return { ...actual, createEmbedClient: vi.fn() }
})

const { createEmbedClient } = await import(
  '../providers/transports/openai-compatible.js'
)
const createEmbedClientMock = vi.mocked(createEmbedClient)
const cleanup: string[] = []

const createFixture = async (provider: ProviderId = 'openai') => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-query-config-'))
  cleanup.push(parent)
  const sourceRoot = path.join(parent, 'source')
  const indexRoot = path.join(parent, 'index')
  await Promise.all([
    fs.mkdir(sourceRoot, { recursive: true }),
    fs.mkdir(indexRoot, { recursive: true }),
  ])
  await fs.writeFile(
    path.join(sourceRoot, 'guide.md'),
    '# Guide\n\nprivate provider query configuration has sufficient searchable words for the keyword index and resilient hybrid fallback behavior',
  )
  await Effect.runPromise(buildIndex(sourceRoot, { indexRoot }))
  await Effect.runPromise(buildBM25Index(indexRoot, { force: true }))
  const storage = createStorage(sourceRoot, indexRoot)
  const [documents, sections] = await Promise.all([
    Effect.runPromise(loadDocumentIndex(storage)),
    Effect.runPromise(loadSectionIndex(storage)),
  ])
  const section = Object.values(sections?.sections ?? {})[0]
  if (!section || !documents) throw new Error('Expected indexed fixture')
  const documentHash = documents.documents[section.documentPath]?.hash
  if (!documentHash) throw new Error('Expected indexed document hash')

  const baseURL = 'http://private-embeddings.example/v1'
  const model = 'private-model'
  const dimensions = 2
  const store = createNamespacedVectorStore(
    indexRoot,
    provider,
    model,
    dimensions,
    undefined,
    baseURL,
  )
  await Effect.runPromise(
    store.add([
      {
        id: section.id,
        sectionId: section.id,
        documentPath: section.documentPath as DocumentKey,
        documentHash,
        heading: section.heading,
        embedding: [1, 0],
      },
    ]),
  )
  await Effect.runPromise(store.save())
  await Effect.runPromise(
    writeActiveProvider(indexRoot, {
      namespace: generateNamespace(provider, model, dimensions),
      provider,
      model,
      dimensions,
      activatedAt: new Date().toISOString(),
    }),
  )
  return {
    sourceRoot,
    session: testGenerationSession(indexRoot),
    baseURL,
    model,
    dimensions,
  }
}

beforeEach(() => {
  clearRegistry()
  createEmbedClientMock.mockReset()
})

afterEach(async () => {
  clearRegistry()
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

it('uses persisted query metadata and config endpoint precedence', async () => {
  const fixture = await createFixture()
  const persisted = await Effect.runPromise(
    resolveQueryProviderConfig(fixture.session, defaultConfig.embeddings),
  )
  expect(persisted).toEqual({
    providerConfig: {
      provider: 'openai',
      baseURL: fixture.baseURL,
      model: fixture.model,
      dimensions: fixture.dimensions,
    },
    activeProvider: expect.objectContaining({
      provider: 'openai',
      model: fixture.model,
      dimensions: fixture.dimensions,
    }),
    vectorCount: 1,
  })

  const configured = await Effect.runPromise(
    resolveQueryProviderConfig(fixture.session, {
      ...defaultConfig.embeddings,
      baseURL: Option.some('http://config-override.example/v1'),
    }),
  )
  expect(configured.providerConfig.baseURL).toBe(
    'http://config-override.example/v1',
  )
})

it('routes a hybrid provider override through the complete query config', async () => {
  const fixture = await createFixture('ollama')
  const publicOpenAIEmbed = vi.fn(() =>
    Effect.die(new Error('Public OpenAI runtime must not be used')),
  )
  registerProvider({
    id: 'openai',
    capabilities: { embed: { embed: publicOpenAIEmbed } },
  })
  const privateClient: EmbeddingClient = {
    embed: (_texts, options) =>
      Effect.succeed({
        embeddings: [[1, 0]],
        model: options?.model ?? 'missing-model',
      }),
  }
  createEmbedClientMock.mockReturnValue(Effect.succeed(privateClient))
  const result = await Effect.runPromise(
    hybridSearch(fixture.session, fixture.sourceRoot, 'private provider', {
      mode: 'hybrid',
      queryProvider: {
        config: defaultConfig.embeddings,
        providerOverride: 'ollama',
      },
    }),
  )

  expect(createEmbedClientMock).toHaveBeenCalledWith('ollama', {
    baseURL: fixture.baseURL,
  })
  expect(publicOpenAIEmbed).not.toHaveBeenCalled()
  expect(result.stats.semanticDegradation).toBeUndefined()
  expect(result.stats.semanticResults).toBe(1)
})

it('reports query embedding failure without hiding stored vectors', async () => {
  const fixture = await createFixture()
  createEmbedClientMock.mockReturnValue(
    Effect.succeed({
      embed: () =>
        Effect.fail(
          new ProviderEmbeddingError({
            provider: 'openai',
            message: 'private provider unavailable',
          }),
        ),
    }),
  )
  const result = await Effect.runPromise(
    hybridSearch(fixture.session, fixture.sourceRoot, 'private provider', {
      mode: 'hybrid',
      queryProvider: { config: defaultConfig.embeddings },
    }),
  )

  expect(result.stats.embeddingsAvailable).toBe(true)
  expect(result.stats.semanticDegradation).toMatchObject({
    reason: 'EmbeddingError',
    message: 'private provider unavailable',
  })
})

it('rejects a provider override that does not match the active index', async () => {
  const fixture = await createFixture('openai')

  const result = await Effect.runPromise(
    Effect.either(
      resolveQueryProviderConfig(
        fixture.session,
        defaultConfig.embeddings,
        'ollama',
      ),
    ),
  )

  expect(result._tag).toBe('Left')
  if (result._tag === 'Left') {
    expect(result.left).toMatchObject({
      _tag: 'EmbeddingNamespaceError',
      operation: 'resolveQueryProviderConfig',
    })
    expect(result.left.message).toContain(
      'does not match the active index provider openai',
    )
  }
})

it('degrades corrupt provider metadata while retaining keyword results', async () => {
  const fixture = await createFixture()
  await fs.writeFile(
    getActiveProviderPath(fixture.session.indexRoot),
    '{corrupt-json',
  )

  const result = await Effect.runPromise(
    hybridSearch(fixture.session, fixture.sourceRoot, 'private provider', {
      mode: 'hybrid',
      queryProvider: { config: defaultConfig.embeddings },
    }),
  )

  expect(
    result.results.some((entry) => entry.sources.includes('keyword')),
  ).toBe(true)
  expect(result.stats.keywordResults).toBeGreaterThan(0)
  expect(result.stats.embeddingsAvailable).toBe(true)
  expect(result.stats.semanticDegradation).toMatchObject({
    reason: 'EmbeddingNamespaceError',
  })
  expect(result.stats.semanticDegradation?.message).toContain(
    'Failed to parse active provider',
  )
})
