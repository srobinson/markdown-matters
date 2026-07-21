# MDM Atomic Generation Swap (§7.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans; steps use `- [ ]` checkboxes.

**Goal:** Publish every MDM database rebuild as one durable immutable generation while every logical read remains pinned to one safe generation.

**Architecture:** A cross-process writer lock serializes manifest mutation and builds a complete staged `gen-<n>` before one durable `current` pointer rename publishes it. Readers acquire one gated lease for the whole operation, while a process-identity-aware reaper closes old gates and deletes only unleased noncurrent generations. Existing structural, BM25, and vector serializers write only beneath the staged root.

**Tech Stack:** ESM TypeScript, Effect, Node `fs/promises` and `child_process`, tsup, Vitest, MessagePack, hnswlib-node, and existing manifest, index, BM25, and embedding owners.

Baseline: `design/federated-knowledge-layer` at `95b33b12450f370b536d44de4ff865909c627035`.

## Global Constraints

- NO migration/NO backwards-compat: fresh `gen-1`, ignore direct-root artifacts, delete old paths.
- 700-LOC/150-fn HARD limits.
- ESM TS + tsup + vitest colocated `*.test.ts`.
- Gates: `npx --yes pnpm@10.28.0 test`, `npx --yes pnpm@10.28.0 typecheck`, `npx --yes pnpm@10.28.0 build`, `npx --yes pnpm@10.28.0 check`.
- CI matrix: macOS/Ubuntu/Windows × node20/22.
- POSIX-normalize every returned/stored/ignore-fed path via `split(path.sep).join('/')` (Windows-CI lesson).
- Spawn-based CLI tests need generous timeouts.
- Plan 3 implements §7.2 only. Do not add `--reembed`, `--rewrite-signature`, signature comparison, cost guidance, confirmation, or other §6.1 UX.
- Plan 3 exposes one pure optional preflight hook before manifest append and generation creation. Plan 4 owns every signature policy attached to it.
- Reuse `resolveMdmHome`, `getIndexPaths`, embedding path helpers, `saveIndexState`, `BM25StoreImpl.save`, `HnswVectorStore.save`, `writeVectorIndex`, `refreshManifestIndex`, and `buildManifestIndex`. Do not create parallel serializers or home resolvers.
- Every generation is immutable after publication. No public CLI, MCP, watcher, or facade path may write outside the generation coordinator.
- Branch each task from current `design/federated-knowledge-layer`, open one focused PR into design, and commit only after the task's focused tests and typecheck pass.

## Task 1: Decompose `hybridSearch` before adding session state

**Files:** Create: none. Modify: `src/search/hybrid-search.ts`. Test: `src/search/__tests__/hybrid-search.test.ts`, `src/architecture/db-foundation-boundaries.test.ts`.

**Reuse Map binding:** Reuse `src/search/hybrid-search.ts:hybridSearch` and `fusionRRF`; this task adds no search implementation.

**Interfaces:** Produce `HybridSearchError = FileReadError | IndexCorruptedError | ApiKeyMissingError | ApiKeyInvalidError | EmbeddingError | VectorStoreError | RerankerError`; keep `hybridSearch(rootPath: string, query: string, options?: HybridSearchOptions): Effect.Effect<{ results: readonly HybridSearchResult[]; stats: HybridSearchStats }, HybridSearchError>`. Produce `SearchChannels { semanticResults: readonly SemanticSearchResult[]; keywordResults: readonly BM25SearchResult[]; hasEmbeddings: boolean; hasBM25: boolean }`, `collectSearchChannels(rootPath: string, query: string, options: HybridSearchOptions, limit: number, threshold: number): Effect.Effect<SearchChannels, HybridSearchError>`, `selectEffectiveMode(requested: SearchMode | undefined, channels: SearchChannels): { mode: SearchMode; reason: string }`, and `projectSearchResults(mode: SearchMode, channels: SearchChannels, options: Required<Pick<HybridSearchOptions, 'limit' | 'bm25Weight' | 'semanticWeight' | 'rrfK'>>): { results: HybridSearchResult[]; totalAvailable: number | undefined }`.

