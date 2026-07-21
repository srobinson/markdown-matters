# MDM DB Foundation Implementation Plan

Baseline: `4b07518bf626e06c25fb591646acaa8fffdf6ea4`

## Goal

Implement design Sections 5 and 7.1: one `MDM_HOME` resolver, one DB index directory, layered config merge, one canonical document key, one source resolver, and migration of every relative key consumer.

## Architecture

`src/home.ts` owns DB selection. `IndexStorage` separates corpus `sourceRoot` from `indexRoot`. Structural indexes, HNSW, BM25, active provider state, and caches use the DB root. `src/db/canonical.ts` owns absolute realpath keys, inode identity, case comparison, hardlink selection, boundary checks, and `resolveSourceFile`. One migration map rewrites structural JSON, vector MessagePack, and BM25 metadata.

## Tech Stack

ESM TypeScript, Effect, `@effect/cli`, Vitest, `smol-toml`, MessagePack, hnswlib, and the existing temp file plus rename writers.

## Global Constraints

- Scope excludes manifest, ingest orchestration, signature enforcement, vector import, generation swap, partition search, comprehension, and federation.
- Remove legacy `index --all`; Plan 2 will restore multi source ingest against one home.
- Refactor every touched file over 700 lines before adding behavior. Keep functions near 150 lines or less.
- Preserve public import paths with facades. Delete obsolete parallel implementations after migration.
- Reuse `loadTomlFileWithStatus`, `mergePartials`, config validation, `getIndexPaths`, storage writers, parser path IDs, vector codec, BM25 store, and HNSW cache.
- Land schema, migration, and every source read change together. Never flip `documentPath` alone.
- Locked link schema: `LinkIndex.forward` and `backward` use `DocumentKey`; `LinkIndex.broken` uses absolute, tilde expanded, lexically normalized `DeclaredPath`. A missing target never receives a fabricated canonical identity.
- No live provider calls in tests.

## File Structure

- `src/home.ts`, `src/home.test.ts`: home and DB path ownership.
- `src/db/canonical.ts`, `canonical.test.ts`: canonical identity and source resolution.
- `src/db/canonical-migration.ts`, `canonical-migration.test.ts`: persistence rewrite.
- `src/architecture/db-foundation-boundaries.test.ts`: size and forbidden join guards.
- `src/config/config-precedence.test.ts`: five tier merge coverage.
- `src/embeddings/embedding-namespace-{types,paths,catalog,migration}.ts` and `vector-store-{types,codec}.ts`: split 947 and 823 line owners.
- `src/index/{file-discovery,index-state,link-index,bm25-build,index-build}.ts` and `src/search/{regex,content-search,context}.ts`: split 855 and 845 line owners.
- `src/cli/commands/search-{refine,mode,output,summarization,embeddings}.ts`: split 1316 line owner.
- Existing config, index, embedding, search, duplicate, MCP, and CLI owners change only where listed in tasks.

## Self Review and Spec Coverage

- Section 5 home creation, lazy realpath, DB root, no doubling, and future generation seam: Task 2.
- Section 5 global consumers, five config tiers, DB plus config switching, and removal of project indexes: Task 3.
- Section 7.1 key form, inode and case identity, aliases, boundary checks, and shared resolver: Task 4.
- Section 7.1 persisted key schema and relative key migration across every store: Task 5.
- Section 7.1 hardlink selection, membership aliases, link forms, and declared target drift: Task 6.
- Section 7.1 every source read, path scope, CLI output, and MCP references: Task 7.

## Task 1: Mechanically decompose every oversized touched owner

### Files

Create every split module listed above plus `src/architecture/db-foundation-boundaries.test.ts`. Convert `embedding-namespace.ts`, `indexer.ts`, and `searcher.ts` to facades. Keep `vector-store.ts` as the HNSW class and `search.ts` as option declaration plus dispatch.

### Interfaces

Consumes current exports unchanged. Produces stable facades, internal vector metadata codec functions, short index phases, and short search mode functions.

### Write the failing test

```ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lines = (file: string) =>
  fs.readFileSync(path.join(root, file), 'utf-8').split('\n').length

const sizedFiles = [
  'embeddings/embedding-namespace.ts', 'embeddings/vector-store.ts', 'index/indexer.ts',
  'search/searcher.ts', 'cli/commands/search.ts',
  ...['types', 'paths', 'catalog', 'migration'].map((name) => `embeddings/embedding-namespace-${name}.ts`),
  ...['types', 'codec'].map((name) => `embeddings/vector-store-${name}.ts`),
  ...['file-discovery', 'index-state', 'link-index', 'bm25-build', 'index-build'].map((name) => `index/${name}.ts`),
  ...['regex', 'content-search', 'context'].map((name) => `search/${name}.ts`),
  ...['refine', 'mode', 'output', 'summarization', 'embeddings'].map((name) => `cli/commands/search-${name}.ts`),
]
it.each(sizedFiles)('%s is at most 700 lines', (file) => expect(lines(file)).toBeLessThanOrEqual(700))
```

### Run to fail

`pnpm exec vitest run src/architecture/db-foundation-boundaries.test.ts`

Expected: five oversized failures report 947, 823, 855, 845, and 1316 lines; split paths fail until created.

### Minimal implementation

Move symbols without changing behavior:

- Namespace types and error to `embedding-namespace-types.ts`; name and path helpers to `embedding-namespace-paths.ts`; active provider, list, switch, remove, and active lookup to `embedding-namespace-catalog.ts`; legacy detection and migration to `embedding-namespace-migration.ts`.
- Vector public interfaces to `vector-store-types.ts`; runtime schemas and binary or JSON decode and encode to `vector-store-codec.ts`.
- Walk and changed path classification to `file-discovery.ts`; mutable copy, delete, apply, save to `index-state.ts`; link resolution and queries to `link-index.ts`; BM25 build to `bm25-build.ts`; short orchestration to `index-build.ts`.
- Regex safety to `search/regex.ts`; content query phases to `content-search.ts`; context to `context.ts`; CLI refine, mode, rendering, summary, and embedding setup to their named files.

Use explicit facades:

```ts
export { buildIndex } from './index-build.js'
export { buildBM25Index } from './bm25-build.js'
export { getBrokenLinks, getIncomingLinks, getOutgoingLinks } from './link-index.js'
```

```ts
export const searchCommand = Command.make('search', searchOptions, runSearchCommand)
```

### Run to pass

`pnpm exec vitest run src/architecture/db-foundation-boundaries.test.ts src/embeddings/embedding-namespace.test.ts src/embeddings/vector-store.test.ts src/index/indexer.test.ts src/search/searcher.test.ts src/cli/cli.test.ts && pnpm typecheck`

Expected: tests and typecheck pass; every moved file is at most 700 lines; moved functions are near 150 lines or less.

### Commit

`git add src && git commit -m "refactor: split db foundation ownership"`

## Task 2: Add MDM home and explicit DB index paths

### Files

Create `src/home.ts`, `src/home.test.ts`. Modify `src/index/{types,storage}.ts`, `src/index/storage.test.ts`, `src/embeddings/{embedding-namespace-paths,vector-store,hnsw-cache,semantic-search-cost,semantic-search-stats}.ts`, `src/embeddings/{embedding-namespace,vector-store}.test.ts`, `src/search/{bm25-store,cross-encoder}.ts`, `src/search/cross-encoder.test.ts`, and `src/cli/commands/{embeddings,search-embeddings,stats}.ts`.

### Interfaces

Produces `resolveMdmHome(options?: { create?: boolean; env?: NodeJS.ProcessEnv }): string`, `dbIndexDir(home: string): string`, `legacyIndexDir(sourceRoot: string): string`, `getIndexPaths(indexRoot: string)`, and `createStorage(sourceRoot: string, indexRoot: string): IndexStorage`.

### Write the failing test

```ts
it('tolerates a fresh home, then canonicalizes it without doubling', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-home-'))
  cleanup.push(parent)
  const home = path.join(parent, 'missing')
  vi.stubEnv('MDM_HOME', home)
  expect(resolveMdmHome()).toBe(path.resolve(home))
  expect(fs.existsSync(home)).toBe(false)
  const created = resolveMdmHome({ create: true })
  expect(created).toBe(fs.realpathSync(home))
  expect(dbIndexDir(created)).toBe(created)
  expect(getIndexPaths(created).documents).toBe(path.join(created, 'indexes', 'documents.json'))
})
```

### Run to fail

`pnpm exec vitest run src/home.test.ts src/index/storage.test.ts src/embeddings/embedding-namespace.test.ts`

Expected: missing module and current `.mdm` doubling failures.

### Minimal implementation

