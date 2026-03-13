/**
 * Watcher Test Suite
 *
 * Tests the file watcher: debounce behavior, event handling (add/change/unlink),
 * graceful shutdown, and error propagation. Uses vitest fake timers and mocks
 * for chokidar and buildIndex to avoid real filesystem watching.
 */

import { EventEmitter } from 'node:events'
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

// Mock buildIndex and indexExists
const mockBuildIndex = vi.fn()
const mockIndexExists = vi.fn()

vi.mock('./indexer.js', () => ({
  buildIndex: (...args: unknown[]) => mockBuildIndex(...args),
}))

vi.mock('./storage.js', () => ({
  createStorage: (rootPath: string) => ({
    rootPath,
    paths: {
      root: `${rootPath}/.mdm`,
      config: `${rootPath}/.mdm/config.json`,
      documents: `${rootPath}/.mdm/indexes/documents.json`,
      sections: `${rootPath}/.mdm/indexes/sections.json`,
      links: `${rootPath}/.mdm/indexes/links.json`,
      cache: `${rootPath}/.mdm/cache`,
      parsed: `${rootPath}/.mdm/cache/parsed`,
    },
  }),
  indexExists: (...args: unknown[]) => mockIndexExists(...args),
}))

vi.mock('./ignore-patterns.js', () => ({
  getChokidarIgnorePatterns: () => Effect.succeed([/(^|[/\\])\../]),
}))

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { watchDirectory } from './watcher.js'

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

