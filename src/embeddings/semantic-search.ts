/**
 * Semantic search functionality
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import {
  type ApiKeyInvalidError,
  type ApiKeyMissingError,
  type DimensionMismatchError,
  EmbeddingError,
  EmbeddingsNotFoundError,
  type FileReadError,
  type IndexCorruptedError,
  IndexNotFoundError,
  VectorStoreError,
} from '../errors/index.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'
import { INDEX_DIR, type SectionEntry } from '../index/types.js'
import { generateHypotheticalDocument, type HydeResult } from './hyde.js'
import {
  checkPricingFreshness,
  getPricingDate,
  PRICING_DATA,
  wrapEmbedding,
} from './openai-provider.js'
import {
  createEmbeddingProviderDirect,
  type ProviderFactoryConfig,
} from './provider-factory.js'
import {
  calculateFileImportanceBoost,
  calculateHeadingBoost,
  type EmbeddingProvider,
  hasProviderMetadata,
  preprocessQuery,
  QUALITY_EF_SEARCH,
  type SemanticSearchOptions,
  type SemanticSearchResult,
  type SemanticSearchResultWithStats,
  type VectorEntry,
  type VectorIndex,
} from './types.js'
import {
  createVectorStore,
  type HnswBuildOptions,
  type HnswMismatchWarning,
  type HnswVectorStore,
} from './vector-store.js'

// ============================================================================
// Provider Mismatch Warning
// ============================================================================

interface VectorStoreStats {
  readonly provider: string
  readonly providerModel?: string | undefined
}

/**
 * Check for HNSW parameter mismatch and log a warning if found.
 * This helps users understand when their config doesn't match the stored index.
 */
const checkHnswMismatch = (
  mismatch: HnswMismatchWarning | undefined,
): Effect.Effect<void, never, never> => {
  if (!mismatch) {
    return Effect.void
  }

  const { configParams, indexParams } = mismatch
  return Effect.logWarning(
    `HNSW parameter mismatch: Index was built with M=${indexParams.m}, efConstruction=${indexParams.efConstruction}, ` +
      `but config specifies M=${configParams.m}, efConstruction=${configParams.efConstruction}. ` +
      `HNSW parameters only affect index construction. Run 'mdcontext index --embed --force' to rebuild with new parameters.`,
  )
}

/**
 * Check for provider/model mismatch between index and query, returning a warning Effect if mismatch detected.
 * This consolidates the warning logic used in both semanticSearch and semanticSearchWithStats.
 */
const checkProviderMismatch = (
  stats: VectorStoreStats,
  currentProvider: string,
  currentProviderModel: string,
): Effect.Effect<void, never, never> => {
  // Check if index provider/model differs from query provider/model
  if (stats.providerModel && stats.providerModel !== currentProviderModel) {
    return Effect.logWarning(
      `Provider mismatch: Index was created with ${stats.provider}/${stats.providerModel}, ` +
        `but querying with ${currentProvider}/${currentProviderModel}. ` +
        `Results may be inconsistent. Consider re-indexing.`,
    )
  }

  // Legacy index without model info - extract from provider name if possible
  if (!stats.providerModel) {
    const indexProviderParts = stats.provider.split(':')
    if (
      indexProviderParts.length === 2 &&
      indexProviderParts[1] !== currentProviderModel
    ) {
      return Effect.logWarning(
        `Provider mismatch: Index was created with ${indexProviderParts[0]}/${indexProviderParts[1]}, ` +
          `but querying with ${currentProvider}/${currentProviderModel}. ` +
          `Results may be inconsistent. Consider re-indexing.`,
      )
    }
  }

  return Effect.void
}

// ============================================================================
// Embedding Text Generation
// ============================================================================

