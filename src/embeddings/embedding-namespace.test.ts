/**
 * Embedding Namespace Unit Tests
 *
 * Tests for the embedding namespace management module ensuring correct
 * namespace generation, parsing, and path handling.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { DocumentKey } from '../db/canonical.js'
import {
  generateNamespace,
  getActiveNamespace,
  getActiveProviderPath,
  getEmbeddingsDir,
  getMetaPath,
  getNamespaceDir,
  getVectorPath,
  parseNamespace,
  readActiveProvider,
} from './embedding-namespace.js'
import { createNamespacedVectorStore } from './vector-store.js'

const seedNamespace = async (root: string): Promise<void> => {
  const store = createNamespacedVectorStore(root, 'test', 'model', 2)
  await Effect.runPromise(
    store.add([
      {
        id: 'section-1',
        sectionId: 'section-1',
        documentPath: path.join(root, 'doc.md') as DocumentKey,
        documentHash: 'hash-1',
        heading: 'Document',
        embedding: [1, 0],
      },
    ]),
  )
  await Effect.runPromise(store.save())
}

describe('generateNamespace', () => {
  it('should generate namespace from provider, model, and dimensions', () => {
    const result = generateNamespace('openai', 'text-embedding-3-small', 512)
    expect(result).toBe('openai_text-embedding-3-small_512')
  })

  it('should lowercase provider and model', () => {
    const result = generateNamespace('OpenAI', 'Text-Embedding-3-Small', 512)
    expect(result).toBe('openai_text-embedding-3-small_512')
  })

  it('should sanitize special characters to underscores', () => {
    const result = generateNamespace('my provider', 'my.model/v1', 1024)
    expect(result).toBe('my_provider_my_model_v1_1024')
  })

  it('should preserve hyphens', () => {
    const result = generateNamespace('openai', 'text-embedding-3-small', 512)
    expect(result).toContain('text-embedding-3-small')
  })

  it('should throw for empty provider', () => {
    expect(() => generateNamespace('', 'model', 512)).toThrow(
      'Provider name cannot be empty',
    )
  })

  it('should throw for empty model', () => {
    expect(() => generateNamespace('openai', '', 512)).toThrow(
      'Model name cannot be empty',
    )
  })

  it('should throw for zero dimensions', () => {
    expect(() => generateNamespace('openai', 'model', 0)).toThrow(
      'Dimensions must be a positive number',
    )
  })

  it('should throw for negative dimensions', () => {
    expect(() => generateNamespace('openai', 'model', -1)).toThrow(
      'Dimensions must be a positive number',
    )
  })

  it('should throw for non-finite dimensions', () => {
    expect(() => generateNamespace('openai', 'model', Infinity)).toThrow(
      'Dimensions must be a positive number',
    )
    expect(() => generateNamespace('openai', 'model', NaN)).toThrow(
      'Dimensions must be a positive number',
    )
  })

  it('should handle provider with only spaces (sanitized to underscores)', () => {
    // Spaces get replaced with underscores, resulting in valid (if ugly) namespace
    // Format: provider_model_dimensions, so 3 spaces become '___' + '_' separator + 'model' + '_' + '512'
    const result = generateNamespace('   ', 'model', 512)
    expect(result).toBe('____model_512')
  })
})

describe('parseNamespace', () => {
  it('should parse valid namespace', () => {
    const result = parseNamespace('openai_text-embedding-3-small_512')
    expect(result).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 512,
    })
  })

  it('should handle model with underscores', () => {
    const result = parseNamespace('voyage_voyage_3_5_lite_1024')
    expect(result).toEqual({
      provider: 'voyage',
      model: 'voyage_3_5_lite',
      dimensions: 1024,
    })
  })

  it('should return null for empty string', () => {
    expect(parseNamespace('')).toBeNull()
  })

  it('should return null for string without underscores', () => {
    expect(parseNamespace('nodimensions')).toBeNull()
  })

  it('should return null for non-numeric dimensions', () => {
    expect(parseNamespace('provider_model_abc')).toBeNull()
  })

  it('should return null for zero dimensions', () => {
    expect(parseNamespace('provider_model_0')).toBeNull()
  })

  it('should return null for negative dimensions', () => {
    expect(parseNamespace('provider_model_-5')).toBeNull()
  })

  it('should return null for empty provider', () => {
    expect(parseNamespace('_model_512')).toBeNull()
  })

  it('should return null for empty model', () => {
    expect(parseNamespace('provider__512')).toBeNull()
  })

  it('should return null for single underscore', () => {
    expect(parseNamespace('_')).toBeNull()
  })

  it('should return null for only dimensions', () => {
    expect(parseNamespace('_512')).toBeNull()
  })

  it('should return null for dimensions with suffix', () => {
    // Strict validation: "512abc" should be rejected
    expect(parseNamespace('provider_model_512abc')).toBeNull()
  })

  it('should return null for dimensions with prefix', () => {
    expect(parseNamespace('provider_model_abc512')).toBeNull()
  })
})

describe('getEmbeddingsDir', () => {
  it('should return correct embeddings directory path', () => {
    const result = getEmbeddingsDir('/project')
    expect(result).toBe(path.join(path.resolve('/project'), 'embeddings'))
  })

  it('should handle trailing slash in root path', () => {
    const result = getEmbeddingsDir('/project/')
    expect(result).toBe(path.join(path.resolve('/project/'), 'embeddings'))
  })
})

describe('database paths', () => {
  it('keeps active provider state directly under the index root', () => {
    expect(getActiveProviderPath('/db')).toBe(
      path.join(path.resolve('/db'), 'active-provider.json'),
    )
  })

  it('does not create an active provider while reading', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-active-read-'))
    try {
      await seedNamespace(root)
      const activePath = getActiveProviderPath(root)

      expect(await Effect.runPromise(getActiveNamespace(root))).toBeNull()
      await expect(fs.access(activePath)).rejects.toThrow()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['missing fields', { provider: 'openai' }],
    [
      'empty namespace',
      {
        namespace: '',
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 512,
        activatedAt: '2026-07-20T00:00:00.000Z',
      },
    ],
    [
      'empty provider',
      {
        namespace: 'openai_text-embedding-3-small_512',
        provider: '',
        model: 'text-embedding-3-small',
        dimensions: 512,
        activatedAt: '2026-07-20T00:00:00.000Z',
      },
    ],
    [
      'empty model',
      {
        namespace: 'openai_text-embedding-3-small_512',
        provider: 'openai',
        model: '',
        dimensions: 512,
        activatedAt: '2026-07-20T00:00:00.000Z',
      },
    ],
    [
      'zero dimensions',
      {
        namespace: 'openai_text-embedding-3-small_512',
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 0,
        activatedAt: '2026-07-20T00:00:00.000Z',
      },
    ],
    [
      'negative dimensions',
      {
        namespace: 'openai_text-embedding-3-small_512',
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: -1,
        activatedAt: '2026-07-20T00:00:00.000Z',
      },
    ],
    [
      'fractional dimensions',
      {
        namespace: 'openai_text-embedding-3-small_512',
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 1.5,
        activatedAt: '2026-07-20T00:00:00.000Z',
      },
    ],
    [
      'invalid activation timestamp',
      {
        namespace: 'openai_text-embedding-3-small_512',
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimensions: 512,
        activatedAt: 'not-a-date',
      },
    ],
  ])('rejects %s in active provider data', async (_label, data) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-active-read-'))
    try {
      await fs.writeFile(getActiveProviderPath(root), JSON.stringify(data))

      const error = await Effect.runPromise(
        Effect.flip(readActiveProvider(root)),
      )
      expect(error).toMatchObject({
        _tag: 'EmbeddingNamespaceError',
        operation: 'readActiveProvider',
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe('getNamespaceDir', () => {
  it('should return correct namespace directory path', () => {
    const result = getNamespaceDir(
      '/project',
      'openai_text-embedding-3-small_512',
    )
    expect(result).toBe(
      path.join(
        path.resolve('/project'),
        'embeddings',
        'openai_text-embedding-3-small_512',
      ),
    )
  })

  it('should throw for namespace with forward slash', () => {
    expect(() => getNamespaceDir('/project', 'invalid/namespace')).toThrow(
      'Invalid namespace: contains path separators or traversal sequences',
    )
  })

  it('should throw for namespace with backslash', () => {
    expect(() => getNamespaceDir('/project', 'invalid\\namespace')).toThrow(
      'Invalid namespace: contains path separators or traversal sequences',
    )
  })

  it('should throw for namespace with path traversal', () => {
    expect(() => getNamespaceDir('/project', '../../../etc')).toThrow(
      'Invalid namespace: contains path separators or traversal sequences',
    )
  })

  it('should throw for namespace with double dots', () => {
    expect(() => getNamespaceDir('/project', 'valid..name')).toThrow(
      'Invalid namespace: contains path separators or traversal sequences',
    )
  })

  it('should throw for namespace with null byte', () => {
    expect(() => getNamespaceDir('/project', 'namespace\0poisoned')).toThrow(
      'Invalid namespace: contains path separators or traversal sequences',
    )
  })

  it('should allow valid namespace with hyphens and underscores', () => {
    const result = getNamespaceDir(
      '/project',
      'openai_text-embedding-3-small_512',
    )
    expect(result).toContain('openai_text-embedding-3-small_512')
  })
})

describe('getVectorPath', () => {
  it('should return correct vector file path', () => {
    const result = getVectorPath(
      '/project',
      'openai_text-embedding-3-small_512',
    )
    expect(result).toBe(
      path.join(
        path.resolve('/project'),
        'embeddings',
        'openai_text-embedding-3-small_512',
        'vectors.bin',
      ),
    )
  })

  it('should throw for invalid namespace', () => {
    expect(() => getVectorPath('/project', '../escape')).toThrow()
  })
})

describe('getMetaPath', () => {
  it('should return correct metadata file path', () => {
    const result = getMetaPath('/project', 'openai_text-embedding-3-small_512')
    expect(result).toBe(
      path.join(
        path.resolve('/project'),
        'embeddings',
        'openai_text-embedding-3-small_512',
        'vectors.meta.bin',
      ),
    )
  })

  it('should throw for invalid namespace', () => {
    expect(() => getMetaPath('/project', 'invalid/path')).toThrow()
  })
})

describe('generateNamespace and parseNamespace roundtrip', () => {
  it('should roundtrip simple namespace', () => {
    const original = {
      provider: 'openai',
      model: 'text-embedding',
      dimensions: 512,
    }
    const namespace = generateNamespace(
      original.provider,
      original.model,
      original.dimensions,
    )
    const parsed = parseNamespace(namespace)
    expect(parsed).toEqual(original)
  })

  it('should roundtrip namespace with special characters (sanitized)', () => {
    // Note: parseNamespace splits on first underscore for provider, last underscore for dimensions
    // So 'my_provider_my_model_v1_1024' becomes:
    // - provider: 'my' (first segment before first underscore)
    // - model: 'provider_my_model_v1' (everything between first and last underscore)
    // - dimensions: 1024 (after last underscore)
    const namespace = generateNamespace('My Provider', 'my.model/v1', 1024)
    expect(namespace).toBe('my_provider_my_model_v1_1024')
    const parsed = parseNamespace(namespace)
    expect(parsed).toEqual({
      provider: 'my',
      model: 'provider_my_model_v1',
      dimensions: 1024,
    })
  })

  it('should roundtrip voyage provider', () => {
    const namespace = generateNamespace('voyage', 'voyage-3.5-lite', 1024)
    const parsed = parseNamespace(namespace)
    expect(parsed).toEqual({
      provider: 'voyage',
      model: 'voyage-3_5-lite',
      dimensions: 1024,
    })
  })
})
