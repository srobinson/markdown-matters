import { Effect } from 'effect'
import type { MdDocument, MdSection } from '../core/types.js'
import type {
  CanonicalSource,
  DeclaredPath,
  DocumentKey,
} from '../db/canonical.js'
import {
  type IndexStorage,
  saveDocumentIndex,
  saveLinkIndex,
  saveSectionIndex,
} from './storage.js'
import type {
  DocumentEntry,
  DocumentIndex,
  LinkIndex,
  SectionEntry,
  SectionIndex,
} from './types.js'

export interface MutableIndexState {
  readonly documentVersion: DocumentIndex['version']
  readonly sectionVersion: SectionIndex['version']
  readonly linkVersion: LinkIndex['version']
  readonly documents: Record<DocumentKey, DocumentEntry>
  readonly sections: Record<string, SectionEntry>
  readonly byHeading: Record<string, string[]>
  readonly byDocument: Record<string, string[]>
  readonly forward: Record<DocumentKey, DocumentKey[]>
  readonly backward: Record<DocumentKey, DocumentKey[]>
  readonly brokenLinks: Set<DeclaredPath>
}

const copyArrayRecord = <Key extends string, Value>(
  source: Readonly<Record<Key, readonly Value[]>>,
): Record<Key, Value[]> => {
  const copy = Object.create(null) as Record<Key, Value[]>
  for (const key of Object.keys(source) as Key[]) copy[key] = [...source[key]]
  return copy
}

export const createMutableIndexState = (
  documents: DocumentIndex,
  sections: SectionIndex,
  links: LinkIndex,
): MutableIndexState => ({
  documentVersion: documents.version,
  sectionVersion: sections.version,
  linkVersion: links.version,
  documents: { ...documents.documents },
  sections: { ...sections.sections },
  byHeading: copyArrayRecord(sections.byHeading),
  byDocument: copyArrayRecord(sections.byDocument),
  forward: copyArrayRecord(links.forward),
  backward: copyArrayRecord(links.backward),
  brokenLinks: new Set(links.broken),
})

const removeDocumentSections = (
  state: MutableIndexState,
  entry: DocumentEntry,
): void => {
  const oldSectionIds = state.byDocument[entry.id] ?? []
  for (const sectionId of oldSectionIds) {
    const section = state.sections[sectionId]
    if (section) {
      const headingList = state.byHeading[section.heading.toLowerCase()]
      const index = headingList?.indexOf(sectionId) ?? -1
      if (index !== -1) headingList?.splice(index, 1)
    }
    delete state.sections[sectionId]
  }
  delete state.byDocument[entry.id]
}

export const deleteIndexedDocument = (
  state: MutableIndexState,
  declaredPath: DeclaredPath,
): void => {
  const documentKey = Object.values(state.documents).find((document) =>
    document.declaredPaths.includes(declaredPath),
  )?.path
  if (!documentKey) return
  const entry = state.documents[documentKey]
  if (!entry) return

  removeDocumentSections(state, entry)
  for (const target of state.forward[documentKey] ?? []) {
    const backList = state.backward[target]
    const index = backList?.indexOf(documentKey) ?? -1
    if (index !== -1) backList?.splice(index, 1)
  }
  delete state.forward[documentKey]
  delete state.backward[documentKey]
  delete state.documents[documentKey]
}

const flattenSections = (
  sections: readonly MdSection[],
  documentId: string,
  documentPath: DocumentKey,
): SectionEntry[] => {
  const result: SectionEntry[] = []
  const traverse = (section: MdSection): void => {
    result.push({
      id: section.id,
      documentId,
      documentPath,
      heading: section.heading,
      level: section.level,
      startLine: section.startLine,
      endLine: section.endLine,
      tokenCount: section.metadata.tokenCount,
      hasCode: section.metadata.hasCode,
      hasList: section.metadata.hasList,
      hasTable: section.metadata.hasTable,
    })
    for (const child of section.children) traverse(child)
  }
  for (const section of sections) traverse(section)
  return result
}

export interface ApplyDocumentInput {
  readonly document: MdDocument
  readonly source: CanonicalSource
  readonly resolvedLinks: readonly DocumentKey[]
  readonly brokenLinks: readonly DeclaredPath[]
  readonly hash: string
  readonly mtime: number
}

export interface ApplyDocumentResult {
  readonly sectionsIndexed: number
  readonly linksIndexed: number
}

export const applyDocument = (
  state: MutableIndexState,
  input: ApplyDocumentInput,
): ApplyDocumentResult => {
  const { document, source, resolvedLinks, brokenLinks, hash, mtime } = input
  const existing = state.documents[source.key]
  if (existing) {
    removeDocumentSections(state, existing)
    delete state.forward[source.key]
  }

  state.documents[source.key] = {
    id: document.id,
    path: source.key,
    paths: [source.key],
    declaredPaths: [source.declaredPath],
    identity: source.identity,
    comparisonKey: source.comparisonKey,
    title: document.title,
    mtime,
    hash,
    tokenCount: document.metadata.tokenCount,
    sectionCount: document.metadata.headingCount,
  }

  const sections = flattenSections(document.sections, document.id, source.key)
  state.byDocument[document.id] = []
  for (const section of sections) {
    state.sections[section.id] = section
    state.byDocument[document.id]?.push(section.id)
    const headingKey = section.heading.toLowerCase()
    state.byHeading[headingKey] ??= []
    state.byHeading[headingKey]?.push(section.id)
  }

  for (const target of resolvedLinks) {
    state.backward[target] ??= []
    if (!state.backward[target]?.includes(source.key)) {
      state.backward[target]?.push(source.key)
    }
  }
  state.forward[source.key] = [...resolvedLinks]
  for (const target of brokenLinks) state.brokenLinks.add(target)
  return {
    sectionsIndexed: sections.length,
    linksIndexed: resolvedLinks.length + brokenLinks.length,
  }
}

export const saveIndexState = (
  storage: IndexStorage,
  state: MutableIndexState,
) =>
  saveDocumentIndex(storage, {
    version: state.documentVersion,
    rootPath: storage.sourceRoot,
    documents: state.documents,
  }).pipe(
    Effect.andThen(
      saveSectionIndex(storage, {
        version: state.sectionVersion,
        sections: state.sections,
        byHeading: state.byHeading,
        byDocument: state.byDocument,
      }),
    ),
    Effect.andThen(
      saveLinkIndex(storage, {
        version: state.linkVersion,
        forward: state.forward,
        backward: state.backward,
        broken: [...state.brokenLinks],
      }),
    ),
  )
