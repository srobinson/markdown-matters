import { describe, expect, it } from 'vitest'

import { defaultConfig } from '../../config/schema.js'
import type { ProviderId } from '../../providers/index.js'
import {
  type EmbeddingRefreshInput,
  semanticRefreshOptions,
} from './index-embeddings.js'

const input = (
  overrides: Partial<EmbeddingRefreshInput> = {},
): EmbeddingRefreshInput => ({
  embed: true,
  noEmbed: false,
  forceEmbed: false,
  force: false,
  json: true,
  provider: undefined,
  providerBaseUrl: undefined,
  providerModel: undefined,
  hnswM: undefined,
  hnswEfConstruction: undefined,
  ...overrides,
})

describe('semanticRefreshOptions', () => {
  it('keeps structural force separate from semantic rebuilds', () => {
    const result = semanticRefreshOptions(
      input({ force: true }),
      false,
      defaultConfig.embeddings,
    )

    expect(result).toMatchObject({
      mode: 'build',
      options: { force: false },
    })
  })

  it('makes a full semantic rebuild explicit', () => {
    const result = semanticRefreshOptions(
      input({ embed: false, forceEmbed: true }),
      false,
      defaultConfig.embeddings,
    )

    expect(result).toMatchObject({
      mode: 'build',
      options: { force: true },
    })
  })

  it('passes configured batching policy and provider defaults', () => {
    const config = {
      ...defaultConfig.embeddings,
      provider: 'openrouter' as ProviderId,
      model: 'configured-model',
      batchSize: 40,
      concurrency: 3,
      maxRetries: 6,
      retryDelayMs: 250,
      timeoutMs: 45_000,
    }
    const result = semanticRefreshOptions(input(), false, config)

    expect(result).toMatchObject({
      mode: 'build',
      options: {
        providerConfig: {
          provider: 'openrouter',
          model: 'configured-model',
        },
        execution: {
          batchSize: 40,
          concurrency: 3,
          maxRetries: 6,
          retryDelayMs: 250,
          timeoutMs: 45_000,
        },
      },
    })
  })
})
