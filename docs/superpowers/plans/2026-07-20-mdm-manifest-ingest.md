# MDM Manifest Driven Consolidated Ingest Implementation Plan

Baseline: `c15e8690f3aceba6dc768594336c8b2b26061d6d`

## Goal

Make `mdm index` build and refresh one consolidated database from `$MDM_HOME/manifest.toml`. A path argument appends one manifest directory, then the whole manifest refreshes. Each directory honors recurse, depth, nested git style ignores, canonical key and inode deduplication, structural content hash reuse, fresh embedding, and direct writes to the active database index directory.

## Architecture

`src/manifest.ts` owns the declarative directory list. `src/index/file-discovery.ts` remains the filesystem walker, extended per manifest entry. `src/index/ignore-patterns.ts` remains the only ignore engine and evaluates scoped `ignore@7` filters by directory and type tier. `src/index/manifest-build.ts` sits above the single root adapter: it discovers all roots, canonicalizes the union once through `canonicalizeDiscoveredFiles`, builds one mutable state, prunes anything outside the complete discovery, saves once, and rebuilds BM25. Embedding reuse compares section ID and persisted document hash. CLI and MCP ingestion both route through one manifest use case.

## Tech Stack

ESM TypeScript, Effect, `@effect/cli`, `smol-toml`, `ignore@7`, Vitest with colocated `*.test.ts`, MessagePack, hnswlib, and the existing temporary file plus rename writers.

## Global Constraints

- No migration, backwards compatibility, or vector import. Fresh databases only. Delete stale old per-directory indexes and rebuild from markdown source.
- Signature homogeneity UX from Section 6.1 is outside this plan. Do not add new-home, `--reembed`, or `--rewrite-signature` behavior.
- Atomic generation swap from Section 7.2 is outside this plan. Write directly to `dbIndexDir(resolveMdmHome())` as today.
- New and touched files stay at or below 700 lines. Refactor an existing file before adding behavior if it exceeds 700 lines. Keep functions near 150 lines or less.
- Use Effect and `@effect/cli`; ESM TypeScript; `smol-toml`; `ignore@7`; colocated Vitest tests.
- Reuse `resolveMdmHome`, `dbIndexDir`, `canonicalizeDiscoveredFiles`, `canonicalizeSourceFile`, `fileIdentityKey`, `selectCanonicalSource`, `resolveSourceFile`, `computeHash`, mutable index state, storage writers, BM25 store, and the vector store. Do not create parallel implementations.
- Manifest paths are absolute declared paths after tilde expansion and lexical normalization. Do not realpath them in the TOML file. Canonical targets are captured during ingest.
- `recurse` defaults to true. `depth=0` means top-level files only. Reject a positive depth with `recurse=false`.
- A missing or empty manifest makes no-argument `mdm index` fail with guidance. It never falls back to the current directory.
- Plan 2 rejects `mdm index --watch`. Correct multi-root watching and dynamic nested ignore refresh belong to later freshness work.
- Branch each task from current `design/federated-knowledge-layer`. Open one PR per task into design. CI runs for `design/**` pull requests.
- Required gates: `npx --yes pnpm@10.28.0 test`, `npx --yes pnpm@10.28.0 typecheck`, `npx --yes pnpm@10.28.0 build`, and `npx --yes pnpm@10.28.0 check`.

## Task 1: Add the manifest owner and retire `[[sources]]`

### Files

- Create `src/toml.ts`, `src/manifest.ts`, and `src/manifest.test.ts`.
- Modify `src/config/loader.ts`, `src/config/index.ts`, and `src/config/config-precedence.test.ts`.
- Modify `src/cli/commands/init-cmd.ts` and `src/cli/commands/init-cmd.test.ts`.

### Interfaces

Produce `manifestPath(home)`, `loadManifest(home)`, and `appendManifestDirectory(home, input)`. Keep config loader public behavior, except delete `GlobalSource` and `readGlobalSources`. `mdm init --global` records the current directory through the manifest owner.

### Write the failing test

