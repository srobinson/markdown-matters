/**
 * Path matching utilities for search filtering.
 *
 * Simple glob-like pattern matching for document paths.
 */

import * as path from 'node:path'
import { Effect } from 'effect'
import {
  candidatesWithinRoots,
  canonicalizeSourceFile,
  type DocumentKey,
  isPathWithin,
  resolveCanonicalPathOrFallbackAsync,
  resolveSourceFile,
} from '../db/canonical.js'
import type { GenerationReadSession } from '../db/generation-reader.js'
import { resolveIndexedDocumentKey } from '../index/link-index.js'
import { createStorage, loadDocumentIndex } from '../index/storage.js'
import type { DocumentIndex } from '../index/types.js'
import { loadManifest } from '../manifest.js'

export const resolveCanonicalSourceRoot = (sourceRoot: string) =>
  Effect.promise(() => resolveCanonicalPathOrFallbackAsync(sourceRoot))

export const escapePathPatternLiteral = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('*', '\\*').replaceAll('?', '\\?')

const toMatcherPath = (value: string): string =>
  path.sep === '\\' ? value.replaceAll('\\', '/') : value

const fromMatcherPath = (value: string): string =>
  path.sep === '\\' ? value.replaceAll('/', '\\') : value

const globMetaIndex = (pattern: string): number => {
  for (let index = 0; index < pattern.length; index += 1) {
    if (path.sep !== '\\' && pattern[index] === '\\') {
      index += 1
      continue
    }
    if (pattern[index] === '*' || pattern[index] === '?') return index
  }
  return -1
}

const unescapePatternLiteral = (value: string): string =>
  path.sep === '\\' ? value : value.replace(/\\([\\*?])/g, '$1')

const hasPathSeparator = (value: string): boolean =>
  value.includes('/') || (path.sep === '\\' && value.includes('\\'))

const uniqueRoots = (
  sourceRoot: string,
  manifestRoots: readonly string[],
): readonly string[] => [...new Set([...manifestRoots, sourceRoot])]

interface MatcherRoot {
  readonly declaredPath: string
  readonly canonicalPath: string
  readonly caseSensitive: boolean
}

interface GlobPattern {
  readonly value: string
  readonly caseSensitive: boolean
}

const prepareMatcherRoots = (roots: readonly string[]) =>
  Effect.forEach(roots, (root) =>
    canonicalizeSourceFile(root).pipe(
      Effect.map(
        (source): MatcherRoot => ({
          declaredPath: source.declaredPath,
          canonicalPath: source.key,
          caseSensitive: source.caseSensitive,
        }),
      ),
      Effect.catchAll(() =>
        Effect.promise(
          async (): Promise<MatcherRoot> => ({
            declaredPath: root,
            canonicalPath: await resolveCanonicalPathOrFallbackAsync(root),
            caseSensitive: true,
          }),
        ),
      ),
    ),
  ).pipe(
    Effect.map((resolved) => [
      ...new Map(resolved.map((root) => [root.canonicalPath, root])).values(),
    ]),
  )

const documentPaths = (
  documentIndex: DocumentIndex | null,
  documentPath: DocumentKey,
): readonly string[] => {
  const aliases = documentIndex?.documents[documentPath]?.paths
  return aliases && aliases.length > 0
    ? aliases
    : [resolveSourceFile(documentPath)]
}

const canonicalizeGlobCandidate = async (
  candidate: string,
  root: MatcherRoot,
): Promise<string | null> => {
  const matcherCandidate = toMatcherPath(candidate)
  const metaIndex = globMetaIndex(matcherCandidate)
  const separatorIndex = matcherCandidate.lastIndexOf('/', metaIndex)
  if (separatorIndex < 0) return matcherCandidate

  const literalPrefix = fromMatcherPath(
    unescapePatternLiteral(matcherCandidate.slice(0, separatorIndex)),
  )
  const canonicalPrefix =
    await resolveCanonicalPathOrFallbackAsync(literalPrefix)
  if (!isPathWithin(canonicalPrefix, root.canonicalPath, root.caseSensitive)) {
    return null
  }

  return `${escapePathPatternLiteral(toMatcherPath(canonicalPrefix))}${matcherCandidate.slice(separatorIndex)}`
}

