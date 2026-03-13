/**
 * Embedding Namespace Management
 *
 * Provides namespaced storage for multiple embedding providers/models.
 * Each provider/model combination gets its own directory with isolated
 * vector index and metadata.
 *
 * Directory structure:
 * .mdm/
 *   embeddings/
 *     openai_text-embedding-3-small_512/
 *       vectors.bin
 *       vectors.meta.bin
 *     voyage_voyage-3.5-lite_1024/
 *       vectors.bin
 *       vectors.meta.bin
 *   active-provider.json  (points to current active namespace)
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as msgpack from '@msgpack/msgpack'
import { Effect } from 'effect'
import { INDEX_DIR } from '../index/types.js'
import type { VectorIndex } from './types.js'

// ============================================================================
// Constants
// ============================================================================

const EMBEDDINGS_DIR = 'embeddings'
const ACTIVE_PROVIDER_FILE = 'active-provider.json'
const VECTOR_INDEX_FILE = 'vectors.bin'
const VECTOR_META_FILE = 'vectors.meta.bin'
const LEGACY_VECTOR_INDEX_FILE = 'vectors.bin'
const LEGACY_VECTOR_META_FILE = 'vectors.meta.bin'
const LEGACY_VECTOR_META_JSON = 'vectors.meta.json'

// ============================================================================
// Types
// ============================================================================

/**
 * Active provider configuration stored in active-provider.json
 */
export interface ActiveProvider {
  /** Namespace directory name (e.g., "openai_text-embedding-3-small_512") */
  readonly namespace: string
  /** Provider name (e.g., "openai", "voyage") */
  readonly provider: string
  /** Model name (e.g., "text-embedding-3-small") */
  readonly model: string
  /** Embedding dimensions */
  readonly dimensions: number
  /** When this was set as active */
  readonly activatedAt: string
}

/**
 * Information about an available embedding namespace
 */
export interface EmbeddingNamespace {
  /** Namespace directory name */
  readonly namespace: string
  /** Provider name */
  readonly provider: string
  /** Model name */
  readonly model: string
  /** Embedding dimensions */
  readonly dimensions: number
  /** Number of vectors stored */
  readonly vectorCount: number
  /** Total cost accumulated */
  readonly totalCost: number
  /** Total tokens used */
  readonly totalTokens: number
  /** When this index was created */
  readonly createdAt: string
  /** When this index was last updated */
  readonly updatedAt: string
  /** Whether this is the currently active namespace */
  readonly isActive: boolean
  /** Size in bytes of the index files */
  readonly sizeBytes: number
}

export class EmbeddingNamespaceError extends Error {
  readonly _tag = 'EmbeddingNamespaceError'
  readonly operation: string
  readonly cause?: unknown

  constructor(params: { operation: string; message: string; cause?: unknown }) {
    super(params.message)
    this.name = 'EmbeddingNamespaceError'
    this.operation = params.operation
    this.cause = params.cause
  }
}

// ============================================================================
// Namespace Path Utilities
// ============================================================================

/**
 * Generate a namespace directory name from provider info.
 * Format: provider_model_dimensions
 * Characters are sanitized for filesystem compatibility.
 *
 * @example
 * generateNamespace("openai", "text-embedding-3-small", 512)
 * // Returns: "openai_text-embedding-3-small_512"
 *
 * @throws Error if provider or model is empty after sanitization
 */
export const generateNamespace = (
  provider: string,
  model: string,
  dimensions: number,
): string => {
  // Sanitize for filesystem: replace non-alphanumeric (except -) with _
  const sanitize = (s: string): string =>
    s.replace(/[^a-zA-Z0-9-]/g, '_').toLowerCase()

  const sanitizedProvider = sanitize(provider)
  const sanitizedModel = sanitize(model)

  // Validate non-empty after sanitization
  if (!sanitizedProvider || sanitizedProvider.length === 0) {
    throw new Error('Provider name cannot be empty')
  }
  if (!sanitizedModel || sanitizedModel.length === 0) {
    throw new Error('Model name cannot be empty')
  }
  if (dimensions <= 0 || !Number.isFinite(dimensions)) {
    throw new Error('Dimensions must be a positive number')
  }

  return `${sanitizedProvider}_${sanitizedModel}_${dimensions}`
}

/**
 * Parse a namespace directory name back into its components.
 *
 * @returns Parsed components or null if invalid format
 */
