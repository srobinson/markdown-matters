import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect, Option } from 'effect'
import type { ContextLine } from '../core/types.js'
import {
  type CliValidationError,
  FileReadError,
  type IndexCorruptedError,
} from '../errors/index.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'
import type { DocumentEntry, SectionEntry } from '../index/types.js'
import {
  buildFuzzyHighlightPattern,
  findMatchesInLine,
  type MatchOptions,
  matchesWithOptions,
} from './fuzzy-search.js'
import { matchPath } from './path-matcher.js'
import {
  buildHighlightPattern,
  evaluateQuery,
  isAdvancedQuery,
  type ParsedQuery,
  parseQuery,
} from './query-parser.js'
import { safeRegex } from './regex.js'

export interface SearchOptions {
  readonly heading?: string | undefined
  readonly content?: string | undefined
  readonly pathPattern?: string | undefined
  readonly hasCode?: boolean | undefined
  readonly hasList?: boolean | undefined
  readonly hasTable?: boolean | undefined
  readonly minLevel?: number | undefined
  readonly maxLevel?: number | undefined
  readonly limit?: number | undefined
  readonly contextBefore?: number | undefined
  readonly contextAfter?: number | undefined
  readonly fuzzy?: boolean | undefined
  readonly fuzzyDistance?: number | undefined
  readonly stem?: boolean | undefined
}

export interface ContentMatch {
  readonly lineNumber: number
  readonly line: string
  readonly snippet: string
  readonly contextLines?: readonly ContextLine[]
}

export interface SearchResult {
  readonly section: SectionEntry
  readonly document: DocumentEntry
  readonly sectionContent?: string
  readonly matches?: readonly ContentMatch[]
}

const matchesSectionFilters = (
  section: SectionEntry,
  options: SearchOptions,
  headingRegex: RegExp | null,
): boolean =>
  !(
    (headingRegex && !headingRegex.test(section.heading)) ||
    (options.hasCode !== undefined && section.hasCode !== options.hasCode) ||
    (options.hasList !== undefined && section.hasList !== options.hasList) ||
    (options.hasTable !== undefined && section.hasTable !== options.hasTable) ||
    (options.minLevel !== undefined && section.level < options.minLevel) ||
    (options.maxLevel !== undefined && section.level > options.maxLevel)
  )

export const search = (
  rootPath: string,
  options: SearchOptions = {},
): Effect.Effect<
  readonly SearchResult[],
  FileReadError | IndexCorruptedError | CliValidationError
> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath)
    const documentIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)
    if (!documentIndex || !sectionIndex) return []

    const results: SearchResult[] = []
    const headingRegex = options.heading
      ? yield* safeRegex(options.heading, 'i')
      : null
    for (const section of Object.values(sectionIndex.sections)) {
      if (!matchesSectionFilters(section, options, headingRegex)) continue
      if (
        options.pathPattern &&
        !matchPath(section.documentPath, options.pathPattern)
      ) {
        continue
      }
      const document = documentIndex.documents[section.documentPath]
      if (document) results.push({ section, document })
      if (options.limit !== undefined && results.length >= options.limit) break
    }
    return results
  })

interface PreparedContentQuery {
  readonly parsedQuery: ParsedQuery | null
  readonly contentRegex: RegExp | null
  readonly highlightRegex: RegExp | null
  readonly matchOptions: MatchOptions
  readonly useFuzzyOrStem: boolean | undefined
  readonly queryWords: readonly string[]
}

const prepareContentQuery = (
  options: SearchOptions,
): Effect.Effect<PreparedContentQuery, CliValidationError> =>
  Effect.gen(function* () {
    let parsedQuery: ParsedQuery | null = null
    let contentRegex: RegExp | null = null
    let highlightRegex: RegExp | null = null
    const matchOptions: MatchOptions = {
      stem: options.stem,
      fuzzyDistance: options.fuzzy ? (options.fuzzyDistance ?? 2) : undefined,
    }
    const useFuzzyOrStem = options.fuzzy || options.stem
    if (options.content) {
      if (isAdvancedQuery(options.content)) {
        parsedQuery = parseQuery(options.content)
        if (parsedQuery) {
          highlightRegex = useFuzzyOrStem
            ? buildFuzzyHighlightPattern(options.content, matchOptions)
            : buildHighlightPattern(parsedQuery)
        }
      } else if (!useFuzzyOrStem) {
        contentRegex = yield* safeRegex(options.content, 'gi')
        highlightRegex = contentRegex
      } else {
        highlightRegex = buildFuzzyHighlightPattern(
          options.content,
          matchOptions,
        )
      }
    }
    return {
      parsedQuery,
      contentRegex,
      highlightRegex,
      matchOptions,
      useFuzzyOrStem,
      queryWords: options.content
        ? options.content
            .toLowerCase()
            .split(/\W+/)
            .filter((word) => word.length > 0)
        : [],
    }
  })

const groupSections = (
  sections: Readonly<Record<string, SectionEntry>>,
): Record<string, SectionEntry[]> => {
  const grouped: Record<string, SectionEntry[]> = {}
  for (const section of Object.values(sections)) {
    grouped[section.documentPath] ??= []
    grouped[section.documentPath]?.push(section)
  }
  return grouped
}

