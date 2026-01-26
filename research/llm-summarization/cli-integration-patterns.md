# CLI Integration Patterns for TypeScript/Node.js (2026)

**Last Updated:** January 2026
**Purpose:** Best practices for integrating with AI CLI tools programmatically in TypeScript/Node.js for the mdcontext project

## Table of Contents

1. [Process Spawning Patterns](#process-spawning-patterns)
2. [Output Parsing Strategies](#output-parsing-strategies)
3. [Error Detection & Handling](#error-detection--handling)
4. [Timeout Handling](#timeout-handling)
5. [Shell Escaping & Security](#shell-escaping--security)
6. [Buffer Management](#buffer-management)
7. [Exit Code Handling](#exit-code-handling)
8. [Environment Variables](#environment-variables)
9. [Testing Strategies](#testing-strategies)
10. [Production Examples](#production-examples)
11. [Common Pitfalls](#common-pitfalls)
12. [Platform Differences](#platform-differences)

---

## Process Spawning Patterns

### Overview: exec vs spawn vs execFile

Node.js provides three primary methods for spawning child processes, each with distinct use cases:

| Method | Use Case | Shell | Buffering | Best For |
|--------|----------|-------|-----------|----------|
| `exec()` | Simple shell commands | Yes | Buffered | Small output, shell features needed |
| `execFile()` | Direct binary execution | No | Buffered | Security-critical, known binaries |
| `spawn()` | Streaming processes | Optional | Streaming | Large output, real-time data |

### When to Use Each Method

**Use `exec()` when:**
- You need shell features (pipes, redirection, wildcards)
- Output size is guaranteed small (< 1MB)
- You're running simple, trusted commands
- You need synchronous execution (with `execSync()`)

**Use `execFile()` when:**
- Security is paramount (no shell injection risk)
- Executing a known binary directly
- You want better performance (no shell overhead)
- Arguments are dynamic/user-controlled

**Use `spawn()` when:**
- Output may be large or unbounded
- You need real-time streaming output
- Long-running processes
- Fine-grained control over stdio streams

### TypeScript Examples

#### Pattern 1: Using spawn() for AI CLI Tools (Recommended)

```typescript
import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

interface SpawnOptions {
  timeout?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/**
 * Spawn a CLI process with proper error handling and streaming support
 * Recommended for AI CLI tools like claude, gh, or git
 */
async function spawnCLI(
  command: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<CLIResult> {
  return new Promise((resolve, reject) => {
    const {
      timeout = 120000, // 2 minutes default
      maxBuffer = 10 * 1024 * 1024, // 10MB default
      env = process.env,
      cwd = process.cwd(),
    } = options;

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;

    // Spawn with explicit argument array (prevents shell injection)
    const child: ChildProcess = spawn(command, args, {
      cwd,
      env,
      // Do NOT use shell: true unless absolutely necessary
      shell: false,
      // Ensure stdio is piped for capture
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Timeout handler
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');

      // Escalate to SIGKILL if not dead after 5 seconds
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);

    // Capture stdout with buffer protection
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBuffer) {
        child.kill('SIGTERM');
        reject(new Error(`stdout exceeded maxBuffer of ${maxBuffer} bytes`));
        return;
      }
      stdout += chunk.toString('utf8');
    });

    // Capture stderr with buffer protection
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxBuffer) {
        child.kill('SIGTERM');
        reject(new Error(`stderr exceeded maxBuffer of ${maxBuffer} bytes`));
        return;
      }
      stderr += chunk.toString('utf8');
    });

    // Handle process exit
    child.on('close', (exitCode: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeoutId);

      if (timedOut) {
        reject(new Error(`Process timed out after ${timeout}ms`));
        return;
      }

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        signal,
      });
    });

    // Handle spawn errors (command not found, permission denied, etc.)
    child.on('error', (err: Error) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to spawn process: ${err.message}`));
    });
  });
}

// Usage example for AI CLI
async function callClaudeCLI(prompt: string): Promise<string> {
  try {
    const result = await spawnCLI('claude', ['--prompt', prompt], {
      timeout: 300000, // 5 minutes for AI responses
      maxBuffer: 50 * 1024 * 1024, // 50MB for large responses
    });

    if (result.exitCode !== 0) {
      throw new Error(`Claude CLI failed with exit code ${result.exitCode}: ${result.stderr}`);
    }

    return result.stdout;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Claude CLI error: ${error.message}`);
    }
    throw error;
  }
}
```

#### Pattern 2: Using execFile() for Security-Critical Operations

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Execute a binary directly without shell (more secure)
 * Use this when arguments may come from user input
 */
async function safeExecute(
  command: string,
  args: string[],
  options: {
    timeout?: number;
    maxBuffer?: number;
    cwd?: string;
  } = {}
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options.timeout || 120000,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      cwd: options.cwd || process.cwd(),
      // Note: execFile does NOT use a shell by default
      // This prevents shell injection attacks
    });

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (error: any) {
    // Handle specific error types
    if (error.killed && error.signal === 'SIGTERM') {
      throw new Error(`Process timed out after ${options.timeout}ms`);
    }
    if (error.code === 'ENOENT') {
      throw new Error(`Command not found: ${command}`);
    }
    if (error.code === 'EACCES') {
      throw new Error(`Permission denied: ${command}`);
    }
    throw error;
  }
}

// Usage example
async function runGitCommand(args: string[]): Promise<string> {
  const { stdout } = await safeExecute('git', args, {
    timeout: 30000, // 30 seconds
  });
  return stdout;
}
```

#### Pattern 3: Streaming Large Outputs

```typescript
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

interface StreamOptions {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onProgress?: (bytesRead: number) => void;
}

/**
 * Spawn process with streaming callbacks for real-time processing
 * Ideal for long-running AI generation or large file operations
 */
async function spawnWithStreaming(
  command: string,
  args: string[],
  options: StreamOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let totalBytesRead = 0;

    // Stream stdout chunks in real-time
    child.stdout?.on('data', (chunk: Buffer) => {
      totalBytesRead += chunk.length;
      const text = chunk.toString('utf8');

      options.onStdout?.(text);
      options.onProgress?.(totalBytesRead);
    });

    // Stream stderr chunks in real-time
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      options.onStderr?.(text);
    });

    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${exitCode}`));
      }
    });

    child.on('error', reject);
  });
}

// Usage example for streaming AI responses
async function streamClaudeResponse(prompt: string) {
  let response = '';

  await spawnWithStreaming('claude', ['--stream', '--prompt', prompt], {
    onStdout: (chunk) => {
      response += chunk;
      process.stdout.write(chunk); // Display in real-time
    },
    onStderr: (chunk) => {
      console.error('Error:', chunk);
    },
    onProgress: (bytes) => {
      console.log(`Received ${bytes} bytes...`);
    },
  });

  return response;
}
```

---

## Output Parsing Strategies

### Handling Different Output Formats

AI CLI tools typically output in various formats. Here are robust parsing strategies:

#### Strategy 1: JSON Output

```typescript
import { z } from 'zod';

/**
 * Parse and validate JSON output from CLI tools
 * Many modern CLI tools support --json flags
 */
async function parseJSONOutput<T>(
  command: string,
  args: string[],
  schema: z.ZodSchema<T>
): Promise<T> {
  const result = await spawnCLI(command, args);

  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${result.stderr}`);
  }

  try {
    // Parse JSON
    const parsed = JSON.parse(result.stdout);

    // Validate with Zod schema
    return schema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid JSON schema: ${error.message}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON output: ${error.message}`);
    }
    throw error;
  }
}

// Example: Parse GitHub CLI output
const IssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  author: z.string(),
});

type Issue = z.infer<typeof IssueSchema>;

async function getGitHubIssue(issueNumber: number): Promise<Issue> {
  return parseJSONOutput(
    'gh',
    ['issue', 'view', issueNumber.toString(), '--json', 'number,title,state,author'],
    IssueSchema
  );
}
```

#### Strategy 2: NDJSON (Newline-Delimited JSON) Streaming

```typescript
import { spawn } from 'child_process';
import { Transform } from 'stream';
import split2 from 'split2'; // npm: split2

/**
 * Parse streaming NDJSON output line-by-line
 * Efficient for large datasets or continuous output
 */
async function parseNDJSONStream<T>(
  command: string,
  args: string[],
  schema: z.ZodSchema<T>,
  onItem: (item: T) => void | Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let lineNumber = 0;

    // Split stdout by newlines and parse each line as JSON
    child.stdout
      ?.pipe(split2()) // Split on newlines
      .pipe(
        new Transform({
          objectMode: true,
          async transform(line: string, encoding, callback) {
            lineNumber++;

            if (!line.trim()) {
              callback();
              return;
            }

            try {
              const parsed = JSON.parse(line);
              const validated = schema.parse(parsed);
              await onItem(validated);
              callback();
            } catch (error) {
              callback(new Error(`Line ${lineNumber}: ${error}`));
            }
          },
        })
      )
      .on('error', reject)
      .on('finish', resolve);

    child.on('error', reject);
  });
}

// Example: Stream log entries
const LogEntrySchema = z.object({
  timestamp: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});

type LogEntry = z.infer<typeof LogEntrySchema>;

async function streamLogs() {
  await parseNDJSONStream(
    'some-logging-cli',
    ['stream', '--format', 'ndjson'],
    LogEntrySchema,
    async (entry) => {
      console.log(`[${entry.level.toUpperCase()}] ${entry.message}`);
    }
  );
}
```

#### Strategy 3: Unstructured Text Parsing

```typescript
/**
 * Parse unstructured CLI output with regex patterns
 * Use when JSON output is not available
 */
interface ParsePattern<T> {
  pattern: RegExp;
  transform: (matches: RegExpMatchArray) => T;
}

async function parseTextOutput<T>(
  command: string,
  args: string[],
  patterns: ParsePattern<T>[]
): Promise<T[]> {
  const result = await spawnCLI(command, args);

  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${result.stderr}`);
  }

  const results: T[] = [];

  for (const { pattern, transform } of patterns) {
    const matches = result.stdout.matchAll(pattern);
    for (const match of matches) {
      results.push(transform(match));
    }
  }

  return results;
}

