import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { runIndexCommand } from '../cli/commands/index-run.js'
import { ConfigServiceDefault } from '../config/service.js'
import {
  generationLayout,
  parseGenerationName,
  readCurrentGeneration,
} from '../db/generation-paths.js'
import { validateGeneration } from '../db/generation-validation.js'
import {
  getMetaPath,
  readActiveProvider,
} from '../embeddings/embedding-namespace.js'
import { loadVectorIndex } from '../embeddings/vector-store-codec.js'
import { refreshManifestIndex } from '../index/manifest-refresh.js'
import { appendManifestDirectory } from '../manifest.js'
import {
  clearRegistry,
  type EmbeddingClient,
  registerProvider,
} from '../providers/index.js'
import { handleMdIndex } from './handlers.js'

const cleanup: string[] = []
const originalHome = process.env.MDM_HOME

const removeFixture = (target: string) =>
  fs.rm(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })

afterEach(async () => {
  clearRegistry()
  if (originalHome === undefined) delete process.env.MDM_HOME
  else process.env.MDM_HOME = originalHome
  await Promise.all(cleanup.splice(0).map(removeFixture))
})

const deterministicEmbedding = (text: string): readonly number[] => {
  const vector = Array.from({ length: 512 }, () => 0)
  const checksum = [...text].reduce(
    (sum, character) => sum + character.codePointAt(0)!,
    0,
  )
  vector[checksum % vector.length] = 1
  return vector
}

const createClient = () => {
  const embed = vi.fn<EmbeddingClient['embed']>((texts, options) =>
    Effect.succeed({
      embeddings: texts.map(deterministicEmbedding),
      model: options?.model ?? 'test-model',
      usage: { inputTokens: texts.length * 20 },
    }),
  )
  return { client: { embed } satisfies EmbeddingClient, embed }
}

const currentLayout = async (home: string) => {
  const current = await Effect.runPromise(readCurrentGeneration(home))
  if (current === null) throw new Error('Expected a published generation')
  return generationLayout(home, current)
}

const semanticArtifacts = async (home: string) => {
  const layout = await currentLayout(home)
  const active = await Effect.runPromise(readActiveProvider(layout.root))
  if (active === null) throw new Error('Expected an active provider')
  const vectors = await Effect.runPromise(
    loadVectorIndex(getMetaPath(layout.root, active.namespace)),
  )
  const { activatedAt: _activatedAt, ...stableActive } = active
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...stableVectors
  } = vectors
  return { active: stableActive, vectors: stableVectors }
}

it('publishes equivalent semantic generations through CLI and MCP', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-writers-'))
  cleanup.push(parent)
  const source = path.join(parent, 'source')
  const cliHome = path.join(parent, 'cli-home')
  const mcpHome = path.join(parent, 'mcp-home')
  await Promise.all(
    [source, cliHome, mcpHome].map((target) =>
      fs.mkdir(target, { recursive: true }),
    ),
  )
  const document = path.join(source, 'README.md')
  await fs.writeFile(
    document,
    '# Writer equivalence\n\nInitial semantic content has enough words to create one stable embedding section for both writers.',
  )
  await Promise.all(
    [cliHome, mcpHome].map((home) =>
      Effect.runPromise(appendManifestDirectory(home, { path: source })),
    ),
  )

  const { client, embed } = createClient()
  registerProvider({
    id: 'voyage',
    capabilities: { embed: client },
  })
  const seedSemantic = {
    mode: 'build' as const,
    options: {
      client,
      providerConfig: {
        provider: 'voyage' as const,
        model: 'test-model',
        dimensions: 512,
      },
    },
  }
  for (const home of [cliHome, mcpHome]) {
    await Effect.runPromise(
      refreshManifestIndex(home, undefined, { semantic: seedSemantic }),
    )
  }

  embed.mockClear()
  await fs.writeFile(
    document,
    '# Writer equivalence\n\nUpdated semantic content has enough words to require a replacement embedding from both writer entrypoints.',
  )

  process.env.MDM_HOME = cliHome
  await Effect.runPromise(
    runIndexCommand({
      path: undefined,
      exclude: undefined,
      noGitignore: false,
      watch: false,
      pretty: false,
      embed: false,
      noEmbed: false,
      force: false,
      json: true,
      provider: undefined,
      providerBaseUrl: undefined,
      providerModel: undefined,
      hnswM: undefined,
      hnswEfConstruction: undefined,
    }).pipe(Effect.provide(ConfigServiceDefault)),
  )

  process.env.MDM_HOME = mcpHome
  const mcpResult = await handleMdIndex({}, source)
  expect(mcpResult.isError).toBeFalsy()
  expect(embed).toHaveBeenCalledTimes(2)

  for (const home of [cliHome, mcpHome]) {
    expect(await Effect.runPromise(readCurrentGeneration(home))).toBe('gen-2')
    for (const rawGeneration of ['gen-1', 'gen-2']) {
      const generation = await Effect.runPromise(
        parseGenerationName(rawGeneration),
      )
      await expect(
        Effect.runPromise(
          validateGeneration(generationLayout(home, generation).root),
        ),
      ).resolves.toMatchObject({ documents: 1 })
    }
  }
  expect(await semanticArtifacts(cliHome)).toEqual(
    await semanticArtifacts(mcpHome),
  )
})