```ts
export const resolveMdmHome = (
  options: { create?: boolean; env?: NodeJS.ProcessEnv } = {},
): string => {
  const value = options.env?.MDM_HOME ?? process.env.MDM_HOME ?? path.join(os.homedir(), '.mdm')
  const candidate = path.resolve(value.replace(/^~(?=$|[\\/])/, os.homedir()))
  if (options.create) fs.mkdirSync(candidate, { recursive: true })
  try { return fs.realpathSync(candidate) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate
    throw error
  }
}
export const dbIndexDir = (home: string): string => path.resolve(home)
export const legacyIndexDir = (root: string): string => path.join(path.resolve(root), '.mdm')
```

```ts
export const getIndexPaths = (indexRoot: string) => {
  const root = path.resolve(indexRoot)
  return {
    root, documents: path.join(root, 'indexes', 'documents.json'),
    sections: path.join(root, 'indexes', 'sections.json'), links: path.join(root, 'indexes', 'links.json'),
    cache: path.join(root, 'cache'), parsed: path.join(root, 'cache', 'parsed'),
    bm25: path.join(root, 'bm25.json'),
    bm25Metadata: path.join(root, 'bm25.meta.json'),
  }
}
```

Replace the conflated storage boundary and remove structural `config.json`:

```ts
export interface IndexStorage {
  readonly sourceRoot: string
  readonly indexRoot: string
  readonly paths: ReturnType<typeof getIndexPaths>
}
export const createStorage = (sourceRoot: string, indexRoot: string): IndexStorage => ({
  sourceRoot: path.resolve(sourceRoot),
  indexRoot: path.resolve(indexRoot),
  paths: getIndexPaths(indexRoot),
})
```

Delete `INDEX_DIR`, `IndexConfig`, `paths.config`, `loadConfig`, and `saveConfig`. `initializeIndex` creates only index directories. Route active namespaces, vectors, BM25, reranker models, and HNSW cache keys through `storage.indexRoot`. Only `getLegacyVectorPath`, `getLegacyMetaPath`, and `getLegacyMetaJsonPath` call `legacyIndexDir(sourceRoot)`.

### Run to pass

`pnpm exec vitest run src/home.test.ts src/index/storage.test.ts src/embeddings/embedding-namespace.test.ts src/embeddings/vector-store.test.ts src/search/cross-encoder.test.ts && pnpm typecheck`

Expected: no double directory; missing home is tolerated; created home realpaths; storage keeps separate roots; no `config.json` is created; legacy flat paths remain `<source>/.mdm`.

### Commit

`git add src && git commit -m "feat: centralize mdm home and db paths"`

## Task 3: Merge config tiers and wire every CLI home consumer

### Files

Create `src/config/config-precedence.test.ts`. Modify `src/config/{loader,index,schema,validation}.ts`, `src/config/{loader,service,validation}.test.ts`, `src/cli/{config-layer,help,flag-schemas,utils,cli.test}.ts`, `src/cli/commands/{init-toml,config-cmd,init-cmd,index-cmd}.ts`, `src/cli/commands/{config-cmd,init-cmd,index-sentinel,index-flags}.test.ts`, and build callers `src/index/{indexer.test,watcher}.ts`, `src/integration/search-keyword.test.ts`, `src/mcp/{handlers,server.test}.ts`, and `src/search/searcher.test.ts`.

### Interfaces

Consumes `resolveMdmHome`, `loadTomlFileWithStatus`, and exported `mergePartials`. `loadDetailed` returns `sourceFiles: readonly string[]`; `IndexOptions` requires `indexRoot: string`. Precedence is CLI, env, project `.mdm.local.toml`, project `.mdm.toml`, home `.mdm.toml`, defaults.

### Write the failing test

```ts
it('merges all tiers by key', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-config-home-'))
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-config-project-'))
  const write = (dir: string, file: string, content: string): void =>
    fs.writeFileSync(path.join(dir, file), content)
  write(home, '.mdm.toml', '[search]\ndefaultLimit=11\nmaxLimit=55\n')
  write(project, '.mdm.toml', '[search]\ndefaultLimit=22\n[output]\nprettyJson=false\n')
  write(project, '.mdm.local.toml', '[search]\ndefaultLimit=33\n')
  vi.stubEnv('MDM_HOME', home)
  vi.stubEnv('MDM_SEARCH_DEFAULTLIMIT', '44')
  const result = loadDetailed({
    workingDir: project,
    cliOverrides: { search: { defaultLimit: 45 } },
  })
  expect(result.config.search).toMatchObject({ defaultLimit: 45, maxLimit: 55 })
  expect(result.config.output.prettyJson).toBe(false)
  expect(result.sourceFiles).toEqual([
    path.join(home, '.mdm.toml'),
    path.join(project, '.mdm.toml'),
    path.join(project, '.mdm.local.toml'),
  ])
})
```

