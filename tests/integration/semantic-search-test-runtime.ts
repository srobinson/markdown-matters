import { Effect } from 'effect'

import { defaultConfig } from '../../src/config/schema.js'
import { testGenerationSession } from '../../src/db/generation-test-fixture.js'
import type { GenerationReadSession } from '../../src/db/generation-types.js'
import {
  type ResolvedQueryProviderConfig,
  resolveQueryProviderConfig,
} from '../../src/embeddings/query-provider-config.js'
import type {
  ResolvedSemanticSearchOptions,
  SemanticSearchOptions,
} from '../../src/embeddings/types.js'

export interface SemanticSearchTestRuntime {
  readonly session: GenerationReadSession
  readonly queryProvider: ResolvedQueryProviderConfig
}

export const loadSemanticSearchTestRuntime = (indexRoot: string) => {
  const session = testGenerationSession(indexRoot)
  return Effect.map(
    resolveQueryProviderConfig(session, defaultConfig.embeddings),
    (queryProvider) => ({ session, queryProvider }),
  )
}

export const resolveSemanticSearchTestOptions = (
  runtime: SemanticSearchTestRuntime,
  options: SemanticSearchOptions,
): ResolvedSemanticSearchOptions => ({
  ...options,
  providerConfig: runtime.queryProvider.providerConfig,
  activeProvider: runtime.queryProvider.activeProvider,
})
