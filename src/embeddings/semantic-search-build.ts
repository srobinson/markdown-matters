/**
 * Build embeddings for an indexed corpus.
 *
 * Split out of semantic-search.ts for the 700 LOC refactor. The public
 * `buildEmbeddings` orchestrator is kept under the 150 LOC function cap
 * by delegating the grouping and file-read phases to private helpers.
 */

import * as fs from 'node:fs/promises'
import { Effect } from 'effect'
import { type DocumentKey, resolveSourceFile } from '../db/canonical.js'
import {
  type ApiKeyInvalidError,
  type ApiKeyMissingError,
  type DimensionMismatchError,
  type EmbeddingError,
  type FileReadError,
  type IndexCorruptedError,
  IndexNotFoundError,
  type VectorStoreError,
} from '../errors/index.js'
import { dbIndexDir, resolveMdmHome } from '../home.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'
import type {
  DocumentIndex,
  SectionEntry,
  SectionIndex,
} from '../index/types.js'
import {
  type CapabilityNotSupported,
  type EmbeddingClient,
  getResolvedBaseURL,
  type ProviderId,
  type ProviderNotFound,
} from '../providers/index.js'
import { lookupPricing } from '../providers/pricing.js'
import {
  matchesDocumentPath,
  resolveCanonicalSourceRoot,
} from '../search/path-matcher.js'
import { getRecommendedDimensions, supportsMatryoshka } from './dimensions.js'
import { createEmbeddingClient, embedInBatches } from './embed-batched.js'
import {
  generateNamespace,
  writeActiveProvider,
} from './embedding-namespace.js'
import { invalidateHnswCache } from './hnsw-cache.js'
import { EMBEDDING_PRICE_PER_MILLION } from './semantic-search-cost.js'
import type { VectorEntry } from './types.js'
import {
  createNamespacedVectorStore,
  type HnswBuildOptions,
} from './vector-store.js'

// ============================================================================
// Public types
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

/**
 * Provider config accepted by `buildEmbeddings` and `prepareSearchPipeline`.
 *
 * `provider` and `model` flow into the runtime client. `baseURL` overrides
 * the per-provider transport default for embedding requests; honored by
 * the four OpenAI-compatible providers (openai, openrouter, ollama,
 * lm-studio) so private hosts, self-hosted instances, and proxies route
 * correctly. Voyage has no custom-host concept and ignores this field.
 * HyDE inherits this value via `resolveHydeOptions` so a custom host
 * applied here automatically carries across to query expansion.
 * `dimensions` is forwarded to the transport when set; otherwise the
 * consumer derives a recommended value from the model. `timeout` is
 * currently ignored on the embed path; the transport uses the OpenAI
 * SDK default.
 */
export interface EmbeddingProviderConfig {
  readonly provider: ProviderId
  readonly baseURL?: string | undefined
  readonly model?: string | undefined
  readonly dimensions?: number | undefined
  readonly timeout?: number | undefined
}

