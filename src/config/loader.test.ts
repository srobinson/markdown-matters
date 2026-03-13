/**
 * Config Loader Tests
 *
 * Covers: TOML parsing, partial merge, env var precedence,
 * two-tier resolution, and edge cases.
 *
 * ALP-1306: TOML loading and partial merge
 * ALP-1307: Env var precedence
 * ALP-1308: Two-tier resolution
 * ALP-1311: Edge cases
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Option } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  load,
  loadConfigFile,
  loadTomlFile,
  mergeWithDefaults,
  readEnvVars,
  readEnvVarsMap,
  validateConfig,
} from './loader.js'
import { defaultConfig } from './schema.js'

// ============================================================================
// Helpers
// ============================================================================

let tempDir: string

const writeToml = (dir: string, content: string): void => {
  fs.writeFileSync(path.join(dir, '.mdm.toml'), content, 'utf-8')
}

const writeTomlConfig = (
  dir: string,
  config: Record<string, Record<string, unknown>>,
): void => {
  const lines: string[] = []
  for (const [section, values] of Object.entries(config)) {
    lines.push(`[${section}]`)
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'string') {
        lines.push(`${key} = "${value}"`)
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        lines.push(`${key} = ${value}`)
      } else if (Array.isArray(value)) {
        lines.push(`${key} = [${value.map((v) => `"${v}"`).join(', ')}]`)
      }
    }
    lines.push('')
  }
  writeToml(dir, lines.join('\n'))
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-loader-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

// ============================================================================
// ALP-1306: TOML Parsing
// ============================================================================

describe('TOML parsing (loadTomlFile)', () => {
  it('parses valid TOML with all fields', () => {
    writeToml(
      tempDir,
      `
[index]
maxDepth = 5

[search]
defaultLimit = 20

[embeddings]
provider = "ollama"
model = "nomic-embed-text"
`,
    )
    const result = loadTomlFile(path.join(tempDir, '.mdm.toml'))
    expect(result).not.toBeNull()
    expect(result!.index!.maxDepth).toBe(5)
    expect(result!.search!.defaultLimit).toBe(20)
    expect(result!.embeddings!.provider).toBe('ollama')
  })

  it('returns null for non-existent file', () => {
    const result = loadTomlFile('/nonexistent/.mdm.toml')
    expect(result).toBeNull()
  })

  it('returns null and warns for invalid TOML', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeToml(tempDir, '{ invalid toml <<<')
    const result = loadTomlFile(path.join(tempDir, '.mdm.toml'))
    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('handles empty TOML file', () => {
    writeToml(tempDir, '')
    const result = loadTomlFile(path.join(tempDir, '.mdm.toml'))
    expect(result).not.toBeNull()
    // Empty object, all defaults when merged
  })

  it('handles TOML with only a section header and no keys', () => {
    writeToml(tempDir, '[search]\n')
    const result = loadTomlFile(path.join(tempDir, '.mdm.toml'))
    expect(result).not.toBeNull()
  })

  it('ignores unknown top-level keys', () => {
    writeToml(tempDir, '[unknown_section]\nfoo = "bar"\n')
    const result = loadTomlFile(path.join(tempDir, '.mdm.toml'))
    expect(result).not.toBeNull()
  })

  it('ignores unknown keys inside a known section', () => {
    writeToml(tempDir, '[index]\nmaxDepth = 5\nunknownKey = 99\n')
    const result = loadTomlFile(path.join(tempDir, '.mdm.toml'))
    expect(result).not.toBeNull()
    expect(result!.index!.maxDepth).toBe(5)
  })
})

// ============================================================================
// ALP-1306: Partial Merge / Defaults
// ============================================================================

describe('mergeWithDefaults', () => {
  it('returns complete MdmConfig matching defaults for empty partial', () => {
    const result = mergeWithDefaults({})
    expect(result.index.maxDepth).toBe(defaultConfig.index.maxDepth)
    expect(result.search.defaultLimit).toBe(defaultConfig.search.defaultLimit)
    expect(result.embeddings.provider).toBe(defaultConfig.embeddings.provider)
    expect(result.output.format).toBe(defaultConfig.output.format)
  })

  it('overrides only the specified field', () => {
    const result = mergeWithDefaults({ search: { defaultLimit: 20 } })
    expect(result.search.defaultLimit).toBe(20)
    expect(result.search.maxLimit).toBe(defaultConfig.search.maxLimit)
    expect(result.search.minSimilarity).toBe(defaultConfig.search.minSimilarity)
  })

  it('overrides provider without clobbering other embedding fields', () => {
    const result = mergeWithDefaults({ embeddings: { provider: 'ollama' } })
    expect(result.embeddings.provider).toBe('ollama')
    expect(result.embeddings.model).toBe(defaultConfig.embeddings.model)
    expect(result.embeddings.dimensions).toBe(
      defaultConfig.embeddings.dimensions,
    )
    expect(result.embeddings.batchSize).toBe(defaultConfig.embeddings.batchSize)
  })

  it('does not clobber sibling keys in deep merge', () => {
    const result = mergeWithDefaults({
      index: { maxDepth: 3 },
      search: { defaultLimit: 50 },
    })
    expect(result.index.maxDepth).toBe(3)
    expect(result.index.followSymlinks).toBe(defaultConfig.index.followSymlinks)
    expect(result.search.defaultLimit).toBe(50)
    expect(result.search.includeSnippets).toBe(
      defaultConfig.search.includeSnippets,
    )
  })

  it('treats false as a valid boolean override', () => {
    // Default is true
    expect(defaultConfig.output.color).toBe(true)
    const result = mergeWithDefaults({ output: { color: false } })
    expect(result.output.color).toBe(false)
  })

  it('treats 0 as a valid number override', () => {
    const result = mergeWithDefaults({ search: { minSimilarity: 0 } })
    expect(result.search.minSimilarity).toBe(0)
  })

  it('wraps string values in Option.some for Option fields', () => {
    const result = mergeWithDefaults({
      embeddings: { baseURL: 'http://localhost:11434' },
    })
    expect(Option.isSome(result.embeddings.baseURL)).toBe(true)
    expect(Option.getOrElse(result.embeddings.baseURL, () => '')).toBe(
      'http://localhost:11434',
    )
  })

  it('leaves Option fields as none when not provided', () => {
    const result = mergeWithDefaults({})
    expect(Option.isNone(result.embeddings.baseURL)).toBe(true)
    expect(Option.isNone(result.embeddings.apiKey)).toBe(true)
  })
})

// ============================================================================
// ALP-1307: Environment Variable Override
// ============================================================================

describe('readEnvVars', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    // Save current env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MDM_')) {
        savedEnv[key] = process.env[key]
        delete process.env[key]
      }
    }
  })

  afterEach(() => {
    // Remove test env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MDM_')) {
        delete process.env[key]
      }
    }
    // Restore original env
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val !== undefined) {
        process.env[key] = val
      }
    }
  })

  it('reads MDM_INDEX_MAXDEPTH as index.maxDepth', () => {
    process.env.MDM_INDEX_MAXDEPTH = '20'
    const result = readEnvVars()
    expect(result.index?.maxDepth).toBe(20)
  })

  it('reads MDM_SEARCH_DEFAULTLIMIT as search.defaultLimit', () => {
    process.env.MDM_SEARCH_DEFAULTLIMIT = '50'
    const result = readEnvVars()
    expect(result.search?.defaultLimit).toBe(50)
  })

  it('reads MDM_EMBEDDINGS_PROVIDER as embeddings.provider', () => {
    process.env.MDM_EMBEDDINGS_PROVIDER = 'ollama'
    const result = readEnvVars()
    expect(result.embeddings?.provider).toBe('ollama')
  })

  it('reads MDM_EMBEDDINGS_MODEL as embeddings.model', () => {
    process.env.MDM_EMBEDDINGS_MODEL = 'nomic-embed-text'
    const result = readEnvVars()
    expect(result.embeddings?.model).toBe('nomic-embed-text')
  })

  it('reads MDM_OUTPUT_VERBOSE as output.verbose (boolean)', () => {
    process.env.MDM_OUTPUT_VERBOSE = 'true'
    const result = readEnvVars()
    expect(result.output?.verbose).toBe(true)
  })

  it('reads MDM_OUTPUT_COLOR as output.color (boolean)', () => {
    process.env.MDM_OUTPUT_COLOR = 'false'
    const result = readEnvVars()
    expect(result.output?.color).toBe(false)
  })

  it('reads comma-separated values for array fields', () => {
    process.env.MDM_INDEX_EXCLUDEPATTERNS = 'node_modules,.git,vendor'
    const result = readEnvVars()
    expect(result.index?.excludePatterns).toEqual([
      'node_modules',
      '.git',
      'vendor',
    ])
  })

  it('reads Option string fields (baseURL)', () => {
    process.env.MDM_EMBEDDINGS_BASEURL = 'http://localhost:11434'
    const result = readEnvVars()
    expect(result.embeddings?.baseURL).toBe('http://localhost:11434')
  })

  it('ignores unknown env vars', () => {
    process.env.MDM_UNKNOWN_FIELD = 'value'
    const result = readEnvVars()
    expect(Object.keys(result)).not.toContain('unknown')
  })

  it('returns empty partial when no MDM_ vars set', () => {
    const result = readEnvVars()
    expect(Object.keys(result).length).toBe(0)
  })
})

describe('readEnvVarsMap', () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MDM_')) delete process.env[key]
    }
  })

  it('returns section.key format for detected env vars', () => {
    process.env.MDM_INDEX_MAXDEPTH = '20'
    const result = readEnvVarsMap()
    expect(result.get('index.maxDepth')).toBe('20')
  })
})

describe('env var precedence in load()', () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MDM_')) delete process.env[key]
    }
  })

  it('env var overrides file config', () => {
    writeTomlConfig(tempDir, { search: { defaultLimit: 10 } })
    process.env.MDM_SEARCH_DEFAULTLIMIT = '20'

    const result = load({ workingDir: tempDir })
    expect(result.search.defaultLimit).toBe(20)

    delete process.env.MDM_SEARCH_DEFAULTLIMIT
  })

  it('env var overrides compiled defaults', () => {
    process.env.MDM_SEARCH_DEFAULTLIMIT = '30'

    const result = load({ workingDir: tempDir, skipConfigFile: true })
    expect(result.search.defaultLimit).toBe(30)

    delete process.env.MDM_SEARCH_DEFAULTLIMIT
  })

  it('CLI override takes precedence over env var', () => {
    process.env.MDM_SEARCH_DEFAULTLIMIT = '20'

    const result = load({
      workingDir: tempDir,
      skipConfigFile: true,
      cliOverrides: { search: { defaultLimit: 99 } },
    })
    expect(result.search.defaultLimit).toBe(99)

    delete process.env.MDM_SEARCH_DEFAULTLIMIT
  })

  it('file config takes precedence over compiled defaults', () => {
    writeTomlConfig(tempDir, { search: { defaultLimit: 15 } })

    const result = load({ workingDir: tempDir, skipEnv: true })
    expect(result.search.defaultLimit).toBe(15)
  })
})

// ============================================================================
// ALP-1308: Two-Tier Resolution
// ============================================================================

describe('two-tier resolution (loadConfigFile)', () => {
  it('uses local file when it exists', () => {
    writeTomlConfig(tempDir, { search: { defaultLimit: 5 } })
    const result = loadConfigFile(tempDir)
    expect(result).not.toBeNull()
    expect(result!.config.search!.defaultLimit).toBe(5)
    expect(result!.path).toBe(path.join(tempDir, '.mdm.toml'))
  })

  it('returns null when neither local nor global exists', () => {
    const result = loadConfigFile(tempDir)
    expect(result).toBeNull()
  })

  it('local file wins when both local and global exist', () => {
    // Simulate: local file exists, uses load() with fileConfig
    writeTomlConfig(tempDir, { search: { defaultLimit: 5 } })
    const result = load({ workingDir: tempDir, skipEnv: true })
    expect(result.search.defaultLimit).toBe(5)
  })

  it('empty local file uses defaults (no fallthrough to global)', () => {
    writeToml(tempDir, '')
    const result = loadConfigFile(tempDir)
    // Returns the empty config, does not search for global
    expect(result).not.toBeNull()
    const loaded = load({ workingDir: tempDir, skipEnv: true })
    expect(loaded.search.defaultLimit).toBe(defaultConfig.search.defaultLimit)
  })

  it('invalid local TOML uses defaults (no fallthrough to global)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeToml(tempDir, '{ invalid <<<')
    // loadTomlFile returns null for invalid TOML
    const tomlResult = loadTomlFile(path.join(tempDir, '.mdm.toml'))
    expect(tomlResult).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('load() with two-tier', () => {
  it('returns all defaults when no config file exists', () => {
    const result = load({ workingDir: tempDir, skipEnv: true })
    expect(result.index.maxDepth).toBe(defaultConfig.index.maxDepth)
    expect(result.embeddings.provider).toBe(defaultConfig.embeddings.provider)
  })

  it('merges file config with defaults', () => {
    writeTomlConfig(tempDir, {
      index: { maxDepth: 3 },
      embeddings: { provider: 'ollama', model: 'nomic-embed-text' },
    })
    const result = load({ workingDir: tempDir, skipEnv: true })
    expect(result.index.maxDepth).toBe(3)
    expect(result.embeddings.provider).toBe('ollama')
    expect(result.embeddings.model).toBe('nomic-embed-text')
    // Other fields remain defaults
    expect(result.search.defaultLimit).toBe(defaultConfig.search.defaultLimit)
  })
})

// ============================================================================
// ALP-1306 + ALP-1311: Validation
// ============================================================================

describe('validateConfig', () => {
  it('passes valid config unchanged', () => {
    const result = validateConfig(defaultConfig)
    expect(result.embeddings.provider).toBe('openai')
    expect(result.output.format).toBe('text')
  })

  it('replaces invalid embeddings.provider with default', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const config = {
      ...defaultConfig,
      embeddings: { ...defaultConfig.embeddings, provider: 'invalid' as any },
    }
    const result = validateConfig(config)
    expect(result.embeddings.provider).toBe(defaultConfig.embeddings.provider)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('replaces invalid output.format with default', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const config = {
      ...defaultConfig,
      output: { ...defaultConfig.output, format: 'xml' as any },
    }
    const result = validateConfig(config)
    expect(result.output.format).toBe(defaultConfig.output.format)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('replaces invalid aiSummarization.mode with default', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const config = {
      ...defaultConfig,
      aiSummarization: {
        ...defaultConfig.aiSummarization,
        mode: 'invalid' as any,
      },
    }
    const result = validateConfig(config)
    expect(result.aiSummarization.mode).toBe(defaultConfig.aiSummarization.mode)
    warnSpy.mockRestore()
  })
})

// ============================================================================
// ALP-1311: Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles TOML with Windows line endings (CRLF)', () => {
    writeToml(tempDir, '[index]\r\nmaxDepth = 7\r\n')
    const result = loadTomlFile(path.join(tempDir, '.mdm.toml'))
    expect(result).not.toBeNull()
    expect(result!.index!.maxDepth).toBe(7)
  })

  it('concurrent load() calls return independent config objects', () => {
    writeTomlConfig(tempDir, { index: { maxDepth: 3 } })
    const a = load({ workingDir: tempDir, skipEnv: true })
    const b = load({ workingDir: tempDir, skipEnv: true })
    expect(a).toEqual(b)
    expect(a).not.toBe(b) // Different object references
  })

  it('load() with all-undefined overrides behaves like no overrides', () => {
    const withOverrides = load({
      workingDir: tempDir,
      skipEnv: true,
      cliOverrides: {},
    })
    const without = load({ workingDir: tempDir, skipEnv: true })
    expect(withOverrides).toEqual(without)
  })

  it('handles TOML with very large arrays', () => {
    const patterns = Array.from({ length: 200 }, (_, i) => `dir${i}`)
    writeTomlConfig(tempDir, {
      index: { excludePatterns: patterns },
    })
    const result = load({ workingDir: tempDir, skipEnv: true })
    expect(result.index.excludePatterns).toHaveLength(200)
  })

  it('handles empty string values in TOML', () => {
    writeToml(tempDir, '[embeddings]\nmodel = ""\n')
    const result = load({ workingDir: tempDir, skipEnv: true })
    expect(result.embeddings.model).toBe('')
  })
})

// ============================================================================
// ALP-1311: load() with fileConfig (testing bypass)
// ============================================================================

describe('load() with fileConfig', () => {
  it('uses provided fileConfig instead of reading from disk', () => {
    const result = load({
      fileConfig: { embeddings: { provider: 'voyage' } },
      skipConfigFile: true,
      skipEnv: true,
    })
    expect(result.embeddings.provider).toBe('voyage')
  })

  it('fileConfig merges with defaults', () => {
    const result = load({
      fileConfig: { index: { maxDepth: 2 } },
      skipConfigFile: true,
      skipEnv: true,
    })
    expect(result.index.maxDepth).toBe(2)
    expect(result.index.followSymlinks).toBe(defaultConfig.index.followSymlinks)
  })
})
