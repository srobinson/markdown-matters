# Federated Markdown Knowledge Layer — Design

Status: draft for review
Date: 2026-06-22
Repo: `markdown-matters`
Owner: Stuart (what/why) · Claude (how)

## 1. Problem and value

A fresh machine. No `~/.mdx`, no convention, no agreed structure. Hundreds or
thousands of markdown files spread across a hundred project directories, each
following its own (or no) pattern. Today mdm can only index and search one
directory tree at a time, which forced consolidation (moving everything into
`~/.mdx`) — bending the user's life around the tool. That is why the tool was
abandoned.

The value of mdm is **making sense of markdown that already lives scattered
across your machine, without moving it.** You point mdm at the directories you
care about, it ingests exactly those, and from any project you get search and
comprehension scoped to the slice that matters to that project.

This document specifies the robust end-state, not a minimal slice. Delivery is
sequenced (Section 12) so each step is independently verifiable, but the design
target is the whole system with the hard problems solved, not deferred.

## 2. The model

> **Slurp full-path directories → a catalog of paths (your machine view) → a
> project declares which paths it cares about → search and comprehension are
> auto-scoped to that declaration, with every result keyed by its real path.**

- **Slurp, don't discover.** You tell mdm which directories to ingest; it
  ingests exactly those. No filesystem crawl, no heuristics guessing which
  files are "real." Deliberate and explicit.
- **A registry is a full path.** No names, no aliases. The absolute, canonical
  path *is* the identity, because the path already carries meaning (whose,
  what, where).
- **The catalog is self-assembling.** Slurping a directory registers its path
  in a machine-level catalog. The catalog is the set of paths you have slurped:
  "the markdown I care about."
- **A project declares its scope.** In a project's config you list the registry
  paths that project cares about. Search and comprehension from that project
  run over exactly that set plus the project's own files. The config is the
  scope; there is no per-query `--in` flag.
- **Reuse is free.** Slurp a directory once; every project that declares it
  shares the one index. Re-slurp only when files change.

## 3. Vocabulary (precise, to avoid the ambiguity that started this)

The current half-step uses `[[sources]]` to mean "build targets," which is a
different concept and a source of confusion. This design retires that overload.

| Term | Meaning |
| --- | --- |
| **Registry** | A directory that has been slurped, identified by its canonical full path. Holds an mdm index under `<path>/.mdm/`. |
| **Catalog** | The machine-level set of all registries, stored at `~/.mdm/catalog.toml`. The "global view." |
| **Slurp** | The act of ingesting a directory: build/refresh its index and record it in the catalog. Exposed as `mdm index <dir>`. |
| **Project scope** | The subset of registry paths a project declares it cares about, in the project's `.mdm.toml`. |
| **Federated search** | A query executed across the resolved scope (project-local index plus declared registries), merged into one ranked, path-keyed result list. |
| **Signature** | An embedding namespace `{provider}_{model}_{dimensions}`. Two registries are embedding-compatible iff signatures match. |

## 4. Architecture (grounded in current code)

The design is an orchestration layer **above** the existing single-root engine,
not a rewrite. What already exists and is reused unchanged:

- **Per-root index layout.** `INDEX_DIR='.mdm'`; `getIndexPaths()` lays out
  `.mdm/indexes/{documents,sections,links}.json`, `.mdm/cache/`, and
  per-namespace embeddings (`src/index/types.ts`). A built index is
  self-contained under its root and can be read from any absolute path.
- **Embedding namespace + active provider.** `generateNamespace(provider,
  model, dimensions)` and `<root>/.mdm/active-provider.json` /
  `getActiveNamespace(root)` (`src/embeddings/embedding-namespace.ts`).
  Authoritative per-root signature.
- **The enabler: per-root vector-store cache keyed by `${resolvedRoot}::${namespace}`**
  (`src/embeddings/hnsw-cache.ts`), with an in-code comment that it exists "so
  multiple roots and provider/model/dimensions tuples can coexist." N indexes
  from N roots already load and query in one process with no collision. This is
  what makes search-time federation tractable rather than a rewrite.
- **Single-root search + rank fusion.** `semanticSearch(root, …)`
  (`src/embeddings/semantic-search.ts`); `hybridSearch(root, …)` fuses BM25 +
  semantic by **RRF** (`src/search/hybrid-search.ts`); optional cross-encoder
  rerank (`src/search/cross-encoder.ts`). RRF fuses by **rank**, so scores from
  different indexes never need a common scale.

What does not exist and must be built:

- Multi-root search. Every entry point (`search.ts`, `semantic-search.ts`, MCP
  `handlers.ts`) takes exactly one `rootPath`.
