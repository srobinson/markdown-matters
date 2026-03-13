# mdm Semantic Search: Current Implementation

This document describes the current semantic search implementation in mdm, covering architecture, components, data flow, and known limitations.

## Overview

mdm provides semantic search capabilities that allow users to search markdown documentation by meaning rather than exact text matching. The system uses OpenAI's text-embedding-3-small model to generate vector embeddings and HNSW (Hierarchical Navigable Small World) for approximate nearest neighbor search.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLI Layer                                      │
│  src/cli/commands/search.ts                                             │
│  - Mode detection (semantic vs keyword)                                 │
│  - Auto-index prompt for missing embeddings                             │
│  - Result formatting and display                                        │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────────┐
│                        Semantic Search Layer                             │
│  src/embeddings/semantic-search.ts                                      │
│  - Cost estimation (estimateEmbeddingCost)                              │
│  - Embedding generation (buildEmbeddings)                               │
│  - Query execution (semanticSearch, semanticSearchWithContent)          │
│  - Statistics (getEmbeddingStats)                                       │
└─────────────┬─────────────────────────────────────┬─────────────────────┘
              │                                     │
┌─────────────▼───────────────┐     ┌───────────────▼─────────────────────┐
│      Embedding Provider      │     │           Vector Store              │
│  src/embeddings/             │     │  src/embeddings/vector-store.ts     │
│    openai-provider.ts        │     │  - HNSW index (hnswlib-node)        │
│  - OpenAI API integration    │     │  - Cosine similarity search         │
│  - text-embedding-3-small    │     │  - Binary index persistence         │
│  - Batch processing (100)    │     │  - Metadata JSON storage            │
└──────────────────────────────┘     └─────────────────────────────────────┘
```

## Components

### 1. Embedding Provider (`src/embeddings/openai-provider.ts`)

**Current Provider**: OpenAI `text-embedding-3-small`

| Property   | Value                    |
| ---------- | ------------------------ |
| Model      | `text-embedding-3-small` |
| Dimensions | 1536                     |
| Batch Size | 100 texts per API call   |
| Cost       | $0.02 per 1M tokens      |

**Interface**:

```typescript
interface EmbeddingProvider {
  readonly name: string; // e.g., "openai:text-embedding-3-small"
  readonly dimensions: number; // 1536 for small, 3072 for large
  embed(texts: string[]): Promise<EmbeddingResult>;
}

interface EmbeddingResult {
  readonly embeddings: readonly number[][];
  readonly tokensUsed: number;
  readonly cost: number;
}
```

**Supported Models**:

- `text-embedding-3-small` (default): 1536 dimensions, $0.02/1M tokens
- `text-embedding-3-large`: 3072 dimensions, $0.13/1M tokens
- `text-embedding-ada-002` (legacy): 1536 dimensions, $0.10/1M tokens

### 2. Vector Store (`src/embeddings/vector-store.ts`)

**Implementation**: HNSW via `hnswlib-node`

| Parameter        | Value    | Description                                  |
| ---------------- | -------- | -------------------------------------------- |
| Space            | `cosine` | Cosine similarity distance metric            |
| Initial Capacity | 10,000   | Auto-resizes by 2x when full                 |
| M                | 16       | Max connections per node (default)           |
| efConstruction   | 200      | Construction-time search width               |
| efSearch         | 100      | Query-time search width (implicit from init) |

**Storage Format**:

- `vectors.bin`: Binary HNSW index file
- `vectors.meta.json`: Metadata including entries, costs, timestamps

**Vector Entry Structure**:

```typescript
interface VectorEntry {
  readonly id: string; // Section ID
  readonly sectionId: string; // Same as id
  readonly documentPath: string; // Relative path to document
  readonly heading: string; // Section heading text
  readonly embedding: readonly number[]; // 1536-dimensional vector
}
```

**Similarity Calculation**:

- HNSW stores cosine distance (1 - similarity)
- Search returns `similarity = 1 - distance`
- Results filtered by threshold (default: 0.35)

### 3. Semantic Search (`src/embeddings/semantic-search.ts`)

**Text Generation for Embeddings**:

Each section is embedded with contextual metadata:

```
# {heading}
Parent section: {parentHeading}  // if nested
Document: {documentTitle}