export const parseNamespace = (
  namespace: string,
): { provider: string; model: string; dimensions: number } | null => {
  // Format: provider_model_dimensions
  // The model can contain underscores, so we need to be careful
  if (!namespace || namespace.length === 0) return null

  const lastUnderscoreIdx = namespace.lastIndexOf('_')
  if (lastUnderscoreIdx === -1) return null

  const dimensionsStr = namespace.slice(lastUnderscoreIdx + 1)
  // Strict validation: dimensions must be digits only
  if (!/^\d+$/.test(dimensionsStr)) return null

  const dimensions = parseInt(dimensionsStr, 10)
  if (Number.isNaN(dimensions) || dimensions <= 0) return null

  const providerModel = namespace.slice(0, lastUnderscoreIdx)
  const firstUnderscoreIdx = providerModel.indexOf('_')
  if (firstUnderscoreIdx === -1) return null

  const provider = providerModel.slice(0, firstUnderscoreIdx)
  const model = providerModel.slice(firstUnderscoreIdx + 1)

  // Reject empty provider or model
  if (!provider || provider.length === 0) return null
  if (!model || model.length === 0) return null

  return { provider, model, dimensions }
}

/**
 * Get the embeddings directory path for a root path.
 */
export const getEmbeddingsDir = (rootPath: string): string =>
  path.join(rootPath, INDEX_DIR, EMBEDDINGS_DIR)

/**
 * Validate that a namespace doesn't contain path traversal sequences.
 * @throws Error if namespace contains unsafe characters
 */
const validateNamespace = (namespace: string): void => {
  // Reject path separators and traversal patterns
  if (
    namespace.includes('/') ||
    namespace.includes('\\') ||
    namespace.includes('..') ||
    namespace.includes('\0')
  ) {
    throw new Error(
      `Invalid namespace: contains path separators or traversal sequences`,
    )
  }
}

/**
 * Get the namespace directory path.
 * @throws Error if namespace contains path traversal sequences
 */
export const getNamespaceDir = (
  rootPath: string,
  namespace: string,
): string => {
  validateNamespace(namespace)
  const embeddingsDir = getEmbeddingsDir(rootPath)
  const resolved = path.join(embeddingsDir, namespace)

  // Extra safety: ensure resolved path is within embeddings directory
  const normalizedEmbeddings = path.resolve(embeddingsDir)
  const normalizedResolved = path.resolve(resolved)
  if (!normalizedResolved.startsWith(normalizedEmbeddings + path.sep)) {
    throw new Error(`Invalid namespace: resolves outside embeddings directory`)
  }

  return resolved
}

/**
 * Get the vector index file path for a namespace.
 */
export const getVectorPath = (rootPath: string, namespace: string): string =>
  path.join(getNamespaceDir(rootPath, namespace), VECTOR_INDEX_FILE)

/**
 * Get the metadata file path for a namespace.
 */
export const getMetaPath = (rootPath: string, namespace: string): string =>
  path.join(getNamespaceDir(rootPath, namespace), VECTOR_META_FILE)

/**
 * Get the active provider file path.
 */
export const getActiveProviderPath = (rootPath: string): string =>
  path.join(rootPath, INDEX_DIR, ACTIVE_PROVIDER_FILE)

/**
 * Get legacy vector paths (for migration).
 */
export const getLegacyVectorPath = (rootPath: string): string =>
  path.join(rootPath, INDEX_DIR, LEGACY_VECTOR_INDEX_FILE)

export const getLegacyMetaPath = (rootPath: string): string =>
  path.join(rootPath, INDEX_DIR, LEGACY_VECTOR_META_FILE)

export const getLegacyMetaJsonPath = (rootPath: string): string =>
  path.join(rootPath, INDEX_DIR, LEGACY_VECTOR_META_JSON)

// ============================================================================
// Active Provider Management
// ============================================================================

/**
 * Read the currently active provider configuration.
 *
 * @returns Active provider info or null if not set
 */
