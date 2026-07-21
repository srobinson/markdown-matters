import * as path from 'node:path'
import { dbIndexDir } from '../home.js'

const EMBEDDINGS_DIR = 'embeddings'
const ACTIVE_PROVIDER_FILE = 'active-provider.json'
const VECTOR_INDEX_FILE = 'vectors.bin'
const VECTOR_META_FILE = 'vectors.meta.bin'

/**
 * Generate the filesystem safe namespace for a provider and model.
 */
export const generateNamespace = (
  provider: string,
  model: string,
  dimensions: number,
): string => {
  const sanitize = (value: string): string =>
    value.replace(/[^a-zA-Z0-9-]/g, '_').toLowerCase()

  const sanitizedProvider = sanitize(provider)
  const sanitizedModel = sanitize(model)
  if (!sanitizedProvider) throw new Error('Provider name cannot be empty')
  if (!sanitizedModel) throw new Error('Model name cannot be empty')
  if (dimensions <= 0 || !Number.isFinite(dimensions)) {
    throw new Error('Dimensions must be a positive number')
  }

  return `${sanitizedProvider}_${sanitizedModel}_${dimensions}`
}

export const parseNamespace = (
  namespace: string,
): { provider: string; model: string; dimensions: number } | null => {
  if (!namespace) return null

  const lastUnderscoreIdx = namespace.lastIndexOf('_')
  if (lastUnderscoreIdx === -1) return null

  const dimensionsStr = namespace.slice(lastUnderscoreIdx + 1)
  if (!/^\d+$/.test(dimensionsStr)) return null

  const dimensions = parseInt(dimensionsStr, 10)
  if (Number.isNaN(dimensions) || dimensions <= 0) return null

  const providerModel = namespace.slice(0, lastUnderscoreIdx)
  const firstUnderscoreIdx = providerModel.indexOf('_')
  if (firstUnderscoreIdx === -1) return null

  const provider = providerModel.slice(0, firstUnderscoreIdx)
  const model = providerModel.slice(firstUnderscoreIdx + 1)
  if (!provider || !model) return null

  return { provider, model, dimensions }
}

export const getEmbeddingsDir = (indexRoot: string): string =>
  path.join(dbIndexDir(indexRoot), EMBEDDINGS_DIR)

const validateNamespace = (namespace: string): void => {
  if (
    namespace.includes('/') ||
    namespace.includes('\\') ||
    namespace.includes('..') ||
    namespace.includes('\0')
  ) {
    throw new Error(
      'Invalid namespace: contains path separators or traversal sequences',
    )
  }
}

export const getNamespaceDir = (
  indexRoot: string,
  namespace: string,
): string => {
  validateNamespace(namespace)
  const embeddingsDir = getEmbeddingsDir(indexRoot)
  const resolved = path.join(embeddingsDir, namespace)
  const normalizedEmbeddings = path.resolve(embeddingsDir)
  const normalizedResolved = path.resolve(resolved)
  if (!normalizedResolved.startsWith(normalizedEmbeddings + path.sep)) {
    throw new Error('Invalid namespace: resolves outside embeddings directory')
  }
  return resolved
}

export const getVectorPath = (indexRoot: string, namespace: string): string =>
  path.join(getNamespaceDir(indexRoot, namespace), VECTOR_INDEX_FILE)

export const getMetaPath = (indexRoot: string, namespace: string): string =>
  path.join(getNamespaceDir(indexRoot, namespace), VECTOR_META_FILE)

export const getActiveProviderPath = (indexRoot: string): string =>
  path.join(dbIndexDir(indexRoot), ACTIVE_PROVIDER_FILE)