### Run to fail

`pnpm exec vitest run src/config/config-precedence.test.ts`

Expected: local or global short circuit drops lower tier keys and ignores local config.

### Minimal implementation

```ts
const paths = [
  path.join(resolveMdmHome(), '.mdm.toml'),
  path.join(cwd, '.mdm.toml'),
  path.join(cwd, '.mdm.local.toml'),
]
let config: PartialMdmConfig = {}
const sourceFiles: string[] = []
for (const filePath of paths) {
  const loaded = loadTomlFileWithStatus(filePath)
  if (loaded.status === 'loaded') {
    config = mergePartials(config, loaded.config)
    sourceFiles.push(filePath)
  }
  if (loaded.status === 'error') parseErrors.push(loaded.error)
}
```

Return `sourceFiles`; retain warning and skip behavior for each malformed tier; apply `readEnvVars`, then CLI through `mergePartials`.

Apply the obsolete path cleanup in this order:

1. Make `buildIndex(sourceRoot, { indexRoot, ...options })` and every global CLI command pass `dbIndexDir(resolveMdmHome({ create: true }))`.
2. Make local init write only `<project>/.mdm.toml`; delete `addToGitignore`, local `.mdm` creation, the index sentinel, and related prompts and help.
3. Delete `findIndexRoot`; make `getIndexInfo` inspect `getIndexPaths(dbIndexDir(resolveMdmHome())).sections` directly.
4. Delete `index.indexDir` and `paths.cacheDir` from types, defaults, env mapping, validation, TOML generation, and config display.
5. Remove the `--all` flag and loop until Plan 2 owns multi source ingest.

### Run to pass

`pnpm exec vitest run src/config/config-precedence.test.ts src/config/loader.test.ts src/config/service.test.ts src/config/validation.test.ts src/cli/commands/config-cmd.test.ts src/cli/commands/init-cmd.test.ts src/cli/commands/index-sentinel.test.ts && pnpm typecheck`

Expected: precedence passes; two homes isolate config; indexing writes the selected home without creating source `.mdm` or editing `.gitignore`; `findIndexRoot`, `index.indexDir`, `paths.cacheDir`, `config.json`, and `--all` are absent.

### Commit

`git add src && git commit -m "feat: merge config and wire mdm home"`

## Task 4: Define canonical document identity and boundary policy

### Files

Create `src/db/canonical.ts`, `src/db/canonical.test.ts`. Modify `src/mcp/adapter.ts` to reuse the neutral predicate.

### Interfaces

Produces `expandDeclaredPath(value: string): DeclaredPath`, `canonicalizeSourceFile(value: string): Effect.Effect<CanonicalSource, FileReadError>`, `selectCanonicalSource(group: readonly CanonicalSource[]): CanonicalSourceSelection`, `isPathWithin(candidate: string, parent: string, caseSensitive: boolean): boolean`, `sourceBelongsToPrefix(source, prefix)`, and `resolveSourceFile(key: DocumentKey): string`.

### Write the failing test

```ts
it('realpaths, tracks retargets, and collapses hardlinks deterministically', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-canonical-'))
  const z = path.join(dir, 'z.md')
  const a = path.join(dir, 'a.md')
  await fs.writeFile(z, '# Shared\n')
  await fs.link(z, a)
  const sources = await Effect.runPromise(Effect.all([canonicalizeSourceFile(z), canonicalizeSourceFile(a)]))
  const selected = selectCanonicalSource(sources)
  expect(selected.key).toBe(await fs.realpath(a))
  expect(selected.paths).toEqual([await fs.realpath(a), await fs.realpath(z)])
  expect(selected.declaredPaths).toEqual([a, z])
  expect(selected.identity.device).toMatch(/^\d+$/)
  expect(isPathWithin('/work-notes/a.md', '/work', true)).toBe(false)
  expect(sourceBelongsToPrefix(selected, dir)).toBe(true)
  expect(expandDeclaredPath(`${dir}/missing/../target.md`)).toBe(path.join(dir, 'target.md'))
  const declared = path.join(dir, 'declared.md'); const target = path.join(dir, 'target.md')
  await fs.symlink(z, declared)
  const before = await Effect.runPromise(canonicalizeSourceFile(declared))
  await fs.writeFile(target, '# Target\n')
  await fs.unlink(declared)
  await fs.symlink(target, declared)
  const after = await Effect.runPromise(canonicalizeSourceFile(declared))
  expect(before.declaredPath).toBe(after.declaredPath)
  expect(before.key).not.toBe(after.key)
})
```

