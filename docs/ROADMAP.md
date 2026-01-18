# Roadmap: @hw/md-tldr

## Overview

Build a token-efficient markdown analysis tool for LLM consumption. Each phase delivers testable functionality, building toward a complete system with parsing, semantic search, summarization, and analytics.

## Phases

- [ ] **Phase 1: Core Parsing** — Markdown AST extraction and structure
- [ ] **Phase 2: Index & Storage** — Persistent indexes, file watching, caching
- [ ] **Phase 3: Semantic Layer** — Embeddings, vector search
- [ ] **Phase 4: Summarization** — Hierarchical compression, token optimization
- [ ] **Phase 5: Analytics** — Performance metrics, query tracking
- [ ] **Phase 6: Integration** — CLI, MCP server, HumanWork skills

---

## Phase 1: Core Parsing

**Goal:** Extract structured data from markdown files.

### 1.1: Project Setup

- Initialize `packages/hw_md_tldr` in monorepo
- TypeScript + Effect setup
- Test infrastructure (vitest)
- Basic CI integration

**Deliverables:**

- Package scaffolding
- Build working
- First test passing

### 1.2: Markdown Parser

- Integrate remark/unified
- Parse to mdast (Markdown AST)
- Handle frontmatter (YAML)
- Handle GFM extensions (tables, task lists)

**Deliverables:**

- `parse(content: string): MdastRoot`
- Frontmatter extraction
- Unit tests for various markdown features

### 1.3: Structure Extraction

- Extract heading hierarchy
- Identify sections (content between headings)
- Extract code blocks with language tags
- Extract links (internal, external, images)
- Extract lists and tables

**Deliverables:**

- `extractStructure(ast): DocumentStructure`
- Section tree with content
- Link graph per document
- Code block inventory

### 1.4: Document Model

- Define document schema (Effect Schema)
- Section schema with metadata
- Serialize/deserialize to JSON

**Deliverables:**

- `Document` type with full structure
- `Section` type with bounds, content, metadata
- JSON round-trip tests

---

## Phase 2: Index & Storage

**Goal:** Persist parsed data, enable fast lookups, handle updates.

### 2.1: Storage Interface

- Define `MdStore` interface
- In-memory implementation for testing
- File-based implementation for persistence

**Deliverables:**

- `MdStore` interface (save, load, query)
- `MemoryMdStore`
- `FileMdStore` (JSON files in `.md-tldr/`)

### 2.2: Document Indexing

- Index documents by path
- Index sections by heading
- Index links (forward and back)
- Incremental updates (changed files only)

**Deliverables:**

- Path → Document lookup
- Heading → Section lookup
- Backlink index
- Change detection (mtime, hash)

### 2.3: File Watching

- Watch directory for changes
- Debounce rapid changes
- Incremental re-index
- Configurable ignore patterns

**Deliverables:**

- `watch(dir, options): Effect<void>`
- `.md-tldrignore` support
- Debounce logic (default 500ms)

### 2.4: Cache Management

- Cache parsed documents
- Cache structure indexes
- Invalidation on file change
- Size limits and eviction

**Deliverables:**

- LRU cache for documents
- Index persistence to disk
- Cache stats (hits, misses, size)

---

## Phase 3: Semantic Layer

**Goal:** Enable meaning-based search via embeddings.

### 3.1: Embedding Interface

- Define `Embedder` interface
- Pluggable backends (API, local)
- Batch embedding support

**Deliverables:**

- `Embedder` interface
- `embed(texts: string[]): Effect<Vector[]>`
- Configuration for model selection

### 3.2: OpenAI Embeddings

- Implement OpenAI text-embedding-3-small
- Rate limiting and retry logic
- Cost tracking

**Deliverables:**

- `OpenAIEmbedder`
- Automatic batching (max 8k tokens)
- Cost per query metric

### 3.3: Local Embeddings (Optional)

- Python subprocess for sentence-transformers
- Or ONNX runtime in Node
- Fallback when API unavailable

**Deliverables:**

- `LocalEmbedder` (stretch goal)
- Model download management

### 3.4: Vector Index

- Store embeddings with document/section IDs
- Similarity search (cosine)
- FAISS or hnswlib integration

**Deliverables:**

- `VectorIndex` interface
- `search(query: Vector, k: number): Result[]`
- Persistence to disk

### 3.5: Semantic Search API

- Text query → embed → search
- Combine with structural filters
- Rank and return results

**Deliverables:**

- `semanticSearch(query: string, options): SearchResult[]`
- Filter by path pattern, heading level
- Result with score, snippet, location

---

## Phase 4: Summarization

