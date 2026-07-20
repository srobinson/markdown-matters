/**
 * Watcher Test Suite
 *
 * Tests the file watcher: debounce behavior, event handling (add/change/unlink),
 * graceful shutdown, and error propagation. Uses vitest fake timers and mocks
 * for chokidar and manifest refresh to avoid real filesystem watching.
 */

import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Effect } from 'effect'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import type { IndexResult } from './types.js'

// ============================================================================
// Mocks
// ============================================================================

// Mock chokidar with an EventEmitter that simulates FSWatcher
const mockWatcher = new EventEmitter() as EventEmitter & {
  close: Mock
}
mockWatcher.close = vi.fn().mockResolvedValue(undefined)

vi.mock('chokidar', () => ({
  watch: vi.fn(() => mockWatcher),
}))

const mockRefreshManifestIndex = vi.fn()

vi.mock('./manifest-refresh.js', () => ({
  refreshManifestIndex: (...args: unknown[]) =>
    mockRefreshManifestIndex(...args),
}))

vi.mock('./ignore-patterns.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ignore-patterns.js')>()),
  getChokidarIgnorePatterns: () => Effect.succeed([/(^|[/\\])\../]),
}))

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
  type Watcher,
  type WatcherOptions,
  watchDirectory as watchDirectoryEffect,
} from './watcher.js'

// ============================================================================
// Helpers
// ============================================================================

const fakeResult: IndexResult = {
  documentsIndexed: 5,
  sectionsIndexed: 10,
  linksIndexed: 3,
  totalDocuments: 5,
  totalSections: 10,
  totalLinks: 3,
  duration: 42,
  errors: [],
  skipped: { unchanged: 0, excluded: 0, hidden: 0, total: 0 },
}

const setupMocks = () => {
  mockRefreshManifestIndex.mockReturnValue(
    Effect.succeed({
      generation: 'gen-1',
      indexRoot: '/test/index/gen-1',
      value: fakeResult,
    }),
  )
}

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.catchAll((e) => Effect.die(e))))

const watchDirectory = (
  rootPath: string,
  options: Omit<WatcherOptions, 'indexRoot'> = {},
) => watchDirectoryEffect(rootPath, { indexRoot: '/test/index', ...options })

