# Claude Code CLI Integration Guide (2026)

> Comprehensive guide for non-interactive programmatic usage of the `claude` command for mdcontext integration

**Last Updated**: 2026-01-26
**Claude Code Version**: 2.1.19
**Target Use Case**: Automated codebase summarization in mdcontext

---

## Table of Contents

1. [Overview](#overview)
2. [Non-Interactive Command Syntax](#non-interactive-command-syntax)
3. [Passing Prompts](#passing-prompts)
4. [Output Formats](#output-formats)
5. [Error Handling](#error-handling)
6. [Authentication](#authentication)
7. [Rate Limiting](#rate-limiting)
8. [Session Management](#session-management)
9. [Context & File Passing](#context--file-passing)
10. [Model Selection](#model-selection)
11. [Streaming vs Non-Streaming](#streaming-vs-non-streaming)
12. [Tool Management](#tool-management)
13. [Practical Examples](#practical-examples)
14. [mdcontext Integration Recommendations](#mdcontext-integration-recommendations)
15. [Gotchas & Limitations](#gotchas--limitations)

---

## Overview

The Claude Code CLI provides the `-p` (or `--print`) flag for non-interactive programmatic usage. This mode executes a single query and outputs results directly without the interactive chat interface.

**Key Features:**
- Non-interactive execution
- Multiple output formats (text, JSON, streaming JSON)
- Tool permission control
- Session continuity
- Structured output with JSON Schema
- Budget controls
- Custom system prompts

---

## Non-Interactive Command Syntax

### Basic Usage

```bash
claude -p "Your prompt here"
```

### With Options

```bash
claude -p [prompt] [options]

# Or via stdin
echo "Your prompt" | claude -p [options]
```

### Critical Requirements

1. **Input is mandatory**: Must provide input via prompt argument OR stdin
2. **Trust bypass**: The `-p` flag automatically skips workspace trust dialog - only use in trusted directories
3. **No interactive prompts**: All tool permissions must be pre-approved via flags

**Exit on missing input:**
```bash
claude -p
# Error: Input must be provided either through stdin or as a prompt argument when using --print
# Exit code: 1
```

---

## Passing Prompts

### Three Methods

#### 1. Command Argument (Preferred for simple prompts)

```bash
claude -p "Summarize this project"
```

#### 2. Stdin (Preferred for complex/multiline prompts)

```bash
echo "Analyze the codebase structure" | claude -p

# Or from file
cat prompt.txt | claude -p
```

#### 3. Piped Context (Powerful for contextual analysis)

```bash
# Analyze PR diff
gh pr diff 123 | claude -p "Review for security issues"

# Analyze logs
cat error.log | claude -p "Identify patterns and suggest fixes"

# Analyze specific files
cat src/auth.ts | claude -p "Explain this authentication flow"
```

### Prompt Best Practices

1. **Be specific**: "Extract all function names from auth.py" > "analyze auth.py"
2. **Include constraints**: "Summarize in 3 bullet points" constrains output
3. **Specify format**: "Return as JSON array" for structured output
4. **Combine with context**: Pipe file contents for better analysis

---

## Output Formats

### Three Format Options

Set via `--output-format` flag:

#### 1. Text Format (Default)

**Use case**: Human-readable output, simple scripts

```bash
claude -p "What is 2+2?"
# Output: 2 + 2 = 4
```

**Characteristics:**
- Plain text response
- No metadata
- Easy to parse for simple cases
- Default if `--output-format` not specified

#### 2. JSON Format

**Use case**: Programmatic processing, metadata extraction

```bash
claude -p "Summarize this project" --output-format json
```

**Output Structure:**
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 3964,
  "duration_api_ms": 3251,
  "num_turns": 1,
  "result": "Project is a CLI tool for...",
  "session_id": "e0f0783c-29c8-43fa-8e55-8c96a920644c",
  "total_cost_usd": 0.062059500000000004,
  "usage": {
    "input_tokens": 2,
    "cache_creation_input_tokens": 15322,
    "cache_read_input_tokens": 14070,
    "output_tokens": 25,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 0,
      "ephemeral_5m_input_tokens": 15322
    }
  },
  "modelUsage": {
    "claude-sonnet-4-5-20250929": {
      "inputTokens": 2,
      "outputTokens": 25,
      "cacheReadInputTokens": 14070,
      "cacheCreationInputTokens": 15322,
      "webSearchRequests": 0,
      "costUSD": 0.062059500000000004,
      "contextWindow": 200000,
      "maxOutputTokens": 64000
    }
  },
  "permission_denials": [],
  "uuid": "feeed03d-a79c-442f-9040-0be9f0a45ea8"
}
```

**Extract result with jq:**
```bash
claude -p "Summarize this project" --output-format json | jq -r '.result'
```

**Extract cost:**
```bash
claude -p "Analyze code" --output-format json | jq -r '.total_cost_usd'
```

#### 3. Stream-JSON Format

**Use case**: Real-time streaming, progress monitoring, event processing

```bash
claude -p "Long analysis task" --output-format stream-json --verbose
```

**Requires**: `--verbose` flag when used with `--print`

**Output Format**: Newline-delimited JSON (NDJSON)

**Event Types:**
```json
{"type":"system","subtype":"init","session_id":"...","tools":[...],"model":"claude-sonnet-4-5-20250929"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Analyzing..."}]}}
{"type":"result","subtype":"success","result":"Final answer","total_cost_usd":0.05}
```

**Process with jq:**
```bash
# Extract only text deltas
claude -p "Analyze" --output-format stream-json --verbose |
  jq -j '.event.delta.text? // empty'

# Filter specific event types
claude -p "Analyze" --output-format stream-json --verbose |
  jq 'select(.type == "assistant")'
```

**Note**: When using `--json-schema`, structured output only appears in final result, not during streaming.

---

## Error Handling

### Exit Codes

| Exit Code | Meaning | Example |
|-----------|---------|---------|
| 0 | Success | Normal completion |
| 1 | General failure | Invalid input, API errors, budget exceeded |
| 124 | Timeout (via external timeout) | `timeout 5 claude -p "..."` |
| 127 | Command not found | Claude CLI not installed |

### Error Detection

```bash
# Check exit code
claude -p "test" --output-format json
if [ $? -eq 0 ]; then
  echo "Success"
else
  echo "Failed"
fi

# With JSON output
result=$(claude -p "test" --output-format json)
is_error=$(echo "$result" | jq -r '.is_error')
if [ "$is_error" = "true" ]; then
  echo "Error occurred"
fi
```

### Common Errors

#### 1. Missing Input

```bash
claude -p
# Error: Input must be provided either through stdin or as a prompt argument when using --print
# Exit code: 1
```

#### 2. Invalid Model

```bash
claude -p "test" --model invalid-model
# API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: invalid-model"}}
# Exit code: 1
```

#### 3. Budget Exceeded

```bash
claude -p "Analyze everything" --max-budget-usd 0.01
# Error: Exceeded USD budget (0.01)
# Exit code: 1
```

#### 4. Rate Limiting (429 Error)

```bash
# Too many requests
# API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"..."}}
# Exit code: 1
```

**Response includes `retry-after` header indicating wait time**

#### 5. Authentication Error (401)

```bash
# Invalid or missing API key
# API Error: 401 {"type":"error","error":{"type":"authentication_error"}}
# Exit code: 1
```

### Error Handling Pattern

```bash
#!/bin/bash

handle_claude_error() {
  local exit_code=$?
  local stderr_output="$1"

  case $exit_code in
    0)
      return 0
      ;;
    1)
      if echo "$stderr_output" | grep -q "rate_limit_error"; then
        echo "Rate limited, retrying in 60s..."
        sleep 60
        return 2  # Retry signal
      elif echo "$stderr_output" | grep -q "Budget exceeded"; then
        echo "Budget exceeded, aborting"
        return 1
      else
        echo "API error: $stderr_output"
        return 1
      fi
      ;;
    124)
      echo "Timeout"
      return 1
      ;;
    *)
      echo "Unknown error: $exit_code"
      return 1
      ;;
  esac
}

# Usage
output=$(claude -p "test" 2>&1)
exit_code=$?
handle_claude_error "$output" || exit 1
```

---

## Authentication

### Authentication Methods

Claude Code supports multiple authentication methods, prioritized in this order:

1. **Environment variable API key** (highest priority)
2. **Subscription-based authentication** (Claude Pro/Team via browser login)
3. **Azure Auth**
4. **Bedrock Auth**
5. **Vertex Auth**

### Setting API Key

```bash
# Environment variable (priority over subscription)
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# Now all claude commands use API key
claude -p "test"
```

**Warning**: When API key is set via environment variable, you're charged via API pay-as-you-go rates, even if you have a subscription.

### Check Authentication Status

```bash
# In interactive mode (not available in -p mode)
/status

# Shows which authentication method is active
```

### Programmatic API Key Management

Use `apiKeyHelper` setting to run a shell script that returns an API key:

```bash
# In settings.json
{
  "apiKeyHelper": "/path/to/script-that-returns-key.sh"
}
```

**Behavior:**
- Called after 5 minutes of inactivity
- Called on HTTP 401 response
- Can refresh expired keys automatically

### Authentication Check Pattern

```bash
# Test if authenticated
if claude -p "test" --output-format json >/dev/null 2>&1; then
  echo "Authenticated"
else
  echo "Authentication failed"
  exit 1
fi
```

### Credential Storage

- **macOS**: API keys and OAuth tokens stored in encrypted Keychain
- **Linux/Windows**: Implementation-specific secure storage

---

## Rate Limiting

### Rate Limit Types

Claude API enforces organization-level rate limits:

1. **Requests per minute (RPM)**: Total API requests
2. **Input tokens per minute (ITPM)**: Input token consumption
3. **Output tokens per minute (OTPM)**: Output token generation

**Important**: Limits are **organization-wide**, not per API key. All keys under your account share the same limit pool.

### Rate Limit Algorithm

Uses **token bucket algorithm**:
- Capacity continuously replenished up to maximum
- Not reset at fixed intervals
- Smooth rate limiting, not burst-then-wait

### Rate Limit Errors

When exceeded, you receive:
```json
{
  "type": "error",
  "error": {
    "type": "rate_limit_error",
    "message": "Number of requests has exceeded your per-minute rate limit"
  }
}
```

**Includes `retry-after` header** with wait time in seconds.

### Handling Rate Limits

```bash
#!/bin/bash

MAX_RETRIES=3
RETRY_DELAY=60

for i in $(seq 1 $MAX_RETRIES); do
  output=$(claude -p "Analyze code" --output-format json 2>&1)
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    echo "$output"
    exit 0
  fi

  if echo "$output" | grep -q "rate_limit_error"; then
    echo "Rate limited, retry $i/$MAX_RETRIES in ${RETRY_DELAY}s"
    sleep $RETRY_DELAY
  else
    echo "Error: $output"
    exit 1
  fi
done

echo "Max retries exceeded"
exit 1
```

### Cost Tracking

Track costs in real-time with JSON output:

```bash
total_cost=0

for file in src/*.ts; do
  result=$(claude -p "Summarize $file" --output-format json)
  cost=$(echo "$result" | jq -r '.total_cost_usd')
  total_cost=$(echo "$total_cost + $cost" | bc)
  echo "Processed $file (cost: $cost)"
done

echo "Total cost: $total_cost"
```

### Budget Controls

Set maximum spend:

```bash
# Limit to $1 per operation (only works with -p)
claude -p "Expensive operation" --max-budget-usd 1.0
```

**Behavior:**
- Aborts if estimated cost exceeds budget
- Exit code 1 with error message
- Prevents runaway costs in automation

---

## Session Management

### Session Modes

#### 1. Stateless (Default with --no-session-persistence)

```bash
# No session saved to disk
claude -p "test" --no-session-persistence
```

**Use case**: One-off queries, CI/CD, stateless automation

#### 2. Stateful (Default)

```bash
# Session saved and resumable
claude -p "Start analysis"
# Returns session_id in JSON output
```

**Session ID available in JSON output:**
```json
{
  "session_id": "e0f0783c-29c8-43fa-8e55-8c96a920644c"
}
```

### Continuing Conversations

#### Continue Most Recent

```bash
# First request
claude -p "Review this codebase for performance issues"

# Continue most recent conversation
claude -p "Now focus on the database queries" --continue
claude -p "Generate a summary of all issues found" --continue
```

#### Resume Specific Session

```bash
# Capture session ID
session_id=$(claude -p "Start a review" --output-format json | jq -r '.session_id')

# Resume later
claude -p "Continue that review" --resume "$session_id"
```

#### Fork Session

```bash
# Create new session ID when resuming (branch conversation)
claude -p "Try different approach" --resume "$session_id" --fork-session
```

### Session Use Cases

**Multi-step analysis:**
```bash
#!/bin/bash

# Step 1: Initial analysis
claude -p "Analyze codebase architecture" > step1.txt

# Step 2: Deep dive
claude -p "Focus on authentication module" --continue > step2.txt

# Step 3: Recommendations
claude -p "List top 3 improvements" --continue > step3.txt
```

**Parallel analysis with forking:**
```bash
# Create base analysis
base_session=$(claude -p "Analyze API" --output-format json | jq -r '.session_id')

# Fork for security review
claude -p "Security concerns?" --resume "$base_session" --fork-session > security.txt

# Fork for performance review
claude -p "Performance issues?" --resume "$base_session" --fork-session > performance.txt
```

---

## Context & File Passing

### Methods to Provide Context

#### 1. Current Working Directory

Claude automatically has access to current directory:

```bash
cd /path/to/project
claude -p "Analyze this project structure"
```

#### 2. Additional Directories

```bash
# Grant access to specific directories
claude -p "Analyze both projects" --add-dir /path/to/project1 --add-dir /path/to/project2
```

#### 3. Piped File Contents

```bash
# Single file
cat src/main.ts | claude -p "Explain this code"

# Multiple files
cat src/*.ts | claude -p "Summarize all TypeScript files"
```

#### 4. File Attachments (Via MCP/Tools)

```bash
# Claude can use Read tool to access files
claude -p "Read and analyze src/auth.ts" --allowed-tools "Read"
```

#### 5. Explicit File Resources

```bash
# Download files at startup (from Claude API file resources)
claude -p "Analyze these files" --file file_abc:doc.txt --file file_def:img.png
```

### Context Best Practices

**For mdcontext use case:**

1. **Pipe file tree for structure:**
```bash
tree -L 3 | claude -p "Summarize project structure"
```

2. **Pipe specific files for analysis:**
```bash
cat README.md src/main.ts | claude -p "Create project overview"
```

3. **Use Read tool for file access:**
```bash
claude -p "Read all .ts files and create summary" --allowed-tools "Read,Grep,Glob"
```

4. **Combine with git context:**
```bash
git log --oneline -20 | claude -p "Summarize recent changes"
```

### Context Limits

**Token limits:**
- Sonnet 4.5: 200,000 token context window
- Opus 4.5: 200,000 token context window

**Estimation:**
- ~4 characters per token (English)
- ~200,000 chars = ~50,000 tokens
- Monitor with JSON output: `usage.input_tokens`

**Stay within limits:**
```bash
# Check token usage
result=$(claude -p "Large prompt" --output-format json)
input_tokens=$(echo "$result" | jq -r '.usage.input_tokens')

if [ "$input_tokens" -gt 100000 ]; then
  echo "Warning: High token usage ($input_tokens)"
fi
```

---

## Model Selection

### Available Models (2026)

```bash
# Latest Sonnet (default)
claude -p "test" --model sonnet

# Latest Opus (most capable)
claude -p "complex task" --model opus

# Specific version
claude -p "test" --model claude-sonnet-4-5-20250929
```

### Model Aliases

- `sonnet` → Latest Sonnet 4.5
- `opus` → Latest Opus 4.5
- Full names: `claude-sonnet-4-5-20250929`, `claude-opus-4-5-20251101`

### Fallback Models

```bash
# Auto-fallback if primary model is overloaded (only with -p)
claude -p "test" --model sonnet --fallback-model opus
```

**Behavior:**
- Automatically switches to fallback on overload (529 error)
- No manual intervention needed
- Transparent failover

### Model Selection Strategy

**For mdcontext:**

1. **Use Sonnet for most tasks** (fast, cost-effective)
   ```bash
   claude -p "Summarize codebase" --model sonnet
   ```

2. **Use Opus for complex analysis** (deeper understanding)
   ```bash
   claude -p "Architectural review with recommendations" --model opus
   ```

3. **Always set fallback** (reliability)
   ```bash
   claude -p "Critical analysis" --model sonnet --fallback-model opus
   ```

### Model Costs (From JSON Output)

Track per-model usage:
```json
{
  "modelUsage": {
    "claude-sonnet-4-5-20250929": {
      "inputTokens": 2,
      "outputTokens": 25,
      "costUSD": 0.062059500000000004
    }
  }
}
```

---

## Streaming vs Non-Streaming

### Non-Streaming (Default)

**Text format:**
```bash
claude -p "What is 2+2?"
# Waits for complete response
# Output: 2 + 2 = 4
```

**JSON format:**
```bash
claude -p "Analyze code" --output-format json
# Waits for complete response
# Returns single JSON object
```

**Characteristics:**
- Blocks until complete
- Single output
- Easy to process
- No real-time feedback

### Streaming (stream-json)

```bash
claude -p "Long analysis" --output-format stream-json --verbose
```

**Requires:** `--verbose` flag

**Characteristics:**
- Real-time events
- Newline-delimited JSON (NDJSON)
- Progress monitoring
- Can process incrementally

### Event Types

```json
// Initialization
{"type":"system","subtype":"init","session_id":"...","model":"..."}

// Assistant messages
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}

// Final result
{"type":"result","subtype":"success","result":"...","total_cost_usd":0.05}
```

### Processing Streaming Output

**Extract text only:**
```bash
claude -p "Analyze" --output-format stream-json --verbose |
  jq -j '.event.delta.text? // empty'
```

**Monitor progress:**
```bash
claude -p "Long task" --output-format stream-json --verbose |
  while IFS= read -r line; do
    type=$(echo "$line" | jq -r '.type')
    case $type in
      system)
        echo "Initialized"
        ;;
      assistant)
        echo -n "."
        ;;
      result)
        echo " Done!"
        echo "$line" | jq -r '.result'
        ;;
    esac
  done
```

### Structured Output with Streaming

**Limitation**: When using `--json-schema`, structured output only appears in final result:

```bash
claude -p "Extract functions" \
  --output-format stream-json \
  --json-schema '{"type":"object","properties":{"functions":{"type":"array"}}}' \
  --verbose
# Streams natural language, structured output only in final result.structured_output
```

**Extract structured output:**
```bash
result=$(claude -p "Extract data" \
  --output-format stream-json \
  --json-schema '...' \
  --verbose | tail -1)

structured=$(echo "$result" | jq '.structured_output')
```

### When to Use Each

**Use non-streaming (text/json):**
- Simple queries
- Scripts that need complete result
- Single-step processing
- Cost tracking (easier with single JSON)

**Use streaming (stream-json):**
- Long-running tasks
- Progress monitoring needed
- Multi-agent pipelines
- Real-time feedback for users

---

## Tool Management

### Tool Permission Modes

```bash
# Default: Prompt for each tool (not usable in -p mode)
claude -p "Analyze" --permission-mode default

# Auto-accept edits
claude -p "Fix bugs" --permission-mode acceptEdits

# Bypass all permissions (dangerous, sandbox only)
claude -p "Analyze" --dangerously-skip-permissions

# Don't ask (but still track permissions)
claude -p "Analyze" --permission-mode dontAsk
```

### Allowed Tools

**Syntax:**
```bash
# Specific tools
claude -p "Fix tests" --allowed-tools "Bash,Read,Edit"

# Tool with command filtering
claude -p "Review" --allowed-tools "Bash(git:*)"

# Permission rule syntax with prefix matching
claude -p "Commit" --allowed-tools "Bash(git diff:*),Bash(git log:*),Bash(git status:*),Bash(git commit:*)"
```

**Available built-in tools:**
- `Bash` - Execute shell commands
- `Read` - Read files
- `Write` - Write files
- `Edit` - Edit files
- `Glob` - Find files by pattern
- `Grep` - Search file contents
- `NotebookEdit` - Edit Jupyter notebooks
- `WebFetch` - Fetch web content
- `WebSearch` - Search the web
- `Task` - Run sub-agents
- `TodoWrite` - Task management
- MCP tools (if configured)

### Disallowed Tools

```bash
# Prevent specific tools
claude -p "Analyze" --disallowed-tools "WebSearch,WebFetch"

# Prevent specific commands
claude -p "Analyze" --disallowed-tools "Bash(rm:*)"
```

### Disable All Tools

```bash
# Pure LLM, no tool use
claude -p "Explain concept" --tools ""
```

### Tool Selection Strategy

**For mdcontext (read-only analysis):**

```bash
# Safe, read-only tools
claude -p "Summarize codebase" \
  --allowed-tools "Read,Grep,Glob,Bash(git:*)" \
  --disallowed-tools "Write,Edit"
```

**For automated fixes (requires trust):**

```bash
# Allow edits with git safety
claude -p "Fix linting errors" \
  --allowed-tools "Read,Edit,Bash(npm:*),Bash(git diff:*)" \
  --disallowed-tools "Bash(rm:*),Bash(git push:*)"
```

### Permission Denials

Track denied permissions in JSON output:

```json
{
  "permission_denials": [
    {
      "tool": "Write",
      "reason": "Tool not in allowed list"
    }
  ]
}
```

---

## Practical Examples

### 1. Simple Codebase Summary

```bash
claude -p "Summarize the architecture of this project"
```

### 2. Structured Function Extraction

```bash
claude -p "Extract all function names from src/auth.ts" \
  --output-format json \
  --json-schema '{
    "type": "object",
    "properties": {
      "functions": {
        "type": "array",
        "items": {"type": "string"}
      }
    },
    "required": ["functions"]
  }' | jq '.structured_output.functions'
```

### 3. Security Review Pipeline

```bash
#!/bin/bash

# Review PR for security issues
gh pr diff "$1" | claude -p \
  --append-system-prompt "You are a security engineer. Review for vulnerabilities." \
  --output-format json \
  --allowed-tools "Read,Grep" > security-report.json

# Extract issues
jq -r '.result' security-report.json
```

### 4. Multi-Step Analysis with Session

```bash
#!/bin/bash

# Step 1: Architecture overview
claude -p "Analyze the architecture of this project" > arch.txt

# Step 2: Security deep-dive
claude -p "Now focus on security concerns" --continue > security.txt

# Step 3: Performance analysis
claude -p "Now analyze performance bottlenecks" --continue > performance.txt

# Step 4: Final recommendations
claude -p "Provide top 5 actionable recommendations" --continue > recommendations.txt
```

### 5. Batch Processing with Cost Tracking

```bash
#!/bin/bash

total_cost=0
results_file="summaries.json"
echo "[]" > "$results_file"

for file in src/**/*.ts; do
  echo "Processing $file..."

  result=$(claude -p "Summarize this file: $(cat $file)" \
    --output-format json \
    --model sonnet \
    --max-budget-usd 0.50)

  # Extract cost
  cost=$(echo "$result" | jq -r '.total_cost_usd')
  total_cost=$(echo "$total_cost + $cost" | bc)

  # Append result
  summary=$(echo "$result" | jq -r '.result')
  jq --arg file "$file" --arg summary "$summary" \
    '. += [{"file": $file, "summary": $summary}]' \
    "$results_file" > tmp.json && mv tmp.json "$results_file"

  echo "  Cost: \$$cost"
done

echo "Total cost: \$$total_cost"
echo "Results written to $results_file"
```

### 6. Stream Processing with Progress

```bash
#!/bin/bash

echo "Analyzing codebase..."

claude -p "Comprehensive architecture analysis" \
  --output-format stream-json \
  --verbose \
  --allowed-tools "Read,Grep,Glob,Bash(git:*)" |
  while IFS= read -r line; do
    type=$(echo "$line" | jq -r '.type // empty')

    case $type in
      system)
        echo "Initialized session"
        ;;
      assistant)
        # Show progress dots
        echo -n "."
        ;;
      result)
        echo ""
        echo "Complete!"
        echo "$line" | jq -r '.result' > analysis.txt
        echo "Cost: $(echo "$line" | jq -r '.total_cost_usd')"
        ;;
    esac
  done

echo "Analysis written to analysis.txt"
```

### 7. Parallel Analysis with Forking

```bash
#!/bin/bash

# Base analysis
echo "Creating base analysis..."
base_session=$(claude -p "Analyze this codebase" \
  --output-format json | jq -r '.session_id')

echo "Session: $base_session"

# Fork for different perspectives
(
  echo "Security review..."
  claude -p "Security concerns?" \
    --resume "$base_session" \
    --fork-session > security.txt
) &

(
  echo "Performance review..."
  claude -p "Performance issues?" \
    --resume "$base_session" \
    --fork-session > performance.txt
) &

(
  echo "Maintainability review..."
  claude -p "Code quality and maintainability?" \
    --resume "$base_session" \
    --fork-session > maintainability.txt
) &

# Wait for all forks
wait

echo "All reviews complete!"
cat security.txt performance.txt maintainability.txt > full-review.txt
```

### 8. Git Commit Automation

```bash
#!/bin/bash

# Review staged changes and create commit
claude -p "Look at my staged changes and create an appropriate commit" \
  --allowed-tools "Bash(git diff:*),Bash(git log:*),Bash(git status:*),Bash(git commit:*)"
```

### 9. Error Recovery with Retry

```bash
#!/bin/bash

MAX_RETRIES=3
RETRY_DELAY=60

analyze_with_retry() {
  local prompt="$1"
  local attempt=1

  while [ $attempt -le $MAX_RETRIES ]; do
    echo "Attempt $attempt/$MAX_RETRIES..."

    output=$(claude -p "$prompt" --output-format json 2>&1)
    exit_code=$?

    if [ $exit_code -eq 0 ]; then
      echo "$output"
      return 0
    fi

    if echo "$output" | grep -q "rate_limit_error"; then
      echo "Rate limited, waiting ${RETRY_DELAY}s..."
      sleep $RETRY_DELAY
      attempt=$((attempt + 1))
    else
      echo "Error: $output" >&2
      return 1
    fi
  done

  echo "Max retries exceeded" >&2
  return 1
}

# Usage
result=$(analyze_with_retry "Analyze this codebase")
if [ $? -eq 0 ]; then
  echo "$result" | jq -r '.result'
fi
```

### 10. Custom System Prompt for Specialized Output

```bash
#!/bin/bash

# Generate structured documentation
claude -p "Document the main entry point" \
  --system-prompt "You are a technical documentation generator.
Output only valid Markdown with the following structure:
# Overview
# API Reference
# Examples
# Error Handling" \
  --allowed-tools "Read,Grep" > API_DOCS.md
```

---

## mdcontext Integration Recommendations

### Use Case: Automated LLM Summarization

**Goal**: Generate project summaries for large codebases programmatically

### Recommended Approach

#### 1. Read-Only Analysis (Safest)

```typescript
import { Effect, pipe } from 'effect';
import { $ } from 'effect/Function';
import { spawn } from 'child_process';

// Wrapper for claude -p
const analyzeClaude = (prompt: string, options?: {
  model?: string;
  tools?: string[];
  maxBudget?: number;
}) => Effect.async<string, Error>((resume) => {
  const args = ['-p', prompt, '--output-format', 'json'];

  if (options?.model) args.push('--model', options.model);
  if (options?.tools) args.push('--allowed-tools', options.tools.join(','));
  if (options?.maxBudget) args.push('--max-budget-usd', String(options.maxBudget));

  const proc = spawn('claude', args, { cwd: process.cwd() });
  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data) => stdout += data);
  proc.stderr.on('data', (data) => stderr += data);

  proc.on('close', (code) => {
    if (code === 0) {
      try {
        const result = JSON.parse(stdout);
        resume(Effect.succeed(result.result));
      } catch (e) {
        resume(Effect.fail(new Error('Failed to parse JSON: ' + e)));
      }
    } else {
      resume(Effect.fail(new Error(`Claude failed (${code}): ${stderr}`)));
    }
  });
});

// Generate summary
const generateSummary = pipe(
  analyzeClaude(
    'Analyze this codebase and provide a comprehensive summary',
    {
      model: 'sonnet',
      tools: ['Read', 'Grep', 'Glob', 'Bash(git:*)'],
      maxBudget: 1.0
    }
  ),
  Effect.tap((summary) =>
    Effect.log(`Generated summary (${summary.length} chars)`)
  )
);
```

#### 2. Structured Data Extraction

```typescript
interface CodebaseSummary {
  overview: string;
  architecture: string[];
  mainComponents: Array<{
    name: string;
    purpose: string;
    path: string;
  }>;
  dependencies: string[];
  recommendations: string[];
}

const extractStructuredSummary = (cwd: string) =>
  Effect.async<CodebaseSummary, Error>((resume) => {
    const schema = JSON.stringify({
      type: 'object',
      properties: {
        overview: { type: 'string' },
        architecture: { type: 'array', items: { type: 'string' } },
        mainComponents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              purpose: { type: 'string' },
              path: { type: 'string' }
            },
            required: ['name', 'purpose', 'path']
          }
        },
        dependencies: { type: 'array', items: { type: 'string' } },
        recommendations: { type: 'array', items: { type: 'string' } }
      },
      required: ['overview', 'architecture', 'mainComponents', 'dependencies', 'recommendations']
    });

    const proc = spawn('claude', [
      '-p',
      'Analyze this codebase and extract structured information',
      '--output-format', 'json',
      '--json-schema', schema,
      '--allowed-tools', 'Read,Grep,Glob',
      '--model', 'sonnet'
    ], { cwd });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => stdout += data);
    proc.stderr.on('data', (data) => stderr += data);

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          resume(Effect.succeed(result.structured_output));
        } catch (e) {
          resume(Effect.fail(new Error('Failed to parse: ' + e)));
        }
      } else {
        resume(Effect.fail(new Error(`Failed (${code}): ${stderr}`)));
      }
    });
  });
