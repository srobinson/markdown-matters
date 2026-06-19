/**
 * Configuration Loader
 *
 * Mirrors the attention-matters config.rs pattern:
 *   1. Start with compiled defaults
 *   2. Apply TOML file config (PWD/.mdm.toml -> ~/.mdm/.mdm.toml fallback)
 *   3. Apply env vars (MDM_* prefix)
 *   4. Apply CLI overrides (passed as partial)
 *   5. Return concrete MdmConfig
 *
 * Invalid TOML is logged as a warning and skipped (falls through to defaults).
 * No string serialisation/deserialisation. No ConfigProvider intermediary.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Option } from 'effect'
import { parse as parseToml } from 'smol-toml'
import type { MdmConfig } from './schema.js'
import { defaultConfig } from './schema.js'
import {
  type ConfigIssue,
  coerceConfig,
  collectConfigIssues,
  formatConfigIssue,
} from './validation.js'

// ============================================================================
// Partial Config Type (wire format)
// ============================================================================

/**
 * Deeply partial config type for merging.
 * Option fields are represented as plain strings in the wire format.
 */
export type PartialMdmConfig = {
  [K in keyof MdmConfig]?: PartialSection<MdmConfig[K]>
}

/**
 * For a config section, make all fields optional.
 * Option<string> fields become string | undefined in the wire format.
 */
type PartialSection<T> = {
  [K in keyof T]?: T[K] extends Option.Option<infer U> ? U | undefined : T[K]
}

// ============================================================================
// TOML File Loading
// ============================================================================

export interface ConfigParseError {
  path: string
  message: string
}

export type TomlFileLoadResult =
  | { status: 'missing'; path: string }
  | { status: 'loaded'; path: string; config: PartialMdmConfig }
  | { status: 'error'; error: ConfigParseError }

export type ConfigFileLoadResult =
  | { status: 'missing' }
  | { status: 'loaded'; path: string; config: PartialMdmConfig }
  | { status: 'error'; error: ConfigParseError }

const formatConfigParseError = (error: ConfigParseError): string =>
  `Failed to parse config file ${error.path}: ${error.message}`

const warnConfigParseError = (error: ConfigParseError): void => {
  console.warn(`[mdm] ${formatConfigParseError(error)}`)
}

/**
 * Attempt to load and parse a TOML config file with explicit status.
 */
