import { Option } from 'effect'
import { parse as parseToml } from 'smol-toml'
import { afterEach, describe, expect, it } from 'vitest'
import { generateDefaultToml } from '../cli/commands/init-toml.js'
import { mergeWithDefaults, readEnvVars } from './loader.js'
import { defaultConfig } from './schema.js'
import { CONFIG_VALIDATION_PATHS, collectConfigIssues } from './validation.js'

const flattenPaths = (value: unknown, prefix = ''): string[] => {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Option.isOption(value)
  ) {
    return prefix ? [prefix] : []
  }

  return Object.entries(value).flatMap(([key, child]) =>
    flattenPaths(child, prefix ? `${prefix}.${key}` : key),
  )
}

const readPath = (value: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    )

const readTomlSection = (toml: string, sectionName: string): string => {
  const sectionStart = toml.indexOf(`[${sectionName}]`)
  if (sectionStart === -1) return ''
  const nextSectionStart = toml.indexOf('\n[', sectionStart + 1)
  return toml.slice(
    sectionStart,
    nextSectionStart === -1 ? undefined : nextSectionStart,
  )
}

describe('config validation', () => {
  afterEach(() => {
    delete process.env.MDM_SEARCH_DEFAULTLIMIT
  })

  it('attributes search limit range errors to the correct field', () => {
    const oversizedDefault = collectConfigIssues({
      ...defaultConfig,
      search: { ...defaultConfig.search, defaultLimit: 1000 },
    })
    expect(oversizedDefault.map((issue) => issue.path)).toEqual([
      'search.defaultLimit',
    ])

    const invertedLimits = collectConfigIssues({
      ...defaultConfig,
      search: { ...defaultConfig.search, defaultLimit: 20, maxLimit: 10 },
    })
    expect(invertedLimits.map((issue) => issue.path)).toEqual([
      'search.defaultLimit',
    ])

    const invalidMax = collectConfigIssues({
      ...defaultConfig,
      search: { ...defaultConfig.search, maxLimit: 0 },
    })
    expect(invalidMax.map((issue) => issue.path)).toEqual(['search.maxLimit'])
  })

  it('rejects empty file extension arrays', () => {
    const issues = collectConfigIssues({
      ...defaultConfig,
      index: { ...defaultConfig.index, fileExtensions: [] },
    })
    expect(issues.map((issue) => issue.path)).toEqual(['index.fileExtensions'])
  })

  it.each(['', '0x10', '1e2'])(
    'rejects non-decimal numeric env values: %s',
    (value) => {
      process.env.MDM_SEARCH_DEFAULTLIMIT = value
      const config = mergeWithDefaults(readEnvVars())
      const issues = collectConfigIssues(config)

      expect(issues.map((issue) => issue.path)).toContain('search.defaultLimit')
    },
  )

  it('keeps validation rules and generated TOML aligned with defaultConfig', () => {
    const defaultPaths = flattenPaths(defaultConfig)
    expect([...CONFIG_VALIDATION_PATHS].sort()).toEqual(
      [...defaultPaths].sort(),
    )

    const toml = generateDefaultToml()
    const parsed = parseToml(toml)
    for (const path of defaultPaths) {
      const defaultValue = readPath(defaultConfig, path)
      const [sectionName, key] = path.split('.')
      if (Option.isOption(defaultValue)) {
        expect(readTomlSection(toml, sectionName!)).toMatch(
          new RegExp(`^# ${key} = `, 'm'),
        )
      } else {
        expect(readPath(parsed, path)).not.toBeUndefined()
      }
    }
  })
})
