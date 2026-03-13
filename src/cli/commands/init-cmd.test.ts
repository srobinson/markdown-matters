/**
 * Init Command Integration Tests
 *
 * ALP-1309: Tests for mdm init flows.
 *
 * Tests the init command's filesystem effects using --local, --global,
 * and --yes flags to bypass interactive prompts.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadTomlFile } from '../../config/loader.js'

let tempDir: string
let fakeHome: string
let originalHome: string

beforeEach(() => {
  // Use fs.realpathSync to resolve macOS /var -> /private/var symlink
  tempDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-init-test-')),
  )
  fakeHome = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-init-home-')),
  )
  originalHome = process.env.HOME ?? os.homedir()
  process.env.HOME = fakeHome
})

afterEach(() => {
  process.env.HOME = originalHome
  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

/**
 * Run the init command via CLI subprocess with specific flags.
 * Uses the built dist to test the actual command.
 */
const runInit = async (
  args: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> => {
  const { execSync } = await import('node:child_process')
  const bin = path.resolve(import.meta.dirname, '../../../dist/cli/main.js')
  try {
    const stdout = execSync(`node ${bin} init ${args}`, {
      cwd,
      env: { ...process.env, HOME: fakeHome },
      encoding: 'utf-8',
      timeout: 10000,
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

describe('mdm init --local', () => {
  it('creates .mdm/ directory in target dir', async () => {
    const result = await runInit('--local --yes', tempDir)
    expect(result.code).toBe(0)
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(true)
  })

  it('creates .mdm.toml config file', async () => {
    await runInit('--local --yes', tempDir)
    const configPath = path.join(tempDir, '.mdm.toml')
    expect(fs.existsSync(configPath)).toBe(true)
    const parsed = loadTomlFile(configPath)
    expect(parsed).not.toBeNull()
  })

  it('adds .mdm/ to .gitignore when .git exists', async () => {
    // Create a fake git repo
    fs.mkdirSync(path.join(tempDir, '.git'))
    await runInit('--local --yes', tempDir)
    const gitignore = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('.mdm/')
  })

  it('does not create .gitignore when no .git dir', async () => {
    await runInit('--local --yes', tempDir)
    // No .git dir means no .gitignore should be created
    expect(fs.existsSync(path.join(tempDir, '.gitignore'))).toBe(false)
  })

  it('appends to existing .gitignore without duplicating', async () => {
    fs.mkdirSync(path.join(tempDir, '.git'))
    fs.writeFileSync(path.join(tempDir, '.gitignore'), 'node_modules/\n')
    await runInit('--local --yes', tempDir)
    const gitignore = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('node_modules/')
    expect(gitignore).toContain('.mdm/')
  })

  it('warns when already initialized locally', async () => {
    fs.mkdirSync(path.join(tempDir, '.mdm'))
    const result = await runInit('--local --yes', tempDir)
    expect(result.stdout).toContain('Already initialized locally')
  })

  it('does not overwrite existing .mdm.toml', async () => {
    const configPath = path.join(tempDir, '.mdm.toml')
    fs.writeFileSync(configPath, '[index]\nmaxDepth = 99\n')
    await runInit('--local --yes', tempDir)
    // File should still have our custom content
    const content = fs.readFileSync(configPath, 'utf-8')
    expect(content).toContain('maxDepth = 99')
  })
})

describe('mdm init --global', () => {
  it('creates ~/.mdm/ directory', async () => {
    await runInit('--global --yes', tempDir)
    expect(fs.existsSync(path.join(fakeHome, '.mdm'))).toBe(true)
  })

  it('creates ~/.mdm/.mdm.toml', async () => {
    await runInit('--global --yes', tempDir)
    const configPath = path.join(fakeHome, '.mdm', '.mdm.toml')
    expect(fs.existsSync(configPath)).toBe(true)
  })

  it('registers cwd in [[sources]]', async () => {
    await runInit('--global --yes', tempDir)
    const configPath = path.join(fakeHome, '.mdm', '.mdm.toml')
    const content = fs.readFileSync(configPath, 'utf-8')
    expect(content).toContain(`path = "${tempDir}"`)
  })

  it('does not duplicate source on second init', async () => {
    await runInit('--global --yes', tempDir)
    await runInit('--global --yes', tempDir)
    const configPath = path.join(fakeHome, '.mdm', '.mdm.toml')
    const content = fs.readFileSync(configPath, 'utf-8')
    const matches = content.match(
      new RegExp(tempDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    )
    expect(matches).toHaveLength(1)
  })

  it('appends new source from different directory', async () => {
    const secondDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-init-2-')),
    )
    try {
      await runInit('--global --yes', tempDir)
      await runInit('--global --yes', secondDir)
      const configPath = path.join(fakeHome, '.mdm', '.mdm.toml')
      const content = fs.readFileSync(configPath, 'utf-8')
      expect(content).toContain(`path = "${tempDir}"`)
      expect(content).toContain(`path = "${secondDir}"`)
    } finally {
      fs.rmSync(secondDir, { recursive: true, force: true })
    }
  })

  it('generated config is valid parseable TOML', async () => {
    await runInit('--global --yes', tempDir)
    const configPath = path.join(fakeHome, '.mdm', '.mdm.toml')
    const parsed = loadTomlFile(configPath)
    // The generated file has [[sources]] which smol-toml should parse
    // The base config sections should parse fine
    expect(parsed).not.toBeNull()
  })
})

describe('mdm init with existing global', () => {
  it('adds source when global exists and --yes', async () => {
    // Pre-create global dir
    fs.mkdirSync(path.join(fakeHome, '.mdm'), { recursive: true })
    fs.writeFileSync(path.join(fakeHome, '.mdm', '.mdm.toml'), '')

    await runInit('--yes', tempDir)
    const content = fs.readFileSync(
      path.join(fakeHome, '.mdm', '.mdm.toml'),
      'utf-8',
    )
    expect(content).toContain(`path = "${tempDir}"`)
  })
})
