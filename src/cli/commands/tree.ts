/**
 * TREE Command
 *
 * Show file tree or document outline.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { Args, Command } from '@effect/cli'
import { Console, Effect } from 'effect'
import type { MdSection } from '../../core/types.js'
import { FileReadError, ParseError } from '../../errors/index.js'
import { parseFile } from '../../parser/parser.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson, walkDirEffect } from '../utils.js'

export const treeCommand = Command.make(
  'tree',
  {
    pathArg: Args.text({ name: 'path' }).pipe(
      Args.withDescription('Directory (shows files) or file (shows outline)'),
      Args.withDefault('.'),
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ pathArg, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedPath = path.resolve(pathArg)

      // Auto-detect: file or directory
      const stat = yield* Effect.try({
        try: () => fs.statSync(resolvedPath),
        catch: (e) =>
          new FileReadError({
            path: resolvedPath,
            message: `Cannot access path: ${e instanceof Error ? e.message : String(e)}`,
            cause: e,
          }),
      })

      if (stat.isFile()) {
        // Show document outline
        const result = yield* parseFile(resolvedPath).pipe(
          Effect.mapError((e) =>
            e._tag === 'ParseError'
              ? new ParseError({
                  message: e.message,
                  path: resolvedPath,
                  ...(e.line !== undefined && { line: e.line }),
                  ...(e.column !== undefined && { column: e.column }),
                })
              : new FileReadError({
                  path: e.path,
                  message: e.message,
                }),
          ),
        )

        const extractStructure = (
          section: MdSection,
        ): {
          heading: string
          level: number
          tokens: number
          children: unknown[]
        } => ({
          heading: section.heading,
          level: section.level,
          tokens: section.metadata.tokenCount,
          children: section.children.map(extractStructure),
        })

        if (json) {
          const structure = {
            title: result.title,
            path: result.path,
            totalTokens: result.metadata.tokenCount,
            sections: result.sections.map(extractStructure),
          }
          yield* Console.log(formatJson(structure, pretty))
        } else {
          yield* Console.log(`# ${result.title}`)
          yield* Console.log(`Total tokens: ${result.metadata.tokenCount}`)
          yield* Console.log('')

          const printOutline = (
            section: MdSection,
            depth: number = 0,
          ): Effect.Effect<void> =>
            Effect.gen(function* () {
              const indent = '  '.repeat(depth)
              const marker = '#'.repeat(section.level)
              yield* Console.log(
                `${indent}${marker} ${section.heading} [${section.metadata.tokenCount} tokens]`,
              )
              for (const child of section.children) {
                yield* printOutline(child, depth + 1)
              }
            })

          for (const section of result.sections) {
            yield* printOutline(section)
          }
        }
      } else {
        // Show file list with line counts
        const files = yield* walkDirEffect(resolvedPath)

        const tree = [...files].map((f) => {
          let lines = 0
          try {
            const content = fs.readFileSync(f, 'utf-8')
            lines = content.split('\n').length
          } catch {
            // If file can't be read, default to 0 lines
          }
          return {
            path: f,
            relativePath: path.relative(resolvedPath, f),
            lines,
          }
        })

        // Sort by line count descending
        tree.sort((a, b) => b.lines - a.lines)

        const totalLines = tree.reduce((sum, f) => sum + f.lines, 0)

        if (json) {
          yield* Console.log(formatJson(tree, pretty))
        } else {
          yield* Console.log(`Markdown files in ${resolvedPath}:`)
          yield* Console.log('')

          // Right-align line counts
          const maxPathLen = Math.max(
            ...tree.map((f) => f.relativePath.length),
          )
          for (const file of tree) {
            const padding = ' '.repeat(maxPathLen - file.relativePath.length + 2)
            yield* Console.log(
              `  ${file.relativePath}${padding}${String(file.lines).padStart(6)} lines`,
            )
          }
          yield* Console.log('')
          yield* Console.log(
            `Total: ${tree.length} files, ${totalLines} lines`,
          )
        }
      }
    }),
).pipe(Command.withDescription('Show files or document outline'))