```

#### 3. Cost-Aware Batch Processing

```typescript
interface AnalysisResult {
  file: string;
  summary: string;
  cost: number;
}

const analyzeFilesWithBudget = (
  files: string[],
  totalBudget: number
) => Effect.gen(function* (_) {
  let remainingBudget = totalBudget;
  const results: AnalysisResult[] = [];

  for (const file of files) {
    if (remainingBudget <= 0) {
      yield* _(Effect.log('Budget exhausted'));
      break;
    }

    const perFileBudget = Math.min(0.50, remainingBudget);

    const result = yield* _(
      analyzeClaude(
        `Summarize this file:\n\n${yield* _(readFile(file))}`,
        {
          model: 'sonnet',
          maxBudget: perFileBudget,
          tools: []
        }
      ).pipe(
        Effect.map((summary) => {
          // Parse cost from JSON
          return { file, summary, cost: 0.05 }; // Simplified
        })
      )
    );

    results.push(result);
    remainingBudget -= result.cost;

    yield* _(Effect.log(`Processed ${file} (cost: $${result.cost}, remaining: $${remainingBudget})`));
  }

  return results;
});
```

#### 4. Integration with mdcontext CLI

Add new command:

```typescript
// src/cli/commands/summarize.ts

import { Command } from '@effect/cli';
import { Effect } from 'effect';

