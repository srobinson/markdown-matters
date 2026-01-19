/**
 * CONTEXT Command
 *
 * Get LLM-ready summary of markdown files.
 */

import * as path from 'node:path'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect } from 'effect'
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
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ files, tokens, brief, full, json, pretty }) =>
    Effect.gen(function* () {
      // Effect CLI Args.repeated returns an array
      const fileList: string[] = Array.isArray(files) ? files : []

      if (fileList.length === 0) {
        yield* Console.log('Error: At least one file is required')
        yield* Console.log('Usage: mdtldr context <file> [files...]')
        return
      }

      // Determine level
      const level = full ? 'full' : brief ? 'brief' : 'summary'

      const firstFile = fileList[0]
      if (fileList.length === 1 && firstFile) {
        // Single file: use summarizeFile
        const filePath = path.resolve(firstFile)
        const summary = yield* summarizeFile(filePath, {
          level: level as 'brief' | 'summary' | 'full',
          maxTokens: tokens,
        })

        if (json) {
          yield* Console.log(formatJson(summary, pretty))
        } else {
          yield* Console.log(formatSummary(summary, { maxTokens: tokens }))
        }
      } else {
        // Multiple files: use assembleContext
        const root = process.cwd()
        const assembled = yield* assembleContext(root, fileList, {
          budget: tokens,
          level: level as 'brief' | 'summary' | 'full',
        })

        if (json) {
          yield* Console.log(formatJson(assembled, pretty))
        } else {
          yield* Console.log(formatAssembledContext(assembled))
        }
      }
    }),
).pipe(Command.withDescription('Get LLM-ready summary'))