- A catalog of slurped registries (only the build-oriented `[[sources]]`
  exists, read by `readGlobalSources` at `src/config/loader.ts`, consumed only
  by `mdm index --all`).
- Cross-index merge, realpath dedup, and per-result source attribution.
- Multi-namespace query execution (one query embedding per signature group).
- The comprehension layer (clustering, labeling, near-duplicate, map).
- Federation-aware MCP (today it pins one corpus = `process.cwd()` in
  `src/mcp/server.ts`; the integration is launched with `cd ~/.mdx` to work
  around exactly this).

Load-bearing constraint discovered by the design panel: `loadConfigFile` is
local-OR-global, not merged (`src/config/loader.ts`) — a project-local
`.mdm.toml` short-circuits the global file. Therefore the **catalog must be
read by a dedicated global reader** (mirroring `readGlobalSources`),
independent of which config tier won, while project scope is read from the
effective local config.

## 5. Why search-time federation, not a consolidated index

The requirement is explicit: never re-index an already-built registry, never
move files, never consolidate. A build-time merged super-index re-embeds or
copies vectors — that is consolidation, the abandoned model. Search-time
scatter-gather:

- reuses each index byte-for-byte, zero migration;
- reuses the entire single-root stack (call it once per registry);
- isolates cleanly behind the per-root HNSW cache key;
- makes the only new compute the merge, which RRF keeps cheap and
  namespace-agnostic.

## 6. Full-path registry identity

Identity is the canonical path. Consequences, each handled in-design:

1. **Canonicalization.** On slurp and on every reference, expand `~` and
   resolve `realpath`. `~/.mdx`, `/Users/alphab/.mdx`, and a symlink to it
   resolve to one registry, never three. Canonical form is what the catalog
   stores and what dedup compares.
2. **Moves are detectable, not silent.** If a referenced registry path no
   longer exists, mdm reports `registry <path> not found (moved or deleted?)`
   and offers `mdm registry relink <old> <new>`, rather than quietly returning
   fewer results.
3. **Nesting/overlap is computable from the paths.** If both `~/work` and
   `~/work/clientA` are registries, mdm detects the containment by prefix and
   deduplicates overlapping hits by canonical file path, so a file reachable
   through two registries is returned once (attributed to the nearest
   containing registry).

Tradeoff acknowledged: full paths in a committed project `.mdm.toml` are
machine-specific and will not port to another machine unchanged. This is an
accepted, deliberate choice — the path carries meaning the user wants and the
alias indirection was explicitly unwanted. `~` expansion mitigates the common
home-relative case; cross-machine portability is out of scope (Section 13).

## 7. The catalog

Machine-level, at `~/.mdm/catalog.toml`, read by a dedicated global reader.

```toml
# ~/.mdm/catalog.toml  — self-assembled by `mdm index <dir>`
[[registry]]
path = "/Users/alphab/.mdx"
slurped_at = "2026-06-22T10:00:00Z"
# signature is NOT cached as truth here; it is read live from
# <path>/.mdm/active-provider.json at use time. An optional cached hint may be
# stored and refreshed by `mdm registry refresh`.

[[registry]]
path = "/Users/alphab/Dev/LLM/DEV/helioy/transport-matters"
slurped_at = "2026-06-22T10:05:00Z"
```

Lifecycle commands (Section 10): the catalog is written by slurping and managed
by a `registry` command group. Signature and health are probed live; the
catalog never becomes the source of truth for what an index contains.

## 8. Project scope

In a project's `.mdm.toml`:

```toml
[project]
registries = [
  "~/.mdx",
  "/Users/alphab/work/clientA/notes",
  "/Users/alphab/Dev/LLM/DEV/helioy/transport-matters",
]
include_local = true   # default true: the project's own .mdm/ is in scope
```

Resolution: project-local index (if `include_local`) ∪ each declared registry
path (canonicalized). With no `[project].registries`, behavior is byte-for-byte
today's single-root search — fully backward compatible. A declared path that is
not yet a registry triggers an offer to slurp it (Section 10), never a silent
empty result.

## 9. Federated search

New engine `src/federation/` exposing two functions used by **both** CLI and
MCP (DRY):

- `resolveScope(projectRoot, config, overrides) → ResolvedRegistry[]`
- `federatedSearch(registries, query, opts) → FederatedResult[]`

Pipeline:

1. **Resolve scope** to `ResolvedRegistry[] = {path, signature}` (signature read
   live from each `active-provider.json`).
2. **Group by signature.** Embed the query **once per distinct signature group**
   using that group's provider/model/dimensions. This is both the
   mismatch-handling mechanism and a cost optimization when registries share a
   signature.
3. **Per-registry hybrid search** via existing `hybridSearch(path, …)` — BM25 +
   semantic, isolated by the per-root HNSW cache.