export const readActiveProvider = (
  rootPath: string,
): Effect.Effect<ActiveProvider | null, EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    const filePath = getActiveProviderPath(rootPath)

    const exists = yield* Effect.tryPromise({
      try: async () => {
        await fs.access(filePath)
        return true
      },
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'readActiveProvider',
          message: 'File not found',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(false)))

    if (!exists) {
      return null
    }

    const content = yield* Effect.tryPromise({
      try: () => fs.readFile(filePath, 'utf-8'),
      catch: (e) =>
        new EmbeddingNamespaceError({
          operation: 'readActiveProvider',
          message: `Failed to read active provider: ${e}`,
          cause: e,
        }),
    })

    return yield* Effect.try({
      try: () => JSON.parse(content) as ActiveProvider,
      catch: (e) =>
        new EmbeddingNamespaceError({
          operation: 'readActiveProvider',
          message: `Failed to parse active provider: ${e}`,
          cause: e,
        }),
    })
  })

/**
 * Write the active provider configuration.
 */
export const writeActiveProvider = (
  rootPath: string,
  activeProvider: ActiveProvider,
): Effect.Effect<void, EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    const filePath = getActiveProviderPath(rootPath)
    const indexDir = path.dirname(filePath)

    yield* Effect.tryPromise({
      try: () => fs.mkdir(indexDir, { recursive: true }),
      catch: (e) =>
        new EmbeddingNamespaceError({
          operation: 'writeActiveProvider',
          message: `Failed to create directory: ${e}`,
          cause: e,
        }),
    })

    yield* Effect.tryPromise({
      try: () =>
        fs.writeFile(filePath, JSON.stringify(activeProvider, null, 2)),
      catch: (e) =>
        new EmbeddingNamespaceError({
          operation: 'writeActiveProvider',
          message: `Failed to write active provider: ${e}`,
          cause: e,
        }),
    })
  })

// ============================================================================
// Namespace Discovery
// ============================================================================

/**
 * List all available embedding namespaces.
 */
export const listNamespaces = (
  rootPath: string,
): Effect.Effect<EmbeddingNamespace[], EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    const embeddingsDir = getEmbeddingsDir(rootPath)

    // Check if embeddings directory exists
    const exists = yield* Effect.tryPromise({
      try: async () => {
        await fs.access(embeddingsDir)
        return true
      },
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'listNamespaces',
          message: 'Directory not found',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(false)))

    if (!exists) {
      return []
    }

    // Get active provider for comparison
    const activeProvider = yield* readActiveProvider(rootPath).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    )

    // Read directory entries
    const entries = yield* Effect.tryPromise({
      try: () => fs.readdir(embeddingsDir, { withFileTypes: true }),
      catch: (e) =>
        new EmbeddingNamespaceError({
          operation: 'listNamespaces',
          message: `Failed to read embeddings directory: ${e}`,
          cause: e,
        }),
    })

    const namespaces: EmbeddingNamespace[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const namespace = entry.name
      // Use parseNamespace just for initial validation that this looks like a valid namespace directory
      const parsed = parseNamespace(namespace)
      if (!parsed) continue

      // Try to read metadata
      const metaPath = getMetaPath(rootPath, namespace)
      const vectorPath = getVectorPath(rootPath, namespace)

      const metaExists = yield* Effect.tryPromise({
        try: async () => {
          await fs.access(metaPath)
          return true
        },
        catch: () =>
          new EmbeddingNamespaceError({
            operation: 'listNamespaces',
            message: 'Meta not found',
          }),
      }).pipe(Effect.catchAll(() => Effect.succeed(false)))

      if (!metaExists) continue

      // Read metadata
      const meta = yield* Effect.tryPromise({
        try: async () => {
          const buffer = await fs.readFile(metaPath)
          return msgpack.decode(buffer) as VectorIndex
        },
        catch: (e) =>
          new EmbeddingNamespaceError({
            operation: 'listNamespaces',
            message: `Failed to read metadata: ${e}`,
            cause: e,
          }),
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))

      if (!meta) continue

      // Get file sizes
      const [metaStats, vectorStats] = yield* Effect.all([
        Effect.tryPromise({
          try: () => fs.stat(metaPath),
          catch: () =>
            new EmbeddingNamespaceError({
              operation: 'listNamespaces',
              message: 'Failed to stat meta',
            }),
        }).pipe(Effect.catchAll(() => Effect.succeed(null))),
        Effect.tryPromise({
          try: () => fs.stat(vectorPath),
          catch: () =>
            new EmbeddingNamespaceError({
              operation: 'listNamespaces',
              message: 'Failed to stat vector',
            }),
        }).pipe(Effect.catchAll(() => Effect.succeed(null))),
      ])

      const sizeBytes = (metaStats?.size ?? 0) + (vectorStats?.size ?? 0)

      // Use VectorIndex metadata as the source of truth for provider/model/dimensions
      // Fall back to parseNamespace only if metadata fields are missing (legacy indexes)
      const provider = meta.provider || parsed.provider
      const model = meta.providerModel || parsed.model
      const dimensions = meta.dimensions || parsed.dimensions

      namespaces.push({
        namespace,
        provider,
        model,
        dimensions,
        vectorCount: Object.keys(meta.entries).length,
        totalCost: meta.totalCost ?? 0,
        totalTokens: meta.totalTokens ?? 0,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        isActive: activeProvider?.namespace === namespace,
        sizeBytes,
      })
    }

    // Sort by most recently updated
    namespaces.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )

    return namespaces
  })