- [ ] Add an AST-backed `functionLines(file, symbol)` helper and the assertions `expect(functionLines('search/hybrid-search.ts', 'hybridSearch')).toBeLessThanOrEqual(150)`, `expect(result.results[0]?.sources).toEqual(['semantic', 'keyword'])`, and `expect(result.stats.modeReason).toBe('both indexes available')`.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/search/__tests__/hybrid-search.test.ts src/architecture/db-foundation-boundaries.test.ts`; confirm the size assertion fails at 157 lines.
- [ ] Extract channel collection, mode selection, projection, and reranking without changing weights, thresholds, ordering, or public errors. Keep each helper below 150 lines.
- [ ] Run the focused test command and `npx --yes pnpm@10.28.0 typecheck`; confirm both pass.
- [ ] Commit with `git add src && git commit -m "refactor: decompose hybrid search"`.

## Task 2: Remove the flat and mutable vector layout

**Files:** Create: none. Modify: `src/embeddings/vector-store.ts`, `src/embeddings/vector-store-types.ts`, `src/embeddings/vector-prune.ts`. Test: `src/embeddings/vector-store.test.ts`, `src/index/manifest-build.test.ts`, `src/architecture/db-foundation-boundaries.test.ts`.

**Reuse Map binding:** Reuse `createNamespacedVectorStore` and all helpers in `src/embeddings/embedding-namespace-paths.ts`; delete the parallel flat path and mutable namespace path.

**Interfaces:** Remove `createVectorStore`, `VectorStore.setNamespace`, `VectorStore.getNamespace`, and optional namespace state. Keep `createNamespacedVectorStore(indexRoot: string, provider: string, model: string, dimensions: number, hnswOptions?: HnswBuildOptions): VectorStore`; construction fixes the namespace for the store lifetime.

- [ ] Add `expect(production).not.toMatch(/createVectorStore\(|\.setNamespace\(|private get(?:Vector|Meta)Path/)` and a prune fixture with `expect([...reloaded.getEmbeddedIds()]).toEqual(['current-section'])`.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/embeddings/vector-store.test.ts src/index/manifest-build.test.ts src/architecture/db-foundation-boundaries.test.ts`; confirm forbidden symbols and prune construction fail.
- [ ] Require provider, model, and dimensions at construction; make `pruneVectorNamespaces` call `createNamespacedVectorStore` from catalog metadata; use only embedding path helpers.
- [ ] Run the focused tests and typecheck; confirm all pass.
- [ ] Commit with `git add src && git commit -m "refactor: require namespaced vector stores"`.

## Task 3: Make active provider reads pure and schema validated

**Files:** Create: none. Modify: `src/embeddings/embedding-namespace-catalog.ts`. Test: `src/embeddings/embedding-namespace.test.ts`, `src/architecture/db-foundation-boundaries.test.ts`.

**Reuse Map binding:** Reuse `getActiveProviderPath`, `ActiveProvider`, and `EmbeddingNamespaceError`; remove `getActiveNamespace` write-on-read behavior.

**Interfaces:** Keep `readActiveProvider(rootPath: string): Effect.Effect<ActiveProvider | null, EmbeddingNamespaceError>` and `getActiveNamespace(rootPath: string): Effect.Effect<ActiveProvider | null, EmbeddingNamespaceError>`. Both decode through Effect's `Schema.decodeUnknown`; neither writes.

- [ ] Add a namespace directory with no active file and assert `expect(await Effect.runPromise(getActiveNamespace(root))).toBeNull()` plus `await expect(fs.access(activePath)).rejects.toThrow()`. Write malformed JSON and assert `await expect(Effect.runPromise(readActiveProvider(root))).rejects.toMatchObject({ _tag: 'EmbeddingNamespaceError' })`.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/embeddings/embedding-namespace.test.ts src/architecture/db-foundation-boundaries.test.ts`; confirm the missing pointer is currently created and malformed data is accepted or cast.
- [ ] Add one `ActiveProvider` schema, decode unknown persisted data, return `null` only for a missing file, and delete discovery plus activation from `getActiveNamespace`.
- [ ] Run the focused tests and typecheck; confirm all pass.
- [ ] Commit with `git add src && git commit -m "fix: make active provider reads pure"`.

## Task 4: Extract embedding persistence and propagate signature write failure

**Files:** Create: `src/embeddings/semantic-search-persistence.ts`, `src/embeddings/semantic-search-persistence.test.ts`. Modify: `src/embeddings/semantic-search-build.ts`, `src/embeddings/semantic-search.ts`. Test: `src/embeddings/semantic-search-persistence.test.ts`, `src/embeddings/semantic-search-build-path-filter.test.ts`.

**Reuse Map binding:** Move `src/embeddings/semantic-search-build.ts:saveEmbeddingBuild`; reuse `VectorStore.save`, `invalidateHnswCache`, and `writeActiveProvider` without copying them.

**Interfaces:** Produce `EmbeddingPersistenceInput { indexRoot: string; vectorStore: VectorStore; namespace: string; activeProvider?: ActiveProvider }` and `persistEmbeddingBuild(input: EmbeddingPersistenceInput): Effect.Effect<void, VectorStoreError | EmbeddingNamespaceError>`. `buildEmbeddings` adds `EmbeddingNamespaceError` to its error channel.

- [ ] Use a fake `VectorStore.save` that succeeds and an active-provider target that is a directory. Assert `await expect(Effect.runPromise(persistEmbeddingBuild(input))).rejects.toMatchObject({ _tag: 'EmbeddingNamespaceError' })` and `expect(buildSource).not.toContain('saveEmbeddingBuild')`.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/embeddings/semantic-search-persistence.test.ts src/embeddings/semantic-search-build-path-filter.test.ts`; confirm the module is missing and current code swallows the failure.
- [ ] Move persistence, preserve save then invalidate then active-provider order, delete the warning catch, and propagate the typed failure through `buildEmbeddings`.
- [ ] Run the focused tests and typecheck; confirm all pass.
- [ ] Commit with `git add src && git commit -m "refactor: isolate embedding persistence"`.

## Task 5: Add strict generation names, paths, and pointer reads

**Files:** Create: `src/db/generation-types.ts`, `src/db/generation-errors.ts`, `src/db/generation-paths.ts`, `src/db/generation-paths.test.ts`. Modify: `src/index/types.ts`, `src/index/storage.ts`. Test: `src/db/generation-paths.test.ts`, `src/index/storage.test.ts`.

**Reuse Map binding:** Reuse `resolveMdmHome` for the logical home and `getIndexPaths(indexRoot)` for physical files. Generation names, current pointer decoding, and containment are new-justified because the Reuse Map found no owner.

**Interfaces:** Produce branded `GenerationName`; `GenerationHomeLayout { home: string; current: string; staging: string; writerLock: string; writerReclaim: string }`; `GenerationLayout { home: string; name: GenerationName; root: string; leasesRoot: string; openLeases: string; closedLeases: string }`; `generationHomeLayout(home: string): GenerationHomeLayout`; `parseGenerationName(raw: string): Effect.Effect<GenerationName, GenerationPathError>`; `generationLayout(home: string, name: GenerationName): GenerationLayout`; `stagingGenerationPath(home: string, name: GenerationName, token: string): string`; `readCurrentGeneration(home: string): Effect.Effect<GenerationName | null, FileReadError | GenerationPathError>`; and pure `nextGenerationName(existing: readonly GenerationName[]): GenerationName`.

- [ ] Assert `expect(await Effect.runPromise(parseGenerationName('gen-1'))).toBe('gen-1')`; use `it.each(['gen-0', 'gen-01', 'gen--1', '../gen-1', '/gen-1', ' gen-1', 'gen-1\n', 'gen-1/x'])` and rejection assertions. Assert a symlink or directory at `current` rejects, a missing current is `null` despite direct-root `indexes/`, and `expect(path.relative(home, layout.root)).not.toMatch(/^\.\.(?:[\\/]|$)/)`.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/db/generation-paths.test.ts src/index/storage.test.ts`; confirm imports fail.
- [ ] Require `lstat(current).isFile()` without following symlinks; implement strict `^gen-[1-9][0-9]*$` decoding, exact pointer contents, containment checks, and positive monotonic allocation. Remove inert `cache` and `parsed` members from `getIndexPaths` and their directory creation.
- [ ] Run the focused tests and typecheck; confirm all pass.
- [ ] Commit with `git add src && git commit -m "feat: define generation paths"`.

## Task 6: Add explicit file and directory durability primitives

**Files:** Create: `src/db/fs-durability.ts`, `src/db/fs-durability.test.ts`. Modify: `src/db/generation-errors.ts`. Test: `src/db/fs-durability.test.ts`.

**Reuse Map binding:** Reuse the same-directory temporary file plus rename principle from `src/index/storage.ts:writeJsonFile`. Fsync and directory durability are new-justified because no owner exists.

**Interfaces:** Produce injectable `DurabilityFileSystem`, `PreparedRecord { path: string }`, `syncFile(filePath: string): Effect.Effect<void, GenerationDurabilityError>`, `syncDirectory(directoryPath: string): Effect.Effect<void, GenerationDurabilityError>`, `syncTree(rootPath: string): Effect.Effect<void, GenerationDurabilityError>`, `durableReplaceText(targetPath: string, contents: string): Effect.Effect<void, GenerationDurabilityError>`, `prepareDurableRecord(directoryPath: string, contents: Uint8Array): Effect.Effect<PreparedRecord, GenerationDurabilityError>`, and `linkPreparedRecord(record: PreparedRecord, targetPath: string): Effect.Effect<void, GenerationDurabilityError>`.

- [ ] With a recording adapter, assert `expect(events).toEqual(['write:current.tmp', 'sync-file:current.tmp', 'rename:current.tmp:current', 'sync-dir:home'])`. For every injected failure assert `expect(error).toMatchObject({ _tag: 'GenerationDurabilityError', operation, path: failedPath })`; assert child file events precede directory events.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/db/fs-durability.test.ts`; confirm imports fail.
- [ ] Implement `FileHandle.sync()` and same-directory rename. File fsync is required on every supported platform, including Windows through write-mode file handles. Sync directories on Linux and macOS. On Windows, deliberately skip directory fsync and rely on atomic rename for pointer flips because Node cannot open directories for fsync. Return a typed error for an unknown platform or an unexpected sync error where support is expected.
- [ ] Run the focused tests and typecheck locally; require the same test on every CI OS before merge.
- [ ] Commit with `git add src && git commit -m "feat: add generation durability primitives"`.

## Task 7: Identify process instances across PID reuse

**Files:** Create: `src/db/process-identity.ts`, `src/db/process-identity.test.ts`. Modify: `src/db/generation-errors.ts`. Test: `src/db/process-identity.test.ts`.

**Reuse Map binding:** Process start identity, boot identity, and liveness are new-justified because no process identity owner exists.

**Interfaces:** Produce `ProcessIdentity { pid: number; startedAt: string; bootId: string }`; `ProcessInspector { current(): Effect.Effect<ProcessIdentity, ProcessIdentityError>; inspect(pid: number): Effect.Effect<ProcessIdentity | null, ProcessIdentityError> }`; `nodeProcessInspector: ProcessInspector`; `sameProcessInstance(left: ProcessIdentity, right: ProcessIdentity): boolean`; and `isAbandoned(holder: ProcessIdentity, inspector: ProcessInspector): Effect.Effect<boolean, ProcessIdentityError>`. `inspect` returns `null` only for a dead PID.

- [ ] Assert `expect(await Effect.runPromise(isAbandoned(oldLiveRecord, inspector))).toBe(false)`, `expect(await Effect.runPromise(isAbandoned(deadRecord, inspector))).toBe(true)`, and `expect(await Effect.runPromise(isAbandoned(reusedPidRecord, inspector))).toBe(true)`. Spawn a child and assert two identities equal, then terminate it and assert `expect(await Effect.runPromise(inspector.inspect(pid))).toBeNull()` within 30 seconds.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/db/process-identity.test.ts`; confirm imports fail.
- [ ] Implement Linux `/proc` identity, macOS `ps` plus boot-time identity, and Windows PowerShell/CIM identity using argument arrays, no shell interpolation, and a generous command timeout. Normalize returned text before comparison.
- [ ] Run focused tests and typecheck; require native assertions on all six CI jobs.
- [ ] Commit with `git add src && git commit -m "feat: identify process instances"`.

## Task 8: Serialize writers with an identity-aware cross-process lock

**Files:** Create: `src/db/writer-lock.ts`, `src/db/writer-lock.test.ts`. Modify: `src/db/generation-types.ts`, `src/db/generation-errors.ts`. Test: `src/db/writer-lock.test.ts`.

**Reuse Map binding:** Reuse `ProcessIdentity`, `isAbandoned`, `prepareDurableRecord`, and `linkPreparedRecord`. The writer lock is new-justified because CLI, MCP, and watcher currently have no shared exclusion owner.

**Interfaces:** Produce `WriterLockRecord { token: string; holder: ProcessIdentity; createdAt: string }`, `WriterLock { record: WriterLockRecord; release: Effect.Effect<void, WriterLockError> }`, `WriterLockOptions { inspector?: ProcessInspector; retryMs?: number }`, and `withWriterLock<A, E>(home: string, use: (lock: WriterLock) => Effect.Effect<A, E>, options?: WriterLockOptions): Effect.Effect<A, E | WriterLockError | ProcessIdentityError>`.

- [ ] Start two acquisitions behind a barrier and assert `expect(maxConcurrent).toBe(1)` and `expect(order).toEqual(['first-enter', 'first-exit', 'second-enter', 'second-exit'])`. With fake identities assert dead/reused records are reclaimed, while `expect(acquiredWhileLive).toBe(false)` for old live and malformed records.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/db/writer-lock.test.ts`; confirm imports fail.
- [ ] Prepare and fsync a complete token plus identity record, then atomically hard-link it to the fixed lock path. Use a second atomic reclaim sentinel so concurrent reclaimers cannot unlink a newly acquired lock; re-read token and identity while holding reclaim authority. Release only a matching token.
- [ ] Run focused tests and typecheck; repeat the contention test with spawned processes and a 30 second timeout.
- [ ] Commit with `git add src && git commit -m "feat: serialize generation writers"`.

## Task 9: Acquire one gated lease for a complete read

**Files:** Create: `src/db/generation-reader.ts`, `src/db/generation-reader.test.ts`. Modify: `src/db/generation-types.ts`, `src/db/generation-errors.ts`. Test: `src/db/generation-reader.test.ts`.

**Reuse Map binding:** Reuse `readCurrentGeneration`, `generationLayout`, `ProcessIdentity`, `prepareDurableRecord`, and `linkPreparedRecord`. Reader leases and the reaping gate are new-justified.

**Interfaces:** Produce `GenerationLeaseRecord { leaseId: string; holder: ProcessIdentity; createdAt: string }`, `GenerationReadSession { home: string; generation: GenerationName; indexRoot: string; leaseId: string }`, `GenerationReaderOptions { inspector?: ProcessInspector; fileSystem?: GenerationReaderFileSystem }`, `initializeLeaseGate(layout: GenerationLayout): Effect.Effect<void, GenerationReadError>`, and `withCurrentGeneration<A, E>(home: string, use: (session: GenerationReadSession) => Effect.Effect<A, E>, options?: GenerationReaderOptions): Effect.Effect<A, E | GenerationReadError | ProcessIdentityError>` implemented with `Effect.acquireUseRelease`.

- [ ] Add deterministic barriers after current read, before lease insert, after insert, and before current reread. At every race assert `expect(callbackGenerations).toEqual(['gen-2'])` on retry or `['gen-1']` when admission linearized first, `expect(leasePresentDuringCallback).toBe(true)`, and `expect(await listAllLeases()).toEqual([])` after release.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/db/generation-reader.test.ts`; confirm imports fail.
- [ ] Prepare and fsync a complete lease record, atomically link it into `leases/open`, reread `current` and gate state, retry on change or lost admission, and hold the lease through the whole callback. Never reopen a closed gate.
- [ ] Run focused tests and typecheck; confirm cancellation and callback failure also release.
- [ ] Commit with `git add src && git commit -m "feat: lease generation reads"`.

## Task 10: Build, validate, fsync, and publish one generation

**Files:** Create: `src/db/generation-writer.ts`, `src/db/generation-writer.test.ts`. Modify: `src/db/generation-types.ts`, `src/db/generation-errors.ts`, `src/db/generation-paths.ts`, `src/db/fs-durability.ts`, `src/db/generation-reader.ts`. Test: `src/db/generation-writer.test.ts`.

**Reuse Map binding:** Reuse generation paths, durability, writer lock, and lease gate. Whole-set publication is new-justified because existing serializers have only per-file commit authority.

**Interfaces:** Produce `GenerationBuildContext { home: string; previous: GenerationName | null; generation: GenerationName; indexRoot: string }`, where `indexRoot` is the unpublished staging path during callbacks. Produce `GenerationWriteOptions<A, E, V> { home: string; prepare?: () => Effect.Effect<void, E>; build: (context: GenerationBuildContext) => Effect.Effect<A, E>; validate: (context: GenerationBuildContext, value: A) => Effect.Effect<void, V> }`, `PublishedGeneration<A> { generation: GenerationName; indexRoot: string; value: A }`, `GenerationWriteError { commitState: 'not-published' | 'published'; generation: GenerationName | null }`, and `writeGeneration<A, E, V>(options: GenerationWriteOptions<A, E, V>): Effect.Effect<PublishedGeneration<A>, E | V | GenerationWriteError | WriterLockError | ProcessIdentityError>`.

- [ ] Assert `expect(published.generation).toBe('gen-1')` despite direct-root artifacts. With current gen-1 plus orphan gen-2, assert next is gen-3. After changing a seeded new file assert old remains `old`. Every pre-pointer fault reports `commitState: 'not-published'` and retains gen-1; a final home-sync fault after pointer rename reports `commitState: 'published'`, current gen-2, and a complete gen-2.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/db/generation-writer.test.ts`; confirm imports fail.
- [ ] Under one writer lock: run `prepare`, scan every finalized generation and allocate max plus one with `BigInt`, remove stale unpublished staging directories, independently copy allowed current artifacts, create a fresh open gate, run build and validate, sync the tree, rename staging to `gen-<n>`, sync home, durably replace `current`, and sync home again. Track commit state at pointer rename and never attempt an unsafe rollback. Never reuse an orphan number; never copy leases, gates, temps, or caches; never hard-link database artifacts.
- [ ] Run focused tests and typecheck; confirm a successful pointer names a complete immutable generation.
- [ ] Commit with `git add src && git commit -m "feat: publish complete generations"`.

## Task 11: Transact CLI and MCP manifest builds with every caller

**Files:** Create: none. Modify: `src/index/manifest-refresh.ts`, `src/index/manifest-build.ts`, `src/cli/commands/index-run.ts`, `src/cli/commands/index-embeddings.ts`, `src/mcp/handlers.ts`. Test: `src/index/manifest-build.test.ts`, `src/cli/commands/index-sentinel.test.ts`, `src/cli/cli.test.ts`, `src/mcp/server.test.ts`, `src/architecture/db-foundation-boundaries.test.ts`.

**Reuse Map binding:** Keep `refreshManifestIndex` as the only use-case owner and reuse `buildManifestIndex`, `runEmbeddingRefresh`, and all three serializers against the staged root. Update its two live callers, `src/cli/commands/index-run.ts:runIndexCommand` and `src/mcp/handlers.ts:handleMdIndex`, in this task.

**Interfaces:** Produce `ManifestRefreshContext { home: string; generation: GenerationName; sourceRoot: string; indexRoot: string }`, `ManifestRefreshOptions<E> extends Omit<IndexOptions, 'indexRoot'> { complete?: (context: ManifestRefreshContext) => Effect.Effect<void, E> }`, and `ManifestRefreshError = ManifestError | GenerationWriteError | WriterLockError | ProcessIdentityError | Effect.Effect.Error<ReturnType<typeof buildManifestIndex>>`. `refreshManifestIndex<E = never>(home: string, requestedPath: string | undefined, options: ManifestRefreshOptions<E>): Effect.Effect<PublishedGeneration<IndexResult>, ManifestRefreshError | E>`. Keep both caller interfaces and response schemas, and render their existing output from `PublishedGeneration.value`.

- [ ] Record events and assert `expect(events).toEqual(['append', 'structural', 'vector-prune', 'bm25', 'embedding', 'validate', 'pointer'])`, one final gen-2 pointer, and no root writes. Inject failure after structural, BM25, vector binary, vector metadata, and active-provider steps; each must retain gen-1. Spawn two `mdm index <different-dir>` processes and assert both manifest entries remain and their published generation names are unique. Call MCP index twice and assert `expect(await readCurrentGeneration(home)).toBe('gen-2')`, both referenced generations validate, and `expect(handlerSource).not.toMatch(/buildManifestIndex\(|dbIndexDir\(home\)|saveIndexState\()/)`. Use 60 second timeouts and POSIX output assertions.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/index/manifest-build.test.ts src/cli/commands/index-sentinel.test.ts src/cli/cli.test.ts src/mcp/server.test.ts src/architecture/db-foundation-boundaries.test.ts`; confirm direct-root paths, the post-refresh embedding path, and the stale MCP result access fail.
- [ ] Move manifest append into `prepare`; pass `context.indexRoot` through manifest build and embedding completion; route `handleMdIndex` through the same coordinator; update both live callers directly to their final `PublishedGeneration.value` form. Add no compatibility return shape or temporary adapter.
- [ ] Run the focused tests and `npx --yes pnpm@10.28.0 typecheck`; confirm every `refreshManifestIndex` caller is current and active-provider failure leaves old current unchanged.
- [ ] Commit with `git add src && git commit -m "feat: transact manifest builds"`.

## Task 12: Route watcher writes and close public writer bypasses

**Files:** Create: none. Modify: `src/index/watcher.ts`, `src/index/index.ts`. Test: `src/index/watcher.test.ts`, `src/architecture/db-foundation-boundaries.test.ts`.

**Reuse Map binding:** Reuse `refreshManifestIndex`; delete direct `buildIndex` access from watcher and public facade.

**Interfaces:** Keep `watchDirectory(rootPath: string, options: WatcherOptions): Effect.Effect<Watcher, WatchDirectoryError>`. Initial and debounced work call manifest refresh; `src/index/index.ts` exports no raw save/build function capable of bypassing publication.

- [ ] Trigger one watcher change and assert `expect(await readCurrentGeneration(home)).toBe('gen-2')`. Add `expect(watcherSource).not.toMatch(/buildIndex\(|saveIndexState\(|\.vectorStore\.save\()/)` and assert forbidden public writer exports equal `[]`.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/index/watcher.test.ts src/architecture/db-foundation-boundaries.test.ts`; confirm watcher and facade bypasses fail.
- [ ] Route initial and debounced rebuilds through manifest refresh, consume `PublishedGeneration.value` directly, retain the CLI watch rejection, and explicitly export approved read types and use cases only.
- [ ] Run the focused tests and `npx --yes pnpm@10.28.0 typecheck`; confirm CLI, MCP, and watcher share one publication owner.
- [ ] Commit with `git add src && git commit -m "refactor: close generation writer bypasses"`.

## Task 13: Lease search pipelines and update every search caller

**Files:** Create: `src/search/generation-search.test.ts`, `src/cli/generation-session.test.ts`, `src/mcp/generation-session.test.ts`. Modify: `src/search/hybrid-search.ts`, `src/search/bm25-store.ts`, `src/embeddings/semantic-search.ts`, `src/embeddings/semantic-search-pipeline.ts`, `src/cli/commands/search.ts`, `src/cli/commands/search-mode.ts`, `src/mcp/handlers.ts`. Test: `src/search/generation-search.test.ts`, `src/search/__tests__/hybrid-search.test.ts`, `src/embeddings/semantic-search-path-filter.test.ts`, `src/embeddings/semantic-search-threshold.test.ts`, `src/cli/generation-session.test.ts`, `src/cli/cli.test.ts`, `src/mcp/generation-session.test.ts`, `src/mcp/server.test.ts`.

**Reuse Map binding:** Reuse physical BM25/vector readers, `GenerationReadSession`, and `withCurrentGeneration`. Lease above CLI mode selection, search, refinement, enrichment, summarization input, and output preparation. Lease `src/mcp/handlers.ts:handleMdSearch` once per request. Stores never resolve `current`.

**Interfaces:** Change to `hybridSearch(session: GenerationReadSession, sourceRoot: string, query: string, options?: HybridSearchOptions): Effect.Effect<{ results: readonly HybridSearchResult[]; stats: HybridSearchStats }, HybridSearchError>`; `semanticSearch` and `semanticSearchWithContent`, each with `(session: GenerationReadSession, sourceRoot: string, query: string, options?: SemanticSearchOptions): Effect.Effect<readonly SemanticSearchResult[], SemanticSearchError>`; `semanticSearchWithStats(session: GenerationReadSession, sourceRoot: string, query: string, options?: SemanticSearchOptions): Effect.Effect<SemanticSearchResultWithStats, SemanticSearchError>`; `prepareSearchPipeline(session: GenerationReadSession, sourceRoot: string, query: string, options: SemanticSearchOptions): Effect.Effect<SearchPipelineContext, SemanticSearchError>`; `postProcessResults(session: GenerationReadSession, sourceRoot: string, rawResults: readonly VectorSearchResult[], query: string, options: SemanticSearchOptions, limit: number): Effect.Effect<{ results: readonly SemanticSearchResult[]; totalAvailable: number }, FileReadError | IndexCorruptedError>`; and `detectSearchModes(session: GenerationReadSession): Effect.Effect<{ hasBM25: boolean; hasEmbeddings: boolean; recommendedMode: SearchMode }, never>`. `runSearchCommand(input: SearchCommandInput, session: GenerationReadSession)` consumes the acquired session. The `searchCommand` callback resolves home once and invokes `withCurrentGeneration(home, (session) => runSearchCommand(input, session))`.

- [ ] Build different source and generation roots with conflicting markers; assert `expect(result.results.map((item) => item.heading)).toEqual(['old-semantic', 'old-keyword'])`, `expect(result.stats).toMatchObject({ bm25Available: true, embeddingsAvailable: true })`, and `expect(searchPipelineSource).not.toMatch(/resolveMdmHome|dbIndexDir/)`. Spawn a held CLI search and MCP search, flip current, and assert each held result contains only gen-1, the next request contains only gen-2, `expect(await listAllLeases()).toEqual([])`, and POSIX-only output. Use 60 second timeouts.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/search/generation-search.test.ts src/search/__tests__/hybrid-search.test.ts src/embeddings/semantic-search-path-filter.test.ts src/embeddings/semantic-search-threshold.test.ts src/cli/generation-session.test.ts src/cli/cli.test.ts src/mcp/generation-session.test.ts src/mcp/server.test.ts`; confirm required signatures strand the current CLI, MCP, internal semantic, and test callers.
- [ ] Thread `session.indexRoot` through vector, active-provider, BM25, semantic-with-content, refinement, and post-processing reads; thread `sourceRoot` only through canonical source resolution and path matching. Update every direct caller in the listed production and test files to its final session form while acquiring exactly once at each CLI command or MCP request boundary. Add no stub arguments. Extract orchestration before any file exceeds 700 lines or function exceeds 150 lines.
- [ ] Run the focused tests and `npx --yes pnpm@10.28.0 typecheck`; use `rg` to confirm every call of `hybridSearch`, `semanticSearch`, `semanticSearchWithStats`, `semanticSearchWithContent`, `prepareSearchPipeline`, `postProcessResults`, and `detectSearchModes` supplies the required final arguments.
- [ ] Commit with `git add src && git commit -m "feat: lease search pipelines"`.

## Task 14: Lease structural search and update every structural caller

**Files:** Create: `src/index/generation-read-routing.test.ts`. Modify: `src/search/content-search.ts`, `src/search/context.ts`, `src/cli/commands/search-mode.ts`, `src/mcp/handlers.ts`. Test: `src/index/generation-read-routing.test.ts`, `src/search/searcher.test.ts`, `src/integration/search-keyword.test.ts`, `src/cli/generation-session.test.ts`, `src/cli/cli.test.ts`, `src/mcp/generation-session.test.ts`, `src/mcp/server.test.ts`.

**Reuse Map binding:** Reuse `createStorage(sourceRoot, session.indexRoot)`, structural loaders, the CLI lease established in Task 13, and `withCurrentGeneration` for `src/mcp/handlers.ts:handleMdKeywordSearch`. Retain source file reads through `resolveSourceFile`.

**Interfaces:** Produce `SearchReadError = FileReadError | IndexCorruptedError | CliValidationError`; `search(session: GenerationReadSession, sourceRoot: string, options?: SearchOptions): Effect.Effect<readonly SearchResult[], SearchReadError>`; `searchContent(session: GenerationReadSession, sourceRoot: string, options?: SearchOptions): Effect.Effect<readonly SearchResult[], SearchReadError>`; `searchWithContent(session: GenerationReadSession, sourceRoot: string, options?: SearchOptions): Effect.Effect<readonly SearchResult[], SearchReadError>`; and `getContext(session: GenerationReadSession, sourceRoot: string, filePath: string, options?: ContextOptions): Effect.Effect<DocumentContext, IndexNotFoundError | DocumentNotFoundError | FileReadError | IndexCorruptedError>`. Keep MCP handler signatures and response schemas.

- [ ] Hold gen-1, flip current, and assert `expect(new Set(extractMarkers(searchResult, contentResult, contextResult))).toEqual(new Set(['gen-1']))`, `expect(structuralReaderSource).not.toMatch(/resolveMdmHome|dbIndexDir/)`, the held CLI keyword result remains gen-1, and the next long-lived MCP keyword request returns gen-2 with no surviving lease.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/index/generation-read-routing.test.ts src/search/searcher.test.ts src/integration/search-keyword.test.ts src/cli/generation-session.test.ts src/cli/cli.test.ts src/mcp/generation-session.test.ts src/mcp/server.test.ts`; confirm required signatures strand `src/cli/commands/search-mode.ts:runKeywordMode`, `src/mcp/handlers.ts:handleMdKeywordSearch`, the internal `searchWithContent` call, and existing direct tests.
- [ ] Pass the existing CLI session through every keyword branch. Acquire one MCP session around the complete keyword request and response construction. Update every direct caller in the listed production and test files to the final `(session, sourceRoot, ...)` form; preserve result shapes and add no temporary overload.
- [ ] Run the focused tests and `npx --yes pnpm@10.28.0 typecheck`; use `rg` to confirm every call of `search`, `searchContent`, `searchWithContent`, and `getContext` supplies the required final arguments.
- [ ] Commit with `git add src && git commit -m "feat: lease structural reads"`.

## Task 15: Lease links and duplicates with every command caller

**Files:** Create: `src/index/generation-link-read.test.ts`. Modify: `src/index/link-index.ts`, `src/duplicates/detector.ts`, `src/cli/commands/links.ts`, `src/cli/commands/backlinks.ts`, `src/cli/commands/duplicates.ts`, `src/mcp/handlers.ts`. Test: `src/index/generation-link-read.test.ts`, `src/index/indexer.test.ts`, `src/index/canonical-indexing.test.ts`, `src/duplicates/detector.test.ts`, `src/cli/generation-session.test.ts`, `src/cli/cli.test.ts`, `src/mcp/generation-session.test.ts`, `src/mcp/server.test.ts`.

**Reuse Map binding:** Reuse structural loaders, `GenerationReadSession`, `withCurrentGeneration`, and `resolveSourceFile`. Each CLI links, backlinks, or duplicates invocation and each MCP links or backlinks request acquires once above every read and rendering step.

**Interfaces:** Produce `resolveIndexedDocumentKey(session: GenerationReadSession, filePath: string): Effect.Effect<DocumentKey | null, FileReadError | IndexCorruptedError>`; `getOutgoingLinks(session: GenerationReadSession, filePath: string)`, `getIncomingLinks(session: GenerationReadSession, filePath: string)`, and `getBrokenLinks(session: GenerationReadSession)`, each returning `Effect.Effect<readonly string[], FileReadError | IndexCorruptedError>`; and `detectExactDuplicates(session: GenerationReadSession, sourceRoot: string, options?: DuplicateDetectionOptions)` plus `detectDuplicates(session: GenerationReadSession, sourceRoot: string, options?: DuplicateDetectionOptions)`, each returning `Effect.Effect<DuplicateDetectionResult, FileReadError | IndexCorruptedError>`. Keep external CLI and MCP schemas unchanged.

- [ ] Hold gen-1, flip current, and assert `expect(new Set(extractMarkers(outgoing, incoming, duplicates))).toEqual(new Set(['gen-1']))`, `expect(readerSource).not.toMatch(/resolveMdmHome|dbIndexDir/)`, every held command or request returns only gen-1, every next request returns gen-2, and `expect(await listAllLeases()).toEqual([])`. Use 60 second spawned-process timeouts and POSIX path assertions.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/index/generation-link-read.test.ts src/index/indexer.test.ts src/index/canonical-indexing.test.ts src/duplicates/detector.test.ts src/cli/generation-session.test.ts src/cli/cli.test.ts src/mcp/generation-session.test.ts src/mcp/server.test.ts`; confirm required signatures strand the CLI, MCP, internal duplicate, and existing test callers.
- [ ] Thread `session.indexRoot` into every document, link, and section load; keep `sourceRoot` only for duplicate path filters. Update all callers in `links.ts`, `backlinks.ts`, `duplicates.ts`, `handlers.ts`, `detector.ts`, and the listed tests directly to final leased form. The duplicates command retains its session for Task 16 index info. Add no stub session or later rewrite.
- [ ] Run the focused tests and `npx --yes pnpm@10.28.0 typecheck`; use `rg` to confirm every call of `resolveIndexedDocumentKey`, `getOutgoingLinks`, `getIncomingLinks`, `getBrokenLinks`, `detectExactDuplicates`, and `detectDuplicates` supplies the required final arguments.
- [ ] Commit with `git add src && git commit -m "feat: lease link and duplicate reads"`.

## Task 16: Lease validated statistics with every remaining caller

**Files:** Create: `src/cli/generation-info.test.ts`. Modify: `src/embeddings/semantic-search-stats.ts`, `src/cli/utils.ts`, `src/cli/commands/stats.ts`, `src/cli/commands/search-mode.ts`, `src/cli/commands/duplicates.ts`, `src/cli/commands/embeddings.ts`. Test: `src/cli/generation-info.test.ts`, `src/index/storage.test.ts`, `src/cli/generation-session.test.ts`, `src/cli/cli.test.ts`.

**Reuse Map binding:** Reuse active-provider/vector readers, structural schemas, `withCurrentGeneration`, and the sessions already owned by search and duplicates. Replace `getIndexInfo` direct JSON parsing rather than creating another decoder. Database reads in the stats and embeddings commands acquire once around their complete rendering bodies.

**Interfaces:** Produce `getEmbeddingStats(session: GenerationReadSession): Effect.Effect<EmbeddingStats, VectorStoreError | EmbeddingNamespaceError | DimensionMismatchError>` and `getIndexInfo(session: GenerationReadSession): Effect.Effect<IndexInfo, FileReadError | IndexCorruptedError | VectorStoreError | EmbeddingNamespaceError | DimensionMismatchError>`. Existing CLI options and output shapes remain unchanged.

- [ ] Hold gen-1, flip current, and assert `expect(info.sectionCount).toBe(gen1Sections)`, `expect(stats.count).toBe(gen1Vectors)`, every held stats, search, duplicates, or embedding inspection renders only gen-1, and `expect(await listAllLeases()).toEqual([])`. Assert `expect(cliUtilsSource).not.toMatch(/readFile\([^)]*sections|JSON\.parse|resolveMdmHome|dbIndexDir/)` and POSIX-only displayed paths.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/cli/generation-info.test.ts src/index/storage.test.ts src/cli/generation-session.test.ts src/cli/cli.test.ts`; confirm required signatures strand `src/cli/commands/stats.ts`, `src/cli/commands/search-mode.ts`, and `src/cli/commands/duplicates.ts`.
- [ ] Load structural data through storage schemas and embedding data through the held session. Pass the existing session in search and duplicates; acquire once in stats and each remaining database inspection command. Update every direct caller to final leased form and preserve `IndexInfo` output fields. Extract command orchestration before any file exceeds 700 lines or function exceeds 150 lines.
- [ ] Run the focused tests and `npx --yes pnpm@10.28.0 typecheck`; use `rg` to confirm every call of `getEmbeddingStats` and `getIndexInfo` supplies the required session and malformed indexes return typed failures.
- [ ] Commit with `git add src && git commit -m "feat: lease validated statistics"`.

## Task 17: Key and evict caches by generation

**Files:** Create: `src/embeddings/generation-cache.test.ts`. Modify: `src/embeddings/hnsw-cache.ts`, `src/index/storage.ts`, `src/embeddings/semantic-search-pipeline.ts`, `src/embeddings/semantic-search-build.ts`. Test: `src/embeddings/generation-cache.test.ts`, `src/index/storage.test.ts`.

**Reuse Map binding:** Extend existing `hnswCacheKey`, `invalidateHnswCache`, and `clearIndexCache`; do not add a second cache registry.

**Interfaces:** Produce `hnswCacheKey(home: string, namespace: string, generation: GenerationName): string` returning exactly `home::namespace::gen`, `evictHnswGeneration(home: string, generation: GenerationName): void`, and `clearIndexCache(indexRoot?: string): void`, where explicit root evicts only that generation.

- [ ] Assert `expect(hnswCacheKey('/home', 'openai_model_512', 'gen-1')).toBe('/home::openai_model_512::gen-1')`; after eviction assert gen-1 is absent, gen-2 store remains, and structural gen-2 remains cached.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/embeddings/generation-cache.test.ts src/index/storage.test.ts`; confirm the two-part key and retained old paths fail.
- [ ] Thread home and generation from sessions into cache calls; add selective eviction to existing maps; preserve full clear for tests.
- [ ] Run focused tests and typecheck; confirm no reaped path remains referenced.
- [ ] Commit with `git add src && git commit -m "fix: key caches by generation"`.

## Task 18: Close gates and reap only proven-safe old generations

**Files:** Create: `src/db/generation-reaper.ts`, `src/db/generation-reaper.test.ts`. Modify: `src/db/generation-writer.ts`, `src/db/generation-reader.ts`, `src/db/generation-types.ts`, `src/db/generation-errors.ts`, `src/cli/main.ts`, `src/mcp/server.ts`. Test: `src/db/generation-reaper.test.ts`, `src/embeddings/generation-cache.test.ts`, `src/mcp/server-bootstrap.test.ts`.

**Reuse Map binding:** Reuse generation paths, pointer reader, process identity, lease records, and cache eviction functions. Reaping is new-justified.

**Interfaces:** Produce `GenerationReaperOptions { graceMs: number; inspector?: ProcessInspector; now?: () => number; onReaped?: (layout: GenerationLayout) => void }`, `ReapResult { generation: GenerationName; status: 'current' | 'leased' | 'grace' | 'reaped' }`, `reapGeneration(home: string, generation: GenerationName, options: GenerationReaperOptions): Effect.Effect<ReapResult, GenerationReaperError | ProcessIdentityError>`, `reapOldGenerations(home: string, options: GenerationReaperOptions): Effect.Effect<readonly ReapResult[], GenerationReaperError | ProcessIdentityError>`, and nonblocking `scheduleGenerationReap(home: string): void` for post-publish plus CLI/MCP startup sweeps.

- [ ] Hold a gen-1 lease, publish gen-2, and assert `expect(await exists(gen1Root)).toBe(true)` until release, then `expect(result.status).toBe('reaped')` after grace. Assert current returns `current`; any generation numbered above current remains untouched; old live and malformed leases return `leased`; dead/reused leases disappear. Flip current during reap and assert the candidate remains. Assert CLI and MCP startup each schedule exactly one nonblocking sweep.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/db/generation-reaper.test.ts src/embeddings/generation-cache.test.ts src/mcp/server-bootstrap.test.ts`; confirm imports fail.
- [ ] Treat only generations numerically below current as reap candidates, rename open to closed once, examine leases, apply identity then grace, reread current immediately before deletion, evict caches, and delete. Schedule after publish and startup without blocking on a live reader.
- [ ] Run focused tests and typecheck; run a live child lease with a 30 second timeout on every CI OS.
- [ ] Commit with `git add src && git commit -m "feat: reap retired generations safely"`.

## Task 19: Reconcile vectors by content hash and clear forced-empty state

**Files:** Create: none. Modify: `src/index/manifest-build.ts`, `src/embeddings/vector-prune.ts`, `src/embeddings/semantic-search-build.ts`, `src/embeddings/semantic-search-persistence.ts`. Test: `src/index/manifest-build.test.ts`, `src/embeddings/semantic-search-build-path-filter.test.ts`.

**Reuse Map binding:** Reuse document hashes, `VectorStore.getEmbeddedDocumentHashes`, `pruneStaleVectorEntries`, and the extracted persistence owner.

**Interfaces:** Change to `pruneVectorNamespaces(indexRoot: string, currentSectionHashes: ReadonlyMap<string, string>)`. Add `clearSemanticGeneration(indexRoot: string, namespace: string): Effect.Effect<void, VectorStoreError | EmbeddingNamespaceError>` to the persistence owner.

- [ ] Edit content while preserving a section ID and assert `expect(reloaded.getEmbeddedIds().has(sectionId)).toBe(false)`. Force zero eligible sections and assert `expect(await semanticArtifactPaths(home)).toEqual([])`. Force active-provider failure and assert current bytes remain `gen-1`.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/index/manifest-build.test.ts src/embeddings/semantic-search-build-path-filter.test.ts`; confirm stale vector and forced-empty assertions fail.
- [ ] Prune by section ID plus document hash; on forced zero, remove vector/meta and active-provider together inside staging; propagate every persistence failure.
- [ ] Run focused tests and typecheck; confirm no stale or partial semantic state reaches publication.
- [ ] Commit with `git add src && git commit -m "fix: reconcile generation vectors"`.

## Task 20: Validate the complete generation before publication

**Files:** Create: `src/db/generation-validation.ts`, `src/db/generation-validation.test.ts`. Modify: `src/db/generation-writer.ts`. Test: `src/db/generation-validation.test.ts`, `src/index/manifest-build.test.ts`.

**Reuse Map binding:** Reuse structural schemas/loaders, `BM25StoreImpl.load`, `readActiveProvider`, and `loadVectorIndex`. The new validator composes existing decoders and owns no serialization.

**Interfaces:** Produce `GenerationArtifactSummary { documents: number; sections: number; links: number; bm25Sections: number; activeNamespace: string | null; vectors: number }` and `validateGeneration(indexRoot: string): Effect.Effect<GenerationArtifactSummary, GenerationValidationError | FileReadError | IndexCorruptedError | VectorStoreError | EmbeddingNamespaceError>`.

- [ ] Omit, corrupt, or replace with a symlink each structural file, one BM25 pair member, active-provider, vector metadata, and vector binary. Assert `await expect(Effect.runPromise(validateGeneration(root))).rejects.toMatchObject({ _tag: 'GenerationValidationError' })`; assert `expect(valid.activeNamespace).toBeNull()` for a fully absent semantic set and current remains old on every rejection.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/db/generation-validation.test.ts src/index/manifest-build.test.ts`; confirm imports fail.
- [ ] Require contained regular files for structural and BM25 sets, enforce semantic all-or-none for the active namespace, allow other Plan 3 namespaces, and call validation before fsync/publication.
- [ ] Run focused tests and typecheck; confirm every published generation is complete.
- [ ] Commit with `git add src && git commit -m "feat: validate generation artifacts"`.

## Task 21: Expose the pure §6.1 preflight seam only

**Files:** Create: none. Modify: `src/db/generation-types.ts`, `src/db/generation-writer.ts`, `src/index/manifest-refresh.ts`. Test: `src/db/generation-writer.test.ts`, `src/index/manifest-build.test.ts`, `src/architecture/db-foundation-boundaries.test.ts`.

**Reuse Map binding:** Extend the single generation transaction owner. Do not create a signature policy, CLI flag, alternate coordinator, or second hook.

**Interfaces:** Produce `GenerationPreflightContext { home: string; current: GenerationName | null }`, `GenerationPreflight<P> = (context: GenerationPreflightContext) => Effect.Effect<void, P>`, and extend to `GenerationWriteOptions<A, E, V, P = never> { preflight?: GenerationPreflight<P> }`. `writeGeneration<A, E, V, P = never>` returns error channel `E | V | P | GenerationWriteError | WriterLockError | ProcessIdentityError`.

- [ ] Assert `expect(events).toEqual(['lock', 'preflight', 'prepare', 'stage', 'build', 'validate', 'publish'])`. Make preflight fail and assert `expect(await fs.readFile(manifestPath, 'utf8')).toBe(beforeManifest)`, generation names equal the before set, and current bytes are unchanged. Assert `expect(production).not.toMatch(/reembed|rewrite-signature|signature mismatch choice|rewrite confirmation/)`.
- [ ] Run `npx --yes pnpm@10.28.0 exec vitest run src/db/generation-writer.test.ts src/index/manifest-build.test.ts src/architecture/db-foundation-boundaries.test.ts`; confirm the option and order assertions fail.
- [ ] Invoke the optional pure hook after lock acquisition and current read, before `prepare` and before staging creation. Thread its generic error without interpreting it. Add no call site until Plan 4 supplies policy.
- [ ] Run focused tests and typecheck; confirm omitted preflight preserves Plan 3 behavior.
- [ ] Commit with `git add src && git commit -m "feat: expose generation preflight seam"`.

## Coverage Matrix

| Contract or finding | Owning tasks | Proof |
| --- | --- | --- |
| Strict regular `current` pointer and contained `gen-<n>` | 5, 10 | Grammar, containment, bootstrap, and pointer fault tests |
| Immutable complete generations | 6, 10, 20 | Copy isolation, fsync trace, validator, and publication tests |
| One session and lease per logical read | 9, 13, 14, 15, 16 | Barrier, mixed marker, CLI, and MCP tests |
| Atomic gate admission plus reread and retry | 9, 18 | Every race barrier and closed gate release tests |
| PID plus start plus boot identity; age never abandons | 7, 8, 9, 18 | Native child, fake PID reuse, long-lived lease tests |
| Reaper never deletes current and applies drain plus grace | 18 | Pointer recheck, live lease, release, and grace tests |
| Cross-process writer serialization | 8, 10, 11, 12 | Concurrent process and single coordinator tests |
| Independent-copy seeding with no hard links | 10 | New-copy mutation leaves old generation unchanged |
| Fresh `gen-1`; direct-root artifacts ignored | 5, 10 | Bootstrap fixture with legacy root data |
| Cache key `home::namespace::gen` and reap eviction | 17, 18 | Exact key and selective eviction tests |
| P0: four independent commit authorities | 10, 11, 12, 20 | One pointer follows all serializer and validation events |
| P0: per-loader resolution mixes generations | 9, 13, 14, 15, 16 | Held-session pointer flip tests |
| P0: read mutates signature | 3 | Missing pointer remains missing after reads |
| P0: active-provider failure is swallowed | 4, 19, 20 | Typed failure aborts publication |
| P0: source root and database root conflict | 13, 14, 15, 16 | Different-root fixtures and ambient-root absence checks |
| P0: writer and manifest races | 8, 10, 11, 12 | Serialized append and unique generation tests |
| P0: stale vectors survive stable section IDs | 19 | Content-hash and forced-empty semantic tests |
| §6.1 attaches without UX in Plan 3 | 21 | Preflight order, zero-write failure, forbidden UX scan |

## Final Verification

- [ ] Run all new focused tests together: `npx --yes pnpm@10.28.0 exec vitest run src/db/*.test.ts src/embeddings/generation-cache.test.ts src/search/generation-search.test.ts src/index/generation-read-routing.test.ts src/index/generation-link-read.test.ts src/cli/generation-info.test.ts src/cli/generation-session.test.ts src/mcp/generation-session.test.ts src/architecture/db-foundation-boundaries.test.ts`.
- [ ] Run the four required gates exactly as listed in Global Constraints and `git diff --check`; observe zero failures.
- [ ] Run all six CI jobs. Require native process identity, directory durability, hard-link lock, directory gate rename, spawned CLI, and live child lease tests to pass on macOS, Ubuntu, and Windows with Node 20 and 22.
- [ ] Check every new and touched production file is at most 700 lines and every touched function is at most 150 lines. Split before merge when either limit fails.
- [ ] In an isolated temporary `MDM_HOME`, build gen-1, query through CLI and one persistent MCP process, publish gen-2 from another process, hold and release an old lease, inject a pre-pointer failure, restart MCP, and reap. Assert every observed set is all old or all new and current never names an incomplete generation.
- [ ] Confirm `git status --short` lists only intended Plan 3 source/test changes and the pre-existing user-owned `LESSONS.md`; never mutate a live home during verification.
