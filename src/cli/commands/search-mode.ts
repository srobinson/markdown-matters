import * as path from 'node:path'
import { Console, Effect, Option } from 'effect'
import {
  ConfigService,
  defaultConfig,
  type MdmConfig,
} from '../../config/index.js'
import type { GenerationReadSession } from '../../db/generation-reader.js'
import { semanticSearchWithStats } from '../../embeddings/semantic-search.js'
import type { SearchQuality } from '../../embeddings/types.js'
import { CliValidationError } from '../../errors/index.js'
import { createStorage, loadSectionIndex } from '../../index/storage.js'
import {
  detectSearchModes,
  hybridSearch,
  type SearchMode,
} from '../../search/hybrid-search.js'
import { isAdvancedQuery } from '../../search/query-parser.js'
import { search, searchContent } from '../../search/searcher.js'
import type { SummarizableResult } from '../../summarization/index.js'
import { getIndexInfo, type IndexInfo, isRegexPattern } from '../utils.js'
import {
  handleMissingEmbeddings,
  initializeSearchReranker,
  resolveProviderConfig,
  type SearchProvider,
} from './search-embeddings.js'
import {
  renderHybridOutput,
  renderIndexInfo,
  renderKeywordOutput,
  renderSemanticOutput,
} from './search-output.js'
import { filterResultsByRefineTerms } from './search-refine.js'
import { runSummarization } from './search-summarization.js'

export interface SearchCommandInput {
  readonly query: string
  readonly path: string
  readonly keyword: boolean
  readonly headingOnly: boolean
  readonly mode: Option.Option<'hybrid' | 'semantic' | 'keyword'>
  readonly limit: number
  readonly threshold: number
  readonly context: Option.Option<number>
  readonly beforeContext: Option.Option<number>
  readonly afterContext: Option.Option<number>
  readonly autoIndexThreshold: Option.Option<number>
  readonly provider: Option.Option<SearchProvider>
  readonly rerank: boolean
  readonly quality: Option.Option<'fast' | 'balanced' | 'thorough'>
  readonly hyde: boolean
  readonly rerankInit: boolean
  readonly timeout: Option.Option<number>
  readonly json: boolean
  readonly pretty: boolean
  readonly summarize: boolean
  readonly yes: boolean
  readonly stream: boolean
  readonly fuzzy: boolean
  readonly stem: boolean
  readonly fuzzyDistance: Option.Option<number>
  readonly refine: readonly string[]
}

interface ExecutionContext {
  readonly input: SearchCommandInput
  readonly session: GenerationReadSession
  readonly sourceRoot: string
  readonly config: MdmConfig
  readonly indexInfo: IndexInfo
  readonly effectiveLimit: number
  readonly effectiveThreshold: number
  readonly mode: SearchMode
  readonly modeReason: string
  readonly contextBefore?: number | undefined
  readonly contextAfter?: number | undefined
}

const summarizationConfig = (context: ExecutionContext) => ({
  mode: context.config.aiSummarization.mode,
  provider: context.config.aiSummarization.provider,
})

const runHybridMode = (context: ExecutionContext) =>
  Effect.gen(function* () {
    const { input } = context
    const refineTerms = input.refine.length > 0 ? input.refine : []
    const fetchLimit =
      refineTerms.length > 0
        ? context.effectiveLimit * 5
        : context.effectiveLimit
    const { results: rawResults, stats } = yield* hybridSearch(
      context.session,
      context.sourceRoot,
      input.query,
      {
        limit: fetchLimit,
        threshold: context.effectiveThreshold,
        mode: 'hybrid',
        rerank: input.rerank,
        quality: Option.getOrUndefined(input.quality) as
          | SearchQuality
          | undefined,
        contextBefore: context.contextBefore,
        contextAfter: context.contextAfter,
      },
    )
    let results = rawResults
    if (refineTerms.length > 0) {
      const sectionIndex = yield* loadSectionIndex(
        createStorage(context.sourceRoot, context.session.indexRoot),
      )
      if (sectionIndex) {
        results = yield* filterResultsByRefineTerms(
          rawResults,
          refineTerms,
          context.effectiveLimit,
          (result) => {
            const section = sectionIndex.sections[result.sectionId]
            return section
              ? {
                  documentPath: result.documentPath,
                  startLine: section.startLine,
                  endLine: section.endLine,
                }
              : null
          },
        )
      }
    }
    yield* renderHybridOutput({
      results,
      stats,
      rerank: input.rerank,
      json: input.json,
      pretty: input.pretty,
      modeReason: context.modeReason,
      query: input.query,
    })
    if (input.summarize && results.length > 0) {
      const summaryResults: SummarizableResult[] = results.map((result) => ({
        documentPath: result.documentPath,
        heading: result.heading,
        score: result.score,
        ...(result.similarity !== undefined && {
          similarity: result.similarity,
        }),
      }))
      yield* runSummarization({
        results: summaryResults,
        query: input.query,
        searchMode: 'hybrid',
        json: input.json,
        yes: input.yes,
        stream: input.stream,
        config: summarizationConfig(context),
      })
    }
  })