// Example: Parse git log output
interface GitCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

async function getGitLog(): Promise<GitCommit[]> {
  const result = await spawnCLI('git', [
    'log',
    '--pretty=format:%H|%an|%ad|%s',
    '--date=iso',
    '-n',
    '10',
  ]);

  return result.stdout.split('\n').map((line) => {
    const [hash, author, date, message] = line.split('|');
    return { hash, author, date, message };
  });
}
```

#### Strategy 4: Handling Mixed Output (JSON + Progress)

```typescript
/**
 * Some CLI tools output progress to stderr and JSON to stdout
 * Handle this pattern by separating the streams
 */
async function parseWithProgress<T>(
  command: string,
  args: string[],
  schema: z.ZodSchema<T>,
  onProgress?: (message: string) => void
): Promise<T> {
  const result = await new Promise<CLIResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk) => {
      const message = chunk.toString('utf8').trim();
      stderr += message + '\n';

      // Many CLI tools output progress to stderr
      onProgress?.(message);
    });

    child.on('close', (exitCode, signal) => {
      resolve({ stdout, stderr, exitCode, signal });
    });

    child.on('error', reject);
  });

  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${result.stderr}`);
  }

  const parsed = JSON.parse(result.stdout);
  return schema.parse(parsed);
}

// Example usage
async function generateWithProgress() {
  const result = await parseWithProgress(
    'some-ai-cli',
    ['generate', '--output', 'json'],
    z.object({ content: z.string(), tokens: z.number() }),
    (progress) => {
      console.log('Progress:', progress);
    }
  );

  return result;
}
```

---

## Error Detection & Handling

### Comprehensive Error Classification

```typescript
/**
 * Error types for CLI integration
 */
export enum CLIErrorType {
  // Process errors
  COMMAND_NOT_FOUND = 'COMMAND_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  SPAWN_FAILED = 'SPAWN_FAILED',

  // Execution errors
  TIMEOUT = 'TIMEOUT',
  BUFFER_OVERFLOW = 'BUFFER_OVERFLOW',
  NON_ZERO_EXIT = 'NON_ZERO_EXIT',
  SIGNAL_TERMINATED = 'SIGNAL_TERMINATED',

  // Authentication errors
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',

  // Rate limiting
  RATE_LIMITED = 'RATE_LIMITED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  DNS_RESOLUTION_FAILED = 'DNS_RESOLUTION_FAILED',

  // Data errors
  INVALID_OUTPUT = 'INVALID_OUTPUT',
  MALFORMED_JSON = 'MALFORMED_JSON',
  SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',
}

export class CLIError extends Error {
  constructor(
    public type: CLIErrorType,
    message: string,
    public details?: {
      command?: string;
      args?: string[];
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      stdout?: string;
      stderr?: string;
      originalError?: Error;
    }
  ) {
    super(message);
    this.name = 'CLIError';
  }

  /**
   * Check if error is retryable
   */
  isRetryable(): boolean {
    return [
      CLIErrorType.NETWORK_ERROR,
      CLIErrorType.CONNECTION_TIMEOUT,
      CLIErrorType.RATE_LIMITED,
      CLIErrorType.TIMEOUT,
    ].includes(this.type);
  }

  /**
   * Check if error requires user intervention
   */
  requiresUserAction(): boolean {
    return [
      CLIErrorType.AUTH_REQUIRED,
      CLIErrorType.AUTH_EXPIRED,
      CLIErrorType.INVALID_TOKEN,
      CLIErrorType.COMMAND_NOT_FOUND,
      CLIErrorType.PERMISSION_DENIED,
    ].includes(this.type);
  }
}

/**
 * Detect and classify CLI errors
 */
function detectErrorType(error: any, result?: CLIResult): CLIError {
  // Process spawn errors
  if (error.code === 'ENOENT') {
    return new CLIError(
      CLIErrorType.COMMAND_NOT_FOUND,
      `Command not found: ${error.path}`,
      { originalError: error }
    );
  }

  if (error.code === 'EACCES') {
    return new CLIError(
      CLIErrorType.PERMISSION_DENIED,
      `Permission denied: ${error.path}`,
      { originalError: error }
    );
  }

  // Timeout errors
  if (error.killed && error.signal === 'SIGTERM') {
    return new CLIError(
      CLIErrorType.TIMEOUT,
      'Process timed out',
      { signal: error.signal, originalError: error }
    );
  }

  // Check stderr for common error patterns
  const stderr = result?.stderr?.toLowerCase() || '';

  // Authentication errors
  if (
    stderr.includes('authentication') ||
    stderr.includes('not logged in') ||
    stderr.includes('please login') ||
    stderr.includes('401 unauthorized')
  ) {
    return new CLIError(
      CLIErrorType.AUTH_REQUIRED,
      'Authentication required',
      { stderr: result?.stderr }
    );
  }

  if (stderr.includes('token expired') || stderr.includes('token invalid')) {
    return new CLIError(
      CLIErrorType.AUTH_EXPIRED,
      'Authentication token expired',
      { stderr: result?.stderr }
    );
  }

  // Rate limiting
  if (
    stderr.includes('rate limit') ||
    stderr.includes('too many requests') ||
    stderr.includes('429')
  ) {
    return new CLIError(
      CLIErrorType.RATE_LIMITED,
      'Rate limit exceeded',
      { stderr: result?.stderr }
    );
  }

  // Network errors
  if (
    stderr.includes('network') ||
    stderr.includes('connection') ||
    stderr.includes('timeout') ||
    stderr.includes('econnrefused') ||
    stderr.includes('enotfound')
  ) {
    return new CLIError(
      CLIErrorType.NETWORK_ERROR,
      'Network error occurred',
      { stderr: result?.stderr }
    );
  }

  // Generic non-zero exit
  if (result?.exitCode !== null && result.exitCode !== 0) {
    return new CLIError(
      CLIErrorType.NON_ZERO_EXIT,
      `Process exited with code ${result.exitCode}`,
      {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
      }
    );
  }

  // Default error
  return new CLIError(
    CLIErrorType.SPAWN_FAILED,
    error.message || 'Unknown error',
    { originalError: error }
  );
}

/**
 * Execute CLI with comprehensive error handling
 */
async function executeWithErrorHandling(
  command: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<CLIResult> {
  try {
    const result = await spawnCLI(command, args, options);

    // Check for errors even on zero exit code
    // Some CLIs output errors to stderr but still exit 0
    if (result.stderr && !isExpectedStderr(result.stderr)) {
      console.warn(`Warning from ${command}:`, result.stderr);
    }

    return result;
  } catch (error) {
    const cliError = detectErrorType(error);

    // Log structured error for debugging
    console.error('CLI Error:', {
      type: cliError.type,
      message: cliError.message,
      retryable: cliError.isRetryable(),
      requiresAction: cliError.requiresUserAction(),
      details: cliError.details,
    });

    throw cliError;
  }
}

/**
 * Determine if stderr output is expected/informational
 */
function isExpectedStderr(stderr: string): boolean {
  const lowerStderr = stderr.toLowerCase();

  // Common informational messages
  const expectedPatterns = [
    'warning:',
    'note:',
    'info:',
    'downloading',
    'progress:',
    'fetching',
  ];

  return expectedPatterns.some((pattern) => lowerStderr.includes(pattern));
}
```

### Retry Logic with Exponential Backoff