export type PreparedPathFilter = (documentPath: DocumentKey) => boolean

const matchAllPaths: PreparedPathFilter = () => true

const resolveExactDocumentKeys = (
  session: GenerationReadSession,
  candidates: readonly string[],
  documentIndex: DocumentIndex | null,
) =>
  Effect.forEach(candidates, (candidate) =>
    resolveIndexedDocumentKey(session, candidate),
  ).pipe(
    Effect.map((keys) => {
      return new Set(
        keys.filter(
          (key): key is DocumentKey =>
            key !== null && documentIndex?.documents[key] !== undefined,
        ),
      )
    }),
  )

const prepareExactPathFilter =
  (accepted: ReadonlySet<DocumentKey>): PreparedPathFilter =>
  (documentPath) =>
    accepted.has(documentPath)

const rootSelfPattern = (
  pattern: string,
  root: MatcherRoot,
): GlobPattern | null => {
  if (path.isAbsolute(pattern)) return null
  const matcherPattern = toMatcherPath(pattern)
  const rootPath = toMatcherPath(root.canonicalPath)
  if (
    !matchPath(rootPath, matcherPattern, root.caseSensitive) &&
    !matchPath(`${rootPath}/`, matcherPattern, root.caseSensitive)
  ) {
    return null
  }
  return {
    value: canonicalSubtreePathPattern(root.canonicalPath),
    caseSensitive: root.caseSensitive,
  }
}

const prepareGlobPathFilter = (
  pattern: string,
  roots: readonly MatcherRoot[],
  documentIndex: DocumentIndex | null,
) =>
  Effect.promise(async () => {
    const prepared = await Promise.all(
      roots.map(async (root): Promise<readonly GlobPattern[]> => {
        const candidates = await candidatesWithinRoots(
          [root.declaredPath],
          pattern,
        )
        const expanded = (
          await Promise.all(
            candidates.map((candidate) =>
              canonicalizeGlobCandidate(candidate, root),
            ),
          )
        )
          .filter((value) => value !== null)
          .map((value) => ({ value, caseSensitive: root.caseSensitive }))
        const rootPattern = rootSelfPattern(pattern, root)
        return rootPattern ? [...expanded, rootPattern] : expanded
      }),
    )
    const patterns = [
      ...new Map(
        prepared
          .flat()
          .map((item) => [`${item.caseSensitive}:${item.value}`, item]),
      ).values(),
    ]
    return ((documentPath) => {
      return documentPaths(documentIndex, documentPath).some((alias) => {
        const candidate = toMatcherPath(alias)
        return patterns.some((item) =>
          matchPath(candidate, item.value, item.caseSensitive),
        )
      })
    }) satisfies PreparedPathFilter
  })

const prepareBarePathFilter = (
  pattern: string,
  documentIndex: DocumentIndex | null,
): PreparedPathFilter => {
  if (pattern.length === 0) return () => false
  const segmentStart = `/${pattern.toLowerCase()}`
  const pathStart = pattern.toLowerCase()
  return (documentPath) =>
    documentPaths(documentIndex, documentPath).some((alias) => {
      const candidate = toMatcherPath(alias).toLowerCase()
      return candidate.startsWith(pathStart) || candidate.includes(segmentStart)
    })
}

const exactCandidates = (roots: readonly MatcherRoot[], pattern: string) =>
  Effect.promise(() =>
    candidatesWithinRoots(
      roots.map((root) => root.declaredPath),
      pattern,
    ),
  )

