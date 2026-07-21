/**
 * Markdown parser using remark/unified
 * Handles GFM (tables, task lists) and YAML frontmatter
 */

import * as crypto from 'node:crypto'
import { Effect } from 'effect'
import matter from 'gray-matter'
import type {
  Code,
  Heading,
  Image,
  Link,
  Parent,
  Root,
  RootContent,
  Text,
} from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { SKIP, visit } from 'unist-util-visit'
import { parseDocument } from 'yaml'

import type {
  DocumentMetadata,
  HeadingLevel,
  MdCodeBlock,
  MdDocument,
  MdLink,
  MdSection,
} from '../core/types.js'
import { FileReadError, type ParseError } from '../errors/index.js'
import { countTokensApprox, countWords } from '../utils/tokens.js'

// ============================================================================
// Parser Configuration
// ============================================================================

const processor = unified().use(remarkParse).use(remarkGfm)

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

const recoverFrontmatter = (yaml: string): Record<string, unknown> => {
  try {
    const recovered = parseDocument(yaml, { logLevel: 'silent' }).toJSON()
    if (
      recovered &&
      typeof recovered === 'object' &&
      !Array.isArray(recovered)
    ) {
      return recovered as Record<string, unknown>
    }
  } catch {
    return {}
  }
  return {}
}

// ============================================================================
// Helper Functions
// ============================================================================

const generateId = (input: string): string => {
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 12)
}

const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

const isInternalLink = (href: string): boolean => {
  if (href.startsWith('http://') || href.startsWith('https://')) return false
  if (href.startsWith('mailto:')) return false
  if (href.startsWith('#')) return true
  if (href.endsWith('.md') || href.includes('.md#')) return true
  return !href.includes('://')
}

const WIKILINK_PATTERN = /\[\[([^\][\n]+)\]\]/g

const splitOnce = (value: string, separator: string): [string, string?] => {
  const index = value.indexOf(separator)
  return index === -1
    ? [value]
    : [value.slice(0, index), value.slice(index + separator.length)]
}

const extractWikilinks = (node: Text, sectionId: string): readonly MdLink[] =>
  [...node.value.matchAll(WIKILINK_PATTERN)].flatMap((match) => {
    const inner = match[1]?.trim() ?? ''
    const [rawTarget, rawAlias] = splitOnce(inner, '|')
    const target = rawTarget.trim()
    const [rawDocumentTarget, rawHeading] = splitOnce(target, '#')
    const documentTarget = rawDocumentTarget.trim()
    if (!documentTarget) return []

    const heading = rawHeading?.trim()
    const prefix = node.value.slice(0, match.index)
    const line = getNodeStartLine(node) + (prefix.match(/\n/g)?.length ?? 0)
    return [
      {
        type: 'internal',
        syntax: 'wikilink',
        lookup: documentTarget.includes('/') ? 'path' : 'basename',
        href: documentTarget,
        text: rawAlias?.trim() || target,
        ...(heading ? { heading } : {}),
        sectionId,
        line,
      } satisfies MdLink,
    ]
  })

