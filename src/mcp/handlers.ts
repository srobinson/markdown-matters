/**
 * MCP tool handler implementations.
 *
 * Each handler validates input via Effect Schema, runs the underlying
 * Effect pipeline, and converts the result to a CallToolResult using
 * the shared adapter from adapter.ts.
 */

import * as path from 'node:path'

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Effect, Either } from 'effect'

import type { MdmConfig } from '../config/schema.js'
import type { MdSection } from '../core/types.js'
import { expandDeclaredPath } from '../db/canonical.js'
import { withCurrentGeneration } from '../db/generation-reader.js'
import { resolveQueryProviderConfig } from '../embeddings/query-provider-config.js'
import { semanticSearch } from '../embeddings/semantic-search.js'
import { resolveMdmHome } from '../home.js'
import {
  getIncomingLinks,
  getOutgoingLinks,
  refreshManifestIndex,
} from '../index/indexer.js'
import { parseFile } from '../parser/parser.js'
import {
  buildEmptySearchGuidance,
  formatReadGuidance,
} from '../read-guidance.js'
import { inspectCorpus } from '../search/path-matcher.js'
import { search } from '../search/searcher.js'
import { formatSummary, summarizeFile } from '../summarize/summarizer.js'
import {
  effectToMcpResult,
  isPathError,
  isValidationError,
  mcpError,
  mcpText,
  resolveAndValidatePath,
  validateArgs,
} from './adapter.js'
import { resolveMcpDocumentPath } from './path-resolution.js'
import {
  MdBacklinksArgs,
  MdIndexArgs,
  MdKeywordSearchArgs,
  MdLinksArgs,
  MdmArgs,
  MdSearchArgs,
  MdStructureArgs,
} from './schemas.js'

const formatSearchOutcome = <A, E>(
  session: Parameters<typeof inspectCorpus>[0],
  sourceRoot: string,
  query: string,
  pathFilter: string | undefined,
  searchEffect: Effect.Effect<readonly A[], E>,
  formatSuccess: (results: readonly A[]) => CallToolResult,
) =>
  Effect.gen(function* () {
    const outcome = yield* Effect.either(searchEffect)
    if (Either.isLeft(outcome)) {
      const inspected = yield* Effect.either(
        inspectCorpus(session, sourceRoot, pathFilter),
      )
      if (Either.isRight(inspected) && inspected.right.documentCount === 0) {
        return mcpError(
          formatReadGuidance(
            buildEmptySearchGuidance(inspected.right, query, pathFilter),
          ),
        )
      }
      return yield* Effect.fail(outcome.left)
    }
    if (outcome.right.length > 0) return formatSuccess(outcome.right)

    const inspection = yield* inspectCorpus(session, sourceRoot, pathFilter)
    return mcpText(
      formatReadGuidance(
        buildEmptySearchGuidance(inspection, query, pathFilter),
      ),
    )
  })

