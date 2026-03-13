/**
 * Configuration Module
 *
 * Exports all configuration-related types, schemas, and utilities.
 */

export {
  type GlobalSource,
  type LoadOptions,
  // Loader
  load,
  loadConfigFile,
  loadTomlFile,
  mergeWithDefaults,
  type PartialMdmConfig,
  readEnvVars,
  readEnvVarsMap,
  readGlobalSources,
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
