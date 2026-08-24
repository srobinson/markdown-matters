/**
 * One phrasing of an index run, shared by every surface that reports it.
 *
 * `documentsIndexed` counts documents this run processed, not the corpus.
 * Reporting it alone makes a refresh that changed nothing read as
 * "0 documents", which looks like a failed run rather than a no-op. The
 * corpus totals lead; what the run touched is the qualifier.
 */

import type { IndexResult } from './types.js'

const formatSkipped = (result: IndexResult): string | undefined => {
  if (result.skipped.total === 0) return undefined

  const parts: string[] = []
  if (result.skipped.unchanged > 0) {
    parts.push(`${result.skipped.unchanged} unchanged`)
  }
  if (result.skipped.hidden > 0) parts.push(`${result.skipped.hidden} hidden`)
  if (result.skipped.excluded > 0) {
    parts.push(`${result.skipped.excluded} excluded`)
  }
  return parts.length > 0 ? `Skipped: ${parts.join(', ')}` : undefined
}

/**
 * Summary lines for an index run, headline first and details indented.
 * Callers print them line by line or join them, and never re-derive the
 * wording.
 */
export const indexSummaryLines = (result: IndexResult): readonly string[] => {
  const updated =
    result.documentsIndexed < result.totalDocuments
      ? ` (${result.documentsIndexed} updated)`
      : ''
  const skipped = formatSkipped(result)

  return [
    `Indexed ${result.totalDocuments} documents${updated}`,
    `  Sections: ${result.totalSections}`,
    `  Links: ${result.totalLinks}`,
    `  Duration: ${result.duration}ms`,
    ...(skipped === undefined ? [] : [`  ${skipped}`]),
  ]
}