```ts
it('loads defaults and appends an absolute declared path once', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-manifest-'))
  cleanup.push(home)
  await fs.writeFile(
    manifestPath(home),
    '[[dir]]\npath = "~/notes"\n\n[[dir]]\npath = "/tmp/shallow"\nrecurse = true\ndepth = 2\n',
  )
  const loaded = await Effect.runPromise(loadManifest(home))
  expect(loaded.directories).toEqual([
    { path: expandDeclaredPath('~/notes'), recurse: true },
    { path: expandDeclaredPath('/tmp/shallow'), recurse: true, depth: 2 },
  ])
  const source = path.join(home, 'source')
  await fs.mkdir(source)
  expect((await Effect.runPromise(appendManifestDirectory(home, { path: source }))).added).toBe(true)
  expect((await Effect.runPromise(appendManifestDirectory(home, { path: source }))).added).toBe(false)
  expect((await Effect.runPromise(loadManifest(home))).directories).toHaveLength(3)
})

it('rejects a contradictory non-recursive depth', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-manifest-'))
  cleanup.push(home)
  await fs.writeFile(manifestPath(home), '[[dir]]\npath="/tmp/notes"\nrecurse=false\ndepth=2\n')
  await expect(Effect.runPromise(loadManifest(home))).rejects.toMatchObject({ _tag: 'ManifestError' })
})
```

### Run to fail

`npx --yes pnpm@10.28.0 exec vitest run src/manifest.test.ts src/config/config-precedence.test.ts src/cli/commands/init-cmd.test.ts`

Expected: `src/manifest.ts` is missing; `mdm init` still writes `[[sources]]` to `.mdm.toml`.

### Minimal implementation

```ts
// src/toml.ts
import * as fs from 'node:fs'
import { parse, type TomlTable } from 'smol-toml'

export interface TomlParseError { readonly path: string; readonly message: string }
export type TomlDocumentLoadResult =
  | { readonly status: 'missing'; readonly path: string }
  | { readonly status: 'loaded'; readonly path: string; readonly value: TomlTable }
  | { readonly status: 'error'; readonly error: TomlParseError }

export const loadTomlDocumentWithStatus = (filePath: string): TomlDocumentLoadResult => {
  try {
    if (!fs.existsSync(filePath)) return { status: 'missing', path: filePath }
    return { status: 'loaded', path: filePath, value: parse(fs.readFileSync(filePath, 'utf-8')) }
  } catch (error) {
    return { status: 'error', error: { path: filePath, message: error instanceof Error ? error.message : String(error) } }
  }
}
```

