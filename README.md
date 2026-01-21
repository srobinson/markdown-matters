# md-tldr

**Give LLMs exactly the markdown they need. Nothing more.**

```
QUICK REFERENCE
  mdtldr index [path]           Index markdown files (add --embed for semantic search)
  mdtldr search <query> [path]  Search by meaning or structure
  mdtldr context <files...>     Get LLM-ready summary
  mdtldr tree [path|file]       Show files or document outline
  mdtldr links <file>           Outgoing links
  mdtldr backlinks <file>       Incoming links
  mdtldr stats [path]           Index statistics
```

---

## Why?

Your documentation is 50K tokens of markdown. LLM context windows are limited. Raw markdown dumps waste tokens on structure, headers, and noise.

md-tldr extracts *structure* instead of dumping *text*. The result: **80%+ fewer tokens** while preserving everything needed to understand your docs.

```bash
npm install -g md-tldr
mdtldr index .                     # Index your docs
mdtldr search "authentication"     # Find by meaning
mdtldr context README.md           # Get LLM-ready summary
```

---

## Installation

```bash
npm install -g md-tldr
```

Requires Node.js 18+. Semantic search requires `OPENAI_API_KEY`.

---

## Commands

### index

Index markdown files. Run this first.

```bash
mdtldr index                       # Index current directory
mdtldr index ./docs                # Index specific path
mdtldr index --embed               # Also build embeddings for semantic search
mdtldr index --watch               # Watch for changes
mdtldr index --force               # Force full rebuild
```

### search

Search by meaning (semantic) or structure (regex).

```bash
mdtldr search "how to authenticate"        # Semantic search (if embeddings exist)
mdtldr search -s "auth.*flow"              # Structural search (heading regex)
mdtldr search -n 5 "setup"                 # Limit to 5 results
mdtldr search --threshold 0.8 "deploy"     # Higher similarity threshold
```

#### Context Lines

Show surrounding lines around matches (like grep):

```bash
mdtldr search "checkpoint" -C 3            # 3 lines before AND after each match
mdtldr search "error" -B 2 -A 5            # 2 lines before, 5 lines after
```

Auto-detection: Uses semantic search if embeddings exist and query looks like natural language. Use `-s` to force structural search.

### context

Get LLM-ready summaries from one or more files.

```bash
mdtldr context README.md                   # Single file
mdtldr context README.md docs/api.md       # Multiple files
mdtldr context docs/*.md                   # Glob patterns work
mdtldr context -t 500 README.md            # Token budget
mdtldr context --brief README.md           # Minimal output
mdtldr context --full README.md            # Include full content
```

#### Section Filtering

Extract specific sections instead of entire files:

```bash
mdtldr context doc.md --sections           # List available sections
mdtldr context doc.md --section "Setup"    # Extract by section name
mdtldr context doc.md --section "2.1"      # Extract by section number
mdtldr context doc.md --section "API*"     # Glob pattern matching
mdtldr context doc.md --section "Config" --shallow  # Top-level only (no nested subsections)
```

The `--sections` flag shows all sections with their numbers and token counts, helping you target exactly what you need.

### tree

Show file structure or document outline.

```bash
mdtldr tree                        # List markdown files in current directory
mdtldr tree ./docs                 # List files in specific directory
mdtldr tree README.md              # Show document outline (heading hierarchy)
```

Auto-detection: Directory shows file list, file shows document outline.

### links / backlinks

Analyze link relationships.

```bash
mdtldr links README.md             # What does this file link to?
mdtldr backlinks docs/api.md       # What files link to this?
```

### stats

Show index statistics.

```bash
mdtldr stats                       # Current directory
mdtldr stats ./docs                # Specific path
```

---

## Workflows

### Before Adding Context to LLM

```bash
mdtldr tree docs/                          # See what's available
mdtldr tree docs/api.md                    # Check document structure
mdtldr context -t 500 docs/api.md          # Get summary within token budget
```

### Finding Documentation

```bash
mdtldr search "authentication"             # By meaning
mdtldr search -s "Setup|Install"           # By heading pattern
```

### Setting Up Semantic Search

```bash
export OPENAI_API_KEY=sk-...
mdtldr index --embed                       # Build embeddings
mdtldr search "how to deploy"              # Now works semantically
```

---

## MCP Integration

For Claude Desktop, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

For Claude Code, add to `.claude/settings.json`:

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

### MCP Tools

| Tool | Description |
|------|-------------|
| `md_search` | Semantic search across indexed docs |
| `md_context` | Get LLM-ready summary for a file |
| `md_structure` | Get document outline |

---

## Configuration

### Index Location

Indexes are stored in `.md-tldr/` in your project root:

```
.md-tldr/
  indexes/
    documents.json    # Document metadata
    sections.json     # Section index
    links.json        # Link graph
    vectors.bin       # Embeddings (if enabled)
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required for semantic search |

---

## Performance

| Metric | Raw Markdown | md-tldr | Savings |
|--------|--------------|---------|---------|
| Context for single doc | 2,500 tokens | 400 tokens | **84%** |
| Context for 10 docs | 25,000 tokens | 4,000 tokens | **84%** |
| Search latency | N/A | <100ms | - |

---

## License

MIT
