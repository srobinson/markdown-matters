# OpenCode CLI Integration Research

**Research Date:** 2026-01-26
**Purpose:** Evaluate OpenCode CLI for non-interactive programmatic usage in mdcontext
**Status:** Complete

## Executive Summary

OpenCode CLI is a Go-based, open-source AI coding agent supporting 75+ LLM providers with robust non-interactive capabilities. It offers flexible provider selection, local-first privacy, and comprehensive CLI automation features. While it matches Claude CLI's output quality when using the same models, it lacks some advanced features like Claude's parallel subagent system and exclusive access to Opus 4.5.

**Key Verdict:** OpenCode is viable for mdcontext integration with caveats around timeout management and JSON output format documentation.

---

## 1. Non-Interactive Command Syntax

### Primary Command Structure

```bash
opencode run [message..]
```

The `run` command executes OpenCode in non-interactive mode, processing the prompt and exiting.

### Complete Flag Reference

| Flag | Short | Type | Purpose |
|------|-------|------|---------|
| `--command` | - | string | Specify custom command with arguments |
| `--continue` | `-c` | boolean | Resume previous session |
| `--session` | `-s` | string | Continue specific session by ID |
| `--model` | `-m` | string | Select model (format: provider/model) |
| `--agent` | - | string | Choose specific agent |
| `--file` | `-f` | path | Attach file(s) to message |
| `--format` | - | enum | Output format: "default" or "json" |
| `--title` | - | string | Custom session title |
| `--attach` | - | URL | Connect to running server (e.g., http://localhost:4096) |
| `--port` | - | number | Local server port (random default) |
| `--share` | - | boolean | Share the session |
| `--quiet` | `-q` | boolean | Suppress spinner animation |
| `--timeout` | - | number | Custom timeout in milliseconds (default: 120000) |
| `--print-logs` | - | boolean | Print logs to stderr |
| `--log-level` | - | enum | DEBUG, INFO, WARN, ERROR |
| `--cwd` | `-c` | path | Override working directory |
| `--debug` | `-d` | boolean | Enable debug mode |

### Additional Global Flags

```bash
opencode [global flags] [command]
  --refresh              # Update cached model list
```

---

## 2. Passing Prompts Without Interactive Mode

### Direct Prompt Syntax

```bash
# Basic usage
opencode run "Explain the use of context in Go"

# Legacy syntax (deprecated but still works)
opencode -p "Your prompt here"
```

### Context Injection Mechanisms

#### File Attachment with @

```bash
opencode run "Review the component in @src/components/Button.tsx"
opencode run "Compare @file1.ts and @file2.ts"
```

**Behavior:** File content is automatically included in the prompt.

#### Command Output Injection with !

```bash
opencode run "Analyze the git status: !git status"
opencode run "Review test failures: !npm test"
```

**Behavior:** Commands run in project root directory; output becomes part of prompt.

### Model Selection

```bash
# Specify model inline
opencode run -m anthropic/claude-sonnet-4-20250514 "Your prompt"

# Or via config
opencode run --model openai/gpt-4.1 "Your prompt"
```

**Format:** `provider/model-id`

### Session Continuation

```bash
# Continue last session
opencode run -c "Follow-up question"

# Continue specific session
opencode run -s session-uuid "Follow-up question"
```

---

## 3. Output Format

### Default Output

**Mode:** Formatted text stream to stdout
**Behavior:** Real-time streaming with optional spinner animation

```bash
opencode run "What is Go context?"
# Output: Formatted markdown-style response
```

### JSON Output

**Mode:** Structured JSON events
**Activation:** `--format json` flag

```bash
opencode run --format json "Your prompt"
```

#### JSON Schema Status

**Critical Gap:** Official JSON output schema is NOT documented. Search results confirm JSON format exists but provide no structure examples.

**Known Information:**
- Output appears to be event-based (SSE-style JSON events)
- Each event likely contains message chunks and metadata
- No official schema at `https://opencode.ai/docs/` as of Jan 2026

**Recommendation:** Requires empirical testing or source code inspection to determine exact format.

### Quiet Mode

```bash
opencode run -q "Your prompt"
opencode run --format json -q "Your prompt"  # Useful for scripting
```

**Effect:** Disables spinner animation; critical for CI/CD pipelines.

### Output Separation

**Stdout:** Agent responses and primary output
**Stderr:** Diagnostic information, logs (with `--print-logs`)

**Benefit:** CI/CD systems can capture streams separately.

---

## 4. Error Handling

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error/failure |
| Interrupted | Standard Unix interrupt codes |

**Source:** Standard Unix conventions; confirmed via error handling analysis.

### Stderr Messages

```bash
opencode run --print-logs --log-level ERROR "Your prompt" 2>errors.log
```

**Behavior:**
- Errors formatted via `FormatError()` before display
- Detailed error information written to log files in `~/.local/share/opencode/logs/`
- Log format: timestamp-based (e.g., `2025-01-09T123456.log`)
- Auto-cleanup: keeps only 10 most recent log files

### Known Error Handling Issues

#### Configuration Errors at Startup

**Issue:** TUI becomes unresponsive when config errors occur
**Workaround:** Validate config before launching
**Tracking:** [Issue #4245](https://github.com/sst/opencode/issues/4245)

#### Hanging on Certain Errors

**Issue:** `opencode run` hangs instead of exiting on certain errors
**Workaround:** Use timeout wrapper scripts
**Tracking:** [Issue #4506](https://github.com/sst/opencode/issues/4506)

#### Interactive Command Timeouts

**Issue:** Commands requiring interactive input (e.g., `npm create vite`) timeout
**Impact:** Cannot handle setup wizards
**Tracking:** [Issue #1656](https://github.com/sst/opencode/issues/1656)

### Timeout Behavior

**Default:** 120,000ms (2 minutes)
**Customization:**

```bash
# Command-line
opencode run --timeout 600000 "Long-running task"

# Config file
{
  "timeout": 600000
}
```

**Context:** Applies to bash command execution, not LLM response time.

---

## 5. Authentication & API Keys

### Configuration Methods

#### 1. Interactive Setup (Recommended)

```bash
opencode auth login
# Follow prompts to add provider credentials
```

**Storage:** `~/.local/share/opencode/auth.json`

#### 2. Environment Variables

```bash
# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."

# OpenAI
export OPENAI_API_KEY="sk-..."

# Google Gemini
export GEMINI_API_KEY="..."

# AWS Bedrock
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_REGION="us-east-1"

# Azure OpenAI
export AZURE_OPENAI_ENDPOINT="..."
export AZURE_OPENAI_API_KEY="..."

# GitHub Copilot
export GITHUB_TOKEN="ghp_..."

# Self-hosted (OpenAI-compatible)
export LOCAL_ENDPOINT="http://localhost:11434/v1"
```

#### 3. Config File References

```json
{
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "{env:ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

**Syntax:** `{env:VAR_NAME}` for environment variable substitution

### List Authenticated Providers

```bash
opencode auth list
```

### Logout from Provider

```bash
opencode auth logout [provider-name]
```

### Error Handling

**Missing API Key:**
- Exit code 1
- Stderr message indicating missing credentials
- Prompts to run `opencode auth login`

**Invalid API Key:**
- Forwarded error from provider API
- Exit code 1
- Detailed error in logs

---

## 6. Provider Selection

### Supported Providers (75+)

#### Major Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **Anthropic** | Claude 3.5, Claude 4, Claude 3.7 Sonnet | Primary provider |
| **OpenAI** | GPT-4.1, GPT-4.5, GPT-4o, O1, O3 | Full family support |
| **Google** | Gemini 2.0, 2.5 variants | Native integration |
| **AWS Bedrock** | Claude 3.7 Sonnet | Requires AWS credentials |
| **Groq** | Llama, Deepseek | High-speed inference |
| **Azure OpenAI** | Same as OpenAI | Enterprise support |
| **GitHub Copilot** | GPT, Claude, Gemini access | Experimental |
| **Local/Self-hosted** | Any OpenAI-compatible | Via `LOCAL_ENDPOINT` |

#### Full Provider List

Access via:
```bash
opencode models
opencode models --refresh  # Update cached list
```

### Provider Configuration Syntax

#### Basic Setup

```json
{
  "provider": {
    "anthropic": {
      "options": {
        "baseURL": "https://api.anthropic.com/v1",
        "apiKey": "{env:ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

#### Custom OpenAI-Compatible Provider

```json
{
  "provider": {
    "myprovider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My Custom Provider",
      "options": {
        "baseURL": "https://api.example.com/v1",
        "apiKey": "{env:CUSTOM_API_KEY}"
      },
      "models": {
        "custom-model-id": {
          "name": "Custom Model Name",
          "limit": {
            "context": 200000,
            "output": 65536
          }
        }
      }
    }
  }
}
```

### Provider Selection in Non-Interactive Mode

```bash
# Via model flag (provider/model format)
opencode run -m anthropic/claude-sonnet-4-20250514 "Your prompt"
opencode run -m openai/gpt-4.1 "Your prompt"
opencode run -m google/gemini-2.5-flash "Your prompt"

# Via config file default
{
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

### OpenCode Zen (Curated List)

**Purpose:** Pre-tested, verified models optimized for OpenCode
**Authentication:** Via `opencode.ai/auth`
**Access:** Displayed in `/models` command

---

## 7. Model Selection

### Command Syntax

```bash
# List available models
opencode models

# List models for specific provider
opencode models anthropic
opencode models openai

# Refresh cached model list
opencode models --refresh
```

### Model Selection Methods

#### 1. Command-Line Flag

```bash
opencode run -m anthropic/claude-sonnet-4-20250514 "Your prompt"
```

#### 2. Config File Default

```json
{
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

#### 3. Custom Command Override

```markdown
---
description: Run tests with coverage
model: anthropic/claude-3-5-sonnet-20241022
---
Run the full test suite...
```

#### 4. Agent-Specific Model

```json
{
  "agents": {
    "coder": {
      "model": "claude-3.7-sonnet"
    }
  }
}
```

### Model Naming Format

**Standard:** `provider/model-id`
**Examples:**
- `anthropic/claude-sonnet-4-20250514`
- `openai/gpt-4.1`
- `google/gemini-2.5-flash`
- `groq/llama-3.1-70b`

### Model Context Limits

Configured per model:

```json
{
  "provider": {
    "custom": {
      "models": {
        "model-id": {
          "limit": {
            "context": 200000,
            "output": 65536
          }
        }
      }
    }
  }
}
```

**Auto-compaction:** Sessions auto-compress at 95% context utilization.

---

## 8. Session Management

### Session Persistence

**Architecture:** Stateful with SQLite backend
**Storage:** `~/.local/share/opencode/sessions.db`

**Features:**
- Message history preservation
- Token usage tracking
- Cost accounting per session
- Auto-summarization at context limits

### Session Commands

```bash
# List all sessions
opencode session list

# Export session to JSON
opencode export [sessionID]

# Import session from JSON or share URL
opencode import <file>
opencode import <share-url>

# View token usage statistics
opencode stats
```

### Continuation in Non-Interactive Mode

#### Resume Last Session

```bash
opencode run -c "Follow-up question"
opencode run --continue "Follow-up question"
```

**Behavior:** Loads previous conversation context.

#### Resume Specific Session

```bash
opencode run -s <session-id> "Follow-up question"
opencode run --session <session-id> "Follow-up question"
```

### Stateless vs Stateful Behavior

**Default Mode:** Stateful
- Each `opencode run` creates/continues a session
- Context preserved between invocations with `-c` or `-s`

**Pseudo-Stateless Workaround:**
```bash
# New session each time (no continuation flags)
opencode run "Independent question"
```

**True Stateless:** Not explicitly supported; sessions always created.

### Session Sharing

```bash
# Enable sharing for session
opencode run --share "Your prompt"
```

**Output:** Shareable URL for session export.

### Context Compaction

**Trigger:** 95% context window utilization
**Mechanism:** `SummaryMessageID` field links to summary message
**Result:** Prior conversation summarized; token usage reduced

---

## 9. Context/File Passing

### File Attachment Methods

#### 1. Direct File Reference (@syntax)

```bash
opencode run "Review @src/App.tsx for bugs"
opencode run "Compare @package.json and @package-lock.json"
```

**Behavior:**
- File content injected into prompt
- Supports multiple files
- Paths relative to working directory

#### 2. Command-Line Flag

```bash
opencode run --file src/App.tsx "Review this file"
opencode run -f src/App.tsx -f src/utils.ts "Review these files"
```

**Capability:** Multiple `-f` flags supported.

#### 3. Command Output Injection (!syntax)

```bash
opencode run "Analyze git status: !git status"
opencode run "Review failing tests: !npm test 2>&1"
```

**Behavior:**
- Commands executed in project root
- Stdout/stderr captured and injected into prompt

### Working Directory Control

```bash
# Override working directory
opencode run -c /path/to/project "Your prompt"
opencode run --cwd /path/to/project "Your prompt"
```

**Default:** Current working directory.

### Built-in Context Tools

When running in agent mode (default behavior), OpenCode provides:

| Tool | Purpose |
|------|---------|
| `glob` | File pattern matching |
| `grep` | Content search |
| `ls` | Directory listing |
| `view` | Read file contents |
| `write` | Create/overwrite files |
| `edit` | Modify existing files |
| `patch` | Apply diffs |
| `bash` | Execute shell commands |
| `diagnostics` | LSP-based code intelligence |
| `fetch` | HTTP requests |
| `sourcegraph` | Public code search |

**Impact:** AI can autonomously gather context without explicit file passing.

---

## 10. Streaming vs Non-Streaming

### Interactive (TUI) Mode

**Architecture:** Real-time streaming via Server-Sent Events (SSE)

```bash
opencode serve
# Exposes HTTP endpoint at http://localhost:4096
# SSE endpoint: http://localhost:4096/sse
```

**Behavior:**
- Results persisted and broadcast to event bus in real-time
- TUI receives updates as they occur
- Any HTTP client subscribed to `/sse` can stream events

### Non-Interactive Mode

**Architecture:** Batch processing with optional progress indicator

```bash
# With spinner (default)
opencode run "Your prompt"

# Silent mode (no spinner)
opencode run -q "Your prompt"
opencode run --quiet "Your prompt"
```

**Output Behavior:**
- AI processes entire prompt
- Final result printed to stdout after completion
- No intermediate streaming to terminal

### Server-Attached Workflow

**Purpose:** Reduce cold-start times; maintain persistent backend

```bash
# Terminal 1: Start server
opencode serve

# Terminal 2: Attach to server for fast responses
opencode run --attach http://localhost:4096 "Your prompt"
```

**Benefit:** Server maintains loaded models and context; faster response times.

### JSON Format Streaming

```bash
opencode run --format json "Your prompt"
```

**Expected Behavior:** JSON events (likely nd-JSON or SSE-style)
**Documentation Gap:** Exact streaming format undocumented.

---

## 11. Privacy Features

### Local-First Architecture

**Core Principle:** Code never leaves your machine except via direct API calls to configured providers.

**Data Flow:**
1. User prompt → OpenCode CLI (local)
2. OpenCode → AI Provider API (direct HTTPS)
3. AI response → OpenCode CLI (local)
4. Results stored locally in SQLite

### Data Storage Locations

| Data Type | Path |
|-----------|------|
| Sessions/conversations | `~/.local/share/opencode/sessions.db` |
| Authentication credentials | `~/.local/share/opencode/auth.json` |
| Logs | `~/.local/share/opencode/logs/` |
| Config | `~/.config/opencode/opencode.json` |
| Custom commands | `~/.config/opencode/commands/` |

**All data remains on local filesystem.**

### Privacy with Local Models

When using self-hosted/local LLMs:

```bash
export LOCAL_ENDPOINT="http://localhost:11434/v1"
opencode run -m local/llama-3.1-70b "Your prompt"
```

**Maximum Privacy:** Code and data never leave your machine.

### Enterprise Privacy

**Feature:** Central config and SSO integration
**Benefit:** Data remains within organization's infrastructure
**Documentation:** See `https://opencode.ai/docs/enterprise/`

### Privacy Plugin: opencode-openmemory

**Repository:** `https://github.com/happycastle114/opencode-openmemory`
**Purpose:** Local-first, privacy-focused persistent memory for OpenCode agents
**Architecture:** Uses OpenMemory for local memory storage

### Privacy Documentation Status

**Issue:** Privacy practices not clearly documented
**Tracking:** [Issue #459](https://github.com/sst/opencode/issues/459) requests clarification
**Recommendation:** Users should review provider privacy policies (Anthropic, OpenAI, etc.)

### No Telemetry Confirmation

**Status:** Not explicitly documented
**Inference:** Local-first architecture suggests minimal telemetry
**Recommendation:** Inspect source code or network traffic for confirmation

---

## 12. Quirks & Gotchas

### 1. Timeout Management

**Default:** 120 seconds for command execution
**Problem:** Insufficient for long-running tests or builds

```bash
# Workaround: Increase timeout
opencode run --timeout 600000 "Run full test suite"
```

**Config Alternative:**
```json
{
  "timeout": 600000
}
```

**Reference:** [Issue #4197](https://github.com/sst/opencode/issues/4197)

---

### 2. Interactive Commands Fail

**Problem:** Commands requiring user input (e.g., `npm create vite`) timeout

```bash
opencode run "Set up new Vite project"
# AI attempts: npm create vite
# Result: Hangs waiting for input, then timeout
```

**Workaround:** Pre-configure projects outside OpenCode
**Reference:** [Issue #1656](https://github.com/sst/opencode/issues/1656)

---

### 3. Hanging on Errors

**Problem:** Some errors cause `opencode run` to hang instead of exiting

**Workaround:**
```bash
timeout 300 opencode run "Your prompt"
```

**Reference:** [Issue #4506](https://github.com/sst/opencode/issues/4506)

---

### 4. JSON Output Format Undocumented

**Problem:** `--format json` exists but schema not published

**Impact:** Integration requires empirical testing or source code inspection

**Workaround:** Test with sample prompts and analyze output structure

```bash
opencode run --format json "Hello world" > output.json
cat output.json | jq .
```

---

### 5. Model Selection Limitation (Resolved)

**Historical Issue:** Couldn't specify model in non-interactive mode
**Status:** Fixed; use `-m provider/model` flag
**Reference:** [Issue #277](https://github.com/opencode-ai/opencode/issues/277)

---

### 6. Code Reformatting Bug

**Problem:** Models attempt to reformat existing code unnecessarily

**Observation:** Multiple users report OpenCode reformatting code even when asked not to

**Impact:** May introduce style inconsistencies
**Workaround:** Use custom commands with explicit "do not reformat" instructions

---

### 7. Config File Ignored (Resolved)

**Historical Issue:** CLI ignored `~/.opencode.json`, always started in setup mode
**Status:** Fixed in recent versions
**Reference:** [Issue #698](https://github.com/sst/opencode/issues/698)

---

### 8. Help Output Incomplete

**Problem:** `opencode --help` doesn't list debug commands

**Cause:** Missing `describe` property in yargs command definitions
**Reference:** [Issue #7330](https://github.com/anomalyco/opencode/issues/7330)

**Workaround:** Check documentation at `https://opencode.ai/docs/cli/`

---

### 9. Auto-Approval in Non-Interactive Mode

**Behavior:** All permissions auto-approved when using `opencode run`

**Implication:** AI can execute bash commands, modify files without confirmation

**Mitigation:** Use with trusted prompts or implement wrapper script with approval logic

---

### 10. Session Auto-Creation

**Behavior:** Every `opencode run` creates a session, even for one-off queries

**Implication:** Session database grows over time

**Workaround:** Periodic cleanup via session management commands

---

## 13. Comparison: OpenCode CLI vs Claude CLI

### Architecture

| Aspect | OpenCode | Claude CLI |
|--------|----------|------------|
| **Language** | Go | Node.js |
| **Open Source** | Yes (moved to Crush project) | No (Anthropic proprietary) |
| **Provider Support** | 75+ providers | Anthropic only |
| **Local Models** | Yes (OpenAI-compatible) | No |

### Pricing

| Aspect | OpenCode | Claude CLI |
|--------|----------|------------|
| **Tool Cost** | Free (open source) | $17-100/month/developer |
| **API Costs** | Pay per provider | Anthropic API costs |
| **Total Cost** | API only | Subscription + API |

### Performance & Quality

| Aspect | OpenCode | Claude CLI |
|--------|----------|------------|
| **Output Quality** | Matches Claude CLI when using same model | Native Claude integration |
| **Exclusive Models** | None | Opus 4.5 with thinking mode |
| **Speed** | Comparable | Comparable |
| **Reverse Engineering** | Based on Claude CLI logic | Original implementation |

**Source:** Andrea Grandi's testing confirms "can't tell the difference" in code quality when using same models.

### Advanced Features

| Feature | OpenCode | Claude CLI |
|---------|----------|------------|
| **Parallel Subagents** | No | Yes (build frontend/backend simultaneously) |
| **Thinking Mode** | No | Yes (Opus 4.5 extended reasoning) |
| **Checkpoint System** | No | Yes (instant rewind to previous states) |
| **Custom Commands** | Yes (markdown templates) | Yes (slash commands) |
| **MCP Support** | Yes | Yes |
| **LSP Integration** | Yes (diagnostics tool) | Yes |
| **Remote Control** | Yes (Go architecture) | Limited |

### Non-Interactive Mode

| Aspect | OpenCode | Claude CLI |
|--------|----------|------------|
| **Command** | `opencode run` | `claude -p` (headless mode) |
| **Model Selection** | `-m provider/model` | Built-in (Claude models only) |
| **File Attachment** | `-f` flag or `@file` syntax | Similar |
| **JSON Output** | `--format json` (undocumented schema) | Structured output options |
| **CI/CD Integration** | Supported | Explicitly designed for CI/CD |
| **Session Continuation** | `-c` or `-s session-id` | Similar |

### Ecosystem Integration

| Aspect | OpenCode | Claude CLI |
|--------|----------|------------|
| **VS Code Extension** | Community projects | Official Anthropic extension |
| **npm Ecosystem** | Limited (Go-based) | Native (Node.js) |
| **GitHub Actions** | Community workflows | Official integration |
| **IDE Integration** | Via MCP | Native Anthropic integrations |

### Privacy & Security

| Aspect | OpenCode | Claude CLI |
|--------|----------|------------|
| **Local-First** | Yes | Unclear (proprietary) |
| **Data Storage** | SQLite (local) | Unknown |
| **API Direct Calls** | Yes | Yes (via Anthropic) |
| **Telemetry** | Minimal/none (inferred) | Unknown |

### User Experience

| Aspect | OpenCode | Claude CLI |
|--------|----------|------------|
| **Learning Curve** | Moderate | Low (Anthropic polish) |
| **Documentation** | Community-driven | Official Anthropic docs |
| **Bug Frequency** | Higher (open source) | Lower (commercial QA) |
| **Update Frequency** | Community-driven | Anthropic release schedule |

### Recommendation Matrix

| Use Case | Recommended Tool | Reason |
|----------|------------------|--------|
| **Budget-constrained** | OpenCode | No subscription fee |
| **Multi-provider** | OpenCode | 75+ provider support |
| **Local/private LLMs** | OpenCode | OpenAI-compatible endpoint support |
| **Production reliability** | Claude CLI | Commercial support, QA |
| **Complex workflows** | Claude CLI | Parallel subagents, thinking mode |
| **Experimentation** | OpenCode | Model flexibility |
| **Enterprise (Anthropic)** | Claude CLI | Official support, SLA |
| **Quick prototyping** | Either | Both work well |

### Expert Opinion

**Andrea Grandi (extensive testing):**
> "Claude was hands down the best overall… but if you have time to experiment, use OpenCode with Sonnet-4. Otherwise, use Claude Code."

**Key Insight:** OpenCode matches Claude in quality when using Claude models, but Claude CLI's exclusive features (Opus 4.5, subagents) provide edge for complex tasks.

---

## 14. mdcontext Integration Recommendations

### Use Case Analysis

**mdcontext Goal:** Programmatic LLM invocation for file summarization

**Requirements:**
1. Non-interactive batch processing
2. File content as context
3. Structured or parseable output
4. Cost transparency (multiple provider support)
5. Error handling for automation
6. Timeout management for large files

### Recommended Approach

#### 1. Primary Command Pattern

```bash
opencode run \
  --format json \
  --quiet \
  --timeout 300000 \
  --model anthropic/claude-sonnet-4-20250514 \
  "Summarize this file in markdown format: @$FILE_PATH"
```

**Rationale:**
- `--format json`: Structured output (requires testing to parse)
- `--quiet`: No spinner for scripting
- `--timeout 300000`: 5 minutes for large files
- `--model`: Explicit provider/model selection

#### 2. Alternative: Text Output with Parsing

```bash
opencode run \
  --quiet \
  --timeout 300000 \
  --model anthropic/claude-sonnet-4-20250514 \
  "Summarize this file in markdown format with YAML frontmatter: @$FILE_PATH"
```

**Parse stdout** with regex or structured format enforcement.

#### 3. Server-Attached Mode (Performance)

```bash
# Startup (once)
opencode serve --port 4096 &

# Per-file invocation (faster)
opencode run \
  --attach http://localhost:4096 \
  --format json \
  --quiet \
  "Summarize @$FILE_PATH"
```

**Benefit:** Reduced cold-start latency for batch operations.

### Configuration Setup

#### opencode.json

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-20250514",
  "timeout": 300000,
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "{env:ANTHROPIC_API_KEY}"
      }
    },
    "openai": {
      "options": {
        "apiKey": "{env:OPENAI_API_KEY}"
      }
    }
  }
}
```

#### Custom Command (Optional)

**File:** `~/.config/opencode/commands/summarize-file.md`

```markdown
---
description: Summarize a file for mdcontext
model: anthropic/claude-sonnet-4-20250514
---
Analyze the following file and create a concise summary in markdown format.

Include:
- Purpose of the file
- Key functions/classes/exports
- Dependencies
- Notable patterns or algorithms

File: $1

Output format: Pure markdown, no code fences.
```

**Usage:**
```bash
opencode run --command summarize-file --file path/to/file.ts
```

### Error Handling Strategy

#### Wrapper Script Pattern

```bash
#!/usr/bin/env bash

set -euo pipefail

FILE_PATH="$1"
OUTPUT_FILE="$2"
TIMEOUT=300

# Run with timeout wrapper
if ! timeout $TIMEOUT opencode run \
  --quiet \
  --format json \
  --model anthropic/claude-sonnet-4-20250514 \
  "Summarize @$FILE_PATH" > "$OUTPUT_FILE" 2>error.log; then

  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 124 ]; then
    echo "Error: OpenCode timeout after ${TIMEOUT}s" >&2
    exit 2
  elif [ $EXIT_CODE -eq 1 ]; then
    echo "Error: OpenCode execution failed" >&2
    cat error.log >&2
    exit 1
  else
    echo "Error: Unknown failure (code $EXIT_CODE)" >&2
    exit $EXIT_CODE
  fi
fi

# Validate JSON output
if ! jq empty "$OUTPUT_FILE" 2>/dev/null; then
  echo "Error: Invalid JSON output" >&2
  exit 3
fi
```

### Output Parsing (JSON Format)

**Critical Action Required:** Empirical testing of `--format json` output.

**Test Command:**
```bash
opencode run --format json --quiet "Say hello" > test-output.json
cat test-output.json | jq .
```

**Expected Possibilities:**
1. Single JSON object with `response` field
2. nd-JSON (newline-delimited JSON events)
3. SSE-style JSON events

**Parsing Strategy:** Adjust based on actual format.

### Cost Tracking Integration

**Advantage:** OpenCode supports multiple providers; mdcontext can compare costs.

**Providers to Support:**
- `anthropic/claude-sonnet-4-20250514` (high quality)
- `openai/gpt-4o` (alternative)
- `google/gemini-2.5-flash` (cost-effective)
- `groq/llama-3.1-70b` (high-speed, low-cost)

**Implementation:**
```bash
# Provider rotation for cost testing
for provider in "anthropic/claude-sonnet-4" "openai/gpt-4o" "google/gemini-2.5-flash"; do
  opencode run -m "$provider" "Summarize @$FILE_PATH" > "summary-${provider//\//-}.txt"
done
```

**Cost Analysis:** Use `opencode stats` to track token usage and costs.

### Integration Risks

| Risk | Mitigation |
|------|------------|
| **JSON format changes** | Version-pin OpenCode in docs; test before upgrades |
| **Hanging on errors** | Wrap with `timeout` command |
| **Session database growth** | Periodic cleanup in docs |
| **Auto-approval risk** | Document security implications; recommend sandboxing |
| **Provider API changes** | Test multiple providers; failover logic |

### Testing Checklist

- [ ] Verify `--format json` output structure
- [ ] Test timeout behavior with large files
- [ ] Confirm exit codes for error scenarios
- [ ] Validate stderr separation for errors
- [ ] Benchmark server-attached vs direct invocation
- [ ] Test file attachment with @syntax and --file flag
- [ ] Verify model selection across providers
- [ ] Test session continuation (if needed for multi-file context)

---

## 15. Official Documentation & Resources

### Primary Sources

- **Official Docs:** [https://opencode.ai/docs/](https://opencode.ai/docs/)
- **CLI Reference:** [https://opencode.ai/docs/cli/](https://opencode.ai/docs/cli/)
- **Commands:** [https://opencode.ai/docs/commands/](https://opencode.ai/docs/commands/)
- **Providers:** [https://opencode.ai/docs/providers/](https://opencode.ai/docs/providers/)
- **Config:** [https://opencode.ai/docs/config/](https://opencode.ai/docs/config/)
- **Troubleshooting:** [https://opencode.ai/docs/troubleshooting/](https://opencode.ai/docs/troubleshooting/)

### GitHub Resources

- **Main Repository:** [https://github.com/opencode-ai/opencode](https://github.com/opencode-ai/opencode)
  - **Status:** Moved to Crush project (Charm team) as of Sept 2025
  - **Archive:** Read-only
- **Crush (Successor):** [https://github.com/charmbracelet/crush](https://github.com/charmbracelet/crush)
- **Awesome OpenCode:** [https://github.com/awesome-opencode/awesome-opencode](https://github.com/awesome-opencode/awesome-opencode)

### Community Resources

- **DeepWiki OpenCode:** Multiple technical deep-dives
- **Discord/Community:** Via opencode.ai (authentication flows)

### Installation Guide

[https://opencode.ai/docs/](https://opencode.ai/docs/) - Installation section

### Comparison Articles

- **OpenCode vs Claude Code (Builder.io):** [https://www.builder.io/blog/opencode-vs-claude-code](https://www.builder.io/blog/opencode-vs-claude-code)
- **Andrea Grandi Comparison:** [https://www.andreagrandi.it/posts/comparing-claude-code-vs-opencode-testing-different-models/](https://www.andreagrandi.it/posts/comparing-claude-code-vs-opencode-testing-different-models/)
- **NovaKit Blog:** [https://www.novakit.ai/blog/claude-code-vs-opencode-cli-comparison](https://www.novakit.ai/blog/claude-code-vs-opencode-cli-comparison)

### GitHub Issues (Key)

- **Timeout Management:** [#4197](https://github.com/sst/opencode/issues/4197)
- **Interactive Commands:** [#1656](https://github.com/sst/opencode/issues/1656)
- **Hanging on Errors:** [#4506](https://github.com/sst/opencode/issues/4506)
- **Config Errors:** [#4245](https://github.com/sst/opencode/issues/4245)
- **Privacy Clarification:** [#459](https://github.com/sst/opencode/issues/459)
- **Model Selection in Non-Interactive:** [#277](https://github.com/opencode-ai/opencode/issues/277) (resolved)
- **Help Output Incomplete:** [#7330](https://github.com/anomalyco/opencode/issues/7330)

---

## 16. Concrete Command Examples

### Example 1: Basic File Summarization

```bash
opencode run "Summarize this TypeScript file: @src/parser.ts"
```

**Output:** Formatted text to stdout.

---

### Example 2: JSON Output for Parsing

```bash
opencode run \
  --format json \
  --quiet \
  "Create a summary of @README.md in JSON format with fields: purpose, features, installation" \
  > summary.json
```

**Expected JSON** (format requires testing):
```json
{
  "response": "...",
  "metadata": { ... }
}
```

---

### Example 3: Multiple Files with Context

```bash
opencode run "Compare @src/old-api.ts and @src/new-api.ts. List breaking changes."
```

---

### Example 4: Command Output Integration

```bash
opencode run "Analyze the git diff: !git diff main...feature-branch"
```

---

### Example 5: Specific Model Selection

```bash
opencode run \
  -m google/gemini-2.5-flash \
  "Summarize this file cost-effectively: @data/large-dataset.json"
```

---

### Example 6: Session Continuation

```bash
# First invocation
opencode run "Summarize @app.ts"

# Follow-up question (continues context)
opencode run -c "What are the security implications?"
```

---

### Example 7: Server-Attached for Performance

```bash
# Terminal 1
opencode serve --port 4096

# Terminal 2 (multiple fast invocations)
for file in src/*.ts; do
  opencode run \
    --attach http://localhost:4096 \
    --quiet \
    "Summarize @$file" > "summaries/${file%.ts}.md"
done
```

---

### Example 8: Custom Timeout for Large Files

```bash
opencode run \
  --timeout 600000 \
  --model anthropic/claude-sonnet-4-20250514 \
  "Analyze this large codebase: @monorepo/packages/**/*.ts"
```

**Note:** Glob patterns require testing; may need explicit listing.

---

### Example 9: Error Handling Wrapper

```bash
#!/usr/bin/env bash
if ! opencode run -q "Summarize @$1" > output.txt 2>error.log; then
  echo "OpenCode failed. Error log:"
  cat error.log
  exit 1
fi
```

---

### Example 10: Custom Command Invocation

```bash
# Using custom command (see section 14)
opencode run --command summarize-file src/utils.ts
```

---

## 17. Recommendations for mdcontext

### Immediate Actions

1. **Test JSON Output Format**
   ```bash
   opencode run --format json -q "Hello world" > test.json
   jq . test.json
   ```
   Determine exact schema for parsing.

2. **Create Wrapper Script** (see section 14) with:
   - Timeout handling
   - Exit code checking
   - Output validation
   - Error logging

3. **Document Provider Options**
   - Anthropic (high quality)
   - OpenAI (alternative)
   - Gemini (cost-effective)
   - Groq (high-speed)

4. **Establish Cost Baseline**
   ```bash
   opencode stats
   ```
   Track token usage across providers.

### Integration Pattern

**Recommended Flow:**
```
mdcontext → wrapper script → opencode run → JSON output → parser → summarized content
```

**Error Recovery:**
- Retry with increased timeout
- Fallback to alternative provider
- Log failures for manual review

### Performance Optimization

For batch processing:
1. Start `opencode serve` at mdcontext initialization
2. Use `--attach` for all file summarizations
3. Shutdown server at cleanup

**Expected Improvement:** 30-50% faster than cold starts (estimate; requires benchmarking).

### Security Considerations

**Auto-Approval Risk:** OpenCode in non-interactive mode auto-approves all actions.

**Mitigation:**
- Craft prompts to avoid bash execution (e.g., "Summarize" not "Analyze and fix")
- Run in sandboxed environment (Docker/VM) if processing untrusted files
- Review custom commands for unintended side effects

### Maintenance Strategy

**Version Pinning:**
- Document tested OpenCode version
- Test before upgrading
- Monitor Crush project (successor) for migration path

**Fallback Plan:**
- Maintain Claude CLI integration as alternative
- Document cost differences for user choice

---

## 18. Key Differences from Claude CLI

### Syntax Differences

| Task | OpenCode CLI | Claude CLI |
|------|-------------|------------|
| **Non-interactive prompt** | `opencode run "prompt"` | `claude -p "prompt"` |
| **Model selection** | `-m provider/model` | Built-in (Claude only) |
| **File attachment** | `@file` or `-f file` | Similar |
| **JSON output** | `--format json` | Structured output options |
| **Quiet mode** | `-q` or `--quiet` | Similar |
| **Session continuation** | `-c` or `-s id` | Similar |

### Provider Flexibility

**OpenCode Advantage:**
- 75+ providers (Anthropic, OpenAI, Google, Groq, Azure, AWS, local)
- Cost comparison across providers
- Custom OpenAI-compatible endpoints

**Claude CLI Limitation:**
- Anthropic models only
- No multi-provider support

### Missing OpenCode Features (vs Claude CLI)

1. **Parallel Subagents:** Claude can build frontend/backend simultaneously
2. **Thinking Mode:** Opus 4.5 extended reasoning (Claude exclusive)
3. **Checkpoint System:** Instant rewind to previous states
4. **Production Polish:** Claude CLI has commercial QA and support

### OpenCode Advantages

1. **Zero Subscription Cost:** Free tool (API costs only)
2. **Local Model Support:** Privacy-first option
3. **Provider Flexibility:** Switch based on cost/performance/features
4. **Open Source:** Community contributions, transparency

### When to Choose OpenCode Over Claude CLI

- **Budget constraints:** No subscription fee
- **Multi-provider experimentation:** Test cost/quality tradeoffs
- **Local/private LLMs:** Maximum privacy
- **Open source preference:** Transparency, customization

### When to Choose Claude CLI Over OpenCode

- **Production critical systems:** Commercial support, SLA
- **Complex workflows:** Parallel subagents, thinking mode
- **Exclusive features:** Opus 4.5 access
- **Minimal setup time:** Anthropic-optimized defaults

---

## 19. Conclusion

### Summary

OpenCode CLI is a viable alternative to Claude CLI for mdcontext integration, offering:

**Strengths:**
- Flexible multi-provider support (75+ models)
- Cost-effective (no subscription)
- Robust non-interactive mode
- Local-first privacy
- Active open source community

**Weaknesses:**
- JSON output format undocumented (requires testing)
- Occasional hanging on errors
- Timeout management needs tuning
- Less polished than commercial Claude CLI

### Viability for mdcontext

**Verdict:** **Recommended with caveats**

OpenCode can serve as mdcontext's LLM integration layer, provided:
1. JSON output format is tested and validated
2. Wrapper script handles timeouts and errors
3. Provider options are documented for users
4. Security implications (auto-approval) are clear

**Alternative Strategy:** Support both OpenCode and Claude CLI, letting users choose based on budget/features.

### Next Steps

1. **Empirical Testing:** Validate JSON output format
2. **Wrapper Implementation:** Robust error handling and timeout management
3. **Cost Benchmarking:** Compare providers for file summarization task
4. **Documentation:** User-facing guide for provider selection
5. **Security Review:** Assess auto-approval risks for untrusted codebases

---

## Sources

- [CLI | OpenCode](https://opencode.ai/docs/cli/)
- [GitHub - opencode-ai/opencode](https://github.com/opencode-ai/opencode)
- [Commands | OpenCode](https://opencode.ai/docs/commands/)
- [Providers | OpenCode](https://opencode.ai/docs/providers/)
- [Config | OpenCode](https://opencode.ai/docs/config/)
- [Troubleshooting | OpenCode](https://opencode.ai/docs/troubleshooting/)
- [Comparing Claude Code vs OpenCode - Andrea Grandi](https://www.andreagrandi.it/posts/comparing-claude-code-vs-opencode-testing-different-models/)
- [OpenCode vs Claude Code - Builder.io](https://www.builder.io/blog/opencode-vs-claude-code)
- [OpenCode vs Claude Code - Daniel Miessler](https://danielmiessler.com/blog/opencode-vs-claude-code)
- [Claude Code vs OpenCode CLI - NovaKit](https://www.novakit.ai/blog/claude-code-vs-opencode-cli-comparison)
- [Set timeout for long running commands - Issue #4197](https://github.com/sst/opencode/issues/4197)
- [Timeout when running commands - Issue #1656](https://github.com/sst/opencode/issues/1656)
- [Bug: opencode run hangs - Issue #4506](https://github.com/sst/opencode/issues/4506)
- [Unable to Exit OpenCode TUI - Issue #4245](https://github.com/sst/opencode/issues/4245)
- [Privacy and Data Collection - Issue #459](https://github.com/sst/opencode/issues/459)
- [Unable to specify model - Issue #277](https://github.com/opencode-ai/opencode/issues/277)
- [Debug command not visible in help - Issue #7330](https://github.com/anomalyco/opencode/issues/7330)
- [opencode-openmemory - Local-first memory plugin](https://github.com/happycastle114/opencode-openmemory)

---

**End of Research Document**