const summarizeCommand = Command.make('summarize', {
  provider: Options.choice('provider', ['anthropic-api', 'claude-cli']).pipe(
    Options.withDefault('claude-cli')
  ),
  model: Options.choice('model', ['sonnet', 'opus']).pipe(
    Options.withDefault('sonnet')
  ),
  budget: Options.float('budget').pipe(
    Options.withDefault(1.0)
  ),
  output: Options.text('output').pipe(
    Options.optional
  )
}).pipe(
  Command.withHandler((args) =>
    Effect.gen(function* (_) {
      if (args.provider === 'claude-cli') {
        // Use claude -p integration
        const summary = yield* _(
          analyzeClaude('Generate project summary', {
            model: args.model,
            maxBudget: args.budget,
            tools: ['Read', 'Grep', 'Glob']
          })
        );

        if (args.output) {
          yield* _(writeFile(args.output, summary));
          yield* _(Effect.log(`Summary written to ${args.output}`));
        } else {
          yield* _(Console.log(summary));
        }
      } else {
        // Use direct API integration
        // ...
      }
    })
  )
);

// mdcontext summarize --provider claude-cli --model sonnet --budget 1.0 --output SUMMARY.md
```

### Key Integration Points

1. **Provider abstraction**: Support both direct API and CLI
2. **Cost tracking**: Monitor and report costs
3. **Error handling**: Graceful degradation, retries
4. **Structured output**: Use JSON schema for consistency
5. **Session management**: Multi-step analysis
6. **Tool safety**: Read-only by default

### Configuration Options

```json
// .mdcontext/config.json
{
  "summarization": {
    "provider": "claude-cli",
    "model": "sonnet",
    "fallbackModel": "opus",
    "maxBudget": 5.0,
    "allowedTools": ["Read", "Grep", "Glob", "Bash(git:*)"],
    "sessionPersistence": true,
    "outputFormat": "json"
  }
}
```

---

## Gotchas & Limitations

### 1. No Interactive Prompts in -p Mode

Skills and built-in commands like `/commit` are **not available** in `-p` mode:

```bash
# Won't work
claude -p "/commit"

