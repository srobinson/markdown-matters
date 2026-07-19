import { Effect } from 'effect'
import type { MdDocument, MdSection } from '../core/types.js'
import { resolveInternalLink } from './link-index.js'
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
  readonly documentVersion: number
  readonly sectionVersion: number
  readonly linkVersion: number
  readonly documents: Record<string, DocumentEntry>
  readonly sections: Record<string, SectionEntry>
  readonly byHeading: Record<string, string[]>
  readonly byDocument: Record<string, string[]>
  readonly forward: Record<string, string[]>
  readonly backward: Record<string, string[]>
  readonly brokenLinks: Set<string>
}

const copyArrayRecord = (
  source: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> =>
  Object.assign(
    Object.create(null),
    Object.fromEntries(
      Object.entries(source).map(([key, values]) => [key, [...values]]),
    ),
  )

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
  relativePath: string,
): void => {
  const entry = state.documents[relativePath]
  if (!entry) return

  removeDocumentSections(state, entry)
  for (const target of state.forward[relativePath] ?? []) {
    const backList = state.backward[target]
    const index = backList?.indexOf(relativePath) ?? -1
    if (index !== -1) backList?.splice(index, 1)
  }
  delete state.forward[relativePath]
  delete state.backward[relativePath]
  delete state.documents[relativePath]
}

const flattenSections = (
  sections: readonly MdSection[],
  documentId: string,
  documentPath: string,
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
  readonly filePath: string
  readonly relativePath: string
  readonly rootPath: string
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
  const { document, filePath, relativePath, rootPath, hash, mtime } = input
  const existing = state.documents[relativePath]
  if (existing) {
    removeDocumentSections(state, existing)
    delete state.forward[relativePath]
  }

  state.documents[relativePath] = {
    id: document.id,
    path: relativePath,
    title: document.title,
    mtime,
    hash,
    tokenCount: document.metadata.tokenCount,
    sectionCount: document.metadata.headingCount,
  }

  const sections = flattenSections(document.sections, document.id, relativePath)
  state.byDocument[document.id] = []
  for (const section of sections) {
    state.sections[section.id] = section
    state.byDocument[document.id]?.push(section.id)
    const headingKey = section.heading.toLowerCase()
    state.byHeading[headingKey] ??= []
    state.byHeading[headingKey]?.push(section.id)
  }

  const outgoingLinks: string[] = []
  for (const link of document.links.filter(
    (item) => item.type === 'internal',
  )) {
    const target = resolveInternalLink(link.href, filePath, rootPath)
    if (!target) continue
    outgoingLinks.push(target)
    state.backward[target] ??= []
    if (!state.backward[target]?.includes(relativePath)) {
      state.backward[target]?.push(relativePath)
    }
  }
  state.forward[relativePath] = outgoingLinks
  return {
    sectionsIndexed: sections.length,
    linksIndexed: outgoingLinks.length,
  }
}

export const markBrokenLinks = (state: MutableIndexState): void => {
  for (const targets of Object.values(state.forward)) {
    for (const target of targets) {
      if (!state.documents[target]) state.brokenLinks.add(target)
    }
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