const generateEmbeddingText = (
  section: SectionEntry,
  content: string,
  documentTitle: string,
  parentHeading?: string | undefined,
): string => {
  const parts: string[] = []

  parts.push(`# ${section.heading}`)
  if (parentHeading) {
    parts.push(`Parent section: ${parentHeading}`)
  }
  parts.push(`Document: ${documentTitle}`)
  parts.push('')
  parts.push(content)

  return parts.join('\n')
}

// ============================================================================
// Cost Estimation
// ============================================================================

// Price per 1M tokens for text-embedding-3-small (from PRICING_DATA)
const EMBEDDING_PRICE_PER_MILLION =
  PRICING_DATA.prices['text-embedding-3-small'] ?? 0.02

// Re-export pricing utilities for CLI use
export { checkPricingFreshness, getPricingDate }

export interface DirectoryEstimate {
  readonly directory: string
  readonly fileCount: number
  readonly sectionCount: number
  readonly estimatedTokens: number
  readonly estimatedCost: number
}

export interface EmbeddingEstimate {
  readonly totalFiles: number
  readonly totalSections: number
  readonly totalTokens: number
  readonly totalCost: number
  readonly estimatedTimeSeconds: number
  readonly byDirectory: readonly DirectoryEstimate[]
}

/**
 * Estimate the cost of generating embeddings for a directory.
 *
 * @param rootPath - Root directory containing indexed markdown files
 * @param options - Optional exclude patterns
 * @returns Estimate with token counts and costs
 *
 * @throws IndexNotFoundError - Index doesn't exist at path
 * @throws FileReadError - Cannot read index files
 * @throws IndexCorruptedError - Index files are corrupted
 */
export const estimateEmbeddingCost = (
  rootPath: string,
  options: { excludePatterns?: readonly string[] | undefined } = {},
): Effect.Effect<
  EmbeddingEstimate,
  IndexNotFoundError | FileReadError | IndexCorruptedError
> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath)
    const storage = createStorage(resolvedRoot)

    const docIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)

    if (!docIndex || !sectionIndex) {
      return yield* Effect.fail(new IndexNotFoundError({ path: resolvedRoot }))
    }

    // Group by directory
    const byDir: Map<
      string,
      { files: Set<string>; sections: number; tokens: number }
    > = new Map()

    for (const section of Object.values(sectionIndex.sections)) {
      // Skip very short sections (< 10 tokens)
      if (section.tokenCount < 10) continue

      // Check exclude patterns
      if (options.excludePatterns?.length) {
        const excluded = options.excludePatterns.some((pattern) => {
          const regex = new RegExp(
            `^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
          )
          return regex.test(section.documentPath)
        })
        if (excluded) continue
      }

      const dir = path.dirname(section.documentPath) || '.'
      if (!byDir.has(dir)) {
        byDir.set(dir, { files: new Set(), sections: 0, tokens: 0 })
      }
      const entry = byDir.get(dir)!
      entry.files.add(section.documentPath)
      entry.sections++
      entry.tokens += section.tokenCount
    }

    const directoryEstimates: DirectoryEstimate[] = []
    let totalFiles = 0
    let totalSections = 0
    let totalTokens = 0

    for (const [dir, data] of byDir) {
      directoryEstimates.push({
        directory: dir,
        fileCount: data.files.size,
        sectionCount: data.sections,
        estimatedTokens: data.tokens,
        estimatedCost: (data.tokens / 1_000_000) * EMBEDDING_PRICE_PER_MILLION,
      })
      totalFiles += data.files.size
      totalSections += data.sections
      totalTokens += data.tokens
    }

    // Sort by directory name
    directoryEstimates.sort((a, b) => a.directory.localeCompare(b.directory))

    // Estimate time: ~1.5s per 100 sections (API batch processing)
    const estimatedTimeSeconds = Math.ceil(totalSections / 100) * 1.5

    return {
      totalFiles,
      totalSections,
      totalTokens,
      totalCost: (totalTokens / 1_000_000) * EMBEDDING_PRICE_PER_MILLION,
      estimatedTimeSeconds,
      byDirectory: directoryEstimates,
    }
  })

// ============================================================================
// Build Embeddings
// ============================================================================

export interface FileProgress {
  readonly fileIndex: number
  readonly totalFiles: number
  readonly filePath: string
  readonly sectionCount: number
}

export interface BuildEmbeddingsOptions {
  readonly force?: boolean | undefined
  readonly provider?: EmbeddingProvider | undefined
  readonly providerConfig?: ProviderFactoryConfig | undefined
  readonly excludePatterns?: readonly string[] | undefined
  readonly onFileProgress?: ((progress: FileProgress) => void) | undefined
  /** HNSW build parameters for vector index construction */
  readonly hnswOptions?: HnswBuildOptions | undefined
}

export interface BuildEmbeddingsResult {
  readonly sectionsEmbedded: number
  readonly tokensUsed: number
  readonly cost: number
  readonly duration: number
  readonly filesProcessed: number
  readonly cacheHit?: boolean | undefined
  readonly existingVectors?: number | undefined
  readonly estimatedSavings?: number | undefined
}

/**
 * Build embeddings for all indexed sections in a directory.
 *
 * @param rootPath - Root directory containing indexed markdown files
 * @param options - Build options (force rebuild, progress callbacks)
 * @returns Result with embedding counts, costs, and timing
 *
 * @throws IndexNotFoundError - Index doesn't exist at path
 * @throws FileReadError - Cannot read index or source files
 * @throws IndexCorruptedError - Index files are corrupted
 * @throws ApiKeyMissingError - API key not set (check provider config)
 * @throws ApiKeyInvalidError - API key rejected by provider
 * @throws EmbeddingError - Embedding API failure (rate limit, quota, network)
 * @throws VectorStoreError - Cannot save vector index
 * @throws DimensionMismatchError - Existing embeddings have different dimensions
 */
export const buildEmbeddings = (
  rootPath: string,
  options: BuildEmbeddingsOptions = {},
): Effect.Effect<
  BuildEmbeddingsResult,
  | IndexNotFoundError
  | FileReadError
  | IndexCorruptedError
  | ApiKeyMissingError
  | ApiKeyInvalidError
  | EmbeddingError
  | VectorStoreError
  | DimensionMismatchError
> =>
  Effect.gen(function* () {
    const startTime = Date.now()
    const resolvedRoot = path.resolve(rootPath)
    const storage = createStorage(resolvedRoot)

    // Load indexes
    const docIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)

    if (!docIndex || !sectionIndex) {
      return yield* Effect.fail(new IndexNotFoundError({ path: resolvedRoot }))
    }

    // Get or create provider - use factory for config-driven provider selection
    // Priority: explicit provider > providerConfig > default (openai)
    const providerConfig = options.providerConfig ?? { provider: 'openai' }
    const provider =
      options.provider ?? (yield* createEmbeddingProviderDirect(providerConfig))
    const dimensions = provider.dimensions

    // Create vector store with optional HNSW build parameters
    const vectorStore = createVectorStore(
      resolvedRoot,
      dimensions,
      options.hnswOptions,
    ) as HnswVectorStore
    // Use type guard to safely access extended provider metadata
    if (hasProviderMetadata(provider)) {
      vectorStore.setProvider(provider.name, provider.model, provider.baseURL)
    } else {
      vectorStore.setProvider(provider.name, undefined, undefined)
    }

    // Load existing if not forcing
    if (!options.force) {
      const loadResult = yield* vectorStore.load()
      if (loadResult.loaded) {
        const stats = vectorStore.getStats()
        // Skip if any embeddings exist
        if (stats.count > 0) {
          const duration = Date.now() - startTime
          // Estimate savings based on existing tokens
          const estimatedSavings =
            (stats.totalTokens / 1_000_000) * EMBEDDING_PRICE_PER_MILLION
          return {
            sectionsEmbedded: 0,
            tokensUsed: 0,
            cost: 0,
            duration,
            filesProcessed: 0,
            cacheHit: true,
            existingVectors: stats.count,
            estimatedSavings,
          }
        }
      }
    }

    // Helper to check if a path matches exclude patterns
    const isExcluded = (docPath: string): boolean => {
      if (!options.excludePatterns?.length) return false
      return options.excludePatterns.some((pattern) => {
        const regex = new RegExp(
          `^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
        )
        return regex.test(docPath)
      })
    }

    // Group sections by document for efficient file reading
    const sectionsByDoc: Map<
      string,
      { section: SectionEntry; parentHeading: string | undefined }[]
    > = new Map()

    for (const section of Object.values(sectionIndex.sections)) {
      const document = docIndex.documents[section.documentPath]
      if (!document) continue

      // Skip very short sections (< 10 tokens)
      if (section.tokenCount < 10) continue

      // Check exclude patterns
      if (isExcluded(section.documentPath)) continue

      // Find parent heading if any
      let parentHeading: string | undefined
      if (section.level > 1) {
        const docSections = sectionIndex.byDocument[document.id] ?? []
        for (const sibId of docSections) {
          const sib = sectionIndex.sections[sibId]
          if (
            sib &&
            sib.level === section.level - 1 &&
            sib.startLine < section.startLine
          ) {
            parentHeading = sib.heading
          }
        }
      }

      const docPath = section.documentPath
      if (!sectionsByDoc.has(docPath)) {
        sectionsByDoc.set(docPath, [])
      }
      sectionsByDoc.get(docPath)!.push({ section, parentHeading })
    }

    if (sectionsByDoc.size === 0) {
      const duration = Date.now() - startTime
      return {
        sectionsEmbedded: 0,
        tokensUsed: 0,
        cost: 0,
        duration,
        filesProcessed: 0,
      }
    }

    // Prepare sections for embedding by reading file content
    const sectionsToEmbed: { section: SectionEntry; text: string }[] = []
    const docPaths = Array.from(sectionsByDoc.keys())
    let filesProcessed = 0

    for (let fileIndex = 0; fileIndex < docPaths.length; fileIndex++) {
      const docPath = docPaths[fileIndex]!
      const sections = sectionsByDoc.get(docPath)!
      const document = docIndex.documents[docPath]
      if (!document) continue

      // Report file progress
      if (options.onFileProgress) {
        options.onFileProgress({
          fileIndex: fileIndex + 1,
          totalFiles: docPaths.length,
          filePath: docPath,
          sectionCount: sections.length,
        })
      }

      const filePath = path.join(resolvedRoot, docPath)

      // Note: catchAll is intentional - file read failures during embedding
      // should skip the file with a warning rather than abort the entire operation.
      // A warning is logged below when the read fails.
      const fileContentResult = yield* Effect.promise(() =>
        fs.readFile(filePath, 'utf-8'),
      ).pipe(
        Effect.map((content) => ({ ok: true as const, content })),
        Effect.catchAll(() =>
          Effect.succeed({ ok: false as const, content: '' }),
        ),
      )

      if (!fileContentResult.ok) {
        yield* Effect.logWarning(`Skipping file (cannot read): ${docPath}`)
        continue
      }

      filesProcessed++
      const lines = fileContentResult.content.split('\n')

      for (const { section, parentHeading } of sections) {
        // Extract section content from file
        const content = lines
          .slice(section.startLine - 1, section.endLine)
          .join('\n')

        const text = generateEmbeddingText(
          section,
          content,
          document.title,
          parentHeading,
        )
        sectionsToEmbed.push({ section, text })
      }
    }

    if (sectionsToEmbed.length === 0) {
      const duration = Date.now() - startTime
      return {
        sectionsEmbedded: 0,
        tokensUsed: 0,
        cost: 0,
        duration,
        filesProcessed,
      }
    }

    // Generate embeddings
    const texts = sectionsToEmbed.map((s) => s.text)
    const result = yield* wrapEmbedding(
      provider.embed(texts),
      providerConfig.provider ?? 'openai',
    )

    // Create vector entries
    const entries: VectorEntry[] = []
    for (let i = 0; i < sectionsToEmbed.length; i++) {
      const { section } = sectionsToEmbed[i] ?? { section: null }
      const embedding = result.embeddings[i]
      if (!section || !embedding) continue

      entries.push({
        id: section.id,
        sectionId: section.id,
        documentPath: section.documentPath,
        heading: section.heading,
        embedding,
      })
    }

    // Add to vector store
    yield* vectorStore.add(entries)
    vectorStore.addCost(result.cost, result.tokensUsed)

    // Save
    yield* vectorStore.save()

    const duration = Date.now() - startTime

    return {
      sectionsEmbedded: entries.length,
      tokensUsed: result.tokensUsed,
      cost: result.cost,
      duration,
      filesProcessed,
    }
  })

