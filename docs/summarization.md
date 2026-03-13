# AI Summarization Architecture

This document covers the architecture and implementation details of mdcontext's AI-powered search result summarization feature.

## Overview

mdcontext can generate AI-powered summaries of search results using either:

1. **CLI tools** (Claude Code, Copilot CLI, OpenCode) - Free with your subscription
2. **API providers** (DeepSeek, Anthropic, OpenAI, Gemini) - Pay per query

The design prioritizes CLI providers as the primary option since they leverage existing subscriptions that developers already have.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI (search.ts)                          │
│  --summarize flag triggers summarization pipeline               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Provider Factory                               │
│  getBestAvailableSummarizer() / createSummarizer()              │
│  - Detects installed CLI tools                                   │
│  - Creates appropriate provider instance                         │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
┌─────────────────────┐       ┌─────────────────────┐
│   CLI Providers     │       │   API Providers     │
│   (Free)            │       │   (Pay-per-use)     │
│                     │       │                     │
│ - ClaudeCLI         │       │ - DeepSeek          │
│ - OpenCode          │       │ - Anthropic         │
│ - Copilot           │       │ - OpenAI            │
│ - Aider             │       │ - Gemini            │
│ - Cline             │       │ - Qwen              │
└─────────────────────┘       └─────────────────────┘
          │                               │
          └───────────────┬───────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Summarizer Interface                          │
│  summarize(input, prompt) → SummaryResult                       │
│  summarizeStream(input, prompt, options) → void                 │
│  estimateCost(inputTokens) → number                             │
│  isAvailable() → boolean                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### Provider Detection (`cli-providers/detection.ts`)

Automatically discovers installed CLI tools:

```typescript
import { detectInstalledCLIs } from './summarization/index.js'

const installed = await detectInstalledCLIs()
// [{ name: 'claude', command: 'claude', displayName: 'Claude Code', ... }]
```

Detection uses `which` (Unix) or `where` (Windows) via `spawn()` - never shell interpolation.

### Provider Factory (`provider-factory.ts`)

Creates summarizer instances based on configuration:

```typescript
import { createSummarizer, getBestAvailableSummarizer } from './summarization/index.js'

// Auto-detect best available provider
const result = await getBestAvailableSummarizer()
if (result) {
  const { summarizer, config } = result
  // Use summarizer...
}

// Or create from explicit config
const summarizer = await createSummarizer({
  mode: 'cli',
  provider: 'claude',
})
```

### Cost Estimation (`cost.ts`)

Estimates costs before execution:

```typescript
import { estimateSummaryCost, formatCostDisplay } from './summarization/index.js'

const estimate = estimateSummaryCost(inputText, 'api', 'deepseek')
// {
//   inputTokens: 2500,
//   outputTokens: 500,
//   estimatedCost: 0.0007,
//   provider: 'deepseek',
//   isPaid: true,
//   formattedCost: '$0.0007'
// }

console.log(formatCostDisplay(estimate))
// "Estimated cost: $0.0007"
```

CLI providers always return `isPaid: false` with `formattedCost: 'FREE (subscription)'`.

### Prompt Templates (`prompts.ts`)

Pre-built prompts for different summarization styles:

| Template | Description |
|----------|-------------|
| `default` | Balanced summary with key findings |
| `concise` | 2-3 sentence quick summary |
| `detailed` | Comprehensive analysis |
| `actionable` | Focus on next steps |
| `technical` | Code patterns and API details |

```typescript
import { buildPrompt } from './summarization/index.js'

const prompt = buildPrompt({
  query: 'authentication',
  resultCount: 10,
  searchMode: 'hybrid',
}, 'actionable')
```

### Error Handling (`error-handler.ts`)

Graceful degradation on failures:

```typescript
import { displaySummarizationError, isRecoverableError } from './summarization/index.js'

try {
  await summarizer.summarize(input, prompt)
} catch (error) {
  if (isRecoverableError(error)) {
    // Retry logic
  } else {
    displaySummarizationError(error)
    // Shows user-friendly message, search results still displayed
  }
}
```

## Security Considerations

### Shell Injection Prevention

All CLI invocations use `spawn()` with argument arrays - **NEVER** `exec()` with string interpolation:

