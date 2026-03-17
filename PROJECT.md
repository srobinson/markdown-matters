# markdown-matters

**Version:** 0.3.0
**License:** MIT
**Node:** >= 18.0.0
**Package:** `markdown-matters` on npm

Token-efficient markdown analysis and search for LLM consumption. Parses documentation into structured indexes, then serves content via a CLI or an MCP server, respecting token budgets.

---

## What it does

markdown-matters ingests a directory of markdown files and builds three queryable artifacts:

1. **Structural indexes** (documents, sections, links) stored as JSON in `.mdm/`
2. **BM25 keyword index** for exact-term and boolean search
3. **HNSW vector index** for embedding-based semantic search (optional, requires an embedding provider)

Consumers retrieve content through either the `mdm` CLI or the `mdm-mcp` MCP server. Both interfaces share the same underlying indexes; the CLI formats output for humans, the MCP server formats it for AI agents.

---

## Interfaces

### CLI (`mdm`)

| Command | Description |
|---|---|
| `index` | Index markdown files; optionally build embeddings (`--embed`) |
| `search` | Search by keyword, semantic, or hybrid mode |
| `context` | Emit token-budget-aware compressed summaries of a file |
| `tree` | Show document heading outline or directory listing |
| `links` | Show outgoing links from a file |
| `backlinks` | Show incoming links to a file |
| `duplicates` | Detect duplicate content across files |
| `stats` | Show index statistics (documents, sections, tokens, embeddings) |
| `config` | Manage configuration (`init`, `show`, `check`) |
| `embeddings` | Manage embedding namespaces (`list`, `switch`, `remove`, `current`) |

### MCP Server (`mdm-mcp`)

Exposes 7 tools over stdio transport for Claude and other MCP clients.

| Tool | Description |
|---|---|
| `md_search` | Semantic search by meaning; returns relevant sections |
| `md_context` | Token-compressed file summaries at `full`, `summary`, or `brief` detail |
| `md_structure` | Heading hierarchy with token counts |
| `md_keyword_search` | Structural search by heading, code, list, or table presence |
| `md_index` | Build or rebuild the index |
| `md_links` | Outgoing links from a file |
| `md_backlinks` | Incoming links to a file |

---

## Architecture

### Indexing pipeline

```
Directory walk
  -> File filtering (.gitignore / .mdmignore / mtime cache)
  -> remark AST parse + gray-matter frontmatter extraction
  -> Section extraction (heading hierarchy, line ranges, token counts)
  -> Parallel writes:
       .mdm/indexes/documents.json
       .mdm/indexes/sections.json
       .mdm/indexes/links.json
       .mdm/bm25.json
  -> Optional: embedding batches -> HNSW build
       .mdm/embeddings/{namespace}/vectors.bin
```

Parsed ASTs are cached in `.mdm/cache/parsed/` so unchanged files are skipped on subsequent runs. SHA256 hashes detect silent content changes alongside mtime checks.

### Search pipeline

**Keyword (BM25)**
- Full boolean query parser: AND, OR, NOT, parentheses, quoted phrases
- ReDoS validation before regex compilation
- Fuzzy matching with match-context line extraction (grep-style `-A`, `-B`, `-C` flags)

**Semantic (HNSW)**
- Optional query preprocessing (normalize, lowercase) for improved recall
- Optional HyDE expansion: generates a hypothetical answer document, then embeds it as the query vector, improving complex queries by 10-30% at 1-2s latency cost
- Configurable search quality: `fast` (efSearch=64), `balanced` (100), `thorough` (256)
- Per-heading and per-file importance boosts applied post-search

**Hybrid**
- Runs BM25 and semantic in parallel
- Merges via Reciprocal Rank Fusion: `score = sum(weight / (k + rank))`, k=60
- Optional cross-encoder re-ranking for a further precision lift (~20-35%)

### Embedding providers

| Provider | Model | Dimensions |
|---|---|---|
| OpenAI | text-embedding-3-small / 3-large | 384 / 3072 |
| Voyage AI | voyage-3 | 1024 |
| Ollama | configurable | configurable |
| LM Studio | configurable | configurable |
| OpenRouter | configurable | configurable |

