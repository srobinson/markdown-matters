/**
 * Semantic search functionality
 */

import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { EmbeddingProvider, SemanticSearchOptions, SemanticSearchResult, VectorEntry } from "./types.js";
import { createVectorStore, HnswVectorStore } from "./vector-store.js";
import { createOpenAIProvider } from "./openai-provider.js";
import { createStorage, loadSectionIndex, loadDocumentIndex } from "../index/storage.js";
import type { SectionEntry } from "../index/types.js";

// ============================================================================
// Embedding Text Generation
// ============================================================================

const generateEmbeddingText = (
  section: SectionEntry,
  documentTitle: string,
  parentHeading?: string | undefined
): string => {
  const parts: string[] = [];

  parts.push(section.heading);
  parts.push("");

  // We don't have the content here, so we'll use heading + context
  if (parentHeading) {
    parts.push(`Parent: ${parentHeading}`);
  }

  parts.push(`Document: ${documentTitle}`);

  return parts.join("\n");
};

// ============================================================================
// Build Embeddings
// ============================================================================

export interface BuildEmbeddingsOptions {
  readonly force?: boolean | undefined;
  readonly provider?: EmbeddingProvider | undefined;
}

export interface BuildEmbeddingsResult {
  readonly sectionsEmbedded: number;
  readonly tokensUsed: number;
  readonly cost: number;
  readonly duration: number;
}

export const buildEmbeddings = (
  rootPath: string,
  options: BuildEmbeddingsOptions = {}
): Effect.Effect<BuildEmbeddingsResult, Error> =>
  Effect.gen(function* () {
    const startTime = Date.now();
    const resolvedRoot = path.resolve(rootPath);
    const storage = createStorage(resolvedRoot);

    // Load indexes
    const docIndex = yield* loadDocumentIndex(storage);
    const sectionIndex = yield* loadSectionIndex(storage);

    if (!docIndex || !sectionIndex) {
      return yield* Effect.fail(
        new Error("Index not found. Run 'mdtldr index' first.")
      );
    }

    // Get or create provider
    const provider = options.provider ?? createOpenAIProvider();
    const dimensions = provider.dimensions;

    // Create vector store
    const vectorStore = createVectorStore(resolvedRoot, dimensions) as HnswVectorStore;
    vectorStore.setProvider(provider.name);

    // Load existing if not forcing
    if (!options.force) {
      const loaded = yield* vectorStore.load();
      if (loaded) {
        // For now, skip if any embeddings exist
        if (vectorStore.getStats().count > 0) {
          const duration = Date.now() - startTime;
          return {
            sectionsEmbedded: 0,
            tokensUsed: 0,
            cost: 0,
            duration,
          };
        }
      }
    }

    // Prepare sections for embedding
    const sectionsToEmbed: { section: SectionEntry; text: string }[] = [];

    for (const section of Object.values(sectionIndex.sections)) {
      const document = docIndex.documents[section.documentPath];
      if (!document) continue;

      // Skip very short sections (< 10 tokens)
      if (section.tokenCount < 10) continue;

      // Find parent heading if any
      let parentHeading: string | undefined;
      if (section.level > 1) {
        const docSections = sectionIndex.byDocument[document.id] ?? [];
        for (const sibId of docSections) {
          const sib = sectionIndex.sections[sibId];
          if (
            sib &&
            sib.level === section.level - 1 &&
            sib.startLine < section.startLine
          ) {
            parentHeading = sib.heading;
          }
        }
      }

      const text = generateEmbeddingText(section, document.title, parentHeading);
      sectionsToEmbed.push({ section, text });
    }

    if (sectionsToEmbed.length === 0) {
      const duration = Date.now() - startTime;
      return {
        sectionsEmbedded: 0,
        tokensUsed: 0,
        cost: 0,
        duration,
      };
    }

    // Generate embeddings
    const texts = sectionsToEmbed.map((s) => s.text);
    const result = yield* Effect.tryPromise({
      try: () => provider.embed(texts),
      catch: (e) =>
        new Error(`Embedding failed: ${e instanceof Error ? e.message : String(e)}`),
    });

    // Create vector entries
    const entries: VectorEntry[] = [];
    for (let i = 0; i < sectionsToEmbed.length; i++) {
      const { section } = sectionsToEmbed[i] ?? { section: null };
      const embedding = result.embeddings[i];
      if (!section || !embedding) continue;

      entries.push({
        id: section.id,
        sectionId: section.id,
        documentPath: section.documentPath,
        heading: section.heading,
        embedding,
      });
    }

    // Add to vector store
    yield* vectorStore.add(entries);
    vectorStore.addCost(result.cost, result.tokensUsed);

    // Save
    yield* vectorStore.save();

    const duration = Date.now() - startTime;

    return {
      sectionsEmbedded: entries.length,
      tokensUsed: result.tokensUsed,
      cost: result.cost,
      duration,
    };
  });

