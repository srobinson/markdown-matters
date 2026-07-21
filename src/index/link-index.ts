import * as path from 'node:path'
import { Effect } from 'effect'
import type { InternalLinkLookup, LinkSyntax } from '../core/types.js'
import {
  type CanonicalSource,
  canonicalizeSourceFile,
  type DeclaredPath,
  type DocumentKey,
  expandDeclaredPath,
  fileIdentityKey,
  isPathWithin,
} from '../db/canonical.js'
import type { GenerationReadSession } from '../db/generation-reader.js'
import type { FileReadError, IndexCorruptedError } from '../errors/index.js'
import { createStorage, loadDocumentIndex, loadLinkIndex } from './storage.js'
import type {
  DocumentEntry,
  DocumentIndex,
  LinkEdge,
  SectionEntry,
} from './types.js'

export type InternalLinkResolution =
  | {
      readonly kind: 'resolved'
      readonly path: DocumentKey
      readonly sectionId?: string
    }
  | { readonly kind: 'broken'; readonly path: DeclaredPath }

export type LinkSectionCandidate = Pick<
  SectionEntry,
  'id' | 'documentPath' | 'heading' | 'startLine'
>

export interface BasenameCandidate {
  readonly documentPath: DocumentKey
  readonly displayPath: string
}

export interface PreparedLinkResolutionIndex {
  readonly byBasename: ReadonlyMap<string, readonly BasenameCandidate[]>
  readonly sectionByHeading: ReadonlyMap<string, string>
}

export interface LinkAmbiguity {
  readonly target: string
  readonly selected: DocumentKey
  readonly candidates: readonly BasenameCandidate[]
}

const compareText = (left: string, right: string): number => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const portablePath = (value: string): string => value.split(path.sep).join('/')

const displayAlias = (roots: readonly string[], alias: string): string => {
  const root = roots.find((candidate) => isPathWithin(alias, candidate, true))
  return portablePath(root ? path.relative(root, alias) : alias)
}

const basenameKey = (value: string): string =>
  path.basename(value).replace(/\.md$/i, '').toLowerCase()

const addDocumentNames = (
  names: Map<string, Map<DocumentKey, BasenameCandidate>>,
  roots: readonly string[],
  documentPath: DocumentKey,
  aliases: readonly string[],
): void => {
  for (const alias of aliases) {
    const key = basenameKey(alias)
    if (!key) continue
    const candidates = names.get(key) ?? new Map()
    const candidate = {
      documentPath,
      displayPath: displayAlias(roots, alias),
    }
    const existing = candidates.get(documentPath)
    if (
      existing === undefined ||
      candidate.displayPath.length < existing.displayPath.length ||
      (candidate.displayPath.length === existing.displayPath.length &&
        candidate.displayPath < existing.displayPath)
    ) {
      candidates.set(documentPath, candidate)
    }
    names.set(key, candidates)
  }
}

const compareBasenameCandidates = (
  left: BasenameCandidate,
  right: BasenameCandidate,
): number =>
  left.displayPath.length - right.displayPath.length ||
  compareText(left.displayPath, right.displayPath) ||
  compareText(left.documentPath, right.documentPath)

const sectionHeadingKey = (
  documentPath: DocumentKey,
  heading: string,
): string => `${documentPath}\0${heading.toLowerCase()}`

export const prepareLinkResolutionIndex = (
  documents: Readonly<Record<DocumentKey, DocumentEntry>>,
  additionalDocuments: readonly {
    readonly documentPath: DocumentKey
    readonly aliases: readonly string[]
  }[],
  sections: readonly LinkSectionCandidate[],
  roots: readonly string[],
): PreparedLinkResolutionIndex => {
  const names = new Map<string, Map<DocumentKey, BasenameCandidate>>()
  const additionalKeys = new Set(
    additionalDocuments.map((document) => document.documentPath),
  )
  for (const document of Object.values(documents)) {
    if (additionalKeys.has(document.path)) continue
    addDocumentNames(names, roots, document.path, [
      ...document.declaredPaths,
      ...document.paths,
    ])
  }
  for (const document of additionalDocuments) {
    addDocumentNames(names, roots, document.documentPath, document.aliases)
  }

  const byBasename = new Map<string, readonly BasenameCandidate[]>()
  for (const [key, candidates] of names) {
    byBasename.set(
      key,
      [...candidates.values()].sort(compareBasenameCandidates),
    )
  }

  const sectionByHeading = new Map<string, string>()
  for (const section of [...sections].sort(
    (left, right) =>
      left.startLine - right.startLine || compareText(left.id, right.id),
  )) {
    const key = sectionHeadingKey(section.documentPath, section.heading)
    if (!sectionByHeading.has(key)) sectionByHeading.set(key, section.id)
  }
  return { byBasename, sectionByHeading }
}

export interface InternalLinkResolutionOptions {
  readonly canonicalize?: (
    value: string,
  ) => ReturnType<typeof canonicalizeSourceFile>
  readonly selectDocumentKey?: (
    source: CanonicalSource,
  ) => DocumentKey | undefined
  readonly lookup?: InternalLinkLookup
  readonly syntax?: LinkSyntax
  readonly heading?: string | undefined
  readonly index?: PreparedLinkResolutionIndex
  readonly onAmbiguous?: (ambiguity: LinkAmbiguity) => void
}

