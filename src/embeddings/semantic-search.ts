/**
 * Semantic search functionality
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import {
  type ApiKeyInvalidError,
  type ApiKeyMissingError,
  DimensionMismatchError,
  EmbeddingError,
  EmbeddingsNotFoundError,
  type FileReadError,
  type IndexCorruptedError,
  IndexNotFoundError,
  type VectorStoreError,
} from '../errors/index.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'
import type { SectionEntry } from '../index/types.js'
import {
  type ActiveProvider,
  generateNamespace,
  getActiveNamespace,
  writeActiveProvider,
} from './embedding-namespace.js'
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
} from './types.js'
import {
  createNamespacedVectorStore,
  type HnswBuildOptions,
  type HnswMismatchWarning,
  type HnswVectorStore,
  type VectorSearchResult,
  type VectorStoreLoadResult,
} from './vector-store.js'

// ============================================================================
// HNSW Parameter Warning
// ============================================================================

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

export interface EmbeddingBatchProgress {
  readonly batchIndex: number
  readonly totalBatches: number
  readonly processedSections: number
  readonly totalSections: number
}

export interface BuildEmbeddingsOptions {
  readonly force?: boolean | undefined
  readonly provider?: EmbeddingProvider | undefined
  readonly providerConfig?: ProviderFactoryConfig | undefined
  readonly excludePatterns?: readonly string[] | undefined
  readonly onFileProgress?: ((progress: FileProgress) => void) | undefined
  /** Callback for batch progress during embedding API calls */
  readonly onBatchProgress?:
    | ((progress: EmbeddingBatchProgress) => void)
    | undefined
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

    // Extract provider info for namespacing from the actual provider instance
    // This ensures we use the correct values even when options.provider is explicitly set
    let providerName: string
    let providerModel: string

    if (hasProviderMetadata(provider)) {
      // Provider has metadata - extract provider name from provider.name (format: "provider:model")
      const nameParts = provider.name.split(':')
      providerName = nameParts[0] || 'openai'
      providerModel = provider.model
    } else {
      // Fallback to config values for providers without metadata
      providerName = providerConfig.provider ?? 'openai'
      providerModel = providerConfig.model ?? 'text-embedding-3-small'
    }

    // Create namespaced vector store for this provider/model/dimensions combination
    const vectorStore = createNamespacedVectorStore(
      resolvedRoot,
      providerName,
      providerModel,
      dimensions,
      options.hnswOptions,
    ) as HnswVectorStore

    // Set provider metadata
    if (hasProviderMetadata(provider)) {
      vectorStore.setProvider(provider.name, provider.model, provider.baseURL)
    } else {
      vectorStore.setProvider(providerName, providerModel, undefined)
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
      provider.embed(texts, {
        onBatchProgress: options.onBatchProgress
          ? (p) =>
              options.onBatchProgress?.({
                batchIndex: p.batchIndex,
                totalBatches: p.totalBatches,
                processedSections: p.processedTexts,
                totalSections: p.totalTexts,
              })
          : undefined,
      }),
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

    // Set this namespace as the active provider
    const namespace = generateNamespace(providerName, providerModel, dimensions)
    yield* writeActiveProvider(resolvedRoot, {
      namespace,
      provider: providerName,
      model: providerModel,
      dimensions,
      activatedAt: new Date().toISOString(),
    }).pipe(
      Effect.catchAll((e) => {
        // Don't fail the build if we can't write the active provider file
        console.warn(`Warning: Could not set active provider: ${e.message}`)
        return Effect.succeed(undefined)
      }),
    )

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
// Context Lines Helper
// ============================================================================

/**
 * Add context lines to search results by loading section content from files.
 * This helper is used by both semanticSearch and semanticSearchWithStats to avoid code duplication.
 */
const addContextLinesToResults = (
  limitedResults: readonly VectorSearchResult[],
  sectionIndex: { sections: Record<string, SectionEntry> },
  resolvedRoot: string,
  options: {
    contextBefore?: number | undefined
    contextAfter?: number | undefined
  },
): Effect.Effect<readonly SemanticSearchResult[], FileReadError, never> =>
  Effect.gen(function* () {
    const contextBefore = options.contextBefore ?? 0
    const contextAfter = options.contextAfter ?? 0

    const resultsWithContext: SemanticSearchResult[] = []
    const fileCache = new Map<string, string>()

    for (const r of limitedResults) {
      const section = sectionIndex.sections[r.sectionId]
      if (!section) {
        resultsWithContext.push({
          sectionId: r.sectionId,
          documentPath: r.documentPath,
          heading: r.heading,
          similarity: r.similarity,
        })
        continue
      }

      let fileContent = fileCache.get(r.documentPath)
      if (!fileContent) {
        const filePath = path.join(resolvedRoot, r.documentPath)
        const contentResult = yield* Effect.promise(() =>
          fs.readFile(filePath, 'utf-8'),
        ).pipe(
          Effect.map((content) => content),
          Effect.catchAll(() => Effect.succeed(null as string | null)),
        )

        if (contentResult) {
          fileContent = contentResult
          fileCache.set(r.documentPath, fileContent)
        }
      }

      if (fileContent) {
        const lines = fileContent.split('\n')
        const startIdx = Math.max(0, section.startLine - 1 - contextBefore)
        const endIdx = Math.min(lines.length, section.endLine + contextAfter)

        const contextLines: {
          lineNumber: number
          line: string
          isMatch: boolean
        }[] = []
        for (let i = startIdx; i < endIdx; i++) {
          const line = lines[i]
          if (line !== undefined) {
            contextLines.push({
              lineNumber: i + 1,
              line,
              isMatch: i >= section.startLine - 1 && i < section.endLine,
            })
          }
        }

        resultsWithContext.push({
          sectionId: r.sectionId,
          documentPath: r.documentPath,
          heading: r.heading,
          similarity: r.similarity,
          contextLines,
        })
      } else {
        resultsWithContext.push({
          sectionId: r.sectionId,
          documentPath: r.documentPath,
          heading: r.heading,
          similarity: r.similarity,
        })
      }
    }

    return resultsWithContext
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

    // Get active namespace to determine which embedding index to use
    const activeProvider = yield* getActiveNamespace(resolvedRoot).pipe(
      Effect.catchAll(() => Effect.succeed(null as ActiveProvider | null)),
    )

    if (!activeProvider) {
      return yield* Effect.fail(
        new EmbeddingsNotFoundError({ path: resolvedRoot }),
      )
    }

    // Create provider for query embedding
    const provider = yield* createEmbeddingProviderDirect(
      options.providerConfig ?? { provider: 'openai' },
    )
    const dimensions = provider.dimensions

    // Get current provider name for error messages
    const currentProviderName = options.providerConfig?.provider ?? 'openai'

    // Verify dimensions match the active namespace
    if (dimensions !== activeProvider.dimensions) {
      return yield* Effect.fail(
        new DimensionMismatchError({
          corpusDimensions: activeProvider.dimensions,
          providerDimensions: dimensions,
          corpusProvider: `${activeProvider.provider}:${activeProvider.model}`,
          currentProvider: currentProviderName,
          path: resolvedRoot,
        }),
      )
    }

    // Load vector store from the active namespace
    const vectorStore = createNamespacedVectorStore(
      resolvedRoot,
      activeProvider.provider,
      activeProvider.model,
      activeProvider.dimensions,
    )
    const loadResult = yield* vectorStore.load()

    if (!loadResult.loaded) {
      return yield* Effect.fail(
        new EmbeddingsNotFoundError({ path: resolvedRoot }),
      )
    }

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
      currentProviderName,
    )

    const queryVector = queryResult.embeddings[0]
    if (!queryVector) {
      return yield* Effect.fail(
        new EmbeddingError({
          reason: 'Unknown',
          message: 'Failed to generate query embedding',
          provider: currentProviderName,
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

    // Re-sort by boosted similarity
    const sortedResults = boostedResults.sort(
      (a, b) => b.similarity - a.similarity,
    )
    const limitedResults = sortedResults.slice(0, limit)

    // If context lines are requested, load section content
    let results: readonly SemanticSearchResult[]
    if (
      options.contextBefore !== undefined ||
      options.contextAfter !== undefined
    ) {
      const storage = createStorage(resolvedRoot)
      const sectionIndex = yield* loadSectionIndex(storage)

      if (sectionIndex) {
        results = yield* addContextLinesToResults(
          limitedResults,
          sectionIndex,
          resolvedRoot,
          options,
        )
      } else {
        results = limitedResults.map((r) => ({
          sectionId: r.sectionId,
          documentPath: r.documentPath,
          heading: r.heading,
          similarity: r.similarity,
        }))
      }
    } else {
      results = limitedResults.map((r) => ({
        sectionId: r.sectionId,
        documentPath: r.documentPath,
        heading: r.heading,
        similarity: r.similarity,
      }))
    }

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

    // Get active namespace to determine which embedding index to use
    const activeProvider = yield* getActiveNamespace(resolvedRoot).pipe(
      Effect.catchAll(() => Effect.succeed(null as ActiveProvider | null)),
    )

    if (!activeProvider) {
      return yield* Effect.fail(
        new EmbeddingsNotFoundError({ path: resolvedRoot }),
      )
    }

    // Create provider for query embedding
    const provider = yield* createEmbeddingProviderDirect(
      options.providerConfig ?? { provider: 'openai' },
    )
    const dimensions = provider.dimensions

    // Get current provider name for error messages
    const currentProviderName = options.providerConfig?.provider ?? 'openai'

    // Verify dimensions match the active namespace
    if (dimensions !== activeProvider.dimensions) {
      return yield* Effect.fail(
        new DimensionMismatchError({
          corpusDimensions: activeProvider.dimensions,
          providerDimensions: dimensions,
          corpusProvider: `${activeProvider.provider}:${activeProvider.model}`,
          currentProvider: currentProviderName,
          path: resolvedRoot,
        }),
      )
    }

    // Load vector store from the active namespace
    const vectorStore = createNamespacedVectorStore(
      resolvedRoot,
      activeProvider.provider,
      activeProvider.model,
      activeProvider.dimensions,
    )
    const loadResult = yield* vectorStore.load()

    if (!loadResult.loaded) {
      return yield* Effect.fail(
        new EmbeddingsNotFoundError({ path: resolvedRoot }),
      )
    }

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
      currentProviderName,
    )

    const queryVector = queryResult.embeddings[0]
    if (!queryVector) {
      return yield* Effect.fail(
        new EmbeddingError({
          reason: 'Unknown',
          message: 'Failed to generate query embedding',
          provider: currentProviderName,
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
    const limitedResults = sortedResults.slice(0, limit)

    // If context lines are requested, load section content
    let results: readonly SemanticSearchResult[]
    if (
      options.contextBefore !== undefined ||
      options.contextAfter !== undefined
    ) {
      const storage = createStorage(resolvedRoot)
      const sectionIndex = yield* loadSectionIndex(storage)

      if (sectionIndex) {
        results = yield* addContextLinesToResults(
          limitedResults,
          sectionIndex,
          resolvedRoot,
          options,
        )
      } else {
        results = limitedResults.map((r) => ({
          sectionId: r.sectionId,
          documentPath: r.documentPath,
          heading: r.heading,
          similarity: r.similarity,
        }))
      }
    } else {
      results = limitedResults.map((r) => ({
        sectionId: r.sectionId,
        documentPath: r.documentPath,
        heading: r.heading,
        similarity: r.similarity,
      }))
    }

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
  readonly model?: string | undefined
  readonly dimensions: number
  readonly totalCost: number
  readonly totalTokens: number
}

/**
 * Get statistics about stored embeddings.
 * Uses the active namespace to find the current embedding index.
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

    // Get the active namespace to find where embeddings are stored
    const activeProvider = yield* getActiveNamespace(resolvedRoot).pipe(
      Effect.catchAll(() => Effect.succeed(null as ActiveProvider | null)),
    )

    if (!activeProvider) {
      return {
        hasEmbeddings: false,
        count: 0,
        provider: 'none',
        dimensions: 0,
        totalCost: 0,
        totalTokens: 0,
      }
    }

    // Load the namespaced vector store to get stats
    const vectorStore = createNamespacedVectorStore(
      resolvedRoot,
      activeProvider.provider,
      activeProvider.model,
      activeProvider.dimensions,
    )

    const loadResult = yield* vectorStore
      .load()
      .pipe(
        Effect.catchAll(() =>
          Effect.succeed({ loaded: false } as VectorStoreLoadResult),
        ),
      )

    if (!loadResult.loaded) {
      return {
        hasEmbeddings: false,
        count: 0,
        provider: 'none',
        dimensions: 0,
        totalCost: 0,
        totalTokens: 0,
      }
    }

    const stats = vectorStore.getStats()

    return {
      hasEmbeddings: true,
      count: stats.count,
      provider: stats.provider || 'openai',
      model: stats.providerModel,
      dimensions: stats.dimensions,
      totalCost: stats.totalCost || 0,
      totalTokens: stats.totalTokens || 0,
    }
  })
