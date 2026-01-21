// cspell:words jsno limt xyznonexistent123
/**
 * E2E tests for mdcontext CLI commands
 * Tests actual CLI execution against dynamically generated test fixtures
 *
 * Test fixture setup:
 * - beforeAll: Builds index (documents, sections, links) - fast, no API key needed
 * - When INCLUDE_EMBED_TESTS=true: Also builds embeddings (requires OPENAI_API_KEY)
 * - afterAll: Cleans up .mdcontext directory and frees tiktoken encoder
 *
 * Running tests:
 * - `pnpm test` - Runs with keyword search only (no API key needed)
 * - `pnpm test:full` - Runs all tests including semantic search (requires OPENAI_API_KEY)
 */

import { Effect } from 'effect'
import { exec } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildEmbeddings } from '../embeddings/semantic-search.js'
import { buildIndex } from '../index/indexer.js'
import { freeEncoder } from '../utils/tokens.js'

const execAsync = promisify(exec)

const INCLUDE_EMBED_TESTS = process.env.INCLUDE_EMBED_TESTS === 'true'
const REBUILD_TEST_INDEX = process.env.REBUILD_TEST_INDEX === 'true'
const TEST_FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'cli')
const CLI = `node ${path.join(process.cwd(), 'dist', 'cli', 'main.js')}`

const run = async (
  args: string,
  options: { cwd?: string; expectError?: boolean } = {},
): Promise<string> => {
  const cwd = options.cwd ?? TEST_FIXTURE_DIR
  try {
    const { stdout } = await execAsync(`${CLI} ${args}`, {
      cwd,
      encoding: 'utf-8',
    })
    return stdout.trim()
  } catch (error: unknown) {
    if (options.expectError) {
      const execError = error as { stderr?: string; stdout?: string }
      return execError.stderr || execError.stdout || ''
    }
    throw error
  }
}

