import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect, Option } from 'effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { defaultConfig } from '../config/schema.js'
import type { DocumentKey } from '../db/canonical.js'
import { testGenerationSession } from '../db/generation-test-fixture.js'
import { buildIndex } from '../index/indexer.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'
import {
  type EmbeddingClient,
  EmbeddingError as ProviderEmbeddingError,
} from '../providers/index.js'
import { clearRegistry, registerProvider } from '../providers/registry.js'
import { hybridSearch } from '../search/hybrid-search.js'
import { writeActiveProvider } from './embedding-namespace.js'
import { generateNamespace } from './embedding-namespace-paths.js'
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

const createFixture = async () => {
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
    '# Guide\n\nprivate provider query configuration with sufficient searchable words',
  )
  await Effect.runPromise(buildIndex(sourceRoot, { indexRoot }))
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
    'openai',
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
      namespace: generateNamespace('openai', model, dimensions),
      provider: 'openai',
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
    provider: 'openai',
    baseURL: fixture.baseURL,
    model: fixture.model,
    dimensions: fixture.dimensions,
  })

  const configured = await Effect.runPromise(
    resolveQueryProviderConfig(fixture.session, {
      ...defaultConfig.embeddings,
      baseURL: Option.some('http://config-override.example/v1'),
    }),
  )
  expect(configured.baseURL).toBe('http://config-override.example/v1')
})

it('routes a hybrid provider override through the complete query config', async () => {
  const fixture = await createFixture()
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
  const providerConfig = await Effect.runPromise(
    resolveQueryProviderConfig(
      fixture.session,
      defaultConfig.embeddings,
      'ollama',
    ),
  )

  const result = await Effect.runPromise(
    hybridSearch(fixture.session, fixture.sourceRoot, 'private provider', {
      mode: 'hybrid',
      providerConfig,
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
  const providerConfig = await Effect.runPromise(
    resolveQueryProviderConfig(fixture.session, defaultConfig.embeddings),
  )

  const result = await Effect.runPromise(
    hybridSearch(fixture.session, fixture.sourceRoot, 'private provider', {
      mode: 'hybrid',
      providerConfig,
    }),
  )

  expect(result.stats.embeddingsAvailable).toBe(true)
  expect(result.stats.semanticDegradation).toMatchObject({
    reason: 'EmbeddingError',
    message: 'private provider unavailable',
  })
})
