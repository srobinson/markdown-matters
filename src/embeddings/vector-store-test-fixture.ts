import * as path from 'node:path'
import { Effect } from 'effect'
import type { DocumentKey } from '../db/canonical.js'
import { writeActiveProvider } from './embedding-namespace-catalog.js'
import { generateNamespace } from './embedding-namespace-paths.js'
import type { VectorEntry } from './types.js'
import { createNamespacedVectorStore } from './vector-store.js'

const makeVector = (seed: number, dimensions: number): number[] => {
  const values = Array.from(
    { length: dimensions },
    (_, index) => 1 + Math.sin(seed * (index + 1)) * 0.25,
  )
  const magnitude = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0),
  )
  return values.map((value) => value / magnitude)
}

export const seedFreshVectorFixture = async ({
  indexRoot,
  provider,
  model,
  dimensions,
}: {
  readonly indexRoot: string
  readonly provider: string
  readonly model: string
  readonly dimensions: number
}): Promise<void> => {
  const store = createNamespacedVectorStore(
    indexRoot,
    provider,
    model,
    dimensions,
  )
  store.setProvider(provider, model)
  const entries: VectorEntry[] = Array.from({ length: 12 }, (_, index) => ({
    id: `vector-${index}`,
    sectionId: `section-${index}`,
    documentPath: path.resolve(
      indexRoot,
      `document-${index}.md`,
    ) as DocumentKey,
    heading: `Document ${index}`,
    embedding: makeVector(index + 1, dimensions),
  }))
  await Effect.runPromise(store.add(entries))
  await Effect.runPromise(store.save())
  await Effect.runPromise(
    writeActiveProvider(indexRoot, {
      namespace: generateNamespace(provider, model, dimensions),
      provider,
      model,
      dimensions,
      activatedAt: new Date().toISOString(),
    }),
  )
}