export const loadTomlFileWithStatus = (
  filePath: string,
): TomlFileLoadResult => {
  try {
    if (!fs.existsSync(filePath)) return { status: 'missing', path: filePath }
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = parseToml(content)
    return {
      status: 'loaded',
      path: filePath,
      config: parsed as unknown as PartialMdmConfig,
    }
  } catch (error) {
    return {
      status: 'error',
      error: {
        path: filePath,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

/**
 * Attempt to load and parse a TOML config file.
 * Returns null if the file does not exist or cannot be parsed.
 */
export const loadTomlFile = (filePath: string): PartialMdmConfig | null => {
  const result = loadTomlFileWithStatus(filePath)
  if (result.status === 'loaded') return result.config
  if (result.status === 'error') warnConfigParseError(result.error)
  return null
}

// ============================================================================
// Two-Tier Config File Resolution
// ============================================================================

/**
 * Find and load the config file using two-tier resolution with explicit status:
 *   1. PWD/.mdm.toml (project-local)
 *   2. ~/.mdm/.mdm.toml (global)
 */
export const loadConfigFileWithStatus = (
  workingDir?: string,
): ConfigFileLoadResult => {
  const cwd = workingDir ?? process.cwd()

  // Tier 1: project-local
  const localPath = path.join(cwd, '.mdm.toml')
  const localResult = loadTomlFileWithStatus(localPath)
  if (localResult.status === 'loaded') {
    return { status: 'loaded', config: localResult.config, path: localPath }
  }
  if (localResult.status === 'error') return localResult

  // Tier 2: global
  const globalPath = path.join(os.homedir(), '.mdm', '.mdm.toml')
  const globalResult = loadTomlFileWithStatus(globalPath)
  if (globalResult.status === 'loaded') {
    return { status: 'loaded', config: globalResult.config, path: globalPath }
  }
  if (globalResult.status === 'error') return globalResult

  return { status: 'missing' }
}

/**
 * Find and load the config file using two-tier resolution:
 *   1. PWD/.mdm.toml (project-local)
 *   2. ~/.mdm/.mdm.toml (global)
 *
 * Returns the first config found, or null if neither exists.
 */
export const loadConfigFile = (
  workingDir?: string,
): { config: PartialMdmConfig; path: string } | null => {
  const result = loadConfigFileWithStatus(workingDir)
  if (result.status === 'loaded') {
    return { config: result.config, path: result.path }
  }
  if (result.status === 'error') warnConfigParseError(result.error)
  return null
}

// ============================================================================
// Environment Variable Reading
// ============================================================================

/**
 * Mapping from env var suffix (lowercased, after prefix removal) to
 * { section, key } in the config structure.
 *
 * Env format: MDM_SECTION_KEY (case-insensitive after prefix).
 * Example: MDM_INDEX_MAXDEPTH -> { section: 'index', key: 'maxDepth' }
 */
const ENV_KEY_MAP: Record<string, { section: string; key: string }> = {}

// Build the mapping from defaultConfig structure
for (const section of Object.keys(defaultConfig) as (keyof MdmConfig)[]) {
  const sectionObj = defaultConfig[section]
  for (const key of Object.keys(sectionObj)) {
    const envSuffix = `${section}_${key}`.toLowerCase()
    ENV_KEY_MAP[envSuffix] = { section, key }
  }
}

/**
 * Read MDM_* environment variables and return them as a partial config.
 */
export const readEnvVars = (prefix = 'MDM'): PartialMdmConfig => {
  const result: Record<string, Record<string, unknown>> = {}
  const prefixUnderscore = `${prefix}_`

  for (const [envKey, envValue] of Object.entries(process.env)) {
    if (!envKey.startsWith(prefixUnderscore) || envValue === undefined) continue

    const suffix = envKey.slice(prefixUnderscore.length).toLowerCase()
    const mapping = ENV_KEY_MAP[suffix]
    if (!mapping) continue

    if (!result[mapping.section]) {
      result[mapping.section] = {}
    }

    // Parse the env value to the appropriate type
    result[mapping.section]![mapping.key] = parseEnvValue(
      envValue,
      mapping.section as keyof MdmConfig,
      mapping.key,
    )
  }

  return result as PartialMdmConfig
}

/**
 * Read MDM_* environment variables and return a Map of "section.key" -> raw string value.
 * Used by the config check command to detect which values come from environment.
 */
export const readEnvVarsMap = (prefix = 'MDM'): Map<string, string> => {
  const result = new Map<string, string>()
  const prefixUnderscore = `${prefix}_`

  for (const [envKey, envValue] of Object.entries(process.env)) {
    if (!envKey.startsWith(prefixUnderscore) || envValue === undefined) continue

    const suffix = envKey.slice(prefixUnderscore.length).toLowerCase()
    const mapping = ENV_KEY_MAP[suffix]
    if (!mapping) continue

    result.set(`${mapping.section}.${mapping.key}`, envValue)
  }

  return result
}

/**
 * Parse an environment variable string into the appropriate config type.
 */
const parseEnvValue = (
  value: string,
  section: keyof MdmConfig,
  key: string,
): unknown => {
  const defaultSection = defaultConfig[section]
  const defaultValue = (defaultSection as unknown as Record<string, unknown>)[
    key
  ]

  // Option fields: return the string directly (will be wrapped in Option.some during merge)
  if (Option.isOption(defaultValue)) {
    return value
  }

  // Array fields: split on comma
  if (Array.isArray(defaultValue)) {
    return value.split(',').map((s) => s.trim())
  }

  // Boolean fields
  if (typeof defaultValue === 'boolean') {
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false
    return value
  }

  // Number fields
  if (typeof defaultValue === 'number') {
    const num = Number(value)
    return Number.isFinite(num) ? num : value
  }

  // String fields (including literal unions)
  return value
}

// ============================================================================
// Merge Logic
// ============================================================================

/**
 * Fields that use Option<string> in the resolved config.
 * Values in the partial config are plain strings (or undefined).
 */
const OPTION_FIELDS: Record<string, Set<string>> = {
  embeddings: new Set(['baseURL', 'apiKey']),
  aiSummarization: new Set(['model', 'baseURL', 'apiKey']),
  paths: new Set(['root', 'configFile']),
}

/**
 * Merge a single section, handling Option field conversion.
 */
const mergeSection = <K extends keyof MdmConfig>(
  section: K,
  defaults: MdmConfig[K],
  partial: PartialSection<MdmConfig[K]> | undefined,
): MdmConfig[K] => {
  if (!partial) return defaults

  const optionFields = OPTION_FIELDS[section]
  const result = { ...defaults }

  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue

    if (optionFields?.has(key)) {
      // Convert plain string to Option.some
      ;(result as unknown as Record<string, unknown>)[key] = Option.some(value)
    } else {
      ;(result as unknown as Record<string, unknown>)[key] = value
    }
  }

  return result
}

/**
 * Merge a partial config with defaults, producing a complete MdmConfig.
 * Option fields in the partial are plain strings; they are wrapped in
 * Option.some() during merge.
 */
export const mergeWithDefaults = (partial: PartialMdmConfig): MdmConfig => ({
  index: mergeSection('index', defaultConfig.index, partial.index),
  search: mergeSection('search', defaultConfig.search, partial.search),
  embeddings: mergeSection(
    'embeddings',
    defaultConfig.embeddings,
    partial.embeddings,
  ),
  summarization: mergeSection(
    'summarization',
    defaultConfig.summarization,
    partial.summarization,
  ),
  aiSummarization: mergeSection(
    'aiSummarization',
    defaultConfig.aiSummarization,
    partial.aiSummarization,
  ),
  output: mergeSection('output', defaultConfig.output, partial.output),
  paths: mergeSection('paths', defaultConfig.paths, partial.paths),
})

/**
 * Deep-merge two partial configs. Later values win.
 */
const mergePartials = (
  base: PartialMdmConfig,
  overlay: PartialMdmConfig,
): PartialMdmConfig => {
  const result: Record<string, Record<string, unknown>> = {}

  // Copy base
  for (const [section, values] of Object.entries(base)) {
    result[section] = { ...(values as Record<string, unknown>) }
  }

  // Overlay
  for (const [section, values] of Object.entries(overlay)) {
    if (!result[section]) {
      result[section] = {}
    }
    Object.assign(result[section], values)
  }

  return result as PartialMdmConfig
}

// ============================================================================
// Main Load Function
// ============================================================================

export interface LoadOptions {
  /** CLI flag overrides (highest priority). */
  cliOverrides?: PartialMdmConfig | undefined
  /** Working directory for config file search. */
  workingDir?: string | undefined
  /** Environment variable prefix. Default: 'MDM'. */
  envPrefix?: string | undefined
  /** Skip loading config file. */
  skipConfigFile?: boolean | undefined
  /** Skip environment variables. */
  skipEnv?: boolean | undefined
  /** Pre-loaded file config (for testing). */
  fileConfig?: PartialMdmConfig | undefined
  /** Suppress validation and parse warnings. */
  suppressWarnings?: boolean | undefined
}

export interface LoadResult {
  config: MdmConfig
  unvalidatedConfig: MdmConfig
  validationIssues: ConfigIssue[]
  fileConfig: PartialMdmConfig
  envConfig: PartialMdmConfig
  sourceFile: string | null
  parseError?: ConfigParseError | undefined
}

/**
 * Load configuration with full precedence chain.
 *
 * Resolution order (highest to lowest priority):
 *   1. CLI overrides
 *   2. Environment variables (MDM_*)
 *   3. Config file (PWD/.mdm.toml -> ~/.mdm/.mdm.toml)
 *   4. Compiled defaults
 */
export const loadDetailed = (options: LoadOptions = {}): LoadResult => {
  const {
    cliOverrides,
    workingDir,
    envPrefix = 'MDM',
    skipConfigFile = false,
    skipEnv = false,
    suppressWarnings = false,
  } = options

  let merged: PartialMdmConfig = {}
  let fileConfig: PartialMdmConfig = {}
  let envConfig: PartialMdmConfig = {}
  let sourceFile: string | null = null
  let parseError: ConfigParseError | undefined

  // Layer 1: Config file (lowest priority source)
  // fileConfig always takes effect when provided (used for testing).
  // skipConfigFile only prevents reading from disk.
  if (options.fileConfig) {
    fileConfig = options.fileConfig
    merged = fileConfig
  } else if (!skipConfigFile) {
    const result = loadConfigFileWithStatus(workingDir)
    if (result.status === 'loaded') {
      sourceFile = result.path
      fileConfig = result.config
      merged = result.config
    } else if (result.status === 'error') {
      parseError = result.error
      if (!suppressWarnings) warnConfigParseError(result.error)
    }
  }

  // Layer 2: Environment variables
  if (!skipEnv) {
    envConfig = readEnvVars(envPrefix)
    merged = mergePartials(merged, envConfig)
  }

  // Layer 3: CLI overrides (highest priority)
  if (cliOverrides) {
    merged = mergePartials(merged, cliOverrides)
  }

  const unvalidatedConfig = mergeWithDefaults(merged)
  const validationIssues = collectConfigIssues(unvalidatedConfig)

  return {
    config: validateConfig(unvalidatedConfig, validationIssues, {
      warn: !suppressWarnings,
    }),
    unvalidatedConfig,
    validationIssues,
    fileConfig,
    envConfig,
    sourceFile,
    parseError,
  }
}

export const load = (options: LoadOptions = {}): MdmConfig =>
  loadDetailed(options).config

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that config fields contain valid values.
 * Called internally by load(). Invalid values are logged and replaced
 * with defaults.
 */
export const validateConfig = (
  config: MdmConfig,
  issues: ConfigIssue[] = collectConfigIssues(config),
  options: { warn?: boolean } = {},
): MdmConfig => {
  if (options.warn !== false) {
    for (const issue of issues) {
      console.warn(`[mdm] ${formatConfigIssue(issue)}`)
    }
  }

  return coerceConfig(config, issues)
}

// ============================================================================
// Global Sources
// ============================================================================

export interface GlobalSource {
  readonly path: string
  readonly name?: string | undefined
}

/**
 * Read registered sources from the global config file (~/.mdm/.mdm.toml).
 * Returns an empty array if the file does not exist or has no [[sources]].
 * Throws on malformed TOML so callers can distinguish "no config" from "broken config".
 */
export const readGlobalSources = (): GlobalSource[] => {
  const globalPath = path.join(os.homedir(), '.mdm', '.mdm.toml')
  if (!fs.existsSync(globalPath)) return []
  const content = fs.readFileSync(globalPath, 'utf-8')
  const parsed = parseToml(content) as Record<string, unknown>
  const sources = parsed.sources
  if (!Array.isArray(sources)) return []
  return sources
    .filter(
      (s): s is { path: string; name?: string } =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as Record<string, unknown>).path === 'string',
    )
    .map((s) => ({ path: s.path, name: s.name }))
}