### Run to fail

`pnpm exec vitest run src/db/canonical.test.ts`

Expected: canonical module is missing.

### Minimal implementation

```ts
declare const keyBrand: unique symbol; declare const declaredBrand: unique symbol
export type DocumentKey = string & { readonly [keyBrand]: 'DocumentKey' }
export type DeclaredPath = string & { readonly [declaredBrand]: 'DeclaredPath' }
export interface FileIdentity { readonly device: string; readonly inode: string }
export interface CanonicalSource {
  readonly key: DocumentKey; readonly declaredPath: DeclaredPath
  readonly comparisonKey: string; readonly identity: FileIdentity; readonly caseSensitive: boolean
}
export interface CanonicalSourceSelection extends Omit<CanonicalSource, 'declaredPath'> {
  readonly paths: readonly DocumentKey[]; readonly declaredPaths: readonly DeclaredPath[]
}
export const expandDeclaredPath = (value: string): DeclaredPath => {
  const expanded = value.replace(/^~(?=$|[\\/])/, os.homedir())
  return path.resolve(path.normalize(expanded)) as DeclaredPath
}
```

```ts
export const canonicalizeSourceFile = (value: string) => Effect.tryPromise({
  try: async () => {
    const declaredPath = expandDeclaredPath(value)
    const key = await fs.realpath(declaredPath) as DocumentKey
    const stat = await fs.stat(key, { bigint: true })
    const caseSensitive = await detectCaseSensitivity(key, stat.dev, stat.ino)
    return { key, declaredPath, comparisonKey: caseSensitive ? key : key.toLowerCase(),
      identity: { device: String(stat.dev), inode: String(stat.ino) }, caseSensitive }
  },
  catch: (cause) => new FileReadError({ path: value, message: `Cannot canonicalize ${value}`, cause }),
})
```

Detect case sensitivity by statting one ASCII case variant and comparing device and inode. Group by `device:inode`; sort each group by `comparisonKey`, then `key`; persist the first key plus every sorted canonical and declared alias. Implement boundary and source resolution directly:

```ts
export const isPathWithin = (candidate: string, parent: string, caseSensitive: boolean): boolean => {
  const fold = (value: string) => caseSensitive ? path.resolve(value) : path.resolve(value).toLowerCase()
  const relative = path.relative(fold(parent), fold(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
export const sourceBelongsToPrefix = (source: CanonicalSourceSelection, prefix: string): boolean =>
  source.paths.some((key) => isPathWithin(key, prefix, source.caseSensitive))
export const resolveSourceFile = (key: DocumentKey): string => {
  if (!path.isAbsolute(key)) throw new TypeError(`DocumentKey must be absolute: ${key}`)
  return path.normalize(key)
}
```

Extract MCP containment to `isPathWithin`; keep MCP error and result formatting in the adapter.

### Run to pass

`pnpm exec vitest run src/db/canonical.test.ts src/mcp/server.test.ts src/mcp/server-bootstrap.test.ts && pnpm typecheck`

Expected: symlink, hardlink, case comparison, sibling prefix, and MCP traversal tests pass.

### Commit

`git add src/db src/mcp/adapter.ts && git commit -m "feat: define canonical document identity"`

## Task 5: Version and migrate every persisted key surface

### Files

Create `src/db/canonical-migration.ts`, `src/db/canonical-migration.test.ts`. Modify `src/index/{types,storage,index-state}.ts`, `src/embeddings/{vector-store-types,vector-store-codec}.ts`, and `src/search/bm25-store.ts`.

### Interfaces

Consumes version 1 relative keys plus `sourceRoot`. Produces version 2 documents, sections, links, vectors, and BM25 data from one `Map<string, CanonicalSource>`. The version 2 schema uses `DocumentKey` for documents, section `documentPath`, resolved links, vectors, and BM25; only broken links use `DeclaredPath`.

### Write the failing test

