/**
 * Configuration Module
 *
 * Exports all configuration-related types, schemas, and utilities.
 */

export {
  type ConfigFileLoadResult,
  type ConfigParseError,
  type GlobalSource,
  type LoadOptions,
  type LoadResult,
  // Loader
  load,
  loadConfigFile,
  loadConfigFileWithStatus,
  loadDetailed,
  loadTomlFile,
  loadTomlFileWithStatus,
  mergeWithDefaults,
  type PartialMdmConfig,
  readEnvVars,
  readEnvVarsMap,
  readGlobalSources,
  type TomlFileLoadResult,
  validateConfig,
} from './loader.js'
export {
  // Schema types
  type AISummarizationConfig,
  type AISummarizationMode,
  type APIProviderName,
  type CLIProviderName,
  // Default values
  defaultConfig,
  type EmbeddingProviderName,
  type EmbeddingsConfig,
  type IndexConfig,
  type MdmConfig,
  type OpenAIEmbeddingModel,
  type OutputConfig,
  type OutputFormat,
  type PathsConfig,
  type SearchConfig,
  type SummarizationConfig,
  type SummarizationProviderName,
} from './schema.js'
export {
  // Service
  ConfigService,
  ConfigServiceDefault,
  ConfigServiceLive,
  // Helper functions
  getConfig,
  getConfigSection,
  getConfigValue,
  // Layer utilities
  makeConfigLayer,
  makeConfigLayerFromOptions,
  makeConfigLayerPartial,
} from './service.js'
export {
  // Testing utilities
  runWithConfig,
  runWithConfigSync,
  TestConfigLayer,
  withTestConfig,
} from './testing.js'
export {
  CONFIG_ENUM_VALUES,
  type ConfigIssue,
  coerceConfig,
  collectConfigIssues,
  formatConfigIssue,
} from './validation.js'
