# mdm Usage Guide

Complete command reference and workflows for mdm.

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
npm install -g markdown-matters

# Or use npx
npx markdown-matters --help
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
mdm index ./docs

# 2. View structure
mdm tree ./docs                 # File list
mdm tree ./docs/README.md       # Document outline

# 3. Get LLM-ready context
mdm context ./docs/README.md

# 4. Enable semantic search (optional)
# Choose ONE provider:

# Option A: OpenAI (cloud, requires API key)
export OPENAI_API_KEY=sk-...
mdm index --embed

# Option B: Ollama (free, local, no API key needed)
ollama serve && ollama pull nomic-embed-text
mdm index --embed --provider ollama --provider-model nomic-embed-text

# Option C: LM Studio (free, local, no API key needed)
# Start LM Studio, load an embedding model, then:
mdm index --embed --provider lm-studio

# Then search by meaning:
mdm search "how to authenticate"
```

---

## Commands

### index

Build or update the document index. Run this first before using other commands.

```bash
mdm index [path] [options]
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
mdm index

# Index specific directory
mdm index ./docs

# Index with embeddings for semantic search
mdm index --embed

# Watch mode for development
mdm index --watch

# Force rebuild
mdm index --force
```

**Index location:** `.mdm/indexes/`

---

### search

Search by meaning (semantic) or by structure (heading patterns).

```bash
mdm search [options] <query> [path]
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
mdm search "how to authenticate"

# Keyword search (exact text match)
mdm search -k "Setup|Install"

# Limit results
mdm search -n 5 "api"

# Higher similarity threshold
mdm search --threshold 0.8 "deploy"

# Search in specific directory
mdm search "config" ./docs
```

---

### context

Get LLM-ready context from one or more files.

```bash
mdm context [options] <files...>
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
mdm context README.md

# Multiple files
mdm context README.md docs/api.md docs/setup.md

# Glob patterns
mdm context docs/*.md

# With token budget
mdm context -t 500 README.md

# Brief summary
mdm context --brief README.md

# Full content
mdm context --full README.md
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
mdm tree [path] [options]
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
mdm tree

# File list in specific directory
mdm tree ./docs

# Document outline
mdm tree README.md
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
mdm links <file> [options]
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
mdm links docs/README.md
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
mdm backlinks <file> [options]
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
mdm backlinks docs/api/authentication.md
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
mdm stats [path] [options]
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
mdm stats
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

mdm includes an MCP server for integration with AI assistants.

### Starting the Server

```bash
mdm-mcp
```

### Available Tools

| Tool               | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| `md_search`        | Semantic search by meaning; returns relevant sections        |
| `md_context`       | Token-compressed file summaries at `brief`, `summary`, or `full` detail |
| `md_structure`     | Heading hierarchy with token counts                          |
| `md_keyword_search`| Structural search by heading, code, list, or table presence  |
| `md_index`         | Build or rebuild the index                                   |
| `md_links`         | Outgoing links from a file                                   |
| `md_backlinks`     | Incoming links to a file                                     |

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mdm": {
      "command": "mdm-mcp",
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
    "mdm": {
      "command": "mdm-mcp",
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
mdm tree ./docs

# 2. Check document structure
mdm tree docs/api.md

# 3. Get context for specific file
mdm context -t 500 docs/api.md

# 4. Or combine multiple files
mdm context -t 2000 README.md docs/setup.md docs/api.md
```

### Finding Related Documentation

```bash
# 1. See what a file links to
mdm links docs/README.md

# 2. See what links to a file
mdm backlinks docs/api/authentication.md

# 3. Use semantic search to find related content
mdm search "user authentication and session management"
```

### Keeping Index Updated

```bash
# One-time index
mdm index

# Watch mode during development
mdm index --watch

# Force full rebuild after major changes
mdm index --force
```

### Setting Up Semantic Search

```bash
# 1. Set API key
export OPENAI_API_KEY=sk-...

# 2. Build embeddings
mdm index --embed

# 3. Search by meaning
mdm search "how to handle authentication errors"
```

### Optimizing for Token Budget

```bash
# Check document size
mdm tree docs/large-doc.md

# Get brief summary
mdm context docs/large-doc.md --brief

# Or set explicit budget
mdm context -t 200 docs/large-doc.md

# Combine multiple files with shared budget
mdm context -t 1000 a.md b.md c.md
```

---

## Configuration

mdm supports a layered configuration system with files, environment variables, and CLI flags.

**Quick start:**

```bash
# Create a config file
mdm config init

# Check current configuration
mdm config check
```

**For full configuration documentation, see [CONFIG.md](./CONFIG.md).**

### Index Directory

By default, indexes are stored in `.mdm/` in your project root:

```
.mdm/
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

Run `mdm index` to build the index first.

### "Semantic search not available"

1. Set up an embedding provider:
   - **OpenAI (cloud):** Set `OPENAI_API_KEY` environment variable
   - **OpenRouter (cloud):** Set `OPENROUTER_API_KEY` environment variable
   - **Ollama (free, local):** Run `ollama serve` (no API key needed)
   - **LM Studio (free, local):** Start the server GUI (no API key needed)
2. Run `mdm index --embed` to build embedding index
   - For local providers: `mdm index --embed --provider ollama`
3. See [CONFIG.md](./CONFIG.md) for detailed provider setup

### "File not found in index"

1. Check file is in indexed directory
2. Run `mdm index --force` to rebuild

### High token counts

- Use `--brief` for compressed output
- Use `-t <tokens>` to set explicit budget
- Use multiple files with shared budget via `context`