4. **Realpath dedup** by canonical file path + section anchor, so a file in two
   overlapping registries is not double-counted.
5. **RRF merge** the per-registry ranked lists. Rank fusion is the answer to
   cross-index comparability; no cosine normalization.
6. **Optional global rerank** (`--rerank`): cross-encoder over the merged top-K
   for one globally comparable ordering (text-pair scoring is index-agnostic).
7. **Attribute** each result with its registry path and present results keyed by
   real path (Section 6 — path is first-class).

### Embedding compatibility and graceful degradation

- **Uniform signature** (common: everything openai/3-small/512): embed once,
  search all, RRF.
- **Mixed signatures** (e.g. `~/.mdx` openai/512 vs a project on ollama/768):
  embed once per signature group, search within group, RRF across groups
  (rank-based, so cross-space is fine). Requires each group's provider
  credentials in-process.
- **Missing credentials / unservable signature / no embeddings:** that registry
  participates **BM25/keyword-only** (needs no embeddings) and is still
  RRF-merged, with a warning. A search never hard-fails because one provider key
  is absent — this also removes the `OPENAI_API_KEY`-in-MCP fragility.

Cross-index cosine normalization is explicitly out (RRF + optional cross-encoder
suffice).

## 10. CLI surface

No `--in`. Scope is declarative (Section 8). Additive commands:

- `mdm index [dir]` — slurp: build/refresh the index for `dir` (default cwd)
  **and** register its canonical path in the catalog. Incremental
  (content-hash cached), resumable, with the existing cost preview before
  embedding. `--embed` builds semantic vectors; `--watch` keeps the index fresh
  (Section 11).
- `mdm search "<query>"` — federated over the resolved project scope by default;
  results keyed by real path, tagged with their registry; `--rerank` optional.
- `mdm registry list|remove|refresh|relink|inspect` — manage the catalog
  (`inspect <path>` shows signature, doc/vector counts, health, staleness).
- `mdm map` — the comprehension entry point (Section 12): themes, near-dups,
  layout across the resolved scope.
- `mdm index --all` — refresh every registry in the catalog. Incremental: only
  changed files are re-processed (content-hash cached), so it is cheap and safe
  to run anytime.

Optional convenience (not the primary API): `mdm search "<q>" <dir>` may search
a one-off directory ad hoc; if that dir is not yet a registry, mdm offers to
slurp it.

## 11. Freshness

`mdm index --watch` today rebuilds only the structural index
(`src/index/watcher.ts` calls `buildIndex`, not `buildEmbeddings`), so
`--embed --watch` silently lets semantic vectors go stale. This design fixes
that: the watch path performs an incremental embedding refresh for changed files
so `--embed --watch` keeps both structural and semantic indexes current. Catalog
registries can be refreshed on demand (`registry refresh`) or watched.

## 12. Comprehension layer

The differentiated value, computed over the resolved project scope (not the
whole machine), additive on top of embeddings already built:

- **Theme map (`mdm map`).** Cluster the in-scope corpus by embedding
  (k-means or HDBSCAN over the vectors), label each cluster via the existing
  `aiSummarization` provider from representative docs, and present "N documents
  in K themes, living across these directories." Chaos becomes legible. Output
  in text and JSON; available over MCP.
- **Near-duplicate detection.** Extend the existing exact-duplicate command with
  semantic near-dups via cosine threshold over vectors: "these 9 notes are the
  same idea."
- **Relationships and orphans.** The existing link/backlink graph plus semantic
  relatedness — hubs, islands, what connects to what.
- **Organization suggestions (suggest only, never move):** a note's cluster vs
  its directory, candidate merges for near-dups. Surfaced, never applied to the
  user's files.

## 13. Codebase health / refactor map

Robust means the federation engine sits on a clean core, not bolted onto
oversized files. Pre-existing files over the 700-line limit, to be decomposed as
part of this work (not grown):

- `src/cli/commands/search.ts` (~1316 LOC) — extract single-root execution into
  helpers; the command only wires options and calls `federatedSearch`.
- `src/embeddings/vector-store.ts` (~823 LOC) — separate persistence, query, and
  metadata concerns; federation wraps the existing store, does not fork HNSW.
- `src/embeddings/embedding-namespace.ts` (~947 LOC) — split namespace
  generation, active-provider resolution, and path helpers.

New, focused modules (each well under 700 LOC):

```
src/federation/catalog.ts      # read/write ~/.mdm/catalog.toml, canonicalization
src/federation/scope.ts        # resolve project scope -> ResolvedRegistry[]
src/federation/compat.ts       # signature grouping, mismatch reporting
src/federation/search.ts       # multi-registry query, dedup, RRF merge, rerank
src/federation/types.ts        # shared types
src/comprehension/cluster.ts   # cluster + label
src/comprehension/map.ts       # theme map assembly
src/comprehension/neardup.ts   # semantic near-duplicate detection
```

