/**
 * Semantic search functionality
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import {
  type ApiKeyInvalidError,
  type ApiKeyMissingError,
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
import { createOpenAIProvider, wrapEmbedding } from './openai-provider.js'
import type {
  EmbeddingProvider,
  SemanticSearchOptions,
  SemanticSearchResult,
  VectorEntry,
} from './types.js'
import { createVectorStore, type HnswVectorStore } from './vector-store.js'

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

// Price per 1M tokens for text-embedding-3-small
const EMBEDDING_PRICE_PER_MILLION = 0.02

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
  readonly excludePatterns?: readonly string[] | undefined
  readonly onFileProgress?: ((progress: FileProgress) => void) | undefined
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
 * @throws ApiKeyMissingError - OPENAI_API_KEY not set
 * @throws ApiKeyInvalidError - API key rejected by OpenAI
 * @throws EmbeddingError - Embedding API failure (rate limit, quota, network)
 * @throws VectorStoreError - Cannot save vector index
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

    // Get or create provider
    const provider = options.provider ?? (yield* createOpenAIProvider())
    const dimensions = provider.dimensions

    // Create vector store
    const vectorStore = createVectorStore(
      resolvedRoot,
      dimensions,
    ) as HnswVectorStore
    vectorStore.setProvider(provider.name)

    // Load existing if not forcing
    if (!options.force) {
      const loaded = yield* vectorStore.load()
      if (loaded) {
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
    const result = yield* wrapEmbedding(provider.embed(texts))

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
 * @throws ApiKeyMissingError - OPENAI_API_KEY not set
 * @throws ApiKeyInvalidError - API key rejected by OpenAI
 * @throws EmbeddingError - Embedding API failure (rate limit, quota, network)
 * @throws VectorStoreError - Cannot load or search vector index
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
> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath)

    // Get provider for query embedding
    const provider = yield* createOpenAIProvider()
    const dimensions = provider.dimensions

    // Load vector store
    const vectorStore = createVectorStore(resolvedRoot, dimensions)
    const loaded = yield* vectorStore.load()

    if (!loaded) {
      return yield* Effect.fail(
        new EmbeddingsNotFoundError({ path: resolvedRoot }),
      )
    }

    // Embed the query
    const queryResult = yield* wrapEmbedding(provider.embed([query]))

    const queryVector = queryResult.embeddings[0]
    if (!queryVector) {
      return yield* Effect.fail(
        new EmbeddingError({
          reason: 'Unknown',
          message: 'Failed to generate query embedding',
          provider: 'OpenAI',
        }),
      )
    }

    // Search
    const limit = options.limit ?? 10
    const threshold = options.threshold ?? 0

    const searchResults = yield* vectorStore.search(
      queryVector,
      limit * 2,
      threshold,
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

    // Convert to SemanticSearchResult
    const results: SemanticSearchResult[] = filteredResults
      .slice(0, limit)
      .map((r) => ({
        sectionId: r.sectionId,
        documentPath: r.documentPath,
        heading: r.heading,
        similarity: r.similarity,
      }))

    return results
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
 * @throws ApiKeyMissingError - OPENAI_API_KEY not set
 * @throws ApiKeyInvalidError - API key rejected by OpenAI
 * @throws EmbeddingError - Embedding API failure (rate limit, quota, network)
 * @throws VectorStoreError - Cannot load or search vector index
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

    // Try to load with default dimensions
    const vectorStore = createVectorStore(resolvedRoot, 1536)
    const loaded = yield* vectorStore.load()

    if (!loaded) {
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
      provider: stats.provider,
      dimensions: stats.dimensions,
      totalCost: stats.totalCost,
      totalTokens: stats.totalTokens,
    }
  })