```ts
// src/manifest.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Data, Effect } from 'effect'
import { stringify, type TomlTable } from 'smol-toml'
import { type DeclaredPath, expandDeclaredPath } from './db/canonical.js'
import { loadTomlDocumentWithStatus } from './toml.js'

export interface ManifestDirectory {
  readonly path: DeclaredPath
  readonly recurse: boolean
  readonly depth?: number | undefined
}
export interface MdmManifest { readonly directories: readonly ManifestDirectory[] }
export class ManifestError extends Data.TaggedError('ManifestError')<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}
export const manifestPath = (home: string): string => path.join(home, 'manifest.toml')

const decodeDirectory = (value: unknown, filePath: string): ManifestDirectory => {
  if (!value || typeof value !== 'object') throw new ManifestError({ path: filePath, message: 'Each [[dir]] must be a table' })
  const raw = value as Record<string, unknown>
  if (typeof raw.path !== 'string' || raw.path.trim() === '') throw new ManifestError({ path: filePath, message: 'Each [[dir]] needs a non-empty path' })
  const recurse = raw.recurse ?? true
  if (typeof recurse !== 'boolean') throw new ManifestError({ path: filePath, message: 'dir.recurse must be a boolean' })
  const depth = raw.depth
  if (depth !== undefined && (!Number.isInteger(depth) || (depth as number) < 0)) throw new ManifestError({ path: filePath, message: 'dir.depth must be a non-negative integer' })
  if (recurse === false && typeof depth === 'number' && depth > 0) throw new ManifestError({ path: filePath, message: 'dir.depth cannot be positive when recurse is false' })
  return { path: expandDeclaredPath(raw.path), recurse, ...(typeof depth === 'number' ? { depth } : {}) }
}

export const loadManifest = (home: string): Effect.Effect<MdmManifest, ManifestError> => {
  const filePath = manifestPath(home)
  const result = loadTomlDocumentWithStatus(filePath)
  if (result.status === 'missing') return Effect.succeed({ directories: [] })
  if (result.status === 'error') return Effect.fail(new ManifestError({ ...result.error }))
  return Effect.try({
    try: () => ({ directories: Array.isArray(result.value.dir) ? result.value.dir.map((entry) => decodeDirectory(entry, filePath)) : [] }),
    catch: (cause) => cause instanceof ManifestError ? cause : new ManifestError({ path: filePath, message: String(cause), cause }),
  })
}

export const appendManifestDirectory = (
  home: string,
  input: { readonly path: string; readonly recurse?: boolean; readonly depth?: number },
) => Effect.gen(function* () {
  const manifest = yield* loadManifest(home)
  const entry = decodeDirectory({ path: input.path, recurse: input.recurse, depth: input.depth }, manifestPath(home))
  if (manifest.directories.some((directory) => directory.path === entry.path)) return { manifest, added: false as const }
  const table: TomlTable = { path: entry.path, ...(entry.recurse === false ? { recurse: false } : {}), ...(entry.depth !== undefined ? { depth: entry.depth } : {}) }
  const block = stringify({ dir: [table] }).trim()
  const filePath = manifestPath(home)
  yield* Effect.tryPromise({
    try: async () => { await fs.mkdir(home, { recursive: true }); const current = await fs.readFile(filePath, 'utf-8').catch(() => ''); await fs.writeFile(filePath, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${current ? '\n' : ''}${block}\n`) },
    catch: (cause) => new ManifestError({ path: filePath, message: 'Cannot update manifest', cause }),
  })
  return { manifest: { directories: [...manifest.directories, entry] }, added: true as const }
})
```

Make `loadTomlFileWithStatus` a thin mapping over `loadTomlDocumentWithStatus`. Delete `GlobalSource`, `readGlobalSources`, their barrel exports, and their config test. Replace `appendSource` in `init-cmd.ts` with `yield* appendManifestDirectory(resolveMdmHome({ create: true }), { path: cwd })`. Assert generated config never contains `[[sources]]`.

### Run to pass

`npx --yes pnpm@10.28.0 exec vitest run src/manifest.test.ts src/config/loader.test.ts src/config/config-precedence.test.ts src/cli/commands/init-cmd.test.ts && npx --yes pnpm@10.28.0 typecheck`

### Commit

`git add src && git commit -m "feat: add manifest directory ownership"`

## Task 2: Add bounded discovery and nested ignore inheritance

### Files

- Modify `src/index/ignore-patterns.ts`, `src/index/ignore-patterns.test.ts`, `src/index/file-discovery.ts`, and `src/index/file-discovery.test.ts`.
- Modify `src/index/watcher.ts` to import `isMarkdownFile`; do not change watcher behavior.

### Interfaces

Extend `FileDiscoveryOptions` with `recurse?: boolean` and `depth?: number`. Replace the raw `Ignore` build filter with `IgnoreHierarchy`. Add `extendIgnoreHierarchy(parent, directory)` and make `shouldIgnore(relativePath, hierarchy, directory)` the only traversal decision.

### Write the failing test

```ts
it('re-anchors nested ignores and honors negation across levels', async () => {
  const root = await makeTree({
    '.gitignore': '*.md\n',
    'top.md': '# top',
    'notes/.gitignore': '!keep.md\n',
    'notes/keep.md': '# keep',
    'notes/drop.md': '# drop',
  })
  const filter = await Effect.runPromise(createIgnoreFilter({ rootPath: root }))
  const result = await Effect.runPromise(discoverFiles(root, filter, { recurse: true }))
  expect(result.files).toEqual([path.join(root, 'notes', 'keep.md')])
})

it('does not read an ignore file below an ignored directory', async () => {
  const root = await makeTree({ '.gitignore': 'drafts/\n', 'drafts/.gitignore': '!keep.md\n', 'drafts/keep.md': '# keep' })
  const filter = await Effect.runPromise(createIgnoreFilter({ rootPath: root }))
  expect((await Effect.runPromise(discoverFiles(root, filter, { recurse: true }))).files).toEqual([])
})

