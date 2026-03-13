/**
 * Configuration Module
 *
 * Exports all configuration-related types, schemas, and utilities.
 */

export {
  // File detection
  CONFIG_FILE_NAMES,
  type ConfigFileFormat,
  type ConfigFileName,
  // Provider creation
  createFileConfigProvider,
  findConfigFile,
  type LoadConfigResult,
  // File loading
  loadConfigFile,
  loadConfigFromPath,
  loadFileConfigProvider,
  loadFileConfigProviderFromPath,
} from './file-provider.js'
export {
  // Precedence chain
  type ConfigProviderOptions,
  createCliConfigProvider,
  createConfigProvider,
  createConfigProviderSync,
  createEnvConfigProvider,
  createTestConfigProvider,
  // Utilities
  flattenConfig,
  readEnvConfig,
} from './precedence.js'
export {
  // Default values
  defaultConfig,
  // Types
  type EmbeddingProviderName,
  EmbeddingsConfig,
  // Config schemas
  IndexConfig,
  MdmConfig,
  type OpenAIEmbeddingModel,
  OutputConfig,
  type OutputFormat,
  PathsConfig,
  SearchConfig,
  SummarizationConfig,
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
  makeConfigLayerPartial,
  // Merge utilities
  mergeWithDefaults,
  type PartialMdmConfig,
} from './service.js'
export {
  // Testing utilities
  runWithConfig,
  runWithConfigSync,
  TestConfigLayer,
  withTestConfig,
} from './testing.js'
