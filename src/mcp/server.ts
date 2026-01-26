#!/usr/bin/env node

/**
 * MCP Server for mdcontext
 *
 * Exposes markdown analysis tools for Claude integration
 */

import { createRequire } from 'node:module'
import * as path from 'node:path'

// Read version from package.json using createRequire for ESM compatibility
const require = createRequire(import.meta.url)
const packageJson = require('../../package.json') as { version: string }
const MCP_VERSION: string = packageJson.version

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { Effect } from 'effect'
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

// Type alias for tool results - uses the SDK type

// ============================================================================
// Tool Definitions
// ============================================================================

const tools: Tool[] = [
  {
    name: 'md_search',
    description:
      'Search markdown documents by meaning using semantic search. Returns relevant sections based on natural language queries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5)',
          default: 5,
        },
        path_filter: {
          type: 'string',
          description:
            "Glob pattern to filter files (e.g., '*.md', 'docs/**/*.md')",
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity threshold 0-1 (default: 0.35)',
          default: 0.35,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'md_context',
    description:
      'Get LLM-ready context from a markdown file. Provides compressed, token-efficient summaries at various detail levels.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the markdown file',
        },
        level: {
          type: 'string',
          enum: ['full', 'summary', 'brief'],
          description: 'Compression level (default: summary)',
          default: 'summary',
        },
        max_tokens: {
          type: 'number',
          description: 'Maximum tokens to include in output',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'md_structure',
    description:
      'Get the structure/outline of a markdown file. Shows heading hierarchy with token counts.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the markdown file',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'md_keyword_search',
    description:
      'Search markdown documents by keyword search (headings, code blocks, lists, tables).',
    inputSchema: {
      type: 'object',
      properties: {
        heading: {
          type: 'string',
          description: 'Filter by heading pattern (regex)',
        },
        path_filter: {
          type: 'string',
          description: 'Glob pattern to filter files',
        },
        has_code: {
          type: 'boolean',
          description: 'Only sections with code blocks',
        },
        has_list: {
          type: 'boolean',
          description: 'Only sections with lists',
        },
        has_table: {
          type: 'boolean',
          description: 'Only sections with tables',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'md_index',
    description:
      'Build or rebuild the index for a directory. Required before using search tools.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to index (default: current directory)',
          default: '.',
        },
        force: {
          type: 'boolean',
          description: 'Force full rebuild (default: false)',
          default: false,
        },
      },
    },
  },
  {
    name: 'md_links',
    description:
      'Get outgoing links from a markdown file. Shows what files this document references/links to.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the markdown file',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'md_backlinks',
    description:
      'Get incoming links to a markdown file. Shows what files reference/link to this document.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the markdown file',
        },
      },
      required: ['path'],
    },
  },
]

// ============================================================================
// Tool Handlers
// ============================================================================

const handleMdSearch = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const query = args.query as string
  const limit = (args.limit as number) ?? 5
  const pathFilter = args.path_filter as string | undefined
  const threshold = (args.threshold as number) ?? 0.35

  // Note: catchAll is intentional at this MCP boundary layer.
  // MCP protocol requires JSON error responses, so we convert typed errors
  // to { error: message } format for protocol compliance.
  const result = await Effect.runPromise(
    semanticSearch(rootPath, query, {
      limit,
      threshold,
      pathPattern: pathFilter,
    }).pipe(
      Effect.catchAll((e) => Effect.succeed([{ error: e.message }] as const)),
    ),
  )

  if (Array.isArray(result) && result.length > 0 && 'error' in result[0]) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${(result[0] as { error: string }).error}`,
        },
      ],
      isError: true,
    }
  }

  const formattedResults = (
    result as Array<{
      sectionId: string
      documentPath: string
      heading: string
      similarity: number
    }>
  ).map((r, i) => {
    const similarity = (r.similarity * 100).toFixed(1)
    return `${i + 1}. **${r.heading}** (${similarity}% match)\n   ${r.documentPath}`
  })

  return {
    content: [
      {
        type: 'text',
        text:
          formattedResults.length > 0
            ? `Found ${formattedResults.length} results for "${query}":\n\n${formattedResults.join('\n\n')}`
            : `No results found for "${query}"`,
      },
    ],
  }
}

const handleMdContext = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const filePath = args.path as string
  const level = (args.level as 'brief' | 'summary' | 'full') ?? 'summary'
  const maxTokens = args.max_tokens as number | undefined

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(rootPath, filePath)

  // Note: catchAll is intentional - MCP boundary converts errors to JSON format
  const result = await Effect.runPromise(
    summarizeFile(resolvedPath, { level, maxTokens }).pipe(
      Effect.catchAll((e) => Effect.succeed({ error: e.message })),
    ),
  )

  if ('error' in result) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
      isError: true,
    }
  }

  return {
    content: [{ type: 'text', text: formatSummary(result) }],
  }
}

const handleMdStructure = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const filePath = args.path as string
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(rootPath, filePath)

  // Note: catchAll is intentional - MCP boundary converts errors to JSON format
  const result = await Effect.runPromise(
    parseFile(resolvedPath).pipe(
      Effect.catchAll((e) => Effect.succeed({ error: e.message })),
    ),
  )

  if ('error' in result) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
      isError: true,
    }
  }

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

  return {
    content: [
      {
        type: 'text',
        text: `# ${result.title}\nPath: ${result.path}\nTotal tokens: ${result.metadata.tokenCount}\n\n${structure}`,
      },
    ],
  }
}