```typescript
interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  shouldRetry?: (error: CLIError) => boolean;
}

/**
 * Execute CLI command with retry logic
 */
async function executeWithRetry(
  command: string,
  args: string[],
  spawnOptions: SpawnOptions = {},
  retryOptions: RetryOptions = {}
): Promise<CLIResult> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    shouldRetry = (error) => error.isRetryable(),
  } = retryOptions;

  let lastError: CLIError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await executeWithErrorHandling(command, args, spawnOptions);
    } catch (error) {
      if (!(error instanceof CLIError)) {
        throw error;
      }

      lastError = error;

      // Don't retry if not retryable or max retries reached
      if (!shouldRetry(error) || attempt === maxRetries) {
        break;
      }

      console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Exponential backoff
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError!;
}

// Example usage
async function callResilientCLI() {
  return executeWithRetry(
    'some-ai-cli',
    ['generate', '--prompt', 'Hello'],
    {
      timeout: 60000,
    },
    {
      maxRetries: 3,
      initialDelay: 2000,
      shouldRetry: (error) => {
        // Retry on network errors and rate limits
        return [
          CLIErrorType.NETWORK_ERROR,
          CLIErrorType.RATE_LIMITED,
          CLIErrorType.CONNECTION_TIMEOUT,
        ].includes(error.type);
      },
    }
  );
}
```

---

## Timeout Handling

### Production-Ready Timeout Patterns

```typescript
/**
 * Timeout handler with graceful degradation
 */
class TimeoutHandler {
  private timeoutId?: NodeJS.Timeout;
  private killTimeoutId?: NodeJS.Timeout;
  private child?: ChildProcess;

  constructor(
    private readonly process: ChildProcess,
    private readonly timeoutMs: number,
    private readonly gracePeriodMs: number = 5000
  ) {
    this.child = process;
    this.start();
  }

  private start(): void {
    this.timeoutId = setTimeout(() => {
      this.handleTimeout();
    }, this.timeoutMs);
  }

  private handleTimeout(): void {
    if (!this.child) return;

    console.warn(`Process timeout after ${this.timeoutMs}ms, sending SIGTERM`);

    // First, try graceful termination
    this.child.kill('SIGTERM');

    // If process doesn't exit within grace period, force kill
    this.killTimeoutId = setTimeout(() => {
      if (this.child && this.child.exitCode === null) {
        console.error('Process did not exit gracefully, sending SIGKILL');
        this.child.kill('SIGKILL');
      }
    }, this.gracePeriodMs);
  }

  cancel(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    if (this.killTimeoutId) {
      clearTimeout(this.killTimeoutId);
      this.killTimeoutId = undefined;
    }
  }
}

/**
 * Spawn with advanced timeout handling
 */
async function spawnWithAdvancedTimeout(
  command: string,
  args: string[],
  options: {
    timeout: number;
    gracePeriod?: number;
    onTimeout?: () => void;
  }
): Promise<CLIResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Create timeout handler
    const timeoutHandler = new TimeoutHandler(
      child,
      options.timeout,
      options.gracePeriod
    );

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (exitCode, signal) => {
      timeoutHandler.cancel();

      if (timedOut) {
        reject(
          new CLIError(
            CLIErrorType.TIMEOUT,
            `Process timed out after ${options.timeout}ms`,
            { exitCode, signal, stdout, stderr }
          )
        );
        return;
      }

      resolve({ stdout, stderr, exitCode, signal });
    });

    child.on('error', (error) => {
      timeoutHandler.cancel();
      reject(error);
    });

    // Mark as timed out if SIGTERM was sent
    child.once('SIGTERM', () => {
      timedOut = true;
      options.onTimeout?.();
    });
  });
}
```

### Adaptive Timeouts Based on Operation Type

```typescript
/**
 * Calculate adaptive timeout based on operation type and context
 */
function getAdaptiveTimeout(operation: {
  type: 'read' | 'write' | 'generate' | 'analyze';
  estimatedTokens?: number;
  complexity?: 'low' | 'medium' | 'high';
}): number {
  const baseTimeouts = {
    read: 30000, // 30 seconds
    write: 60000, // 1 minute
    generate: 120000, // 2 minutes
    analyze: 180000, // 3 minutes
  };

  let timeout = baseTimeouts[operation.type];

  // Adjust for token count (AI operations)
  if (operation.estimatedTokens) {
    // ~100ms per 100 tokens (rough estimate)
    timeout += (operation.estimatedTokens / 100) * 100;
  }

  // Adjust for complexity
  const complexityMultipliers = {
    low: 1,
    medium: 1.5,
    high: 2,
  };

  if (operation.complexity) {
    timeout *= complexityMultipliers[operation.complexity];
  }

  // Cap at 10 minutes
  return Math.min(timeout, 600000);
}

// Example usage
async function adaptiveExecute(prompt: string) {
  const timeout = getAdaptiveTimeout({
    type: 'generate',
    estimatedTokens: prompt.length * 2, // Rough estimate
    complexity: 'high',
  });

  return spawnCLI('claude', ['--prompt', prompt], { timeout });
}
```

---

## Shell Escaping & Security

### Critical Security Principles

**🔴 NEVER use `exec()` with user input**
**🟢 ALWAYS use `spawn()` or `execFile()` with argument arrays**

### Safe Argument Handling

```typescript
/**
 * Validate and sanitize CLI arguments
 * NEVER trust user input directly
 */
class ArgumentValidator {
  /**
   * Validate argument against whitelist pattern
   */
  static validate(
    arg: string,
    rules: {
      pattern?: RegExp;
      maxLength?: number;
      allowedChars?: RegExp;
      blockedPatterns?: RegExp[];
    }
  ): boolean {
    // Check length
    if (rules.maxLength && arg.length > rules.maxLength) {
      return false;
    }

    // Check against whitelist pattern
    if (rules.pattern && !rules.pattern.test(arg)) {
      return false;
    }

    // Check allowed characters
    if (rules.allowedChars && !rules.allowedChars.test(arg)) {
      return false;
    }

    // Check blocked patterns
    if (rules.blockedPatterns) {
      for (const blocked of rules.blockedPatterns) {
        if (blocked.test(arg)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Sanitize filename for use in CLI
   */
  static sanitizeFilename(filename: string): string {
    // Remove directory traversal attempts
    const cleaned = filename.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');

    // Allow only alphanumeric, dash, underscore, dot
    const sanitized = cleaned.replace(/[^a-zA-Z0-9._-]/g, '_');

    // Limit length
    return sanitized.slice(0, 255);
  }

  /**
   * Validate that path is within allowed directory
   */
  static isPathSafe(filePath: string, baseDir: string): boolean {
    const { resolve, relative } = require('path');

    const resolvedBase = resolve(baseDir);
    const resolvedPath = resolve(baseDir, filePath);

    // Check if resolved path is within base directory
    const relativePath = relative(resolvedBase, resolvedPath);

    return (
      !relativePath.startsWith('..') &&
      !relativePath.startsWith('/') &&
      resolvedPath.startsWith(resolvedBase)
    );
  }
}

/**
 * Example: Safe file operation
 */
async function safeFileOperation(
  userProvidedFilename: string,
  baseDir: string
): Promise<void> {
  // Sanitize filename
  const sanitized = ArgumentValidator.sanitizeFilename(userProvidedFilename);

  // Verify path is safe
  if (!ArgumentValidator.isPathSafe(sanitized, baseDir)) {
    throw new CLIError(
      CLIErrorType.PERMISSION_DENIED,
      'Invalid file path: directory traversal attempt detected'
    );
  }

  // Use execFile with explicit arguments (safe)
  await safeExecute('cat', [sanitized], { cwd: baseDir });
}
```

### Shell Injection Prevention

```typescript
/**
 * Common shell metacharacters that should raise red flags
 */
const SHELL_METACHARACTERS = [
  ';', // Command separator
  '&', // Background execution
  '|', // Pipe
  '$', // Variable expansion
  '`', // Command substitution
  '(', ')', // Subshell
  '<', '>', // Redirection
  '\n', '\r', // Newlines
  '*', '?', '[', ']', // Globbing
];

/**
 * Detect potential shell injection attempts
 */
function detectShellInjection(input: string): boolean {
  return SHELL_METACHARACTERS.some((char) => input.includes(char));
}

/**
 * Safe CLI execution wrapper
 */
async function executeSafely(
  command: string,
  args: string[],
  options: {
    allowShellMetacharacters?: boolean;
    validateArgs?: boolean;
  } = {}
): Promise<CLIResult> {
  const { allowShellMetacharacters = false, validateArgs = true } = options;

  // Validate command name
  if (detectShellInjection(command)) {
    throw new CLIError(
      CLIErrorType.PERMISSION_DENIED,
      'Shell metacharacters detected in command name'
    );
  }

  // Validate arguments
  if (validateArgs && !allowShellMetacharacters) {
    for (const arg of args) {
      if (detectShellInjection(arg)) {
        throw new CLIError(
          CLIErrorType.PERMISSION_DENIED,
          `Shell metacharacters detected in argument: ${arg}`
        );
      }
    }
  }

  // Use spawn with explicit args (never shell)
  return spawnCLI(command, args, { ...options });
}

// Example: Unsafe vs Safe
async function unsafeExample(userInput: string) {
  // 🔴 DANGEROUS - Never do this!
  // const { exec } = require('child_process');
  // exec(`echo ${userInput}`); // Shell injection vulnerability!

  // 🟢 SAFE - Use spawn with argument array
  return executeSafely('echo', [userInput], {
    validateArgs: true,
  });
}
```

### Secure Environment Variable Handling

```typescript
/**
 * Create sanitized environment for child processes
 * Following principle of least privilege
 */
