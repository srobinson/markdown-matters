import * as readline from 'node:readline'
import { Console, Effect } from 'effect'
import type { SemanticSearchResult } from '../../embeddings/types.js'
import type {
  HybridSearchResult,
  HybridSearchStats,
} from '../../search/hybrid-search.js'
import type { SearchResult } from '../../search/searcher.js'
import { formatJson, type IndexInfo } from '../utils.js'

export const renderNoIndexedPathGuidance = (
  requestedPath: string,
  json: boolean,
  pretty: boolean,
): Effect.Effect<void> => {
  const guidance = `Run: mdm index ${requestedPath}`
  return json
    ? Console.log(
        formatJson(
          {
            error: 'No indexed documents found.',
            path: requestedPath,
            guidance,
          },
          pretty,
        ),
      )
    : Effect.gen(function* () {
        yield* Console.log(`No indexed documents found in ${requestedPath}.`)
        yield* Console.log('')
        yield* Console.log(guidance)
      })
}

export const promptUser = (message: string): Promise<string> => {
  if (!(process.stdout.isTTY && process.stdin.isTTY)) {
    return Promise.resolve('n')
  }
  return new Promise((resolve) => {
    const input = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    input.question(message, (answer) => {
      input.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

export const renderIndexInfo = (indexInfo: IndexInfo): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!indexInfo.lastUpdated) return
    const lastUpdated = new Date(indexInfo.lastUpdated)
    const date = lastUpdated.toLocaleDateString('en-CA')
    const time = lastUpdated.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    yield* Console.log(`Using index from ${date} ${time}`)
    yield* Console.log(`  Sections: ${indexInfo.sectionCount ?? 0}`)
    yield* Console.log(
      indexInfo.embeddingsExist
        ? `  Embeddings: yes (${indexInfo.vectorCount ?? 0} vectors)`
        : '  Embeddings: no',
    )
    yield* Console.log('')
  })

interface HybridOutputOptions {
  readonly results: readonly HybridSearchResult[]
  readonly stats: HybridSearchStats
  readonly rerank: boolean
  readonly json: boolean
  readonly pretty: boolean
  readonly modeReason: string
  readonly query: string
  readonly guidance?: string | undefined
}

export const renderHybridOutput = (
  options: HybridOutputOptions,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const {
      results,
      stats,
      rerank,
      json,
      pretty,
      modeReason,
      query,
      guidance,
    } = options
    const emptyGuidance = results.length === 0 ? guidance : undefined
    if (rerank && !stats.reranked && !json) {
      yield* Console.log(
        'Note: --rerank requested but @huggingface/transformers not installed',
      )
      yield* Console.log(
        '      Install with: npm install @huggingface/transformers',
      )
      yield* Console.log('')
    }
    const moreAvailable =
      stats.totalAvailable !== undefined &&
      stats.totalAvailable > results.length
        ? stats.totalAvailable - results.length
        : json
          ? undefined
          : 0
    if (json) {
      yield* Console.log(
        formatJson(
          {
            mode: 'hybrid',
            modeReason,
            query,
            stats,
            moreAvailable,
            ...(emptyGuidance === undefined ? {} : { guidance: emptyGuidance }),
            results: results.map((result) => ({
              path: result.documentPath,
              heading: result.heading,
              score: result.score,
              similarity: result.similarity,
              bm25Score: result.bm25Score,
              sources: result.sources,
              ...(result.contextLines && {
                contextLines: result.contextLines,
              }),
            })),
          },
          pretty,
        ),
      )
      return
    }

    const indicator = modeReason.startsWith('--mode')
      ? '[hybrid]'
      : `[hybrid] (${modeReason})`
    yield* Console.log(`${indicator} Searching: "${query}"`)
    yield* Console.log(
      moreAvailable && moreAvailable > 0
        ? `Results: ${results.length} (${moreAvailable} more available, use --limit to see more)`
        : `Results: ${results.length}`,
    )
    yield* Console.log('')
    if (emptyGuidance !== undefined) {
      yield* Console.log(emptyGuidance)
      yield* Console.log('')
    }
    for (const result of results) {
      yield* Console.log(`  ${result.documentPath}`)
      yield* Console.log(
        `    ${result.heading} (${(result.score * 100).toFixed(1)} RRF, ${result.sources.join('+')})`,
      )
      if (result.contextLines && result.contextLines.length > 0) {
        yield* Console.log('')
        for (const line of result.contextLines) {
          yield* Console.log(
            `  ${line.isMatch ? '>' : ' '} ${line.lineNumber}: ${line.line}`,
          )
        }
      }
      yield* Console.log('')
    }
  })

interface KeywordOutputOptions {
  readonly results: readonly SearchResult[]
  readonly indexInfo: IndexInfo
  readonly query: string
  readonly modeReason: string
  readonly contextBefore?: number | undefined
  readonly contextAfter?: number | undefined
  readonly fuzzy: boolean
  readonly stem: boolean
  readonly fuzzyDistance?: number | undefined
  readonly headingOnly: boolean
  readonly json: boolean
  readonly pretty: boolean
  readonly guidance?: string | undefined
}

export const renderKeywordOutput = (
  options: KeywordOutputOptions,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const {
      results,
      query,
      modeReason,
      contextBefore,
      contextAfter,
      fuzzy,
      stem,
      fuzzyDistance,
      headingOnly,
      json,
      pretty,
      guidance,
    } = options
    const emptyGuidance = results.length === 0 ? guidance : undefined
    if (json) {
      yield* Console.log(
        formatJson(
          {
            mode: 'keyword',
            modeReason,
            query,
            contextBefore,
            contextAfter,
            fuzzy,
            stem,
            ...(fuzzyDistance !== undefined && { fuzzyDistance }),
            ...(emptyGuidance === undefined ? {} : { guidance: emptyGuidance }),
            results: results.map((result) => ({
              path: result.section.documentPath,
              heading: result.section.heading,
              level: result.section.level,
              tokens: result.section.tokenCount,
              line: result.section.startLine,
              matches: result.matches?.map((match) => ({
                lineNumber: match.lineNumber,
                line: match.line,
                contextLines: match.contextLines,
              })),
            })),
          },
          pretty,
        ),
      )
      return
    }

    const showReason =
      modeReason !== '--mode keyword' && modeReason !== '--keyword flag'
    const mode = showReason ? `[keyword] (${modeReason})` : '[keyword]'
    const indicators: string[] = []
    if (fuzzy) indicators.push('fuzzy')
    if (stem) indicators.push('stem')
    const fuzzyLabel = indicators.length > 0 ? ` [${indicators.join('+')}]` : ''
    yield* Console.log(
      `${mode}${fuzzyLabel} ${headingOnly ? 'Heading' : 'Content'} search: "${query}"`,
    )
    yield* Console.log(`Results: ${results.length}`)
    yield* Console.log('')
    if (emptyGuidance !== undefined) {
      yield* Console.log(emptyGuidance)
      yield* Console.log('')
    }
    for (const result of results) {
      yield* Console.log(
        `  ${result.section.documentPath}:${result.section.startLine}`,
      )
      yield* Console.log(
        `    ${'#'.repeat(result.section.level)} ${result.section.heading} (${result.section.tokenCount} tokens)`,
      )
      if (result.matches && result.matches.length > 0) {
        yield* Console.log('')
        for (const match of result.matches.slice(0, 3)) {
          if (match.contextLines && match.contextLines.length > 0) {
            for (const line of match.contextLines) {
              yield* Console.log(
                `  ${line.isMatch ? '>' : ' '} ${line.lineNumber}: ${line.line}`,
              )
            }
          } else {
            yield* Console.log(`    Line ${match.lineNumber}:`)
            for (const line of match.snippet.split('\n')) {
              yield* Console.log(`      ${line}`)
            }
          }
          yield* Console.log('')
        }
        if (result.matches.length > 3) {
          yield* Console.log(
            `    ... and ${result.matches.length - 3} more matches`,
          )
        }
      }
      yield* Console.log('')
    }
    if (!options.indexInfo.embeddingsExist) {
      yield* Console.log(
        "Tip: Run 'mdm index --embed' to enable semantic search",
      )
    }
  })