const wikilinkPath = (value: string, syntax: LinkSyntax): string =>
  syntax === 'wikilink' && !value.toLowerCase().endsWith('.md')
    ? `${value}.md`
    : value

const resolvedTarget = (
  documentPath: DocumentKey,
  heading: string | undefined,
  index: PreparedLinkResolutionIndex | undefined,
): InternalLinkResolution => {
  const sectionId = heading
    ? index?.sectionByHeading.get(sectionHeadingKey(documentPath, heading))
    : undefined
  return {
    kind: 'resolved',
    path: documentPath,
    ...(sectionId ? { sectionId } : {}),
  }
}

export const resolveInternalLink = (
  href: string,
  fromPath: string,
  rootPaths: string | readonly string[],
  caseSensitive = true,
  options: InternalLinkResolutionOptions = {},
): Effect.Effect<InternalLinkResolution | null> => {
  const canonicalize = options.canonicalize ?? canonicalizeSourceFile
  const selectDocumentKey =
    options.selectDocumentKey ?? ((source: CanonicalSource) => source.key)
  const [rawPath, rawHeading] = href.split('#', 2)
  const heading = options.heading ?? rawHeading
  const classify = (declaredPath: DeclaredPath) =>
    canonicalize(declaredPath).pipe(
      Effect.map((target): InternalLinkResolution => {
        const selected = selectDocumentKey(target)
        return selected === undefined
          ? { kind: 'broken', path: declaredPath }
          : resolvedTarget(selected, heading, options.index)
      }),
      Effect.catchAll(() =>
        Effect.succeed<InternalLinkResolution>({
          kind: 'broken',
          path: declaredPath,
        }),
      ),
    )

  if (href.startsWith('#')) return classify(expandDeclaredPath(fromPath))
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return Effect.succeed(null)
  }

  const linkPath = rawPath ?? ''
  if (!linkPath) return Effect.succeed(null)

  if (options.lookup === 'basename') {
    const candidates =
      options.index?.byBasename.get(basenameKey(linkPath)) ?? []
    const selected = candidates[0]
    if (selected) {
      if (candidates.length > 1) {
        options.onAmbiguous?.({
          target: linkPath,
          selected: selected.documentPath,
          candidates,
        })
      }
      return Effect.succeed(
        resolvedTarget(selected.documentPath, heading, options.index),
      )
    }
    const missing = path.resolve(
      path.dirname(fromPath),
      wikilinkPath(linkPath, 'wikilink'),
    )
    return Effect.succeed({
      kind: 'broken',
      path: expandDeclaredPath(missing),
    })
  }

  const resolved = path.resolve(
    path.dirname(fromPath),
    wikilinkPath(
      linkPath.split('/').join(path.sep),
      options.syntax ?? 'markdown',
    ),
  )
  const roots = typeof rootPaths === 'string' ? [rootPaths] : rootPaths
  if (!roots.some((root) => isPathWithin(resolved, root, caseSensitive))) {
    return Effect.succeed(null)
  }
  return classify(expandDeclaredPath(resolved))
}

const findStoredDocumentKey = (
  documentIndex: DocumentIndex | null,
  source: CanonicalSource,
): DocumentKey => {
  const identity = fileIdentityKey(source.identity)
  return (
    Object.values(documentIndex?.documents ?? {}).find(
      (entry) =>
        fileIdentityKey(entry.identity) === identity ||
        entry.paths.includes(source.key),
    )?.path ?? source.key
  )
}

export const resolveDocumentKeyFromIndex = (
  documentIndex: DocumentIndex | null,
  filePath: string,
): Effect.Effect<DocumentKey | null> =>
  canonicalizeSourceFile(filePath).pipe(
    Effect.map((source) => findStoredDocumentKey(documentIndex, source)),
    Effect.catchAll(() => Effect.succeed(null)),
  )

export const resolveIndexedDocumentKey = (
  session: GenerationReadSession,
  filePath: string,
): Effect.Effect<DocumentKey | null, FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    const documentIndex = yield* loadDocumentIndex(
      createStorage(session.indexRoot, session.indexRoot),
    )
    return yield* resolveDocumentKeyFromIndex(documentIndex, filePath)
  })

const loadLinksFor = (
  session: GenerationReadSession,
  filePath: string,
  direction: 'forward' | 'backward',
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    const storage = createStorage(session.indexRoot, session.indexRoot)
    const [documentIndex, linkIndex] = yield* Effect.all([
      loadDocumentIndex(storage),
      loadLinkIndex(storage),
    ])
    if (!linkIndex) return []
    const documentKey = yield* resolveDocumentKeyFromIndex(
      documentIndex,
      filePath,
    )
    if (!documentKey) return []
    return [
      ...new Set(
        (linkIndex[direction][documentKey] ?? []).map(
          (edge: LinkEdge) => edge.documentPath,
        ),
      ),
    ]
  })

export const getOutgoingLinks = (
  session: GenerationReadSession,
  filePath: string,
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  loadLinksFor(session, filePath, 'forward')

export const getIncomingLinks = (
  session: GenerationReadSession,
  filePath: string,
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  loadLinksFor(session, filePath, 'backward')

export const getBrokenLinks = (
  session: GenerationReadSession,
): Effect.Effect<readonly string[], FileReadError | IndexCorruptedError> =>
  Effect.gen(function* () {
    const linkIndex = yield* loadLinkIndex(
      createStorage(session.indexRoot, session.indexRoot),
    )
    return linkIndex?.broken ?? []
  })
