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
  readGlobalSources,
  type TomlFileLoadResult,
  validateConfig,
} from './loader.js'
export {
  AI_SUMMARIZATION_MODES,
  // Schema types
  type AISummarizationConfig,
  type AISummarizationMode,
  API_PROVIDER_NAMES,
  type APIProviderName,
  CLI_PROVIDER_NAMES,
  type CLIProviderName,
  // Default values
  defaultConfig,
  EMBEDDING_PROVIDER_NAMES,
  type EmbeddingProviderName,
  type EmbeddingsConfig,
  type IndexConfig,
  type MdmConfig,
  type OpenAIEmbeddingModel,
  OUTPUT_FORMATS,
  type OutputConfig,
  type OutputFormat,
  type PathsConfig,
  type SearchConfig,
  SUMMARIZATION_PROVIDER_NAMES,
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
  CONFIG_VALIDATION_PATHS,
  type ConfigIssue,
  coerceConfig,
  collectConfigIssues,
  formatConfigIssue,
} from './validation.js'