function createSecureEnv(
  additionalEnv: Record<string, string> = {}
): NodeJS.ProcessEnv {
  // Start with minimal environment
  const secureEnv: NodeJS.ProcessEnv = {
    // Keep essential vars
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    // Add any required vars
    ...additionalEnv,
  };

  // NEVER pass these sensitive vars to child processes
  const BLOCKED_VARS = [
    /^AWS_/,
    /^AZURE_/,
    /^GCP_/,
    /_SECRET$/,
    /_KEY$/,
    /_TOKEN$/,
    /_PASSWORD$/,
    /^DATABASE_/,
    /^DB_/,
  ];

  // Remove any accidentally included sensitive vars
  for (const key of Object.keys(secureEnv)) {
    if (BLOCKED_VARS.some((pattern) => pattern.test(key))) {
      delete secureEnv[key];
      console.warn(`Removed sensitive env var from child process: ${key}`);
    }
  }

  return secureEnv;
}

/**
 * Execute with minimal environment
 */
async function executeWithMinimalEnv(
  command: string,
  args: string[],
  requiredEnv: Record<string, string> = {}
): Promise<CLIResult> {
  const env = createSecureEnv(requiredEnv);

  return spawnCLI(command, args, { env });
}

// Example usage
async function callGitHubCLI() {
  // Only pass the specific token needed, not entire env
  return executeWithMinimalEnv('gh', ['api', 'user'], {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN!, // Explicitly allowed
  });
}
```

---

## Buffer Management

### Handling Large Outputs

```typescript
/**
 * Stream-based approach for large outputs
 * Avoids maxBuffer limitations by processing data incrementally
 */
async function handleLargeOutput(
  command: string,
  args: string[],
  processor: (chunk: string) => void | Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    // Process stdout chunks as they arrive
    // No buffer limits - data is processed and discarded
    child.stdout?.on('data', async (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      try {
        await processor(text);
      } catch (error) {
        child.kill('SIGTERM');
        reject(error);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      console.error('stderr:', chunk.toString('utf8'));
    });

    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${exitCode}`));
      }
    });

    child.on('error', reject);
  });
}

// Example: Process large file line by line
async function processLargeFile(filePath: string) {
  let lineCount = 0;

  await handleLargeOutput('cat', [filePath], (chunk) => {
    const lines = chunk.split('\n');
    lineCount += lines.length;

    // Process each line without storing all in memory
    for (const line of lines) {
      if (line.trim()) {
        console.log(`Processing line ${lineCount}: ${line.slice(0, 50)}...`);
      }
    }
  });

  console.log(`Processed ${lineCount} lines`);
}
```

### Dynamic Buffer Sizing

```typescript
/**
 * Calculate appropriate buffer size based on operation
 */
function calculateBufferSize(options: {
  operationType: 'read' | 'write' | 'generate';
  estimatedSize?: number;
  safetyFactor?: number;
}): number {
  const {
    operationType,
    estimatedSize,
    safetyFactor = 2, // 2x safety margin
  } = options;

  // Base buffer sizes
  const baseBuffers = {
    read: 1024 * 1024, // 1MB
    write: 512 * 1024, // 512KB
    generate: 10 * 1024 * 1024, // 10MB for AI generation
  };

  let bufferSize = baseBuffers[operationType];

  // Adjust based on estimated size
  if (estimatedSize) {
    bufferSize = Math.max(bufferSize, estimatedSize * safetyFactor);
  }

  // Cap at 100MB to prevent excessive memory usage
  return Math.min(bufferSize, 100 * 1024 * 1024);
}

/**
 * Execute with dynamic buffer sizing
 */
async function executeDynamic(
  command: string,
  args: string[],
  options: {
    operationType: 'read' | 'write' | 'generate';
    estimatedSize?: number;
  }
): Promise<CLIResult> {
  const maxBuffer = calculateBufferSize(options);

  console.log(`Using buffer size: ${(maxBuffer / 1024 / 1024).toFixed(2)}MB`);

  return spawnCLI(command, args, { maxBuffer });
}
```

### Write Stream to File Instead of Memory

```typescript
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

/**
 * Pipe large CLI output directly to file
 * Avoids memory issues entirely
 */
async function pipeOutputToFile(
  command: string,
  args: string[],
  outputPath: string
): Promise<void> {
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  const writeStream = createWriteStream(outputPath);

  try {
    // Pipe stdout directly to file
    await pipeline(child.stdout!, writeStream);
  } catch (error) {
    throw new Error(`Failed to pipe output to file: ${error}`);
  }

  return new Promise((resolve, reject) => {
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${exitCode}`));
      }
    });

    child.on('error', reject);
  });
}

// Example: Download large dataset
async function downloadDataset(url: string, outputPath: string) {
  await pipeOutputToFile('curl', ['-L', url], outputPath);
  console.log(`Downloaded to ${outputPath}`);
}
```

---

## Exit Code Handling

### Standard Unix Exit Codes

```typescript
/**
 * Standard POSIX exit codes
 */
export enum ExitCode {
  SUCCESS = 0,
  GENERAL_ERROR = 1,
  MISUSE_OF_SHELL_BUILTIN = 2,

  // sysexits.h codes (64-78)
  USAGE_ERROR = 64, // Command line usage error
  DATA_ERROR = 65, // Data format error
  NO_INPUT = 66, // Cannot open input
  NO_USER = 67, // Addressee unknown
  NO_HOST = 68, // Host name unknown
  UNAVAILABLE = 69, // Service unavailable
  SOFTWARE_ERROR = 70, // Internal software error
  OS_ERROR = 71, // System error (e.g., can't fork)
  OS_FILE_ERROR = 72, // Critical OS file missing
  CANT_CREATE = 73, // Can't create (user) output file
  IO_ERROR = 74, // Input/output error
  TEMP_FAIL = 75, // Temp failure; user is invited to retry
  PROTOCOL_ERROR = 76, // Remote error in protocol
  NO_PERMISSION = 77, // Permission denied
  CONFIG_ERROR = 78, // Configuration error

  // 126-165 are reserved
  COMMAND_NOT_EXECUTABLE = 126,
  COMMAND_NOT_FOUND = 127,

  // 128+N = terminated by signal N
  TERMINATED_BY_SIGNAL_BASE = 128,

  // Common signal terminations
  SIGINT = 130, // 128 + 2 (Ctrl+C)
  SIGTERM = 143, // 128 + 15
  SIGKILL = 137, // 128 + 9
}

/**
 * Interpret exit code and provide human-readable message
 */
function interpretExitCode(exitCode: number, signal: NodeJS.Signals | null): {
  type: 'success' | 'error' | 'signal';
  message: string;
  retryable: boolean;
} {
  // Success
  if (exitCode === ExitCode.SUCCESS) {
    return {
      type: 'success',
      message: 'Command completed successfully',
      retryable: false,
    };
  }

  // Signal termination
  if (signal) {
    return {
      type: 'signal',
      message: `Process terminated by signal: ${signal}`,
      retryable: signal === 'SIGTERM' || signal === 'SIGINT',
    };
  }

  // Exit code >= 128 indicates signal termination
  if (exitCode >= ExitCode.TERMINATED_BY_SIGNAL_BASE) {
    const signalNumber = exitCode - ExitCode.TERMINATED_BY_SIGNAL_BASE;
    return {
      type: 'signal',
      message: `Process terminated by signal ${signalNumber}`,
      retryable: true,
    };
  }

  // Specific exit codes
  switch (exitCode) {
    case ExitCode.COMMAND_NOT_FOUND:
      return {
        type: 'error',
        message: 'Command not found',
        retryable: false,
      };

    case ExitCode.COMMAND_NOT_EXECUTABLE:
      return {
        type: 'error',
        message: 'Command not executable (permission denied)',
        retryable: false,
      };

    case ExitCode.USAGE_ERROR:
      return {
        type: 'error',
        message: 'Invalid command usage',
        retryable: false,
      };

    case ExitCode.DATA_ERROR:
      return {
        type: 'error',
        message: 'Invalid data format',
        retryable: false,
      };

    case ExitCode.TEMP_FAIL:
      return {
        type: 'error',
        message: 'Temporary failure (retry recommended)',
        retryable: true,
      };

    case ExitCode.UNAVAILABLE:
      return {
        type: 'error',
        message: 'Service unavailable',
        retryable: true,
      };

    case ExitCode.NO_PERMISSION:
      return {
        type: 'error',
        message: 'Permission denied',
        retryable: false,
      };

    default:
      return {
        type: 'error',
        message: `Command failed with exit code ${exitCode}`,
        retryable: exitCode === ExitCode.GENERAL_ERROR, // Maybe retryable
      };
  }
}

/**
 * Execute and handle exit codes intelligently
 */