const handleMdKeywordSearch = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const heading = args.heading as string | undefined
  const pathFilter = args.path_filter as string | undefined
  const hasCode = args.has_code as boolean | undefined
  const hasList = args.has_list as boolean | undefined
  const hasTable = args.has_table as boolean | undefined
  const limit = (args.limit as number) ?? 20

  // Note: catchAll is intentional - MCP boundary converts errors to JSON format
  const result = await Effect.runPromise(
    search(rootPath, {
      heading,
      pathPattern: pathFilter,
      hasCode,
      hasList,
      hasTable,
      limit,
    }).pipe(
      Effect.catchAll((e) => Effect.succeed([{ error: e.message }] as const)),
    ),
  )

  if (Array.isArray(result) && result.length > 0 && 'error' in result[0]) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${(result[0] as { error: string }).error}`,
        },
      ],
      isError: true,
    }
  }

  const formattedResults = (
    result as Array<{
      section: {
        heading: string
        level: number
        documentPath: string
        tokenCount: number
        hasCode: boolean
        hasList: boolean
        hasTable: boolean
      }
    }>
  ).map((r, i) => {
    const meta: string[] = []
    if (r.section.hasCode) meta.push('code')
    if (r.section.hasList) meta.push('list')
    if (r.section.hasTable) meta.push('table')
    const metaStr = meta.length > 0 ? ` [${meta.join(', ')}]` : ''

    return `${i + 1}. **${r.section.heading}**${metaStr}\n   ${r.section.documentPath} (${r.section.tokenCount} tokens)`
  })

  return {
    content: [
      {
        type: 'text',
        text:
          formattedResults.length > 0
            ? `Found ${formattedResults.length} sections:\n\n${formattedResults.join('\n\n')}`
            : 'No sections found matching criteria',
      },
    ],
  }
}

const handleMdIndex = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const indexPath = (args.path as string) ?? '.'
  const force = (args.force as boolean) ?? false

  const resolvedPath = path.isAbsolute(indexPath)
    ? indexPath
    : path.join(rootPath, indexPath)

  // Note: catchAll is intentional - MCP boundary converts errors to JSON format
  const result = await Effect.runPromise(
    buildIndex(resolvedPath, { force }).pipe(
      Effect.catchAll((e) => Effect.succeed({ error: e.message })),
    ),
  )

  if ('error' in result) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
      isError: true,
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: `Indexed ${result.documentsIndexed} documents, ${result.sectionsIndexed} sections, ${result.linksIndexed} links in ${result.duration}ms`,
      },
    ],
  }
}

const handleMdLinks = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const filePath = args.path as string
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(rootPath, filePath)

  // Note: catchAll is intentional - MCP boundary converts errors to JSON format
  const result = await Effect.runPromise(
    getOutgoingLinks(rootPath, resolvedPath).pipe(
      Effect.catchAll((e) => Effect.succeed({ error: e.message })),
    ),
  )

  if ('error' in result) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
      isError: true,
    }
  }

  const links = result as readonly string[]
  const relativePath = path.relative(rootPath, resolvedPath)

  return {
    content: [
      {
        type: 'text',
        text:
          links.length > 0
            ? `Outgoing links from ${relativePath}:\n\n${links.map((l) => `  -> ${l}`).join('\n')}\n\nTotal: ${links.length} links`
            : `No outgoing links from ${relativePath}`,
      },
    ],
  }
}

const handleMdBacklinks = async (
  args: Record<string, unknown>,
  rootPath: string,
): Promise<CallToolResult> => {
  const filePath = args.path as string
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(rootPath, filePath)

  // Note: catchAll is intentional - MCP boundary converts errors to JSON format
  const result = await Effect.runPromise(
    getIncomingLinks(rootPath, resolvedPath).pipe(
      Effect.catchAll((e) => Effect.succeed({ error: e.message })),
    ),
  )

  if ('error' in result) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
      isError: true,
    }
  }

  const links = result as readonly string[]
  const relativePath = path.relative(rootPath, resolvedPath)

  return {
    content: [
      {
        type: 'text',
        text:
          links.length > 0
            ? `Incoming links to ${relativePath}:\n\n${links.map((l) => `  <- ${l}`).join('\n')}\n\nTotal: ${links.length} backlinks`
            : `No incoming links to ${relativePath}`,
      },
    ],
  }
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const createServer = (rootPath: string) => {
  const server = new Server(
    {
      name: 'mdcontext-mcp',
      version: MCP_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }))

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    switch (name) {
      case 'md_search':
        return handleMdSearch(args ?? {}, rootPath)
      case 'md_context':
        return handleMdContext(args ?? {}, rootPath)
      case 'md_structure':
        return handleMdStructure(args ?? {}, rootPath)
      case 'md_keyword_search':
        return handleMdKeywordSearch(args ?? {}, rootPath)
      case 'md_index':
        return handleMdIndex(args ?? {}, rootPath)
      case 'md_links':
        return handleMdLinks(args ?? {}, rootPath)
      case 'md_backlinks':
        return handleMdBacklinks(args ?? {}, rootPath)
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        }
    }
  })

  return server
}

// ============================================================================
// Main Entry
// ============================================================================

const main = async () => {
  // Use current working directory as root
  const rootPath = process.cwd()

  const server = createServer(rootPath)
  const transport = new StdioServerTransport()

  await server.connect(transport)

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await server.close()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
