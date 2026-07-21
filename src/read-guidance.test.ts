import { describe, expect, it } from 'vitest'

import {
  buildEmptySearchGuidance,
  type CorpusInspection,
  formatReadGuidance,
} from './read-guidance.js'

const inspection = (
  documentCount: number,
  pathFilterDocumentCount: number,
): CorpusInspection => ({
  documentCount,
  pathFilterDocumentCount,
  roots: ['/docs'],
  examplePaths: ['/docs/example.md'],
})

describe('read guidance count grammar', () => {
  it('uses singular grammar for a one document corpus', () => {
    expect(
      formatReadGuidance(
        buildEmptySearchGuidance(inspection(1, 1), 'missing', undefined),
      ),
    ).toBe('no matches for "missing" across 1 indexed document')
  })

  it('uses singular grammar for one document matching a filter', () => {
    expect(
      formatReadGuidance(
        buildEmptySearchGuidance(inspection(2, 1), 'missing', '*.md'),
      ),
    ).toBe(
      'no matches for "missing" among the 1 document matching your path_filter',
    )
  })

  it('uses singular grammar for a filter miss against one document', () => {
    expect(
      formatReadGuidance(
        buildEmptySearchGuidance(inspection(1, 0), 'missing', '*.md'),
      ),
    ).toBe(
      'path_filter matched 0 of 1 document. Corpus paths look like: /docs/example.md. Corpus roots: [/docs].',
    )
  })
})