async function executeWithExitCodeHandling(
  command: string,
  args: string[]
): Promise<CLIResult> {
  const result = await spawnCLI(command, args);

  const interpretation = interpretExitCode(result.exitCode, result.signal);

  if (interpretation.type !== 'success') {
    throw new CLIError(
      interpretation.retryable ? CLIErrorType.TEMP_FAIL : CLIErrorType.NON_ZERO_EXIT,
      interpretation.message,
      {
        command,
        args,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    );
  }

  return result;
}
```

### CLI-Specific Exit Code Mappings

```typescript
/**
 * Map CLI-specific exit codes to standard errors
 * Many CLI tools use custom exit code ranges
 */
const CLI_EXIT_CODE_MAPS: Record<string, Record<number, CLIErrorType>> = {
  // GitHub CLI
  gh: {
    1: CLIErrorType.GENERAL_ERROR,
    2: CLIErrorType.AUTH_REQUIRED,
    4: CLIErrorType.RATE_LIMITED,
  },

  // Git
  git: {
    1: CLIErrorType.GENERAL_ERROR,
    128: CLIErrorType.INVALID_OUTPUT, // Git specific: invalid argument
    129: CLIErrorType.SIGNAL_TERMINATED, // SIGHUP
  },

  // Claude CLI (example)
  claude: {
    1: CLIErrorType.GENERAL_ERROR,
    2: CLIErrorType.AUTH_REQUIRED,
    3: CLIErrorType.RATE_LIMITED,
    4: CLIErrorType.QUOTA_EXCEEDED,
    5: CLIErrorType.INVALID_OUTPUT,
  },
};

/**
 * Get error type based on CLI-specific exit code
 */
function getErrorTypeFromExitCode(
  command: string,
  exitCode: number
): CLIErrorType {
  const cliName = command.split('/').pop() || command;
  const cliMap = CLI_EXIT_CODE_MAPS[cliName];

  if (cliMap && cliMap[exitCode]) {
    return cliMap[exitCode];
  }

  // Default mapping
  if (exitCode === 0) {
    return CLIErrorType.NON_ZERO_EXIT; // Should never happen
  }

  return CLIErrorType.GENERAL_ERROR;
}
```

---

## Environment Variables

### Secure Environment Variable Passing

```typescript
/**
 * Environment variable manager for CLI tools
 * Implements principle of least privilege
 */
class EnvironmentManager {
  private static readonly SENSITIVE_PATTERNS = [
    /^AWS_/,
    /^AZURE_/,
    /^GCP_/,
    /_SECRET$/,
    /_KEY$/,
    /_TOKEN$/,
    /_PASSWORD$/,
    /^DATABASE_/,
    /^DB_/,
    /^OPENAI_/,
    /^ANTHROPIC_/,
  ];

  /**
   * Create minimal environment for command
   */
  static createMinimalEnv(
    allowedVars: string[] = []
  ): NodeJS.ProcessEnv {
    const minimalEnv: NodeJS.ProcessEnv = {
      // Essential system vars
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      TMPDIR: process.env.TMPDIR,
    };

    // Add explicitly allowed vars
    for (const varName of allowedVars) {
      if (process.env[varName]) {
        minimalEnv[varName] = process.env[varName];
      }
    }

    return minimalEnv;
  }

  /**
   * Create env with specific CLI tool requirements
   */
  static createCLIEnv(
    cli: 'gh' | 'git' | 'claude' | 'openai',
    additionalVars: Record<string, string> = {}
  ): NodeJS.ProcessEnv {
    const cliRequirements: Record<string, string[]> = {
      gh: ['GITHUB_TOKEN', 'GH_TOKEN'],
      git: ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'],
      claude: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
      openai: ['OPENAI_API_KEY'],
    };

    const allowedVars = cliRequirements[cli] || [];
    const env = this.createMinimalEnv(allowedVars);

    // Add additional vars
    Object.assign(env, additionalVars);

    return env;
  }

  /**
   * Validate that no sensitive vars are accidentally exposed
   */
  static validateEnv(env: NodeJS.ProcessEnv): void {
    for (const key of Object.keys(env)) {
      if (this.isSensitiveVar(key)) {
        console.warn(`Warning: Sensitive env var passed to child process: ${key}`);
      }
    }
  }

  /**
   * Check if var name matches sensitive patterns
   */
  static isSensitiveVar(varName: string): boolean {
    return this.SENSITIVE_PATTERNS.some((pattern) => pattern.test(varName));
  }

  /**
   * Redact sensitive values for logging
   */
  static redactForLogging(env: NodeJS.ProcessEnv): Record<string, string> {
    const redacted: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (this.isSensitiveVar(key)) {
        redacted[key] = '***REDACTED***';
      } else {
        redacted[key] = value || '';
      }
    }

    return redacted;
  }
}

/**
 * Execute with managed environment
 */
async function executeWithManagedEnv(
  command: string,
  args: string[],
  options: {
    cli?: 'gh' | 'git' | 'claude' | 'openai';
    additionalEnv?: Record<string, string>;
    allowedVars?: string[];
  } = {}
): Promise<CLIResult> {
  let env: NodeJS.ProcessEnv;

  if (options.cli) {
    env = EnvironmentManager.createCLIEnv(options.cli, options.additionalEnv);
  } else {
    env = EnvironmentManager.createMinimalEnv(options.allowedVars);
    Object.assign(env, options.additionalEnv);
  }

  // Validate before execution
  EnvironmentManager.validateEnv(env);

  // Log redacted environment (for debugging)
  console.debug('Executing with env:', EnvironmentManager.redactForLogging(env));

  return spawnCLI(command, args, { env });
}

// Example usage
async function callGitHubCLI() {
  return executeWithManagedEnv('gh', ['api', 'user'], {
    cli: 'gh',
  });
}

async function callCustomCLI() {
  return executeWithManagedEnv('custom-cli', ['process'], {
    allowedVars: ['CUSTOM_API_KEY'],
    additionalEnv: {
      LOG_LEVEL: 'debug',
    },
  });
}
```

### Alternative: File-Based Secrets

```typescript
import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Load secrets from file instead of environment
 * More secure than env vars for sensitive data
 */
class SecretManager {
  private static cache = new Map<string, string>();

  /**
   * Load secret from file
   */
  static async loadSecret(secretName: string): Promise<string> {
    if (this.cache.has(secretName)) {
      return this.cache.get(secretName)!;
    }

    const secretPath = join(process.env.HOME!, '.config', 'mdcontext', 'secrets', secretName);

    try {
      const secret = await readFile(secretPath, 'utf-8');
      this.cache.set(secretName, secret.trim());
      return secret.trim();
    } catch (error) {
      throw new Error(`Failed to load secret '${secretName}': ${error}`);
    }
  }

  /**
   * Pass secret to CLI via stdin instead of env
   */
  static async executeWithStdinSecret(
    command: string,
    args: string[],
    secretName: string
  ): Promise<CLIResult> {
    const secret = await this.loadSecret(secretName);

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      // Write secret to stdin
      child.stdin?.write(secret);
      child.stdin?.end();

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      child.on('close', (exitCode, signal) => {
        resolve({ stdout, stderr, exitCode, signal });
      });

      child.on('error', reject);
    });
  }

  /**
   * Clear secret cache (for security)
   */
  static clearCache(): void {
    this.cache.clear();
  }
}

// Example usage
async function authenticatedCLICall() {
  // Secret is read from file, not env var
  return SecretManager.executeWithStdinSecret(
    'some-cli',
    ['authenticate', '--stdin'],
    'api_token'
  );
}
```

---

## Testing Strategies

### Mocking Child Processes with Jest

```typescript
// __tests__/cli-integration.test.ts
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

/**
 * Create a mock child process for testing
 */
function createMockChildProcess(): ChildProcess {
  const mockProcess = new EventEmitter() as ChildProcess;

  // Mock stdio streams
  mockProcess.stdout = new EventEmitter() as any;
  mockProcess.stderr = new EventEmitter() as any;
  mockProcess.stdin = new EventEmitter() as any;
  mockProcess.stdin.write = jest.fn();
  mockProcess.stdin.end = jest.fn();

  // Mock methods
  mockProcess.kill = jest.fn().mockReturnValue(true);
  mockProcess.pid = 12345;
  mockProcess.exitCode = null;
  mockProcess.signalCode = null;

  return mockProcess;
}

/**
 * Test suite for CLI integration
 */
