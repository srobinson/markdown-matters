/**
 * MCP tool definitions.
 *
 * Declares the shape of each tool exposed to MCP clients (name, description,
 * input schema). Handler implementations live in handlers.ts.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export const tools: Tool[] = [
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
          enum: ['brief', 'summary', 'full'],
          description: 'Compression level (default: brief)',
          default: 'brief',
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
          description:
            'Filter by heading pattern (regex, max 200 chars; nested quantifiers rejected)',
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
      'Refresh the active database from every manifest directory. An optional path is appended to the manifest before the full refresh.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Directory to append before refreshing. Omit to refresh the existing manifest.',
        },
        force: {
          type: 'boolean',
          description:
            'Bypass mtime/hash cache and re-process every file. Does not delete the index directory. (default: false)',
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