# Instead, describe the task
claude -p "Look at my staged changes and create an appropriate commit" \
  --allowed-tools "Bash(git:*)"
```

### 2. Tool Permissions Must Be Pre-Approved

Can't prompt for approval in non-interactive mode:

```bash
# Will fail if tools not allowed
claude -p "Fix all bugs"  # Tries to use Edit tool but can't ask

# Must pre-approve
claude -p "Fix all bugs" --allowed-tools "Read,Edit,Bash"
```

### 3. Trust Dialog Bypassed

`-p` flag **skips workspace trust dialog** - only use in trusted directories:

```bash
# Dangerous in untrusted directory
cd /tmp/sketchy-repo
claude -p "Analyze this" --allowed-tools "Bash"  # Could run malicious code
```

### 4. Stream-JSON Requires --verbose

```bash
# Won't work
claude -p "test" --output-format stream-json

# Error: When using --print, --output-format=stream-json requires --verbose

# Correct
claude -p "test" --output-format stream-json --verbose
```

### 5. JSON Schema Only in Final Result

When streaming with `--json-schema`, structured output only appears at the end:

```bash
claude -p "Extract data" \
  --output-format stream-json \
  --json-schema '...' \
  --verbose
# Streams text, structured_output only in final event
```

### 6. Session Persistence Default

Sessions are saved by default, consuming disk space:

```bash
# Sessions accumulate
claude -p "test1"
claude -p "test2"
claude -p "test3"
# All saved to ~/.claude/sessions/