interface SemanticOutputOptions {
  readonly results: readonly SemanticSearchResult[]
  readonly belowThresholdCount?: number | undefined
  readonly belowThresholdHighest?: number | undefined
  readonly totalAvailable?: number | undefined
  readonly threshold: number
  readonly query: string
  readonly modeReason: string
  readonly hyde: boolean
  readonly json: boolean
  readonly pretty: boolean
  readonly guidance?: string | undefined
}

export const renderSemanticOutput = (
  options: SemanticOutputOptions,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const {
      results,
      belowThresholdCount,
      belowThresholdHighest,
      totalAvailable,
      threshold,
      query,
      modeReason,
      hyde,
      json,
      pretty,
      guidance,
    } = options
    const emptyGuidance = results.length === 0 ? guidance : undefined
    const moreAvailable =
      totalAvailable !== undefined && totalAvailable > results.length
        ? totalAvailable - results.length
        : json
          ? undefined
          : 0
    if (json) {
      yield* Console.log(
        formatJson(
          {
            mode: 'semantic',
            modeReason,
            query,
            hyde,
            results,
            belowThresholdCount,
            belowThresholdHighest,
            moreAvailable,
            ...(emptyGuidance === undefined ? {} : { guidance: emptyGuidance }),
          },
          pretty,
        ),
      )
      return
    }

    const mode =
      modeReason === '--mode semantic'
        ? '[semantic]'
        : `[semantic] (${modeReason})`
    yield* Console.log(
      `${mode}${hyde ? ' [HyDE]' : ''} Semantic search: "${query}"`,
    )
    yield* Console.log(
      moreAvailable && moreAvailable > 0
        ? `Results: ${results.length} (${moreAvailable} more available, use --limit to see more)`
        : `Results: ${results.length}`,
    )
    yield* Console.log('')
    if (emptyGuidance !== undefined) {
      yield* Console.log(emptyGuidance)
      yield* Console.log('')
    }
    for (const result of results) {
      yield* Console.log(`  ${result.documentPath}`)
      yield* Console.log(
        `    ${result.heading} (${(result.similarity * 100).toFixed(1)}% match)`,
      )
      if (result.contextLines && result.contextLines.length > 0) {
        yield* Console.log('')
        for (const line of result.contextLines) {
          yield* Console.log(
            `  ${line.isMatch ? '>' : ' '} ${line.lineNumber}: ${line.line}`,
          )
        }
      }
      yield* Console.log('')
    }
    if (
      results.length === 0 &&
      belowThresholdCount !== undefined &&
      belowThresholdCount > 0 &&
      belowThresholdHighest !== undefined
    ) {
      const highest = (belowThresholdHighest * 100).toFixed(1)
      const suggested = Math.max(0.1, belowThresholdHighest - 0.05).toFixed(2)
      yield* Console.log(
        `Note: ${belowThresholdCount} results found below ${(threshold * 100).toFixed(0)}% threshold (highest: ${highest}%)`,
      )
      yield* Console.log(
        `Tip: Use --threshold ${suggested} to see more results`,
      )
      yield* Console.log('')
    }
    yield* Console.log('Tip: Use --mode keyword for exact text matching')
  })