// ============================================================================
// Namespace Operations
// ============================================================================

/**
 * Switch to a different embedding namespace.
 * Updates the active-provider.json to point to the new namespace.
 *
 * @param rootPath - Root directory
 * @param namespace - Full namespace name or partial match
 * @returns The activated namespace info
 */
export const switchNamespace = (
  rootPath: string,
  namespaceQuery: string,
): Effect.Effect<EmbeddingNamespace, EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    const namespaces = yield* listNamespaces(rootPath)

    if (namespaces.length === 0) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'switchNamespace',
          message:
            'No embedding namespaces found. Run "mdcontext index --embed" first.',
        }),
      )
    }

    // Find matching namespace (exact or fuzzy)
    const queryLower = namespaceQuery.toLowerCase()
    let matches = namespaces.filter(
      (ns) =>
        ns.namespace.toLowerCase() === queryLower ||
        ns.provider.toLowerCase() === queryLower ||
        ns.model.toLowerCase().includes(queryLower) ||
        ns.namespace.toLowerCase().includes(queryLower),
    )

    if (matches.length === 0) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'switchNamespace',
          message: `No namespace matching "${namespaceQuery}". Available: ${namespaces.map((n) => n.namespace).join(', ')}`,
        }),
      )
    }

    if (matches.length > 1) {
      // Try exact match first
      const exact = matches.find(
        (ns) =>
          ns.namespace.toLowerCase() === queryLower ||
          ns.provider.toLowerCase() === queryLower,
      )
      if (exact) {
        matches = [exact]
      } else {
        return yield* Effect.fail(
          new EmbeddingNamespaceError({
            operation: 'switchNamespace',
            message: `Multiple namespaces match "${namespaceQuery}": ${matches.map((n) => n.namespace).join(', ')}. Be more specific.`,
          }),
        )
      }
    }

    const target = matches[0]!

    // Update active provider
    yield* writeActiveProvider(rootPath, {
      namespace: target.namespace,
      provider: target.provider,
      model: target.model,
      dimensions: target.dimensions,
      activatedAt: new Date().toISOString(),
    })

    return { ...target, isActive: true }
  })

/**
 * Remove an embedding namespace.
 *
 * @param rootPath - Root directory
 * @param namespaceQuery - Full namespace name or partial match
 * @param force - Skip confirmation for active namespace
 */
export const removeNamespace = (
  rootPath: string,
  namespaceQuery: string,
  options: { force?: boolean } = {},
): Effect.Effect<
  { removed: string; wasActive: boolean },
  EmbeddingNamespaceError
