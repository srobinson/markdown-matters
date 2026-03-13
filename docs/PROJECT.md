# @hw/mdm

## What This Is

Token-efficient markdown analysis for LLMs. The "TLDR for code" approach applied to markdown documents — extract structure, build relationships, enable semantic search, optimize for LLM consumption.

## Why

1. **HumanWork needs it** — Session logs, summaries, task specs are all markdown. PM turns need efficient access to Worker output.
2. **LLMs waste tokens on markdown** — Raw markdown dumps are inefficient. Structure matters.
3. **Nothing exists** — Parsers exist, embeddings exist, but no unified tool for LLM-optimized markdown retrieval.
4. **Training data** — Same indexes serve runtime retrieval AND training data preparation.

## Core Capabilities

| Capability    | Description                                                                     |
| ------------- | ------------------------------------------------------------------------------- |
| **Parse**     | Extract AST: headings, sections, lists, code blocks, links, tables, frontmatter |
| **Graph**     | Build relationships: doc→doc links, section hierarchy, backlinks                |
| **Embed**     | Semantic vectors for sections/documents                                         |
| **Summarize** | Hierarchical compression: doc → section → key points                            |
| **Search**    | Structural (find H2s) + semantic (find content about X)                         |
| **Optimize**  | Token-efficient output, context window assembly                                 |
| **Measure**   | Analytics on queries, latency, token usage                                      |

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │            mdm daemon           │
                    │  ┌─────────┐  ┌─────────────────┐  │
  Markdown ────────▶│  │ Parser  │──│ Structure Index │  │
  Files             │  └─────────┘  └─────────────────┘  │
                    │  ┌─────────┐  ┌─────────────────┐  │
                    │  │Embedder │──│  Vector Index   │  │
                    │  └─────────┘  └─────────────────┘  │
                    │  ┌─────────┐  ┌─────────────────┐  │
                    │  │Analytics│──│  Metrics Store  │  │
                    │  └─────────┘  └─────────────────┘  │
                    └─────────────────────────────────────┘
                              │           │
                    ┌─────────┴───┐   ┌───┴─────────┐
                    │   CLI API   │   │  MCP Server │
                    └─────────────┘   └─────────────┘
```

### Components

1. **Parser** — Markdown → AST → Structured sections
2. **Structure Index** — Fast lookup by path, heading, section
3. **Embedder** — Sections → Vectors (pluggable: local or API)
4. **Vector Index** — FAISS or similar for semantic search
5. **Summarizer** — Hierarchical compression engine
6. **Analytics** — Metrics collection, latency tracking
7. **Daemon** — In-memory indexes, file watching, fast queries
8. **CLI** — Command-line interface
9. **MCP Server** — Claude integration

## Tech Stack

| Component     | Choice                                       | Rationale                           |
| ------------- | -------------------------------------------- | ----------------------------------- |
| Language      | TypeScript                                   | Matches HumanWork, Effect ecosystem |
| Parser        | remark/unified                               | Battle-tested, plugin ecosystem     |
| Embeddings    | sentence-transformers (Python) or OpenAI API | Start with API, add local later     |
| Vector Store  | FAISS or hnswlib                             | Proven, fast                        |
| Metrics       | Effect Metrics                               | Native to our stack                 |
| File Watching | chokidar                                     | Standard, reliable                  |

## Non-Goals (v1)

- Multi-language support (English only initially)
- Real-time collaboration
- Web UI (CLI + MCP first)
- Custom embedding models

## Success Metrics

| Metric                   | Target                 |
| ------------------------ | ---------------------- |
| Token reduction          | 80%+ vs raw markdown   |
| Query latency (cached)   | <100ms                 |
| Index build time         | <10s for 1000 docs     |
| Semantic search accuracy | Relevant in top-3 90%+ |

---

_Created: 2025-01-18_
