import { describe, expect, it } from 'vitest'

import { indexSummaryLines } from './summary.js'
import type { IndexResult } from './types.js'

const result = (overrides: Partial<IndexResult> = {}): IndexResult => ({
  documentsIndexed: 0,
  sectionsIndexed: 0,
  linksIndexed: 0,
  totalDocuments: 3030,
  totalSections: 48344,
  totalLinks: 681,
  duration: 2448,
  errors: [],
  skipped: { unchanged: 3030, excluded: 91, hidden: 68, total: 3189 },
  ...overrides,
})

describe('indexSummaryLines', () => {
  it('reports corpus totals when a refresh changed nothing', () => {
    // Regression: reporting documentsIndexed alone rendered a no-op as
    // "Indexed 0 documents, 0 sections, 0 links", which reads as failure.
    expect(indexSummaryLines(result())).toEqual([
      'Indexed 3030 documents (0 updated)',
      '  Sections: 48344',
      '  Links: 681',
      '  Duration: 2448ms',
      '  Skipped: 3030 unchanged, 68 hidden, 91 excluded',
    ])
  })

  it('qualifies the headline when only some documents were processed', () => {
    const lines = indexSummaryLines(
      result({
        documentsIndexed: 12,
        skipped: { unchanged: 3018, excluded: 0, hidden: 0, total: 3018 },
      }),
    )
    expect(lines[0]).toBe('Indexed 3030 documents (12 updated)')
    expect(lines.at(-1)).toBe('  Skipped: 3018 unchanged')
  })

  it('drops the qualifier and the skip line for a full fresh build', () => {
    expect(
      indexSummaryLines(
        result({
          documentsIndexed: 3030,
          skipped: { unchanged: 0, excluded: 0, hidden: 0, total: 0 },
        }),
      ),
    ).toEqual([
      'Indexed 3030 documents',
      '  Sections: 48344',
      '  Links: 681',
      '  Duration: 2448ms',
    ])
  })
})
