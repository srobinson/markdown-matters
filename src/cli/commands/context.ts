/**
 * CONTEXT Command
 *
 * Get LLM-ready summary of markdown files.
 */

import * as path from 'node:path'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect } from 'effect'
import {
  CliValidationError,
  FileReadError,
  ParseError,
} from '../../errors/index.js'
import { parseFile } from '../../parser/parser.js'
import {
  buildSectionList,
  extractSectionContent,
  filterExcludedSections,
  formatExtractedSections,
  formatSectionList,
} from '../../parser/section-filter.js'
import {
  assembleContext,
  formatAssembledContext,
  formatSummary,
  summarizeFile,
} from '../../summarize/summarizer.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson } from '../utils.js'

export const contextCommand = Command.make(
  'context',
  {
    files: Args.file({ name: 'files' }).pipe(
      Args.withDescription('Markdown file(s) to summarize'),
      Args.repeated,
    ),
    tokens: Options.integer('tokens').pipe(
      Options.withAlias('t'),
      Options.withDescription('Token budget'),
      Options.withDefault(2000),
    ),
    brief: Options.boolean('brief').pipe(
      Options.withDescription('Minimal output'),
      Options.withDefault(false),
    ),
    full: Options.boolean('full').pipe(
      Options.withDescription('Include full content'),
      Options.withDefault(false),
    ),
    section: Options.text('section').pipe(
      Options.withAlias('S'),
      Options.withDescription(
        'Filter by section name, number (e.g., "5.3"), or glob pattern (e.g., "Memory*")',
      ),
      Options.optional,
    ),
    sections: Options.boolean('sections').pipe(
      Options.withDescription('List available sections'),
      Options.withDefault(false),
    ),
    shallow: Options.boolean('shallow').pipe(
      Options.withDescription('Exclude nested subsections when filtering'),
      Options.withDefault(false),
    ),
    exclude: Options.text('exclude').pipe(
      Options.withAlias('x'),
      Options.withDescription(
        'Exclude sections matching pattern (can be used multiple times)',
      ),
      Options.repeated,
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({
    files,
    tokens,
    brief,
    full,
    section,
    sections,
    shallow,
    exclude,
    json,
    pretty,
  }) =>
    Effect.gen(function* () {
      // Effect CLI Args.repeated returns an array
      const fileList: string[] = Array.isArray(files) ? files : []

      if (fileList.length === 0) {
        yield* Effect.fail(
          new CliValidationError({
            message:
              'At least one file is required. Usage: mdcontext context <file> [files...]',
            argument: 'files',
          }),
        )
      }

      // Get section option value (it's an Option type)
      const sectionSelector =
        section._tag === 'Some' ? section.value : undefined

      // Extract exclusion patterns (repeated option returns array)
      const excludePatterns: string[] = Array.isArray(exclude) ? exclude : []

      // Handle --sections flag: list available sections
      if (sections) {
        for (const file of fileList) {
          const filePath = path.resolve(file)
          const document = yield* parseFile(filePath).pipe(
            Effect.mapError((e) =>
              e._tag === 'ParseError'
                ? new ParseError({
                    message: e.message,
                    path: filePath,
                    ...(e.line !== undefined && { line: e.line }),
                    ...(e.column !== undefined && { column: e.column }),
                  })
                : new FileReadError({
                    path: e.path,
                    message: e.message,
                  }),
            ),
          )

          let sectionList = buildSectionList(document)

          // Apply exclusion filter if patterns provided
          if (excludePatterns.length > 0) {
            sectionList = filterExcludedSections(sectionList, excludePatterns)
          }

          if (json) {
            const output = {
              path: filePath,
              title: document.title,
              ...(excludePatterns.length > 0 && {
                excludePatterns,
              }),
              sections: sectionList.map((s) => ({
                number: s.number,
                heading: s.heading,
                level: s.level,
                tokens: s.tokenCount,
              })),
            }
            yield* Console.log(formatJson(output, pretty))
          } else {
            yield* Console.log(`# ${document.title}`)
            yield* Console.log(`Path: ${filePath}`)
            if (excludePatterns.length > 0) {
              yield* Console.log(
                `Excluded: ${excludePatterns.map((p) => `"${p}"`).join(', ')}`,
              )
            }
            yield* Console.log('')
            yield* Console.log('Available sections:')
            yield* Console.log(formatSectionList(sectionList))
          }
        }
        return
      }

      // Handle --section flag: extract specific section(s)
      if (sectionSelector) {
        for (const file of fileList) {
          const filePath = path.resolve(file)
          const document = yield* parseFile(filePath).pipe(
            Effect.mapError((e) =>
              e._tag === 'ParseError'
                ? new ParseError({
                    message: e.message,
                    path: filePath,
                    ...(e.line !== undefined && { line: e.line }),
                    ...(e.column !== undefined && { column: e.column }),
                  })
                : new FileReadError({
                    path: e.path,
                    message: e.message,
                  }),
            ),
          )

          const {
            sections: extractedSections,
            matchedNumbers,
            excludedNumbers,
          } = extractSectionContent(document, sectionSelector, {
            shallow,
            exclude: excludePatterns,
          })

          if (extractedSections.length === 0) {
            yield* Console.error(
              `No sections found matching "${sectionSelector}" in ${file}`,
            )
            if (excludedNumbers.length > 0) {
              yield* Console.error(
                `(${excludedNumbers.length} section(s) were excluded by --exclude patterns)`,
              )
            }
            yield* Console.error('Use --sections to list available sections.')
            continue
          }

          if (json) {
            const output = {
              path: filePath,
              title: document.title,
              selector: sectionSelector,
              shallow,
              ...(excludePatterns.length > 0 && { excludePatterns }),
              matchedSections: matchedNumbers,
              ...(excludedNumbers.length > 0 && {
                excludedSections: excludedNumbers,
              }),
              content: formatExtractedSections(extractedSections),
              sections: extractedSections.map((s) => ({
                heading: s.heading,
                level: s.level,
                tokens: s.metadata.tokenCount,
              })),
            }
            yield* Console.log(formatJson(output, pretty))
          } else {
            yield* Console.log(`# ${document.title}`)
            yield* Console.log(`Path: ${filePath}`)
            yield* Console.log(`Sections: ${matchedNumbers.join(', ')}`)
            if (excludedNumbers.length > 0) {
              yield* Console.log(
                `Excluded: ${excludedNumbers.join(', ')} (by --exclude patterns)`,
              )
            }
            yield* Console.log('')
            yield* Console.log(formatExtractedSections(extractedSections))
          }
        }
        return
      }

      // Determine level
      const level = full ? 'full' : brief ? 'brief' : 'summary'

      // When --full is specified, disable token truncation
      const effectiveMaxTokens = full ? undefined : tokens

      const firstFile = fileList[0]
      if (fileList.length === 1 && firstFile) {
        // Single file: use summarizeFile
        const filePath = path.resolve(firstFile)
        const summary = yield* summarizeFile(filePath, {
          level: level as 'brief' | 'summary' | 'full',
          maxTokens: effectiveMaxTokens,
          exclude: excludePatterns.length > 0 ? excludePatterns : undefined,
        })

        if (json) {
          yield* Console.log(formatJson(summary, pretty))
        } else {
          yield* Console.log(
            formatSummary(summary, { maxTokens: effectiveMaxTokens }),
          )
        }
      } else {
        // Multiple files: use assembleContext
        // Note: assembleContext always requires a budget; use large number for --full
        const root = process.cwd()
        const assembled = yield* assembleContext(root, fileList, {
          budget: full ? Number.MAX_SAFE_INTEGER : tokens,
          level: level as 'brief' | 'summary' | 'full',
          exclude: excludePatterns.length > 0 ? excludePatterns : undefined,
        })

        if (json) {
          yield* Console.log(formatJson(assembled, pretty))
        } else {
          yield* Console.log(formatAssembledContext(assembled))
        }
      }
    }),
).pipe(Command.withDescription('Get LLM-ready summary'))
