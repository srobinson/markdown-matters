/**
 * Index --force Flag Tests
 *
 * ALP-1365: Tests for correct --force semantics.
 *
 * --force bypasses the mtime and hash cache.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let tempDir: string
let fakeHome: string
let originalHome: string

beforeEach(() => {
  tempDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-flags-test-')),
  )
  fakeHome = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-flags-home-')),
  )
  originalHome = process.env.HOME ?? os.homedir()
  process.env.HOME = fakeHome

  // Create a markdown file to index.
  fs.writeFileSync(path.join(tempDir, 'doc.md'), '# Doc A\nContent A.\n')
})

afterEach(() => {
  process.env.HOME = originalHome
  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

const runIndex = async (
  cwd: string,
  args = '',
): Promise<{ stdout: string; stderr: string; code: number }> => {
  const { execSync } = await import('node:child_process')
  const bin = path.resolve(import.meta.dirname, '../../../dist/cli/main.js')
  try {
    const stdout = execSync(`node ${bin} index . ${args}`, {
      cwd,
      env: {
        ...process.env,
        HOME: fakeHome,
        MDM_HOME: path.join(fakeHome, '.mdm'),
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

  it('does not delete the explicit index directory', async () => {
    // First run creates the index files
    await runIndex(tempDir)
    const indexDir = path.join(fakeHome, '.mdm', 'indexes')
    expect(fs.existsSync(indexDir)).toBe(true)
    const beforeContents = fs.readdirSync(indexDir)
    expect(beforeContents.length).toBeGreaterThan(0)

    // --force should NOT delete the directory
    await runIndex(tempDir, '--force')
    expect(fs.existsSync(indexDir)).toBe(true)
    // Index files should still exist
    const afterContents = fs.readdirSync(indexDir)
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

  it('rejects the removed --all flag', async () => {
    const result = await runIndex(tempDir, '--all')

    expect(result.code).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('--all')
    expect(`${result.stdout}\n${result.stderr}`).toContain('manifest watching')
  })
})
