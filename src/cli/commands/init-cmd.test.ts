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
import { manifestPath } from '../../manifest.js'

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
  it('creates only project config in the target directory', async () => {
    const result = await runInit('--local --yes', tempDir)
    expect(result.code).toBe(0)
    expect(fs.existsSync(path.join(tempDir, '.mdm.toml'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, '.mdm'))).toBe(false)
    expect(fs.existsSync(path.join(tempDir, '.gitignore'))).toBe(false)
  })

  it('creates .mdm.toml config file', async () => {
    await runInit('--local --yes', tempDir)
    const configPath = path.join(tempDir, '.mdm.toml')
    expect(fs.existsSync(configPath)).toBe(true)
    const parsed = loadTomlFile(configPath)
    expect(parsed).not.toBeNull()
  })

  it('does not edit .gitignore when .git exists', async () => {
    fs.mkdirSync(path.join(tempDir, '.git'))
    fs.writeFileSync(path.join(tempDir, '.gitignore'), 'node_modules/\n')
    await runInit('--local --yes', tempDir)
    const gitignore = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8')
    expect(gitignore).toBe('node_modules/\n')
  })

  it('warns when already initialized locally', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.mdm.toml'),
      '[index]\nmaxDepth = 99\n',
    )
    const result = await runInit('--local --yes', tempDir)
    expect(result.stdout).toContain('Already initialized locally')
  })

  it('ignores an obsolete local index when creating project config', async () => {
    fs.mkdirSync(path.join(tempDir, '.mdm'))
    const result = await runInit('--local --yes', tempDir)
    const configPath = path.join(tempDir, '.mdm.toml')
    expect(result.stdout).toContain('Created .mdm.toml')
    expect(fs.existsSync(configPath)).toBe(true)
    expect(loadTomlFile(configPath)).not.toBeNull()
  })

  it('no-ops when .mdm.toml exists', async () => {
    const configPath = path.join(tempDir, '.mdm.toml')
    fs.writeFileSync(configPath, '[index]\nmaxDepth = 99\n')
    const result = await runInit('--local --yes', tempDir)
    expect(result.stdout).toContain('Already initialized locally')
    expect(result.stdout).not.toContain('Created .mdm.toml')
    expect(fs.readFileSync(configPath, 'utf-8')).toContain('maxDepth = 99')
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

  it('registers cwd in manifest.toml without adding config sources', async () => {
    await runInit('--global --yes', tempDir)
    const home = path.join(fakeHome, '.mdm')
    const manifest = fs.readFileSync(manifestPath(home), 'utf-8')
    const configPath = path.join(fakeHome, '.mdm', '.mdm.toml')
    // Paths are normalized to forward slashes in TOML (backslashes are escape
    // characters in TOML basic strings and invalid on Windows paths).
    const normalizedTempDir = tempDir.replace(/\\/g, '/')
    expect(manifest).toContain('[[dir]]')
    expect(manifest).toContain(`path = "${normalizedTempDir}"`)
    expect(loadTomlFile(configPath)).not.toHaveProperty('sources')
  })

  it('does not duplicate a directory on second init', async () => {
    await runInit('--global --yes', tempDir)
    await runInit('--global --yes', tempDir)
    const content = fs.readFileSync(
      manifestPath(path.join(fakeHome, '.mdm')),
      'utf-8',
    )
    // Paths are normalized to forward slashes in TOML output.
    const normalizedTempDir = tempDir.replace(/\\/g, '/')
    const matches = content.match(
      new RegExp(normalizedTempDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    )
    expect(matches).toHaveLength(1)
  })

  it('appends a new directory from a different cwd', async () => {
    const secondDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-init-2-')),
    )
    try {
      await runInit('--global --yes', tempDir)
      await runInit('--global --yes', secondDir)
      const content = fs.readFileSync(
        manifestPath(path.join(fakeHome, '.mdm')),
        'utf-8',
      )
      // Paths are normalized to forward slashes in TOML output.
      expect(content).toContain(`path = "${tempDir.replace(/\\/g, '/')}"`)
      expect(content).toContain(`path = "${secondDir.replace(/\\/g, '/')}"`)
    } finally {
      fs.rmSync(secondDir, { recursive: true, force: true })
    }
  })

  it('generated config is valid parseable TOML', async () => {
    await runInit('--global --yes', tempDir)
    const configPath = path.join(fakeHome, '.mdm', '.mdm.toml')
    const parsed = loadTomlFile(configPath)
    expect(parsed).not.toBeNull()
    expect(parsed).not.toHaveProperty('sources')
  })
})

describe('mdm init with existing global', () => {
  it('adds a directory when global exists and --yes', async () => {
    // Pre-create global dir
    fs.mkdirSync(path.join(fakeHome, '.mdm'), { recursive: true })
    fs.writeFileSync(path.join(fakeHome, '.mdm', '.mdm.toml'), '')

    await runInit('--yes', tempDir)
    const content = fs.readFileSync(
      manifestPath(path.join(fakeHome, '.mdm')),
      'utf-8',
    )
    // Paths are normalized to forward slashes in TOML output.
    expect(content).toContain(`path = "${tempDir.replace(/\\/g, '/')}"`)
  })
})
