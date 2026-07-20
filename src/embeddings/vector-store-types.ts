import type { Effect } from 'effect'
import type { DocumentKey } from '../db/canonical.js'
import type {
  DimensionMismatchError,
  VectorStoreError,
} from '../errors/index.js'
import type { VectorEntry } from './types.js'

export interface VectorSearchOptions {
  /** efSearch parameter for HNSW. Controls the recall and speed tradeoff. */
  readonly efSearch?: number | undefined
}

export interface VectorStore {
  readonly rootPath: string
  readonly dimensions: number
  add(entries: VectorEntry[]): Effect.Effect<void, VectorStoreError>
  search(
    vector: number[],
    limit: number,
    threshold?: number,
    options?: VectorSearchOptions,
  ): Effect.Effect<VectorSearchResult[], VectorStoreError>
  searchWithStats(
    vector: number[],
    limit: number,
    threshold?: number,
    options?: VectorSearchOptions,
  ): Effect.Effect<VectorSearchResultWithStats, VectorStoreError>
  save(): Effect.Effect<void, VectorStoreError>
  load(): Effect.Effect<
    VectorStoreLoadResult,
    VectorStoreError | DimensionMismatchError
  >
  getStats(): VectorStoreStats
  getEmbeddedIds(): Set<string>
  getEmbeddedDocumentHashes(): ReadonlyMap<string, string>
  removeEntries(ids: string[]): Effect.Effect<void, VectorStoreError>
  setProvider(name: string, model?: string, baseURL?: string): void
  addCost(cost: number, tokens: number): void
  setNamespace(namespace: string): void
  getNamespace(): string | undefined
}

export interface VectorSearchResult {
  readonly id: string
  readonly sectionId: string
  readonly documentPath: DocumentKey
  readonly heading: string
  readonly similarity: number
}

export interface VectorSearchResultWithStats {
  readonly results: VectorSearchResult[]
  readonly belowThresholdCount: number
  readonly belowThresholdHighest: number | null
}

export interface VectorStoreStats {
  readonly count: number
  readonly dimensions: number
  readonly provider: string
  readonly providerModel?: string | undefined
  readonly totalCost: number
  readonly totalTokens: number
}

export interface VectorStoreLoadResult {
  readonly loaded: boolean
  readonly hnswMismatch?: HnswMismatchWarning | undefined
}

export interface HnswMismatchWarning {
  readonly configParams: { m: number; efConstruction: number }
  readonly indexParams: { m: number; efConstruction: number }
}

/** HNSW build parameters for index construction. */
export interface HnswBuildOptions {
  readonly m?: number | undefined
  readonly efConstruction?: number | undefined
}
