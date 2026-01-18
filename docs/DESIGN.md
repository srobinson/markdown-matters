# Design: @hw/md-tldr

## Data Model

### Document

```typescript
interface MdDocument {
  readonly id: string; // hash of path
  readonly path: string; // relative to root
  readonly title: string; // first H1 or filename
  readonly frontmatter: Record<string, unknown>;
  readonly sections: readonly MdSection[];
  readonly links: readonly MdLink[];
  readonly codeBlocks: readonly MdCodeBlock[];
  readonly metadata: DocumentMetadata;
}

interface DocumentMetadata {
  readonly wordCount: number;
  readonly tokenCount: number; // estimated
  readonly headingCount: number;
  readonly linkCount: number;
  readonly codeBlockCount: number;
  readonly lastModified: Date;
  readonly indexedAt: Date;
}
```

### Section

```typescript
interface MdSection {
  readonly id: string; // doc-id + heading slug
  readonly heading: string; // heading text
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly content: string; // raw markdown content
  readonly plainText: string; // stripped for embedding
  readonly startLine: number;
  readonly endLine: number;
  readonly children: readonly MdSection[]; // nested sections
  readonly metadata: SectionMetadata;
}

interface SectionMetadata {
  readonly wordCount: number;
  readonly tokenCount: number;
  readonly hasCode: boolean;
  readonly hasList: boolean;
  readonly hasTable: boolean;
}
```

### Link

```typescript
interface MdLink {
  readonly type: "internal" | "external" | "image";
  readonly href: string;
  readonly text: string;
  readonly sectionId: string; // which section contains this link
  readonly line: number;
}
```

### Code Block

```typescript
interface MdCodeBlock {
  readonly language: string | null;
  readonly content: string;
  readonly sectionId: string;
  readonly startLine: number;
  readonly endLine: number;
}
```

---

## Index Structure

### File Layout

```
.md-tldr/
  config.json              # Configuration
  indexes/
    documents.json         # Document metadata index
    sections.json          # Section index
    links.json             # Link graph (forward + back)
    vectors.faiss          # Embedding vectors
    vectors.meta.json      # Vector ID → Section ID mapping
  cache/
    parsed/                # Cached parsed documents
      <hash>.json
  metrics/
    queries.jsonl          # Query log
    stats.json             # Aggregated stats
```

### Document Index

```typescript
// documents.json
interface DocumentIndex {
  readonly version: number;
  readonly rootPath: string;
  readonly documents: Record<string, DocumentEntry>;
}

interface DocumentEntry {
  readonly path: string;
  readonly title: string;
  readonly mtime: number;
  readonly hash: string; // content hash for change detection
  readonly tokenCount: number;
  readonly sectionCount: number;
}
```

### Section Index

```typescript
// sections.json
interface SectionIndex {
  readonly version: number;
  readonly sections: Record<string, SectionEntry>;
  readonly byHeading: Record<string, string[]>; // heading → section IDs
  readonly byDocument: Record<string, string[]>; // doc ID → section IDs
}

interface SectionEntry {
  readonly documentId: string;
  readonly heading: string;
  readonly level: number;
  readonly startLine: number;
  readonly tokenCount: number;
}
```

### Link Index

```typescript
// links.json
interface LinkIndex {
  readonly version: number;
  readonly forward: Record<string, string[]>; // doc → docs it links to
  readonly backward: Record<string, string[]>; // doc → docs that link to it
  readonly broken: string[]; // links to non-existent docs
}
```

---

## Embedding Strategy

### What to Embed

| Unit       | Pros                  | Cons                                    |
| ---------- | --------------------- | --------------------------------------- |
| Document   | Simple, fewer vectors | Too coarse, loses section relevance     |
| Section    | Good granularity      | Many vectors, section boundaries matter |
| Paragraph  | Fine-grained          | Too many vectors, context loss          |
| **Hybrid** | Best of both          | More complexity                         |

**Decision: Section-level embeddings with document-level fallback**

- Each section gets embedded
- Very short sections (< 50 tokens) merged with parent
- Document-level embedding as additional signal

### Embedding Content

For each section, embed:

```
{heading}

{plainText first 500 tokens}

Parent: {parent heading}
Document: {document title}
```

Including parent and document provides hierarchical context.

### Vector Dimensions

| Model                         | Dimensions | Notes                   |
| ----------------------------- | ---------- | ----------------------- |
| OpenAI text-embedding-3-small | 1536       | Good quality, cheap     |
| OpenAI text-embedding-3-large | 3072       | Best quality, expensive |
| BGE-large-en-v1.5             | 1024       | Local, good quality     |

**Decision: Start with text-embedding-3-small, make pluggable**

---

## Summarization Strategy

### Hierarchical Compression

```
Level 0: Raw section content
    ↓ (compress)
Level 1: Section summary (key sentences, ~20% of original)
    ↓ (compress)
Level 2: Document summary (combined section summaries)
    ↓ (compress)
Level 3: Collection summary (key documents, themes)
```

### Section Summary Algorithm

1. **Extract key sentences** — First sentence, sentences with keywords, concluding sentence
2. **Preserve structure markers** — Keep heading, list item starts, code block presence
3. **Token budget** — Target 20% of original, min 50 tokens, max 500 tokens

### Document Summary Template

```markdown
# {title}

## Overview

{first paragraph or extracted thesis}

## Sections

- **{heading 1}**: {one-line summary}
- **{heading 2}**: {one-line summary}
  ...

## Key Points

- {extracted key point 1}
- {extracted key point 2}

## Links

- References: {count} internal, {count} external
- Referenced by: {backlink count} documents

**Tokens:** {original} → {summary} ({percent}% reduction)
```

---

## Analytics Design

### Metrics Categories

#### Performance Metrics

