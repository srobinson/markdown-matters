import { readFile } from 'node:fs/promises'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  backlinksSchema,
  type CommandSchema,
  contextSchema,
  duplicatesSchema,
  indexSchema,
  linksSchema,
  searchSchema,
} from './flag-schemas.js'

/**
 * flag-schemas.ts is a second registry of CLI flags used to reject unknown
 * options before @effect/cli parses them. A flag declared only in the command
 * file is silently rejected at runtime (`Unknown option '--x'`), so every
 * Options.* declaration must also appear in the command's schema.
 */

const commandPairs: readonly [CommandSchema, string][] = [
  [searchSchema, 'search.ts'],
  [contextSchema, 'context.ts'],
  [linksSchema, 'links.ts'],
  [backlinksSchema, 'backlinks.ts'],
  [duplicatesSchema, 'duplicates.ts'],
  [indexSchema, 'index-cmd.ts'],
]

const readOptionNames = async (fileName: string): Promise<string[]> => {
  const source = await readFile(
    path.resolve(import.meta.dirname, 'commands', fileName),
    'utf-8',
  )
  return [...source.matchAll(/Options\.(?!with)\w+\('([^']+)'/g)].map(
    (match) => match[1]!,
  )
}

describe('flag schema alignment', () => {
  it.each(commandPairs.map(([schema, file]) => [schema.name, schema, file]))(
    'declares every %s command option in its flag schema',
    async (_name, schema, fileName) => {
      const optionNames = await readOptionNames(fileName as string)
      expect(optionNames.length).toBeGreaterThan(0)
      const declared = new Set(
        (schema as CommandSchema).flags.map((flag) => flag.name),
      )
      const missing = optionNames.filter((name) => !declared.has(name))
      expect(missing).toEqual([])
    },
  )
})
