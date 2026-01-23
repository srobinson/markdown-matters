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
- [x] `mdtldr parse <file>` outputs structured JSON (sections, headings, code blocks, links)
- [x] `mdtldr tree <dir>` shows markdown file structure
- [x] `mdtldr structure <file>` shows document outline (heading hierarchy)
- [x] Handles GFM (tables, task lists) and YAML frontmatter
- [x] Token count estimation for each section
- [x] Tests pass, builds successfully

### Phase 2: Index + Storage
- [x] `.md-tldr/` directory stores persistent indexes
- [x] `mdtldr index <dir>` builds document/section/link indexes
- [x] Incremental updates (only re-index changed files via hash/mtime)
- [x] `mdtldr links <file>` shows outgoing links
- [x] `mdtldr backlinks <file>` shows incoming links
- [x] File watching with `mdtldr index --watch`

### Phase 3: Structural Search
- [x] `mdtldr search --heading "pattern"` finds sections by heading
- [x] `mdtldr search --path "*.md"` filters by file path
- [x] `mdtldr search --has-code` finds sections with code blocks
- [x] `mdtldr context <file>` outputs LLM-ready summary (token-efficient)
- [x] JSON output mode for all commands (`--json`)

### Phase 4: Semantic Search
- [x] Section-level embeddings with OpenAI text-embedding-3-small
- [x] `mdtldr search "natural language query"` performs semantic search
- [x] Vector index persistence (FAISS or hnswlib)
- [x] Similarity threshold and limit options
- [x] Cost tracking for embedding API calls

### Phase 5: Summarization Engine
- [x] `mdtldr summarize <file>` generates hierarchical summary
- [x] Multiple compression levels: brief (100 tokens), summary (500), full
- [x] `mdtldr context <file> --tokens 500` respects token budget
- [x] `mdtldr context --sources <file1> <file2> --budget 2000` assembles multi-doc context
- [x] Achieves 80%+ token reduction vs raw markdown

### Phase 6: MCP Server
- [x] `mdtldr-mcp` exposes tools for Claude integration
- [x] `md_search` tool for semantic search
- [x] `md_context` tool for LLM-ready summaries
- [x] `md_structure` tool for document outlines
- [x] Works with Claude Desktop and Claude Code

### Phase 7: Quality & Documentation (REQUIRED)
- [x] `npm run check` passes (format + lint + typecheck)
- [x] `npm run test` passes with collocated tests
- [x] Tests are collocated (e.g., `src/parser/parser.test.ts` next to `parser.ts`)
- [x] README.md - Professional, AI-engineer focused (see reference below)
- [x] docs/USAGE.md - Detailed command reference and examples

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
             │
             ▼
         Phase 7 (Quality + Docs)
```

### Reference Implementation
See `/Users/alphab/Dev/LLM/DEV/llm-tldr` for architectural patterns:
- Daemon architecture
- MCP server implementation
- CLI structure
- `.tldrignore` pattern

### README Requirements
**Reference:** `/Users/alphab/Dev/LLM/DEV/llm-tldr/README.md`

Write for **AI engineers**, not marketing. Structure:
1. **One-liner** - Install + index + query in one command
2. **Problem statement** - Why raw markdown wastes tokens
3. **How it works** - ASCII architecture diagram showing the pipeline
4. **Quick examples** - Real commands, real output
5. **Command reference** - Tables, not prose
6. **MCP integration** - Claude Desktop + Claude Code config
7. **Configuration** - `.mdtldrignore`, settings
8. **Performance** - Token savings metrics

**Tone:**
- Technical, direct
- No marketing fluff ("revolutionary", "game-changing")
- Show, don't tell
- Code examples over explanations

**docs/ structure:**
```
docs/
  USAGE.md      # Detailed command reference + workflows
```

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
- **Phase 7 complete**: Quality gates pass, README.md + docs/USAGE.md exist

---

_Created: 2025-01-19_