describe.concurrent('mdcontext CLI e2e', () => {
  beforeAll(async () => {
    if (REBUILD_TEST_INDEX) {
      // Build the index and embeddings only once for faster tests
      console.log('Rebuilding test fixture index and embeddings...')
      // Build the index (fast, no API key needed)
      await Effect.runPromise(buildIndex(TEST_FIXTURE_DIR, { force: true }))

      if (INCLUDE_EMBED_TESTS) {
        console.log('Rebuilding test fixture embeddings...')
        await Effect.runPromise(
          buildEmbeddings(TEST_FIXTURE_DIR, { force: true }),
        )
      }
    }
  })

  afterAll(async () => {
    // Free tiktoken encoder to prevent process hang
    freeEncoder()
  })

  describe('--version', () => {
    it('shows version number', async () => {
      const output = await run('--version')
      expect(output).toMatch(/^\d+\.\d+\.\d+$/)
    })
  })

  describe('--help', () => {
    it('shows help with all commands', async () => {
      const output = await run('--help')
      expect(output).toContain('index')
      expect(output).toContain('search')
      expect(output).toContain('context')
      expect(output).toContain('tree')
      expect(output).toContain('links')
      expect(output).toContain('backlinks')
      expect(output).toContain('stats')
    })
  })

  describe('subcommand --help', () => {
    const subcommands = [
      'index',
      'search',
      'context',
      'tree',
      'links',
      'backlinks',
      'stats',
    ]

    for (const cmd of subcommands) {
      it(`${cmd} --help shows examples and options`, async () => {
        const output = await run(`${cmd} --help`)
        expect(output).toContain('USAGE')
        expect(output).toContain('EXAMPLES')
        expect(output).toContain('OPTIONS')
        expect(output).toContain(`mdcontext ${cmd}`)
        expect(output).not.toContain('A true or false value')
        expect(output).not.toContain('This setting is optional')
      })
    }

    it('index help shows embedding and watch options', async () => {
      const output = await run('index --help')
      expect(output).toContain('--embed')
      expect(output).toContain('--watch')
      expect(output).toContain('--force')
    })

    it('search help shows keyword and limit options', async () => {
      const output = await run('search --help')
      expect(output).toContain('--keyword')
      expect(output).toContain('--limit')
      expect(output).toContain('--threshold')
    })

    it('context help shows token budget option', async () => {
      const output = await run('context --help')
      expect(output).toContain('--tokens')
      expect(output).toContain('--brief')
      expect(output).toContain('--full')
    })

    it('shows notes section when relevant', async () => {
      const indexHelp = await run('index --help')
      expect(indexHelp).toContain('NOTES')
      expect(indexHelp).toContain('.mdcontext')

      const searchHelp = await run('search --help')
      expect(searchHelp).toContain('NOTES')
      expect(searchHelp).toContain('semantic')
    })
  })

  describe('tree command', () => {
    it('lists markdown files in directory', async () => {
      const output = await run('tree')
      expect(output).toContain('Markdown files')
      expect(output).toContain('.md')
      expect(output).toContain('Total:')
    })

    it('shows document outline for single file', async () => {
      const output = await run('tree README.md')
      expect(output).toContain('# ')
      expect(output).toContain('tokens')
      expect(output).toContain('##')
    })

    it('defaults to current directory', async () => {
      const output = await run('tree')
      expect(output).toContain('Markdown files')
    })
  })

  describe('search command', () => {
    it('performs keyword search by default', async () => {
      const output = await run('search "getting started"')
      expect(output).toContain('[keyword]')
      expect(output).toContain('Results:')
    })

    it('handles no results gracefully', async () => {
      const output = await run('search "xyznonexistent123"')
      expect(output).toContain('Results: 0')
    })

    it('supports -k flag for explicit keyword search', async () => {
      const output = await run('search -k "API Reference"')
      expect(output).toContain('Content search')
    })

    it('supports -n flag to limit results', async () => {
      const output = await run('search -n 2 "the"')
      const lines = output
        .split('\n')
        .filter((l) => l.trim().match(/^\w+.*\.md/))
      expect(lines.length).toBeLessThanOrEqual(2)
    })

    it('shows mode indicator in output', async () => {
      const output = await run('search "getting started"')
      expect(output).toContain('[keyword]')
    })

    it('supports boolean AND operator', async () => {
      const output = await run('search "test AND fixture"')
      expect(output).toContain('Results:')
    })

    it('supports boolean OR operator', async () => {
      const output = await run('search "installation OR endpoints"')
      expect(output).toContain('Results:')
    })

    it('supports boolean NOT operator', async () => {
      const output = await run('search "test NOT endpoints"')
      expect(output).toContain('Results:')
    })

    it('supports quoted phrase search', async () => {
      const output = await run('search \'"Getting Started"\' .')
      expect(output).toContain('Results:')
    })

    it('supports --mode flag', async () => {
      const output = await run('search --mode keyword "getting started"')
      expect(output).toContain('[keyword]')
    })

    it.skipIf(!INCLUDE_EMBED_TESTS)(
      'performs semantic search when embeddings exist',
      async () => {
        const output = await run('search --mode semantic "getting started"')
        expect(output).toContain('[semantic]')
      },
    )
  })

  describe('context command', () => {
    it('summarizes single file', async () => {
      const output = await run('context README.md')
      expect(output).toContain('# ')
      expect(output).toContain('Tokens:')
    })

    it.skipIf(!INCLUDE_EMBED_TESTS)('summarizes multiple files', async () => {
      const output = await run('context ./README.md ./getting-started.md')
      expect(output).toContain('Context Assembly')
      expect(output).toContain('Sources: 2')
    })

    it('shows accurate token count with -t flag', async () => {
      const output = await run('context -t 200 README.md')
      expect(output).toContain('Tokens:')
    })

    it('supports --brief flag', async () => {
      const brief = await run('context --brief README.md')
      const full = await run('context README.md')
      expect(brief.length).toBeLessThanOrEqual(full.length)
    })

    it('supports --sections flag to list available sections', async () => {
      const output = await run('context README.md --sections')
      expect(output).toContain('Available sections:')
      expect(output).toContain('tokens')
    })

    it('supports --section flag to extract specific section', async () => {
      const output = await run('context README.md --section "1"')
      expect(output).toContain('Sections:')
      expect(output).toContain('#')
    })

    it('supports --sections with --json output', async () => {
      const output = await run('context README.md --sections --json')
      const parsed = JSON.parse(output)
      expect(parsed.sections).toBeDefined()
      expect(Array.isArray(parsed.sections)).toBe(true)
      expect(parsed.sections[0]).toHaveProperty('number')
      expect(parsed.sections[0]).toHaveProperty('heading')
      expect(parsed.sections[0]).toHaveProperty('tokens')
    })

    it('supports --full flag to disable truncation', async () => {
      const output = await run('context README.md --full')
      expect(output).not.toContain('Truncated')
    })
  })

  describe('search command context lines', () => {
    it('supports -C flag for context lines', async () => {
      const output = await run('search "test" . -C 2')
      expect(output).toContain('[keyword]')
    })

    it('supports -B and -A flags for asymmetric context', async () => {
      const output = await run('search "test" . -B 1 -A 3')
      expect(output).toContain('[keyword]')
    })

    it('includes contextLines in JSON output', async () => {
      const output = await run('search "test" . -C 2 --json -n 1')
      const parsed = JSON.parse(output)
      expect(parsed.contextBefore).toBe(2)
      expect(parsed.contextAfter).toBe(2)
      if (parsed.results.length > 0 && parsed.results[0].matches) {
        expect(parsed.results[0].matches[0]).toHaveProperty('contextLines')
      }
    })
  })

  describe('links command', () => {
    it('shows outgoing links from file', async () => {
      const output = await run('links README.md')
      expect(output).toContain('Outgoing links')
      expect(output).toContain('Total:')
    })
  })

  describe('backlinks command', () => {
    it('shows incoming links to file', async () => {
      const output = await run('backlinks getting-started.md')
      expect(output).toContain('Incoming links')
      expect(output).toContain('Total:')
    })
  })

  describe('stats command', () => {
    it('shows index statistics', async () => {
      const output = await run('stats')
      expect(output.length).toBeGreaterThan(0)
    })
  })

  describe('error handling', () => {
    it('handles non-existent file gracefully', async () => {
      const output = await run('tree nonexistent-file-xyz.md', {
        expectError: true,
      })
      expect(output.toLowerCase()).toMatch(/error|not found|no such/i)
    })

    it('handles non-existent directory gracefully', async () => {
      const output = await run('tree nonexistent-dir-xyz/', {
        expectError: true,
      })
      expect(output.toLowerCase()).toMatch(/error|not found|no such/i)
    })
  })

  describe('unknown flag handling', () => {
    it('shows clear error for unknown flag', async () => {
      const output = await run('context -x README.md', { expectError: true })
      expect(output).toContain("Unknown option '-x' for 'context'")
      expect(output).toContain('Valid options for')
    })

    it('suggests typo correction for --jsno', async () => {
      const output = await run('context --jsno README.md', {
        expectError: true,
      })
      expect(output).toContain("Unknown option '--jsno' for 'context'")
      expect(output).toContain("Did you mean '--json'?")
    })

    it('suggests typo correction for --limt', async () => {
      const output = await run('search --limt 5 "test" .', {
        expectError: true,
      })
      expect(output).toContain("Unknown option '--limt' for 'search'")
      expect(output).toContain("Did you mean '--limit'?")
    })

    it('lists valid options in error message', async () => {
      const output = await run('context --invalid README.md', {
        expectError: true,
      })
      expect(output).toContain('--tokens')
      expect(output).toContain('--brief')
      expect(output).toContain('--json')
    })

    it('handles unknown flag with value', async () => {
      const output = await run('context --foo=bar README.md', {
        expectError: true,
      })
      expect(output).toContain("Unknown option '--foo'")
    })

    it('reports first unknown flag only', async () => {
      const output = await run('context --foo --bar README.md', {
        expectError: true,
      })
      expect(output).toContain("Unknown option '--foo'")
    })
  })

  describe('flexible flag positioning', () => {
    it('search: allows query before flags', async () => {
      const output = await run('search -k "getting started" -n 2 .')
      expect(output).toContain('Content search')
      expect(output).toContain('Results:')
    })

    it('search: allows path after flags', async () => {
      const output = await run('search -k "API Reference" .')
      expect(output).toContain('Content search')
    })

    it('context: allows files before flags', async () => {
      const output = await run('context README.md --brief')
      expect(output).toContain('# ')
    })

    it('context: allows -t flag after file', async () => {
      const output = await run('context README.md -t 500')
      expect(output).toContain('Tokens:')
    })

    it('tree: allows path before --json flag', async () => {
      const output = await run('tree . --json')
      expect(output).toContain('[')
      expect(output).toContain('relativePath')
    })

    it('search: handles --limit=value syntax', async () => {
      const output = await run('search -k "getting started" --limit=2 .')
      expect(output).toContain('Content search')
    })
  })
})
