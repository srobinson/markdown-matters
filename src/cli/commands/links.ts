/**
 * LINKS Command
 *
 * Show what a file links to (outgoing links).
 */

import * as path from 'node:path'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect } from 'effect'
import { resolveMdmHome } from '../../home.js'
import {
  getOutgoingLinks,
  resolveIndexedDocumentKey,
} from '../../index/indexer.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson, withCurrentGenerationGuidance } from '../utils.js'

export const linksCommand = Command.make(
  'links',
  {
    file: Args.file({ name: 'file' }).pipe(
      Args.withDescription('Markdown file to analyze'),
    ),
    root: Options.directory('root').pipe(
      Options.withAlias('r'),
      Options.withDescription('Root directory for resolving relative links'),
      Options.withDefault('.'),
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ file, root: _root, json, pretty }) =>
    withCurrentGenerationGuidance(resolveMdmHome(), json, pretty, (session) =>
      Effect.gen(function* () {
        const resolvedFile = path.resolve(file)

        const links = yield* getOutgoingLinks(session, resolvedFile)
        const documentKey =
          (yield* resolveIndexedDocumentKey(session, resolvedFile)) ??
          resolvedFile

        if (json) {
          yield* Console.log(formatJson({ file: documentKey, links }, pretty))
        } else {
          yield* Console.log(`Outgoing links from ${documentKey}:`)
          yield* Console.log('')
          if (links.length === 0) {
            yield* Console.log('  (none)')
          } else {
            for (const link of links) {
              yield* Console.log(`  -> ${link}`)
            }
          }
          yield* Console.log('')
          yield* Console.log(`Total: ${links.length} links`)
        }
      }),
    ),
).pipe(Command.withDescription('What does this link to?'))