// ============================================================================
// Semantic Search
// ============================================================================

/**
 * Perform semantic search over embedded sections.
 *
 * @param rootPath - Root directory containing embeddings
 * @param query - Natural language search query
 * @param options - Search options (limit, threshold, path filter)
 * @returns Ranked list of matching sections by similarity
 *
 * @throws EmbeddingsNotFoundError - No embeddings exist (run index --embed first)
 * @throws ApiKeyMissingError - API key not set (check provider config)
 * @throws ApiKeyInvalidError - API key rejected by provider
 * @throws EmbeddingError - Embedding API failure (rate limit, quota, network)
 * @throws VectorStoreError - Cannot load or search vector index
 * @throws DimensionMismatchError - Corpus has different dimensions than current provider
 */
export const semanticSearch = (
  rootPath: string,
  query: string,
  options: SemanticSearchOptions = {},
): Effect.Effect<
  readonly SemanticSearchResult[],
  | EmbeddingsNotFoundError
  | ApiKeyMissingError
  | ApiKeyInvalidError
  | EmbeddingError
  | VectorStoreError
  | DimensionMismatchError
> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath)

    // Get provider for query embedding - use factory for config-driven selection
    const provider = yield* createEmbeddingProviderDirect(
      options.providerConfig ?? { provider: 'openai' },
    )
    const dimensions = provider.dimensions

    // Load vector store
    const vectorStore = createVectorStore(resolvedRoot, dimensions)
    const loadResult = yield* vectorStore.load()

    if (!loadResult.loaded) {
      return yield* Effect.fail(
        new EmbeddingsNotFoundError({ path: resolvedRoot }),
      )
    }

    // Check for provider mismatch
    const stats = vectorStore.getStats()
    const currentProviderModel =
      options.providerConfig?.model ?? 'text-embedding-3-small'
    const currentProvider = options.providerConfig?.provider ?? 'openai'
    yield* checkProviderMismatch(stats, currentProvider, currentProviderModel)

    // Check for HNSW parameter mismatch
    yield* checkHnswMismatch(loadResult.hnswMismatch)

    // Determine the text to embed
    // If HyDE is enabled, generate a hypothetical document first
    let textToEmbed: string
    let hydeResult: HydeResult | undefined

    if (options.hyde) {
      // Generate hypothetical document using LLM
      hydeResult = yield* generateHypotheticalDocument(query, {
        model: options.hydeOptions?.model,
        maxTokens: options.hydeOptions?.maxTokens,
        temperature: options.hydeOptions?.temperature,
      })
      textToEmbed = hydeResult.hypotheticalDocument
      yield* Effect.logDebug(
        `HyDE generated ${hydeResult.tokensUsed} tokens ($${hydeResult.cost.toFixed(6)})`,
      )
    } else {
      // Preprocess query for better recall (unless disabled)
      textToEmbed = options.skipPreprocessing ? query : preprocessQuery(query)
    }

    // Embed the query (or hypothetical document)
    const queryResult = yield* wrapEmbedding(
      provider.embed([textToEmbed]),
      currentProvider,
    )

    const queryVector = queryResult.embeddings[0]
    if (!queryVector) {
      return yield* Effect.fail(
        new EmbeddingError({
          reason: 'Unknown',
          message: 'Failed to generate query embedding',
          provider: currentProvider,
        }),
      )
    }

    // Search
    const limit = options.limit ?? 10
    const threshold = options.threshold ?? 0

    // Convert quality mode to efSearch value
    const efSearch = options.quality
      ? QUALITY_EF_SEARCH[options.quality]
      : undefined

    const searchResults = yield* vectorStore.search(
      queryVector,
      limit * 2,
      threshold,
      { efSearch },
    )

    // Apply path filter if specified
    let filteredResults = searchResults
    if (options.pathPattern) {
      const pattern = options.pathPattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
      const regex = new RegExp(`^${pattern}$`, 'i')
      filteredResults = searchResults.filter((r) => regex.test(r.documentPath))
    }

    // Apply ranking boost (heading + file importance, enabled by default)
    const applyBoost = options.headingBoost !== false
    const boostedResults = applyBoost
      ? filteredResults.map((r) => ({
          ...r,
          similarity: Math.min(
            1,
            r.similarity +
              calculateHeadingBoost(r.heading, query) +
              calculateFileImportanceBoost(r.documentPath),
          ),
        }))
      : filteredResults

    // Re-sort by boosted similarity and convert to SemanticSearchResult
    const results: SemanticSearchResult[] = boostedResults
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map((r) => ({
        sectionId: r.sectionId,
        documentPath: r.documentPath,
        heading: r.heading,
        similarity: r.similarity,
      }))

    return results
  })

