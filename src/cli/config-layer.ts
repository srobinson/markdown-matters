/**
 * CLI Configuration Layer
 *
 * Creates a configuration layer for use in CLI commands.
 * Loads config with precedence: CLI flags > Environment > Config file > Defaults
 */

import { Layer } from 'effect'
import type { PartialMdmConfig } from '../config/loader.js'
import { load } from '../config/loader.js'
import type { MdmConfig } from '../config/schema.js'
import { ConfigService } from '../config/service.js'

/**
 * Create a ConfigService layer from CLI options.
 *
 * This loads configuration with the standard precedence chain:
 * 1. CLI flags (highest priority)
 * 2. Environment variables (MDM_*)
 * 3. Config file (.mdm.toml)
 * 4. Defaults
 */
export const makeCliConfigLayer = (options?: {
  cliOverrides?: PartialMdmConfig
  workingDir?: string
}): Layer.Layer<ConfigService> =>
  Layer.sync(ConfigService, () =>
    load({
      cliOverrides: options?.cliOverrides,
      workingDir: options?.workingDir,
    }),
  )

/**
 * Default CLI configuration layer.
 * Loads from env vars, config file, and defaults. No CLI flags.
 */
export const defaultCliConfigLayer: Layer.Layer<ConfigService> =
  makeCliConfigLayer({ workingDir: process.cwd() })

/**
 * Get config value with CLI flag override.
 */
export const withCliOverride = <T>(
  cliValue: T | undefined,
  configValue: T,
): T => {
  return cliValue !== undefined ? cliValue : configValue
}

/**
 * Extract relevant config sections for a command.
 */
export type SearchConfigValues = {
  defaultLimit: number
  maxLimit: number
  minSimilarity: number
  includeSnippets: boolean
  snippetLength: number
}

export type IndexConfigValues = {
  maxDepth: number
  excludePatterns: readonly string[]
  fileExtensions: readonly string[]
  followSymlinks: boolean
}

export type OutputConfigValues = {
  format: 'text' | 'json'
  color: boolean
  prettyJson: boolean
  verbose: boolean
  debug: boolean
}

export const getSearchConfig = (config: MdmConfig): SearchConfigValues => ({
  defaultLimit: config.search.defaultLimit,
  maxLimit: config.search.maxLimit,
  minSimilarity: config.search.minSimilarity,
  includeSnippets: config.search.includeSnippets,
  snippetLength: config.search.snippetLength,
})

export const getIndexConfig = (config: MdmConfig): IndexConfigValues => ({
  maxDepth: config.index.maxDepth,
  excludePatterns: config.index.excludePatterns,
  fileExtensions: config.index.fileExtensions,
  followSymlinks: config.index.followSymlinks,
})

export const getOutputConfig = (config: MdmConfig): OutputConfigValues => ({
  format: config.output.format,
  color: config.output.color,
  prettyJson: config.output.prettyJson,
  verbose: config.output.verbose,
  debug: config.output.debug,
})