describe('CLI Integration', () => {
  let mockSpawn: jest.Mock;
  let mockChildProcess: ChildProcess;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock child process
    mockChildProcess = createMockChildProcess();

    // Mock spawn function
    mockSpawn = jest.fn().mockReturnValue(mockChildProcess);

    // Replace child_process.spawn with mock
    jest.mock('child_process', () => ({
      spawn: mockSpawn,
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should execute command successfully', async () => {
    // Arrange
    const expectedOutput = 'Hello, World!';

    // Act
    const resultPromise = spawnCLI('echo', ['Hello, World!']);

    // Simulate process execution
    setImmediate(() => {
      mockChildProcess.stdout?.emit('data', Buffer.from(expectedOutput));
      mockChildProcess.emit('close', 0, null);
    });

    const result = await resultPromise;

    // Assert
    expect(mockSpawn).toHaveBeenCalledWith('echo', ['Hello, World!'], expect.any(Object));
    expect(result.stdout).toBe(expectedOutput);
    expect(result.exitCode).toBe(0);
  });

  test('should handle timeout', async () => {
    // Arrange
    jest.useFakeTimers();

    // Act
    const resultPromise = spawnCLI('slow-command', [], { timeout: 1000 });

    // Fast-forward time
    jest.advanceTimersByTime(1000);

    // Assert
    await expect(resultPromise).rejects.toThrow('Process timed out');
    expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');

    jest.useRealTimers();
  });

  test('should handle spawn errors', async () => {
    // Arrange
    const error = new Error('Command not found');
    (error as any).code = 'ENOENT';

    // Act
    const resultPromise = spawnCLI('nonexistent-command', []);

    // Simulate spawn error
    setImmediate(() => {
      mockChildProcess.emit('error', error);
    });

    // Assert
    await expect(resultPromise).rejects.toThrow('Failed to spawn process');
  });

  test('should handle non-zero exit codes', async () => {
    // Arrange
    const stderr = 'Error: Something went wrong';

    // Act
    const resultPromise = spawnCLI('failing-command', []);

    // Simulate process failure
    setImmediate(() => {
      mockChildProcess.stderr?.emit('data', Buffer.from(stderr));
      mockChildProcess.emit('close', 1, null);
    });

    const result = await resultPromise;

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(stderr);
  });

  test('should handle buffer overflow', async () => {
    // Arrange
    const largeOutput = 'x'.repeat(11 * 1024 * 1024); // 11MB

    // Act
    const resultPromise = spawnCLI('large-output-command', [], {
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // Simulate large output
    setImmediate(() => {
      mockChildProcess.stdout?.emit('data', Buffer.from(largeOutput));
    });

    // Assert
    await expect(resultPromise).rejects.toThrow('exceeded maxBuffer');
    expect(mockChildProcess.kill).toHaveBeenCalled();
  });
});
```

### Integration Testing with Real CLI Tools

```typescript
// __tests__/integration/git-cli.integration.test.ts

/**
 * Integration tests with real git CLI
 * Use a temporary directory for isolation
 */
describe('Git CLI Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory
    const { mkdtemp } = require('fs/promises');
    const { tmpdir } = require('os');
    const { join } = require('path');

    tempDir = await mkdtemp(join(tmpdir(), 'git-test-'));

    // Initialize git repo
    await safeExecute('git', ['init'], { cwd: tempDir });
    await safeExecute('git', ['config', 'user.name', 'Test User'], { cwd: tempDir });
    await safeExecute('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir });
  });

  afterEach(async () => {
    // Clean up temporary directory
    const { rm } = require('fs/promises');
    await rm(tempDir, { recursive: true, force: true });
  });

  test('should create commit successfully', async () => {
    // Arrange
    const { writeFile } = require('fs/promises');
    const { join } = require('path');

    const testFile = join(tempDir, 'test.txt');
    await writeFile(testFile, 'Hello, World!');

    // Act
    await safeExecute('git', ['add', 'test.txt'], { cwd: tempDir });
    await safeExecute('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir });

    // Assert
    const { stdout } = await safeExecute('git', ['log', '--oneline'], { cwd: tempDir });
    expect(stdout).toContain('Initial commit');
  });

  test('should handle git errors gracefully', async () => {
    // Act & Assert
    await expect(
      safeExecute('git', ['commit', '-m', 'No changes'], { cwd: tempDir })
    ).rejects.toThrow();
  });
});
```

### Snapshot Testing for CLI Outputs

```typescript
// __tests__/snapshots/cli-outputs.test.ts

/**
 * Snapshot testing for consistent CLI outputs
 */
describe('CLI Output Snapshots', () => {
  test('gh issue view output matches snapshot', async () => {
    // Mock the CLI response
    const mockOutput = {
      number: 123,
      title: 'Example Issue',
      state: 'open',
      author: 'octocat',
    };

    jest.spyOn(JSON, 'parse').mockReturnValue(mockOutput);

    // Execute
    const result = await parseJSONOutput(
      'gh',
      ['issue', 'view', '123', '--json', 'number,title,state,author'],
      z.any()
    );

    // Assert against snapshot
    expect(result).toMatchSnapshot();
  });
});
```

### Property-Based Testing

```typescript
import * as fc from 'fast-check';

/**
 * Property-based tests for argument validation
 */
describe('Argument Validation Properties', () => {
  test('sanitizeFilename should never contain directory traversal', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const sanitized = ArgumentValidator.sanitizeFilename(input);

        // Should not contain ..
        expect(sanitized).not.toContain('..');

        // Should only contain safe characters
        expect(sanitized).toMatch(/^[a-zA-Z0-9._-]*$/);

        // Should not exceed 255 characters
        expect(sanitized.length).toBeLessThanOrEqual(255);
      })
    );
  });

  test('detectShellInjection should catch all metacharacters', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SHELL_METACHARACTERS),
        fc.string(),
        fc.string(),
        (metachar, before, after) => {
          const testString = before + metachar + after;
          expect(detectShellInjection(testString)).toBe(true);
        }
      )
    );
  });
});
```

---

## Production Examples

### GitHub CLI Integration

```typescript
/**
 * Production-ready GitHub CLI wrapper
 */
class GitHubCLI {
  /**
   * Check if gh CLI is installed and authenticated
   */
  static async checkAvailability(): Promise<boolean> {
    try {
      await safeExecute('gh', ['auth', 'status'], { timeout: 5000 });
      return true;
    } catch (error) {
      if (error instanceof CLIError) {
        if (error.type === CLIErrorType.COMMAND_NOT_FOUND) {
          throw new Error('GitHub CLI (gh) is not installed. Install from https://cli.github.com');
        }
        if (error.type === CLIErrorType.AUTH_REQUIRED) {
          throw new Error('GitHub CLI is not authenticated. Run: gh auth login');
        }
      }
      return false;
    }
  }

  /**
   * Create an issue
   */
  static async createIssue(options: {
    title: string;
    body: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<{ number: number; url: string }> {
    const args = [
      'issue',
      'create',
      '--title',
      options.title,
      '--body',
      options.body,
      '--json',
      'number,url',
    ];

    if (options.labels) {
      args.push('--label', options.labels.join(','));
    }

    if (options.assignees) {
      args.push('--assignee', options.assignees.join(','));
    }

    const result = await executeWithRetry('gh', args, {}, {
      maxRetries: 3,
      shouldRetry: (error) => error.type === CLIErrorType.RATE_LIMITED,
    });

    const parsed = JSON.parse(result.stdout);
    return {
      number: parsed.number,
      url: parsed.url,
    };
  }

  /**
   * List pull requests
   */
  static async listPullRequests(options: {
    state?: 'open' | 'closed' | 'all';
    limit?: number;
  } = {}): Promise<Array<{ number: number; title: string; state: string }>> {
    const args = [
      'pr',
      'list',
      '--json',
      'number,title,state',
      '--limit',
      (options.limit || 30).toString(),
    ];

    if (options.state) {
      args.push('--state', options.state);
    }

    const result = await executeWithErrorHandling('gh', args);
    return JSON.parse(result.stdout);
  }
}

// Example usage
async function exampleGitHubWorkflow() {
  // Check availability
  await GitHubCLI.checkAvailability();

  // Create issue
  const issue = await GitHubCLI.createIssue({
    title: 'Bug: CLI integration failing',
    body: 'Detailed description of the bug...',
    labels: ['bug', 'cli'],
    assignees: ['octocat'],
  });

  console.log(`Created issue #${issue.number}: ${issue.url}`);

  // List PRs
  const prs = await GitHubCLI.listPullRequests({ state: 'open', limit: 10 });
  console.log(`Found ${prs.length} open PRs`);
}
```

### Git CLI Integration

```typescript
/**
 * Production-ready Git CLI wrapper
 */
class GitCLI {
  constructor(private readonly repoPath: string) {}

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    const result = await safeExecute('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: this.repoPath,
    });
    return result.stdout.trim();
  }

  /**
   * Get commit history
   */
  async getLog(options: { limit?: number; format?: string } = {}): Promise<GitCommit[]> {
    const args = [
      'log',
      '--pretty=format:%H|%an|%ae|%ad|%s',
      '--date=iso',
    ];

    if (options.limit) {
      args.push('-n', options.limit.toString());
    }

    const result = await safeExecute('git', args, {
      cwd: this.repoPath,
    });

    return result.stdout.split('\n').map((line) => {
      const [hash, authorName, authorEmail, date, message] = line.split('|');
      return { hash, authorName, authorEmail, date, message };
    });
  }

  /**
   * Create commit
   */
  async commit(message: string): Promise<string> {
    const result = await safeExecute('git', ['commit', '-m', message], {
      cwd: this.repoPath,
    });

    // Extract commit hash from output
    const match = result.stdout.match(/\[.+ ([a-f0-9]+)\]/);
    return match ? match[1] : '';
  }

  /**
   * Check if repo is clean
   */
  async isClean(): Promise<boolean> {
    const result = await safeExecute('git', ['status', '--porcelain'], {
      cwd: this.repoPath,
    });
    return result.stdout.trim() === '';
  }
}
```

### Claude CLI Integration (Example)

```typescript
/**
 * Example Claude CLI wrapper
 * (Adjust based on actual Claude CLI interface)
 */
