import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let tempDir: string
let mdmHome: string

beforeEach(() => {
  tempDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-index-source-')),
  )
  mdmHome = path.join(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-index-home-'))),
    'active',
  )
  fs.writeFileSync(path.join(tempDir, 'test.md'), '# Test\nContent here.\n')
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.rmSync(path.dirname(mdmHome), { recursive: true, force: true })
})

const runIndex = async (): Promise<{
  stdout: string
  stderr: string
  code: number
}> => {
  const { execFileSync } = await import('node:child_process')
  const bin = path.resolve(import.meta.dirname, '../../../dist/cli/main.js')
  try {
    const stdout = execFileSync(
      process.execPath,
      [bin, 'index', '--no-embed'],
      {
        cwd: tempDir,
        env: { ...process.env, MDM_HOME: mdmHome },
        encoding: 'utf-8',
        timeout: 30000,
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
  it('creates the selected MDM_HOME without a project index', async () => {
    const result = await runIndex()

    expect(result.code).toBe(0)
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(false)
    expect(fs.existsSync(path.join(mdmHome, 'indexes'))).toBe(true)
    expect(result.stdout).not.toContain('Created .mdm/ index directory')
  })

  it('keeps the project free of local index state on repeated runs', async () => {
    await runIndex()
    const result = await runIndex()

    expect(result.code).toBe(0)
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(false)
    expect(fs.existsSync(path.join(tempDir, 'cache'))).toBe(false)
    expect(fs.existsSync(path.join(mdmHome, 'indexes', 'sections.json'))).toBe(
      true,
    )
  })
})
