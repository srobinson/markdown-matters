import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  generationLayout,
  readCurrentGeneration,
} from '../../db/generation-paths.js'
import { validateGeneration } from '../../db/generation-validation.js'
import { getIndexPaths } from '../../index/types.js'
import { appendManifestDirectory, loadManifest } from '../../manifest.js'
import { handleMdIndex } from '../../mcp/handlers.js'

let tempDir: string
let secondDir: string
let mdmHome: string
const CLI_TIMEOUT_MS = 60_000

beforeEach(() => {
  tempDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-index-source-')),
  )
  secondDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-index-second-')),
  )
  mdmHome = path.join(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-index-home-'))),
    'active',
  )
  fs.writeFileSync(path.join(tempDir, 'test.md'), '# Test\nContent here.\n')
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.rmSync(secondDir, { recursive: true, force: true })
  fs.rmSync(path.dirname(mdmHome), { recursive: true, force: true })
})

const runIndex = async (
  args: readonly string[] = [],
): Promise<{
  stdout: string
  stderr: string
  code: number
}> => {
  const { execFileSync } = await import('node:child_process')
  const bin = path.resolve(import.meta.dirname, '../../../dist/cli/main.js')
  try {
    const stdout = execFileSync(
      process.execPath,
      [bin, 'index', ...args, '--no-embed'],
      {
        cwd: tempDir,
        env: { ...process.env, MDM_HOME: mdmHome },
        encoding: 'utf-8',
        timeout: CLI_TIMEOUT_MS,
      },
    )
    return { stdout, stderr: '', code: 0 }
  } catch (error: unknown) {
    const failure = error as {
      stdout?: string
      stderr?: string
      status?: number
    }
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      code: failure.status ?? 1,
    }
  }
}

const currentIndexRoot = (): string =>
  path.join(mdmHome, fs.readFileSync(path.join(mdmHome, 'current'), 'utf-8'))

const generationSummary = async (home: string) => {
  const current = await Effect.runPromise(readCurrentGeneration(home))
  if (current === null) throw new Error('Expected a published generation')
  return Effect.runPromise(
    validateGeneration(generationLayout(home, current).root),
  )
}

const generationArtifactBytes = async (home: string) => {
  const current = await Effect.runPromise(readCurrentGeneration(home))
  if (current === null) throw new Error('Expected a published generation')
  const paths = getIndexPaths(generationLayout(home, current).root)
  const [documents, sections, links, bm25, rawBm25Metadata] = await Promise.all(
    [
      fs.promises.readFile(paths.documents),
      fs.promises.readFile(paths.sections),
      fs.promises.readFile(paths.links),
      fs.promises.readFile(paths.bm25),
      fs.promises.readFile(paths.bm25Metadata, 'utf-8'),
    ],
  )
  const { lastUpdated: _, ...bm25Metadata } = JSON.parse(
    rawBm25Metadata,
  ) as Record<string, unknown>
  return { documents, sections, links, bm25, bm25Metadata }
}

const runIndexAsync = async (source: string): Promise<void> => {
  const { execFile } = await import('node:child_process')
  const bin = path.resolve(import.meta.dirname, '../../../dist/cli/main.js')
  await promisify(execFile)(
    process.execPath,
    [bin, 'index', source, '--no-embed'],
    {
      cwd: tempDir,
      env: { ...process.env, MDM_HOME: mdmHome },
      timeout: CLI_TIMEOUT_MS,
    },
  )
}

describe('active home index routing', () => {
  it('appends a path then refreshes every manifest directory', async () => {
    const first = await runIndex([tempDir])
    expect(first.code).toBe(0)

    fs.writeFileSync(path.join(secondDir, 'second.md'), '# Second\nContent.\n')
    await Effect.runPromise(
      appendManifestDirectory(mdmHome, { path: secondDir }),
    )

    const refreshed = await runIndex()
    expect(refreshed.code).toBe(0)
    const documents = JSON.parse(
      fs.readFileSync(
        path.join(currentIndexRoot(), 'indexes', 'documents.json'),
        'utf-8',
      ),
    ) as { documents: Record<string, unknown> }
    expect(Object.keys(documents.documents)).toHaveLength(2)
  })

  it('fails no-arg index when the manifest is empty', async () => {
    const result = await runIndex()

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('mdm index <dir>')
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(false)
  })

  it('rejects watch until manifest watching exists', async () => {
    const result = await runIndex(['--watch'])

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('manifest watching')
  })

  it('creates the selected MDM_HOME without a project index', async () => {
    const result = await runIndex([tempDir])

    expect(result.code).toBe(0)
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(false)
    expect(fs.existsSync(path.join(currentIndexRoot(), 'indexes'))).toBe(true)
    expect(result.stdout).not.toContain('Created .mdm/ index directory')
  })

  it('keeps the project free of local index state on repeated runs', async () => {
    await runIndex([tempDir])
    const result = await runIndex()

    expect(result.code).toBe(0)
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(false)
    expect(fs.existsSync(path.join(tempDir, 'cache'))).toBe(false)
    expect(
      fs.existsSync(path.join(currentIndexRoot(), 'indexes', 'sections.json')),
    ).toBe(true)
  })

  it(
    'serializes concurrent manifest appends without losing either directory',
    async () => {
      fs.writeFileSync(
        path.join(secondDir, 'second.md'),
        '# Second\nContent.\n',
      )

      await Promise.all([runIndexAsync(tempDir), runIndexAsync(secondDir)])

      const manifest = await Effect.runPromise(loadManifest(mdmHome))
      expect(manifest.directories.map((entry) => entry.path).sort()).toEqual(
        [fs.realpathSync(tempDir), fs.realpathSync(secondDir)].sort(),
      )
      expect(fs.readFileSync(path.join(mdmHome, 'current'), 'utf-8')).toBe(
        'gen-2',
      )
    },
    CLI_TIMEOUT_MS,
  )

  it(
    'publishes equivalent CLI and MCP generations for the same corpus',
    async () => {
      const mcpHome = path.join(path.dirname(mdmHome), 'mcp')
      const cli = await runIndex([tempDir])
      expect(cli.code).toBe(0)

      const originalMdmHome = process.env.MDM_HOME
      process.env.MDM_HOME = mcpHome
      try {
        const mcp = await handleMdIndex({ path: '.', force: false }, tempDir)
        expect(mcp.isError).toBeFalsy()
      } finally {
        if (originalMdmHome === undefined) delete process.env.MDM_HOME
        else process.env.MDM_HOME = originalMdmHome
      }

      expect(await generationSummary(mcpHome)).toEqual(
        await generationSummary(mdmHome),
      )
      expect(await generationArtifactBytes(mcpHome)).toEqual(
        await generationArtifactBytes(mdmHome),
      )
    },
    CLI_TIMEOUT_MS,
  )
})