```ts
const makeLegacyPersistenceFixture = ({ sourceRoot, document, section }: {
  sourceRoot: string; document: LegacyDocumentEntry; section: LegacySectionEntry
}) => ({
  documents: {
    version: 1,
    rootPath: sourceRoot,
    documents: { [document.path]: document },
  },
  sections: {
    version: 1,
    sections: { [section.id]: section },
    byHeading: { guide: [section.id] },
    byDocument: { [document.id]: [section.id] },
  },
  links: {
    version: 1,
    forward: { [document.path]: [] },
    backward: {},
    broken: ['docs/missing.md'],
  },
  vectorIndex: {
    version: 1, provider: 'openai', dimensions: 3,
    entries: {
      '0': {
        id: 'v1', sectionId: section.id, documentPath: document.path,
        heading: section.heading, embedding: [0, 0, 0],
      },
    },
    totalCost: 0, totalTokens: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  bm25SectionMap: [[0, {
    sectionId: section.id,
    documentPath: document.path,
    heading: section.heading,
  }]] as const,
})

it('rewrites all persistence surfaces from one map', async () => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-source-'))
  const indexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-index-'))
  const sourceFile = path.join(sourceRoot, 'docs', 'guide.md')
  await fs.mkdir(path.dirname(sourceFile), { recursive: true })
  await fs.writeFile(sourceFile, '# Guide\n')
  const legacy = makeLegacyPersistenceFixture({
    sourceRoot,
    document: {
      id: 'd1', path: 'docs/guide.md', title: 'Guide', mtime: 1,
      hash: 'hash', tokenCount: 2, sectionCount: 1,
    },
    section: {
      id: 's1', documentId: 'd1', documentPath: 'docs/guide.md',
      heading: 'Guide', level: 1, startLine: 1, endLine: 1,
      tokenCount: 2, hasCode: false, hasList: false, hasTable: false,
    },
  })
  const migrated = await Effect.runPromise(
    migrateCanonicalDocumentKeys({ sourceRoot, indexRoot, legacy }),
  )
  const key = (await Effect.runPromise(canonicalizeSourceFile(sourceFile))).key
  expect(Object.keys(migrated.documents.documents)).toEqual([key])
  expect(migrated.sections.sections.s1?.documentPath).toBe(key)
  expect(migrated.links.forward[key]).toEqual([])
  expect(migrated.links.broken).toEqual([path.join(sourceRoot, 'docs/missing.md')])
  expect(migrated.vectorIndex.entries['0']?.documentPath).toBe(key)
  expect(migrated.bm25SectionMap[0]?.[1].documentPath).toBe(key)
})
```

### Run to fail

`pnpm exec vitest run src/db/canonical-migration.test.ts`

Expected: migration is missing and version 1 schemas lack identity fields.

### Minimal implementation

Set `INDEX_VERSION = 2`. Decode explicit version 1 schemas inferred as `LegacyDocumentEntry` and `LegacySectionEntry`, plus version 2 schemas. Version 2 `DocumentEntry` adds `path: DocumentKey`, `paths: readonly DocumentKey[]`, `declaredPaths: readonly DeclaredPath[]`, `identity`, and `comparisonKey`. Define the link contract explicitly:

```ts
export interface LinkIndex {
  readonly version: 2
  readonly forward: Record<DocumentKey, readonly DocumentKey[]>
  readonly backward: Record<DocumentKey, readonly DocumentKey[]>
  readonly broken: readonly DeclaredPath[]
}
```

```ts
const pairs = yield* Effect.all(
  Object.keys(legacy.documents.documents).map((oldKey) =>
    canonicalizeSourceFile(path.resolve(sourceRoot, oldKey)).pipe(
      Effect.map((source) => [oldKey, source] as const),
    ),
  ),
  { concurrency: 50 },
)
const keys = new Map(pairs)
const broken = legacy.links.broken.map((oldPath) =>
  expandDeclaredPath(path.resolve(sourceRoot, oldPath)),
)
```

Build all transformed objects, including `broken`, before any write. Preserve document and section IDs. Reuse the extracted vector codec; add `BM25Store.rewriteDocumentKeys`; call `saveDocumentIndex`, `saveSectionIndex`, `saveLinkIndex`, `VectorStore.save`, and `BM25Store.save`. A canonicalization failure writes nothing. Cross file generation atomicity remains Plan 4.

### Run to pass

`pnpm exec vitest run src/db/canonical-migration.test.ts src/index/storage.test.ts src/embeddings/vector-store.test.ts src/search/__tests__/hybrid-search.test.ts && pnpm typecheck`

Expected: v1 migrates; v2 round trips; resolved surfaces share `DocumentKey`; broken targets are normalized `DeclaredPath`; fail closed coverage passes.

### Commit

`git add src && git commit -m "feat: migrate persisted document keys"`

## Task 6: Canonicalize discovery before parse and store one identity

### Files

Modify `src/index/{file-discovery,index-build,index-state,link-index,watcher}.ts` and `src/index/{indexer,storage,watcher}.test.ts`.