it.each([
  [{ recurse: false }, ['root.md']],
  [{ recurse: true, depth: 0 }, ['root.md']],
  [{ recurse: true, depth: 1 }, ['root.md', 'one/one.md']],
])('bounds descent with %o', async (options, expected) => {
  const root = await makeTree({ 'root.md': '# root', 'one/one.md': '# one', 'one/two/two.md': '# two' })
  const filter = await Effect.runPromise(createIgnoreFilter({ rootPath: root }))
  const result = await Effect.runPromise(discoverFiles(root, filter, options))
  expect(result.files.map((file) => path.relative(root, file)).sort()).toEqual(expected)
})
```

### Run to fail

`npx --yes pnpm@10.28.0 exec vitest run src/index/ignore-patterns.test.ts src/index/file-discovery.test.ts`

Expected: nested files are not loaded and recurse or depth options are unknown or ignored.

### Minimal implementation

```ts
interface ScopedIgnore { readonly base: string; readonly filter: Ignore }
export interface IgnoreHierarchy {
  readonly rootPath: string
  readonly defaults: Ignore
  readonly git: readonly ScopedIgnore[]
  readonly mdm: readonly ScopedIgnore[]
  readonly cli: Ignore
  readonly sources: readonly string[]
  readonly patternCount: number
}

const decision = (
  rootPath: string,
  scoped: ScopedIgnore,
  relativePath: string,
  directory: boolean,
): boolean | undefined => {
  const local = path.relative(scoped.base, path.join(rootPath, relativePath)).split(path.sep).join('/')
  if (local === '..' || local.startsWith('../')) return undefined
  const tested = scoped.filter.test(directory ? `${local}/` : local)
  return tested.ignored ? true : tested.unignored ? false : undefined
}

export const shouldIgnore = (relativePath: string, hierarchy: IgnoreHierarchy, directory = false): boolean => {
  const candidate = relativePath.split(path.sep).join('/')
  let ignored = hierarchy.defaults.ignores(directory ? `${candidate}/` : candidate)
  for (const tier of [hierarchy.git, hierarchy.mdm] as const) {
    for (const scoped of tier) ignored = decision(hierarchy.rootPath, scoped, candidate, directory) ?? ignored
  }
  const cliDecision = decision(hierarchy.rootPath, { base: hierarchy.rootPath, filter: hierarchy.cli }, candidate, directory)
  return cliDecision ?? ignored
}
```

Implement `createIgnoreFilter` with defaults, root git, root mdm, and CLI as separate tiers. `extendIgnoreHierarchy` reads `.gitignore` and `.mdmignore` from the entered directory and appends scoped filters within their own tiers. In `walkDirectory`, test each directory with `directory=true`; stop when `recurse` is false or `currentDepth >= depth`; only then load its child hierarchy. Keep the existing hidden-entry divergence and document it in code and tests. Delete test-only `createFilterFunction`.

### Run to pass

`npx --yes pnpm@10.28.0 exec vitest run src/index/ignore-patterns.test.ts src/index/file-discovery.test.ts src/index/watcher.test.ts && npx --yes pnpm@10.28.0 typecheck`

### Commit

`git add src/index && git commit -m "feat: honor nested ingest boundaries"`

## Task 3: Build one structural and BM25 index from the manifest

### Files

- Create `src/index/manifest-build.ts` and `src/index/manifest-build.test.ts`.
- Modify `src/index/index-build.ts`, `src/index/index-state.ts`, `src/index/link-index.ts`, `src/index/bm25-build.ts`, `src/index/types.ts`, `src/index/storage.ts`, and relevant colocated tests.
- Modify `src/index/indexer.ts` and `src/index/index.ts` facades.
- Modify `src/search/path-matcher.ts`, `src/search/hybrid-search.ts`, and `src/embeddings/semantic-search-pipeline.ts` to remove the persisted single-root fallback.

### Interfaces

Produce `buildManifestIndex(manifest, options)` and internal `buildDiscoveredIndex(corpus, options)`. Keep `buildIndex(root, options)` as a one-root adapter. Replace persisted `DocumentIndex.rootPath` with manifest ownership; no replacement root field is stored.

### Write the failing test

```ts
it('deduplicates overlapping roots and hardlinks before one save', async () => {
  const { home, first, second } = await makeManifestRoots()
  const sharedA = path.join(first, 'a.md')
  const sharedZ = path.join(second, 'z.md')
  await fs.writeFile(sharedZ, '# shared')
  await fs.link(sharedZ, sharedA)
  await fs.writeFile(path.join(second, 'only.md'), '# only')
  await fs.mkdir(path.join(second, 'nested'))
  const manifest = { directories: [
    { path: expandDeclaredPath(first), recurse: true },
    { path: expandDeclaredPath(second), recurse: true },
    { path: expandDeclaredPath(path.join(second, 'nested')), recurse: true },
  ] }
  const result = await Effect.runPromise(buildManifestIndex(manifest, { indexRoot: home }))
  const documents = await Effect.runPromise(loadDocumentIndex(createStorage(home, home)))
  const survivor = await fs.realpath(sharedA) as DocumentKey
  expect(result.totalDocuments).toBe(2)
  expect(Object.keys(documents?.documents ?? {})).toContain(survivor)
  expect(documents?.documents[survivor]?.declaredPaths).toEqual([sharedA, sharedZ])
})

