# mdcontext Usage Guide

Complete command reference and workflows for mdcontext.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
  - [index](#index)
  - [search](#search)
  - [context](#context)
  - [tree](#tree)
  - [links](#links)
  - [backlinks](#backlinks)
  - [stats](#stats)
- [MCP Server](#mcp-server)
- [Workflows](#workflows)
- [Configuration](#configuration)

---

## Installation

```bash
# Global install
npm install -g mdcontext

# Or use npx
npx mdcontext --help
```

**Requirements:**

- Node.js 18+
- Embedding provider for semantic search (see [CONFIG.md](./CONFIG.md) for options):
  - OpenAI or OpenRouter (cloud, requires API key)
  - Ollama or LM Studio (free, local, no API key needed)

---

## Quick Start

```bash
# 1. Index your markdown files
mdcontext index ./docs

# 2. View structure
mdcontext tree ./docs                 # File list
mdcontext tree ./docs/README.md       # Document outline

# 3. Get LLM-ready context
mdcontext context ./docs/README.md

# 4. Enable semantic search (optional)
# Choose ONE provider:

# Option A: OpenAI (cloud, requires API key)
export OPENAI_API_KEY=sk-...
mdcontext index --embed

# Option B: Ollama (free, local, no API key needed)
ollama serve && ollama pull nomic-embed-text
mdcontext index --embed --provider ollama --provider-model nomic-embed-text

# Option C: LM Studio (free, local, no API key needed)
# Start LM Studio, load an embedding model, then:
mdcontext index --embed --provider lm-studio

# Then search by meaning:
mdcontext search "how to authenticate"
```

---

## Commands

### index

Build or update the document index. Run this first before using other commands.

```bash
mdcontext index [path] [options]
```

**Arguments:**

| Argument | Description                                     |
| -------- | ----------------------------------------------- |
| `path`   | Directory to index (default: current directory) |

**Options:**

| Option        | Description                       |
| ------------- | --------------------------------- |
| `-e, --embed` | Also build semantic embeddings    |
| `-w, --watch` | Watch for file changes            |
| `--force`     | Force full rebuild (ignore cache) |
| `--json`      | Output as JSON                    |
| `--pretty`    | Pretty-print JSON                 |

**Examples:**

```bash
# Index current directory
mdcontext index

# Index specific directory
mdcontext index ./docs

# Index with embeddings for semantic search
mdcontext index --embed

# Watch mode for development
mdcontext index --watch

# Force rebuild
mdcontext index --force
```

**Index location:** `.mdcontext/indexes/`

---

### search

Search by meaning (semantic) or by structure (heading patterns).

```bash
mdcontext search [options] <query> [path]
```

**Arguments:**

| Argument | Description                                         |
| -------- | --------------------------------------------------- |
| `query`  | Search query (natural language or regex pattern)    |
| `path`   | Directory to search in (default: current directory) |

**Options:**

| Option          | Description                                    |
| --------------- | ---------------------------------------------- |
| `-k, --keyword` | Force keyword search (exact text match)        |
| `-n, --limit`   | Maximum results (default: 10)                  |
| `--threshold`   | Similarity threshold for semantic search (0-1) |
| `--json`        | Output as JSON                                 |
| `--pretty`      | Pretty-print JSON                              |

**Auto-detection:**

- If embeddings exist AND query looks like natural language: semantic search
- If query has regex characters OR `-k` flag: keyword search

**Examples:**

```bash
# Semantic search (if embeddings exist)
mdcontext search "how to authenticate"

# Keyword search (exact text match)
mdcontext search -k "Setup|Install"

# Limit results
mdcontext search -n 5 "api"

# Higher similarity threshold
mdcontext search --threshold 0.8 "deploy"

# Search in specific directory
mdcontext search "config" ./docs
```

---

### context

Get LLM-ready context from one or more files.

```bash
mdcontext context [options] <files...>
```

**Arguments:**

| Argument   | Description                                          |
| ---------- | ---------------------------------------------------- |
| `files...` | One or more markdown files (glob patterns supported) |

**Options:**

| Option         | Description                  |
| -------------- | ---------------------------- |
| `-t, --tokens` | Token budget                 |
| `--brief`      | Minimal output (~100 tokens) |
| `--full`       | Include full content         |
| `--json`       | Output as JSON               |
| `--pretty`     | Pretty-print JSON            |

**Examples:**

```bash
# Single file
mdcontext context README.md

# Multiple files
mdcontext context README.md docs/api.md docs/setup.md

# Glob patterns
mdcontext context docs/*.md

# With token budget
mdcontext context -t 500 README.md

# Brief summary
mdcontext context --brief README.md

# Full content
mdcontext context --full README.md
```

**Output includes:**

- Document title and path
- Section summaries (respecting token budget)
- Token count
- Metadata markers for code, tables, etc.

---

### tree

Display file structure or document outline.

```bash
mdcontext tree [path] [options]
```

**Arguments:**

| Argument | Description                                    |
| -------- | ---------------------------------------------- |
| `path`   | Directory or file (default: current directory) |

**Options:**

| Option     | Description       |
| ---------- | ----------------- |
| `--json`   | Output as JSON    |
| `--pretty` | Pretty-print JSON |

**Auto-detection:**

- If path is a directory: shows file list
- If path is a file: shows document outline (heading hierarchy)

**Examples:**

```bash
# File list in current directory
mdcontext tree

# File list in specific directory
mdcontext tree ./docs

# Document outline
mdcontext tree README.md
```

**Directory output:**

```
docs/
├── README.md (2,450 tokens)
├── api/
│   ├── endpoints.md (1,200 tokens)
│   └── authentication.md (890 tokens)
└── guides/
    └── getting-started.md (1,560 tokens)
```

**File output:**

```
# API Reference (450 tokens)
  ## Authentication (120 tokens)
    ### OAuth Flow (45 tokens)
    ### API Keys (35 tokens)
  ## Endpoints (280 tokens)
    ### Users (95 tokens)
    ### Products (105 tokens)
```

---

### links

Show outgoing links from a file.

```bash
mdcontext links <file> [options]
```

**Arguments:**

| Argument | Description              |
| -------- | ------------------------ |
| `file`   | Markdown file to analyze |

**Options:**

| Option       | Description                                 |
| ------------ | ------------------------------------------- |
| `-r, --root` | Root directory for index (default: current) |
| `--json`     | Output as JSON                              |
| `--pretty`   | Pretty-print JSON                           |

**Example:**

```bash
mdcontext links docs/README.md
```

**Output:**

```
Internal Links:
  → ./getting-started.md (Getting Started)
  → ./api/endpoints.md (API Reference)
  → #installation (Installation)

External Links:
  → https://github.com/example (GitHub)
```

---

### backlinks

Show files that link to a specific file.

```bash
mdcontext backlinks <file> [options]
```

**Arguments:**

| Argument | Description                    |
| -------- | ------------------------------ |
| `file`   | Markdown file to find links to |

**Options:**

| Option       | Description                                 |
| ------------ | ------------------------------------------- |
| `-r, --root` | Root directory for index (default: current) |
| `--json`     | Output as JSON                              |
| `--pretty`   | Pretty-print JSON                           |

**Example:**

```bash
mdcontext backlinks docs/api/authentication.md
```

**Output:**

```
Files linking to docs/api/authentication.md:
  ← docs/README.md (in section "Quick Start")
  ← docs/guides/getting-started.md (in section "Authentication")
```

---

### stats

Show index statistics.

```bash
mdcontext stats [path] [options]
```

**Arguments:**

| Argument | Description                                    |
| -------- | ---------------------------------------------- |
| `path`   | Directory to show stats for (default: current) |

**Options:**

| Option     | Description       |
| ---------- | ----------------- |
| `--json`   | Output as JSON    |
| `--pretty` | Pretty-print JSON |

**Example:**

```bash
mdcontext stats
```

**Output:**

```
Index Statistics:
  Documents: 23
  Sections: 156
  Total tokens: 45,230
  Links: 89 (67 internal, 22 external)
  Code blocks: 34
  Embeddings: 156 (100%)
  Last updated: 2024-01-15 10:30:00
```

---

## MCP Server

mdcontext includes an MCP server for integration with AI assistants.

### Starting the Server

```bash
mdcontext-mcp
```

### Available Tools

| Tool           | Description                              |
| -------------- | ---------------------------------------- |
| `md_search`    | Semantic search across indexed documents |
| `md_context`   | Get LLM-ready context for a file         |
| `md_structure` | Get document structure/outline           |

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mdcontext": {
      "command": "mdcontext-mcp",
      "args": []
    }
  }
}
```

### Claude Code Configuration

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "mdcontext": {
      "command": "mdcontext-mcp",
      "args": []
    }
  }
}
```

---

## Workflows

### Adding Documentation to LLM Context

```bash
# 1. See what's available
mdcontext tree ./docs

# 2. Check document structure
mdcontext tree docs/api.md

# 3. Get context for specific file
mdcontext context -t 500 docs/api.md

# 4. Or combine multiple files
mdcontext context -t 2000 README.md docs/setup.md docs/api.md
```

### Finding Related Documentation

```bash
# 1. See what a file links to
mdcontext links docs/README.md

# 2. See what links to a file
mdcontext backlinks docs/api/authentication.md

# 3. Use semantic search to find related content
mdcontext search "user authentication and session management"
```

### Keeping Index Updated

```bash
# One-time index
mdcontext index

# Watch mode during development
mdcontext index --watch

# Force full rebuild after major changes
mdcontext index --force
```

### Setting Up Semantic Search

```bash
# 1. Set API key
export OPENAI_API_KEY=sk-...

# 2. Build embeddings
mdcontext index --embed

# 3. Search by meaning
mdcontext search "how to handle authentication errors"
```

### Optimizing for Token Budget

```bash
# Check document size
mdcontext tree docs/large-doc.md

# Get brief summary
mdcontext context docs/large-doc.md --brief

# Or set explicit budget
mdcontext context -t 200 docs/large-doc.md

# Combine multiple files with shared budget
mdcontext context -t 1000 a.md b.md c.md
```

---

## Configuration

mdcontext supports a layered configuration system with files, environment variables, and CLI flags.

**Quick start:**

```bash
# Create a config file
mdcontext config init

# Check current configuration
mdcontext config check
```

**For full configuration documentation, see [CONFIG.md](./CONFIG.md).**

### Index Directory

By default, indexes are stored in `.mdcontext/` in your project root:

```
.mdcontext/
├── indexes/
│   ├── documents.json    # Document metadata
│   ├── sections.json     # Section index
│   ├── links.json        # Link graph
│   └── vectors.bin       # Embeddings
└── cache/
    └── parsed/           # Cached parsed documents
```

### Environment Variables

| Variable             | Required                    | Description                          |
| -------------------- | --------------------------- | ------------------------------------ |
| `OPENAI_API_KEY`     | For OpenAI provider         | OpenAI API key (cloud provider)      |
| `OPENROUTER_API_KEY` | For OpenRouter provider     | OpenRouter API key (cloud provider)  |
| N/A                  | Ollama / LM Studio          | Local providers - no API key needed  |

All configuration options can also be set via `MDM_*` environment variables. See [CONFIG.md](./CONFIG.md#environment-variables) for the complete reference.

### Supported File Types

- `.md` - Markdown
- `.mdx` - MDX (treated as markdown)

### GFM Features Supported

- Tables
- Task lists (`- [ ]`, `- [x]`)
- Strikethrough
- Autolinks
- YAML frontmatter

---

## Troubleshooting

### "No index found"

Run `mdcontext index` to build the index first.

### "Semantic search not available"

1. Set up an embedding provider:
   - **OpenAI (cloud):** Set `OPENAI_API_KEY` environment variable
   - **OpenRouter (cloud):** Set `OPENROUTER_API_KEY` environment variable
   - **Ollama (free, local):** Run `ollama serve` (no API key needed)
   - **LM Studio (free, local):** Start the server GUI (no API key needed)
2. Run `mdcontext index --embed` to build embedding index
   - For local providers: `mdcontext index --embed --provider ollama`
3. See [CONFIG.md](./CONFIG.md) for detailed provider setup

### "File not found in index"

1. Check file is in indexed directory
2. Run `mdcontext index --force` to rebuild

### High token counts

- Use `--brief` for compressed output
- Use `-t <tokens>` to set explicit budget
- Use multiple files with shared budget via `context`
