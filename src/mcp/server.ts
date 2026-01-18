#!/usr/bin/env node
/**
 * MCP Server for md-tldr
 *
 * Exposes markdown analysis tools for Claude integration
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import * as path from "node:path";

import { parseFile } from "../parser/parser.js";
import { buildIndex } from "../index/indexer.js";
import { search } from "../search/searcher.js";
import { semanticSearch } from "../embeddings/semantic-search.js";
import { summarizeFile, formatSummary } from "../summarize/summarizer.js";
import type { MdSection } from "../core/types.js";

// Type alias for tool results - uses the SDK type

// ============================================================================
// Tool Definitions
// ============================================================================

const tools: Tool[] = [
  {
    name: "md_search",
    description:
      "Search markdown documents by meaning using semantic search. Returns relevant sections based on natural language queries.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 5)",
          default: 5,
        },
        path_filter: {
          type: "string",
          description: "Glob pattern to filter files (e.g., '*.md', 'docs/**/*.md')",
        },
        threshold: {
          type: "number",
          description: "Minimum similarity threshold 0-1 (default: 0.5)",
          default: 0.5,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "md_context",
    description:
      "Get LLM-ready context from a markdown file. Provides compressed, token-efficient summaries at various detail levels.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the markdown file",
        },
        level: {
          type: "string",
          enum: ["full", "summary", "brief"],
          description: "Compression level (default: summary)",
          default: "summary",
        },
        max_tokens: {
          type: "number",
          description: "Maximum tokens to include in output",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "md_structure",
    description:
      "Get the structure/outline of a markdown file. Shows heading hierarchy with token counts.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the markdown file",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "md_structural_search",
    description:
      "Search markdown documents by structure (headings, code blocks, lists, tables).",
    inputSchema: {
      type: "object",
      properties: {
        heading: {
          type: "string",
          description: "Filter by heading pattern (regex)",
        },
        path_filter: {
          type: "string",
          description: "Glob pattern to filter files",
        },
        has_code: {
          type: "boolean",
          description: "Only sections with code blocks",
        },
        has_list: {
          type: "boolean",
          description: "Only sections with lists",
        },
        has_table: {
          type: "boolean",
          description: "Only sections with tables",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 20)",
          default: 20,
        },
      },
    },
  },
  {
    name: "md_index",
    description:
      "Build or rebuild the index for a directory. Required before using search tools.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory to index (default: current directory)",
          default: ".",
        },
        force: {
          type: "boolean",
          description: "Force full rebuild (default: false)",
          default: false,
        },
      },
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

const handleMdSearch = async (
  args: Record<string, unknown>,
  rootPath: string
): Promise<CallToolResult> => {
  const query = args.query as string;
  const limit = (args.limit as number) ?? 5;
  const pathFilter = args.path_filter as string | undefined;
  const threshold = (args.threshold as number) ?? 0.5;

  const result = await Effect.runPromise(
    semanticSearch(rootPath, query, {
      limit,
      threshold,
      pathPattern: pathFilter,
    }).pipe(
      Effect.catchAll((e) =>
        Effect.succeed([{ error: e.message }] as const)
      )
    )
  );

  if (Array.isArray(result) && result.length > 0 && "error" in result[0]) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${(result[0] as { error: string }).error}`,
        },
      ],
      isError: true,
    };
  }

  const formattedResults = (result as Array<{
    sectionId: string;
    documentPath: string;
    heading: string;
    similarity: number;
  }>).map((r, i) => {
    const similarity = (r.similarity * 100).toFixed(1);
    return `${i + 1}. **${r.heading}** (${similarity}% match)\n   ${r.documentPath}`;
  });

  return {
    content: [
      {
        type: "text",
        text:
          formattedResults.length > 0
            ? `Found ${formattedResults.length} results for "${query}":\n\n${formattedResults.join("\n\n")}`
            : `No results found for "${query}"`,
      },
    ],
  };
};

const handleMdContext = async (
  args: Record<string, unknown>,
  rootPath: string
): Promise<CallToolResult> => {
  const filePath = args.path as string;
  const level = (args.level as "brief" | "summary" | "full") ?? "summary";
  const maxTokens = args.max_tokens as number | undefined;

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(rootPath, filePath);

  const result = await Effect.runPromise(
    summarizeFile(resolvedPath, { level, maxTokens }).pipe(
      Effect.catchAll((e) => Effect.succeed({ error: e.message }))
    )
  );

  if ("error" in result) {
    return {
      content: [{ type: "text", text: `Error: ${result.error}` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: formatSummary(result) }],
  };
};

const handleMdStructure = async (
  args: Record<string, unknown>,
  rootPath: string
): Promise<CallToolResult> => {
  const filePath = args.path as string;
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(rootPath, filePath);

  const result = await Effect.runPromise(
    parseFile(resolvedPath).pipe(
      Effect.mapError((e) => new Error(`${e._tag}: ${e.message}`)),
      Effect.catchAll((e) => Effect.succeed({ error: e.message }))
    )
  );

  if ("error" in result) {
    return {
      content: [{ type: "text", text: `Error: ${result.error}` }],
      isError: true,
    };
  }

  const formatSection = (section: MdSection, depth: number = 0): string => {
    const indent = "  ".repeat(depth);
    const marker = "#".repeat(section.level);
    const meta: string[] = [];
    if (section.metadata.hasCode) meta.push("code");
    if (section.metadata.hasList) meta.push("list");
    if (section.metadata.hasTable) meta.push("table");
    const metaStr = meta.length > 0 ? ` [${meta.join(", ")}]` : "";

    let output = `${indent}${marker} ${section.heading}${metaStr} (${section.metadata.tokenCount} tokens)\n`;

    for (const child of section.children) {
      output += formatSection(child, depth + 1);
    }

    return output;
  };

  const structure = result.sections.map((s) => formatSection(s)).join("");

  return {
    content: [
      {
        type: "text",
        text: `# ${result.title}\nPath: ${result.path}\nTotal tokens: ${result.metadata.tokenCount}\n\n${structure}`,
      },
    ],
  };
};