it('prunes a root removed from the complete manifest', async () => {
  const fixture = await makeManifestRoots()
  await Effect.runPromise(buildManifestIndex(fixture.manifest, { indexRoot: fixture.home }))
  const result = await Effect.runPromise(buildManifestIndex({ directories: [fixture.manifest.directories[0]!] }, { indexRoot: fixture.home }))
  expect(result.totalDocuments).toBe(1)
})
```

### Run to fail

`npx --yes pnpm@10.28.0 exec vitest run src/index/manifest-build.test.ts src/index/canonical-indexing.test.ts`

Expected: `buildManifestIndex` is missing; sequential single-root calls cannot preserve the complete alias set or prune removed roots.

### Minimal implementation

```ts
export interface DiscoveredCorpus {
  readonly roots: readonly string[]
  readonly discovery: CanonicalizedDiscovery
  readonly deletedPaths: readonly string[]
  readonly skipped: { readonly hidden: number; readonly excluded: number }
  readonly complete: boolean
}

export const buildManifestIndex = (manifest: MdmManifest, options: IndexOptions) =>
  Effect.gen(function* () {
    const roots = manifest.directories.map((directory) => directory.path)
    const results = yield* Effect.all(manifest.directories.map((directory) =>
      createIgnoreFilter({ rootPath: directory.path, cliPatterns: options.exclude, honorGitignore: options.honorGitignore, honorMdmignore: options.honorMdmignore }).pipe(
        Effect.flatMap((filter) => discoverFiles(directory.path, filter, { recurse: directory.recurse, depth: directory.depth, followSymlinks: options.followSymlinks })),
      )), { concurrency: 8 })
    const files = [...new Set(results.flatMap((result) => result.files))]
    const discovery = yield* canonicalizeDiscoveredFiles(files)
    const result = yield* buildDiscoveredIndex({
      roots,
      discovery,
      deletedPaths: [],
      skipped: results.reduce((sum, item) => ({ hidden: sum.hidden + item.skipped.hidden, excluded: sum.excluded + item.skipped.excluded }), { hidden: 0, excluded: 0 }),
      complete: true,
    }, options)
    yield* buildBM25Index(options.indexRoot, { force: true })
    return result
  })