### Interfaces

Consumes discovered `DeclaredPath` values. Produces one `CanonicalSourceSelection` per inode and passes `selection.key` into existing `parse`. `DocumentEntry` stores `path`, `paths`, `declaredPaths`, `identity`, and `comparisonKey`.

### Write the failing test

```ts
it('indexes hardlinks once with the least path everywhere', async () => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-source-'))
  const indexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-index-'))
  await fs.writeFile(path.join(sourceRoot, 'z.md'), '# Shared\n[Self](./a.md)\n[Missing](./missing.md)\n')
  await fs.link(path.join(sourceRoot, 'z.md'), path.join(sourceRoot, 'a.md'))
  await runBuildIndex(sourceRoot, { indexRoot })
  const docs = await Effect.runPromise(loadDocumentIndex(createStorage(sourceRoot, indexRoot)))
  const sections = await Effect.runPromise(loadSectionIndex(createStorage(sourceRoot, indexRoot)))
  const links = await Effect.runPromise(loadLinkIndex(createStorage(sourceRoot, indexRoot)))
  const key = (await Effect.runPromise(canonicalizeSourceFile(path.join(sourceRoot, 'a.md')))).key
  expect(Object.keys(docs!.documents)).toEqual([key])
  expect(docs!.documents[key]?.paths).toHaveLength(2)
  expect(new Set(Object.values(sections!.sections).map((s) => s.documentPath))).toEqual(new Set([key]))
  expect(links!.forward[key]).toEqual([key])
  expect(links!.broken).toEqual([path.join(sourceRoot, 'missing.md')])
})
```

### Run to fail

`pnpm exec vitest run src/index/indexer.test.ts -t hardlink`

Expected: two relative document entries are stored.

### Minimal implementation

At build start, detect version 1 persistence and run `migrateCanonicalDocumentKeys` before loading live state. Canonicalize discovery with concurrency 50, group by `device:inode`, and call `selectCanonicalSource` before read or parse. Carry `CanonicalSourceSelection` through merge. Use `selection.key` for document map keys, parser path, section `documentPath`, and resolved links. Store all canonical and declared aliases. On watcher unlink, locate the entry through `declaredPaths`, because realpath is unavailable. On a missing declared alias, append `FileProcessingError { path, message: 'not found (moved/deleted?); relink required' }` and continue. On each build, compare every declared alias with its newly canonicalized target; remove the old key and index the new key when a symlink retargets. Replace string prefix checks with `isPathWithin`.

Resolved internal links call `canonicalizeSourceFile` and store `DocumentKey`. Missing targets call only `expandDeclaredPath` and store `DeclaredPath`. Link queries canonicalize existing input before lookup.

### Run to pass

`pnpm exec vitest run src/index/indexer.test.ts src/index/storage.test.ts src/index/watcher.test.ts src/db/canonical.test.ts src/db/canonical-migration.test.ts && pnpm typecheck`

Expected: hardlinks deduplicate; aliases persist; symlink retarget replaces the old key; resolved links use `DocumentKey`; broken links use `DeclaredPath`; watcher deletion uses declared aliases.

### Commit

`git add src/index src/db && git commit -m "feat: index canonical document keys"`

## Task 7: Replace every direct source path join

### Files

Modify `src/index/bm25-build.ts`, `src/search/{content-search,searcher,path-matcher,hybrid-search}.ts`, `src/duplicates/detector.ts`, `src/embeddings/{semantic-search-build,semantic-search,semantic-search-pipeline}.ts`, `src/cli/commands/{search-refine,backlinks,duplicates,links,stats}.ts`, `src/mcp/{handlers,server}.ts`, and the tests named in Run to pass plus `src/architecture/db-foundation-boundaries.test.ts`.

### Interfaces

Consumes stored `DocumentKey`. `search(indexRoot: string, options: SearchOptions)`, content, semantic, duplicate, CLI, and MCP entrypoints use the DB root; `SearchOptions.pathPrefix?: DeclaredPath` scopes canonical keys with `isPathWithin`.

### Write the failing test

```ts
const readers = [
  'index/bm25-build.ts', 'search/content-search.ts',
  'duplicates/detector.ts', 'embeddings/semantic-search-build.ts',
  'embeddings/semantic-search.ts', 'embeddings/semantic-search-pipeline.ts',
  'cli/commands/search-refine.ts',
]
it.each(readers)('%s uses resolveSourceFile', (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf-8')
  expect(source).toContain('resolveSourceFile')
  expect(source).not.toMatch(/path\.join\([\s\S]{0,120}(documentPath|docPath|r\.documentPath)/)
})
```

