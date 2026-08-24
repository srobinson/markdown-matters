/**
 * Unlinked mention scan.
 *
 * For a document with no inbound links, find plain-text occurrences of its
 * filename across the indexed corpus: references in tables, prose, or broken
 * links that never became link edges.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { Effect } from 'effect'

import type { DocumentKey } from '../db/canonical.js'
import type { GenerationReadSession } from '../db/generation-reader.js'
import type { FileReadError, IndexCorruptedError } from '../errors/index.js'
import { resolveDocumentKeyFromIndex } from './link-index.js'
import { createStorage, loadDocumentIndex } from './storage.js'

export interface UnlinkedMention {
  readonly path: DocumentKey
  readonly line: number
  readonly text: string
}

const MENTION_EXCERPT_LENGTH = 160

const collectFileMentions = async (
  documentPath: DocumentKey,
  name: string,
): Promise<UnlinkedMention[]> => {
  let content: string
  try {
    content = await fs.readFile(documentPath, 'utf-8')
  } catch {
    return []
  }
  if (!content.includes(name)) return []
  const mentions: UnlinkedMention[] = []
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]!.includes(name)) {
      mentions.push({
        path: documentPath,
        line: index + 1,
        text: lines[index]!.trim().slice(0, MENTION_EXCERPT_LENGTH),
      })
    }
  }
  return mentions
}

export const scanUnlinkedMentions = (
  session: GenerationReadSession,
  filePath: string,
): Effect.Effect<
  readonly UnlinkedMention[],
  FileReadError | IndexCorruptedError
> =>
  Effect.gen(function* () {
    const storage = createStorage(session.indexRoot, session.indexRoot)
    const documentIndex = yield* loadDocumentIndex(storage)
    if (!documentIndex) return []
    const targetKey = yield* resolveDocumentKeyFromIndex(
      documentIndex,
      filePath,
    )
    const name = path.basename(targetKey ?? filePath)
    const entries = Object.values(documentIndex.documents).filter(
      (entry) => entry.path !== targetKey,
    )
    const results = yield* Effect.all(
      entries.map((entry) =>
        Effect.promise(() => collectFileMentions(entry.path, name)),
      ),
      { concurrency: 16 },
    )
    return results
      .flat()
      .sort(
        (left, right) =>
          left.path.localeCompare(right.path) || left.line - right.line,
      )
  })

export const renderUnlinkedMentions = (
  name: string,
  mentions: readonly UnlinkedMention[],
): readonly string[] =>
  mentions.length === 0
    ? []
    : [
        `Unlinked mentions of ${name}:`,
        '',
        ...mentions.map(
          (mention) => `  ${mention.path}:${mention.line}  ${mention.text}`,
        ),
      ]
