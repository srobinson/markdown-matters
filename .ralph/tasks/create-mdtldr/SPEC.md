# Task: create-mdtldr

## Goal

Build **md-tldr**: A token-efficient markdown analysis tool for LLM consumption. The "TLDR for markdown" — extract structure, build relationships, enable semantic search, optimize for LLM context windows.

**Think of it as llm-tldr's markdown sibling.** Where llm-tldr analyzes code (AST, call graphs, data flow), md-tldr analyzes markdown (sections, links, summaries).

## Naming Convention

| Context | Name | Example |
|---------|------|---------|
| Package/repo | `md-tldr` | `npm install md-tldr` |
| CLI command | `mdtldr` | `mdtldr index .` |
| Config directory | `.md-tldr/` | `.md-tldr/indexes/` |
| Metric prefix | `mdtldr_` | `mdtldr_query_duration_ms` |

## Why This Matters

1. **LLMs waste tokens on raw markdown** — Structure matters, raw dumps don't
2. **Nothing exists** — Parsers exist, embeddings exist, but no unified local-first tool for LLM-optimized markdown retrieval
3. **HumanWork needs it** — Session logs, task specs, documentation are all markdown
4. **Training data** — Same indexes serve runtime AND training data prep

## Success Criteria

### Phase 1: Core Parser + CLI (MVP)
- [ ] `mdtldr parse <file>` outputs structured JSON (sections, headings, code blocks, links)
- [ ] `mdtldr tree <dir>` shows markdown file structure
- [ ] `mdtldr structure <file>` shows document outline (heading hierarchy)
- [ ] Handles GFM (tables, task lists) and YAML frontmatter
- [ ] Token count estimation for each section
- [ ] Tests pass, builds successfully

### Phase 2: Index + Storage
- [ ] `.md-tldr/` directory stores persistent indexes
- [ ] `mdtldr index <dir>` builds document/section/link indexes
- [ ] Incremental updates (only re-index changed files via hash/mtime)
- [ ] `mdtldr links <file>` shows outgoing links
- [ ] `mdtldr backlinks <file>` shows incoming links
- [ ] File watching with `mdtldr index --watch`

### Phase 3: Structural Search
- [ ] `mdtldr search --heading "pattern"` finds sections by heading
- [ ] `mdtldr search --path "*.md"` filters by file path
- [ ] `mdtldr search --has-code` finds sections with code blocks
- [ ] `mdtldr context <file>` outputs LLM-ready summary (token-efficient)
- [ ] JSON output mode for all commands (`--json`)

### Phase 4: Semantic Search
- [ ] Section-level embeddings with OpenAI text-embedding-3-small
- [ ] `mdtldr search "natural language query"` performs semantic search
- [ ] Vector index persistence (FAISS or hnswlib)
- [ ] Similarity threshold and limit options
- [ ] Cost tracking for embedding API calls

### Phase 5: Summarization Engine
- [ ] `mdtldr summarize <file>` generates hierarchical summary
- [ ] Multiple compression levels: brief (100 tokens), summary (500), full
- [ ] `mdtldr context <file> --tokens 500` respects token budget
- [ ] `mdtldr context --sources <file1> <file2> --budget 2000` assembles multi-doc context
- [ ] Achieves 80%+ token reduction vs raw markdown

### Phase 6: MCP Server
- [ ] `mdtldr-mcp` exposes tools for Claude integration
- [ ] `md_search` tool for semantic search
- [ ] `md_context` tool for LLM-ready summaries
- [ ] `md_structure` tool for document outlines
- [ ] Works with Claude Desktop and Claude Code

## Constraints

- **TypeScript + Effect** — Matches HumanWork ecosystem
- **Local-first** — No cloud services required (except optional embedding API)
- **CLI-first** — MCP comes after CLI works
- **Pluggable embeddings** — Start with OpenAI API, architecture supports local later
- **No web UI** — CLI + MCP only for v1