# Disable for stateless operation
claude -p "test" --no-session-persistence
```

### 7. Organization-Wide Rate Limits

Rate limits are **shared across all API keys** in your organization:

```bash
# Multiple processes hitting same limit
for i in {1..100}; do
  claude -p "test $i" &  # All share same rate limit pool
done
# Will quickly hit rate limit
```

### 8. API Key Priority Over Subscription

If `ANTHROPIC_API_KEY` is set, it **takes priority** and you'll be charged API rates:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
claude -p "test"  # Uses API key, not subscription - charged per token!
```

### 9. Model Selection Doesn't Affect Cost in JSON

JSON output shows actual model used and cost, which may differ from requested:

```bash
# Request sonnet
claude -p "test" --model sonnet --output-format json

# But modelUsage may show different model if fallback triggered
{
  "modelUsage": {
    "claude-opus-4-5-20251101": {  // Fallback was used
      "costUSD": 0.12  // Higher than expected
    }
  }
}
```

### 10. Timeout Behavior

No built-in timeout - use external `timeout` command:

```bash
# Will run indefinitely
claude -p "Analyze everything forever"

# Add timeout
timeout 300 claude -p "Long task"  # 5 minute timeout
# Exit code 124 on timeout
```

### 11. No Progress for Long Operations

With default text/json output, no feedback during long operations:

