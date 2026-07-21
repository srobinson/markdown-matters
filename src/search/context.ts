import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect, Option } from 'effect'
import { resolveCanonicalPathOrFallback } from '../db/canonical.js'
import type { GenerationReadSession } from '../db/generation-reader.js'
import {
  DocumentNotFoundError,
  FileReadError,
  type IndexCorruptedError,
  IndexNotFoundError,
} from '../errors/index.js'
import { resolveDocumentKeyFromIndex } from '../index/link-index.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../index/storage.js'

export interface ContextOptions {
  readonly maxTokens?: number | undefined
  readonly includeContent?: boolean | undefined
  readonly level?: 'brief' | 'summary' | 'full' | undefined
}

export interface DocumentContext {
  readonly path: string
  readonly title: string
  readonly totalTokens: number
  readonly includedTokens: number
  readonly sections: readonly SectionContext[]
}

export interface SectionContext {
  readonly heading: string
  readonly level: number
  readonly tokens: number
  readonly content?: string | undefined
  readonly hasCode: boolean
  readonly hasList: boolean
  readonly hasTable: boolean
}

export const getContext = (
  session: GenerationReadSession,
  sourceRoot: string,
  filePath: string,
  options: ContextOptions = {},
): Effect.Effect<
  DocumentContext,
  | IndexNotFoundError
  | DocumentNotFoundError
  | FileReadError
  | IndexCorruptedError
> =>
  Effect.gen(function* () {
    const storage = createStorage(sourceRoot, session.indexRoot)
    const resolvedFile = resolveCanonicalPathOrFallback(filePath)
    const relativePath = path.relative(
      resolveCanonicalPathOrFallback(storage.sourceRoot),
      resolvedFile,
    )
    const documentIndex = yield* loadDocumentIndex(storage)
    const sectionIndex = yield* loadSectionIndex(storage)
    if (!documentIndex || !sectionIndex) {
      return yield* Effect.fail(
        new IndexNotFoundError({ path: storage.indexRoot }),
      )
    }

    const documentKey = yield* resolveDocumentKeyFromIndex(
      documentIndex,
      resolvedFile,
    )
    const document = documentKey
      ? documentIndex.documents[documentKey]
      : undefined
    if (!document) {
      return yield* Effect.fail(
        new DocumentNotFoundError({
          path: relativePath,
          indexPath: storage.indexRoot,
        }),
      )
    }

    const includeContent = options.includeContent ?? options.level === 'full'
    let fileContent: string | null = null
    if (includeContent) {
      const readResult = yield* Effect.tryPromise({
        try: () => fs.readFile(resolvedFile, 'utf-8'),
        catch: (cause) =>
          new FileReadError({
            path: resolvedFile,
            message: `Failed to read file: ${resolvedFile}`,
            cause,
          }),
      }).pipe(
        Effect.tapError((error) =>
          Effect.logWarning(
            `getContext: cannot read content for ${error.path}`,
          ),
        ),
        Effect.option,
      )
      if (Option.isSome(readResult)) fileContent = readResult.value
    }

    const sections: SectionContext[] = []
    let includedTokens = 0
    const maxTokens = options.maxTokens ?? Infinity
    const fileLines = fileContent?.split('\n') ?? []
    for (const sectionId of sectionIndex.byDocument[document.id] ?? []) {
      const section = sectionIndex.sections[sectionId]
      if (!section) continue
      if (includedTokens + section.tokenCount > maxTokens) {
        if (options.level === 'brief') continue
        sections.push({
          heading: section.heading,
          level: section.level,
          tokens: section.tokenCount,
          hasCode: section.hasCode,
          hasList: section.hasList,
          hasTable: section.hasTable,
        })
        continue
      }

      includedTokens += section.tokenCount
      const content =
        includeContent && fileContent
          ? fileLines.slice(section.startLine - 1, section.endLine).join('\n')
          : undefined
      sections.push({
        heading: section.heading,
        level: section.level,
        tokens: section.tokenCount,
        content,
        hasCode: section.hasCode,
        hasList: section.hasList,
        hasTable: section.hasTable,
      })
    }

    return {
      path: relativePath,
      title: document.title,
      totalTokens: document.tokenCount,
      includedTokens,
      sections,
    }
  })

export const formatContextForLLM = (context: DocumentContext): string => {
  const lines = [
    `# ${context.title}`,
    `Path: ${context.path}`,
    `Tokens: ${context.includedTokens}/${context.totalTokens}`,
    '',
  ]
  for (const section of context.sections) {
    const metadata: string[] = []
    if (section.hasCode) metadata.push('code')
    if (section.hasList) metadata.push('list')
    if (section.hasTable) metadata.push('table')
    const suffix = metadata.length > 0 ? ` [${metadata.join(', ')}]` : ''
    lines.push(
      `${'#'.repeat(section.level)} ${section.heading}${suffix} (${section.tokens} tokens)`,
    )
    if (section.content) lines.push('', section.content, '')
  }
  return lines.join('\n')
}
