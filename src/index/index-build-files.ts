import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { Effect } from 'effect'

import type { MdDocument } from '../core/types.js'
import {
  type CanonicalSourceSelection,
  type DeclaredPath,
  type DocumentKey,
  fileIdentityKey,
  isPathWithin,
} from '../db/canonical.js'
import { ParseError } from '../errors/index.js'
import { parse } from '../parser/parser.js'
import type { CanonicalizedDiscovery } from './file-discovery.js'
import { discoveryRelativePath } from './file-discovery.js'
import {
  flattenDocumentSections,
  type MutableIndexState,
} from './index-state.js'
import {
  prepareLinkResolutionIndex,
  resolveInternalLink,
} from './link-index.js'
import { computeHash } from './storage.js'
import type { FileProcessingError, LinkEdge } from './types.js'

export interface ParsedFile {
  readonly kind: 'parsed'
  readonly mtime: number
  readonly hash: string
  readonly document: MdDocument
  readonly source: CanonicalSourceSelection
}

export interface ResolvedParsedFile extends ParsedFile {
  readonly resolvedLinks: readonly LinkEdge[]
  readonly brokenLinks: readonly DeclaredPath[]
}

export interface UnchangedFile {
  readonly kind: 'unchanged'
}

export type ParsedFileResult = ResolvedParsedFile | UnchangedFile | null
export type ParsedDocumentResult = ParsedFile | UnchangedFile | null

export const displayPath = (
  roots: readonly string[],
  filePath: string,
): string => {
  const root = roots.find((candidate) =>
    isPathWithin(filePath, candidate, true),
  )
  return root
    ? discoveryRelativePath(root, filePath)
    : filePath.split(path.sep).join('/')
}

const resolveDocumentLinks = (
  document: MdDocument,
  source: CanonicalSourceSelection,
  roots: readonly string[],
  discovery: CanonicalizedDiscovery,
  documentKeysByIdentity: ReadonlyMap<string, DocumentKey>,
  complete: boolean,
  index: ReturnType<typeof prepareLinkResolutionIndex>,
  errors: FileProcessingError[],
) =>
  Effect.all(
    document.links
      .filter((link) => link.type === 'internal')
      .map((link) =>
        resolveInternalLink(
          link.href,
          source.declaredPaths[0] ?? source.key,
          roots,
          source.caseSensitive,
          {
            canonicalize: discovery.canonicalize,
            selectDocumentKey: (target) =>
              documentKeysByIdentity.get(fileIdentityKey(target.identity)) ??
              (complete ? undefined : target.key),
            lookup: link.lookup,
            syntax: link.syntax,
            heading: link.heading,
            index,
            onAmbiguous: (ambiguity) => {
              const candidates = ambiguity.candidates
                .map((candidate) => candidate.displayPath)
                .join(', ')
              errors.push({
                path: displayPath(roots, source.declaredPaths[0] ?? source.key),
                message: `Ambiguous wikilink "${ambiguity.target}": chose ${ambiguity.candidates[0]?.displayPath ?? ambiguity.selected} from ${candidates}`,
              })
            },
          },
        ),
      ),
    { concurrency: 50 },
  ).pipe(
    Effect.map((targets) => ({
      resolvedLinks: targets.flatMap((target) => {
        if (target?.kind !== 'resolved') return []
        return [
          {
            documentPath: target.path,
            ...(target.sectionId ? { sectionId: target.sectionId } : {}),
          } satisfies LinkEdge,
        ]
      }),
      brokenLinks: targets.flatMap((target) =>
        target?.kind === 'broken' ? [target.path] : [],
      ),
    })),
  )

const sameValues = <T>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const sourceMatchesEntry = (
  source: CanonicalSourceSelection,
  entry: MutableIndexState['documents'][DocumentKey],
): boolean =>
  sameValues(source.paths, entry.paths) &&
  sameValues(source.declaredPaths, entry.declaredPaths) &&
  source.comparisonKey === entry.comparisonKey &&
  fileIdentityKey(source.identity) === fileIdentityKey(entry.identity)

