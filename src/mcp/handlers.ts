/**
 * MCP tool handler implementations.
 *
 * Each handler validates input via Effect Schema, runs the underlying
 * Effect pipeline, and converts the result to a CallToolResult using
 * the shared adapter from adapter.ts.
 */

import * as path from 'node:path'

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Option } from 'effect'

import type { MdmConfig } from '../config/schema.js'
import type { MdSection } from '../core/types.js'
import { semanticSearch } from '../embeddings/semantic-search.js'
import {
  buildIndex,
  getIncomingLinks,
  getOutgoingLinks,
} from '../index/indexer.js'
import { parseFile } from '../parser/parser.js'
import { search } from '../search/searcher.js'
import { formatSummary, summarizeFile } from '../summarize/summarizer.js'
import {
  effectToMcpResult,
  isPathError,
  isValidationError,
  mcpText,
  resolveAndValidatePath,
  validateArgs,
} from './adapter.js'
import {
  MdBacklinksArgs,
  MdIndexArgs,
  MdKeywordSearchArgs,
  MdLinksArgs,
  MdmArgs,
  MdSearchArgs,
  MdStructureArgs,
} from './schemas.js'

// ============================================================================
// Handler: md_search
// ============================================================================

export const handleMdSearch = async (
  args: Record<string, unknown>,
  rootPath: string,
  config: MdmConfig,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdSearchArgs, args)
  if (isValidationError(validated)) return validated

  const query = validated.query
  const limit = validated.limit ?? 5
  const pathFilter = validated.path_filter
  const threshold = validated.threshold ?? config.search.minSimilarity

  const providerConfig = {
    provider: config.embeddings.provider,
    baseURL: Option.getOrUndefined(config.embeddings.baseURL),
    model: config.embeddings.model,
  }

  return effectToMcpResult(
    semanticSearch(rootPath, query, {
      limit,
      threshold,
      pathPattern: pathFilter,
      providerConfig,
    }),
    (results) => {
      const formatted = results.map((r, i) => {
        const similarity = (r.similarity * 100).toFixed(1)
        return `${i + 1}. **${r.heading}** (${similarity}% match)\n   ${r.documentPath}`
      })

      return mcpText(
        formatted.length > 0
          ? `Found ${formatted.length} results for "${query}":\n\n${formatted.join('\n\n')}`
          : `No results found for "${query}"`,
      )
    },
  )
}

// ============================================================================
// Handler: md_context
// ============================================================================

export const handleMdm = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdmArgs, args)
  if (isValidationError(validated)) return validated

  const filePath = validated.path
  const level = validated.level ?? 'summary'
  const maxTokens = validated.max_tokens

  const resolvedPath = await resolveAndValidatePath(rootPath, filePath)
  if (isPathError(resolvedPath)) return resolvedPath

  return effectToMcpResult(
    summarizeFile(resolvedPath, { level, maxTokens }),
    (result) => mcpText(formatSummary(result)),
  )
}

// ============================================================================
// Handler: md_structure
// ============================================================================

export const handleMdStructure = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdStructureArgs, args)
  if (isValidationError(validated)) return validated

  const filePath = validated.path
  const resolvedPath = await resolveAndValidatePath(rootPath, filePath)
  if (isPathError(resolvedPath)) return resolvedPath

  return effectToMcpResult(parseFile(resolvedPath), (result) => {
    const formatSection = (section: MdSection, depth: number = 0): string => {
      const indent = '  '.repeat(depth)
      const marker = '#'.repeat(section.level)
      const meta: string[] = []
      if (section.metadata.hasCode) meta.push('code')
      if (section.metadata.hasList) meta.push('list')
      if (section.metadata.hasTable) meta.push('table')
      const metaStr = meta.length > 0 ? ` [${meta.join(', ')}]` : ''

      let output = `${indent}${marker} ${section.heading}${metaStr} (${section.metadata.tokenCount} tokens)\n`

      for (const child of section.children) {
        output += formatSection(child, depth + 1)
      }

      return output
    }

    const structure = result.sections.map((s) => formatSection(s)).join('')

    return mcpText(
      `# ${result.title}\nPath: ${result.path}\nTotal tokens: ${result.metadata.tokenCount}\n\n${structure}`,
    )
  })
}