```bash
# Appears frozen
claude -p "Analyze 10000 files"  # No output until complete

# Use streaming for feedback
claude -p "Analyze 10000 files" --output-format stream-json --verbose
```

### 12. Input Format Limitations

`--input-format stream-json` has limited documentation and complex requirements:

```bash
# Requires specific JSON format per line
echo '{"type":"user","content":"Hello"}' | \
  claude -p --input-format stream-json --output-format stream-json --verbose
# Often fails with parsing errors
```

Stick to text input for reliability.

### 13. Context Window Exceeds Silently

If context exceeds window, request may fail without clear error:

```bash
# Large file
cat 500MB.log | claude -p "Analyze"
# May fail with generic error, not "context too large"
```

Monitor `input_tokens` in JSON output to track usage.

### 14. No Streaming Text Output

Can't stream plain text - must use stream-json:

```bash
# No streaming equivalent for text format
claude -p "Long task" --output-format text  # Blocks until complete
```

### 15. MCP Servers May Require Configuration

If using MCP tools, they must be configured beforehand:

```bash
# Won't work if Linear not configured
claude -p "Create Linear issue" --allowed-tools "mcp__linear-server__create_issue"

# Must configure first via interactive mode or --mcp-config
```

---

## References & Sources

### Official Documentation
- [Run Claude Code programmatically - Claude Code Docs](https://code.claude.com/docs/en/headless)
- [Claude API Rate Limits](https://platform.claude.com/docs/en/api/rate-limits)
- [Structured outputs - Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Streaming Messages - Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/streaming)

### Community Resources
- [GitHub - disler/claude-code-is-programmable](https://github.com/disler/claude-code-is-programmable)
- [What is the --print Flag in Claude Code | ClaudeLog](https://claudelog.com/faqs/what-is-print-flag-in-claude-code/)
- [Managing API Key Environment Variables in Claude Code | Claude Help Center](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Stream-JSON Chaining - ruvnet/claude-flow Wiki](https://github.com/ruvnet/claude-flow/wiki/Stream-Chaining)

### Error Handling & Troubleshooting
- [Troubleshooting - Claude Code Docs](https://code.claude.com/docs/en/troubleshooting)
- [How to Fix Claude Code Process Exited With Code 1?](https://www.navthemes.com/how-to-fix-claude-code-process-exited-with-code-1/)
- [Rate limits - Claude API Docs](https://platform.claude.com/docs/en/api/rate-limits)

---

## Changelog

- **2026-01-26**: Initial comprehensive guide for Claude Code CLI 2.1.19
  - Documented all -p flag options and behaviors
  - Tested output formats (text, json, stream-json)
  - Verified error handling and exit codes
  - Researched authentication, rate limiting, and session management
  - Created practical examples for mdcontext integration
  - Cataloged gotchas and limitations
