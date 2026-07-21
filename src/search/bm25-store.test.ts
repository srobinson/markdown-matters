import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect, Exit } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentKey } from '../db/canonical.js'
import { createBM25Store } from './bm25-store.js'

const roots: string[] = []

const createRoot = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-bm25-schema-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

describe('BM25 canonical schema', () => {
  it('consolidates a one-section corpus without exposing engine padding', async () => {
    const root = await createRoot()
    const documentPath = path.join(root, 'README.md') as DocumentKey
    const writer = createBM25Store(root)
    await Effect.runPromise(
      writer.add([
        {
          id: 'only-section',
          sectionId: 'only-section',
          documentPath,
          heading: 'Small corpus',
          content: 'singular searchable content',
        },
      ]),
    )
    await Effect.runPromise(writer.consolidate())
    await Effect.runPromise(writer.save())

    const reader = createBM25Store(root)
    expect(await Effect.runPromise(reader.load())).toBe(true)
    expect(reader.getStats().count).toBe(1)
    expect(await Effect.runPromise(reader.search('singular'))).toEqual([
      expect.objectContaining({ sectionId: 'only-section', documentPath }),
    ])
  })

  it('persists version 2 canonical document paths', async () => {
    const root = await createRoot()
    const documentPath = path.join(root, 'README.md') as DocumentKey
    const writer = createBM25Store(root)
    await Effect.runPromise(
      writer.add(
        Array.from({ length: 3 }, (_, index) => ({
          id: `section-${index}`,
          sectionId: `section-${index}`,
          documentPath,
          heading: `Readme ${index}`,
          content: `canonical persistence test content ${index}`,
        })),
      ),
    )
    await Effect.runPromise(writer.consolidate())
    await Effect.runPromise(writer.save())

    const data = JSON.parse(
      await fs.readFile(path.join(root, 'bm25.json'), 'utf-8'),
    )
    expect(data.version).toBe(2)
    expect(
      data.sectionMap.every(([, info]: [number, { documentPath: string }]) =>
        path.isAbsolute(info.documentPath),
      ),
    ).toBe(true)
    await expect(Effect.runPromise(createBM25Store(root).load())).resolves.toBe(
      true,
    )
  })

  it('rejects a relative document path in the persisted section map', async () => {
    const root = await createRoot()
    const writer = createBM25Store(root)
    await Effect.runPromise(
      writer.add(
        Array.from({ length: 3 }, (_, index) => ({
          id: `section-${index}`,
          sectionId: `section-${index}`,
          documentPath: 'README.md' as DocumentKey,
          heading: `Readme ${index}`,
          content: `canonical persistence test content ${index}`,
        })),
      ),
    )
    await Effect.runPromise(writer.consolidate())
    await Effect.runPromise(writer.save())

    const exit = await Effect.runPromise(
      Effect.exit(createBM25Store(root).load()),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
