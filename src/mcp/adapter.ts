/**
 * Effect-to-MCP adapter utilities.
 *
 * Provides shared helpers for converting Effect results and errors into
 * MCP CallToolResult responses, plus path validation at the MCP boundary.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Effect, Schema } from 'effect'

import { resolvePathWithinRoot } from '../db/canonical.js'

// ============================================================================
// MCP Result Constructors
// ============================================================================

/** Build a successful MCP tool result with text content. */
export const mcpText = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
})

/** Build an MCP error result with text content. */
export const mcpError = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: `Error: ${message}` }],
  isError: true,
})

// ============================================================================
// Effect-to-MCP Adapter
// ============================================================================

/**
 * Run an Effect and convert the outcome to a CallToolResult.
 *
 * On success, the `format` function transforms the value into a
 * CallToolResult. On failure, the error's `.message` field is wrapped
 * in a structured MCP error response.
 *
 * This replaces the per-handler pattern of:
 *   Effect.catchAll(e => Effect.succeed({ error: e.message }))
 *   + subsequent `if ('error' in result)` guard
 */
export const effectToMcpResult = async <A, E extends { message: string }>(
  effect: Effect.Effect<A, E>,
  format: (value: A) => CallToolResult,
): Promise<CallToolResult> =>
  Effect.runPromise(
    effect.pipe(
      Effect.map(format),
      Effect.catchAll((e: E) => Effect.succeed(mcpError(e.message))),
    ),
  )

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate MCP tool arguments against an Effect Schema.
 * Returns a typed result or an MCP error response with a descriptive message.
 */
export const validateArgs = async <A, I>(
  schema: Schema.Schema<A, I>,
  args: Record<string, unknown>,
): Promise<A | CallToolResult> => {
  const result = await Effect.runPromise(
    Schema.decodeUnknown(schema)(args).pipe(
      Effect.catchAll((e) =>
        Effect.succeed({
          _validationError: true as const,
          content: [
            {
              type: 'text' as const,
              text: `Invalid arguments: ${String(e)}`,
            },
          ],
          isError: true,
        }),
      ),
    ),
  )

  if (result && typeof result === 'object' && '_validationError' in result) {
    const { _validationError: _, ...toolResult } = result
    return toolResult as CallToolResult
  }

  return result as A
}

/** Type guard: true when the value is a CallToolResult validation error. */
export const isValidationError = (value: unknown): value is CallToolResult =>
  value !== null &&
  typeof value === 'object' &&
  'isError' in value &&
  'content' in value

// ============================================================================
// Path Validation
// ============================================================================

/**
 * Resolve a user-supplied path against rootPath and verify it stays within
 * the root boundary. Returns the resolved absolute path or a CallToolResult
 * error if the path escapes the root (via `../` traversal, absolute paths
 * outside root, or symlinks pointing outside root).
 */
export const resolveAndValidatePath = async (
  rootPath: string,
  filePath: string,
): Promise<string | CallToolResult> => {
  const resolved = await resolvePathWithinRoot(rootPath, filePath)
  return resolved ?? pathTraversalError(filePath)
}

const pathTraversalError = (filePath: string): CallToolResult => ({
  content: [{ type: 'text', text: `Error: Path outside root: ${filePath}` }],
  isError: true,
})

/** Type guard: true when resolveAndValidatePath returned an error result. */
export const isPathError = (
  result: string | CallToolResult,
): result is CallToolResult => typeof result !== 'string'
