/**
 * MCP Server - Provider Runtime Bootstrap Regression (ALP-1713/1714)
 *
 * Deterministic regression coverage for the ALP-1713 bug. Before the
 * fix, `src/mcp/server.ts` constructed the MCP server without ever
 * calling `registerDefaultProviders()`, so `md_search` resolved its
 * embedding client against an empty registry and failed with:
 *
 *     Provider "openai" is not registered. Known providers: (none registered).
 *
 * The helper `startMcpServer` now owns the bootstrap-and-create pair,
 * so asserting on the registry state before and after the call pins
 * the regression at the tested unit. The assertions intentionally do
 * NOT depend on real API keys: the post-bootstrap path yields either a
 * registered runtime (when the env is populated) or the actionable
 * `MissingApiKey` form (when it is not). The failing shape is the
 * `ProviderNotFound` with empty `known`, which is what an
 * unbootstrapped registry returns.
 *
 * Split out of `server.test.ts` to keep that file under the 700 LOC
 * refactor threshold and to give the regression its own file-level
 * context so the "why this matters" docblock travels with the test.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../config/schema.js'
import {
  clearRegistry,
  getProvider,
  MissingApiKey,
  ProviderNotFound,
} from '../providers/index.js'
import { startMcpServer } from './server.js'

const scheduleGenerationReap = vi.hoisted(() => vi.fn())

vi.mock('../db/generation-reaper.js', () => ({ scheduleGenerationReap }))

const FIXTURES_DIR = path.resolve(__dirname, '../../tests/fixtures/cli')

describe('startMcpServer provider runtime bootstrap (ALP-1713/1714)', () => {
  beforeEach(() => {
    scheduleGenerationReap.mockClear()
  })

  it('schedules one nonblocking generation sweep', async () => {
    await startMcpServer(FIXTURES_DIR, defaultConfig)

    expect(scheduleGenerationReap).toHaveBeenCalledTimes(1)
    expect(scheduleGenerationReap).toHaveBeenCalledWith(
      await fs.realpath(process.env.MDM_HOME as string),
    )
  })

  it('populates the registry before returning the server', async () => {
    clearRegistry()

    const beforeBootstrap = Effect.runSync(Effect.either(getProvider('openai')))
    expect(beforeBootstrap._tag).toBe('Left')
    if (beforeBootstrap._tag === 'Left') {
      expect(beforeBootstrap.left).toBeInstanceOf(ProviderNotFound)
      expect((beforeBootstrap.left as ProviderNotFound).known).toEqual([])
    }

    await startMcpServer(FIXTURES_DIR, defaultConfig)

    const afterBootstrap = Effect.runSync(Effect.either(getProvider('openai')))
    if (afterBootstrap._tag === 'Left') {
      // Acceptable: bootstrap ran but OPENAI_API_KEY is unset. The
      // failure is surfaced as the actionable credential error rather
      // than the misleading "not registered" error.
      expect(afterBootstrap.left).toBeInstanceOf(MissingApiKey)
    } else {
      expect(afterBootstrap.right.id).toBe('openai')
    }
  })

  it('registers the local (no-credential) providers unconditionally', async () => {
    // Local providers (ollama, lm-studio) use a sentinel api key and
    // never fail construction, so a successful bootstrap must leave
    // them addressable. This assertion is independent of the CI
    // environment's credential state — the only way to break it is to
    // remove the bootstrap call from `startMcpServer`.
    clearRegistry()
    await startMcpServer(FIXTURES_DIR, defaultConfig)

    const ollama = Effect.runSync(Effect.either(getProvider('ollama')))
    expect(ollama._tag).toBe('Right')
    const lmStudio = Effect.runSync(Effect.either(getProvider('lm-studio')))
    expect(lmStudio._tag).toBe('Right')
  })
})
