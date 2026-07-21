/**
 * DUPLICATES Command
 *
 * Detect and display duplicate content in markdown files.
 */

import * as path from 'node:path'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect, Option } from 'effect'
import { detectDuplicates } from '../../duplicates/index.js'
import { resolveMdmHome } from '../../home.js'
import { jsonOption, prettyOption } from '../options.js'
import {
  formatJson,
  getIndexInfo,
  renderNoIndexGuidance,
  withCurrentGenerationGuidance,
} from '../utils.js'

export const duplicatesCommand = Command.make(
  'duplicates',
  {
    path: Args.directory({ name: 'path' }).pipe(
      Args.withDescription('Directory to search for duplicates'),
      Args.withDefault('.'),
    ),
    minLength: Options.integer('min-length').pipe(
      Options.withDescription(
        'Minimum content length (characters) to consider for duplicate detection',
      ),
      Options.withDefault(50),
    ),
    pathPattern: Options.text('path').pipe(
      Options.withAlias('p'),
      Options.withDescription('Filter by document path pattern (glob)'),
      Options.optional,
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ path: dirPath, minLength, pathPattern, json, pretty }) =>
    withCurrentGenerationGuidance(resolveMdmHome(), json, pretty, (session) =>
      Effect.gen(function* () {
        const resolvedDir = path.resolve(dirPath)

        // Check for index
        const indexInfo = yield* getIndexInfo(session)

        if (!indexInfo.exists) {
          yield* renderNoIndexGuidance(json, pretty)
          return
        }

        // Run duplicate detection
        const result = yield* detectDuplicates(session, resolvedDir, {
          minContentLength: minLength,
          pathPattern: Option.getOrUndefined(pathPattern),
        })

        if (json) {
          const output = {
            sectionsAnalyzed: result.sectionsAnalyzed,
            duplicatePairs: result.duplicatePairs,
            sectionsWithDuplicates: result.sectionsWithDuplicates,
            groupCount: result.groups.length,
            groups: result.groups.map((g) => ({
              primary: {
                path: g.primary.documentPath,
                heading: g.primary.heading,
                line: g.primary.startLine,
              },
              duplicates: g.duplicates.map((d) => ({
                path: d.documentPath,
                heading: d.heading,
                line: d.startLine,
              })),
              method: g.method,
              similarity: g.similarity,
            })),
          }
          yield* Console.log(formatJson(output, pretty))
        } else {
          yield* Console.log('Duplicate Content Analysis')
          yield* Console.log('')
          yield* Console.log(`  Sections analyzed: ${result.sectionsAnalyzed}`)
          yield* Console.log(`  Duplicate groups:  ${result.groups.length}`)
          yield* Console.log(`  Duplicate pairs:   ${result.duplicatePairs}`)
          yield* Console.log(
            `  Sections involved: ${result.sectionsWithDuplicates}`,
          )
          yield* Console.log('')

          if (result.groups.length === 0) {
            yield* Console.log('No duplicates found.')
          } else {
            yield* Console.log('Duplicate Groups:')
            yield* Console.log('')

            for (let i = 0; i < result.groups.length; i++) {
              const group = result.groups[i]!
              const methodBadge =
                group.method === 'exact'
                  ? '[exact]'
                  : `[~${Math.round(group.similarity * 100)}%]`

              yield* Console.log(`  Group ${i + 1} ${methodBadge}`)
              yield* Console.log(
                `    ${group.primary.documentPath}:${group.primary.startLine}`,
              )
              yield* Console.log(`      ${group.primary.heading}`)

              for (const dup of group.duplicates) {
                yield* Console.log('')
                yield* Console.log(
                  `    Also in: ${dup.documentPath}:${dup.startLine}`,
                )
                yield* Console.log(`      ${dup.heading}`)
              }
              yield* Console.log('')
            }
          }
        }
      }),
    ),
).pipe(Command.withDescription('Detect duplicate content in markdown files'))