**Goal:** Generate token-efficient summaries at multiple granularities.

### 4.1: Token Counting

- Accurate token counting (tiktoken or similar)
- Budget management
- Truncation strategies

**Deliverables:**

- `countTokens(text: string): number`
- `truncateToTokens(text, limit): string`
- Model-specific tokenizers (GPT-4, Claude)

### 4.2: Section Summarization

- Extract key points from section
- Preserve structure indicators
- Configurable compression ratio

**Deliverables:**

- `summarizeSection(section, options): Summary`
- Key sentence extraction
- Heading preservation

### 4.3: Document Summarization

- Hierarchical: summarize sections, then combine
- TOC generation
- Key topics extraction

**Deliverables:**

- `summarizeDocument(doc, options): DocSummary`
- Multi-level output (100, 500, 2000 tokens)
- Topic list

### 4.4: Context Assembly

- Build LLM-ready context from multiple sources
- Priority-based inclusion
- Token budget management

**Deliverables:**

- `assembleContext(sources, budget): string`
- Source attribution
- Overflow handling (truncate vs omit)

---

## Phase 5: Analytics

**Goal:** Built-in observability for performance and usage.

### 5.1: Metrics Foundation

- Effect Metrics integration
- Counter, Gauge, Histogram types
- Metric naming conventions

**Deliverables:**

- Metrics layer setup
- Standard metric types
- Tagging (operation, status)

### 5.2: Performance Metrics

- Query latency (p50, p95, p99)
- Index build time
- Cache hit/miss rates
- Embedding API latency

**Deliverables:**

- `md_tldr_query_duration_ms` histogram
- `md_tldr_cache_hits_total` counter
- `md_tldr_index_build_duration_ms` gauge

### 5.3: Usage Metrics

- Queries per time period
- Token usage (input/output)
- Most queried documents/sections
- Search result click-through (if applicable)

**Deliverables:**

- `md_tldr_queries_total` counter
- `md_tldr_tokens_used` counter
- Query log with timestamps

### 5.4: Reporting

- Metrics export (Prometheus format)
- Simple CLI report command
- Alerting thresholds (optional)

**Deliverables:**

- `mdtldr metrics` CLI command
- JSON and text output formats
- Configurable retention

---

## Phase 6: Integration

**Goal:** Make md-tldr usable from CLI, MCP, and HumanWork.

### 6.1: CLI Tool

- `mdtldr index <dir>` — build index
- `mdtldr search <query>` — semantic search
- `mdtldr context <path>` — LLM-ready summary
- `mdtldr structure <path>` — show document structure

**Deliverables:**

- CLI with subcommands
- Output formats (text, JSON)
- Config file support

### 6.2: Daemon Mode

- `mdtldr daemon` — run as background service
- HTTP/IPC API for queries
- Auto-rebuild on changes

**Deliverables:**

- Daemon process management
- Query API (REST or IPC)
- Health check endpoint

### 6.3: MCP Server

- Expose tools for Claude integration
- `md_search` — semantic search
- `md_context` — get context for file/section
- `md_structure` — document outline

**Deliverables:**

- MCP server implementation
- Tool definitions
- Claude Desktop/Code integration docs

### 6.4: HumanWork Skills

- `hw-md-search` — search markdown in .humanwork/
- `hw-md-context` — get context for task/session
- Integration with session-history

**Deliverables:**

- Skill definitions
- Integration with existing HumanWork skills
- Documentation

---

## Progress

| Phase              | Status      | Plans | Completed |
| ------------------ | ----------- | ----- | --------- |
| 1. Core Parsing    | Not started | 4     | -         |
| 2. Index & Storage | Not started | 4     | -         |
| 3. Semantic Layer  | Not started | 5     | -         |
| 4. Summarization   | Not started | 4     | -         |
| 5. Analytics       | Not started | 4     | -         |
| 6. Integration     | Not started | 4     | -         |

**Total: 25 tasks across 6 phases**

---

## Dependencies

```
Phase 1 ─────────────────────────────────────────┐
    │                                            │
    ▼                                            │
Phase 2 ──────────────┐                          │
    │                 │                          │
    ▼                 ▼                          │
Phase 3          Phase 4                         │
    │                 │                          │
    └────────┬────────┘                          │
             ▼                                   │
         Phase 5 ◄───────────────────────────────┘
             │
             ▼
         Phase 6
```

- Phase 2 depends on Phase 1 (need parser for indexing)
- Phase 3 & 4 can parallel after Phase 2
- Phase 5 spans all (analytics hooks added throughout)
- Phase 6 integrates everything

---

_Created: 2025-01-18_