const keywordQueryLabel = (options: {
  readonly heading?: string | undefined
  readonly hasCode?: boolean | undefined
  readonly hasList?: boolean | undefined
  readonly hasTable?: boolean | undefined
}): string => {
  if (options.heading !== undefined) return options.heading
  const criteria = [
    ['has_code', options.hasCode],
    ['has_list', options.hasList],
    ['has_table', options.hasTable],
  ]
    .filter((entry): entry is [string, boolean] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${value}`)
  return criteria.length > 0 ? criteria.join(', ') : 'requested criteria'
}

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

  return effectToMcpResult(
    withCurrentGeneration(resolveMdmHome(), (session) =>
      formatSearchOutcome(
        session,
        rootPath,
        query,
        pathFilter,
        Effect.gen(function* () {
          const queryProvider = yield* resolveQueryProviderConfig(
            session,
            config.embeddings,
          )
          return yield* semanticSearch(session, rootPath, query, {
            limit,
            threshold,
            pathPattern: pathFilter,
            providerConfig: queryProvider.providerConfig,
            activeProvider: queryProvider.activeProvider,
          })
        }),
        (results) => {
          const formatted = results.map((r, i) => {
            const similarity = (r.similarity * 100).toFixed(1)
            return `${i + 1}. **${r.heading}** (${similarity}% match)\n   ${r.documentPath}`
          })

          return mcpText(
            `Found ${formatted.length} results for "${query}":\n\n${formatted.join('\n\n')}`,
          )
        },
      ),
    ),
    (result) => result,
  )
}

// ============================================================================
// Handler: context (md_context MCP tool)
// ============================================================================

export const handleMdm = async (
  args: Record<string, unknown>,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdmArgs, args)
  if (isValidationError(validated)) return validated

  const filePath = validated.path
  const level = validated.level ?? 'brief'

  return effectToMcpResult(
    withCurrentGeneration(resolveMdmHome(), (session) =>
      resolveMcpDocumentPath(session, filePath).pipe(
        Effect.flatMap((resolvedPath) =>
          summarizeFile(resolvedPath, { level }),
        ),
      ),
    ),
    (result) => mcpText(formatSummary(result)),
  )
}

// ============================================================================
// Handler: md_structure
// ============================================================================

export const handleMdStructure = async (
  args: Record<string, unknown>,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdStructureArgs, args)
  if (isValidationError(validated)) return validated

  const filePath = validated.path

  return effectToMcpResult(
    withCurrentGeneration(resolveMdmHome(), (session) =>
      resolveMcpDocumentPath(session, filePath).pipe(Effect.flatMap(parseFile)),
    ),
    (result) => {
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
    },
  )
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
    withCurrentGeneration(resolveMdmHome(), (session) =>
      formatSearchOutcome(
        session,
        rootPath,
        keywordQueryLabel({ heading, hasCode, hasList, hasTable }),
        pathFilter,
        search(session, rootPath, {
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
            `Found ${formatted.length} sections:\n\n${formatted.join('\n\n')}`,
          )
        },
      ),
    ),
    (result) => result,
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

  const force = validated.force ?? false
  let requestedPath: string | undefined

  if (validated.path !== undefined) {
    requestedPath = expandDeclaredPath(
      path.isAbsolute(validated.path) || validated.path.startsWith('~')
        ? validated.path
        : path.resolve(rootPath, validated.path),
    )
    const validation = await resolveAndValidatePath(rootPath, requestedPath)
    if (isPathError(validation)) return validation
  }

  const home = resolveMdmHome({ create: true })

  return effectToMcpResult(
    refreshManifestIndex(home, requestedPath, {
      force,
    }),
    (published) =>
      mcpText(
        `Indexed ${published.value.documentsIndexed} documents, ${published.value.sectionsIndexed} sections, ${published.value.linksIndexed} links in ${published.value.duration}ms`,
      ),
  )
}

// ============================================================================
// Handler: md_links
// ============================================================================

export const handleMdLinks = async (
  args: Record<string, unknown>,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdLinksArgs, args)
  if (isValidationError(validated)) return validated

  const filePath = validated.path
  return effectToMcpResult(
    withCurrentGeneration(resolveMdmHome(), (session) =>
      resolveMcpDocumentPath(session, filePath).pipe(
        Effect.flatMap((resolvedPath) =>
          getOutgoingLinks(session, resolvedPath).pipe(
            Effect.map((links) => ({ links, resolvedPath })),
          ),
        ),
        Effect.map(({ links, resolvedPath }) => {
          return mcpText(
            links.length > 0
              ? `Outgoing links from ${resolvedPath}:\n\n${links.map((l) => `  -> ${l}`).join('\n')}\n\nTotal: ${links.length} links`
              : `No outgoing links from ${resolvedPath}`,
          )
        }),
      ),
    ),
    (result) => result,
  )
}

// ============================================================================
// Handler: md_backlinks
// ============================================================================

export const handleMdBacklinks = async (
  args: Record<string, unknown>,
): Promise<CallToolResult> => {
  const validated = await validateArgs(MdBacklinksArgs, args)
  if (isValidationError(validated)) return validated

  const filePath = validated.path
  return effectToMcpResult(
    withCurrentGeneration(resolveMdmHome(), (session) =>
      resolveMcpDocumentPath(session, filePath).pipe(
        Effect.flatMap((resolvedPath) =>
          getIncomingLinks(session, resolvedPath).pipe(
            Effect.map((links) => ({ links, resolvedPath })),
          ),
        ),
        Effect.map(({ links, resolvedPath }) => {
          return mcpText(
            links.length > 0
              ? `Incoming links to ${resolvedPath}:\n\n${links.map((l) => `  <- ${l}`).join('\n')}\n\nTotal: ${links.length} backlinks`
              : `No incoming links to ${resolvedPath}`,
          )
        }),
      ),
    ),
    (result) => result,
  )
}
