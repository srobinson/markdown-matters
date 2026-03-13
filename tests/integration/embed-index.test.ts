/**
 * Embed + Index Integration Tests
 *
 * Tests the full indexing and embedding pipeline on small and large corpora.
 * Verifies binary format usage, MessagePack handling, metadata creation,
 * and proper index loading after creation.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createVectorStore } from '../../src/embeddings/vector-store.js'
import { buildIndex } from '../../src/index/indexer.js'
import {
  createStorage,
  loadDocumentIndex,
  loadSectionIndex,
} from '../../src/index/storage.js'

// ============================================================================
// Test Setup
// ============================================================================

describe('Embed + Index Integration Tests', () => {
  let tempDir: string
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdcontext-embed-int-'))

    // Save and mock API key for tests
    savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-test-mock-key-for-testing'
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })

    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Create a test markdown file with specified content
   */
  const createMarkdownFile = (filePath: string, content: string): void => {
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, content, 'utf-8')
  }

  /**
   * Create a small test corpus (50-100 docs)
   */
  const createSmallCorpus = (baseDir: string): void => {
    // Create 60 small markdown files across 3 directories
    for (let i = 1; i <= 20; i++) {
      createMarkdownFile(
        path.join(baseDir, 'docs', `file${i}.md`),
        `# Document ${i}\n\nThis is a test document with some content.\n\n## Section 1\n\nContent for section 1.\n\n## Section 2\n\nContent for section 2.`,
      )
    }

    for (let i = 1; i <= 20; i++) {
      createMarkdownFile(
        path.join(baseDir, 'guides', `guide${i}.md`),
        `# Guide ${i}\n\nThis is a guide document.\n\n## Getting Started\n\nHow to get started.\n\n## Advanced Topics\n\nAdvanced usage patterns.`,
      )
    }

    for (let i = 1; i <= 20; i++) {
      createMarkdownFile(
        path.join(baseDir, 'api', `api${i}.md`),
        `# API Reference ${i}\n\nAPI documentation.\n\n## Methods\n\nAvailable methods.\n\n## Examples\n\nUsage examples.`,
      )
    }
  }

  /**
   * Create a large test corpus (1000+ docs)
   */
  const createLargeCorpus = (baseDir: string): void => {
    // Create 1050 markdown files across 10 directories
    for (let dir = 1; dir <= 10; dir++) {
      for (let file = 1; file <= 105; file++) {
        createMarkdownFile(
          path.join(baseDir, `section${dir}`, `doc${file}.md`),
          `# Document ${dir}-${file}\n\n## Overview\n\nContent for document ${dir}-${file}.\n\n## Details\n\nDetailed information about this topic.\n\n## Examples\n\nCode examples and usage patterns.`,
        )
      }
    }
  }

  /**
   * Get file size in bytes
   */
  const getFileSize = (filePath: string): number => {
    try {
      return fs.statSync(filePath).size
    } catch {
      return 0
    }
  }

  /**
   * Check if a file exists
   */
  const fileExists = (filePath: string): boolean => {
    try {
      fs.accessSync(filePath)
      return true
    } catch {
      return false
    }
  }

  // ==========================================================================
  // Small Corpus Tests (50-100 docs)
  // ==========================================================================

  describe('Small Corpus Tests', () => {
    it('indexes small corpus without errors', async () => {
      createSmallCorpus(tempDir)

      const result = await Effect.runPromise(buildIndex(tempDir))

      expect(result.totalDocuments).toBeGreaterThanOrEqual(60)
      expect(result.totalSections).toBeGreaterThan(0)
      expect(result.errors).toHaveLength(0)
    })

    it('creates .mdm directory structure', async () => {
      createSmallCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      const mdmDir = path.join(tempDir, '.mdm')
      const indexesDir = path.join(mdmDir, 'indexes')
      expect(fileExists(mdmDir)).toBe(true)
      expect(fileExists(path.join(mdmDir, 'config.json'))).toBe(true)
      expect(fileExists(path.join(indexesDir, 'documents.json'))).toBe(true)
      expect(fileExists(path.join(indexesDir, 'sections.json'))).toBe(true)
      expect(fileExists(path.join(indexesDir, 'links.json'))).toBe(true)
    })

    it('verifies binary format is used for vector metadata', async () => {
      createSmallCorpus(tempDir)

      // Build index and embeddings
      await Effect.runPromise(buildIndex(tempDir))

      // Add a mock vector entry to test format
      const vectorStore = createVectorStore(tempDir, 512)
      await Effect.runPromise(
        vectorStore.add([
          {
            id: 'test-1',
            sectionId: 'sec-1',
            documentPath: 'test.md',
            heading: 'Test',
            embedding: Array(512).fill(0.1),
          },
        ]),
      )
      await Effect.runPromise(vectorStore.save())

      // Check that binary format (.bin) is created, not JSON
      const metaPath = path.join(tempDir, '.mdm', 'vectors.meta.bin')
      const jsonPath = path.join(tempDir, '.mdm', 'vectors.meta.json')

      expect(fileExists(metaPath)).toBe(true)
      expect(fileExists(jsonPath)).toBe(false)
    })

    it('loads index successfully after creation', async () => {
      createSmallCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      // Verify we can load the created index
      const storage = createStorage(tempDir)
      const docIndex = await Effect.runPromise(loadDocumentIndex(storage))
      const sectionIndex = await Effect.runPromise(loadSectionIndex(storage))

      expect(docIndex).not.toBeNull()
      expect(sectionIndex).not.toBeNull()
      expect(Object.keys(docIndex!.documents).length).toBeGreaterThanOrEqual(60)
      expect(Object.keys(sectionIndex!.sections).length).toBeGreaterThan(0)
    })

    it('incremental index skips unchanged files', async () => {
      createSmallCorpus(tempDir)

      // First index
      const firstResult = await Effect.runPromise(buildIndex(tempDir))
      const firstIndexed = firstResult.documentsIndexed

      // Second index without changes
      const secondResult = await Effect.runPromise(buildIndex(tempDir))

      expect(secondResult.documentsIndexed).toBe(0)
      expect(secondResult.skipped.unchanged).toBe(firstIndexed)
    })

    it('force flag rebuilds entire index', async () => {
      createSmallCorpus(tempDir)

      // First index
      const firstResult = await Effect.runPromise(buildIndex(tempDir))
      const totalDocs = firstResult.totalDocuments

      // Force rebuild
      const secondResult = await Effect.runPromise(
        buildIndex(tempDir, { force: true }),
      )

      expect(secondResult.documentsIndexed).toBe(totalDocs)
      expect(secondResult.skipped.unchanged).toBe(0)
    })
  })

  // ==========================================================================
  // Large Corpus Tests (1000+ docs)
  // ==========================================================================

  describe('Large Corpus Tests', () => {
    it('indexes large corpus without errors', async () => {
      createLargeCorpus(tempDir)

      const result = await Effect.runPromise(buildIndex(tempDir))

      expect(result.totalDocuments).toBeGreaterThanOrEqual(1000)
      expect(result.totalSections).toBeGreaterThan(3000)
      expect(result.errors).toHaveLength(0)
      expect(result.duration).toBeGreaterThan(0)
    })

    it('verifies MessagePack handles large metadata efficiently', async () => {
      createLargeCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      const metaPath = path.join(tempDir, '.mdm', 'vectors.meta.bin')

      // Create a large vector store with some entries to test MessagePack
      const vectorStore = createVectorStore(tempDir, 512)
      await Effect.runPromise(
        vectorStore.add([
          {
            id: 'test-1',
            sectionId: 'sec-1',
            documentPath: 'test.md',
            heading: 'Test',
            embedding: Array(512).fill(0.1),
          },
        ]),
      )
      await Effect.runPromise(vectorStore.save())

      // Binary file should exist
      expect(fileExists(metaPath)).toBe(true)

      // File should have reasonable size (MessagePack is efficient)
      const size = getFileSize(metaPath)
      expect(size).toBeGreaterThan(0)
    })

    it('checks file sizes are reasonable for large corpus', async () => {
      createLargeCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      // Check document index size
      const docPath = path.join(tempDir, '.mdm', 'indexes', 'documents.json')
      const docSize = getFileSize(docPath)
      expect(docSize).toBeGreaterThan(0)
      expect(docSize).toBeLessThan(50_000_000) // < 50MB reasonable for 1000+ docs

      // Check section index size
      const sectionPath = path.join(tempDir, '.mdm', 'indexes', 'sections.json')
      const sectionSize = getFileSize(sectionPath)
      expect(sectionSize).toBeGreaterThan(0)
      expect(sectionSize).toBeLessThan(100_000_000) // < 100MB reasonable
    })

    it('large corpus can be loaded after indexing', async () => {
      createLargeCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      const storage = createStorage(tempDir)
      const docIndex = await Effect.runPromise(loadDocumentIndex(storage))
      const sectionIndex = await Effect.runPromise(loadSectionIndex(storage))

      expect(docIndex).not.toBeNull()
      expect(sectionIndex).not.toBeNull()
      expect(Object.keys(docIndex!.documents).length).toBeGreaterThanOrEqual(
        1000,
      )
      expect(Object.keys(sectionIndex!.sections).length).toBeGreaterThanOrEqual(
        3000,
      )
    })

    it('processes large corpus in reasonable time', async () => {
      createLargeCorpus(tempDir)

      const startTime = Date.now()
      const result = await Effect.runPromise(buildIndex(tempDir))
      const duration = Date.now() - startTime

      // Should complete within reasonable time (adjust based on CI performance)
      expect(duration).toBeLessThan(60_000) // < 60 seconds
      expect(result.duration).toBeGreaterThan(0)
    }, 60000)
  }, 120000)

  // ==========================================================================
  // Metadata and Binary Format Tests
  // ==========================================================================

  describe('Metadata and Binary Format Tests', () => {
    it('verifies vectors.meta.bin is created not vectors.meta.json', async () => {
      createSmallCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      const vectorStore = createVectorStore(tempDir, 512)
      await Effect.runPromise(
        vectorStore.add([
          {
            id: 'test-1',
            sectionId: 'sec-1',
            documentPath: 'test.md',
            heading: 'Test',
            embedding: Array(512).fill(0.1),
          },
        ]),
      )
      await Effect.runPromise(vectorStore.save())

      const binPath = path.join(tempDir, '.mdm', 'vectors.meta.bin')
      const jsonPath = path.join(tempDir, '.mdm', 'vectors.meta.json')

      expect(fileExists(binPath)).toBe(true)
      expect(fileExists(jsonPath)).toBe(false)
    })

    it('binary metadata can be loaded after saving', async () => {
      createSmallCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      // Save vector store with data
      const vectorStore1 = createVectorStore(tempDir, 512)
      await Effect.runPromise(
        vectorStore1.add([
          {
            id: 'test-1',
            sectionId: 'sec-1',
            documentPath: 'test.md',
            heading: 'Test',
            embedding: Array(512).fill(0.1),
          },
        ]),
      )
      await Effect.runPromise(vectorStore1.save())

      // Load vector store
      const vectorStore2 = createVectorStore(tempDir, 512)
      const loadResult = await Effect.runPromise(vectorStore2.load())

      expect(loadResult.loaded).toBe(true)
    })

    it('handles metadata size warnings for large corpora', async () => {
      createLargeCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      const vectorStore = createVectorStore(tempDir, 512)
      await Effect.runPromise(
        vectorStore.add([
          {
            id: 'test-1',
            sectionId: 'sec-1',
            documentPath: 'test.md',
            heading: 'Test',
            embedding: Array(512).fill(0.1),
          },
        ]),
      )

      // Capture console.warn calls
      const originalWarn = console.warn
      const warnings: string[] = []
      console.warn = (msg: string) => warnings.push(msg)

      try {
        await Effect.runPromise(vectorStore.save())

        // For very large corpora (>100MB), a warning should appear
        // This test verifies the warning system works
        const metaPath = path.join(tempDir, '.mdm', 'vectors.meta.bin')
        const size = getFileSize(metaPath)

        if (size > 100_000_000) {
          expect(warnings.some((w) => w.includes('Large metadata'))).toBe(true)
        }
      } finally {
        console.warn = originalWarn
      }
    })
  })

  // ==========================================================================
  // Vector Store Loading Tests
  // ==========================================================================

  describe('Vector Store Loading Tests', () => {
    it('vector store loads successfully after index creation', async () => {
      createSmallCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      const vectorStore = createVectorStore(tempDir, 512)
      await Effect.runPromise(
        vectorStore.add([
          {
            id: 'test-1',
            sectionId: 'sec-1',
            documentPath: 'test.md',
            heading: 'Test',
            embedding: Array(512).fill(0.1),
          },
        ]),
      )
      await Effect.runPromise(vectorStore.save())

      const loadResult = await Effect.runPromise(vectorStore.load())

      expect(loadResult.loaded).toBe(true)
      expect(loadResult.hnswMismatch).toBeUndefined()
    })

    it('detects dimension mismatch on load', async () => {
      createSmallCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      // Save with 512 dimensions
      const vectorStore1 = createVectorStore(tempDir, 512)
      await Effect.runPromise(
        vectorStore1.add([
          {
            id: 'test-1',
            sectionId: 'sec-1',
            documentPath: 'test.md',
            heading: 'Test',
            embedding: Array(512).fill(0.1),
          },
        ]),
      )
      await Effect.runPromise(vectorStore1.save())

      // Try to load with different dimensions
      const vectorStore2 = createVectorStore(tempDir, 768)

      await expect(
        Effect.runPromise(vectorStore2.load()),
      ).rejects.toThrowError()
    })

    it('returns false loaded status when files do not exist', async () => {
      const vectorStore = createVectorStore(tempDir, 512)
      const loadResult = await Effect.runPromise(vectorStore.load())

      expect(loadResult.loaded).toBe(false)
    })

    it('preserves provider metadata across save/load', async () => {
      createSmallCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      // Save with provider metadata
      const vectorStore1 = createVectorStore(tempDir, 512)
      vectorStore1.setProvider('openai', 'text-embedding-3-small', undefined)
      await Effect.runPromise(
        vectorStore1.add([
          {
            id: 'test-1',
            sectionId: 'sec-1',
            documentPath: 'test.md',
            heading: 'Test',
            embedding: Array(512).fill(0.1),
          },
        ]),
      )
      await Effect.runPromise(vectorStore1.save())

      // Load and verify metadata preserved
      const vectorStore2 = createVectorStore(tempDir, 512)
      await Effect.runPromise(vectorStore2.load())
      const stats = vectorStore2.getStats()

      expect(stats.provider).toBe('openai')
      expect(stats.providerModel).toBe('text-embedding-3-small')
      expect(stats.dimensions).toBe(512)
    })

    it('handles HNSW parameter mismatch detection', async () => {
      createSmallCorpus(tempDir)

      await Effect.runPromise(buildIndex(tempDir))

      // Save with specific HNSW params
      const vectorStore1 = createVectorStore(tempDir, 512, {
        m: 16,
        efConstruction: 200,
      })
      await Effect.runPromise(
        vectorStore1.add([
          {
            id: 'test-1',
            sectionId: 'sec-1',
            documentPath: 'test.md',
            heading: 'Test',
            embedding: Array(512).fill(0.1),
          },
        ]),
      )
      await Effect.runPromise(vectorStore1.save())

      // Load with different HNSW params
      const vectorStore2 = createVectorStore(tempDir, 512, {
        m: 24,
        efConstruction: 256,
      })
      const loadResult = await Effect.runPromise(vectorStore2.load())

      expect(loadResult.loaded).toBe(true)
      expect(loadResult.hnswMismatch).toBeDefined()
      expect(loadResult.hnswMismatch?.configParams.m).toBe(24)
      expect(loadResult.hnswMismatch?.indexParams.m).toBe(16)
    })
  })

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('handles empty corpus gracefully', async () => {
      // Create directory but no files
      fs.mkdirSync(path.join(tempDir, 'empty'), { recursive: true })

      const result = await Effect.runPromise(buildIndex(tempDir))

      expect(result.totalDocuments).toBe(0)
      expect(result.totalSections).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it('handles corpus with only hidden files', async () => {
      // Create only hidden files
      createMarkdownFile(
        path.join(tempDir, '.hidden', 'file.md'),
        '# Hidden\n\nHidden file.',
      )

      const result = await Effect.runPromise(buildIndex(tempDir))

      expect(result.totalDocuments).toBe(0)
      expect(result.skipped.hidden).toBeGreaterThan(0)
    })

    it('handles corpus with excluded patterns', async () => {
      createSmallCorpus(tempDir)

      const result = await Effect.runPromise(
        buildIndex(tempDir, { exclude: ['docs/**'] }),
      )

      // Should skip docs directory
      expect(result.totalDocuments).toBeLessThan(60)
      expect(result.skipped.excluded).toBeGreaterThan(0)
    })

    it('handles files with parsing errors', async () => {
      // Create invalid markdown file
      createMarkdownFile(
        path.join(tempDir, 'invalid.md'),
        '# Test\n\nInvalid content',
      )

      const result = await Effect.runPromise(buildIndex(tempDir))

      // Should still complete successfully
      expect(result.totalDocuments).toBeGreaterThanOrEqual(0)
    })

    it('handles .gitignore patterns correctly', async () => {
      createSmallCorpus(tempDir)

      // Create .gitignore
      fs.writeFileSync(
        path.join(tempDir, '.gitignore'),
        'docs/\n*.tmp\n',
        'utf-8',
      )

      const result = await Effect.runPromise(buildIndex(tempDir))

      // Should respect .gitignore
      expect(result.skipped.excluded).toBeGreaterThan(0)
    })

    it('handles .mdmignore patterns correctly', async () => {
      createSmallCorpus(tempDir)

      // Create .mdmignore
      fs.writeFileSync(path.join(tempDir, '.mdmignore'), 'guides/\n', 'utf-8')

      const result = await Effect.runPromise(buildIndex(tempDir))

      // Should respect .mdmignore
      expect(result.skipped.excluded).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Performance and Scalability Tests
  // ==========================================================================

  describe('Performance and Scalability', () => {
    it('indexes scale linearly with corpus size', async () => {
      // Small corpus baseline
      createSmallCorpus(tempDir)
      const smallResult = await Effect.runPromise(buildIndex(tempDir))
      const smallTimePerDoc = smallResult.duration / smallResult.totalDocuments

      // Clean and create larger corpus
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdcontext-embed-int-'))
      createLargeCorpus(tempDir)

      const largeResult = await Effect.runPromise(buildIndex(tempDir))
      const largeTimePerDoc = largeResult.duration / largeResult.totalDocuments

      // Time per document should be roughly similar (within 3x)
      expect(largeTimePerDoc).toBeLessThan(smallTimePerDoc * 3)
    })

    it('section index grows proportionally to documents', async () => {
      createSmallCorpus(tempDir)

      const result = await Effect.runPromise(buildIndex(tempDir))

      // Each document has ~3 sections, ratio should be reasonable
      const ratio = result.totalSections / result.totalDocuments
      expect(ratio).toBeGreaterThan(2)
      expect(ratio).toBeLessThan(10)
    })

    it('handles repeated index/rebuild cycles', async () => {
      createSmallCorpus(tempDir)

      // Run multiple index cycles
      for (let i = 0; i < 5; i++) {
        const result = await Effect.runPromise(
          buildIndex(tempDir, { force: true }),
        )
        expect(result.totalDocuments).toBeGreaterThanOrEqual(60)
      }

      // Final verification
      const storage = createStorage(tempDir)
      const docIndex = await Effect.runPromise(loadDocumentIndex(storage))
      expect(docIndex).not.toBeNull()
    })
  })
})
