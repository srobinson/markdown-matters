import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { defaultConfig } from '../config/schema.js'
import {
  createGenerationReadFixture,
  type GenerationReadFixture,
  removeGenerationReadFixture,
  setFixtureCurrent,
} from '../db/generation-read-test-fixture.js'
import {
  handleMdKeywordSearch,
  handleMdm,
  handleMdStructure,
} from './handlers.js'

let fixture: GenerationReadFixture | undefined
let previousHome: string | undefined

afterEach(async () => {
  if (previousHome === undefined) delete process.env.MDM_HOME
  else process.env.MDM_HOME = previousHome
  previousHome = undefined
  if (fixture) await removeGenerationReadFixture(fixture)
  fixture = undefined
})

const resultText = (
  result: Awaited<ReturnType<typeof handleMdKeywordSearch>>,
) =>
  result.content
    .filter(
      (item): item is { type: 'text'; text: string } => item.type === 'text',
    )
    .map(({ text }) => text)
    .join('\n')

it('acquires a fresh generation session for every MCP request', async () => {
  fixture = await createGenerationReadFixture()
  previousHome = process.env.MDM_HOME
  process.env.MDM_HOME = fixture.home

  const first = await handleMdKeywordSearch(
    { heading: 'gen-1', limit: 10 },
    fixture.sourceRoot,
    defaultConfig,
  )
  await setFixtureCurrent(fixture, fixture.gen2)
  const second = await handleMdKeywordSearch(
    { heading: 'gen-2', limit: 10 },
    fixture.sourceRoot,
    defaultConfig,
  )

  expect(resultText(first)).toContain('gen-1-heading-1')
  expect(resultText(first)).not.toContain('gen-2-heading')
  expect(resultText(second)).toContain('gen-2-heading-1')
  expect(resultText(second)).not.toContain('gen-1-heading')
  await expect(
    fs.readdir(path.join(fixture.gen1.root, 'leases', 'open')),
  ).resolves.toEqual([])
  await expect(
    fs.readdir(path.join(fixture.gen2.root, 'leases', 'open')),
  ).resolves.toEqual([])
})

it('leases source handlers for corpus path resolution', () => {
  expect(handleMdm.toString()).toContain('withCurrentGeneration')
  expect(handleMdStructure.toString()).toContain('withCurrentGeneration')
})