{full section content}
```

**Filtering**:

- Sections with < 10 tokens are skipped
- Exclude patterns can filter by document path

**Search Flow**:

1. Load vector store from disk
2. Embed query using same provider
3. kNN search with limit \* 2 (over-fetch for filtering)
4. Apply path pattern filter if specified
5. Return top `limit` results above threshold

### 4. CLI Search Command (`src/cli/commands/search.ts`)

**Mode Detection Priority**:

1. `--mode semantic` or `--mode keyword` (explicit)
2. `--keyword` flag (force keyword)
3. Boolean/phrase pattern detected (`AND`, `OR`, `NOT`, `"quoted"`)
4. Regex pattern detected (special characters)
5. Embeddings available → semantic
6. No embeddings → keyword

**Auto-Index Behavior**:

- If semantic mode requested but no embeddings exist:
  - Estimate time/cost
  - If < 10 seconds: auto-create silently
  - Otherwise: prompt user for choice

**Default Search Threshold**: 0.35 (raised from 0.3 to filter low-quality matches)

## Data Flow

### Building Embeddings

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Load Indexes                                                          │
│    - documents.json (document metadata)                                  │
│    - sections.json (section index with line numbers)                     │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Group Sections by Document                                            │
│    - Skip sections < 10 tokens                                           │
│    - Apply exclude patterns                                              │
│    - Track parent headings for context                                   │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Read File Content                                                     │
│    - For each document, read file                                        │
│    - Extract section content by line numbers                             │
│    - Generate embedding text with metadata                               │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. Generate Embeddings                                                   │
│    - Send all texts to OpenAI API (batched by 100)                       │
│    - Track token usage and cost                                          │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. Build HNSW Index                                                      │
│    - Add vectors with sequential integer IDs                             │
│    - Map section IDs to index positions                                  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. Persist to Disk                                                       │
│    - vectors.bin (HNSW binary)                                           │
│    - vectors.meta.json (metadata + entries)                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Query Execution

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Query Input                                                           │
│    "How do I configure authentication?"                                  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Load Vector Store                                                     │
│    - Read vectors.bin into HNSW index                                    │
│    - Load metadata from vectors.meta.json                                │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Embed Query                                                           │
│    - Single API call to OpenAI                                           │
│    - Returns 1536-dim vector                                             │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. HNSW kNN Search                                                       │
│    - Find k nearest neighbors (cosine similarity)                        │
│    - Over-fetch: request limit * 2                                       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. Post-Processing                                                       │
│    - Filter by similarity threshold (default: 0.35)                      │
│    - Filter by path pattern (if specified)                               │
│    - Truncate to requested limit                                         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. Return Results                                                        │
│    [{sectionId, documentPath, heading, similarity}, ...]                │
└─────────────────────────────────────────────────────────────────────────┘
```

## Storage Files

Located in `.mdm/` directory:

| File                | Format | Contents                                       |
| ------------------- | ------ | ---------------------------------------------- |
| `vectors.bin`       | Binary | HNSW index (hnswlib native format)             |
| `vectors.meta.json` | JSON   | Entry metadata, costs, timestamps              |
| `documents.json`    | JSON   | Document index (title, path, stats)            |
| `sections.json`     | JSON   | Section index (headings, line numbers, tokens) |

## Current Limitations and Gaps

### 1. ~~Single Provider Lock-in~~ RESOLVED (ALP-215)

- **RESOLVED**: Multiple embedding providers now supported (OpenAI, Ollama, LM Studio, OpenRouter)
- **Impact**: Users can choose local providers for offline capability and cost savings
- **Code Location**: `provider-factory.ts` handles provider selection based on config

