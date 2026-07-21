import * as fs from 'node:fs/promises'
import { expect, it } from 'vitest'

const readCommand = (name: string): Promise<string> =>
  fs.readFile(new URL(`./commands/${name}.ts`, import.meta.url), 'utf8')

it('acquires one read session at each database command boundary', async () => {
  const databaseCommands = await Promise.all(
    ['search', 'links', 'backlinks', 'duplicates', 'stats'].map(readCommand),
  )
  for (const source of databaseCommands) {
    expect(source.match(/withCurrentGeneration\(/g)).toHaveLength(1)
  }
  const embeddings = await readCommand('embeddings')
  expect(embeddings.match(/withCurrentGeneration\(/g)).toHaveLength(2)
  expect(embeddings).not.toMatch(/Command\.make\('(switch|remove)'/)
})

it('does not lease source-only commands', async () => {
  const sourceOnlyCommands = await Promise.all(
    ['tree', 'context'].map(readCommand),
  )
  expect(sourceOnlyCommands.join('\n')).not.toContain('withCurrentGeneration')
})