export interface ParseFilesOptions {
  readonly force?: boolean | undefined
}

export const parseFiles = (
  roots: readonly string[],
  discovery: CanonicalizedDiscovery,
  state: MutableIndexState,
  options: ParseFilesOptions,
  errors: FileProcessingError[],
  reparseAliases: ReadonlySet<DeclaredPath>,
) =>
  Effect.all(
    discovery.selections.map((source) => {
      const relativePath = displayPath(
        roots,
        source.declaredPaths[0] ?? source.key,
      )
      return Effect.gen(function* () {
        const [content, stats] = yield* Effect.promise(() =>
          Promise.all([fs.readFile(source.key, 'utf-8'), fs.stat(source.key)]),
        )
        const hash = computeHash(content)
        const existing = state.documents[source.key]
        if (
          !options.force &&
          !source.declaredPaths.some((alias) => reparseAliases.has(alias)) &&
          existing?.hash === hash &&
          existing.mtime === stats.mtime.getTime() &&
          sourceMatchesEntry(source, existing)
        ) {
          return { kind: 'unchanged' } satisfies UnchangedFile
        }
        const document = yield* parse(content, {
          path: source.key,
          lastModified: stats.mtime,
        }).pipe(
          Effect.mapError(
            (error) =>
              new ParseError({
                message: error.message,
                path: relativePath,
                ...(error.line !== undefined && { line: error.line }),
                ...(error.column !== undefined && { column: error.column }),
              }),
          ),
        )
        return {
          kind: 'parsed',
          mtime: stats.mtime.getTime(),
          hash,
          document,
          source,
        } satisfies ParsedFile
      }).pipe(
        Effect.catchAll((error) => {
          const message =
            'message' in error && typeof error.message === 'string'
              ? error.message
              : String(error)
          errors.push({ path: relativePath, message })
          return Effect.succeed(null)
        }),
      )
    }),
    { concurrency: 50 },
  )

export const resolveParsedFiles = (
  parsedFiles: readonly ParsedDocumentResult[],
  roots: readonly string[],
  discovery: CanonicalizedDiscovery,
  state: MutableIndexState,
  complete: boolean,
  errors: FileProcessingError[],
) => {
  const parsed = parsedFiles.flatMap((result) =>
    result?.kind === 'parsed' ? [result] : [],
  )
  const parsedKeys = new Set(parsed.map((result) => result.source.key))
  const sections = [
    ...Object.values(state.sections).filter(
      (section) => !parsedKeys.has(section.documentPath),
    ),
    ...parsed.flatMap((result) =>
      flattenDocumentSections(
        result.document.sections,
        result.document.id,
        result.source.key,
      ),
    ),
  ]
  const index = prepareLinkResolutionIndex(
    state.documents,
    discovery.selections.map((source) => ({
      documentPath: source.key,
      aliases: [...source.declaredPaths, ...source.paths],
    })),
    sections,
    roots,
  )
  const documentKeysByIdentity = new Map<string, DocumentKey>(
    complete
      ? []
      : Object.values(state.documents).map((entry) => [
          fileIdentityKey(entry.identity),
          entry.path,
        ]),
  )
  for (const source of discovery.selections) {
    documentKeysByIdentity.set(fileIdentityKey(source.identity), source.key)
  }

  return Effect.forEach(
    parsedFiles,
    (result): Effect.Effect<ParsedFileResult> => {
      if (result?.kind !== 'parsed') return Effect.succeed(result)
      return resolveDocumentLinks(
        result.document,
        result.source,
        roots,
        discovery,
        documentKeysByIdentity,
        complete,
        index,
        errors,
      ).pipe(
        Effect.map(
          (links): ResolvedParsedFile => ({
            ...result,
            ...links,
          }),
        ),
      )
    },
    { concurrency: 50 },
  )
}