> =>
  Effect.gen(function* () {
    const namespaces = yield* listNamespaces(rootPath)

    if (namespaces.length === 0) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'removeNamespace',
          message: 'No embedding namespaces found.',
        }),
      )
    }

    // Find matching namespace
    const queryLower = namespaceQuery.toLowerCase()
    let matches = namespaces.filter(
      (ns) =>
        ns.namespace.toLowerCase() === queryLower ||
        ns.namespace.toLowerCase().includes(queryLower),
    )

    if (matches.length === 0) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'removeNamespace',
          message: `No namespace matching "${namespaceQuery}". Available: ${namespaces.map((n) => n.namespace).join(', ')}`,
        }),
      )
    }

    if (matches.length > 1) {
      const exact = matches.find(
        (ns) => ns.namespace.toLowerCase() === queryLower,
      )
      if (exact) {
        matches = [exact]
      } else {
        return yield* Effect.fail(
          new EmbeddingNamespaceError({
            operation: 'removeNamespace',
            message: `Multiple namespaces match "${namespaceQuery}": ${matches.map((n) => n.namespace).join(', ')}. Be more specific.`,
          }),
        )
      }
    }

    const target = matches[0]!

    // Check if this is the active namespace
    if (target.isActive && !options.force) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'removeNamespace',
          message: `Cannot remove active namespace "${target.namespace}". Use --force to override or switch to another namespace first.`,
        }),
      )
    }

    // Remove the namespace directory
    const namespaceDir = getNamespaceDir(rootPath, target.namespace)
    yield* Effect.tryPromise({
      try: () => fs.rm(namespaceDir, { recursive: true, force: true }),
      catch: (e) =>
        new EmbeddingNamespaceError({
          operation: 'removeNamespace',
          message: `Failed to remove namespace directory: ${e}`,
          cause: e,
        }),
    })

    // If this was the active namespace, clear the active provider
    if (target.isActive) {
      const activeProviderPath = getActiveProviderPath(rootPath)
      yield* Effect.tryPromise({
        try: () => fs.unlink(activeProviderPath),
        catch: (e) =>
          new EmbeddingNamespaceError({
            operation: 'removeNamespace',
            message: `Failed to clear active provider: ${e}`,
            cause: e,
          }),
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    }

    return { removed: target.namespace, wasActive: target.isActive }
  })

// ============================================================================
// Migration
// ============================================================================

/**
 * Check if legacy (non-namespaced) embeddings exist.
 */
export const hasLegacyEmbeddings = (
  rootPath: string,
): Effect.Effect<boolean, EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    const legacyBinPath = getLegacyVectorPath(rootPath)
    const legacyMetaBinPath = getLegacyMetaPath(rootPath)
    const legacyMetaJsonPath = getLegacyMetaJsonPath(rootPath)
    const embeddingsDir = getEmbeddingsDir(rootPath)

    // Check if new embeddings dir exists (migration already done)
    const newExists = yield* Effect.tryPromise({
      try: async () => {
        await fs.access(embeddingsDir)
        return true
      },
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'hasLegacyEmbeddings',
          message: 'Directory check failed',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(false)))

    if (newExists) {
      return false
    }

    // Check if legacy files exist
    const legacyBinExists = yield* Effect.tryPromise({
      try: async () => {
        await fs.access(legacyBinPath)
        return true
      },
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'hasLegacyEmbeddings',
          message: 'File check failed',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(false)))

    if (!legacyBinExists) {
      return false
    }

    // Check for either binary or JSON metadata
    const legacyMetaExists = yield* Effect.tryPromise({
      try: async () => {
        try {
          await fs.access(legacyMetaBinPath)
          return true
        } catch {
          await fs.access(legacyMetaJsonPath)
          return true
        }
      },
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'hasLegacyEmbeddings',
          message: 'Meta check failed',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(false)))

    return legacyMetaExists
  })

/**
 * Migrate legacy embeddings to the new namespaced format.
 * This is non-destructive - legacy files are moved, not deleted.
 */
export const migrateLegacyEmbeddings = (
  rootPath: string,
): Effect.Effect<
  { namespace: string; vectorCount: number } | null,
  EmbeddingNamespaceError