/**
 * Perform semantic search with stats about below-threshold results.
 * Use this when you want to provide feedback to users about results that
 * didn't meet the threshold.
 *
 * @param rootPath - Root directory containing embeddings
 * @param query - Natural language search query
 * @param options - Search options (limit, threshold, path filter)
 * @returns Results with optional below-threshold stats
 *
 * @throws EmbeddingsNotFoundError - No embeddings exist (run index --embed first)
 * @throws ApiKeyMissingError - API key not set (check provider config)
 * @throws ApiKeyInvalidError - API key rejected by provider
 * @throws EmbeddingError - Embedding API failure (rate limit, quota, network)
 * @throws VectorStoreError - Cannot load or search vector index
 * @throws DimensionMismatchError - Corpus has different dimensions than current provider
 */
export const semanticSearchWithStats = (
  rootPath: string,
  query: string,
  options: SemanticSearchOptions = {},
): Effect.Effect<
  SemanticSearchResultWithStats,
  | EmbeddingsNotFoundError
  | ApiKeyMissingError
  | ApiKeyInvalidError
  | EmbeddingError
  | VectorStoreError
  | DimensionMismatchError
> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath)

    // Get provider for query embedding - use factory for config-driven selection
    const provider = yield* createEmbeddingProviderDirect(
      options.providerConfig ?? { provider: 'openai' },
    )
    const dimensions = provider.dimensions

    // Load vector store
    const vectorStore = createVectorStore(resolvedRoot, dimensions)
    const loadResult = yield* vectorStore.load()

    if (!loadResult.loaded) {
      return yield* Effect.fail(
        new EmbeddingsNotFoundError({ path: resolvedRoot }),
      )
    }

    // Check for provider mismatch
    const stats = vectorStore.getStats()
    const currentProviderModel =
      options.providerConfig?.model ?? 'text-embedding-3-small'
    const currentProvider = options.providerConfig?.provider ?? 'openai'
    yield* checkProviderMismatch(stats, currentProvider, currentProviderModel)

    // Check for HNSW parameter mismatch
    yield* checkHnswMismatch(loadResult.hnswMismatch)

    // Determine the text to embed
    // If HyDE is enabled, generate a hypothetical document first
    let textToEmbed: string
    let hydeResult: HydeResult | undefined

    if (options.hyde) {
      // Generate hypothetical document using LLM
      hydeResult = yield* generateHypotheticalDocument(query, {
        model: options.hydeOptions?.model,
        maxTokens: options.hydeOptions?.maxTokens,
        temperature: options.hydeOptions?.temperature,
      })
      textToEmbed = hydeResult.hypotheticalDocument
      yield* Effect.logDebug(
        `HyDE generated ${hydeResult.tokensUsed} tokens ($${hydeResult.cost.toFixed(6)})`,
      )
    } else {
      // Preprocess query for better recall (unless disabled)
      textToEmbed = options.skipPreprocessing ? query : preprocessQuery(query)
    }

    // Embed the query (or hypothetical document)
    const queryResult = yield* wrapEmbedding(
      provider.embed([textToEmbed]),
      currentProvider,
    )

    const queryVector = queryResult.embeddings[0]
    if (!queryVector) {
      return yield* Effect.fail(
        new EmbeddingError({
          reason: 'Unknown',
          message: 'Failed to generate query embedding',
          provider: currentProvider,
        }),
      )
    }

    // Search with stats
    const limit = options.limit ?? 10
    const threshold = options.threshold ?? 0

    // Convert quality mode to efSearch value
    const efSearch = options.quality
      ? QUALITY_EF_SEARCH[options.quality]
      : undefined

    const searchResultWithStats = yield* vectorStore.searchWithStats(
      queryVector,
      limit * 2,
      threshold,
      { efSearch },
    )

    // Apply path filter if specified
    let filteredResults = searchResultWithStats.results
    if (options.pathPattern) {
      const pattern = options.pathPattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
      const regex = new RegExp(`^${pattern}$`, 'i')
      filteredResults = searchResultWithStats.results.filter((r) =>
        regex.test(r.documentPath),
      )
    }

    // Apply ranking boost (heading + file importance, enabled by default)
    const applyBoost = options.headingBoost !== false
    const boostedResults = applyBoost
      ? filteredResults.map((r) => ({
          ...r,
          similarity: Math.min(
            1,
            r.similarity +
              calculateHeadingBoost(r.heading, query) +
              calculateFileImportanceBoost(r.documentPath),
          ),
        }))
      : filteredResults

    // Re-sort by boosted similarity and convert to SemanticSearchResult
    const sortedResults = boostedResults.sort(
      (a, b) => b.similarity - a.similarity,
    )
    const totalAvailable = sortedResults.length
    const results: SemanticSearchResult[] = sortedResults
      .slice(0, limit)
      .map((r) => ({
        sectionId: r.sectionId,
        documentPath: r.documentPath,
        heading: r.heading,
        similarity: r.similarity,
      }))

    return {
      results,
      belowThresholdCount: searchResultWithStats.belowThresholdCount,
      belowThresholdHighest:
        searchResultWithStats.belowThresholdHighest ?? undefined,
      totalAvailable,
    }
  })

