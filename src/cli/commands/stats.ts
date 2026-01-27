/**
 * STATS Command
 *
 * Show index statistics.
 */

import * as path from 'node:path'
import { Args, Command } from '@effect/cli'
import { Console, Effect } from 'effect'
import { getEmbeddingStats } from '../../embeddings/semantic-search.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../../index/storage.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson } from '../utils.js'

interface IndexStats {
  documentCount: number
  totalTokens: number
  avgTokensPerDoc: number
  totalSections: number
  sectionsByLevel: Record<number, number>
  tokenDistribution: {
    min: number
    max: number
    median: number
  }
}

export const statsCommand = Command.make(
  'stats',
  {
    path: Args.directory({ name: 'path' }).pipe(
      Args.withDescription('Directory to show stats for'),
      Args.withDefault('.'),
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ path: dirPath, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedRoot = path.resolve(dirPath)
      const storage = createStorage(resolvedRoot)

      // Load document and section indexes
      const docIndex = yield* loadDocumentIndex(storage)
      const sectionIndex = yield* loadSectionIndex(storage)

      // Handle case where index doesn't exist
      if (!docIndex || !sectionIndex) {
        if (json) {
          yield* Console.log(formatJson({ error: 'No index found' }, pretty))
        } else {
          yield* Console.log('No index found.')
          yield* Console.log("Run 'mdcontext index <path>' to create an index.")
        }
        return
      }

      // Calculate index stats
      const docs = Object.values(docIndex.documents)
      const sections = Object.values(sectionIndex.sections)

      const tokenCounts = docs.map((d) => d.tokenCount).sort((a, b) => a - b)
      const totalTokens = tokenCounts.reduce((sum, t) => sum + t, 0)

      // Count sections by level
      const sectionsByLevel: Record<number, number> = {}
      for (const section of sections) {
        sectionsByLevel[section.level] =
          (sectionsByLevel[section.level] || 0) + 1
      }

      const indexStats: IndexStats = {
        documentCount: docs.length,
        totalTokens,
        avgTokensPerDoc:
          docs.length > 0 ? Math.round(totalTokens / docs.length) : 0,
        totalSections: sections.length,
        sectionsByLevel,
        tokenDistribution: {
          min: tokenCounts[0] || 0,
          max: tokenCounts[tokenCounts.length - 1] || 0,
          median: tokenCounts[Math.floor(tokenCounts.length / 2)] || 0,
        },
      }

      // Get embedding stats
      const embeddingStats = yield* getEmbeddingStats(resolvedRoot)

      if (json) {
        yield* Console.log(
          formatJson({ ...indexStats, embeddings: embeddingStats }, pretty),
        )
      } else {
        yield* Console.log('Index statistics:')
        yield* Console.log('')
        yield* Console.log('  Documents')
        yield* Console.log(`    Count:       ${indexStats.documentCount}`)
        yield* Console.log(
          `    Tokens:      ${indexStats.totalTokens.toLocaleString()}`,
        )
        yield* Console.log(`    Avg/doc:     ${indexStats.avgTokensPerDoc}`)
        yield* Console.log('')
        yield* Console.log('  Token distribution')
        yield* Console.log(
          `    Min:         ${indexStats.tokenDistribution.min}`,
        )
        yield* Console.log(
          `    Median:      ${indexStats.tokenDistribution.median}`,
        )
        yield* Console.log(
          `    Max:         ${indexStats.tokenDistribution.max}`,
        )
        yield* Console.log('')
        yield* Console.log('  Sections')
        yield* Console.log(`    Total:       ${indexStats.totalSections}`)
        // Show section depth breakdown
        const levels = Object.keys(sectionsByLevel)
          .map(Number)
          .sort((a, b) => a - b)
        for (const level of levels) {
          yield* Console.log(
            `    h${level}:          ${sectionsByLevel[level]}`,
          )
        }
        yield* Console.log('')
        yield* Console.log('  Embeddings')
        if (embeddingStats.hasEmbeddings) {
          yield* Console.log(`    Vectors:     ${embeddingStats.count}`)
          yield* Console.log(`    Provider:    ${embeddingStats.provider}`)
          if (embeddingStats.model) {
            yield* Console.log(`    Model:       ${embeddingStats.model}`)
          }
          yield* Console.log(`    Dimensions:  ${embeddingStats.dimensions}`)
          yield* Console.log(
            `    Cost:        $${embeddingStats.totalCost.toFixed(6)}`,
          )
        } else {
          yield* Console.log('    Not enabled')
          yield* Console.log(
            "    Run 'mdcontext index --embed' to build embeddings.",
          )
        }
      }
    }),
).pipe(Command.withDescription('Index statistics'))
