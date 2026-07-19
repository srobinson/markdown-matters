/**
 * MCP Server Test Suite
 *
 * Tests the MCP server through the protocol layer using InMemoryTransport.
 * Covers all 7 tools, input validation, path traversal security, and
 * ReDoS protection.
 */

import * as path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultConfig } from '../config/schema.js'
import { dbIndexDir, resolveMdmHome } from '../home.js'
import { buildIndex } from '../index/indexer.js'
import { resolveAndValidatePath, startMcpServer } from './server.js'

const FIXTURES_DIR = path.resolve(__dirname, '../../tests/fixtures/cli')

/** Extract the text from the first content block of a tool result. */
const getText = (result: Record<string, unknown>): string => {
  const items = result.content as Array<{ type: string; text: string }>
  return items[0]!.text
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a connected MCP client/server pair for testing. Uses
 * `startMcpServer` (matching the production entrypoint) so the provider
 * runtime is bootstrapped before the tightened `md_search` regression
 * test runs, rather than depending on the import-time side effect of
 * `main()`. InMemoryTransport keeps it stdio-free.
 */
const createTestClientServer = async (rootPath: string) => {
  const server = await startMcpServer(rootPath, defaultConfig)
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()

  await server.connect(serverTransport)

  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientTransport)

  return {
    client,
    server,
    cleanup: async () => {
      await client.close()
      await server.close()
    },
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('MCP Server', () => {
  let client: Client
  let cleanup: () => Promise<void>

  beforeAll(async () => {
    // Build an index for the fixture directory so search/links tools work
    await Effect.runPromise(
      buildIndex(FIXTURES_DIR, {
        indexRoot: dbIndexDir(resolveMdmHome()),
        force: true,
      }).pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            documentsIndexed: 0,
            sectionsIndexed: 0,
            linksIndexed: 0,
            duration: 0,
          }),
        ),
      ),
    )

    const pair = await createTestClientServer(FIXTURES_DIR)
    client = pair.client
    cleanup = pair.cleanup
  })

  afterAll(async () => {
    await cleanup()
  })

  // ==========================================================================
  // Tool Listing
  // ==========================================================================

  describe('listTools', () => {
    it('should return all 7 tools', async () => {
      const result = await client.listTools()
      const toolNames = result.tools.map((t) => t.name).sort()

      expect(toolNames).toEqual([
        'md_backlinks',
        'md_context',
        'md_index',
        'md_keyword_search',
        'md_links',
        'md_search',
        'md_structure',
      ])
    })

    it('each tool should have name, description, and inputSchema', async () => {
      const result = await client.listTools()

      for (const tool of result.tools) {
        expect(tool.name).toBeTruthy()
        expect(tool.description).toBeTruthy()
        expect(tool.inputSchema).toBeDefined()
        expect(tool.inputSchema.type).toBe('object')
      }
    })
  })

  // ==========================================================================
  // md_structure - Happy Path
  // ==========================================================================

  describe('md_structure', () => {
    it('should return structure for a valid file', async () => {
      const result = await client.callTool({
        name: 'md_structure',
        arguments: { path: 'README.md' },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Test Project')
      expect(text).toContain('tokens')
    })

    it('should return error for non-existent file', async () => {
      const result = await client.callTool({
        name: 'md_structure',
        arguments: { path: 'does-not-exist.md' },
      })

      expect(result.isError).toBe(true)
      const text = getText(result)
      expect(text).toContain('Error')
    })
  })

  // ==========================================================================
  // md_context - Happy Path
  // ==========================================================================

  describe('md_context', () => {
    it('should return context at summary level', async () => {
      const result = await client.callTool({
        name: 'md_context',
        arguments: { path: 'README.md', level: 'summary' },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toBeTruthy()
      expect(text.length).toBeGreaterThan(0)
    })

    it('should return context at brief level', async () => {
      const result = await client.callTool({
        name: 'md_context',
        arguments: { path: 'README.md', level: 'brief' },
      })

      expect(result.isError).toBeFalsy()
    })

    it('should return context at full level', async () => {
      const result = await client.callTool({
        name: 'md_context',
        arguments: { path: 'README.md', level: 'full' },
      })

      expect(result.isError).toBeFalsy()
    })

    it('should return error for non-existent file', async () => {
      const result = await client.callTool({
        name: 'md_context',
        arguments: { path: 'nonexistent.md' },
      })

      expect(result.isError).toBe(true)
    })
  })

  // ==========================================================================
  // md_keyword_search - Happy Path
  // ==========================================================================

  describe('md_keyword_search', () => {
    it('should search by heading pattern', async () => {
      const result = await client.callTool({
        name: 'md_keyword_search',
        arguments: { heading: 'Installation' },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Installation')
    })

    it('should filter sections with tables', async () => {
      const result = await client.callTool({
        name: 'md_keyword_search',
        arguments: { has_table: true },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      // api-reference.md has a table
      expect(text).toContain('Endpoints')
    })

    it('should return empty results for no match', async () => {
      const result = await client.callTool({
        name: 'md_keyword_search',
        arguments: { heading: 'zzz_nonexistent_heading_zzz' },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('No sections found')
    })

    it('should respect limit parameter', async () => {
      const result = await client.callTool({
        name: 'md_keyword_search',
        arguments: { limit: 1 },
      })

      expect(result.isError).toBeFalsy()
    })
  })

  // ==========================================================================
  // md_index - Happy Path
  // ==========================================================================

  describe('md_index', () => {
    it('should build index for current directory', async () => {
      const result = await client.callTool({
        name: 'md_index',
        arguments: { path: '.', force: true },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('Indexed')
      expect(text).toContain('documents')
    })

    it('should default path to current directory', async () => {
      const result = await client.callTool({
        name: 'md_index',
        arguments: {},
      })

      expect(result.isError).toBeFalsy()
    })
  })

  // ==========================================================================
  // md_links - Happy Path
  // ==========================================================================

  describe('md_links', () => {
    it('should return outgoing links from a file', async () => {
      const result = await client.callTool({
        name: 'md_links',
        arguments: { path: 'README.md' },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      // README.md links to getting-started.md
      expect(text).toContain('getting-started')
    })

    it('should return empty links for non-existent file', async () => {
      // Links lookup returns empty array (not error) for files not in the index
      const result = await client.callTool({
        name: 'md_links',
        arguments: { path: 'nonexistent.md' },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('No outgoing links')
    })
  })

  // ==========================================================================
  // md_backlinks - Happy Path
  // ==========================================================================

  describe('md_backlinks', () => {
    it('should return incoming links to a file', async () => {
      const result = await client.callTool({
        name: 'md_backlinks',
        arguments: { path: 'getting-started.md' },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toBeDefined()
    })

    it('should return empty backlinks for non-existent file', async () => {
      // Backlinks lookup returns empty array (not error) for files not in the index
      const result = await client.callTool({
        name: 'md_backlinks',
        arguments: { path: 'nonexistent.md' },
      })

      expect(result.isError).toBeFalsy()
      const text = getText(result)
      expect(text).toContain('No incoming links')
    })
  })

  // ==========================================================================
  // md_search (Semantic) - Basic Behavior
  // ==========================================================================

  describe('md_search', () => {
    it('does not surface the "(none registered)" registry-empty regression (ALP-1713)', async () => {
      // Before the fix, the MCP entrypoint never called
      // `registerDefaultProviders()`, so `md_search` resolved its
      // embedding client from an empty registry and returned
      // `Provider "openai" is not registered. Known providers: (none
      // registered).`
      //
      // Without tightening, the old "any string is success" assertion
      // accepted that error as a valid outcome and hid the regression.
      // The new assertion rejects the specific failure text while still
      // tolerating legitimate downstream errors (missing embeddings,
      // missing credentials, upstream provider faults).
      const result = await client.callTool({
        name: 'md_search',
        arguments: { query: 'getting started guide' },
      })
      const text = getText(result)
      expect(typeof text).toBe('string')
      expect(text).not.toMatch(/\(none registered\)/)
      expect(text).not.toMatch(/is not registered\. Known providers:/)
    })
  })

  // ==========================================================================
  // Unknown Tool
  // ==========================================================================

  describe('unknown tool', () => {
    it('should return error for unknown tool name', async () => {
      const result = await client.callTool({
        name: 'md_nonexistent_tool',
        arguments: {},
      })

      expect(result.isError).toBe(true)
      const text = getText(result)
      expect(text).toContain('Unknown tool')
    })
  })

  // ==========================================================================
  // Security: Path Traversal
  // ==========================================================================

  describe('security: path traversal', () => {
    // Path traversal returns a structured MCP tool error (isError: true)
    // rather than throwing, so clients receive a well-formed response
    // instead of a protocol-level rejection.

    it('should reject absolute paths outside root', async () => {
      const result = await client.callTool({
        name: 'md_context',
        arguments: { path: '/etc/passwd' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /Path outside root/,
      )
    })

    it('should reject relative traversal above root', async () => {
      const result = await client.callTool({
        name: 'md_context',
        arguments: { path: '../../.ssh/id_rsa' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /Path outside root/,
      )
    })

    it('should reject path traversal in md_structure', async () => {
      const result = await client.callTool({
        name: 'md_structure',
        arguments: { path: '../../../etc/passwd' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /Path outside root/,
      )
    })

    it('should reject path traversal in md_links', async () => {
      const result = await client.callTool({
        name: 'md_links',
        arguments: { path: '/etc/passwd' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /Path outside root/,
      )
    })

    it('should reject path traversal in md_backlinks', async () => {
      const result = await client.callTool({
        name: 'md_backlinks',
        arguments: { path: '../../.ssh/id_rsa' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /Path outside root/,
      )
    })

    it('should reject path traversal in md_index', async () => {
      const result = await client.callTool({
        name: 'md_index',
        arguments: { path: '/tmp/evil' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /Path outside root/,
      )
    })
  })

  // ==========================================================================
  // Security: ReDoS Protection
  // ==========================================================================

  describe('security: ReDoS protection', () => {
    it('should reject catastrophic backtracking regex with explicit error', async () => {
      // Classic ReDoS pattern: (a+)+ causes exponential backtracking
      const result = await client.callTool({
        name: 'md_keyword_search',
        arguments: { heading: '(a+)+$' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /catastrophic backtracking/,
      )
    })

    it('should reject nested quantifier regex pattern', async () => {
      // (.*a){20} contains a quantified group with internal quantifier
      const result = await client.callTool({
        name: 'md_keyword_search',
        arguments: { heading: '(.*a){20}' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /catastrophic backtracking/,
      )
    })

    it('should reject wildcard alternation under quantifier', async () => {
      const result = await client.callTool({
        name: 'md_keyword_search',
        arguments: { heading: '(.|\\s)+' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(
        /catastrophic backtracking/,
      )
    })

    it('should allow safe regex patterns', async () => {
      const result = await client.callTool({
        name: 'md_keyword_search',
        arguments: { heading: 'test.*file' },
      })
      // Should not be an error (may return empty results, that's fine)
      expect(result.isError).toBeFalsy()
    })
  })

  // ==========================================================================
  // Input Validation: Missing Required Args
  // ==========================================================================

  describe('missing required args', () => {
    // Schema validation catches missing required args and returns a
    // structured MCP error response (isError: true) with a descriptive message.

    it('md_context without path should return validation error', async () => {
      const result = await client.callTool({
        name: 'md_context',
        arguments: {},
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })

    it('md_structure without path should return validation error', async () => {
      const result = await client.callTool({
        name: 'md_structure',
        arguments: {},
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })

    it('md_links without path should return validation error', async () => {
      const result = await client.callTool({ name: 'md_links', arguments: {} })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })

    it('md_backlinks without path should return validation error', async () => {
      const result = await client.callTool({
        name: 'md_backlinks',
        arguments: {},
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })

    it('md_search without query should return validation error', async () => {
      const result = await client.callTool({ name: 'md_search', arguments: {} })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })
  })

  // ==========================================================================
  // Input Validation: Wrong Argument Types
  // ==========================================================================

  describe('wrong argument types', () => {
    it('md_context with numeric path should return validation error', async () => {
      const result = await client.callTool({
        name: 'md_context',
        arguments: { path: 12345 },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })

    it('md_search with numeric query should return validation error', async () => {
      const result = await client.callTool({
        name: 'md_search',
        arguments: { query: 42 },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })

    it('md_keyword_search with numeric heading should return validation error', async () => {
      const result = await client.callTool({
        name: 'md_keyword_search',
        arguments: { heading: 999 },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })

    it('md_context with invalid level enum should return validation error', async () => {
      const result = await client.callTool({
        name: 'md_context',
        arguments: { path: 'README.md', level: 'invalid' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })

    it('md_search with string limit should return validation error', async () => {
      const result = await client.callTool({
        name: 'md_search',
        arguments: { query: 'test', limit: 'five' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })

    it('md_keyword_search with string has_code should return validation error', async () => {
      const result = await client.callTool({
        name: 'md_keyword_search',
        arguments: { has_code: 'yes' },
      })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
        'Invalid arguments',
      )
    })
  })
})

// ============================================================================
// resolveAndValidatePath - Unit Tests
// ============================================================================

describe('resolveAndValidatePath', () => {
  const root = '/home/user/docs'

  // Helper: rejected paths return a CallToolResult with isError: true
  const expectPathError = (result: unknown) => {
    expect(result).toMatchObject({
      isError: true,
      content: [
        { type: 'text', text: expect.stringContaining('Path outside root') },
      ],
    })
  }

  it('should resolve relative paths within root', async () => {
    const result = await resolveAndValidatePath(root, 'README.md')
    expect(result).toBe(path.resolve(root, 'README.md'))
  })

  it('should resolve nested relative paths within root', async () => {
    const result = await resolveAndValidatePath(root, 'subdir/file.md')
    expect(result).toBe(path.resolve(root, 'subdir/file.md'))
  })

  it('should allow the root path itself', async () => {
    const result = await resolveAndValidatePath(root, '.')
    expect(result).toBe(path.resolve(root))
  })

  it('should reject paths that escape root via ../', async () => {
    const result = await resolveAndValidatePath(root, '../../etc/passwd')
    expectPathError(result)
  })

  it('should reject absolute paths outside root', async () => {
    const result = await resolveAndValidatePath(root, '/etc/passwd')
    expectPathError(result)
  })

  it('should reject sneaky traversal with intermediate ..', async () => {
    const result = await resolveAndValidatePath(
      root,
      'subdir/../../.ssh/id_rsa',
    )
    expectPathError(result)
  })

  it('should allow absolute paths within root', async () => {
    const innerPath = path.resolve(root, 'subdir', 'file.md')
    const result = await resolveAndValidatePath(root, innerPath)
    expect(result).toBe(innerPath)
  })

  it('should reject paths that are root prefix but not subdirectory', async () => {
    // /home/user/docs-evil should not pass when root is /home/user/docs
    const result = await resolveAndValidatePath(
      root,
      '/home/user/docs-evil/file.md',
    )
    expectPathError(result)
  })
})
