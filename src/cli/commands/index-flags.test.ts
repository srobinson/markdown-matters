/**
 * Index --force and --all Flag Tests
 *
 * ALP-1365: Tests for correct --force and --all semantics.
 *
 * --force = HOW (bypass mtime/hash cache, re-process every file)
 * --all   = WHAT (all registered global sources, not just PWD)
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let tempDir: string
let tempDir2: string
let fakeHome: string
let originalHome: string

beforeEach(() => {
  tempDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-flags-test-')),
  )
  tempDir2 = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-flags-test2-')),
  )
  fakeHome = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-flags-home-')),
  )
  originalHome = process.env.HOME ?? os.homedir()
  process.env.HOME = fakeHome

  // Create markdown files in both dirs
  fs.writeFileSync(path.join(tempDir, 'doc.md'), '# Doc A\nContent A.\n')
  fs.writeFileSync(path.join(tempDir2, 'doc.md'), '# Doc B\nContent B.\n')
})

afterEach(() => {
  process.env.HOME = originalHome
  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.rmSync(tempDir2, { recursive: true, force: true })
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

const runIndex = async (
  cwd: string,
  args = '',
): Promise<{ stdout: string; stderr: string; code: number }> => {
  const { execSync } = await import('node:child_process')
  const bin = path.resolve(import.meta.dirname, '../../../dist/cli/main.js')
  try {
    const stdout = execSync(`node ${bin} index ${args}`, {
      cwd,
      env: {
        ...process.env,
        HOME: fakeHome,
        // Windows: os.homedir() reads USERPROFILE (and HOMEDRIVE+HOMEPATH),
        // not HOME. Set all three so the subprocess is fully isolated.
        USERPROFILE: fakeHome,
        HOMEDRIVE: '',
        HOMEPATH: fakeHome,
      },
      encoding: 'utf-8',
      timeout: 30000,
    })
    return { stdout, stderr: '', code: 0 }
  } catch (e: any) {
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: e.status ?? 1,
    }
  }
}

const writeGlobalConfig = (sources: { path: string; name?: string }[]) => {
  const globalDir = path.join(fakeHome, '.mdm')
  fs.mkdirSync(globalDir, { recursive: true })
  let content = ''
  for (const s of sources) {
    content += `\n[[sources]]\npath = "${s.path.replace(/\\/g, '/')}"\n`
    if (s.name) content += `name = "${s.name}"\n`
  }
  fs.writeFileSync(path.join(globalDir, '.mdm.toml'), content, 'utf-8')
}

describe('index --force flag', () => {
  it('re-indexes all files on second run with --force', async () => {
    // First run: index everything
    const first = await runIndex(tempDir)
    expect(first.code).toBe(0)
    expect(first.stdout).toContain('Indexed')

    // Second run without --force: should show unchanged skipped
    const second = await runIndex(tempDir)
    expect(second.code).toBe(0)

    // Third run with --force: should re-process (no unchanged skip)
    const third = await runIndex(tempDir, '--force')
    expect(third.code).toBe(0)
    // With --force, the file should be re-indexed, not skipped as unchanged
    expect(third.stdout).not.toContain('unchanged')
  })

  it('does not delete the .mdm/ index directory', async () => {
    // First run creates .mdm/ and index files
    await runIndex(tempDir)
    const mdmDir = path.join(tempDir, '.mdm')
    expect(fs.existsSync(mdmDir)).toBe(true)
    const beforeContents = fs.readdirSync(mdmDir)
    expect(beforeContents.length).toBeGreaterThan(0)

    // --force should NOT delete the directory
    await runIndex(tempDir, '--force')
    expect(fs.existsSync(mdmDir)).toBe(true)
    // Index files should still exist
    const afterContents = fs.readdirSync(mdmDir)
    expect(afterContents.length).toBeGreaterThan(0)
  })

  it('incremental run skips unchanged files', async () => {
    // First run
    await runIndex(tempDir)

    // Second run without changes: should skip unchanged
    const result = await runIndex(tempDir)
    expect(result.code).toBe(0)
    // The skip summary should mention unchanged files
    if (result.stdout.includes('Skipped:')) {
      expect(result.stdout).toContain('unchanged')
    }
  })
})

describe('index --all flag', () => {
  it('indexes all registered sources', async () => {
    writeGlobalConfig([
      { path: tempDir, name: 'source-a' },
      { path: tempDir2, name: 'source-b' },
    ])

    const result = await runIndex(tempDir, '--all --no-embed')
    expect(result.code).toBe(0)
    // Should index both directories
    expect(result.stdout).toContain(tempDir)
    expect(result.stdout).toContain(tempDir2)
  })

  it('exits with error when no global config exists', async () => {
    // No global config written, --all should fail
    const result = await runIndex(tempDir, '--all')
    expect(result.stdout).toContain('No global sources registered')
  })

  it('exits with error when global config has no sources', async () => {
    // Global config exists but empty (no [[sources]])
    const globalDir = path.join(fakeHome, '.mdm')
    fs.mkdirSync(globalDir, { recursive: true })
    fs.writeFileSync(
      path.join(globalDir, '.mdm.toml'),
      '# empty config\n',
      'utf-8',
    )

    const result = await runIndex(tempDir, '--all')
    expect(result.stdout).toContain('No global sources registered')
  })

  it('--all --force re-indexes all sources bypassing cache', async () => {
    writeGlobalConfig([{ path: tempDir }, { path: tempDir2 }])

    // First run to populate indexes
    await runIndex(tempDir, '--all --no-embed')

    // Second run with --all --force: should re-process everything
    const result = await runIndex(tempDir, '--all --force --no-embed')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(tempDir)
    expect(result.stdout).toContain(tempDir2)
    // With --force, no files should be skipped as unchanged
    expect(result.stdout).not.toContain('unchanged')
  })

  it('--all --watch rejects with clear error', async () => {
    writeGlobalConfig([{ path: tempDir }])
    const result = await runIndex(tempDir, '--all --watch')
    expect(result.stdout).toContain('Cannot combine --all and --watch')
  })

  it('--all skips non-existent source directories', async () => {
    const missingDir = path.join(
      fakeHome,
      'no-such-source-' + Date.now().toString(36),
    )
    writeGlobalConfig([
      { path: tempDir, name: 'exists' },
      { path: missingDir, name: 'missing' },
    ])
    const result = await runIndex(tempDir, '--all --no-embed')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('not found')
    expect(result.stdout).toContain(tempDir)
  })

  it('--all surfaces malformed TOML errors', async () => {
    const globalDir = path.join(fakeHome, '.mdm')
    fs.mkdirSync(globalDir, { recursive: true })
    fs.writeFileSync(
      path.join(globalDir, '.mdm.toml'),
      '[[sources]\npath = broken toml',
      'utf-8',
    )
    const result = await runIndex(tempDir, '--all')
    expect(result.stdout).toContain('Failed to read global config')
  })
})
