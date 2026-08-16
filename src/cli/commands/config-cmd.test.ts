import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '../../config/schema.js'
import { CONFIG_VALIDATION_PATHS } from '../../config/validation.js'
import { generateDefaultToml } from './init-toml.js'

const bin = path.resolve(import.meta.dirname, '../../../dist/cli/main.js')

let tempDir: string
let fakeHome: string

const writeToml = (content: string): void => {
  fs.writeFileSync(path.join(tempDir, '.mdm.toml'), content, 'utf-8')
}

const writeGlobalToml = (content: string): void => {
  const globalConfigDir = path.join(fakeHome, '.mdm')
  fs.mkdirSync(globalConfigDir, { recursive: true })
  fs.writeFileSync(path.join(globalConfigDir, '.mdm.toml'), content, 'utf-8')
}

const collectConfigOutputPaths = (config: Record<string, unknown>): string[] =>
  Object.entries(config).flatMap(([sectionName, section]) =>
    Object.keys(section as Record<string, unknown>).map(
      (key) => `${sectionName}.${key}`,
    ),
  )

const countParseWarnings = (stderr: string): number =>
  stderr
    .split('\n')
    .filter((line) => line.includes('[mdm] Failed to parse config file')).length

const runConfigCheck = (
  args: string[] = [],
): { stdout: string; stderr: string; code: number } => {
  const result = spawnSync(
    process.execPath,
    [bin, 'config', 'check', ...args],
    {
      cwd: tempDir,
      env: {
        ...process.env,
        HOME: fakeHome,
        MDM_HOME: path.join(fakeHome, '.mdm'),
        USERPROFILE: fakeHome,
        HOMEDRIVE: '',
        HOMEPATH: fakeHome,
      },
      encoding: 'utf-8',
    },
  )

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    code: result.status ?? 0,
  }
}

describe('mdm config check', () => {
  beforeEach(() => {
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-config-check-')),
    )
    fakeHome = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-config-home-')),
    )
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(fakeHome, { recursive: true, force: true })
  })

  it('reports invalid enums, shows effective values, and exits non-zero', () => {
    writeToml('[embeddings]\nprovider = "bogus"\n')

    const result = runConfigCheck(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.code).toBe(1)
    expect(parsed.valid).toBe(false)
    expect(parsed.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('embeddings.provider')]),
    )
    expect(parsed.config.embeddings.provider).toMatchObject({
      value: defaultConfig.embeddings.provider,
      source: 'file',
      valid: false,
    })
    expect(result.stderr).toContain('Configuration check failed')
  })

  it('reports wrong types and out-of-range numbers', () => {
    writeToml(`
[search]
defaultLimit = "ten"
minSimilarity = 2

[output]
color = "yes"
`)

    const result = runConfigCheck(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.code).toBe(1)
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('search.defaultLimit'),
        expect.stringContaining('search.minSimilarity'),
        expect.stringContaining('output.color'),
      ]),
    )
    expect(parsed.config.search.defaultLimit).toMatchObject({
      value: defaultConfig.search.defaultLimit,
      source: 'file',
      valid: false,
    })
    expect(parsed.config.search.minSimilarity).toMatchObject({
      value: defaultConfig.search.minSimilarity,
      source: 'file',
      valid: false,
    })
    expect(parsed.config.output.color).toMatchObject({
      value: defaultConfig.output.color,
      source: 'file',
      valid: false,
    })
  })

  it('reports malformed TOML as distinct from missing config', () => {
    writeGlobalToml('[search]\ndefaultLimit = 42\n')
    writeToml('{ invalid toml <<<')

    const result = runConfigCheck(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.code).toBe(1)
    expect(parsed.valid).toBe(false)
    expect(parsed.sourceFile).toBe(path.join(fakeHome, '.mdm', '.mdm.toml'))
    expect(parsed.errors).toEqual([
      expect.stringContaining('Failed to parse config file'),
    ])
    expect(parsed.config.search.defaultLimit.value).toBe(42)
    expect(parsed.errors[0]).toContain(
      fs.realpathSync(path.join(tempDir, '.mdm.toml')),
    )
    expect(countParseWarnings(result.stderr)).toBe(1)
    expect(result.stderr).toContain('Configuration check failed')
  })

  it('includes aiSummarization in JSON and text output', () => {
    const jsonResult = runConfigCheck(['--json'])
    const parsed = JSON.parse(jsonResult.stdout)

    expect(jsonResult.code).toBe(0)
    expect(parsed.config.aiSummarization.mode.value).toBe(
      defaultConfig.aiSummarization.mode,
    )

    const textResult = runConfigCheck()
    expect(textResult.stdout).toContain('aiSummarization:')
  })

  it('marks all generated concrete TOML fields as file sourced', () => {
    writeToml(generateDefaultToml())

    const result = runConfigCheck(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.code).toBe(0)
    expect(parsed.valid).toBe(true)
    expect(parsed.config.embeddings.maxRetries.source).toBe('file')
    expect(parsed.config.embeddings.concurrency.source).toBe('file')
    expect(parsed.config.embeddings.retryDelayMs.source).toBe('file')
    expect(parsed.config.embeddings.timeoutMs.source).toBe('file')
    expect(parsed.config.embeddings.hnswM.source).toBe('file')
    expect(parsed.config.embeddings.hnswEfConstruction.source).toBe('file')
  })

  it('shows every validated config field', () => {
    const result = runConfigCheck(['--json'])
    const parsed = JSON.parse(result.stdout)

    expect(result.code).toBe(0)
    expect(collectConfigOutputPaths(parsed.config).sort()).toEqual(
      [...CONFIG_VALIDATION_PATHS].sort(),
    )
  })
})