class ClaudeCLI {
  /**
   * Generate text completion
   */
  static async generateCompletion(options: {
    prompt: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ content: string; tokens: number }> {
    const args = ['generate', '--prompt', options.prompt];

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.maxTokens) {
      args.push('--max-tokens', options.maxTokens.toString());
    }

    if (options.temperature) {
      args.push('--temperature', options.temperature.toString());
    }

    // Add JSON output flag
    args.push('--output', 'json');

    // Use longer timeout for AI generation
    const timeout = getAdaptiveTimeout({
      type: 'generate',
      estimatedTokens: options.maxTokens || 1000,
      complexity: 'high',
    });

    const result = await executeWithRetry(
      'claude',
      args,
      { timeout },
      {
        maxRetries: 2,
        shouldRetry: (error) =>
          error.type === CLIErrorType.RATE_LIMITED ||
          error.type === CLIErrorType.NETWORK_ERROR,
      }
    );

    const parsed = JSON.parse(result.stdout);
    return {
      content: parsed.content,
      tokens: parsed.usage.total_tokens,
    };
  }

  /**
   * Stream generation with real-time output
   */
  static async streamCompletion(
    prompt: string,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    await spawnWithStreaming(
      'claude',
      ['generate', '--stream', '--prompt', prompt],
      {
        onStdout: onChunk,
        onStderr: (error) => {
          console.error('Claude error:', error);
        },
      }
    );
  }
}
```

---

## Common Pitfalls

### 1. Shell Injection (CRITICAL)

```typescript
// ❌ DANGEROUS - Never do this!
async function dangerousExample(userInput: string) {
  const { exec } = require('child_process');

  // User could input: "; rm -rf /"
  exec(`echo ${userInput}`);
}

// ✅ SAFE - Use spawn with argument array
async function safeExample(userInput: string) {
  await spawnCLI('echo', [userInput]);
}
```

### 2. Buffer Overflow

```typescript
// ❌ WRONG - Default maxBuffer (1MB) may be too small
async function bufferOverflow() {
  await spawnCLI('cat', ['large-file.txt']); // May crash!
}

// ✅ CORRECT - Use streaming or increase buffer
async function handleLargeFile() {
  // Option 1: Stream the output
  await handleLargeOutput('cat', ['large-file.txt'], (chunk) => {
    console.log(chunk);
  });

  // Option 2: Increase buffer
  await spawnCLI('cat', ['large-file.txt'], {
    maxBuffer: 100 * 1024 * 1024, // 100MB
  });
}
```

### 3. Hanging Processes

```typescript
// ❌ WRONG - No timeout, process may hang forever
async function hangingProcess() {
  await spawnCLI('some-unreliable-command', []);
}

// ✅ CORRECT - Always set timeout
async function timeoutProtected() {
  await spawnCLI('some-unreliable-command', [], {
    timeout: 30000, // 30 seconds
  });
}
```

### 4. Environment Variable Leakage

```typescript
// ❌ DANGEROUS - Exposes all env vars to child process
async function envLeakage() {
  await spawnCLI('untrusted-command', [], {
    env: process.env, // All secrets exposed!
  });
}

// ✅ SAFE - Minimal environment
async function minimalEnv() {
  await executeWithManagedEnv('untrusted-command', [], {
    allowedVars: ['PATH'],
  });
}
```

### 5. Race Conditions

```typescript
// ❌ WRONG - Multiple writes may race
async function racyWrites() {
  const child = spawn('command', []);
  child.stdin?.write('first\n');
  child.stdin?.write('second\n'); // May arrive out of order
  child.stdin?.end();
}

// ✅ CORRECT - Wait for drain events
async function sequentialWrites() {
  const child = spawn('command', []);

  await new Promise<void>((resolve) => {
    child.stdin?.write('first\n', () => {
      child.stdin?.write('second\n', () => {
        child.stdin?.end();
        resolve();
      });
    });
  });
}
```

### 6. Platform-Specific Behavior

```typescript
// ❌ WRONG - Assumes Unix paths
async function unixOnly() {
  await spawnCLI('cat', ['/tmp/file.txt']); // Breaks on Windows
}

// ✅ CORRECT - Use path module for cross-platform paths
import { join, resolve } from 'path';
import { tmpdir } from 'os';

async function crossPlatform() {
  const filePath = join(tmpdir(), 'file.txt');
  await spawnCLI('cat', [filePath]);
}
```

### 7. Ignoring stderr

```typescript
// ❌ WRONG - Only checking stdout
async function ignoringErrors() {
  const result = await spawnCLI('command', []);
  console.log(result.stdout); // stderr may contain important warnings!
}

// ✅ CORRECT - Check both stdout and stderr
async function checkingBoth() {
  const result = await spawnCLI('command', []);

  if (result.stderr) {
    console.warn('Warnings/Errors:', result.stderr);
  }

  console.log('Output:', result.stdout);
}
```

---

## Platform Differences

### Windows vs Unix/Linux/macOS

```typescript
/**
 * Platform detection and handling
 */
class PlatformAdapter {
  static readonly isWindows = process.platform === 'win32';
  static readonly isMac = process.platform === 'darwin';
  static readonly isLinux = process.platform === 'linux';

  /**
   * Get shell for current platform
   */
  static getShell(): string {
    if (this.isWindows) {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/sh';
  }

  /**
   * Execute script with appropriate shell
   */
  static async executeScript(
    scriptContent: string,
    extension: '.sh' | '.bat' | '.ps1'
  ): Promise<CLIResult> {
    if (this.isWindows) {
      if (extension === '.ps1') {
        // PowerShell script
        return spawnCLI('powershell.exe', ['-Command', scriptContent]);
      } else {
        // Batch script
        return spawnCLI('cmd.exe', ['/c', scriptContent]);
      }
    } else {
      // Unix shell script
      return spawnCLI('/bin/sh', ['-c', scriptContent]);
    }
  }

  /**
   * Convert command for platform
   */
  static adaptCommand(command: string): { cmd: string; args: string[] } {
    if (this.isWindows) {
      // Windows may need .exe extension
      const windowsCommands: Record<string, string> = {
        node: 'node.exe',
        npm: 'npm.cmd',
        git: 'git.exe',
      };

      const adapted = windowsCommands[command] || command;
      return { cmd: adapted, args: [] };
    }

    return { cmd: command, args: [] };
  }

  /**
   * Get appropriate path separator
   */
  static getPathSeparator(): string {
    return this.isWindows ? ';' : ':';
  }

  /**
   * Normalize path for platform
   */
  static normalizePath(path: string): string {
    if (this.isWindows) {
      return path.replace(/\//g, '\\');
    }
    return path.replace(/\\/g, '/');
  }
}

/**
 * Cross-platform command execution
 */
async function executeCrossPlatform(
  command: string,
  args: string[]
): Promise<CLIResult> {
  const { cmd } = PlatformAdapter.adaptCommand(command);

  // Use cross-spawn for better Windows compatibility
  const crossSpawn = require('cross-spawn');

  return new Promise((resolve, reject) => {
    const child = crossSpawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (exitCode: number, signal: NodeJS.Signals) => {
      resolve({ stdout, stderr, exitCode, signal });
    });

    child.on('error', reject);
  });
}
```

### Handling Line Endings

```typescript
/**
 * Normalize line endings across platforms
 */
function normalizeLineEndings(text: string): string {
  // Convert all line endings to \n
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Convert to platform-specific line endings
 */
function toPlatformLineEndings(text: string): string {
  const normalized = normalizeLineEndings(text);

  if (PlatformAdapter.isWindows) {
    return normalized.replace(/\n/g, '\r\n');
  }

  return normalized;
}
```

---

## Performance Optimization

### Process Pooling for Repeated Calls

```typescript
/**
 * Process pool for reusing long-running processes
 * Useful for CLI tools with high startup cost
 */
class ProcessPool {
  private processes: ChildProcess[] = [];
  private queue: Array<{
    args: string[];
    resolve: (result: CLIResult) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    private readonly command: string,
    private readonly poolSize: number = 3
  ) {}

  /**
   * Execute command using pooled process
   */
  async execute(args: string[]): Promise<CLIResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ args, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.queue.length === 0) return;
    if (this.processes.length >= this.poolSize) return;

    const job = this.queue.shift();
    if (!job) return;

    const child = spawn(this.command, job.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    this.processes.push(child);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (exitCode, signal) => {
      // Remove from pool
      this.processes = this.processes.filter((p) => p !== child);

      job.resolve({ stdout, stderr, exitCode, signal });

      // Process next job
      this.processQueue();
    });

    child.on('error', (error) => {
      this.processes = this.processes.filter((p) => p !== child);
      job.reject(error);
      this.processQueue();
    });
  }

  /**
   * Cleanup all processes
   */
  async cleanup(): Promise<void> {
    for (const process of this.processes) {
      process.kill('SIGTERM');
    }
    this.processes = [];
    this.queue = [];
  }
}