```

Move the state, parse, merge, and save phases from `buildIndex` into `buildDiscoveredIndex`. Before reconciliation, if `corpus.complete`, delete every stored document whose `fileIdentityKey(entry.identity)` is absent from `corpus.discovery.selections`. Pass `corpus.roots` to link resolution; allow resolved links only when the target inode is in the discovery map. Save structural state once. Make `buildBM25Index(indexRoot, options)` read `createStorage(indexRoot, indexRoot)` and rebuild one store. Remove `DocumentIndex.rootPath` from its type, schema, constructor, fixtures, and path matcher fallback. Callers that need a scope root must resolve the root they already receive.

### Run to pass

`npx --yes pnpm@10.28.0 exec vitest run src/index/manifest-build.test.ts src/index/indexer.test.ts src/index/canonical-indexing.test.ts src/index/storage.test.ts src/search/path-matcher.test.ts && npx --yes pnpm@10.28.0 typecheck`

### Commit

`git add src && git commit -m "feat: build consolidated manifest index"`

## Task 4: Delete compatibility paths and remove stale source indexes

### Files

- Delete `src/embeddings/embedding-namespace-migration.ts`.
- Modify `src/embeddings/embedding-namespace.ts`, `embedding-namespace-paths.ts`, `embedding-namespace.test.ts`, `vector-store-codec.ts`, `vector-store.ts`, and `vector-store.test.ts`.
- Modify `src/index/manifest-build.ts`, `src/index/manifest-build.test.ts`, and `src/architecture/db-foundation-boundaries.test.ts`.

### Interfaces

Keep `legacyIndexDir(sourceRoot)` only as the location to delete. Produce `removeStaleSourceIndex(sourceRoot, activeIndexRoot)`. Export no legacy vector reader, importer, or metadata migration API.

### Write the failing test

```ts
it('deletes a stale source index without deleting an active home inside the source', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-stale-'))
  const source = path.join(parent, 'source')
  const home = path.join(source, '.active-mdm')
  await fs.mkdir(path.join(source, '.mdm', 'indexes'), { recursive: true })
  await fs.mkdir(home, { recursive: true })
  await fs.writeFile(path.join(source, 'note.md'), '# note')
  await Effect.runPromise(removeStaleSourceIndex(source, home))
  await expect(fs.access(path.join(source, '.mdm'))).rejects.toThrow()
  await expect(fs.access(home)).resolves.toBeUndefined()
})

it('keeps the source index when it is the active home', async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-active-'))
  const activeHome = path.join(source, '.mdm')
  await fs.mkdir(path.join(activeHome, 'indexes'), { recursive: true })
  await Effect.runPromise(removeStaleSourceIndex(source, activeHome))
  await expect(fs.access(activeHome)).resolves.toBeUndefined()
})

it('contains no index compatibility implementation', () => {
  const production = productionSourceFiles(srcRoot).map((file) => fs.readFileSync(file, 'utf-8')).join('\n')
  expect(production).not.toMatch(/migrateLegacyEmbeddings|getLegacyVectorPath|getLegacyMetaPath|vectors\.meta\.json|\[\[sources\]\]/)
})
```

### Run to fail

`npx --yes pnpm@10.28.0 exec vitest run src/index/manifest-build.test.ts src/architecture/db-foundation-boundaries.test.ts src/embeddings/embedding-namespace.test.ts src/embeddings/vector-store.test.ts`

Expected: migration and legacy symbols remain; stale per-directory `.mdm` is untouched.

### Minimal implementation

```ts
export const removeStaleSourceIndex = (
  sourceRoot: string,
  activeIndexRoot: string,
): Effect.Effect<void, FileWriteError> => {
  const stale = legacyIndexDir(sourceRoot)
  const active = resolveCanonicalPathOrFallback(activeIndexRoot)
  if (resolveCanonicalPathOrFallback(stale) === active) return Effect.void
  return Effect.tryPromise({
    try: () => fs.rm(stale, { recursive: true, force: true }),
    catch: (cause) => new FileWriteError({ path: stale, message: 'Cannot remove stale source index', cause }),
  })
}
```

Call this once for each manifest root before discovery. Delete migration exports and legacy vector path helpers. Make vector metadata loading binary-only; remove provider patching, JSON fallback, `migrateJsonVectorIndex`, and migration tests. Keep current canonical schema validation.

### Run to pass

`npx --yes pnpm@10.28.0 exec vitest run src/index/manifest-build.test.ts src/architecture/db-foundation-boundaries.test.ts src/embeddings/embedding-namespace.test.ts src/embeddings/vector-store.test.ts && npx --yes pnpm@10.28.0 typecheck`

### Commit

`git add -A src && git commit -m "refactor: remove index compatibility paths"`

## Task 5: Make embedding reuse content-hash aware

### Files

- Modify `src/embeddings/types.ts`, `vector-store-types.ts`, `vector-store-codec.ts`, `vector-store.ts`, and their tests.
- Modify `src/embeddings/semantic-search-build.ts`, `semantic-search-cost.ts`, `semantic-search-build-path-filter.test.ts`, and `semantic-search-cost.test.ts`.

### Interfaces

Add `documentHash` to `VectorEntry` and `VectorStore.getEmbeddedDocumentHashes()`. Add optional explicit `indexRoot` to embedding build and cost options. Decompose `buildEmbeddings` below 150 lines before adding behavior.

### Write the failing test

```ts
it('re-embeds changed text when the section id stays stable', async () => {
  const fixture = await makeEmbeddingFixture('# Title\n\nfirst body')
  await Effect.runPromise(buildEmbeddings(fixture.source, { indexRoot: fixture.home, client: fixture.client, providerConfig: fixture.provider }))
  fixture.client.embed.mockClear()
  await fs.writeFile(fixture.file, '# Title\n\nsecond body')
  await Effect.runPromise(buildIndex(fixture.source, { indexRoot: fixture.home }))
  await Effect.runPromise(buildEmbeddings(fixture.source, { indexRoot: fixture.home, client: fixture.client, providerConfig: fixture.provider }))
  expect(fixture.client.embed).toHaveBeenCalledTimes(1)
  expect(fixture.client.embed.mock.calls.flat().join(' ')).toContain('second body')
})
```

### Run to fail

`npx --yes pnpm@10.28.0 exec vitest run src/embeddings/semantic-search-build-path-filter.test.ts src/embeddings/vector-store.test.ts`

Expected: the second build reports a cache hit because the section ID is unchanged.

### Minimal implementation

```ts
export interface VectorEntry {
  readonly id: string
  readonly sectionId: string
  readonly documentPath: DocumentKey
  readonly documentHash: string
  readonly heading: string
  readonly embedding: readonly number[]
}

