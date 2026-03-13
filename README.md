# mdm

**Give LLMs exactly the markdown they need. Nothing more.**

```bash
QUICK REFERENCE
  mdm index [path]           Index markdown files (add --embed for semantic search)
  mdm search <query> [path]  Search by meaning or structure
  mdm context <files...>     Get LLM-ready summary
  mdm tree [path|file]       Show files or document outline
  mdm config <command>       Configuration management (init, show, check)
  mdm links <file>           Outgoing links
  mdm backlinks <file>       Incoming links
  mdm stats [path]           Index statistics
```

---

## Why?

Your documentation is 50K tokens of markdown. LLM context windows are limited. Raw markdown dumps waste tokens on structure, headers, and noise.

mdm extracts *structure* instead of dumping *text*. The result: **80%+ fewer tokens** while preserving everything needed to understand your docs.

```bash
npm install -g markdown-matters
mdm index .                     # Index your docs
mdm search "authentication"     # Find by meaning
mdm context README.md           # Get LLM-ready summary
```

---

## Installation

```bash
npm install -g markdown-matters
```

Requires Node.js 18+. Semantic search requires an embedding provider (OpenAI, Ollama, LM Studio, OpenRouter, or Voyage). See [docs/CONFIG.md](./docs/CONFIG.md#embedding-providers) for provider setup.

---

## Commands

### index

Index markdown files. Run this first.

```bash
mdm index                       # Index current directory (prompts for semantic)
mdm index ./docs                # Index specific path
mdm index --embed               # Also build embeddings for semantic search
mdm index --no-embed            # Skip the semantic search prompt
mdm index --watch               # Watch for changes
mdm index --force               # Force full rebuild
```

### search

Search by meaning (semantic) or keyword (text match).

```bash
mdm search "how to authenticate"        # Semantic search (if embeddings exist)
mdm search -k "auth.*flow"              # Keyword search (text match)
mdm search -n 5 "setup"                 # Limit to 5 results
mdm search --threshold 0.25 "deploy"    # Lower threshold for more results
```

#### Similarity Threshold

Semantic search filters results by similarity score (0-1). Default: **0.35** (35%).

- **0 results?** Content may exist below the threshold. Try `--threshold 0.25`
- **Typical scores**: Single-word queries score ~30-40%, multi-word phrases ~50-70%
- **Higher threshold** = stricter matching, fewer results
- **Lower threshold** = more results, possibly less relevant

```bash
mdm search "authentication"              # Uses default 0.35 threshold
mdm search --threshold 0.25 "auth"       # Lower threshold for broad queries
mdm search --threshold 0.6 "specific"    # Higher threshold for precision
```

#### Context Lines

Show surrounding lines around matches (like grep):

```bash
mdm search "checkpoint" -C 3            # 3 lines before AND after each match
mdm search "error" -B 2 -A 5            # 2 lines before, 5 lines after
```

Auto-detection: Uses semantic search if embeddings exist and query looks like natural language. Use `-k` to force keyword search.

#### Advanced Search

**Quality Modes** - Control speed vs. accuracy tradeoff:
```bash
mdm search "query" --quality fast       # 40% faster, good recall
mdm search "query" -q thorough          # Best recall, 30% slower
```

**Re-ranking** - Boost precision by 20-35%:
```bash
mdm search "query" --rerank             # First use downloads 90MB model
npm install @huggingface/transformers         # Required dependency
```

**HyDE** - Better results for complex questions:
```bash
mdm search "how to implement auth" --hyde   # Expands query semantically
```

#### AI Summarization

Generate AI-powered summaries of search results:

```bash
mdm search "authentication" --summarize     # Get AI summary of results
mdm search "error handling" -s --yes        # Skip cost confirmation
mdm search "database" -s --stream           # Stream output in real-time
```

Uses your existing AI subscription (Claude Code, Copilot CLI) for free, or pay-per-use API providers. See [AI Summarization](#ai-summarization) for setup.

### context

Get LLM-ready summaries from one or more files.

```bash
mdm context README.md                   # Single file
mdm context README.md docs/api.md       # Multiple files
mdm context docs/*.md                   # Glob patterns work
mdm context -t 500 README.md            # Token budget
mdm context --brief README.md           # Minimal output
mdm context --full README.md            # Include full content
```

#### Section Filtering

Extract specific sections instead of entire files:

```bash
mdm context doc.md --sections           # List available sections
mdm context doc.md --section "Setup"    # Extract by section name
mdm context doc.md --section "2.1"      # Extract by section number
mdm context doc.md --section "API*"     # Glob pattern matching
mdm context doc.md --section "Config" --shallow  # Top-level only (no nested subsections)
```

The `--sections` flag shows all sections with their numbers and token counts, helping you target exactly what you need.

### tree

Show file structure or document outline.

```bash
mdm tree                        # List markdown files in current directory
mdm tree ./docs                 # List files in specific directory
mdm tree README.md              # Show document outline (heading hierarchy)
```

Auto-detection: Directory shows file list, file shows document outline.

### links / backlinks

Analyze link relationships.

```bash
mdm links README.md             # What does this file link to?
mdm backlinks docs/api.md       # What files link to this?
```

### stats

Show index statistics.

```bash
mdm stats                       # Current directory
mdm stats ./docs                # Specific path
```

---

## Workflows

### Before Adding Context to LLM

```bash
mdm tree docs/                          # See what's available
mdm tree docs/api.md                    # Check document structure
mdm context -t 500 docs/api.md          # Get summary within token budget
```

### Finding Documentation

```bash
mdm search "authentication"             # By meaning
mdm search -k "Setup|Install"           # By keyword pattern
```

### Setting Up Semantic Search

mdm supports multiple embedding providers for semantic search:

- **OpenAI** (default) - Cloud-based, requires API key
- **Ollama** - Free, local, daemon-based
- **LM Studio** - Free, local, GUI-based (development only)
- **OpenRouter** - Multi-provider gateway
- **Voyage** - Premium quality, competitive pricing

Quick start with OpenAI:
```bash
export OPENAI_API_KEY=sk-...
mdm index --embed                       # Build embeddings
mdm search "how to deploy"              # Now works semantically
```

Using Ollama (free, local):
```bash
ollama serve && ollama pull nomic-embed-text
mdm index --embed --provider ollama --provider-model nomic-embed-text
```

See [docs/CONFIG.md](./docs/CONFIG.md#embedding-providers) for complete provider setup, comparison, and configuration options.

---

## MCP Integration

For Claude Desktop, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

For Claude Code, add to `.claude/settings.json`:

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

### MCP Tools

| Tool | Description |
|------|-------------|
| `md_search` | Semantic search across indexed docs |
| `md_context` | Get LLM-ready summary for a file |
| `md_structure` | Get document outline |

---

## Configuration

mdm supports a layered configuration system for persistent settings:

```bash
# Create a config file
mdm config init

# Check your configuration
mdm config check

# Customize settings in mdm.config.js
```

```javascript
// mdm.config.js
/** @type {import('markdown-matters').PartialMdmConfig} */
export default {
  index: {
    excludePatterns: ['node_modules', '.git', 'dist', 'vendor']
  },
  search: {
    defaultLimit: 20
  }
}
```

Configuration precedence: CLI flags > Environment variables > Config file > Defaults

**See [docs/CONFIG.md](./docs/CONFIG.md) for the complete configuration reference.**

### Index Location

Indexes are stored in `.mdm/` in your project root:

```
.mdm/
  indexes/
    documents.json    # Document metadata
    sections.json     # Section index
    links.json        # Link graph
    vectors.bin       # Embeddings (if enabled)
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required for OpenAI semantic search (default provider) |
| `OPENROUTER_API_KEY` | Required for OpenRouter semantic search |
| `MDM_*` | Configuration overrides (see [CONFIG.md](./docs/CONFIG.md)) |

---

## AI Summarization

Transform search results into actionable insights using AI.

### Quick Start

```bash
# Basic usage (auto-detects installed CLI tools)
mdm search "authentication" --summarize

# Skip confirmation for scripts
mdm search "error handling" --summarize --yes

# Stream output in real-time
mdm search "database" --summarize --stream
```

### First-Time Setup

On first use, mdm auto-detects available providers:

```
Using claude (subscription - FREE)

--- AI Summary ---

Based on the search results, here are the key findings...
```

### Providers

**CLI Providers (FREE with subscription):**

| Provider | Command | Subscription Required |
|----------|---------|----------------------|
| Claude Code | `claude` | Claude Pro/Team |
| GitHub Copilot | `copilot` | Copilot subscription |
| OpenCode | `opencode` | BYOK (any provider) |

**API Providers (pay-per-use):**

| Provider | Cost per 1M tokens | Notes |
|----------|-------------------|-------|
| DeepSeek | $0.14-0.56 | Ultra-cheap |
| Qwen | $0.03-0.12 | Budget option |
| Google Gemini | $0.30-2.50 | Balanced |
| OpenAI GPT | $1.75-14.00 | Premium |
| Anthropic Claude | $3.00-15.00 | Premium |

### Configuration

**Option 1: Auto-detection (recommended)**

Just run `--summarize` - mdm finds installed CLI tools automatically.

**Option 2: Config file**

```javascript
// mdm.config.js
/** @type {import('markdown-matters').PartialMdmConfig} */
export default {
  aiSummarization: {
    mode: 'cli',        // 'cli' (free) or 'api' (paid)
    provider: 'claude', // Provider name
  },
}
```

**Option 3: Environment variables**

```bash
export MDM_AISUMMARIZATION_MODE=api
export MDM_AISUMMARIZATION_PROVIDER=deepseek
export DEEPSEEK_API_KEY=sk-...
```

### CLI Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--summarize` | `-s` | Enable AI summarization |
| `--yes` | `-y` | Skip cost confirmation |
| `--stream` | | Stream output in real-time |

### Cost Transparency

API providers show cost estimates before proceeding:

```
Cost Estimate:
  Provider: deepseek
  Input tokens: ~2,500
  Output tokens: ~500
  Estimated cost: $0.0007

Continue with summarization? [Y/n]:
```

CLI providers show free status:

```
Using claude (subscription - FREE)
```

See [docs/summarization.md](./docs/summarization.md) for architecture details and troubleshooting.

---

## Performance

| Metric | Raw Markdown | mdm | Savings |
|--------|--------------|---------|---------|
| Context for single doc | 2,500 tokens | 400 tokens | **84%** |
| Context for 10 docs | 25,000 tokens | 4,000 tokens | **84%** |
| Search latency | N/A | <100ms | - |

---

## License

MIT