// ============================================================================
// Handler: md_keyword_search
// ============================================================================

export const handleMdKeywordSearch = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdKeywordSearchArgs, args)
  if (isValidationError(validated)) return validated

  const heading = validated.heading
  const pathFilter = validated.path_filter
  const hasCode = validated.has_code
  const hasList = validated.has_list
  const hasTable = validated.has_table
  const limit = validated.limit ?? 20

  return effectToMcpResult(
    search(rootPath, {
      heading,
      pathPattern: pathFilter,
      hasCode,
      hasList,
      hasTable,
      limit,
    }),
    (results) => {
      const formatted = results.map((r, i) => {
        const meta: string[] = []
        if (r.section.hasCode) meta.push('code')
        if (r.section.hasList) meta.push('list')
        if (r.section.hasTable) meta.push('table')
        const metaStr = meta.length > 0 ? ` [${meta.join(', ')}]` : ''

        return `${i + 1}. **${r.section.heading}**${metaStr}\n   ${r.section.documentPath} (${r.section.tokenCount} tokens)`
      })

      return mcpText(
        formatted.length > 0
          ? `Found ${formatted.length} sections:\n\n${formatted.join('\n\n')}`
          : 'No sections found matching criteria',
      )
    },
  )
}

// ============================================================================
// Handler: md_index
// ============================================================================

export const handleMdIndex = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdIndexArgs, args)
  if (isValidationError(validated)) return validated

  const indexPath = validated.path ?? '.'
  const force = validated.force ?? false

  const resolvedPath = await resolveAndValidatePath(rootPath, indexPath)
  if (isPathError(resolvedPath)) return resolvedPath

  return effectToMcpResult(buildIndex(resolvedPath, { force }), (result) =>
    mcpText(
      `Indexed ${result.documentsIndexed} documents, ${result.sectionsIndexed} sections, ${result.linksIndexed} links in ${result.duration}ms`,
    ),
  )
}

// ============================================================================
// Handler: md_links
// ============================================================================

export const handleMdLinks = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdLinksArgs, args)
  if (isValidationError(validated)) return validated

  const filePath = validated.path
  const resolvedPath = await resolveAndValidatePath(rootPath, filePath)
  if (isPathError(resolvedPath)) return resolvedPath

  return effectToMcpResult(
    getOutgoingLinks(rootPath, resolvedPath),
    (links) => {
      const relativePath = path.relative(rootPath, resolvedPath)
      return mcpText(
        links.length > 0
          ? `Outgoing links from ${relativePath}:\n\n${links.map((l) => `  -> ${l}`).join('\n')}\n\nTotal: ${links.length} links`
          : `No outgoing links from ${relativePath}`,
      )
    },
  )
}

// ============================================================================
// Handler: md_backlinks
// ============================================================================

export const handleMdBacklinks = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdBacklinksArgs, args)
  if (isValidationError(validated)) return validated

  const filePath = validated.path
  const resolvedPath = await resolveAndValidatePath(rootPath, filePath)
  if (isPathError(resolvedPath)) return resolvedPath

  return effectToMcpResult(
    getIncomingLinks(rootPath, resolvedPath),
    (links) => {
      const relativePath = path.relative(rootPath, resolvedPath)
      return mcpText(
        links.length > 0
          ? `Incoming links to ${relativePath}:\n\n${links.map((l) => `  <- ${l}`).join('\n')}\n\nTotal: ${links.length} backlinks`
          : `No incoming links to ${relativePath}`,
      )
    },
  )
}
