/**
 * Index Sentinel Detection Tests
 *
 * ALP-1310: Tests for mdm index first-run sentinel detection.
 *
 * When no .mdm/ directory exists (neither local nor global), the
 * index command auto-creates it locally before indexing.
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
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-sentinel-test-')),
  )
  fakeHome = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-sentinel-home-')),
  )
  originalHome = process.env.HOME ?? os.homedir()
  process.env.HOME = fakeHome
  // Create a markdown file so index has something to index
  fs.writeFileSync(path.join(tempDir, 'test.md'), '# Test\nContent here.\n')
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
    const stdout = execSync(`node ${bin} index ${args}`, {
      cwd,
      env: { ...process.env, HOME: fakeHome },
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

describe('index sentinel detection', () => {
  it('auto-creates .mdm/ when neither local nor global exists', async () => {
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(false)
    expect(fs.existsSync(path.join(fakeHome, '.mdm'))).toBe(false)

    const result = await runIndex(tempDir)
    expect(result.code).toBe(0)
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(true)
    expect(result.stdout).toContain('Created .mdm/ index directory')
  })

  it('does not auto-create when local .mdm/ already exists', async () => {
    fs.mkdirSync(path.join(tempDir, '.mdm'))

    const result = await runIndex(tempDir)
    expect(result.code).toBe(0)
    // Should not mention creating the directory
    expect(result.stdout).not.toContain('Created .mdm/ index directory')
  })

  it('does not auto-create when global ~/.mdm/ exists', async () => {
    fs.mkdirSync(path.join(fakeHome, '.mdm'))

    const result = await runIndex(tempDir)
    expect(result.code).toBe(0)
    // Local .mdm/ should not be auto-created when global exists
    expect(result.stdout).not.toContain('Created .mdm/ index directory')
  })

  it('subsequent runs do not re-trigger sentinel', async () => {
    // First run creates .mdm/
    await runIndex(tempDir)
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(true)

    // Second run should not mention creating it
    const result = await runIndex(tempDir)
    expect(result.stdout).not.toContain('Created .mdm/ index directory')
  })

  it('writes index files inside .mdm/', async () => {
    await runIndex(tempDir)
    // After indexing, there should be index files in .mdm/
    const mdmContents = fs.readdirSync(path.join(tempDir, '.mdm'))
    expect(mdmContents.length).toBeGreaterThan(0)
  })
})