const handleMdStructuralSearch = async (
  args: Record<string, unknown>,
  rootPath: string
): Promise<CallToolResult> => {
  const heading = args.heading as string | undefined;
  const pathFilter = args.path_filter as string | undefined;
  const hasCode = args.has_code as boolean | undefined;
  const hasList = args.has_list as boolean | undefined;
  const hasTable = args.has_table as boolean | undefined;
  const limit = (args.limit as number) ?? 20;

  const result = await Effect.runPromise(
    search(rootPath, {
      heading,
      pathPattern: pathFilter,
      hasCode,
      hasList,
      hasTable,
      limit,
    }).pipe(
      Effect.catchAll((e) =>
        Effect.succeed([{ error: e.message }] as const)
      )
    )
  );

  if (Array.isArray(result) && result.length > 0 && "error" in result[0]) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${(result[0] as { error: string }).error}`,
        },
      ],
      isError: true,
    };
  }

  const formattedResults = (result as Array<{
    section: {
      heading: string;
      level: number;
      documentPath: string;
      tokenCount: number;
      hasCode: boolean;
      hasList: boolean;
      hasTable: boolean;
    };
  }>).map((r, i) => {
    const meta: string[] = [];
    if (r.section.hasCode) meta.push("code");
    if (r.section.hasList) meta.push("list");
    if (r.section.hasTable) meta.push("table");
    const metaStr = meta.length > 0 ? ` [${meta.join(", ")}]` : "";

    return `${i + 1}. **${r.section.heading}**${metaStr}\n   ${r.section.documentPath} (${r.section.tokenCount} tokens)`;
  });

  return {
    content: [
      {
        type: "text",
        text:
          formattedResults.length > 0
            ? `Found ${formattedResults.length} sections:\n\n${formattedResults.join("\n\n")}`
            : "No sections found matching criteria",
      },
    ],
  };
};

const handleMdIndex = async (
  args: Record<string, unknown>,
  rootPath: string
): Promise<CallToolResult> => {
  const indexPath = (args.path as string) ?? ".";
  const force = (args.force as boolean) ?? false;

  const resolvedPath = path.isAbsolute(indexPath)
    ? indexPath
    : path.join(rootPath, indexPath);

  const result = await Effect.runPromise(
    buildIndex(resolvedPath, { force }).pipe(
      Effect.catchAll((e) => Effect.succeed({ error: e.message }))
    )
  );

  if ("error" in result) {
    return {
      content: [{ type: "text", text: `Error: ${result.error}` }],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Indexed ${result.documentsIndexed} documents, ${result.sectionsIndexed} sections, ${result.linksIndexed} links in ${result.duration}ms`,
      },
    ],
  };
};

// ============================================================================
// MCP Server Setup
// ============================================================================

const createServer = (rootPath: string) => {
  const server = new Server(
    {
      name: "mdtldr-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "md_search":
        return handleMdSearch(args ?? {}, rootPath);
      case "md_context":
        return handleMdContext(args ?? {}, rootPath);
      case "md_structure":
        return handleMdStructure(args ?? {}, rootPath);
      case "md_structural_search":
        return handleMdStructuralSearch(args ?? {}, rootPath);
      case "md_index":
        return handleMdIndex(args ?? {}, rootPath);
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  });

  return server;
};

// ============================================================================
// Main Entry
// ============================================================================

const main = async () => {
  // Use current working directory as root
  const rootPath = process.cwd();

  const server = createServer(rootPath);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