const runKeywordMode = (context: ExecutionContext) =>
  Effect.gen(function* () {
    const { input } = context
    const fuzzyDistance = Option.getOrUndefined(input.fuzzyDistance)
    const refineTerms = input.refine.length > 0 ? input.refine : []
    const fetchLimit =
      refineTerms.length > 0
        ? context.effectiveLimit * 5
        : context.effectiveLimit
    let results = input.headingOnly
      ? yield* search(context.session, context.sourceRoot, {
          heading: input.query,
          limit: fetchLimit,
        })
      : yield* searchContent(context.session, context.sourceRoot, {
          content: input.query,
          limit: fetchLimit,
          contextBefore: context.contextBefore,
          contextAfter: context.contextAfter,
          fuzzy: input.fuzzy,
          stem: input.stem,
          ...(fuzzyDistance !== undefined && { fuzzyDistance }),
        })
    if (refineTerms.length > 0) {
      results = yield* filterResultsByRefineTerms(
        results,
        refineTerms,
        context.effectiveLimit,
        (result) => ({
          documentPath: result.section.documentPath,
          startLine: result.section.startLine,
          endLine: result.section.endLine,
        }),
      )
    }
    yield* renderKeywordOutput({
      results,
      indexInfo: context.indexInfo,
      query: input.query,
      modeReason: context.modeReason,
      contextBefore: context.contextBefore,
      contextAfter: context.contextAfter,
      fuzzy: input.fuzzy,
      stem: input.stem,
      fuzzyDistance,
      headingOnly: input.headingOnly,
      json: input.json,
      pretty: input.pretty,
    })
    if (input.summarize && results.length > 0) {
      yield* runSummarization({
        results: results.map((result) => ({
          documentPath: result.section.documentPath,
          heading: result.section.heading,
        })),
        query: input.query,
        searchMode: 'keyword',
        json: input.json,
        yes: input.yes,
        stream: input.stream,
        config: summarizationConfig(context),
      })
    }
  })

const runSemanticMode = (context: ExecutionContext) =>
  Effect.gen(function* () {
    const { input } = context
    const refineTerms = input.refine.length > 0 ? input.refine : []
    const fetchLimit =
      refineTerms.length > 0
        ? context.effectiveLimit * 5
        : context.effectiveLimit
    const searchResult = yield* semanticSearchWithStats(
      context.session,
      context.sourceRoot,
      input.query,
      {
        limit: fetchLimit,
        threshold: context.effectiveThreshold,
        providerConfig: resolveProviderConfig(input.provider, input.timeout),
        quality: Option.getOrUndefined(input.quality) as
          | SearchQuality
          | undefined,
        hyde: input.hyde,
        contextBefore: context.contextBefore,
        contextAfter: context.contextAfter,
      },
    )
    let { results } = searchResult
    if (refineTerms.length > 0) {
      const sectionIndex = yield* loadSectionIndex(
        createStorage(context.sourceRoot, context.session.indexRoot),
      )
      if (sectionIndex) {
        results = yield* filterResultsByRefineTerms(
          results,
          refineTerms,
          context.effectiveLimit,
          (result) => {
            const section = sectionIndex.sections[result.sectionId]
            return section
              ? {
                  documentPath: result.documentPath,
                  startLine: section.startLine,
                  endLine: section.endLine,
                }
              : null
          },
        )
      }
    }
    yield* renderSemanticOutput({
      results,
      belowThresholdCount: searchResult.belowThresholdCount,
      belowThresholdHighest: searchResult.belowThresholdHighest,
      totalAvailable: searchResult.totalAvailable,
      threshold: context.effectiveThreshold,
      query: input.query,
      modeReason: context.modeReason,
      hyde: input.hyde,
      json: input.json,
      pretty: input.pretty,
    })
    if (input.summarize && results.length > 0) {
      yield* runSummarization({
        results: results.map((result) => ({
          documentPath: result.documentPath,
          heading: result.heading,
          similarity: result.similarity,
        })),
        query: input.query,
        searchMode: 'semantic',
        json: input.json,
        yes: input.yes,
        stream: input.stream,
        config: summarizationConfig(context),
      })
    }
  })

