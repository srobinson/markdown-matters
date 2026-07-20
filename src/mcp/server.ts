#!/usr/bin/env node

/**
 * MCP Server for mdm.
 *
 * Wires tool definitions, handlers, and transport together. Handler
 * implementations, input schemas, and the Effect-to-MCP adapter live
 * in their own modules under src/mcp/.
 */

import { createRequire } from 'node:module'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { Effect } from 'effect'
import { load } from '../config/loader.js'
import type { MdmConfig } from '../config/schema.js'
import { defaultConfig } from '../config/schema.js'
import { scheduleGenerationReap } from '../db/generation-reaper.js'
import { resolveMdmHome } from '../home.js'
import { registerDefaultProviders } from '../providers/index.js'

import {
  handleMdBacklinks,
  handleMdIndex,
  handleMdKeywordSearch,
  handleMdLinks,
  handleMdm,
  handleMdSearch,
  handleMdStructure,
} from './handlers.js'
import { tools } from './tools.js'

// Re-export for backwards compatibility (tests import from server.ts)
export { resolveAndValidatePath } from './adapter.js'

// Read version from package.json using createRequire for ESM compatibility
const require = createRequire(import.meta.url)
const packageJson = require('../../package.json') as { version: string }
const MCP_VERSION: string = packageJson.version

// ============================================================================
// MCP Server Setup
// ============================================================================

/**
 * Bootstrap the provider runtime, then build the MCP server.
 *
 * Splits the bootstrap-and-create pair out of `main()` so the server
 * entrypoint's runtime initialization is directly reachable from
 * tests without wiring `StdioServerTransport`. `main()` is the
 * production caller and connects the returned server to stdio.
 *
 * Mirrors the CLI entrypoint (`src/cli/main.ts:122-126`) which runs
 * `registerDefaultProviders` before dispatching any command. The
 * bootstrap never fails: missing credentials produce skipped
 * registrations that surface as actionable `MissingApiKey` at
 * tool-invocation time rather than `ProviderNotFound`.
 */
export const startMcpServer = async (
  rootPath: string,
  config: MdmConfig,
): Promise<Server> => {
  scheduleGenerationReap(resolveMdmHome())
  await Effect.runPromise(registerDefaultProviders())
  return createServer(rootPath, config)
}

export const createServer = (rootPath: string, config: MdmConfig) => {
  const server = new Server(
    {
      name: 'mdm-mcp',
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
        return handleMdSearch(args ?? {}, rootPath, config)
      case 'md_context':
        return handleMdm(args ?? {}, rootPath)
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

/**
 * Load configuration using the standard precedence chain:
 * env vars > config file > defaults.
 *
 * MCP has no CLI flags, so cliOverrides is omitted.
 * Falls back to defaults on any config loading error to keep the
 * server operational even with a missing or malformed config file.
 */
export const loadConfig = (rootPath: string): MdmConfig => {
  try {
    return load({ workingDir: rootPath })
  } catch (error) {
    console.error(`[mdm] Config loading failed, using defaults: ${error}`)
    return defaultConfig
  }
}

const main = async () => {
  // Use current working directory as root
  const rootPath = process.cwd()

  // Load config: env vars > config file > defaults
  const config = await loadConfig(rootPath)

  // Bootstrap provider runtime and construct the server. The helper
  // is the tested unit (src/mcp/server.test.ts) so the regression
  // that produced ALP-1713 (empty registry → ProviderNotFound on
  // md_search) cannot return silently.
  const server = await startMcpServer(rootPath, config)
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