> =>
  Effect.gen(function* () {
    const hasLegacy = yield* hasLegacyEmbeddings(rootPath)
    if (!hasLegacy) {
      return null
    }

    // Read legacy metadata to determine provider/model/dimensions
    const legacyMetaBinPath = getLegacyMetaPath(rootPath)
    const legacyMetaJsonPath = getLegacyMetaJsonPath(rootPath)

    let meta: VectorIndex | null = null

    // Try binary format first
    meta = yield* Effect.tryPromise({
      try: async () => {
        const buffer = await fs.readFile(legacyMetaBinPath)
        return msgpack.decode(buffer) as VectorIndex
      },
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: 'Failed to read binary meta',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(null)))

    // Fall back to JSON
    if (!meta) {
      meta = yield* Effect.tryPromise({
        try: async () => {
          const content = await fs.readFile(legacyMetaJsonPath, 'utf-8')
          return JSON.parse(content) as VectorIndex
        },
        catch: () =>
          new EmbeddingNamespaceError({
            operation: 'migrateLegacyEmbeddings',
            message: 'Failed to read JSON meta',
          }),
      }).pipe(Effect.catchAll(() => Effect.succeed(null)))
    }

    if (!meta) {
      return yield* Effect.fail(
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message:
            'Could not read legacy metadata. Embeddings may be corrupted.',
        }),
      )
    }

    // Determine provider info from metadata
    // Legacy format may have provider as "openai:text-embedding-3-small" or just "openai"
    let provider = meta.provider || 'openai'
    let model = meta.providerModel || 'text-embedding-3-small'

    // Handle legacy "provider:model" format
    if (provider.includes(':') && !meta.providerModel) {
      const parts = provider.split(':')
      provider = parts[0]!
      model = parts[1] || model
    }

    const dimensions = meta.dimensions

    // Generate namespace
    const namespace = generateNamespace(provider, model, dimensions)
    const namespaceDir = getNamespaceDir(rootPath, namespace)

    // Create namespace directory
    yield* Effect.tryPromise({
      try: () => fs.mkdir(namespaceDir, { recursive: true }),
      catch: (e) =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: `Failed to create namespace directory: ${e}`,
          cause: e,
        }),
    })

    // Move vector file
    const legacyBinPath = getLegacyVectorPath(rootPath)
    const newVectorPath = getVectorPath(rootPath, namespace)
    yield* Effect.tryPromise({
      try: () => fs.rename(legacyBinPath, newVectorPath),
      catch: (e) =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: `Failed to move vector file: ${e}`,
          cause: e,
        }),
    })

    // Move/create metadata file (always use binary in new location)
    const newMetaPath = getMetaPath(rootPath, namespace)

    // Update provider info in metadata
    const updatedMeta: VectorIndex = {
      ...meta,
      provider,
      providerModel: model,
    }

    yield* Effect.tryPromise({
      try: async () => {
        const encoded = msgpack.encode(updatedMeta)
        await fs.writeFile(newMetaPath, encoded)
      },
      catch: (e) =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: `Failed to write metadata: ${e}`,
          cause: e,
        }),
    })

    // Remove old metadata files
    yield* Effect.tryPromise({
      try: () => fs.unlink(legacyMetaBinPath).catch(() => {}),
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: 'Failed to remove legacy bin meta',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))

    yield* Effect.tryPromise({
      try: () => fs.unlink(legacyMetaJsonPath).catch(() => {}),
      catch: () =>
        new EmbeddingNamespaceError({
          operation: 'migrateLegacyEmbeddings',
          message: 'Failed to remove legacy json meta',
        }),
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))

    // Set as active provider
    yield* writeActiveProvider(rootPath, {
      namespace,
      provider,
      model,
      dimensions,
      activatedAt: new Date().toISOString(),
    })

    return {
      namespace,
      vectorCount: Object.keys(meta.entries).length,
    }
  })

/**
 * Get or determine the current active namespace.
 * If no active provider is set, tries to auto-detect from available namespaces.
 * Validates that the active namespace directory still exists.
 */
export const getActiveNamespace = (
  rootPath: string,
): Effect.Effect<ActiveProvider | null, EmbeddingNamespaceError> =>
  Effect.gen(function* () {
    // Try to read active provider
    const active = yield* readActiveProvider(rootPath)
    if (active) {
      // Validate that the namespace directory still exists
      const namespaceDir = getNamespaceDir(rootPath, active.namespace)
      const dirExists = yield* Effect.tryPromise({
        try: async () => {
          await fs.access(namespaceDir)
          return true
        },
        catch: () =>
          new EmbeddingNamespaceError({
            operation: 'getActiveNamespace',
            message: 'Directory check failed',
          }),
      }).pipe(Effect.catchAll(() => Effect.succeed(false)))

      if (dirExists) {
        return active
      }
      // Active namespace was deleted - fall through to auto-detect
    }

    // No active provider set or it was deleted - check available namespaces
    const namespaces = yield* listNamespaces(rootPath)
    if (namespaces.length === 0) {
      return null
    }

    // Auto-activate the most recently updated namespace
    const mostRecent = namespaces[0]!
    yield* writeActiveProvider(rootPath, {
      namespace: mostRecent.namespace,
      provider: mostRecent.provider,
      model: mostRecent.model,
      dimensions: mostRecent.dimensions,
      activatedAt: new Date().toISOString(),
    })

    return {
      namespace: mostRecent.namespace,
      provider: mostRecent.provider,
      model: mostRecent.model,
      dimensions: mostRecent.dimensions,
      activatedAt: new Date().toISOString(),
    }
  })