## Testing & Quality Control

### Collocated Tests
Tests live next to source files:
```
src/
  parser/
    parser.ts
    parser.test.ts      # ← collocated
  index/
    index.ts
    index.test.ts
```

### Required Scripts
Package.json must have these scripts (similar to HumanWork):
```json
{
  "scripts": {
    "build": "tsup src/cli.ts --format esm --dts",
    "typecheck": "tsc --noEmit",
    "lint": "biome lint --write .",
    "format": "biome format --write . && biome check --write .",
    "check": "pnpm format && pnpm lint && pnpm typecheck",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Quality Gates
Before completing any phase:
1. `npm run check` must pass (format + lint + typecheck)
2. `npm run test` must pass
3. No skipped or failing tests

### Dev Dependencies (minimum)
- `vitest` — Test runner
- `@biomejs/biome` — Linting + formatting
- `typescript` — Type checking
- `tsup` — Build tool

## Technical Decisions

### Stack
| Component | Choice | Rationale |
|-----------|--------|-----------|
| Parser | remark/unified | Battle-tested, plugin ecosystem |
| Embeddings | OpenAI text-embedding-3-small | Good quality, cheap, pluggable |
| Vector Store | hnswlib-node | Pure JS bindings, no Python dependency |
| File Watching | chokidar | Standard, reliable |
| Token Counting | tiktoken | Accurate for GPT/Claude |

### Data Model (from DESIGN.md)
- `MdDocument` → sections, links, codeBlocks, metadata
- `MdSection` → heading, level, content, children (recursive)
- `MdLink` → type (internal/external/image), href, sectionId

### Index Structure
```
.md-tldr/
  config.json
  indexes/
    documents.json    # path → document metadata
    sections.json     # section lookup by heading
    links.json        # forward + backward links
    vectors.bin       # embedding vectors
    vectors.meta.json # vector ID → section ID
  cache/
    parsed/           # cached parsed documents
```

## Notes for Implementation

### Error Handling
Define explicit error types:
```typescript
type ParseError = { _tag: "ParseError"; message: string; line?: number }
type IndexError = { _tag: "IndexError"; cause: "DiskFull" | "Permission" | "Corrupted" }
type EmbedError = { _tag: "EmbedError"; cause: "RateLimit" | "ApiKey" | "Network" }
```

### Metric Naming
Use consistent prefix: `mdtldr_` (no underscores in middle)
- `mdtldr_parse_duration_ms`
- `mdtldr_query_duration_ms`
- `mdtldr_cache_hits_total`

**Note:** The existing docs (ROADMAP.md) use inconsistent `md_tldr_*` naming — fix during implementation.

### Phase Dependencies
```
Phase 1 ──────────────────────────┐
    │                             │
    ▼                             │
Phase 2 ──────────────┐           │
    │                 │           │
    ▼                 ▼           │
Phase 3          Phase 4          │
    │                 │           │
    └────────┬────────┘           │
             ▼                    │
         Phase 5 ◄────────────────┘
             │
             ▼
         Phase 6
```

### Reference Implementation
See `/Users/alphab/Dev/LLM/DEV/llm-tldr` for architectural patterns:
- Daemon architecture
- MCP server implementation
- CLI structure
- `.tldrignore` pattern

### Project Location
Standalone project at `/Users/alphab/Dev/LLM/DEV/md-tldr` (not part of HumanWork monorepo).

## Definition of Done

Each phase is complete when:
1. All success criteria for that phase pass
2. `npm run check` passes (format + lint + typecheck)
3. `npm run test` passes with collocated tests for new code
4. CLI commands work end-to-end
5. Documentation updated (--help works)

Final acceptance:
- Can index a 1000-doc markdown directory in <10s
- Semantic search returns relevant results in top-3 90%+ of time
- Token reduction of 80%+ achieved
- MCP server works with Claude Code

---

_Created: 2025-01-19_