// ============================================================================
// Semantic Search
// ============================================================================

export const semanticSearch = (
  rootPath: string,
  query: string,
  options: SemanticSearchOptions = {}
): Effect.Effect<readonly SemanticSearchResult[], Error> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath);

    // Get provider for query embedding
    const provider = createOpenAIProvider();
    const dimensions = provider.dimensions;

    // Load vector store
    const vectorStore = createVectorStore(resolvedRoot, dimensions);
    const loaded = yield* vectorStore.load();

    if (!loaded) {
      return yield* Effect.fail(
        new Error("Embeddings not found. Run 'mdtldr embed' first.")
      );
    }

    // Embed the query
    const queryResult = yield* Effect.tryPromise({
      try: () => provider.embed([query]),
      catch: (e) =>
        new Error(`Query embedding failed: ${e instanceof Error ? e.message : String(e)}`),
    });

    const queryVector = queryResult.embeddings[0];
    if (!queryVector) {
      return yield* Effect.fail(new Error("Failed to generate query embedding"));
    }

    // Search
    const limit = options.limit ?? 10;
    const threshold = options.threshold ?? 0;

    const searchResults = yield* vectorStore.search(queryVector, limit * 2, threshold);

    // Apply path filter if specified
    let filteredResults = searchResults;
    if (options.pathPattern) {
      const pattern = options.pathPattern
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*");
      const regex = new RegExp(`^${pattern}$`, "i");
      filteredResults = searchResults.filter((r) => regex.test(r.documentPath));
    }

    // Convert to SemanticSearchResult
    const results: SemanticSearchResult[] = filteredResults
      .slice(0, limit)
      .map((r) => ({
        sectionId: r.sectionId,
        documentPath: r.documentPath,
        heading: r.heading,
        similarity: r.similarity,
      }));

    return results;
  });

// ============================================================================
// Search with Content
// ============================================================================

export const semanticSearchWithContent = (
  rootPath: string,
  query: string,
  options: SemanticSearchOptions = {}
): Effect.Effect<readonly SemanticSearchResult[], Error> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath);
    const results = yield* semanticSearch(resolvedRoot, query, options);

    const storage = createStorage(resolvedRoot);
    const sectionIndex = yield* loadSectionIndex(storage);

    if (!sectionIndex) {
      return results;
    }

    const resultsWithContent: SemanticSearchResult[] = [];

    for (const result of results) {
      const section = sectionIndex.sections[result.sectionId];
      if (!section) {
        resultsWithContent.push(result);
        continue;
      }

      const filePath = path.join(resolvedRoot, result.documentPath);

      try {
        const fileContent = yield* Effect.promise(() =>
          fs.readFile(filePath, "utf-8")
        );

        const lines = fileContent.split("\n");
        const content = lines
          .slice(section.startLine - 1, section.endLine)
          .join("\n");

        resultsWithContent.push({
          ...result,
          content,
        });
      } catch {
        resultsWithContent.push(result);
      }
    }

    return resultsWithContent;
  });

// ============================================================================
// Get Embedding Stats
// ============================================================================

export interface EmbeddingStats {
  readonly hasEmbeddings: boolean;
  readonly count: number;
  readonly provider: string;
  readonly dimensions: number;
  readonly totalCost: number;
  readonly totalTokens: number;
}

export const getEmbeddingStats = (
  rootPath: string
): Effect.Effect<EmbeddingStats, Error> =>
  Effect.gen(function* () {
    const resolvedRoot = path.resolve(rootPath);

    // Try to load with default dimensions
    const vectorStore = createVectorStore(resolvedRoot, 1536);
    const loaded = yield* vectorStore.load();

    if (!loaded) {
      return {
        hasEmbeddings: false,
        count: 0,
        provider: "none",
        dimensions: 0,
        totalCost: 0,
        totalTokens: 0,
      };
    }

    const stats = vectorStore.getStats();
    return {
      hasEmbeddings: true,
      count: stats.count,
      provider: stats.provider,
      dimensions: stats.dimensions,
      totalCost: stats.totalCost,
      totalTokens: stats.totalTokens,
    };
  });
