/**
 * BACKLINKS Command
 *
 * Show what links to a file (incoming links).
 */

import * as path from 'node:path'
import { Args, Command, Options } from '@effect/cli'
import { Console, Effect } from 'effect'
import {
  getIncomingLinks,
  resolveIndexedDocumentKey,
} from '../../index/indexer.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson } from '../utils.js'

export const backlinksCommand = Command.make(
  'backlinks',
  {
    file: Args.file({ name: 'file' }).pipe(
      Args.withDescription('Markdown file to find references to'),
    ),
    root: Options.directory('root').pipe(
      Options.withAlias('r'),
      Options.withDescription('Root directory for resolving relative links'),
      Options.withDefault('.'),
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ file, root, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedRoot = path.resolve(root)
      const resolvedFile = path.resolve(file)

      const links = yield* getIncomingLinks(resolvedRoot, resolvedFile)
      const documentKey =
        (yield* resolveIndexedDocumentKey(resolvedRoot, resolvedFile)) ??
        resolvedFile

      if (json) {
        yield* Console.log(
          formatJson({ file: documentKey, backlinks: links }, pretty),
        )
      } else {
        yield* Console.log(`Incoming links to ${documentKey}:`)
        yield* Console.log('')
        if (links.length === 0) {
          yield* Console.log('  (none)')
        } else {
          for (const link of links) {
            yield* Console.log(`  <- ${link}`)
          }
        }
        yield* Console.log('')
        yield* Console.log(`Total: ${links.length} backlinks`)
      }
    }),
).pipe(Command.withDescription('What links to this?'))
