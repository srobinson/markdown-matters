import * as fs from 'node:fs/promises'
import { Effect } from 'effect'
import { type DocumentKey, resolveSourceFile } from '../../db/canonical.js'

export interface SectionInfo {
  readonly documentPath: DocumentKey
  readonly startLine: number
  readonly endLine: number
}

const contentMatchesAllTerms = (
  content: string,
  terms: readonly string[],
): boolean => {
  const lowerContent = content.toLowerCase()
  return terms.every((term) => lowerContent.includes(term.toLowerCase()))
}

export const filterResultsByRefineTerms = <T>(
  results: readonly T[],
  refineTerms: readonly string[],
  limit: number,
  getSectionInfo: (result: T) => SectionInfo | null,
): Effect.Effect<T[], never> =>
  Effect.gen(function* () {
    if (refineTerms.length === 0 || results.length === 0) {
      return results.slice(0, limit) as T[]
    }

    const fileCache = new Map<DocumentKey, string | null>()
    const getFileContent = (
      documentPath: DocumentKey,
    ): Effect.Effect<string | null, never> =>
      Effect.gen(function* () {
        if (fileCache.has(documentPath)) return fileCache.get(documentPath)!
        const content = yield* Effect.promise(async () => {
          try {
            return await fs.readFile(resolveSourceFile(documentPath), 'utf-8')
          } catch {
            return null
          }
        })
        fileCache.set(documentPath, content)
        return content
      })

    const checkedResults = yield* Effect.all(
      results.map((result) =>
        Effect.gen(function* () {
          const info = getSectionInfo(result)
          if (!info) return null
          const fileContent = yield* getFileContent(info.documentPath)
          if (!fileContent) return null
          const sectionContent = fileContent
            .split('\n')
            .slice(info.startLine - 1, info.endLine)
            .join('\n')
          return contentMatchesAllTerms(sectionContent, refineTerms)
            ? result
            : null
        }),
      ),
      { concurrency: 10 },
    )
    return checkedResults
      .filter((result): result is T => result !== null)
      .slice(0, limit)
  })