const extractPlainText = (node: Parent | Root): string => {
  const texts: string[] = []
  visit(node, 'text', (textNode: Text) => {
    texts.push(textNode.value)
  })
  return texts.join(' ')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getNodeEndLine = (node: any): number => {
  return node?.position?.end?.line ?? 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getNodeStartLine = (node: any): number => {
  return node?.position?.start?.line ?? 0
}

// ============================================================================
// Section Extraction
// ============================================================================

interface RawSection {
  heading: string
  level: HeadingLevel
  startLine: number
  endLine: number
  contentStartLine: number
  contentNodes: RootContent[]
}

const extractRawSections = (tree: Root): RawSection[] => {
  const sections: RawSection[] = []
  const headings: {
    heading: string
    level: HeadingLevel
    line: number
    index: number
  }[] = []

  // First pass: collect all headings with their positions
  tree.children.forEach((node, index) => {
    if (node.type === 'heading') {
      const heading = node as Heading
      headings.push({
        heading: extractPlainText(heading),
        level: heading.depth as HeadingLevel,
        line: getNodeStartLine(node),
        index,
      })
    }
  })

  // Second pass: create sections from headings
  headings.forEach((h, i) => {
    const nextHeading = headings[i + 1]
    const endIndex = nextHeading ? nextHeading.index : tree.children.length

    // Get content nodes between this heading and the next
    const contentNodes = tree.children.slice(h.index + 1, endIndex)
    const lastContentNode = contentNodes[contentNodes.length - 1]
    const endLine = lastContentNode ? getNodeEndLine(lastContentNode) : h.line

    sections.push({
      heading: h.heading,
      level: h.level,
      startLine: h.line,
      endLine,
      contentStartLine: h.line + 1,
      contentNodes,
    })
  })

  return sections
}

const buildSectionHierarchy = (
  rawSections: RawSection[],
  docId: string,
  lines: string[],
): MdSection[] => {
  const result: MdSection[] = []
  const stack: { section: MdSection; level: number }[] = []

  for (const raw of rawSections) {
    const contentLines = lines.slice(raw.startLine - 1, raw.endLine)
    const content = contentLines.join('\n')
    const plainText = extractSectionPlainText(raw.contentNodes)

    const hasCode = raw.contentNodes.some((n) => n.type === 'code')
    const hasList = raw.contentNodes.some((n) => n.type === 'list')
    const hasTable = raw.contentNodes.some((n) => n.type === 'table')

    const section: MdSection = {
      id: `${docId}-${slugify(raw.heading)}-L${raw.startLine}`,
      heading: raw.heading,
      level: raw.level,
      content,
      plainText,
      startLine: raw.startLine,
      endLine: raw.endLine,
      children: [],
      metadata: {
        wordCount: countWords(plainText),
        tokenCount: countTokensApprox(content),
        hasCode,
        hasList,
        hasTable,
      },
    }

    // Build hierarchy: find parent for this section
    while (stack.length > 0 && stack[stack.length - 1]!.level >= raw.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      result.push(section)
    } else {
      const parent = stack[stack.length - 1]!
      ;(parent.section.children as MdSection[]).push(section)
    }

    stack.push({ section, level: raw.level })
  }

  return result
}

const extractSectionPlainText = (nodes: RootContent[]): string => {
  const texts: string[] = []
  for (const node of nodes) {
    if ('value' in node && typeof node.value === 'string') {
      texts.push(node.value)
    } else if ('children' in node) {
      texts.push(extractPlainText(node))
    }
  }
  return texts.join(' ')
}

const countAllSections = (sections: MdSection[]): number => {
  let count = 0
  for (const section of sections) {
    count += 1
    count += countAllSections(section.children as MdSection[])
  }
  return count
}

// ============================================================================
// Link Extraction
// ============================================================================

const extractLinks = (tree: Root, docId: string): MdLink[] => {
  const links: MdLink[] = []
  let currentSectionId = docId

  visit(tree, (node) => {
    if (node.type === 'heading') {
      currentSectionId = `${docId}-${slugify(extractPlainText(node as Heading))}-L${getNodeStartLine(node)}`
    }

    if (node.type === 'link') {
      const link = node as Link
      const internal = isInternalLink(link.url)
      links.push({
        type: internal ? 'internal' : 'external',
        syntax: 'markdown',
        lookup: 'path',
        href: link.url,
        text: extractPlainText(link),
        sectionId: currentSectionId,
        line: getNodeStartLine(node),
      })
      return SKIP
    }

    if (node.type === 'image') {
      const img = node as Image
      links.push({
        type: 'image',
        syntax: 'markdown',
        lookup: 'path',
        href: img.url,
        text: img.alt ?? '',
        sectionId: currentSectionId,
        line: getNodeStartLine(node),
      })
    }

    if (node.type === 'text') {
      links.push(...extractWikilinks(node as Text, currentSectionId))
    }
    return undefined
  })

  return links
}

// ============================================================================
// Code Block Extraction
// ============================================================================

const extractCodeBlocks = (tree: Root, docId: string): MdCodeBlock[] => {
  const codeBlocks: MdCodeBlock[] = []
  let currentSectionId = docId

  visit(tree, (node) => {
    if (node.type === 'heading') {
      currentSectionId = `${docId}-${slugify(extractPlainText(node as Heading))}-L${getNodeStartLine(node)}`
    }

    if (node.type === 'code') {
      const code = node as Code
      codeBlocks.push({
        language: code.lang ?? null,
        content: code.value,
        sectionId: currentSectionId,
        startLine: getNodeStartLine(node),
        endLine: getNodeEndLine(node),
      })
    }
  })

  return codeBlocks
}

// ============================================================================
// Main Parser Function
// ============================================================================

export interface ParseOptions {
  readonly path?: string
  readonly lastModified?: Date
}

export const formatMalformedFrontmatterWarning = (
  path: string,
  message: string,
): string =>
  `Malformed frontmatter in ${path}, skipping: ${message.split('\n')[0]} (run \`mdm fix --write ${path}\` to repair)`

export const parse = (
  content: string,
  options: ParseOptions = {},
): Effect.Effect<MdDocument, ParseError> =>
  Effect.gen(function* () {
    const path = options.path ?? 'unknown'
    const docId = generateId(path)
    const now = new Date()

    // Extract frontmatter (graceful handling for malformed YAML)
    let frontmatter: Record<string, unknown> = {}
    let markdownContent: string = content

    try {
      const parsed = matter(content)
      frontmatter = parsed.data
      markdownContent = parsed.content
    } catch (error) {
      const frontmatterMatch = FRONTMATTER_RE.exec(content)
      if (frontmatterMatch) {
        frontmatter = recoverFrontmatter(frontmatterMatch[1] ?? '')
        markdownContent = content.slice(frontmatterMatch[0].length)
      }
      const msg = error instanceof Error ? error.message : String(error)
      yield* Effect.logWarning(formatMalformedFrontmatterWarning(path, msg))
    }

    // Parse markdown to AST
    const tree = processor.parse(markdownContent) as Root

    // Split content into lines for reference
    const lines = markdownContent.split('\n')

    // Extract sections
    const rawSections = extractRawSections(tree)
    const sections = buildSectionHierarchy(rawSections, docId, lines)

    // Extract links and code blocks
    const links = extractLinks(tree, docId)
    const codeBlocks = extractCodeBlocks(tree, docId)

    // Determine title (first H1 or filename)
    const firstH1 = sections.find((s) => s.level === 1)
    const title =
      firstH1?.heading ??
      (typeof frontmatter.title === 'string' ? frontmatter.title : null) ??
      path.split('/').pop()?.replace(/\.md$/, '') ??
      'Untitled'

    // Calculate metadata
    const totalContent = sections.map((s) => s.content).join('\n')
    const metadata: DocumentMetadata = {
      wordCount: countWords(totalContent),
      tokenCount: countTokensApprox(content),
      headingCount: countAllSections(sections),
      linkCount: links.length,
      codeBlockCount: codeBlocks.length,
      lastModified: options.lastModified ?? now,
      indexedAt: now,
    }

    const document: MdDocument = {
      id: docId,
      path,
      title,
      frontmatter,
      sections,
      links,
      codeBlocks,
      metadata,
    }

    return document
  })

/**
 * Parse a markdown file from the filesystem
 *
 * @throws ParseError - File content cannot be parsed
 * @throws FileReadError - File cannot be read from filesystem
 */
export const parseFile = (
  filePath: string,
): Effect.Effect<MdDocument, ParseError | FileReadError> =>
  Effect.gen(function* () {
    const fs = yield* Effect.promise(() => import('node:fs/promises'))

    const [content, stats] = yield* Effect.tryPromise({
      try: () =>
        Promise.all([
          fs.readFile(filePath, 'utf-8'),
          fs.stat(filePath),
        ] as const),
      catch: (error) =>
        new FileReadError({
          path: filePath,
          message: error instanceof Error ? error.message : 'Unknown error',
          cause: error,
        }),
    })

    return yield* parse(content, {
      path: filePath,
      lastModified: stats.mtime,
    })
  })