export interface BuildEmbeddingsOptions {
  readonly force?: boolean | undefined
  /**
   * Test-only escape hatch to inject a pre-built `EmbeddingClient`,
   * bypassing runtime construction. Production callers leave this unset
   * and let `providerConfig` drive the lookup.
   */
  readonly client?: EmbeddingClient | undefined
  readonly providerConfig?: EmbeddingProviderConfig | undefined
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

// ============================================================================
// Private helpers
// ============================================================================

/**
 * Compose the text we feed to the embedding model for a section.
 * Includes the heading, parent heading context, document title, and the
 * section body. The format is stable so HNSW cache keys derived from it
 * survive across builds.
 */
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

type DocSections = {
  section: SectionEntry
  parentHeading: string | undefined
}

interface EligibleSectionGroups {
  readonly sectionsByDoc: Map<DocumentKey, DocSections[]>
  readonly currentSectionIds: Set<string>
}

/**
 * Group embed-eligible sections by document path. Skips very short
 * sections, applies exclude patterns, and resolves the parent heading
 * for each section (for context in the embedding text).
 */
const groupEligibleSections = (
  sourceRoot: string,
  sectionIndex: SectionIndex,
  docIndex: DocumentIndex,
  excludePatterns: readonly string[] | undefined,
): EligibleSectionGroups => {
  const isExcluded = (documentPath: DocumentKey): boolean => {
    if (!excludePatterns?.length) return false
    return excludePatterns.some((pattern) =>
      matchesDocumentPath(sourceRoot, documentPath, pattern),
    )
  }

  const sectionsByDoc = new Map<DocumentKey, DocSections[]>()

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

  const currentSectionIds = new Set<string>()
  for (const sections of sectionsByDoc.values()) {
    for (const { section } of sections) {
      currentSectionIds.add(section.id)
    }
  }

  return { sectionsByDoc, currentSectionIds }
}

interface SectionsToEmbed {
  readonly sectionsToEmbed: { section: SectionEntry; text: string }[]
  readonly filesProcessed: number
}

/**
 * Read each eligible doc from disk, extract the section bodies, and
 * produce the `{section, text}` pairs that feed into the embed call.
 * Files that can't be read are skipped with a warning, not a failure.
 * Sections already in `embeddedIds` are skipped for delta embedding.
 */
const readSectionsToEmbed = (
  sectionsByDoc: Map<DocumentKey, DocSections[]>,
  docIndex: DocumentIndex,
  embeddedIds: Set<string>,
  onFileProgress: ((progress: FileProgress) => void) | undefined,
): Effect.Effect<SectionsToEmbed, never, never> =>
  Effect.gen(function* () {
    const sectionsToEmbed: { section: SectionEntry; text: string }[] = []
    const docPaths = Array.from(sectionsByDoc.keys())
    let filesProcessed = 0

    for (let fileIndex = 0; fileIndex < docPaths.length; fileIndex++) {
      const docPath = docPaths[fileIndex]!
      const sections = sectionsByDoc.get(docPath)!
      const document = docIndex.documents[docPath]
      if (!document) continue

      if (onFileProgress) {
        onFileProgress({
          fileIndex: fileIndex + 1,
          totalFiles: docPaths.length,
          filePath: docPath,
          sectionCount: sections.length,
        })
      }

      const filePath = resolveSourceFile(docPath)

      // Note: catchAll is intentional - file read failures during embedding
      // should skip the file with a warning rather than abort the entire
      // operation. A warning is logged below when the read fails.
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
        // Delta: skip sections that already have embeddings
        if (embeddedIds.has(section.id)) continue

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

    return { sectionsToEmbed, filesProcessed }
  })

// ============================================================================
// Public orchestrator
// ============================================================================

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
  | CapabilityNotSupported
  | ProviderNotFound
  | EmbeddingError
  | VectorStoreError
  | DimensionMismatchError
> =>
  Effect.gen(function* () {
    const startTime = Date.now()
    const resolvedRoot = yield* resolveCanonicalSourceRoot(rootPath)
    const storage = createStorage(resolvedRoot, dbIndexDir(resolveMdmHome()))

    const docIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)

    if (!docIndex || !sectionIndex) {
      return yield* Effect.fail(new IndexNotFoundError({ path: resolvedRoot }))
    }

    // Resolve provider config and build (or accept) the runtime client.
    // Priority: explicit client > providerConfig.provider > default (openai)
    const providerConfig = options.providerConfig ?? { provider: 'openai' }
    const providerName: ProviderId = providerConfig.provider
    const providerModel = providerConfig.model ?? 'text-embedding-3-small'
    const dimensions =
      providerConfig.dimensions ??
      getRecommendedDimensions(providerModel) ??
      512

    const client =
      options.client ??
      (yield* createEmbeddingClient(providerName, {
        baseURL: providerConfig.baseURL,
      }))

    // Create namespaced vector store for this provider/model/dimensions combination
    const vectorStore = createNamespacedVectorStore(
      storage.indexRoot,
      providerName,
      providerModel,
      dimensions,
      options.hnswOptions,
    )

    // Record the endpoint the runtime actually dialled. The runtime
    // owns the per-provider "is there a custom-host concept?" decision
    // — voyage returns undefined, openai-compatible returns the caller
    // override (when set) or the transport default.
    const effectiveBaseURL = getResolvedBaseURL(providerName, {
      baseURL: providerConfig.baseURL,
    })
    vectorStore.setProvider(providerName, providerModel, effectiveBaseURL)

    // Load existing vectors for delta computation (skip on --force)
    let embeddedIds = new Set<string>()
    if (!options.force) {
      const loadResult = yield* vectorStore.load()
      if (loadResult.loaded) {
        embeddedIds = vectorStore.getEmbeddedIds()
      }
    }

    const { sectionsByDoc, currentSectionIds } = groupEligibleSections(
      resolvedRoot,
      sectionIndex,
      docIndex,
      options.excludePatterns,
    )

    // Remove stale entries: sections that were embedded but no longer exist
    // in the current index (deleted or restructured files).
    if (embeddedIds.size > 0) {
      const staleIds = [...embeddedIds].filter(
        (id) => !currentSectionIds.has(id),
      )
      if (staleIds.length > 0) {
        yield* vectorStore.removeEntries(staleIds)
      }
    }

    const namespace = generateNamespace(providerName, providerModel, dimensions)

    if (sectionsByDoc.size === 0) {
      // Still save if we removed stale entries
      if (embeddedIds.size > 0) {
        yield* vectorStore.save()
        invalidateHnswCache(storage.indexRoot, namespace)
      }
      return {
        sectionsEmbedded: 0,
        tokensUsed: 0,
        cost: 0,
        duration: Date.now() - startTime,
        filesProcessed: 0,
      }
    }

    const { sectionsToEmbed, filesProcessed } = yield* readSectionsToEmbed(
      sectionsByDoc,
      docIndex,
      embeddedIds,
      options.onFileProgress,
    )

    if (sectionsToEmbed.length === 0) {
      // All sections already embedded (or stale ones were cleaned up)
      if (embeddedIds.size > 0) {
        yield* vectorStore.save()
        invalidateHnswCache(storage.indexRoot, namespace)
      }
      const estimatedSavings =
        embeddedIds.size > 0
          ? (vectorStore.getStats().totalTokens / 1_000_000) *
            EMBEDDING_PRICE_PER_MILLION
          : 0
      return {
        sectionsEmbedded: 0,
        tokensUsed: 0,
        cost: 0,
        duration: Date.now() - startTime,
        filesProcessed,
        cacheHit: embeddedIds.size > 0,
        existingVectors:
          embeddedIds.size > 0 ? vectorStore.getStats().count : undefined,
        estimatedSavings: estimatedSavings > 0 ? estimatedSavings : undefined,
      }
    }

    // Generate embeddings via the runtime client, batched + retried by the
    // consumer-side helper. Cost is computed locally because the runtime
    // client is intentionally cost-agnostic.
    //
    // Pass `dimensions` to the API only for Matryoshka-capable models so the
    // OpenAI side returns truncated vectors. Non-Matryoshka models always
    // emit native dimensions and would reject the parameter.
    const texts = sectionsToEmbed.map((s) => s.text)
    const result = yield* embedInBatches(client, texts, {
      model: providerModel,
      ...(supportsMatryoshka(providerModel) ? { dimensions } : {}),
      onBatchProgress: options.onBatchProgress
        ? (p) =>
            options.onBatchProgress?.({
              batchIndex: p.batchIndex,
              totalBatches: p.totalBatches,
              processedSections: p.processedTexts,
              totalSections: p.totalTexts,
            })
        : undefined,
    })
    const tokensUsed = result.usage?.inputTokens ?? 0
    const pricePerMillion = lookupPricing('embed', providerModel)?.input ?? 0
    const cost = (tokensUsed / 1_000_000) * pricePerMillion

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

    yield* vectorStore.add(entries)
    vectorStore.addCost(cost, tokensUsed)

    // Save and invalidate cache so next search picks up new vectors
    yield* vectorStore.save()
    invalidateHnswCache(storage.indexRoot, namespace)

    // Set this namespace as the active provider
    yield* writeActiveProvider(storage.indexRoot, {
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

    return {
      sectionsEmbedded: entries.length,
      tokensUsed,
      cost,
      duration: Date.now() - startTime,
      filesProcessed,
    }
  })
