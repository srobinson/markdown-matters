export interface CorpusInspection {
  readonly documentCount: number
  readonly pathFilterDocumentCount: number
  readonly roots: readonly string[]
  readonly examplePaths: readonly string[]
}

export const FIRST_RUN_GUIDANCE = {
  error: 'No index found.',
  guidance: 'Run: mdm index /path/to/docs',
  hint: 'Add --embed for semantic search capabilities',
} as const

export type ReadGuidance =
  | { readonly cause: 'corpus' }
  | {
      readonly cause: 'filter'
      readonly inspection: CorpusInspection
    }
  | {
      readonly cause: 'query'
      readonly inspection: CorpusInspection
      readonly query: string
      readonly scope: 'corpus' | 'path-filter'
    }
  | {
      readonly cause: 'out-of-corpus'
      readonly inspection: CorpusInspection
      readonly path: string
    }

export const buildEmptySearchGuidance = (
  inspection: CorpusInspection,
  query: string,
  pathFilter: string | undefined,
): ReadGuidance => {
  if (inspection.documentCount === 0) return { cause: 'corpus' }
  if (pathFilter !== undefined && inspection.pathFilterDocumentCount === 0) {
    return { cause: 'filter', inspection }
  }
  return {
    cause: 'query',
    inspection,
    query,
    scope: pathFilter === undefined ? 'corpus' : 'path-filter',
  }
}

export const buildOutOfCorpusGuidance = (
  inspection: CorpusInspection,
  filePath: string,
): ReadGuidance =>
  inspection.documentCount === 0
    ? { cause: 'corpus' }
    : { cause: 'out-of-corpus', inspection, path: filePath }

const formatList = (values: readonly string[]): string =>
  `[${values.join(', ')}]`

export const formatFirstRunGuidance = (): string =>
  `${FIRST_RUN_GUIDANCE.error}\n\n${FIRST_RUN_GUIDANCE.guidance}\n  ${FIRST_RUN_GUIDANCE.hint}`

export const formatReadGuidance = (guidance: ReadGuidance): string => {
  if (guidance.cause === 'corpus') return formatFirstRunGuidance()
  if (guidance.cause === 'filter') {
    const { inspection } = guidance
    return `path_filter matched 0 of ${inspection.documentCount} documents. Corpus paths look like: ${inspection.examplePaths.join(', ')}. Corpus roots: ${formatList(inspection.roots)}.`
  }
  if (guidance.cause === 'query') {
    if (guidance.scope === 'path-filter') {
      return `no matches for "${guidance.query}" among the ${guidance.inspection.pathFilterDocumentCount} documents matching your path_filter`
    }
    return `no matches for "${guidance.query}" across ${guidance.inspection.documentCount} indexed documents`
  }
  return `Path not in indexed corpus: ${guidance.path}; use an indexed path like ${formatList(guidance.inspection.examplePaths)}; corpus roots: ${formatList(guidance.inspection.roots)}`
}