// ============================================================================
// Search with Content
// ============================================================================

/**
 * Perform semantic search and include section content in results.
 *
 * @param rootPath - Root directory containing embeddings
 * @param query - Natural language search query
 * @param options - Search options (limit, threshold, path filter)
 * @returns Ranked list of matching sections with content
 *
 * @throws EmbeddingsNotFoundError - No embeddings exist (run index --embed first)
 * @throws FileReadError - Cannot read index files
 * @throws IndexCorruptedError - Index files are corrupted
 * @throws ApiKeyMissingError - API key not set (check provider config)
 * @throws ApiKeyInvalidError - API key rejected by provider
 * @throws EmbeddingError - Embedding API failure (rate limit, quota, network)
 * @throws VectorStoreError - Cannot load or search vector index
 * @throws DimensionMismatchError - Corpus has different dimensions than current provider
 */
export const semanticSearchWithContent = (
  rootPath: string,
  query: string,
  options: SemanticSearchOptions = {},
): Effect.Effect<
  readonly SemanticSearchResult[],
  | EmbeddingsNotFoundError
  | FileReadError
  | IndexCorruptedError
  | ApiKeyMissingError
  | ApiKeyInvalidError
  | EmbeddingError
  | VectorStoreError
  | DimensionMismatchError
> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath)
    const results = yield* semanticSearch(resolvedRoot, query, options)

    const storage = createStorage(resolvedRoot)
    const sectionIndex = yield* loadSectionIndex(storage)

    if (!sectionIndex) {
      return results
    }

    const resultsWithContent: SemanticSearchResult[] = []

    for (const result of results) {
      const section = sectionIndex.sections[result.sectionId]
      if (!section) {
        resultsWithContent.push(result)
        continue
      }

      const filePath = path.join(resolvedRoot, result.documentPath)

      // Note: catchAll is intentional - file read failures during search result
      // enrichment should skip content loading with a warning, not fail the search.
      // Results are still returned without content when files can't be read.
      const fileContentResult = yield* Effect.promise(() =>
        fs.readFile(filePath, 'utf-8'),
      ).pipe(
        Effect.map((content) => ({ ok: true as const, content })),
        Effect.catchAll(() =>
          Effect.succeed({ ok: false as const, content: '' }),
        ),
      )

      if (!fileContentResult.ok) {
        yield* Effect.logWarning(
          `Skipping content load (cannot read): ${result.documentPath}`,
        )
        resultsWithContent.push(result)
        continue
      }

      const lines = fileContentResult.content.split('\n')
      const content = lines
        .slice(section.startLine - 1, section.endLine)
        .join('\n')

      resultsWithContent.push({
        ...result,
        content,
      })
    }

    return resultsWithContent
  })

