/**
 * Cost estimation for embedding a corpus.
 *
 * Standalone helper split out of semantic-search.ts to keep that file
 * under the 700 LOC ceiling. Only used by the CLI cost-preview path
 * (`mdm index --embed --estimate`).
 */

import * as path from 'node:path'
import { Effect } from 'effect'
import type { FileReadError, IndexCorruptedError } from '../errors/index.js'
import { IndexNotFoundError } from '../errors/index.js'
import { dbIndexDir, resolveMdmHome } from '../home.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'
import { lookupPricing } from '../providers/pricing.js'
import { matchPath } from '../search/path-matcher.js'

/**
 * Price per 1M tokens for text-embedding-3-small (canonical estimator model).
 * The estimator is intentionally pinned to a single model so cost previews
 * are stable regardless of the provider the user eventually picks. Per-run
 * cost reporting lives inside the runtime clients and obeys the
 * no-fallback rule.
 */
export const EMBEDDING_PRICE_PER_MILLION =
  lookupPricing('embed', 'text-embedding-3-small')?.input ?? 0

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
    const storage = createStorage(resolvedRoot, dbIndexDir(resolveMdmHome()))

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
        const excluded = options.excludePatterns.some((pattern) =>
          matchPath(section.documentPath, pattern),
        )
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
