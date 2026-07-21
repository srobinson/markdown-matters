import * as fs from 'node:fs/promises'
import { expect, it } from 'vitest'

const readCommand = (name: string): Promise<string> =>
  fs.readFile(new URL(`./commands/${name}.ts`, import.meta.url), 'utf8')

it('acquires one read session at each database command boundary', async () => {
  const databaseCommands = await Promise.all(
    ['search', 'links', 'backlinks', 'duplicates', 'stats'].map(readCommand),
  )
  for (const source of databaseCommands) {
    expect(source.match(/withCurrentGenerationGuidance\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/withCurrentGeneration\(/)
  }
  const embeddings = await readCommand('embeddings')
  expect(embeddings.match(/withCurrentGenerationGuidance\(/g)).toHaveLength(2)
  expect(embeddings).not.toMatch(/withCurrentGeneration\(/)
  expect(embeddings).not.toMatch(/Command\.make\('(switch|remove)'/)

  const utilities = await fs.readFile(
    new URL('./utils.ts', import.meta.url),
    'utf8',
  )
  expect(utilities.match(/withCurrentGeneration\(/g)).toHaveLength(1)
  expect(utilities.match(/error instanceof GenerationReadError/g)).toHaveLength(
    1,
  )
})

it('does not lease source-only commands', async () => {
  const sourceOnlyCommands = await Promise.all(
    ['tree', 'context'].map(readCommand),
  )
  expect(sourceOnlyCommands.join('\n')).not.toContain('withCurrentGeneration')
  expect(sourceOnlyCommands.join('\n')).not.toContain(
    'withCurrentGenerationGuidance',
  )
})

it('passes one CLI search scope through every search channel', async () => {
  const source = await readCommand('search-mode')
  expect(
    source.match(/\.\.\.pathScopeOptions\(context\.pathPattern\)/g),
  ).toHaveLength(4)
})