// Example usage
const gitPool = new ProcessPool('git', 5);

async function parallelGitOperations() {
  const results = await Promise.all([
    gitPool.execute(['status']),
    gitPool.execute(['log', '-1']),
    gitPool.execute(['branch', '-a']),
  ]);

  console.log('All git operations completed:', results);
}
```

### Caching CLI Results

```typescript
/**
 * Cache CLI results to avoid redundant executions
 */
class CLICache {
  private cache = new Map<string, { result: CLIResult; timestamp: number }>();

  constructor(private readonly ttlMs: number = 60000) {} // 1 minute default

  /**
   * Get cache key for command
   */
  private getCacheKey(command: string, args: string[]): string {
    return `${command}:${args.join(':')}`;
  }

  /**
   * Execute with caching
   */
  async execute(
    command: string,
    args: string[],
    options: SpawnOptions = {}
  ): Promise<CLIResult> {
    const key = this.getCacheKey(command, args);
    const cached = this.cache.get(key);

    // Return cached if still valid
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      console.debug('Cache hit:', key);
      return cached.result;
    }

    // Execute and cache
    console.debug('Cache miss:', key);
    const result = await spawnCLI(command, args, options);

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    });

    return result;
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Invalidate specific command
   */
  invalidate(command: string, args?: string[]): void {
    if (args) {
      const key = this.getCacheKey(command, args);
      this.cache.delete(key);
    } else {
      // Invalidate all for this command
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${command}:`)) {
          this.cache.delete(key);
        }
      }
    }
  }
}

// Example usage
const cache = new CLICache(5 * 60 * 1000); // 5 minute TTL

async function cachedGitStatus() {
  // First call executes git
  const result1 = await cache.execute('git', ['status']);

  // Second call returns cached result
  const result2 = await cache.execute('git', ['status']);

  // After mutation, invalidate cache
  await spawnCLI('git', ['add', 'file.txt']);
  cache.invalidate('git', ['status']);
}
```

---

## Best Practices Summary

### Security Checklist

- ✅ **ALWAYS** use `spawn()` or `execFile()` with argument arrays
- ✅ **NEVER** use `exec()` with user input
- ✅ **ALWAYS** validate and sanitize user input
- ✅ **NEVER** trust user input in command construction
- ✅ **ALWAYS** use minimal environment variables
- ✅ **NEVER** pass sensitive env vars to untrusted processes
- ✅ **ALWAYS** validate file paths against directory traversal
- ✅ **NEVER** concatenate user input into commands

### Reliability Checklist

- ✅ **ALWAYS** set timeouts for CLI operations
- ✅ **ALWAYS** handle buffer overflow scenarios
- ✅ **ALWAYS** implement retry logic for transient errors
- ✅ **ALWAYS** classify errors (auth, network, etc.)
- ✅ **ALWAYS** check exit codes and stderr
- ✅ **ALWAYS** clean up child processes on exit
- ✅ **ALWAYS** test cross-platform compatibility

### Performance Checklist

- ✅ Use streaming for large outputs
- ✅ Implement caching for repeated operations
- ✅ Use process pooling for frequent calls
- ✅ Set appropriate buffer sizes
- ✅ Use adaptive timeouts based on operation type

---

## References & Sources

### Node.js Child Process Documentation

- [Child process | Node.js v25.3.0 Documentation](https://nodejs.org/api/child_process.html)
- [How To Launch Child Processes in Node.js | DigitalOcean](https://www.digitalocean.com/community/tutorials/how-to-launch-child-processes-in-node-js)
- [Node.js Child Processes: Everything you need to know](https://www.freecodecamp.org/news/node-js-child-processes-everything-you-need-to-know-e69498fe970a/)

### CLI Integration Patterns

- [Building CLI apps with TypeScript in 2026 - DEV Community](https://dev.to/hongminhee/building-cli-apps-with-typescript-in-2026-5c9d)
- [CLI patterns cookbook | Optique](https://optique.dev/cookbook)
- [Streamlining CLI Input with Async Generators](https://typescript.tv/hands-on/streamlining-cli-input-with-async-generators/)

### GitHub CLI Integration

- [GitHub CLI | Take GitHub to the command line](https://cli.github.com/manual/gh)
- [Creating GitHub CLI extensions - GitHub Docs](https://docs.github.com/en/github-cli/github-cli/creating-github-cli-extensions)
- [GitHub - cli/cli: GitHub's official command line tool](https://github.com/cli/cli)

### Security Best Practices

- [Preventing Command Injection Attacks in Node.js Apps](https://auth0.com/blog/preventing-command-injection-attacks-in-node-js-apps/)
- [Secure JavaScript Coding Practices Against Command Injection Vulnerabilities](https://www.nodejs-security.com/blog/secure-javascript-coding-practices-against-command-injection-vulnerabilities)
- [NodeJS Command Injection Guide: Examples and Prevention](https://www.stackhawk.com/blog/nodejs-command-injection-examples-and-prevention/)
- [Do not use secrets in environment variables and here's how to do it better](https://www.nodejs-security.com/blog/do-not-use-secrets-in-environment-variables-and-here-is-how-to-do-it-better)

### Buffer & Timeout Handling

- [Handling Large Output in Node.js: Avoiding ERR_CHILD_PROCESS_STDIO_MAXBUFFER](https://runebook.dev/en/articles/node/errors/err_child_process_stdio_maxbuffer)
- [maxBuffer default too small · Issue #9829 · nodejs/node](https://github.com/nodejs/node/issues/9829)

### Exit Codes

- [Standard Exit Status Codes in Linux | Baeldung on Linux](https://www.baeldung.com/linux/status-codes)
- [Bash command line exit codes demystified](https://www.redhat.com/en/blog/exit-codes-demystified)
- [Exit status - Wikipedia](https://en.wikipedia.org/wiki/Exit_status)

### Cross-Platform Development

- [Creating cross-platform shell scripts • Shell scripting with Node.js](https://exploringjs.com/nodejs-shell-scripting/ch_creating-shell-scripts.html)
- [GitHub - bcoe/awesome-cross-platform-nodejs](https://github.com/bcoe/awesome-cross-platform-nodejs)
- [Writing cross-platform Node.js | George Ornbo](https://shapeshed.com/writing-cross-platform-node/)

### Git CLI Integration

- [GitHub - steveukx/git-js: A light weight interface for running git commands](https://github.com/steveukx/git-js)
- [isomorphic-git · A pure JavaScript implementation of git](https://isomorphic-git.org/)

### Streaming JSON

- [Process streaming JSON with Node.js | by Jake Burden | Medium](https://medium.com/@Jekrb/process-streaming-json-with-node-js-d6530cde72e9)
- [GitHub - uhop/stream-json](https://github.com/uhop/stream-json)
- [GitHub - max-mapper/ndjson](https://github.com/max-mapper/ndjson)

### Process Management

- [Killing process families with node | by Almenon | Medium](https://medium.com/@almenon214/killing-processes-with-node-772ffdd19aad)
- [Handling signals/terminating child processes in Node.js](https://colinchjs.github.io/2023-10-10/08-49-38-631116-handling-signalsterminating-child-processes-in-nodejs/)
- [Graceful Shutdown in Node.js | Dmitry Trunin](https://dtrunin.github.io//2022/04/05/nodejs-graceful-shutdown.html)

### Testing

- [Unit-testing a child process in a Node.js\\Typescript app | by Tzafrir Ben Ami | Medium](https://unhandledexception.dev/unit-testing-a-child-process-in-a-node-js-typescript-app-b7d89615e8e0)
- [GitHub - gotwarlost/mock-spawn: Easy to use mock for child_process.spawn](https://github.com/gotwarlost/mock-spawn)
- [Mocking node:child_process.spawn() using Jest + TypeScript · GitHub](https://gist.github.com/manekinekko/0aae4bbfdec4e47883f7c04310c40fa1)

### AI Integration

- [Vercel AI SDK by Vercel](https://ai-sdk.dev/docs/introduction)
- [GitHub - ben-vargas/ai-sdk-provider-claude-code](https://github.com/ben-vargas/ai-sdk-provider-claude-code)
- [Using Vercel Sandbox to run Claude's Agent SDK](https://vercel.com/kb/guide/using-vercel-sandbox-claude-agent-sdk)

---

## Conclusion

This document provides production-ready patterns for integrating with AI CLI tools in TypeScript/Node.js. The key principles are:

1. **Security First**: Never trust user input, always use argument arrays
2. **Reliability**: Implement timeouts, retries, and comprehensive error handling
3. **Performance**: Use streaming for large outputs, caching for repeated operations
4. **Cross-Platform**: Test on Windows, macOS, and Linux
5. **Testing**: Mock child processes, use integration tests with real CLI tools

For the **mdcontext** project, prioritize:
- Using `spawn()` with explicit argument arrays for security
- Implementing streaming for large codebase processing
- Comprehensive error classification for AI CLI interactions
- Adaptive timeouts based on operation complexity
- Secure environment variable management

Remember: **Shell injection is the #1 vulnerability in CLI integration. Always use argument arrays, never string concatenation.**
