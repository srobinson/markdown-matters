/**
 * DUPLICATES Command
 *
 * Detect and display duplicate content in markdown files.
 */

import * as path from 'node:path'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect, Option } from 'effect'
import type { GenerationReadSession } from '../../db/generation-reader.js'
import {
  type DuplicateDetectionResult,
  detectDuplicates,
} from '../../duplicates/index.js'
import { resolveMdmHome } from '../../home.js'
import { jsonOption, prettyOption } from '../options.js'
import {
  formatJson,
  getIndexInfo,
  renderNoIndexGuidance,
  withCurrentGenerationGuidance,
} from '../utils.js'

const emptyDuplicateResult: DuplicateDetectionResult = {
  groups: [],
  sectionsAnalyzed: 0,
  duplicatePairs: 0,
  sectionsWithDuplicates: 0,
}

const renderDuplicateJson = (
  result: DuplicateDetectionResult,
  pretty: boolean,
): Effect.Effect<void> =>
  Console.log(
    formatJson(
      {
        sectionsAnalyzed: result.sectionsAnalyzed,
        duplicatePairs: result.duplicatePairs,
        sectionsWithDuplicates: result.sectionsWithDuplicates,
        groupCount: result.groups.length,
        groups: result.groups.map((group) => ({
          primary: {
            path: group.primary.documentPath,
            heading: group.primary.heading,
            line: group.primary.startLine,
          },
          duplicates: group.duplicates.map((duplicate) => ({
            path: duplicate.documentPath,
            heading: duplicate.heading,
            line: duplicate.startLine,
          })),
          method: group.method,
          similarity: group.similarity,
        })),
      },
      pretty,
    ),
  )

const renderMissingDuplicateIndex = (
  json: boolean,
  pretty: boolean,
): Effect.Effect<void> =>
  json
    ? renderDuplicateJson(emptyDuplicateResult, pretty)
    : renderNoIndexGuidance(false, pretty)

const withDuplicateGeneration = <A, E>(
  json: boolean,
  pretty: boolean,
  use: (session: GenerationReadSession) => Effect.Effect<A, E>,
) =>
  withCurrentGenerationGuidance(
    resolveMdmHome(),
    json,
    pretty,
    use,
    renderMissingDuplicateIndex,
  )

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
    withDuplicateGeneration(json, pretty, (session) =>
      Effect.gen(function* () {
        const resolvedDir = path.resolve(dirPath)

        // Check for index
        const indexInfo = yield* getIndexInfo(session)

        if (!indexInfo.exists) {
          yield* renderMissingDuplicateIndex(json, pretty)
          return
        }

        // Run duplicate detection
        const result = yield* detectDuplicates(session, resolvedDir, {
          minContentLength: minLength,
          pathPattern: Option.getOrUndefined(pathPattern),
        })

        if (json) {
          yield* renderDuplicateJson(result, pretty)
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
