import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendManifestDirectory } from '../../manifest.js'

let tempDir: string
let secondDir: string
let mdmHome: string
const CLI_TIMEOUT_MS = 20_000

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
      fs.readFileSync(path.join(mdmHome, 'indexes', 'documents.json'), 'utf-8'),
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
    expect(fs.existsSync(path.join(mdmHome, 'indexes'))).toBe(true)
    expect(result.stdout).not.toContain('Created .mdm/ index directory')
  })

  it('keeps the project free of local index state on repeated runs', async () => {
    await runIndex([tempDir])
    const result = await runIndex()

    expect(result.code).toBe(0)
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(false)
    expect(fs.existsSync(path.join(tempDir, 'cache'))).toBe(false)
    expect(fs.existsSync(path.join(mdmHome, 'indexes', 'sections.json'))).toBe(
      true,
    )
  })
})