### Run to fail

`pnpm exec vitest run src/architecture/db-foundation-boundaries.test.ts src/search/searcher.test.ts`

Expected: direct join assertions fail and DB separated content reads fail.

### Minimal implementation

```ts
const filePath = resolveSourceFile(documentPath)
const content = yield* Effect.tryPromise({
  try: () => fs.readFile(filePath, 'utf-8'),
  catch: (cause) => new FileReadError({ path: filePath, message: `Failed to read ${filePath}`, cause }),
})
```

Apply this to `buildBM25Index`, `searchContent`, `searchWithContent`, duplicate file cache, `collectSectionsToEmbed`, `semanticSearchWithContent`, `attachContextToResults`, and `filterResultsByRefineTerms`. Remove source root parameters from key only caches. BM25 and HNSW take `indexRoot`. CLI and MCP call `resolveMdmHome` once, canonicalize a requested `pathPrefix` once before scoping with `isPathWithin`, and return canonical keys. Keep `matchPath` only for user glob patterns.

### Run to pass

`pnpm exec vitest run src/architecture/db-foundation-boundaries.test.ts src/index/indexer.test.ts src/search/searcher.test.ts src/duplicates/detector.test.ts src/embeddings/semantic-search-threshold.test.ts src/search/__tests__/hybrid-search.test.ts src/cli/cli.test.ts && pnpm typecheck`

Then run `rg -Un 'path\.join\([\s\S]{0,120}(documentPath|docPath|r\.documentPath)' src`.

Expected: tests and typecheck pass; `rg` exits 1.

### Commit

`git add src && git commit -m "refactor: resolve source files by canonical key"`

## Task 8: Run acceptance and package gates

### Files

Modify `src/home.test.ts` and `src/architecture/db-foundation-boundaries.test.ts`. Add no production behavior.

### Interfaces

Proves two home isolation, precedence, no double directory, canonical persistence, hardlinks, source reads, sizing, and packaging.

### Write the failing test

```ts
it('keeps two homes isolated', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-homes-'))
  const firstPath = path.join(parent, 'first')
  const secondPath = path.join(parent, 'second')
  const first = resolveMdmHome({ create: true, env: { MDM_HOME: firstPath } })
  const second = resolveMdmHome({ create: true, env: { MDM_HOME: secondPath } })
  expect(getIndexPaths(first).documents).not.toBe(getIndexPaths(second).documents)
  expect(path.join(first, '.mdm.toml')).not.toBe(path.join(second, '.mdm.toml'))
})
```

### Run to fail

`pnpm exec vitest run src/home.test.ts -t 'keeps two homes isolated'`. Expected after Tasks 1 through 7: exit 0 without production changes; any failure returns to the owning task.

### Minimal implementation

No production implementation. Add the shown home isolation assertion and retain the architecture assertions from Tasks 1, 3, and 7.

### Run to pass

```bash
pnpm exec vitest run src/home.test.ts src/config/config-precedence.test.ts src/db/canonical.test.ts src/db/canonical-migration.test.ts src/architecture/db-foundation-boundaries.test.ts src/index/indexer.test.ts src/index/storage.test.ts src/index/watcher.test.ts src/search/searcher.test.ts src/duplicates/detector.test.ts src/embeddings/embedding-namespace.test.ts src/embeddings/vector-store.test.ts src/search/__tests__/hybrid-search.test.ts src/cli/commands/index-sentinel.test.ts
pnpm test
pnpm typecheck
pnpm build
pnpm check
pnpm quality
```

Verify every split file with `wc -l`; each must be at most 700. Run:

```bash
rg -n 'os\.homedir\(\).*\.mdm' src --glob '!home.ts'
rg -n 'INDEX_DIR|findIndexRoot|addToGitignore|index\.indexDir|paths\.cacheDir|storage\.paths\.config' src
rg -Un 'path\.join\([\s\S]{0,120}(documentPath|docPath|r\.documentPath)' src
git diff --check
git status --short
```

Expected: all package commands exit 0; all three `rg` commands exit 1; only intended Plan 1 changes exist.

### Commit

`git add src docs/superpowers/plans/2026-07-19-mdm-db-foundation.md && git commit -m "test: prove mdm db foundation"`

Self review gaps closed: locked broken link schema and tests; explicit five file refactor gate; ordered storage split and obsolete path removal; exact size and direct join gates.

Do not begin manifest or ingest work in this plan.