const readSearchDocument = (
  rootPath: string,
  documentPath: string,
): Effect.Effect<Option.Option<string>, never> => {
  const filePath = path.join(rootPath, documentPath)
  return Effect.tryPromise({
    try: () => fs.readFile(filePath, 'utf-8'),
    catch: (cause) =>
      new FileReadError({
        path: filePath,
        message: `Failed to read file: ${filePath}`,
        cause,
      }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning(`Skipping file: ${error.path}`),
    ),
    Effect.option,
  )
}

const findContentMatches = (
  section: SectionEntry,
  sectionLines: readonly string[],
  options: SearchOptions,
  query: PreparedContentQuery,
): ContentMatch[] => {
  const matches: ContentMatch[] = []
  const searchRegex = query.contentRegex || query.highlightRegex
  const contextBefore = options.contextBefore ?? 1
  const contextAfter = options.contextAfter ?? 1

  for (let index = 0; index < sectionLines.length; index++) {
    const line = sectionLines[index]
    if (!line) continue
    let isMatch = false
    if (searchRegex) {
      isMatch = searchRegex.test(line)
      searchRegex.lastIndex = 0
    }
    if (!isMatch && query.useFuzzyOrStem && query.queryWords.length > 0) {
      isMatch =
        findMatchesInLine(query.queryWords, line, query.matchOptions).length > 0
    }
    if (!isMatch) continue

    const snippetStart = Math.max(0, index - contextBefore)
    const snippetEnd = Math.min(sectionLines.length, index + contextAfter + 1)
    const contextLines: ContextLine[] = []
    for (
      let contextIndex = snippetStart;
      contextIndex < snippetEnd;
      contextIndex++
    ) {
      const contextLine = sectionLines[contextIndex]
      if (contextLine !== undefined) {
        contextLines.push({
          lineNumber: section.startLine + contextIndex,
          line: contextLine,
          isMatch: contextIndex === index,
        })
      }
    }
    matches.push({
      lineNumber: section.startLine + index,
      line,
      snippet: sectionLines.slice(snippetStart, snippetEnd).join('\n'),
      contextLines,
    })
  }
  return matches
}

const matchSectionContent = (
  section: SectionEntry,
  document: DocumentEntry,
  fileLines: readonly string[],
  options: SearchOptions,
  query: PreparedContentQuery,
): SearchResult | null => {
  const sectionLines = fileLines.slice(section.startLine - 1, section.endLine)
  const sectionContent = sectionLines.join('\n')
  if (
    query.parsedQuery &&
    !evaluateQuery(query.parsedQuery.ast, sectionContent)
  ) {
    return null
  }
  if (
    query.useFuzzyOrStem &&
    !query.parsedQuery &&
    options.content &&
    !matchesWithOptions(options.content, sectionContent, query.matchOptions)
  ) {
    return null
  }
  const matches = findContentMatches(section, sectionLines, options, query)
  if (!query.parsedQuery && matches.length === 0) return null
  return matches.length > 0
    ? { section, document, sectionContent, matches }
    : { section, document, sectionContent }
}

export const searchContent = (
  rootPath: string,
  options: SearchOptions = {},
): Effect.Effect<
  readonly SearchResult[],
  FileReadError | IndexCorruptedError | CliValidationError
> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath)
    const documentIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)
    if (!documentIndex || !sectionIndex) return []

    const query = yield* prepareContentQuery(options)
    const headingRegex = options.heading
      ? yield* safeRegex(options.heading, 'i')
      : null
    const results: SearchResult[] = []

    for (const [documentPath, sections] of Object.entries(
      groupSections(sectionIndex.sections),
    )) {
      if (
        options.pathPattern &&
        !matchPath(documentPath, options.pathPattern)
      ) {
        continue
      }
      const document = documentIndex.documents[documentPath]
      if (!document) continue

      let fileContent: string | null = null
      let fileLines: string[] = []
      if (
        query.parsedQuery ||
        query.contentRegex ||
        (query.useFuzzyOrStem && options.content)
      ) {
        const readResult = yield* readSearchDocument(
          storage.rootPath,
          documentPath,
        )
        if (Option.isNone(readResult)) continue
        fileContent = readResult.value
        fileLines = fileContent.split('\n')
      }

      for (const section of sections) {
        if (!matchesSectionFilters(section, options, headingRegex)) continue
        let result: SearchResult | null = null
        if (
          (query.parsedQuery || query.contentRegex || query.useFuzzyOrStem) &&
          fileContent
        ) {
          result = matchSectionContent(
            section,
            document,
            fileLines,
            options,
            query,
          )
        } else if (
          !query.parsedQuery &&
          !query.contentRegex &&
          !query.useFuzzyOrStem
        ) {
          result = { section, document }
        }
        if (result) {
          results.push(result)
          if (options.limit !== undefined && results.length >= options.limit) {
            return results
          }
        }
      }
    }
    return results
  })

export const searchWithContent = (
  rootPath: string,
  options: SearchOptions = {},
): Effect.Effect<
  readonly SearchResult[],
  FileReadError | IndexCorruptedError | CliValidationError
> =>
  Effect.gen(function* () {
    const storage = createStorage(rootPath)
    const results = yield* search(rootPath, options)
    const withContent: SearchResult[] = []
    for (const result of results) {
      const filePath = path.join(storage.rootPath, result.section.documentPath)
      const readResult = yield* Effect.tryPromise({
        try: () => fs.readFile(filePath, 'utf-8'),
        catch: (cause) =>
          new FileReadError({
            path: filePath,
            message: `Failed to read file: ${filePath}`,
            cause,
          }),
      }).pipe(
        Effect.tapError((error) =>
          Effect.logWarning(
            `searchWithContent: skipping content for ${error.path}`,
          ),
        ),
        Effect.option,
      )
      if (Option.isSome(readResult)) {
        const lines = readResult.value.split('\n')
        withContent.push({
          ...result,
          sectionContent: lines
            .slice(result.section.startLine - 1, result.section.endLine)
            .join('\n'),
        })
      } else {
        withContent.push(result)
      }
    }
    return withContent
  })