### 2. No Incremental Updates

- **Issue**: `buildEmbeddings` either builds all or skips entirely
- **Impact**: Adding one document requires re-embedding everything (with `--force`)
- **Workaround**: Cache hit detection skips if any embeddings exist

### 3. Fixed HNSW Parameters

- **Issue**: HNSW parameters (M=16, efConstruction=200) are hardcoded
- **Impact**: No tuning for different corpus sizes or quality/speed tradeoffs
- **Code Location**: `vector-store.ts:94`

### 4. No Hybrid Search

- **Issue**: Semantic and keyword search are mutually exclusive
- **Impact**: Can't combine exact matches with semantic similarity
- **Workaround**: Mode auto-detection helps, but no fusion ranking

### 5. No Re-ranking

- **Issue**: Results are pure cosine similarity, no re-ranking
- **Impact**: May miss contextually relevant results that rank lower in embedding space
- **Alternative**: Cross-encoder re-ranking could improve precision

### 6. Section-Level Granularity Only

- **Issue**: Embeddings are per-section, no paragraph or sentence chunking
- **Impact**: Large sections may have diluted embeddings; queries may match subsections better
- **Tradeoff**: Current approach preserves document structure

### 7. No Query Expansion

- **Issue**: Queries are embedded as-is
- **Impact**: Synonyms, abbreviations, and related terms may not match
- **Opportunity**: HyDE or query reformulation could help

### 8. Limited Metadata Filtering

- **Issue**: Only path pattern filtering supported
- **Impact**: Can't filter by date, author, tags, or other metadata
- **Code Location**: `semanticSearch` has `pathPattern` option only

### 9. No Batch Query Support

- **Issue**: Each search embeds query individually
- **Impact**: Multiple searches incur repeated API calls
- **Opportunity**: Query batching could reduce latency

### 10. Memory Usage

- **Issue**: Entire HNSW index loaded into memory
- **Impact**: Large corpora may hit memory limits
- **Note**: Not a problem for typical documentation sizes

## Cost Analysis

For a typical documentation corpus (~1000 sections, ~500K tokens):

| Operation         | Tokens  | Cost       |
| ----------------- | ------- | ---------- |
| Initial embedding | ~500K   | ~$0.01     |
| Per query         | ~50-100 | ~$0.000002 |

The cost is dominated by initial embedding creation. Query costs are negligible.

## Performance Characteristics

| Metric          | Typical Value                  |
| --------------- | ------------------------------ |
| Embedding build | ~1.5s per 100 sections         |
| Query latency   | ~200-500ms (API call dominant) |
| Index load time | ~50-100ms for 1000 vectors     |
| Memory usage    | ~10MB per 1000 vectors         |

## Configuration

Current configuration is largely hardcoded. Key values:

```typescript
// Embedding
model: 'text-embedding-3-small'     // openai-provider.ts
batchSize: 100                       // openai-provider.ts
minTokens: 10                        // semantic-search.ts (skip small sections)

// Vector store
space: 'cosine'                      // vector-store.ts
initialCapacity: 10000               // vector-store.ts
M: 16                                // vector-store.ts
efConstruction: 200                  // vector-store.ts

// Search
defaultLimit: 10                     // search.ts
defaultThreshold: 0.35               // search.ts
autoIndexThreshold: 10 seconds       // search.ts
```

## Type Definitions

Full type definitions are in `src/embeddings/types.ts`:

- `EmbeddingProvider`: Provider interface
- `EmbeddingResult`: Embed response
- `VectorEntry`: Stored vector with metadata
- `VectorIndex`: Full index schema
- `SemanticSearchOptions`: Search parameters
- `SemanticSearchResult`: Search result item
- `EmbedError`: Error types (RateLimit, ApiKey, Network, Unknown)