export const prepareUserPathFilter = (
  session: GenerationReadSession,
  sourceRoot: string,
  pattern: string | undefined,
) =>
  Effect.gen(function* () {
    if (pattern === undefined) return matchAllPaths

    const manifest = yield* loadManifest(session.home)
    const roots = yield* prepareMatcherRoots(
      uniqueRoots(
        sourceRoot,
        manifest.directories.map((directory) => directory.path),
      ),
    )
    const documentIndex = yield* loadDocumentIndex(
      createStorage(sourceRoot, session.indexRoot),
    )
    const hasGlob = globMetaIndex(toMatcherPath(pattern)) >= 0
    if (!hasGlob && !hasPathSeparator(pattern)) {
      return prepareBarePathFilter(pattern, documentIndex)
    }

    if (!hasGlob) {
      const candidates = yield* exactCandidates(
        roots,
        unescapePatternLiteral(pattern),
      )
      const accepted = yield* resolveExactDocumentKeys(
        session,
        candidates,
        documentIndex,
      )
      return prepareExactPathFilter(accepted)
    }

    if (path.isAbsolute(pattern)) {
      const candidates = yield* exactCandidates(roots, pattern)
      const accepted = yield* resolveExactDocumentKeys(
        session,
        candidates,
        documentIndex,
      )
      if (accepted.size > 0) return prepareExactPathFilter(accepted)
    }

    return yield* prepareGlobPathFilter(pattern, roots, documentIndex)
  })

export const canonicalSubtreePathPattern = (canonicalPath: string): string => {
  const escaped = escapePathPatternLiteral(toMatcherPath(canonicalPath))
  return escaped.endsWith('/') ? `${escaped}**` : `${escaped}/**`
}

/**
 * Match a file path against a glob-like pattern.
 *
 * Supports:
 * - `**` matches any characters including directory separators (recursive)
 * - `*` matches any characters except directory separators (single segment)
 * - `?` matches exactly one character (not directory separator)
 * - `.` is treated literally
 *
 * @param filePath - The file path to test
 * @param pattern - The glob pattern (e.g., "docs/*", "src/api/*.md", "src/** /*.ts")
 * @returns True if the path matches the pattern
 */
export const matchPath = (
  filePath: string,
  pattern: string,
  caseSensitive: boolean = false,
): boolean => {
  const ESCAPED_BACKSLASH_PLACEHOLDER = '\u0000ESCAPED_BACKSLASH\u0000'
  const ESCAPED_STAR_PLACEHOLDER = '\u0000ESCAPED_STAR\u0000'
  const ESCAPED_QUESTION_PLACEHOLDER = '\u0000ESCAPED_QUESTION\u0000'
  const DOUBLE_STAR_PLACEHOLDER = '\u0000DOUBLE_STAR\u0000'

  const regexPattern = pattern
    .replace(/\\\\/g, ESCAPED_BACKSLASH_PLACEHOLDER)
    .replace(/\\\*/g, ESCAPED_STAR_PLACEHOLDER)
    .replace(/\\\?/g, ESCAPED_QUESTION_PLACEHOLDER)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape all regex special chars first
    .replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER) // Preserve ** before processing *
    .replace(/\*/g, '[^/]*') // Single * doesn't match slashes
    .replace(/\?/g, '[^/]') // ? matches any single non-slash char
    .replaceAll(DOUBLE_STAR_PLACEHOLDER, '.*') // ** matches anything
    .replaceAll(ESCAPED_BACKSLASH_PLACEHOLDER, '\\\\')
    .replaceAll(ESCAPED_STAR_PLACEHOLDER, '\\*')
    .replaceAll(ESCAPED_QUESTION_PLACEHOLDER, '\\?')

  const regex = new RegExp(`^${regexPattern}$`, caseSensitive ? undefined : 'i')
  return regex.test(filePath)
}

export const matchesDocumentPath = (
  sourceRoot: string,
  documentPath: DocumentKey,
  pattern: string | undefined,
): boolean => {
  if (pattern === undefined) return true
  const relativePath = path
    .relative(sourceRoot, resolveSourceFile(documentPath))
    .split(path.sep)
    .join('/')
  return matchPath(relativePath, pattern)
}
