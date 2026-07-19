/**
 * Stable facade for embedding namespace management.
 */

export {
  getActiveNamespace,
  listNamespaces,
  readActiveProvider,
  removeNamespace,
  switchNamespace,
  writeActiveProvider,
} from './embedding-namespace-catalog.js'
export {
  hasLegacyEmbeddings,
  migrateLegacyEmbeddings,
} from './embedding-namespace-migration.js'
export {
  generateNamespace,
  getActiveProviderPath,
  getEmbeddingsDir,
  getLegacyMetaJsonPath,
  getLegacyMetaPath,
  getLegacyVectorPath,
  getMetaPath,
  getNamespaceDir,
  getVectorPath,
  parseNamespace,
} from './embedding-namespace-paths.js'
export { EmbeddingNamespaceError } from './embedding-namespace-types.js'
export type {
  ActiveProvider,
  EmbeddingNamespace,
} from './embedding-namespace-types.js'