const startWatcher = async (
  effect: ReturnType<typeof watchDirectory>,
): Promise<Watcher> => {
  const watcher = await run(effect)
  mockRefreshManifestIndex.mockClear()
  return watcher
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mockWatcher.removeAllListeners()
  setupMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================================
// Event handling
// ============================================================================

describe('file change events', () => {
  it('change event triggers re-index after debounce', async () => {
    const watcher = await startWatcher(watchDirectory('/test/root'))

    mockWatcher.emit('change', '/test/root/doc.md')
    expect(mockRefreshManifestIndex).toHaveBeenCalledTimes(0)

    await vi.advanceTimersByTimeAsync(300)
    expect(mockRefreshManifestIndex).toHaveBeenCalledTimes(1)

    watcher.stop()
  })

  it('add event triggers re-index after debounce', async () => {
    const watcher = await startWatcher(watchDirectory('/test/root'))

    mockWatcher.emit('add', '/test/root/new-file.md')
    await vi.advanceTimersByTimeAsync(300)

    expect(mockRefreshManifestIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('unlink (delete) event triggers re-index after debounce', async () => {
    const watcher = await startWatcher(watchDirectory('/test/root'))

    mockWatcher.emit('unlink', '/test/root/deleted.md')
    await vi.advanceTimersByTimeAsync(300)

    expect(mockRefreshManifestIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('ignores non-markdown files', async () => {
    const watcher = await startWatcher(watchDirectory('/test/root'))

    mockWatcher.emit('change', '/test/root/image.png')
    mockWatcher.emit('add', '/test/root/script.js')
    mockWatcher.emit('unlink', '/test/root/data.json')
    await vi.advanceTimersByTimeAsync(300)

    expect(mockRefreshManifestIndex).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('treats .mdx files as markdown', async () => {
    const watcher = await startWatcher(watchDirectory('/test/root'))

    mockWatcher.emit('change', '/test/root/page.mdx')
    await vi.advanceTimersByTimeAsync(300)

    expect(mockRefreshManifestIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })
})

// ============================================================================
// Debounce behavior
// ============================================================================

describe('debounce', () => {
  it('coalesces multiple rapid changes into a single re-index', async () => {
    const watcher = await startWatcher(watchDirectory('/test/root'))

    // Fire 5 rapid changes within the debounce window
    mockWatcher.emit('change', '/test/root/a.md')
    mockWatcher.emit('change', '/test/root/b.md')
    mockWatcher.emit('add', '/test/root/c.md')
    mockWatcher.emit('unlink', '/test/root/d.md')
    mockWatcher.emit('change', '/test/root/e.md')

    await vi.advanceTimersByTimeAsync(300)

    expect(mockRefreshManifestIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('respects custom debounceMs', async () => {
    const watcher = await startWatcher(
      watchDirectory('/test/root', { debounceMs: 1000 }),
    )

    mockWatcher.emit('change', '/test/root/doc.md')

    // At 300ms, should not have fired yet
    await vi.advanceTimersByTimeAsync(300)
    expect(mockRefreshManifestIndex).not.toHaveBeenCalled()

    // At 1000ms, should fire
    await vi.advanceTimersByTimeAsync(700)
    expect(mockRefreshManifestIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('resets debounce timer on each new event', async () => {
    const watcher = await startWatcher(
      watchDirectory('/test/root', { debounceMs: 300 }),
    )

    mockWatcher.emit('change', '/test/root/a.md')
    await vi.advanceTimersByTimeAsync(200)

    // New event resets the timer
    mockWatcher.emit('change', '/test/root/b.md')
    await vi.advanceTimersByTimeAsync(200)

    // 400ms total elapsed, but only 200ms since last event
    expect(mockRefreshManifestIndex).not.toHaveBeenCalled()

    // 300ms since last event
    await vi.advanceTimersByTimeAsync(100)
    expect(mockRefreshManifestIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })
})

// ============================================================================
// Callbacks
// ============================================================================

describe('callbacks', () => {
  it('calls onIndex after successful re-index', async () => {
    const onIndex = vi.fn()
    const watcher = await startWatcher(
      watchDirectory('/test/root', { onIndex }),
    )
    onIndex.mockClear()

    mockWatcher.emit('change', '/test/root/doc.md')
    await vi.advanceTimersByTimeAsync(300)

    expect(onIndex).toHaveBeenCalledWith({
      documentsIndexed: 5,
      duration: 42,
    })
    watcher.stop()
  })

  it('calls onError when manifest refresh fails during watch', async () => {
    // Use real timers here because Effect's internal fiber scheduling
    // conflicts with vitest fake timer microtask flushing
    vi.useRealTimers()
    setupMocks()

    const onError = vi.fn()
    const watcher = await startWatcher(
      watchDirectory('/test/root', { onError, debounceMs: 50 }),
    )

    mockRefreshManifestIndex.mockReturnValue(
      Effect.fail(new Error('index rebuild exploded')),
    )

    mockWatcher.emit('change', '/test/root/doc.md')

    // Wait for debounce + async resolution
    await new Promise((r) => setTimeout(r, 150))

    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0]![0]!
    expect(err.message).toContain('index rebuild exploded')
    watcher.stop()

    // Restore fake timers for remaining tests
    vi.useFakeTimers()
  })

  it('calls onError when chokidar emits an error', async () => {
    const onError = vi.fn()
    const watcher = await startWatcher(
      watchDirectory('/test/root', { onError }),
    )

    mockWatcher.emit('error', new Error('ENOSPC: no space left on device'))

    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0]![0]!
    expect(err.message).toContain('ENOSPC')
    watcher.stop()
  })
})

// ============================================================================
// Initial index build
// ============================================================================

describe('initial index', () => {
  it('publishes the initial manifest generation', async () => {
    const onIndex = vi.fn()
    const watcher = await run(watchDirectory('/test/root', { onIndex }))

    expect(mockRefreshManifestIndex).toHaveBeenCalledTimes(1)
    expect(mockRefreshManifestIndex).toHaveBeenCalledWith(
      path.resolve('/test/index'),
      path.resolve('/test/root'),
      expect.objectContaining({ changedPaths: undefined }),
    )
    expect(onIndex).toHaveBeenCalledWith({
      documentsIndexed: 5,
      duration: 42,
    })
    watcher.stop()
  })
})

// ============================================================================
// Graceful shutdown
// ============================================================================

describe('stop / shutdown', () => {
  it('stop() closes the chokidar watcher', async () => {
    const watcher = await startWatcher(watchDirectory('/test/root'))
    watcher.stop()

    expect(mockWatcher.close).toHaveBeenCalledTimes(1)
  })

  it('stop() cancels pending debounce timer', async () => {
    const watcher = await startWatcher(watchDirectory('/test/root'))

    mockWatcher.emit('change', '/test/root/doc.md')
    // Timer is scheduled but not yet fired
    watcher.stop()

    await vi.advanceTimersByTimeAsync(300)
    expect(mockRefreshManifestIndex).not.toHaveBeenCalled()
  })
})

describe('generation publication', () => {
  it('publishes watcher changes through the shared transaction', async () => {
    vi.useRealTimers()
    vi.doUnmock('./manifest-refresh.js')
    vi.resetModules()
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-watch-gen-'))
    const sourceRoot = path.join(parent, 'source')
    const home = path.join(parent, 'home')
    await Promise.all([
      fs.mkdir(sourceRoot, { recursive: true }),
      fs.mkdir(home, { recursive: true }),
    ])
    const sourceFile = path.join(sourceRoot, 'doc.md')
    await fs.writeFile(sourceFile, '# One\nInitial body.\n')

    try {
      const watcherModule = await import('./watcher.js')
      const paths = await import('../db/generation-paths.js')
      const watcher = await Effect.runPromise(
        watcherModule.watchDirectory(sourceRoot, {
          indexRoot: home,
          debounceMs: 20,
        }),
      )
      expect(await Effect.runPromise(paths.readCurrentGeneration(home))).toBe(
        'gen-1',
      )

      await fs.writeFile(sourceFile, '# Two\nChanged body.\n')
      mockWatcher.emit('change', sourceFile)
      const deadline = Date.now() + 10_000
      while (
        (await Effect.runPromise(paths.readCurrentGeneration(home))) !== 'gen-2'
      ) {
        if (Date.now() > deadline)
          throw new Error('Timed out waiting for gen-2')
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      watcher.stop()
    } finally {
      await fs.rm(parent, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      })
    }
  }, 20_000)
})