const setupMocks = (opts: { indexAlreadyExists?: boolean } = {}) => {
  mockBuildIndex.mockReturnValue(Effect.succeed(fakeResult))
  mockIndexExists.mockReturnValue(
    Effect.succeed(opts.indexAlreadyExists ?? true),
  )
}

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.catchAll((e) => Effect.die(e))))

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
    const watcher = await run(watchDirectory('/test/root'))

    mockWatcher.emit('change', '/test/root/doc.md')
    expect(mockBuildIndex).toHaveBeenCalledTimes(0)

    await vi.advanceTimersByTimeAsync(300)
    expect(mockBuildIndex).toHaveBeenCalledTimes(1)

    watcher.stop()
  })

  it('add event triggers re-index after debounce', async () => {
    const watcher = await run(watchDirectory('/test/root'))

    mockWatcher.emit('add', '/test/root/new-file.md')
    await vi.advanceTimersByTimeAsync(300)

    expect(mockBuildIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('unlink (delete) event triggers re-index after debounce', async () => {
    const watcher = await run(watchDirectory('/test/root'))

    mockWatcher.emit('unlink', '/test/root/deleted.md')
    await vi.advanceTimersByTimeAsync(300)

    expect(mockBuildIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('ignores non-markdown files', async () => {
    const watcher = await run(watchDirectory('/test/root'))

    mockWatcher.emit('change', '/test/root/image.png')
    mockWatcher.emit('add', '/test/root/script.js')
    mockWatcher.emit('unlink', '/test/root/data.json')
    await vi.advanceTimersByTimeAsync(300)

    expect(mockBuildIndex).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('treats .mdx files as markdown', async () => {
    const watcher = await run(watchDirectory('/test/root'))

    mockWatcher.emit('change', '/test/root/page.mdx')
    await vi.advanceTimersByTimeAsync(300)

    expect(mockBuildIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })
})

// ============================================================================
// Debounce behavior
// ============================================================================

describe('debounce', () => {
  it('coalesces multiple rapid changes into a single re-index', async () => {
    const watcher = await run(watchDirectory('/test/root'))

    // Fire 5 rapid changes within the debounce window
    mockWatcher.emit('change', '/test/root/a.md')
    mockWatcher.emit('change', '/test/root/b.md')
    mockWatcher.emit('add', '/test/root/c.md')
    mockWatcher.emit('unlink', '/test/root/d.md')
    mockWatcher.emit('change', '/test/root/e.md')

    await vi.advanceTimersByTimeAsync(300)

    // All 5 events should produce exactly 1 buildIndex call
    expect(mockBuildIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('respects custom debounceMs', async () => {
    const watcher = await run(
      watchDirectory('/test/root', { debounceMs: 1000 }),
    )

    mockWatcher.emit('change', '/test/root/doc.md')

    // At 300ms, should not have fired yet
    await vi.advanceTimersByTimeAsync(300)
    expect(mockBuildIndex).not.toHaveBeenCalled()

    // At 1000ms, should fire
    await vi.advanceTimersByTimeAsync(700)
    expect(mockBuildIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('resets debounce timer on each new event', async () => {
    const watcher = await run(watchDirectory('/test/root', { debounceMs: 300 }))

    mockWatcher.emit('change', '/test/root/a.md')
    await vi.advanceTimersByTimeAsync(200)

    // New event resets the timer
    mockWatcher.emit('change', '/test/root/b.md')
    await vi.advanceTimersByTimeAsync(200)

    // 400ms total elapsed, but only 200ms since last event
    expect(mockBuildIndex).not.toHaveBeenCalled()

    // 300ms since last event
    await vi.advanceTimersByTimeAsync(100)
    expect(mockBuildIndex).toHaveBeenCalledTimes(1)
    watcher.stop()
  })
})

// ============================================================================
// Callbacks
// ============================================================================

describe('callbacks', () => {
  it('calls onIndex after successful re-index', async () => {
    const onIndex = vi.fn()
    const watcher = await run(watchDirectory('/test/root', { onIndex }))

    mockWatcher.emit('change', '/test/root/doc.md')
    await vi.advanceTimersByTimeAsync(300)

    expect(onIndex).toHaveBeenCalledWith({
      documentsIndexed: 5,
      duration: 42,
    })
    watcher.stop()
  })

  it('calls onError when buildIndex fails during watch', async () => {
    // Use real timers here because Effect's internal fiber scheduling
    // conflicts with vitest fake timer microtask flushing
    vi.useRealTimers()
    setupMocks()

    const onError = vi.fn()
    const watcher = await run(
      watchDirectory('/test/root', { onError, debounceMs: 50 }),
    )

    // Make buildIndex reject via Effect.fail so runPromise throws
    mockBuildIndex.mockReturnValue(
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
    const watcher = await run(watchDirectory('/test/root', { onError }))

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
  it('builds initial index when none exists', async () => {
    setupMocks({ indexAlreadyExists: false })
    const onIndex = vi.fn()
    const watcher = await run(watchDirectory('/test/root', { onIndex }))

    // buildIndex should have been called once for initial build
    expect(mockBuildIndex).toHaveBeenCalledTimes(1)
    expect(onIndex).toHaveBeenCalledWith({
      documentsIndexed: 5,
      duration: 42,
    })
    watcher.stop()
  })

  it('skips initial build when index already exists', async () => {
    setupMocks({ indexAlreadyExists: true })
    const watcher = await run(watchDirectory('/test/root'))

    expect(mockBuildIndex).not.toHaveBeenCalled()
    watcher.stop()
  })
})

// ============================================================================
// Graceful shutdown
// ============================================================================

describe('stop / shutdown', () => {
  it('stop() closes the chokidar watcher', async () => {
    const watcher = await run(watchDirectory('/test/root'))
    watcher.stop()

    expect(mockWatcher.close).toHaveBeenCalledTimes(1)
  })

  it('stop() cancels pending debounce timer', async () => {
    const watcher = await run(watchDirectory('/test/root'))

    mockWatcher.emit('change', '/test/root/doc.md')
    // Timer is scheduled but not yet fired
    watcher.stop()

    await vi.advanceTimersByTimeAsync(300)
    // buildIndex should NOT have been called because we stopped before debounce fired
    expect(mockBuildIndex).not.toHaveBeenCalled()
  })
})