const resolveMode = (
  input: SearchCommandInput,
  session: GenerationReadSession,
  sourceRoot: string,
  autoIndexThreshold: number,
) =>
  Effect.gen(function* () {
    const modes = yield* detectSearchModes(session)
    const requested = Option.getOrUndefined(input.mode)
    if (requested === 'hybrid') {
      return { mode: 'hybrid' as const, reason: '--mode hybrid' }
    }
    if (requested === 'semantic') {
      if (
        !modes.hasEmbeddings &&
        !(yield* handleMissingEmbeddings(
          sourceRoot,
          autoIndexThreshold,
          input.json,
        ))
      ) {
        return null
      }
      return { mode: 'semantic' as const, reason: '--mode semantic' }
    }
    if (requested === 'keyword') {
      return { mode: 'keyword' as const, reason: '--mode keyword' }
    }
    if (input.keyword) {
      return { mode: 'keyword' as const, reason: '--keyword flag' }
    }
    if (isAdvancedQuery(input.query)) {
      return {
        mode: 'keyword' as const,
        reason: 'boolean/phrase pattern detected',
      }
    }
    if (isRegexPattern(input.query)) {
      return { mode: 'keyword' as const, reason: 'regex pattern detected' }
    }
    const reason =
      modes.recommendedMode === 'hybrid'
        ? 'both indexes available'
        : modes.recommendedMode === 'semantic'
          ? 'embeddings available'
          : 'no embeddings'
    return { mode: modes.recommendedMode, reason }
  })

export const runSearchCommand = (
  input: SearchCommandInput,
  session: GenerationReadSession,
) =>
  Effect.gen(function* () {
    const resolvedDir = path.resolve(input.path)
    if (input.threshold < 0 || input.threshold > 1) {
      return yield* Effect.fail(
        new CliValidationError({
          message: '--threshold must be between 0.0 and 1.0',
          argument: '--threshold',
          expected: '0.0..1.0',
          received: String(input.threshold),
        }),
      )
    }
    if (Option.isSome(input.fuzzyDistance) && input.fuzzyDistance.value < 1) {
      return yield* Effect.fail(
        new CliValidationError({
          message: '--fuzzy-distance must be >= 1',
          argument: '--fuzzy-distance',
          expected: '>= 1',
          received: String(input.fuzzyDistance.value),
        }),
      )
    }
    if (input.rerankInit) {
      yield* initializeSearchReranker()
      return
    }
    const config = yield* Effect.serviceOption(ConfigService).pipe(
      Effect.map(Option.getOrElse(() => defaultConfig)),
    )
    const effectiveLimit =
      input.limit === 10 ? config.search.defaultLimit : input.limit
    const effectiveThreshold =
      input.threshold === 0.35 ? config.search.minSimilarity : input.threshold
    const autoIndexThreshold = Option.getOrElse(
      input.autoIndexThreshold,
      () => config.search.autoIndexThreshold,
    )
    const indexInfo = yield* getIndexInfo(session)
    if (!indexInfo.exists && !input.json) {
      yield* Console.log('No index found.')
      yield* Console.log('')
      yield* Console.log('Run: mdm index /path/to/docs')
      yield* Console.log('  Add --embed for semantic search capabilities')
      return
    }
    const resolvedMode = yield* resolveMode(
      input,
      session,
      resolvedDir,
      autoIndexThreshold,
    )
    if (!resolvedMode) return
    if (!input.json) yield* renderIndexInfo(indexInfo)

    const context = Option.getOrUndefined(input.context)
    const execution: ExecutionContext = {
      input,
      session,
      sourceRoot: resolvedDir,
      config,
      indexInfo,
      effectiveLimit,
      effectiveThreshold,
      mode: resolvedMode.mode,
      modeReason: resolvedMode.reason,
      contextBefore: Option.getOrUndefined(input.beforeContext) ?? context,
      contextAfter: Option.getOrUndefined(input.afterContext) ?? context,
    }
    if (execution.mode === 'hybrid') yield* runHybridMode(execution)
    else if (execution.mode === 'keyword') yield* runKeywordMode(execution)
    else yield* runSemanticMode(execution)
  })