// ============================================================================
// Get Embedding Stats
// ============================================================================

export interface EmbeddingStats {
  readonly hasEmbeddings: boolean
  readonly count: number
  readonly provider: string
  readonly dimensions: number
  readonly totalCost: number
  readonly totalTokens: number
}

/**
 * Get statistics about stored embeddings.
 *
 * @param rootPath - Root directory containing embeddings
 * @returns Embedding statistics (count, provider, costs)
 *
 * @throws VectorStoreError - Cannot load vector index metadata
 */
export const getEmbeddingStats = (
  rootPath: string,
): Effect.Effect<EmbeddingStats, VectorStoreError> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath)
    const metaPath = path.join(resolvedRoot, INDEX_DIR, 'vectors.meta.json')

    // Read metadata directly without loading vectors (avoids dimension mismatch errors)
    // Use catchAll to handle file-not-found gracefully (no embeddings = not an error)
    const metaContent = yield* Effect.tryPromise({
      try: () => fs.readFile(metaPath, 'utf-8'),
      catch: (e) =>
        new VectorStoreError({
          operation: 'load',
          message: `Failed to read metadata: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(null as string | null)))

    if (!metaContent) {
      return {
        hasEmbeddings: false,
        count: 0,
        provider: 'none',
        dimensions: 0,
        totalCost: 0,
        totalTokens: 0,
      }
    }

    const meta = yield* Effect.try({
      try: () => JSON.parse(metaContent) as VectorIndex,
      catch: (e) =>
        new VectorStoreError({
          operation: 'load',
          message: `Failed to parse metadata: ${e instanceof Error ? e.message : String(e)}`,
          cause: e,
        }),
    })

    return {
      hasEmbeddings: true,
      count: Object.keys(meta.entries).length,
      provider: meta.providerModel
        ? `${meta.provider}:${meta.providerModel}`
        : meta.provider || 'openai',
      dimensions: meta.dimensions,
      totalCost: meta.totalCost || 0,
      totalTokens: meta.totalTokens || 0,
    }
  })
