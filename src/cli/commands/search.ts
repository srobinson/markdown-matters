/**
 * SEARCH Command
 *
 * Search markdown content by meaning or heading pattern.
 */

import * as path from 'node:path'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect, Option } from 'effect'
import { semanticSearch } from '../../embeddings/semantic-search.js'
import { search, searchContent } from '../../search/searcher.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson, hasEmbeddings, isRegexPattern } from '../utils.js'

export const searchCommand = Command.make(
  'search',
  {
    query: Args.text({ name: 'query' }).pipe(
      Args.withDescription('Search query (natural language or regex pattern)'),
    ),
    path: Args.directory({ name: 'path' }).pipe(
      Args.withDescription('Directory to search in'),
      Args.withDefault('.'),
    ),
    structural: Options.boolean('structural').pipe(
      Options.withAlias('s'),
      Options.withDescription('Force structural search (headings only)'),
      Options.withDefault(false),
    ),
    headingOnly: Options.boolean('heading-only').pipe(
      Options.withAlias('H'),
      Options.withDescription('Search headings only (not content)'),
      Options.withDefault(false),
    ),
    mode: Options.choice('mode', ['semantic', 'structural']).pipe(
      Options.withAlias('m'),
      Options.withDescription('Force search mode: semantic or structural'),
      Options.optional,
    ),
    limit: Options.integer('limit').pipe(
      Options.withAlias('n'),
      Options.withDescription('Maximum results'),
      Options.withDefault(10),
    ),
    threshold: Options.float('threshold').pipe(
      Options.withDescription('Similarity threshold for semantic search (0-1)'),
      Options.withDefault(0.5),
    ),
    context: Options.integer('context').pipe(
      Options.withAlias('C'),
      Options.withDescription(
        'Lines of context around matches (like grep -C)',
      ),
      Options.optional,
    ),
    beforeContext: Options.integer('before-context').pipe(
      Options.withAlias('B'),
      Options.withDescription(
        'Lines of context before matches (like grep -B)',
      ),
      Options.optional,
    ),
    afterContext: Options.integer('after-context').pipe(
      Options.withAlias('A'),
      Options.withDescription('Lines of context after matches (like grep -A)'),
      Options.optional,
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({
    query,
    path: dirPath,
    structural,
    headingOnly,
    mode,
    limit,
    threshold,
    context,
    beforeContext,
    afterContext,
    json,
    pretty,
  }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dirPath)

      // Check for embeddings
      const embedsExist = yield* Effect.promise(() =>
        hasEmbeddings(resolvedDir),
      )

      // Determine search mode
      // Priority: --mode flag > --structural flag > regex pattern > embeddings availability
      let useStructural: boolean
      let modeReason: string

      const modeValue = Option.getOrUndefined(mode)

      if (modeValue === 'semantic') {
        if (!embedsExist) {
          yield* Effect.fail(
            new Error(
              'Semantic search requires embeddings. Run "mdtldr index --embed" first.',
            ),
          )
        }
        useStructural = false
        modeReason = '--mode semantic'
      } else if (modeValue === 'structural') {
        useStructural = true
        modeReason = '--mode structural'
      } else if (structural) {
        useStructural = true
        modeReason = '--structural flag'
      } else if (isRegexPattern(query)) {
        useStructural = true
        modeReason = 'regex pattern detected'
      } else if (!embedsExist) {
        useStructural = true
        modeReason = 'no embeddings'
      } else {
        useStructural = false
        modeReason = 'embeddings available'
      }

      const modeIndicator = useStructural ? '[structural]' : '[semantic]'

      // Calculate context lines
      // -C sets both before and after; -B and -A override individual sides
      const contextValue = Option.getOrUndefined(context)
      const beforeValue = Option.getOrUndefined(beforeContext)
      const afterValue = Option.getOrUndefined(afterContext)

      const contextBefore = beforeValue ?? contextValue ?? 1
      const contextAfter = afterValue ?? contextValue ?? 1

      if (useStructural) {
        // Structural search - content by default, heading-only if flag set
        const results = headingOnly
          ? yield* search(resolvedDir, { heading: query, limit })
          : yield* searchContent(resolvedDir, {
              content: query,
              limit,
              contextBefore,
              contextAfter,
            })

        if (json) {
          const output = {
            mode: 'structural',
            modeReason,
            query,
            contextBefore,
            contextAfter,
            results: results.map((r) => ({
              path: r.section.documentPath,
              heading: r.section.heading,
              level: r.section.level,
              tokens: r.section.tokenCount,
              line: r.section.startLine,
              matches: r.matches?.map((m) => ({
                lineNumber: m.lineNumber,
                line: m.line,
                contextLines: m.contextLines,
              })),
            })),
          }
          yield* Console.log(formatJson(output, pretty))
        } else {
          const searchType = headingOnly ? 'Heading' : 'Content'
          yield* Console.log(
            `${modeIndicator} ${searchType} search: "${query}"`,
          )
          yield* Console.log(`Results: ${results.length}`)
          yield* Console.log('')

          for (const result of results) {
            const levelMarker = '#'.repeat(result.section.level)
            yield* Console.log(
              `  ${result.section.documentPath}:${result.section.startLine}`,
            )
            yield* Console.log(
              `    ${levelMarker} ${result.section.heading} (${result.section.tokenCount} tokens)`,
            )

            // Show match snippets with line numbers
            if (result.matches && result.matches.length > 0) {
              yield* Console.log('')
              for (const match of result.matches.slice(0, 3)) {
                // Show first 3 matches per section
                // Use contextLines for formatted output with line numbers
                if (match.contextLines && match.contextLines.length > 0) {
                  for (const ctxLine of match.contextLines) {
                    const marker = ctxLine.isMatch ? '>' : ' '
                    yield* Console.log(
                      `  ${marker} ${ctxLine.lineNumber}: ${ctxLine.line}`,
                    )
                  }
                } else {
                  // Fallback to simple snippet display
                  yield* Console.log(`    Line ${match.lineNumber}:`)
                  const snippetLines = match.snippet.split('\n')
                  for (const line of snippetLines) {
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
        }
      } else {
        // Semantic search
        const results = yield* semanticSearch(resolvedDir, query, {
          limit,
          threshold,
        })

        if (json) {
          const output = {
            mode: 'semantic',
            modeReason,
            query,
            results,
          }
          yield* Console.log(formatJson(output, pretty))
        } else {
          yield* Console.log(`${modeIndicator} Semantic search: "${query}"`)
          yield* Console.log(`Results: ${results.length}`)
          yield* Console.log('')

          for (const result of results) {
            const similarity = (result.similarity * 100).toFixed(1)
            yield* Console.log(`  ${result.documentPath}`)
            yield* Console.log(`    ${result.heading} (${similarity}% match)`)
            yield* Console.log('')
          }
        }
      }
    }),
).pipe(Command.withDescription('Search by meaning or structure'))