```typescript
// CORRECT - Safe from shell injection
spawn('claude', ['-p', userInput, '--output-format', 'text'])

// WRONG - Vulnerable to shell injection
exec(`claude -p "${userInput}"`)  // NEVER DO THIS
```

This is enforced throughout the codebase. User input is passed as array elements, never interpolated into shell commands.

### API Key Handling

- API keys are sourced from environment variables only
- Never stored in config files
- Environment variable names follow provider conventions:
  - `DEEPSEEK_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `GOOGLE_API_KEY` (for Gemini)
  - `QWEN_API_KEY`

### Timeout Protection

CLI processes have a default 60-second timeout to prevent hung processes.

## Adding New Providers

### CLI Provider

1. Add to `KNOWN_CLIS` in `cli-providers/detection.ts`:

```typescript
{
  name: 'newcli',
  command: 'newcli',
  displayName: 'New CLI Tool',
  args: ['--prompt'],
  useStdin: false,
}
```

2. Create implementation in `cli-providers/newcli.ts`:

```typescript
import { spawn } from 'node:child_process'
import type { Summarizer, SummaryResult } from '../types.js'

export class NewCLISummarizer implements Summarizer {
  async summarize(input: string, prompt: string): Promise<SummaryResult> {
    // SECURITY: Always use spawn() with argument arrays
    const proc = spawn('newcli', ['--prompt', prompt, input])
    // ... implementation
  }

  async isAvailable(): Promise<boolean> {
    // Check if CLI is installed
  }
}
```

3. Add to factory in `provider-factory.ts`

### API Provider

1. Add pricing to `cost.ts`:

```typescript
export const API_PRICING = {
  // ... existing providers
  newapi: { input: 0.50, output: 1.00, displayName: 'New API' },
}
```

2. Create implementation using Vercel AI SDK (when implemented):

```typescript
import { createOpenAI } from '@ai-sdk/openai'

export class NewAPISummarizer implements Summarizer {
  // Use Vercel AI SDK for OpenAI-compatible APIs
}
```

## Performance

| Provider Type | Latency | Cost |
|--------------|---------|------|
| CLI (Claude) | 2-5s | Free |
| CLI (OpenCode) | 2-5s | Free |
| API (DeepSeek) | 1-3s | ~$0.0007/query |
| API (OpenAI) | 1-2s | ~$0.005/query |

### Token Limits

- Input is automatically truncated at 100K characters (~25K tokens)
- Result content is truncated to 500 chars per result
- Output tokens capped at 500 for cost estimates

## Configuration Reference

### Config File

```javascript
// mdcontext.config.js
/** @type {import('mdcontext').PartialMdContextConfig} */
export default {
  aiSummarization: {
    mode: 'cli',           // 'cli' or 'api'
    provider: 'claude',    // Provider name
    model: 'deepseek-chat', // Model for API providers
    stream: false,         // Enable streaming
  },
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MDM_AISUMMARIZATION_MODE` | 'cli' or 'api' |
| `MDM_AISUMMARIZATION_PROVIDER` | Provider name |
| `MDM_AISUMMARIZATION_MODEL` | Model name (API only) |
| `MDM_AISUMMARIZATION_STREAM` | 'true' or 'false' |

## Troubleshooting

### "CLI tool 'claude' not found"

**Solution:** Install Claude Code from https://claude.ai/download

### "CLI tool 'opencode' not found"

**Solution:** Install OpenCode from https://github.com/opencode-ai/opencode

### "Authentication failed for anthropic"

**Solution:** Set API key: `export ANTHROPIC_API_KEY=sk-...`

### "Rate limit exceeded"

**Solution:** Wait and retry. Consider switching to CLI provider (free).

### "Summarization failed: timeout"

**Solution:** Reduce result set with `--limit` or increase timeout in config.

### "No summarization providers available"

**Solution:** Either:
1. Install a CLI tool (Claude Code, OpenCode)
2. Configure an API provider with valid API key

### OpenCode JSON format errors

**Solution:** OpenCode JSON format is undocumented. Try updating OpenCode or switch to Claude CLI.

## Related Documentation

- [README.md](../README.md#ai-summarization) - Quick start guide
- [CONFIG.md](./CONFIG.md) - Full configuration reference
- [ERRORS.md](./ERRORS.md) - Error handling patterns