## 14. MCP surface

- The MCP server resolves the federation scope from the cwd project config at
  startup and fans out; `rootPath` becomes the **anchor project**, not the only
  corpus. Removes the `cd ~/.mdx` launch hack.
- `md_search` / `md_context` gain an optional `scope`/registry selector and
  return path-keyed, registry-attributed refs that round-trip into `md_context`.
- `md_map` exposes the comprehension map.
- **Bounded LRU vector-store cache** replaces the current unbounded `Map`
  (`src/embeddings/hnsw-cache.ts`), keyed by `path::namespace::vectorMtime`,
  with a `maxLoadedIndexes` bound and lazy mount — required because the MCP
  server is long-lived and may mount many large registries.
- **Per-registry path security:** the current single-root lexical+realpath
  guard (`src/mcp/adapter.ts`) is applied per resolved registry; MCP never
  accepts arbitrary external paths in tool args, only configured registries.

## 15. Failure modes and robustness

| Failure | Behavior |
| --- | --- |
| Declared registry path missing/moved | Report `not found (moved/deleted?)`, offer relink; continue with the rest. |
| Provider key missing for a signature group | That group degrades to BM25/keyword-only, warn, never hard-fail. |
| Mixed signatures | Per-group query embedding + RRF across groups. |
| Overlapping/nested registries | Realpath dedup; attribute to nearest containing registry. |
| Large/long-lived MCP memory | Bounded LRU + lazy mount + `maxLoadedIndexes`. |
| Stale index (files changed since slurp) | `registry inspect` reports staleness; `index`/`refresh` is incremental and cheap. |
| Corrupt/partial index in a registry | Skip that registry with a clear error, search the rest. |

## 16. Test strategy

- Fixtures: ≥2 registries with deterministic fake embeddings, ≥1 incompatible
  signature, ≥1 overlapping/nested pair, ≥1 missing path. No live API calls.
- Single-root behavior unchanged when no `[project].registries` is set
  (regression guard).
- Federated search returns merged, path-keyed, registry-attributed results;
  realpath dedup verified on the overlapping pair.
- Mixed-signature search embeds once per group and RRF-merges; missing-key group
  degrades to keyword and still contributes.
- Catalog round-trips; canonicalization collapses symlink/`~`/absolute to one
  entry; relink updates references.
- `--embed --watch` refreshes embeddings on file change (the current gap).
- MCP: `md_search` returns registry-attributed refs; `md_context` consumes a
  ref; path traversal via ref is rejected; LRU evicts under bound.
- Comprehension: clustering is deterministic on fixtures; near-dup threshold
  flags the planted duplicate; map JSON shape is stable.

## 17. Delivery sequencing

The target is the whole system. Sequencing exists only so each step is
verifiable and the tree stays green — not to ship a partial product and stop.

1. **Catalog + full-path identity + canonicalization** (`catalog.ts`,
   `registry` command group, slurp registers path). Refactor `search.ts`
   single-root execution into helpers first.
2. **Federated search engine** (`scope.ts`, `search.ts`): declarative project
   scope, multi-registry query, realpath dedup, RRF merge, source attribution,
   `--rerank`. Same-signature and mixed-signature both handled; missing-key
   degradation included (it is core, not deferred).
3. **MCP federation**: scope resolution, bounded LRU, per-registry security,
   refs; remove the `cd ~/.mdx` hack.
4. **Freshness**: `--embed --watch` embedding refresh; `registry refresh`.
5. **Comprehension**: `map`, clustering+labeling, semantic near-dup,
   relationships; suggestions (suggest-only).

Each step ships behind real verification (tests + dogfood on the existing
`~/.mdx` registry and this repo) and an adversarial review pass.

## 18. Migration from `[[sources]]`

Existing global `[[sources]]` entries auto-import into the catalog as registry
paths (read by the same global reader). `mdm index --all` refreshes every
catalog registry incrementally. `[[sources]]`
parsing is kept for one or two releases with a deprecation note, then removed
(the product is pre-release; the clean end state is the catalog).

## 19. Open questions

1. Clustering algorithm and default cluster-count selection (k-means with
   silhouette vs HDBSCAN) — to be settled with a small spike on the real
   `~/.mdx` corpus during step 5.
2. Whether `mdm map` labels are cached per registry (cost) or recomputed on
   demand.
3. Whether project scope may also reference another project's *declared scope*
   (transitive registries) or only concrete registry paths (default: concrete
   paths only; no transitivity in v1).