getEmbeddedDocumentHashes(): ReadonlyMap<string, string> {
  return new Map([...this.entries.values()].map((entry) => [entry.id, entry.documentHash]))
}

const reusableSectionIds = (
  sections: SectionIndex,
  documents: DocumentIndex,
  embeddedHashes: ReadonlyMap<string, string>,
): Set<string> => new Set(Object.values(sections.sections).flatMap((section) => {
  const hash = documents.documents[section.documentPath]?.hash
  return hash !== undefined && embeddedHashes.get(section.id) === hash ? [section.id] : []
}))
```

Require `documentHash` in the MessagePack schema. After loading vectors, compute reusable IDs, remove every existing ID that is stale or has a mismatched hash, and pass only reusable IDs to `readSectionsToEmbed`. Set `documentHash` from `docIndex.documents[section.documentPath].hash` on every new entry. Extract provider setup, existing-vector reconciliation, batch embedding, and final save into named helpers so `buildEmbeddings` is at most 150 lines. Resolve storage from `options.indexRoot ?? dbIndexDir(resolveMdmHome())` in build and cost paths.

### Run to pass

`npx --yes pnpm@10.28.0 exec vitest run src/embeddings/semantic-search-build-path-filter.test.ts src/embeddings/semantic-search-cost.test.ts src/embeddings/vector-store.test.ts && npx --yes pnpm@10.28.0 typecheck`

### Commit

`git add src/embeddings && git commit -m "fix: key embedding reuse by content hash"`

## Task 6: Route CLI and MCP ingestion through the manifest

### Files

- Create `src/cli/commands/index-run.ts`, `index-output.ts`, `index-embeddings.ts`, and colocated tests where ownership requires them.
- Modify `src/cli/commands/index-cmd.ts`, `index-flags.test.ts`, `index-sentinel.test.ts`, `src/cli/cli.test.ts`, `src/cli/main.ts`, and `src/cli/help.ts`.
- Modify `src/mcp/handlers.ts`, `src/mcp/tools.ts`, `src/mcp/schemas.ts`, and `src/mcp/server.test.ts`.

### Interfaces

Keep `index-cmd.ts` as options plus dispatch. Produce `runIndexCommand(input)`, `renderIndexResult`, and `runEmbeddingRefresh`. The path argument becomes `Option.Option<string>`. Both CLI and MCP call `refreshManifestIndex(home, optionalPath, options)`.

### Write the failing test

```ts
it('appends a path then refreshes every manifest directory', async () => {
  const fixture = await makeCliManifestFixture()
  const first = await runCli(['index', fixture.first, '--no-embed'], fixture.env)
  expect(first.exitCode).toBe(0)
  await fs.writeFile(path.join(fixture.second, 'second.md'), '# second')
  await Effect.runPromise(appendManifestDirectory(fixture.home, { path: fixture.second }))
  const refreshed = await runCli(['index', '--no-embed'], fixture.env)
  expect(refreshed.exitCode).toBe(0)
  const documents = JSON.parse(await fs.readFile(path.join(fixture.home, 'indexes', 'documents.json'), 'utf-8'))
  expect(Object.keys(documents.documents)).toHaveLength(2)
})