| Metric                           | Type      | Labels  | Description               |
| -------------------------------- | --------- | ------- | ------------------------- |
| `mdtldr_parse_duration_ms`       | Histogram | -       | Time to parse a document  |
| `mdtldr_index_build_duration_ms` | Histogram | `type`  | Time to build index       |
| `mdtldr_query_duration_ms`       | Histogram | `type`  | Query execution time      |
| `mdtldr_embed_duration_ms`       | Histogram | `model` | Embedding generation time |
| `mdtldr_cache_hit_total`         | Counter   | `cache` | Cache hits                |
| `mdtldr_cache_miss_total`        | Counter   | `cache` | Cache misses              |

#### Usage Metrics

| Metric                       | Type    | Labels | Description              |
| ---------------------------- | ------- | ------ | ------------------------ |
| `mdtldr_queries_total`       | Counter | `type` | Total queries            |
| `mdtldr_tokens_input_total`  | Counter | -      | Tokens sent to embedding |
| `mdtldr_tokens_output_total` | Counter | -      | Tokens in responses      |
| `mdtldr_documents_indexed`   | Gauge   | -      | Documents in index       |
| `mdtldr_sections_indexed`    | Gauge   | -      | Sections in index        |

#### Quality Metrics

| Metric                           | Type      | Labels  | Description              |
| -------------------------------- | --------- | ------- | ------------------------ |
| `mdtldr_search_results_returned` | Histogram | -       | Results per query        |
| `mdtldr_compression_ratio`       | Histogram | `level` | Token reduction achieved |

### Query Logging

```typescript
interface QueryLogEntry {
  readonly timestamp: Date;
  readonly type: "search" | "context" | "structure";
  readonly query: string;
  readonly filters: Record<string, unknown>;
  readonly resultCount: number;
  readonly durationMs: number;
  readonly tokensUsed: number;
  readonly cacheHit: boolean;
}
```

Stored as JSONL for easy streaming analysis.

---

## API Design

### Core Functions

```typescript
// Parsing
parse(content: string): Effect<MdDocument, ParseError>
parseFile(path: string): Effect<MdDocument, ParseError | IoError>

// Indexing
index(dir: string, options?: IndexOptions): Effect<IndexResult, IndexError>
reindex(paths: string[]): Effect<IndexResult, IndexError>

// Search
search(query: string, options?: SearchOptions): Effect<SearchResult[], SearchError>
structuralSearch(pattern: StructuralPattern): Effect<StructuralResult[], SearchError>

// Context
getContext(path: string, options?: ContextOptions): Effect<Context, ContextError>
assembleContext(sources: ContextSource[], budget: number): Effect<AssembledContext, ContextError>

// Summarization
summarize(doc: MdDocument, level: SummaryLevel): Effect<Summary, SummarizeError>

// Metrics
getMetrics(): Effect<Metrics, never>
```

### Options Types

```typescript
interface IndexOptions {
  readonly include?: string[]; // Glob patterns
  readonly exclude?: string[]; // Glob patterns
  readonly embeddings?: boolean; // Generate embeddings
  readonly force?: boolean; // Rebuild even if cached
}

interface SearchOptions {
  readonly limit?: number; // Max results (default 10)
  readonly threshold?: number; // Min similarity (default 0.7)
  readonly filter?: SearchFilter; // Structural filters
}

interface SearchFilter {
  readonly paths?: string[]; // Limit to these paths
  readonly headingLevel?: number[]; // Only these heading levels
  readonly hasCode?: boolean; // Sections with code
  readonly minTokens?: number; // Minimum section size
  readonly maxTokens?: number; // Maximum section size
}

interface ContextOptions {
  readonly level?: SummaryLevel; // 'full' | 'summary' | 'brief'
  readonly maxTokens?: number; // Token budget
  readonly sections?: string[]; // Specific sections
}
```

---

## CLI Design

```bash
# Indexing
mdtldr index [dir]                 # Index directory (default: .)
mdtldr index --watch               # Index and watch for changes
mdtldr index --force               # Force full rebuild

# Search
mdtldr search "query"              # Semantic search
mdtldr search "query" --limit 5    # Limit results
mdtldr search "query" --json       # JSON output

# Context
mdtldr context <path>              # Full document context
mdtldr context <path> --brief      # Brief summary
mdtldr context <path> --tokens 500 # Token budget

# Structure
mdtldr structure <path>            # Show document structure
mdtldr structure <path> --tree     # Tree view
mdtldr links <path>                # Show link graph
mdtldr backlinks <path>            # What links to this?

# Metrics
mdtldr metrics                     # Show current metrics
mdtldr metrics --json              # JSON format
mdtldr metrics --reset             # Reset counters

# Daemon
mdtldr daemon                      # Run as daemon
mdtldr daemon --port 8765          # Custom port
```

---

## MCP Tools

```typescript
const tools = [
  {
    name: "md_search",
    description: "Search markdown documents by meaning",
    parameters: {
      query: { type: "string", required: true },
      limit: { type: "number", default: 5 },
      path_filter: { type: "string", description: "Glob pattern" },
    },
  },
  {
    name: "md_context",
    description: "Get LLM-ready context from a markdown file",
    parameters: {
      path: { type: "string", required: true },
      level: { type: "string", enum: ["full", "summary", "brief"] },
      max_tokens: { type: "number" },
    },
  },
  {
    name: "md_structure",
    description: "Get the structure/outline of a markdown file",
    parameters: {
      path: { type: "string", required: true },
    },
  },
  {
    name: "md_links",
    description: "Get links to/from a markdown file",
    parameters: {
      path: { type: "string", required: true },
      direction: { type: "string", enum: ["outgoing", "incoming", "both"] },
    },
  },
];
```

---

_Created: 2025-01-18_
