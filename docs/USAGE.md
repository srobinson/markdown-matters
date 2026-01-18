# md-tldr Usage Guide

Complete command reference and workflows for md-tldr.

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
npm install -g md-tldr

# Or use npx
npx md-tldr --help
```

**Requirements:**
- Node.js 18+
- OpenAI API key (for semantic search only)

---

## Quick Start

```bash
# 1. Index your markdown files
mdtldr index ./docs

# 2. View structure
mdtldr tree ./docs                 # File list
mdtldr tree ./docs/README.md       # Document outline

# 3. Get LLM-ready context
mdtldr context ./docs/README.md

# 4. Enable semantic search (optional)
export OPENAI_API_KEY=sk-...
mdtldr index --embed
mdtldr search "how to authenticate"
```

---

## Commands

### index

Build or update the document index. Run this first before using other commands.

```bash
mdtldr index [path] [options]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `path` | Directory to index (default: current directory) |

**Options:**
| Option | Description |
|--------|-------------|
| `-e, --embed` | Also build semantic embeddings |
| `-w, --watch` | Watch for file changes |
| `--force` | Force full rebuild (ignore cache) |
| `--json` | Output as JSON |
| `--pretty` | Pretty-print JSON |

**Examples:**
```bash
# Index current directory
mdtldr index

# Index specific directory
mdtldr index ./docs

# Index with embeddings for semantic search
mdtldr index --embed

# Watch mode for development
mdtldr index --watch

# Force rebuild
mdtldr index --force
```

**Index location:** `.md-tldr/indexes/`

---

### search

Search by meaning (semantic) or by structure (heading patterns).

```bash
mdtldr search <query> [path] [options]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `query` | Search query (natural language or regex pattern) |
| `path` | Directory to search in (default: current directory) |

**Options:**
| Option | Description |
|--------|-------------|
| `-s, --structural` | Force structural search (heading regex) |
| `-n, --limit` | Maximum results (default: 10) |
| `--threshold` | Similarity threshold for semantic search (0-1) |
| `--json` | Output as JSON |
| `--pretty` | Pretty-print JSON |

**Auto-detection:**
- If embeddings exist AND query looks like natural language: semantic search
- If query has regex characters OR `-s` flag: structural search

**Examples:**
```bash
# Semantic search (if embeddings exist)
mdtldr search "how to authenticate"

# Structural search (heading regex)
mdtldr search "Setup|Install" -s

# Limit results
mdtldr search "api" -n 5

# Higher similarity threshold
mdtldr search "deploy" --threshold 0.8

# Search in specific directory
mdtldr search "config" ./docs
```

---

### context

Get LLM-ready context from one or more files.

```bash
mdtldr context <files...> [options]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `files...` | One or more markdown files (glob patterns supported) |

**Options:**
| Option | Description |
|--------|-------------|
| `-t, --tokens` | Token budget |
| `--brief` | Minimal output (~100 tokens) |
| `--full` | Include full content |
| `--json` | Output as JSON |
| `--pretty` | Pretty-print JSON |

**Examples:**
```bash
# Single file
mdtldr context README.md

# Multiple files
mdtldr context README.md docs/api.md docs/setup.md

# Glob patterns
mdtldr context docs/*.md

# With token budget
mdtldr context README.md -t 500

# Brief summary
mdtldr context README.md --brief

# Full content
mdtldr context README.md --full
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
mdtldr tree [path] [options]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `path` | Directory or file (default: current directory) |

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--pretty` | Pretty-print JSON |

**Auto-detection:**
- If path is a directory: shows file list
- If path is a file: shows document outline (heading hierarchy)

**Examples:**
```bash
# File list in current directory
mdtldr tree

# File list in specific directory
mdtldr tree ./docs

# Document outline
mdtldr tree README.md
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
mdtldr links <file> [options]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `file` | Markdown file to analyze |

**Options:**
| Option | Description |
|--------|-------------|
| `-r, --root` | Root directory for index (default: current) |
| `--json` | Output as JSON |
| `--pretty` | Pretty-print JSON |

**Example:**
```bash
mdtldr links docs/README.md
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
mdtldr backlinks <file> [options]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `file` | Markdown file to find links to |

**Options:**
| Option | Description |
|--------|-------------|
| `-r, --root` | Root directory for index (default: current) |
| `--json` | Output as JSON |
| `--pretty` | Pretty-print JSON |

**Example:**
```bash
mdtldr backlinks docs/api/authentication.md
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
mdtldr stats [path] [options]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `path` | Directory to show stats for (default: current) |

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--pretty` | Pretty-print JSON |

**Example:**
```bash
mdtldr stats
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

md-tldr includes an MCP server for integration with AI assistants.

### Starting the Server

```bash
mdtldr-mcp
```

### Available Tools

| Tool | Description |
|------|-------------|
| `md_search` | Semantic search across indexed documents |
| `md_context` | Get LLM-ready context for a file |
| `md_structure` | Get document structure/outline |

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "md-tldr": {
      "command": "mdtldr-mcp",
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
    "md-tldr": {
      "command": "mdtldr-mcp",
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
mdtldr tree ./docs

# 2. Check document structure
mdtldr tree docs/api.md

# 3. Get context for specific file
mdtldr context docs/api.md -t 500

# 4. Or combine multiple files
mdtldr context README.md docs/setup.md docs/api.md -t 2000
```

### Finding Related Documentation

```bash
# 1. See what a file links to
mdtldr links docs/README.md

# 2. See what links to a file
mdtldr backlinks docs/api/authentication.md

# 3. Use semantic search to find related content
mdtldr search "user authentication and session management"
```

### Keeping Index Updated

```bash
# One-time index
mdtldr index

# Watch mode during development
mdtldr index --watch

# Force full rebuild after major changes
mdtldr index --force
```

### Setting Up Semantic Search

```bash
# 1. Set API key
export OPENAI_API_KEY=sk-...

# 2. Build embeddings
mdtldr index --embed

# 3. Search by meaning
mdtldr search "how to handle authentication errors"
```

### Optimizing for Token Budget

```bash
# Check document size
mdtldr tree docs/large-doc.md

# Get brief summary
mdtldr context docs/large-doc.md --brief

# Or set explicit budget
mdtldr context docs/large-doc.md -t 200

# Combine multiple files with shared budget
mdtldr context a.md b.md c.md -t 1000
```

---

## Configuration

### Index Directory

By default, indexes are stored in `.md-tldr/` in your project root:

```
.md-tldr/
├── indexes/
│   ├── documents.json    # Document metadata
│   ├── sections.json     # Section index
│   ├── links.json        # Link graph
│   └── vectors.bin       # Embeddings
└── cache/
    └── parsed/           # Cached parsed documents
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | For semantic search | OpenAI API key |

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

Run `mdtldr index` to build the index first.

### "Semantic search not available"

1. Set `OPENAI_API_KEY` environment variable
2. Run `mdtldr index --embed` to build embedding index

### "File not found in index"

1. Check file is in indexed directory
2. Run `mdtldr index --force` to rebuild

### High token counts

- Use `--brief` for compressed output
- Use `-t <tokens>` to set explicit budget
- Use multiple files with shared budget via `context`
