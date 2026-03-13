# Configuration Guide

mdcontext supports a layered configuration system that allows you to set persistent defaults, override them with environment variables, and use CLI flags for one-off changes.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration Precedence](#configuration-precedence)
- [Config File Formats](#config-file-formats)
- [Configuration Options](#configuration-options)
  - [Index Configuration](#index-configuration)
  - [Search Configuration](#search-configuration)
  - [Embeddings Configuration](#embeddings-configuration)
  - [Summarization Configuration](#summarization-configuration)
  - [AI Summarization Configuration](#ai-summarization-configuration)
  - [Output Configuration](#output-configuration)
  - [Paths Configuration](#paths-configuration)
- [Environment Variables](#environment-variables)
- [CLI Commands](#cli-commands)
- [Migration Guide](#migration-guide)
- [Testing Configuration](#testing-configuration)

---

## Quick Start

Create a config file in your project root:

```bash
# Generate a JavaScript config with type annotations (recommended)
mdcontext config init

# Or generate a JSON config
mdcontext config init --format json
```

This creates `mdcontext.config.js` with documented defaults:

```javascript
/** @type {import('mdcontext').PartialMdContextConfig} */
export default {
  index: {
    maxDepth: 10,
    excludePatterns: ['node_modules', '.git', 'dist', 'build'],
  },
  search: {
    defaultLimit: 10,
    minSimilarity: 0.35,
  },
}
```

---

## Configuration Precedence

mdcontext uses a layered configuration system. Values from higher-priority sources override lower ones:

```
CLI Flags           (highest priority)
    |
Environment Variables
    |
Config File
    |
Built-in Defaults   (lowest priority)
```

**Example:**

```bash
# Config file sets: index.maxDepth = 10
# Environment sets: MDM_INDEX_MAXDEPTH = 5
# CLI flag: --max-depth 3

# Effective value: 3 (CLI wins)
```

---

## Config File Formats

mdcontext searches for configuration files in this order:

| Filename                  | Format     | Notes                         |
| ------------------------- | ---------- | ----------------------------- |
| `mdcontext.config.js`     | JavaScript | Best: type-safe with JSDoc    |
| `mdcontext.config.mjs`    | ESM        | ES modules only               |
| `mdcontext.config.json`   | JSON       | Simple, no code               |
| `.mdcontextrc`            | JSON       | Hidden file, JSON format      |
| `.mdcontextrc.json`       | JSON       | Explicit JSON rc file         |
| `mdcontext.config.ts`     | TypeScript | Not supported (see note below)|

### JavaScript Config with Types (Recommended)

Using JSDoc type annotations provides full type safety and IDE autocompletion:

```javascript
// mdcontext.config.js
/** @type {import('mdcontext').PartialMdContextConfig} */
export default {
  index: {
    maxDepth: 10,
    excludePatterns: ['node_modules', '.git', 'dist', 'build'],
    fileExtensions: ['.md', '.mdx'],
    followSymlinks: false,
    indexDir: '.mdcontext',
  },
  search: {
    defaultLimit: 10,
    maxLimit: 100,
    minSimilarity: 0.35,
    includeSnippets: true,
    snippetLength: 200,
  },
  embeddings: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    batchSize: 100,
    maxRetries: 3,
  },
  output: {
    format: 'text',
    color: true,
    verbose: false,
  },
}
```

The `@type` JSDoc annotation provides TypeScript type checking and IDE autocompletion while remaining a valid JavaScript file that Node.js can import directly.

**Note:** TypeScript (`.ts`) config files are not currently supported because Node.js cannot import them without a loader. Use JavaScript with JSDoc types instead.

### JSON Config

```json
{
  "$schema": "https://mdcontext.dev/schema.json",
  "index": {
    "maxDepth": 10,
    "excludePatterns": ["node_modules", ".git", "dist", "build"],
    "fileExtensions": [".md", ".mdx"]
  },
  "search": {
    "defaultLimit": 10,
    "minSimilarity": 0.35
  }
}
```

### Using a Custom Config Path

```bash
# Use a specific config file
mdcontext --config ./config/mdcontext.json index

# Short form
mdcontext -c ./custom.config.json search "query"
```

---

## Configuration Options

### Index Configuration

Controls how markdown files are discovered and indexed.

| Option            | Type       | Default                                    | Description                              |
| ----------------- | ---------- | ------------------------------------------ | ---------------------------------------- |
| `maxDepth`        | `number`   | `10`                                       | Maximum directory depth to traverse      |
| `excludePatterns` | `string[]` | `['node_modules', '.git', 'dist', 'build']` | Glob patterns to exclude from indexing   |
| `fileExtensions`  | `string[]` | `['.md', '.mdx']`                          | File extensions to index                 |
| `followSymlinks`  | `boolean`  | `false`                                    | Whether to follow symbolic links         |
| `indexDir`        | `string`   | `'.mdcontext'`                             | Directory for storing index files        |

**Example:**

```typescript
export default defineConfig({
  index: {
    // Only index top 5 levels of directories
    maxDepth: 5,

    // Exclude additional directories
    excludePatterns: [
      'node_modules',
      '.git',
      'dist',
      'build',
      'vendor',
      '__tests__',
    ],

    // Only index standard markdown
    fileExtensions: ['.md'],

    // Store index in a custom location
    indexDir: '.cache/mdcontext',
  },
})
```

### Excluding Files

mdcontext automatically respects standard ignore patterns.

#### .gitignore (Honored by Default)

Your existing `.gitignore` is automatically respected. No additional configuration needed.

#### .mdcontextignore (Custom Patterns)

Create `.mdcontextignore` in your project root for mdcontext-specific exclusions:

```gitignore
# Ignore research notes
research/**/*.md

# But keep summaries
!research/**/summary.md

# Ignore draft content
drafts/
*.draft.md
```

#### Precedence

Patterns are applied in this order (later patterns override earlier):

1. **Built-in defaults** - `node_modules`, `.git`, `dist`, `build`
2. **.gitignore** - Standard git ignore patterns
3. **.mdcontextignore** - mdcontext-specific patterns
4. **CLI --exclude** - Highest priority, overrides all

```bash
# Add patterns via CLI (highest priority)
mdcontext index --exclude "*.draft.md,research/**"

# Disable .gitignore honoring
mdcontext index --no-gitignore
```

#### Pattern Syntax

Uses standard `.gitignore` syntax:

| Pattern | Matches |
| ------- | ------- |
| `*.log` | All .log files |
| `temp/` | Directory named temp |
| `**/node_modules/**` | node_modules anywhere |
| `!important.md` | Negation - include this file |
| `#comment` | Comments are ignored |

---

### Search Configuration

Controls search behavior and defaults.

| Option              | Type      | Default | Description                                      |
| ------------------- | --------- | ------- | ------------------------------------------------ |
| `defaultLimit`      | `number`  | `10`    | Default number of search results                 |
| `maxLimit`          | `number`  | `100`   | Maximum allowed search results                   |
| `minSimilarity`     | `number`  | `0.35`  | Minimum similarity score (0-1) for semantic search |
| `includeSnippets`   | `boolean` | `true`  | Include content snippets in results              |
| `snippetLength`     | `number`  | `200`   | Maximum snippet length in characters             |
| `autoIndexThreshold`| `number`  | `10`    | Auto-create semantic index if under this many seconds |

**Example:**

```typescript
export default defineConfig({
  search: {
    // Return more results by default
    defaultLimit: 20,

    // Require higher similarity for matches
    minSimilarity: 0.7,

    // Longer snippets for more context
    snippetLength: 300,
  },
})
```

### Embeddings Configuration

Controls semantic search embedding generation.

| Option         | Type     | Default                    | Description                              |
| -------------- | -------- | -------------------------- | ---------------------------------------- |
| `provider`     | `string` | `'openai'`                 | Embedding provider (openai, ollama, lm-studio, openrouter) |
| `model`        | `string` | `'text-embedding-3-small'` | Embedding model name                     |
| `dimensions`   | `number` | (auto)                     | Vector dimensions (auto-detected from model if not set) |
| `batchSize`    | `number` | `100`                      | Batch size for API calls                 |
| `maxRetries`   | `number` | `3`                        | Maximum retries for failed API calls     |
| `retryDelayMs` | `number` | `1000`                     | Delay between retries in milliseconds    |
| `timeoutMs`    | `number` | `30000`                    | Request timeout in milliseconds          |
| `apiKey`       | `string` | (from env)                 | API key (prefer environment variable) |

**Model Dimensions:**

Dimensions are now automatically configured based on the model. If not explicitly set:
- **OpenAI text-embedding-3-small/large**: Uses 512 dimensions (Matryoshka reduction for speed)
- **Ollama nomic-embed-text**: Uses 768 native dimensions
- **Ollama mxbai-embed-large/bge-m3**: Uses 1024 native dimensions

You can override dimensions for models that support Matryoshka reduction:
```javascript
embeddings: {
  model: 'text-embedding-3-small',
  dimensions: 1024  // Higher accuracy, larger index
}
```

**Available Models:**

| Model                      | Native Dims | Default Dims | Matryoshka | Notes |
| -------------------------- | ----------- | ------------ | ---------- | ----- |
| `text-embedding-3-small`   | 1536        | 512          | Yes        | OpenAI, recommended |
| `text-embedding-3-large`   | 3072        | 512          | Yes        | OpenAI, highest quality |
| `text-embedding-ada-002`   | 1536        | 1536         | No         | OpenAI, legacy |
| `nomic-embed-text`         | 768         | 768          | No         | Ollama, recommended for local |
| `mxbai-embed-large`        | 1024        | 1024         | No         | Ollama, higher quality |
| `bge-m3`                   | 1024        | 1024         | No         | Ollama, multilingual |

**Example:**

```typescript
export default defineConfig({
  embeddings: {
    // Use higher quality model
    model: 'text-embedding-3-large',

    // Smaller batches for rate limiting
    batchSize: 50,

    // More aggressive retries
    maxRetries: 5,
    retryDelayMs: 2000,
  },
})
```

---

## Embedding Providers

mdcontext supports multiple embedding providers:

| Provider | Best For | Cost | Privacy | Production Ready |
|----------|----------|------|---------|------------------|
| **OpenAI** | Production, high quality | $0.02/1M tokens | Cloud | ✓ |
| **Ollama** | Zero cost, privacy | Free | Local | ✓ |
| **LM Studio** | Interactive testing | Free | Local | Development only |
| **OpenRouter** | Multi-model access | ~$0.021/1M tokens | Cloud | ✓ |

### Provider Setup

**OpenAI (Default):** `export OPENAI_API_KEY=sk-...`

**Ollama:** `ollama serve && ollama pull nomic-embed-text`

**LM Studio:** Open GUI, load model, start local server

**OpenRouter:** `export OPENROUTER_API_KEY=sk-or-v1-...`

### Security Considerations

**Custom Base URLs**: When using `--provider-base-url` or setting a custom `baseURL` in configuration:

⚠️ **Only use trusted sources** - Your API keys and markdown content will be sent to this endpoint.

- For Ollama/LM Studio: Only use `localhost` or servers you control
- For remote Ollama instances: Use encrypted connections (https://) and trusted networks
- Never point to unknown or untrusted servers

**Example safe configurations:**
```bash
# Safe: Local Ollama
mdcontext index --embed --provider-base-url http://localhost:11434/v1

# Safe: Trusted internal server with encryption
mdcontext index --embed --provider-base-url https://ollama.internal.company.com/v1

# Unsafe: Unknown external server
mdcontext index --embed --provider-base-url http://random-server.example.com/v1  # ❌ DON'T DO THIS
```

### CLI Usage

```bash
mdcontext index --embed --provider ollama --provider-model nomic-embed-text
mdcontext index --embed --provider openrouter
mdcontext index --embed --provider lm-studio
```

### Configuration

```javascript
export default {
  embeddings: {
    provider: 'ollama',
    model: 'nomic-embed-text',
  },
}
```

**Note:** Re-indexing required when switching providers.

---

### Summarization Configuration

Controls context assembly and summarization behavior.

| Option              | Type     | Default | Description                                |
| ------------------- | -------- | ------- | ------------------------------------------ |
| `briefTokenBudget`  | `number` | `100`   | Token budget for 'brief' compression level |
| `summaryTokenBudget`| `number` | `500`   | Token budget for 'summary' compression level |
| `compressionRatio`  | `number` | `0.3`   | Target compression ratio (0-1)             |
| `minSectionTokens`  | `number` | `20`    | Minimum tokens for any section summary     |
| `maxTopics`         | `number` | `10`    | Maximum topics to extract from a document  |
| `minPartialBudget`  | `number` | `50`    | Minimum remaining budget for partial content |

**Example:**

```typescript
export default defineConfig({
  summarization: {
    // More detailed brief summaries
    briefTokenBudget: 150,

    // Higher compression for large docs
    compressionRatio: 0.2,
  },
})
```

### AI Summarization Configuration

Controls AI-powered summarization of search results. This is separate from `summarization` which handles token budgets for context assembly.

| Option     | Type     | Default    | Description                                    |
| ---------- | -------- | ---------- | ---------------------------------------------- |
| `mode`     | `string` | `'cli'`    | `'cli'` (free) or `'api'` (pay-per-use)       |
| `provider` | `string` | `'claude'` | Provider name (see tables below)               |
| `model`    | `string` | (optional) | Model name for API providers                   |
| `stream`   | `boolean`| `false`    | Enable streaming output                        |
| `baseURL`  | `string` | (optional) | Custom API base URL                            |
| `apiKey`   | `string` | (from env) | API key (prefer environment variable)          |

**CLI Providers (FREE with subscription):**

| Provider | Config Value | Requires |
|----------|--------------|----------|
| Claude Code | `'claude'` | Claude Pro/Team subscription |
| GitHub Copilot | `'copilot'` | Copilot subscription |
| OpenCode | `'opencode'` | BYOK configuration |
| Aider | `'aider'` | Model configuration |
| Cline | `'cline'` | Model configuration |

**API Providers (pay-per-use):**

| Provider | Config Value | Cost per 1M tokens | API Key Env Var |
|----------|--------------|-------------------|-----------------|
| DeepSeek | `'deepseek'` | $0.14-0.56 | `DEEPSEEK_API_KEY` |
| Qwen | `'qwen'` | $0.03-0.12 | `QWEN_API_KEY` |
| Google Gemini | `'gemini'` | $0.30-2.50 | `GOOGLE_API_KEY` |
| OpenAI GPT | `'openai'` | $1.75-14.00 | `OPENAI_API_KEY` |
| Anthropic Claude | `'anthropic'` | $3.00-15.00 | `ANTHROPIC_API_KEY` |

**Example:**

```javascript
// mdcontext.config.js
/** @type {import('mdcontext').PartialMdContextConfig} */
export default {
  aiSummarization: {
    // Use Claude CLI (free with subscription)
    mode: 'cli',
    provider: 'claude',
  },
}
```

**Example with API provider:**

```javascript
export default {
  aiSummarization: {
    // Use DeepSeek API (ultra-cheap)
    mode: 'api',
    provider: 'deepseek',
    model: 'deepseek-chat',
  },
}
```

See [docs/summarization.md](./summarization.md) for architecture details and adding new providers.

### Output Configuration

Controls CLI output formatting.

| Option       | Type                | Default  | Description                    |
| ------------ | ------------------- | -------- | ------------------------------ |
| `format`     | `'text'` \| `'json'`| `'text'` | Default output format          |
| `color`      | `boolean`           | `true`   | Use colors in terminal output  |
| `prettyJson` | `boolean`           | `true`   | Pretty-print JSON output       |
| `verbose`    | `boolean`           | `false`  | Show verbose output            |
| `debug`      | `boolean`           | `false`  | Show debug information         |

**Example:**

```typescript
export default defineConfig({
  output: {
    // Always output JSON for scripting
    format: 'json',
    prettyJson: true,

    // Disable colors for CI environments
    color: false,
  },
})
```

### Paths Configuration

Controls file path behavior.

| Option       | Type     | Default              | Description                    |
| ------------ | -------- | -------------------- | ------------------------------ |
| `root`       | `string` | (current directory)  | Root directory for markdown files |
| `configFile` | `string` | (auto-detected)      | Custom config file path        |
| `cacheDir`   | `string` | `'.mdcontext/cache'` | Cache directory for temporary files |

**Example:**

```typescript
export default defineConfig({
  paths: {
    // Index a specific subdirectory
    root: './docs',

    // Custom cache location
    cacheDir: '.cache/mdcontext',
  },
})
```

---

## Environment Variables

All configuration options can be set via environment variables using the `MDM_` prefix.

### Variable Naming

Convert the config key to uppercase and replace dots with underscores:

```
config key:        index.maxDepth
environment var:   MDM_INDEX_MAXDEPTH
```

### Complete Variable Reference

#### Index Configuration

| Variable                          | Config Key               |
| --------------------------------- | ------------------------ |
| `MDM_INDEX_MAXDEPTH`        | `index.maxDepth`         |
| `MDM_INDEX_EXCLUDEPATTERNS` | `index.excludePatterns`  |
| `MDM_INDEX_FILEEXTENSIONS`  | `index.fileExtensions`   |
| `MDM_INDEX_FOLLOWSYMLINKS`  | `index.followSymlinks`   |
| `MDM_INDEX_INDEXDIR`        | `index.indexDir`         |

#### Search Configuration

| Variable                            | Config Key                |
| ----------------------------------- | ------------------------- |
| `MDM_SEARCH_DEFAULTLIMIT`     | `search.defaultLimit`     |
| `MDM_SEARCH_MAXLIMIT`         | `search.maxLimit`         |
| `MDM_SEARCH_MINSIMILARITY`    | `search.minSimilarity`    |
| `MDM_SEARCH_INCLUDESNIPPETS`  | `search.includeSnippets`  |
| `MDM_SEARCH_SNIPPETLENGTH`    | `search.snippetLength`    |
| `MDM_SEARCH_AUTOINDEXTHRESHOLD` | `search.autoIndexThreshold` |

#### Embeddings Configuration

| Variable                          | Config Key               |
| --------------------------------- | ------------------------ |
| `MDM_EMBEDDINGS_PROVIDER`   | `embeddings.provider`    |
| `MDM_EMBEDDINGS_MODEL`      | `embeddings.model`       |
| `MDM_EMBEDDINGS_DIMENSIONS` | `embeddings.dimensions`  |
| `MDM_EMBEDDINGS_BATCHSIZE`  | `embeddings.batchSize`   |
| `MDM_EMBEDDINGS_MAXRETRIES` | `embeddings.maxRetries`  |
| `MDM_EMBEDDINGS_RETRYDELAYMS` | `embeddings.retryDelayMs` |
| `MDM_EMBEDDINGS_TIMEOUTMS`  | `embeddings.timeoutMs`   |
| `MDM_EMBEDDINGS_APIKEY`     | `embeddings.apiKey`      |

#### Summarization Configuration

| Variable                                   | Config Key                       |
| ------------------------------------------ | -------------------------------- |
| `MDM_SUMMARIZATION_BRIEFTOKENBUDGET` | `summarization.briefTokenBudget` |
| `MDM_SUMMARIZATION_SUMMARYTOKENBUDGET` | `summarization.summaryTokenBudget` |
| `MDM_SUMMARIZATION_COMPRESSIONRATIO` | `summarization.compressionRatio` |
| `MDM_SUMMARIZATION_MINSECTIONTOKENS` | `summarization.minSectionTokens` |
| `MDM_SUMMARIZATION_MAXTOPICS`        | `summarization.maxTopics`        |
| `MDM_SUMMARIZATION_MINPARTIALBUDGET` | `summarization.minPartialBudget` |

#### AI Summarization Configuration

| Variable                                | Config Key                  |
| --------------------------------------- | --------------------------- |
| `MDM_AISUMMARIZATION_MODE`        | `aiSummarization.mode`      |
| `MDM_AISUMMARIZATION_PROVIDER`    | `aiSummarization.provider`  |
| `MDM_AISUMMARIZATION_MODEL`       | `aiSummarization.model`     |
| `MDM_AISUMMARIZATION_STREAM`      | `aiSummarization.stream`    |
| `MDM_AISUMMARIZATION_BASEURL`     | `aiSummarization.baseURL`   |
| `MDM_AISUMMARIZATION_APIKEY`      | `aiSummarization.apiKey`    |

**Note:** For API providers, also set the provider-specific API key environment variable:
- `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `QWEN_API_KEY`

#### Output Configuration

| Variable                        | Config Key          |
| ------------------------------- | ------------------- |
| `MDM_OUTPUT_FORMAT`       | `output.format`     |
| `MDM_OUTPUT_COLOR`        | `output.color`      |
| `MDM_OUTPUT_PRETTYJSON`   | `output.prettyJson` |
| `MDM_OUTPUT_VERBOSE`      | `output.verbose`    |
| `MDM_OUTPUT_DEBUG`        | `output.debug`      |

#### Paths Configuration

| Variable                      | Config Key         |
| ----------------------------- | ------------------ |
| `MDM_PATHS_ROOT`        | `paths.root`       |
| `MDM_PATHS_CONFIGFILE`  | `paths.configFile` |
| `MDM_PATHS_CACHEDIR`    | `paths.cacheDir`   |

### Array Values

For array values, use comma-separated strings:

```bash
export MDM_INDEX_EXCLUDEPATTERNS="node_modules,.git,dist,vendor"
export MDM_INDEX_FILEEXTENSIONS=".md,.mdx,.markdown"
```

### Boolean Values

Use `true` or `false`:

```bash
export MDM_INDEX_FOLLOWSYMLINKS=true
export MDM_OUTPUT_COLOR=false
```

### Example: CI Environment

```bash
# .github/workflows/docs.yml
env:
  MDM_OUTPUT_COLOR: 'false'
  MDM_OUTPUT_FORMAT: 'json'
  MDM_SEARCH_DEFAULTLIMIT: '50'
```

---

## CLI Commands

### config init

Create a starter configuration file.

```bash
mdcontext config init [options]

Options:
  -f, --format <ts|json>  Config file format (default: ts)
  --force                 Overwrite existing config file
  --json                  Output as JSON
  --pretty                Pretty-print JSON output
```

**Examples:**

```bash
# Create TypeScript config
mdcontext config init

# Create JSON config
mdcontext config init --format json

# Overwrite existing config
mdcontext config init --force
```

### config show

Display the current config file location.

```bash
mdcontext config show [options]

Options:
  --json    Output as JSON
  --pretty  Pretty-print JSON output
```

### config check

Validate configuration and show effective values with their sources.

```bash
mdcontext config check [options]

Options:
  --json    Output as JSON
  --pretty  Pretty-print JSON output
```

**Example output:**

```
Configuration validated successfully!

Source: /project/mdcontext.config.ts

Effective configuration:
  index:
    maxDepth: 10 (from config file)
    excludePatterns: ["node_modules",".git","dist"] (default)
    fileExtensions: [".md",".mdx"] (default)
    followSymlinks: false (default)
    indexDir: .mdcontext (default)
  search:
    defaultLimit: 20 (from environment)
    maxLimit: 100 (default)
    minSimilarity: 0.35 (default)
    ...
```

---

## Migration Guide

### From CLI-Only Usage

If you've been passing flags on every command:

```bash
# Before: Flags every time
mdcontext index --exclude vendor --exclude __tests__
mdcontext search "query" --limit 20
```

Create a config file to persist these settings:

```bash
# Generate config
mdcontext config init
```

Edit `mdcontext.config.ts`:

```typescript
import { defineConfig } from 'mdcontext'

export default defineConfig({
  index: {
    excludePatterns: ['node_modules', '.git', 'dist', 'build', 'vendor', '__tests__'],
  },
  search: {
    defaultLimit: 20,
  },
})
```

Now commands use your defaults:

```bash
# After: Clean commands
mdcontext index
mdcontext search "query"

# Override when needed
mdcontext search "query" --limit 5
```

### From Environment Variables

If you've been setting environment variables:

```bash
# .bashrc or .zshrc
export OPENAI_API_KEY=sk-...
export MDM_SEARCH_DEFAULTLIMIT=20
```

You can now move project-specific settings to a config file while keeping environment variables for:

- Secrets (API keys)
- Machine-specific settings
- CI/CD overrides

---

## Testing Configuration

mdcontext provides utilities for testing with custom configurations.

### Test Utilities

```typescript
import { TestConfigLayer, withTestConfig, runWithConfig } from 'mdcontext'
import { Effect } from 'effect'

// Option 1: Use TestConfigLayer directly
const testEffect = myEffect.pipe(
  Effect.provide(TestConfigLayer)
)

// Option 2: withTestConfig for partial overrides
const testEffect = myEffect.pipe(
  withTestConfig({
    search: { defaultLimit: 5 }
  })
)

// Option 3: runWithConfig for full test isolation
const result = await runWithConfig(
  myEffect,
  { search: { defaultLimit: 5 } }
)
```

### Isolating Tests from Environment

```typescript
import { createTestConfigProvider } from 'mdcontext'

// Creates a provider that ignores environment variables
const provider = createTestConfigProvider(
  { search: { defaultLimit: 5 } },  // CLI overrides
  { index: { maxDepth: 3 } }        // File config
)

const effect = myEffect.pipe(
  Effect.withConfigProvider(provider)
)
```

---

## Troubleshooting

### Config File Not Loading

If your config file isn't being used:

1. **Verify the file is found:**
   ```bash
   mdcontext config show
   ```
   This shows which config file mdcontext is using, if any.

2. **Check for errors:**
   ```bash
   mdcontext config check --json
   ```
   The `errors` array will show any loading failures.

3. **Common issues:**
   - **JSON syntax errors:** Validate your JSON with `jq` or an online validator
   - **TypeScript files:** Not currently supported - use `.js` or `.json` instead (see below)
   - **Wrong export:** Ensure `.js` files use `export default { ... }`
   - **File location:** Config must be in project root or parent directory

### TypeScript Config Files

**Current Limitation:** `.ts` config files are not supported because Node.js cannot import TypeScript directly without a loader.

**Recommended Alternatives:**

1. **JavaScript with JSDoc types** (recommended):
   ```javascript
   // mdcontext.config.js
   /** @type {import('mdcontext').PartialMdContextConfig} */
   export default {
     index: {
       maxDepth: 10,
     },
   }
   ```
   This provides full type checking and IDE autocompletion while working at runtime.

2. **JSON format** (simplest):
   ```bash
   mdcontext config init --format json
   ```

### Environment Variables Not Working

1. **Check variable name:** Must be uppercase with `MDM_` prefix
   ```bash
   # Correct
   export MDM_SEARCH_DEFAULTLIMIT=20

   # Wrong - will not work
   export mdcontext_search_defaultLimit=20
   ```

2. **Verify with config check:**
   ```bash
   mdcontext config check
   ```
   Look for "(from environment)" annotations.

3. **Array values:** Use comma-separated strings
   ```bash
   export MDM_INDEX_EXCLUDEPATTERNS="node_modules,.git,dist"
   ```

### Config Not Taking Effect

If you've set config but commands still use defaults:

1. **Check precedence:** CLI flags override everything
   ```bash
   # This ignores config file's defaultLimit setting
   mdcontext search "query" --limit 5
   ```

2. **Verify effective config:**
   ```bash
   mdcontext config check
   ```
   Shows exactly what values are being used and why.

3. **Try explicit config path:**
   ```bash
   mdcontext --config ./mdcontext.config.json index
   ```

---

## Examples

### Team Defaults

Share consistent settings across a team:

```typescript
// mdcontext.config.ts
import { defineConfig } from 'mdcontext'

export default defineConfig({
  index: {
    // Exclude team-specific directories
    excludePatterns: [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      'coverage',
    ],
  },
  search: {
    // Team prefers more results
    defaultLimit: 20,
    minSimilarity: 0.6,
  },
  output: {
    // Consistent formatting
    prettyJson: true,
  },
})
```

### CI/CD Pipeline

```yaml
# .github/workflows/docs.yml
jobs:
  check-docs:
    runs-on: ubuntu-latest
    env:
      MDM_OUTPUT_COLOR: 'false'
      MDM_OUTPUT_FORMAT: 'json'
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g mdcontext
      - run: mdcontext index ./docs
      - run: mdcontext stats --json > stats.json
```

### Monorepo Setup

```typescript
// packages/docs/mdcontext.config.ts
import { defineConfig } from 'mdcontext'

export default defineConfig({
  paths: {
    root: './content',
  },
  index: {
    // Only this package's docs
    excludePatterns: ['node_modules'],
    maxDepth: 5,
  },
})
```

---

_For CLI command reference, see [USAGE.md](./019-USAGE.md)_

## Hybrid Search

mdcontext supports hybrid search combining BM25 keyword matching with semantic vector search for improved recall (15-30% improvement over single-method retrieval).

### How It Works

Hybrid mode uses Reciprocal Rank Fusion (RRF) to merge results from:
- **BM25 keyword search**: Exact term matching (great for API names, error codes, identifiers)
- **Semantic search**: Meaning-based matching (great for concepts and related terms)

### Usage

```bash
# Auto-detect (uses hybrid if both indexes available)
mdcontext search "authentication"

# Force hybrid mode
mdcontext search --mode hybrid "authentication"

# Force keyword-only (BM25)
mdcontext search --mode keyword "authentication"

# Force semantic-only
mdcontext search --mode semantic "authentication"
```

### Building Indexes

Both indexes are built automatically:

```bash
# Build document index and BM25 index
mdcontext index

# Build semantic embeddings (also updates BM25)
mdcontext index --embed
```

### Configuration

Default weights (no configuration needed):
- BM25 weight: 1.0
- Semantic weight: 1.0
- RRF smoothing constant (k): 60

### When Hybrid is Used

- **--mode hybrid**: Always uses hybrid (fails if indexes missing)
- **Auto-detect**: Uses hybrid when both BM25 and semantic indexes exist
- **Fallback**: Degrades gracefully to semantic-only or keyword-only if one index is missing

## Pricing Data Maintenance

mdcontext uses hardcoded OpenAI pricing for embedding cost estimates. Prices change rarely for embedding models.

### Current Pricing

View current pricing data in `src/embeddings/openai-provider.ts`:

```typescript
export const PRICING_DATA = {
  lastUpdated: '2024-09',  // YYYY-MM format
  source: 'https://platform.openai.com/docs/pricing',
  prices: {
    'text-embedding-3-small': 0.02,  // per 1M tokens
    'text-embedding-3-large': 0.13,
    'text-embedding-ada-002': 0.10,
  }
}
```

### Staleness Warnings

Cost estimates show warning if pricing data is >90 days old:

```
Estimated cost: ~$0.0200 (pricing as of 2024-09)
⚠ Pricing data is 147 days old. May not reflect current rates.
```

Warnings are non-blocking - operations proceed normally.

### Updating Pricing (Maintainers)

**Quarterly check process:**

1. Visit https://platform.openai.com/docs/pricing
2. Update `PRICING_DATA.lastUpdated` to current YYYY-MM
3. Update `PRICING_DATA.prices` if prices changed
4. Commit: `git commit -m "chore: update OpenAI pricing data"`
5. Release new version

**Why manual:** Embedding API pricing changes infrequently (checked quarterly is sufficient). No reliable free API exists for automated updates.