it('fails no-arg index when the manifest is empty', async () => {
  const fixture = await makeCliManifestFixture({ empty: true })
  const result = await runCli(['index', '--no-embed'], fixture.env)
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain('mdm index <dir>')
})

it('rejects watch until manifest watching exists', async () => {
  const fixture = await makeCliManifestFixture()
  const result = await runCli(['index', '--watch'], fixture.env)
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain('manifest watching')
})
```

### Run to fail

`npx --yes pnpm@10.28.0 exec vitest run src/cli/commands/index-flags.test.ts src/cli/commands/index-sentinel.test.ts src/cli/cli.test.ts src/mcp/server.test.ts`

Expected: no argument resolves to `.`, the manifest is ignored, MCP bypasses it, and watch starts one-root behavior.

### Minimal implementation

```ts
export const refreshManifestIndex = (
  home: string,
  requestedPath: string | undefined,
  options: Omit<IndexOptions, 'indexRoot'>,
) => Effect.gen(function* () {
  if (requestedPath !== undefined) yield* appendManifestDirectory(home, { path: requestedPath })
  const manifest = yield* loadManifest(home)
  if (manifest.directories.length === 0) {
    return yield* Effect.fail(new ManifestError({
      path: manifestPath(home),
      message: 'Manifest has no directories. Run mdm index <dir> first.',
    }))
  }
  return yield* buildManifestIndex(manifest, { ...options, indexRoot: dbIndexDir(home) })
})
```

Define the command path as `Args.directory({ name: 'path' }).pipe(Args.withDescription('Directory to append before refreshing the manifest'), Args.optional)`. Use `Option.getOrUndefined` only at the dispatch boundary. Move existing rendering and embedding prompt behavior unchanged into the named modules. Pass the active database root to estimate and build functions, with no second exclude filter because discovery already excluded those documents. Route MCP `md_index` through `refreshManifestIndex`; omitted path refreshes, provided path is validated then appended. Update help to describe manifest refresh. Keep each new function below 150 lines and delete the old inlined branches.

### Run to pass

`npx --yes pnpm@10.28.0 exec vitest run src/manifest.test.ts src/index/manifest-build.test.ts src/cli/commands/index-flags.test.ts src/cli/commands/index-sentinel.test.ts src/cli/cli.test.ts src/mcp/server.test.ts && npx --yes pnpm@10.28.0 typecheck`

### Commit

`git add src && git commit -m "feat: ingest the active manifest"`

## Final verification for every task branch

```bash
npx --yes pnpm@10.28.0 test
npx --yes pnpm@10.28.0 typecheck
npx --yes pnpm@10.28.0 build
npx --yes pnpm@10.28.0 check
git diff --check
wc -l src/toml.ts src/manifest.ts src/index/manifest-build.ts src/index/file-discovery.ts src/index/ignore-patterns.ts src/index/index-build.ts src/cli/commands/index-cmd.ts src/cli/commands/index-run.ts src/cli/commands/index-output.ts src/cli/commands/index-embeddings.ts src/embeddings/semantic-search-build.ts
```

Observe zero command failures. Every listed file must be at most 700 lines. Confirm `indexCommand`, `buildEmbeddings`, `buildManifestIndex`, and each new CLI helper are near 150 lines or less. Confirm production contains no `[[sources]]`, legacy vector importer, JSON vector metadata fallback, or direct CLI or MCP call that bypasses `refreshManifestIndex`.