Namespaced storage isolates vector indexes per provider+model combination. Dimension mismatches are detected at load time with typed errors before any search occurs.

### Summarization

Search results can be passed through an AI summarizer. Two execution modes:

- **CLI mode**: spawns `claude` or `copilot` as subprocesses (free, no API key required)
- **API mode**: calls OpenAI, Anthropic, or other providers via Vercel AI SDK

---

## Tech stack

| Concern | Library |
|---|---|
| CLI framework | `@effect/cli` + `@effect/platform-node` |
| Functional runtime | `effect` (services, errors, config, DI) |
| MCP server | `@modelcontextprotocol/sdk` |
| Markdown parsing | `remark` + `remark-gfm` + `unified` |
| Frontmatter | `gray-matter` |
| Token counting | `tiktoken` |
| Keyword search | `wink-bm25-text-search` |
| Vector search | `hnswlib-node` (native HNSW) |
| Binary serialization | `@msgpack/msgpack` |
| File watching | `chokidar` |
| Build | `tsup` (ESM only) |
| Test | `vitest` |
| Lint/format | `@biomejs/biome` |
| Releases | `release-please` |

---

## Configuration

Config resolves in this precedence order:

1. CLI flags
2. Environment variables
3. `.mdm.toml` in the project root
4. Built-in defaults

Key configurable surfaces:

- **Index**: `maxDepth`, `excludePatterns`, `fileExtensions`, `followSymlinks`
- **Search**: `defaultLimit`, `minSimilarity` (default 0.35), `includeSnippets`
- **Embeddings**: `provider`, `model`, `baseURL`, `batchSize`, `dimensions`
- **Summarization**: `budgetTokens`, `truncationStrategy`, `mode`, `model`
- **Output**: `verbose`, `debug`, `noColor`, `format`

Full reference: `docs/CONFIG.md`

---

## Error model

All errors are typed via Effect's `Data.TaggedError`. Error codes follow a domain taxonomy:

| Range | Domain |
|---|---|
| E1xx | File system |
| E2xx | Parsing |
| E3xx | API / auth |
| E4xx | Index |
| E5xx | Search |
| E6xx | Vector store |
| E7xx | Config |
| E8xx | Watch |
| E9xx | CLI validation |

Technical detail lives in the `message` field. User-facing text is generated only at the CLI boundary.

---

## Repository layout

```
src/
  cli/           CLI commands, argument handling, help, error formatting
  mcp/           MCP server, tool definitions, handlers, adapters
  index/         Indexer, storage, document/section/link types
  parser/        remark pipeline, section extraction, section filtering
  search/        BM25, semantic, hybrid search, RRF, re-ranking, query parser
  embeddings/    Provider abstraction, HNSW store, namespacing, HyDE, ranking
  summarization/ CLI and API summarizer provider implementations
  summarize/     Summarization orchestration
  config/        Schema, file loader, precedence, Effect service layer
  errors/        Typed error catalog
  duplicates/    Duplicate content detection
  utils/         Shared utilities
  types/         Shared TypeScript types
tests/           Integration tests (search-context, search-semantic, embed-index)
docs/            Extended documentation (CONFIG, DESIGN, ROADMAP, ERRORS, USAGE)
scripts/         Build and utility scripts
```

---

## Development

```bash
pnpm install
pnpm build          # compile to dist/ (ESM only)
pnpm test           # run integration tests
pnpm test:all       # include semantic tests (requires OPENAI_API_KEY)
pnpm check          # format + lint + typecheck
```

Semantic tests are skipped unless `OPENAI_API_KEY` is set or `INCLUDE_EMBED_TESTS=true`. Set `REBUILD_TEST_INDEX=true` to force index regeneration before tests.

---

## Related

Part of the [Helioy](https://github.com/helioy) ecosystem.

| Component | Role |
|---|---|
| `attention-matters` | Geometric memory engine |
| `fmm` | Code structural intelligence |
| `nancyr` | Multi-agent orchestrator (Rust) |
| `helioy-plugins` | Claude Code plugin |
| `helioy-bus` | Inter-agent message bus |
