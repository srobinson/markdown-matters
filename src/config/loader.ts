/**
 * Configuration Loader
 *
 * Mirrors the attention-matters config.rs pattern:
 *   1. Start with compiled defaults
 *   2. Merge home, project, and project-local TOML files
 *   3. Apply env vars (MDM_* prefix)
 *   4. Apply CLI overrides (passed as partial)
 *   5. Return concrete MdmConfig
 *
 * Invalid TOML is logged as a warning and skipped (falls through to defaults).
 * No string serialisation/deserialisation. No ConfigProvider intermediary.
 */

import { existsSync } from 'node:fs'
import * as path from 'node:path'
import { Option } from 'effect'
import { expandDeclaredPath } from '../db/canonical.js'
import { resolveMdmHome } from '../home.js'
import { loadTomlDocumentWithStatus, type TomlParseError } from '../toml.js'
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

export type ConfigParseError = TomlParseError

export type TomlFileLoadResult =
  | { status: 'missing'; path: string }
  | { status: 'loaded'; path: string; config: PartialMdmConfig }
  | { status: 'error'; error: ConfigParseError }

export type ConfigFileLoadResult =
  | { status: 'missing' }
  | {
      status: 'loaded'
      path: string
      sourceFiles: readonly string[]
      config: PartialMdmConfig
      parseErrors: ConfigParseError[]
    }
  | {
      status: 'error'
      error: ConfigParseError
      parseErrors: ConfigParseError[]
    }

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
  const result = loadTomlDocumentWithStatus(filePath)
  if (result.status === 'loaded') {
    return {
      status: 'loaded',
      path: filePath,
      config: result.value as unknown as PartialMdmConfig,
    }
  }
  return result
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
// Roots Resolution
// ============================================================================

const resolveRootEntries = (
  roots: unknown,
  baseDir: string,
): readonly string[] | unknown =>
  Array.isArray(roots) && roots.every((entry) => typeof entry === 'string')
    ? roots.map((entry: string) =>
        path.isAbsolute(entry) || entry.startsWith('~')
          ? expandDeclaredPath(entry)
          : expandDeclaredPath(path.resolve(baseDir, entry)),
      )
    : roots

/**
 * Resolve relative `roots` entries in a partial config against the directory
 * they were declared in, so downstream consumers only see absolute paths.
 * Invalid shapes pass through untouched for validation to report.
 */
export const resolvePartialRoots = (
  partial: PartialMdmConfig,
  baseDir: string,
): PartialMdmConfig => {
  let result = partial
  for (const section of ['index', 'search'] as const) {
    const values = result[section] as Record<string, unknown> | undefined
    if (values?.roots === undefined) continue
    result = {
      ...result,
      [section]: {
        ...values,
        roots: resolveRootEntries(values.roots, baseDir),
      },
    }
  }
  return result
}

// ============================================================================
// Config File Resolution
// ============================================================================

/**
 * Find the nearest ancestor of cwd (cwd included) that holds a project
 * config file. Returns null when no ancestor declares one.
 */
export const findProjectConfigDir = (cwd: string): string | null => {
  let current = path.resolve(cwd)
  while (true) {
    if (
      existsSync(path.join(current, '.mdm.toml')) ||
      existsSync(path.join(current, '.mdm.local.toml'))
    ) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * Load and merge every config file tier with explicit status.
 * Later files override earlier files by key.
 */
export const loadConfigFileWithStatus = (
  workingDir?: string,
): ConfigFileLoadResult => {
  const cwd = workingDir ?? process.cwd()
  const parseErrors: ConfigParseError[] = []
  const sourceFiles: string[] = []
  let config: PartialMdmConfig = {}
  const projectDir = findProjectConfigDir(cwd)
  const configPaths = [
    path.join(resolveMdmHome(), '.mdm.toml'),
    ...(projectDir === null
      ? []
      : [
          path.join(projectDir, '.mdm.toml'),
          path.join(projectDir, '.mdm.local.toml'),
        ]),
  ].filter((filePath, index, all) => all.indexOf(filePath) === index)

  for (const filePath of configPaths) {
    const result = loadTomlFileWithStatus(filePath)
    if (result.status === 'loaded') {
      config = mergePartials(
        config,
        resolvePartialRoots(result.config, path.dirname(filePath)),
      )
      sourceFiles.push(filePath)
    } else if (result.status === 'error') {
      parseErrors.push(result.error)
    }
  }

  if (sourceFiles.length > 0) {
    return {
      status: 'loaded',
      config,
      path: sourceFiles[sourceFiles.length - 1]!,
      sourceFiles,
      parseErrors,
    }
  }

  if (parseErrors.length > 0) {
    return {
      status: 'error',
      error: parseErrors[0]!,
      parseErrors,
    }
  }

  return { status: 'missing' }
}

/**
 * Load and merge the config file tiers, or return null if none are valid.
 */
export const loadConfigFile = (
  workingDir?: string,
): { config: PartialMdmConfig; path: string } | null => {
  const result = loadConfigFileWithStatus(workingDir)
  if (result.status === 'loaded') {
    for (const error of result.parseErrors) {
      warnConfigParseError(error)
    }
    return { config: result.config, path: result.path }
  }
  if (result.status === 'error') {
    for (const error of result.parseErrors) {
      warnConfigParseError(error)
    }
  }
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
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) return value
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
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
export const mergePartials = (
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
  sourceFiles: readonly string[]
  parseError?: ConfigParseError | undefined
  parseErrors: ConfigParseError[]
}

/**
 * Load configuration with full precedence chain.
 *
 * Resolution order (highest to lowest priority):
 *   1. CLI overrides
 *   2. Environment variables (MDM_*)
 *   3. Project local, project, and home config files
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
  let sourceFiles: readonly string[] = []
  let parseError: ConfigParseError | undefined
  let parseErrors: ConfigParseError[] = []

  // Layer 1: Config file (lowest priority source)
  // fileConfig always takes effect when provided (used for testing).
  // skipConfigFile only prevents reading from disk.
  const rootsBaseDir = workingDir ?? process.cwd()
  if (options.fileConfig) {
    fileConfig = resolvePartialRoots(options.fileConfig, rootsBaseDir)
    merged = fileConfig
  } else if (!skipConfigFile) {
    const result = loadConfigFileWithStatus(workingDir)
    if (result.status === 'loaded') {
      sourceFile = result.path
      sourceFiles = result.sourceFiles
      fileConfig = result.config
      merged = result.config
      parseErrors = result.parseErrors
      parseError = parseErrors[0]
      if (!suppressWarnings) {
        for (const error of parseErrors) {
          warnConfigParseError(error)
        }
      }
    } else if (result.status === 'error') {
      parseError = result.error
      parseErrors = result.parseErrors
      if (!suppressWarnings) {
        for (const error of parseErrors) {
          warnConfigParseError(error)
        }
      }
    }
  }

  // Layer 2: Environment variables
  if (!skipEnv) {
    envConfig = resolvePartialRoots(readEnvVars(envPrefix), rootsBaseDir)
    merged = mergePartials(merged, envConfig)
  }

  // Layer 3: CLI overrides (highest priority)
  if (cliOverrides) {
    merged = mergePartials(
      merged,
      resolvePartialRoots(cliOverrides, rootsBaseDir),
    )
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
    sourceFiles,
    parseError,
    parseErrors,
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
