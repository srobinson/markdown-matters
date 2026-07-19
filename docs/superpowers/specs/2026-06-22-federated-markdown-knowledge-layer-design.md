# Markdown Knowledge Database — Design

Status: draft for review (v2.2, consolidated-DB model, post three review rounds)
Date: 2026-06-22 (revised 2026-07-18)
Repo: `markdown-matters`
Owner: Stuart (what/why) · Claude (how)

> **Supersedes the v1 "federated per-directory" framing.** v1's default path
> (search-time fusion across N per-directory indexes) had a ranking-correctness
> blocker: reciprocal-rank fusion across indexes discards magnitude, so a
> 5-document directory's weak top hit tied a 50,000-document directory's
> definitive hit. Stuart's model — "one machine config lists my directories,
> together they are my db; projects partition it" — dissolves that by keeping
> **one index per database** and partitioning it with a filter. Federation
> survives only as a **signature-aware cross-database read** (Section 9), which is
> in-scope for the "make sense of everything, even across providers" view. This is
> the robust end-state; delivery is sequenced (Section 17) so each step is
> verifiable.

## 1. Problem and value

A machine with hundreds or thousands of markdown files scattered across many
directories, each following its own (or no) convention. The user **knows their
locations** (the operative word is plural), but does not want to move files,
consolidate them, or re-index a directory more than once. v1 could only index and
search one directory tree at a time, forcing consolidation into `~/.mdx` — bending
the user's life around the tool. That is why it was abandoned.

The value of mdm is **making sense of the markdown that already lives scattered
across your machine, in place.** You declare the directories you care about, mdm
ingests exactly those into a database, and from any project you get search and
comprehension scoped to the slice that matters — with `mdm map --all` over a whole
database and `mdm map --across` over every database (Section 9) giving the "make
sense of it all, even across providers" view.

## 2. The model

> **A manifest of directories (each with recurse + depth) → one consolidated
> database (one embedding signature) → a project partitions the database by
> canonical prefix → search and comprehension run over that partition, the whole
> database, or across databases, every result keyed by its real path.**

- **You declare, mdm ingests.** A per-database manifest lists directories to
  ingest and, per directory, whether to recurse and how deep. No filesystem crawl.
- **One database, one index, one signature.** All ingested directories feed a
  single index (semantic vectors + BM25) under the database home, embedded under
  **one** signature (Section 6.1). One index means one coherent ranking: no
  cross-index score-comparability problem exists to solve within a database.
- **A database is a home.** A database is the directory `$MDM_HOME` (default
  `~/.mdm`). It holds the manifest, the index, the active signature, the cache, and
  its own config. **Multiple homes = multiple databases** (Section 5).
- **A project declares a partition.** In a project's config you list the canonical
  prefixes that project cares about — a subset or sub-slice of the database.
  Search and comprehension filter the one index to those prefixes plus, optionally,
  the project's own files. The config is the scope; there is no per-query `--in`.
- **Reuse is free.** Ingest a directory once; a same-signature directory that
  already has an mdm index (e.g. `~/.mdx`) is imported by **re-inserting its
  existing vectors** — no re-embedding, no API cost (Section 6.2). Re-embedding
  happens only on explicit, costed opt-in (Section 6.1).
- **Everything across signatures is a federated read.** Because a database is
  signature-homogeneous, the "make sense of *everything*, even across providers"
  view is a signature-aware read across databases (Section 9). This is the only
  place federation remains; it is read-only, and its map/enumerate form is in
  scope for delivery.

## 3. Vocabulary

The v1 `[[sources]]` overload ("build targets") is retired.

| Term | Meaning |
| --- | --- |
| **Database (db)** | A signature-homogeneous index over a set of directories, living under a home dir `$MDM_HOME`. |
| **Home** | `$MDM_HOME` (default `~/.mdm`). The db root and its config root (Section 5). Selecting a different home selects a different db. |
| **Manifest** | The per-db list of ingested directories, each with `recurse` and `depth`. Source of truth for what the db contains. |
| **Signature** | An embedding namespace `{provider}_{model}_{dimensions}`. A db has exactly one; enforced at ingest (Section 6.1). |
| **Ingest (slurp)** | Build/refresh the db from its manifest: walk each directory (honoring recurse/depth and nested ignore rules), embed or import changed files, key chunks by canonical document key. `mdm index`. |
| **Canonical document key** | The one absolute, inode-anchored, boundary-comparable identity of a file, computed once and used everywhere (document/section/link/vector/BM25/dedup/CLI/MCP), with one shared resolver back to the on-disk file (Section 7.1). |
| **Partition** | The subset of canonical prefixes a project declares, applied as an inode-aware query-time filter over the one index. |
| **Cross-db read** | The across-signature view: per-signature query embedding, per-db filtered search, union rerank (Section 9). Map/enumerate (`mdm map --across`) is in scope; full search ranking is a follow-up. |

## 4. Architecture (grounded in current code)

An orchestration layer **above** the existing single-root engine, reusing it.

Reused as-is:

- **Per-root index layout.** `getIndexPaths()` lays out
  `indexes/{documents,sections,links}.json`, `cache/`, and per-namespace
  embeddings (`src/index/types.ts`). Under Model A this is produced **once, at the
  database home** via the index-directory abstraction of Section 5, not per
  directory.
- **Vector store + HNSW cache.** `createNamespacedVectorStore`, cached by
  `${resolvedRoot}::${namespace}` (`src/embeddings/hnsw-cache.ts`). `add(entries)`
  inserts **precomputed** embeddings: it assigns fresh labels, calls
  `addPoint(entry.embedding, idx)`, updates `entries`/`idToIndex`, and has no
  provider path (`vector-store.ts`) — the vector-import primitive (Section 6.2).
  hnswlib-node v3.0.0 declares `searchKnn(query, k, filter?)` (label-based
  `FilterFunction`) and `getPoint(label)` (`lib/index.d.ts`) — the partition-filter
  primitives (Section 9); today the call sites pass only `(vector, k)`.
- **Per-call provider resolution.** The provider registry is a `Map<ProviderId,
  ProviderRuntime>` resolved per call (`src/embeddings/providers/registry.ts`); no
  active-provider singleton. Load-bearing for the cross-db read.
- **Rank fusion + rerank.** `hybridSearch` fuses BM25 + semantic by RRF
  (`src/search/hybrid-search.ts`); cross-encoder rerank
  (`src/search/cross-encoder.ts`).
- **Ignore engine.** `ignore@7` via `src/index/ignore-patterns.ts` (precedence
  `CLI/config > .mdmignore > .gitignore > defaults`; defaults include
  `node_modules`, `.git`, `dist`, `build`). Reused; extended to per-level
  re-anchored nesting (Section 6.3).
- **Guards + storage.** The realpath path guard (`src/mcp/adapter.ts`) and the
  temp+rename structural writer (`src/index/storage.ts`) are reused.

Must be built: `resolveMdmHome()` + the index-directory abstraction + config merge
(Section 5); signature enforcement (6.1); vector import (6.2); nested-ignore
re-anchoring (6.3); the canonical document key + shared resolver (7.1); the
generation swap (7.2); partition filter + coverage states (8, 9); comprehension
(12); cross-db read (9); federation-aware MCP (14).

## 5. MDM_HOME, the index directory, and config

A single resolver is the database switch:

```
resolveMdmHome() = process.env.MDM_HOME ?? path.join(os.homedir(), '.mdm')
```

It is realpath-resolved lazily **after** the directory exists (a fresh
`MDM_HOME` that is not yet on disk is created on first write, then canonicalized),
so a not-yet-existing home never throws. Every reference to the global directory
routes through it (DRY — today `~/.mdm` is computed inline via `os.homedir()` in
≥5 places: `loader.ts:150`, `loader.ts:543`, `index-cmd.ts:208`, `init-cmd.ts:123`,
`config-cmd.ts:45`). It joins the existing `MDM_*` env convention.

**The index-directory abstraction.** A single `dbIndexDir(home)` names where the
database's index lives, **distinct** from the legacy per-directory import path
`<dir>/.mdm` that Section 6.2 reads from. Today `INDEX_DIR='.mdm'` is appended by
`getIndexPaths`, `getEmbeddingsDir`, `getActiveProviderPath`,
`HnswVectorStore.getIndexDir`, and `createBM25Store`; these are re-pointed at
`dbIndexDir(home)` so a db home does **not** double to `~/.mdm/.mdm`. The db home
and its config home are the same directory:

```
$MDM_HOME/                        # default ~/.mdm; == dbIndexDir root
  .mdm.toml                       # this db's config (the former "global" tier)
  manifest.toml                   # directories + recurse/depth (Section 6)
  gen-<n>/                        # one atomic generation (Section 7.2), holding:
    active-provider.json          #   the db's one signature
    indexes/{documents,sections,links}.json
    embeddings/<namespace>/vectors.{bin,meta.bin}
    bm25.{json,meta.json}
  current                         # pointer file naming the live generation
  cache/
```

**Config precedence (merge, highest wins), by key:**
`env MDM_*` > project `.mdm.local.toml` > project `.mdm.toml` > `$MDM_HOME/.mdm.toml`
> built-in defaults. The two project files **merge** (machine-local overrides
portable); this deliberately refines today's local-OR-global short-circuit
(`loadConfigFile`), which the loader change implements as a keyed merge. Switch
home = switch database *and* its config. On-machine/on-disk relocation is supported
by a rehome migration (Section 18), not a bare copy (keys inside are canonical
absolute — Section 7.1).

Project directories no longer carry their own `.mdm/` index; their content lives in
the db. Legacy per-project `.mdm/` indexes are import sources (Section 18).

## 6. Ingestion (slurp)

`mdm index` builds/refreshes the active database (`$MDM_HOME`) from its manifest.

```toml
# $MDM_HOME/manifest.toml
[[dir]]
path = "~/.mdx"
recurse = true          # default true
[[dir]]
path = "~/work/clientA/notes"
recurse = true
depth = 2               # descend at most 2 levels below path
[[dir]]
path = "~/Documents/loose-notes"
recurse = false         # top-level markdown only
```

- **Manifest is the source of truth**, maintained declaratively (edit it, or
  `mdm index <dir>` appends a `[[dir]]`). No arg refreshes the whole manifest.
- **recurse / depth** bound each walk — the primary control for scattered trees.
- **Incremental.** Only changed files are re-embedded (content-hash cache). Files
  reachable through overlapping/nested manifest directories dedup by canonical key
  + inode at ingest (Section 7.1), so a file is stored once.
- **Atomic.** Writes use the generation swap of Section 7.2.

### 6.1 Signature homogeneity (enforced) and mismatch handling

A database holds exactly one signature (`active-provider.json`). The code already
enforces this structurally (`load()` raises `DimensionMismatchError`; `addPoint`
rejects wrong-length vectors — `vector-store.ts`). The design turns that hard
failure into **world-class guidance**. When `mdm index <dir>` finds `<dir>`'s
signature differs from the db's, nothing is written and three explicit paths are
offered. The directory's signature is its existing index's when it has one, or the
one the active provider **would produce** when it does not (knowable before any
embedding, from the active-provider config):

```
This database (~/.mdm) is embedded with  openai/text-embedding-3-small/512.
~/proj/notes has no mdm index yet; your active provider would embed it as
                                         ollama/nomic-embed-text/768.
A database holds one signature, so they cannot share an index. Choose:

  1. Put it in its own database (no cost). NOTE: this is a SECOND database — you
     will have two indexes, unified only by `mdm map --across` (§9), not one index:
       MDM_HOME=~/notes-db mdm index ~/proj/notes

  2. Re-embed ~/proj/notes into THIS database's signature (openai/…/512):
       ~4,120 chunks · est. $0.02 · ~40s
       mdm index ~/proj/notes --reembed

  3. Rewrite THIS database to ollama/…/768 (re-embeds everything already here):
       ~25,300 chunks · local model, no API cost · ~6m      [destructive]
       mdm index --rewrite-signature ollama/nomic-embed-text/768   (confirm)

Nothing changed. Re-run with your choice.
```

Both re-embed paths quantify **cost and time** (dollars for a paid provider, "local
model, no API cost" for a local one) and count. Option 1 preserves "reuse is free"
but is explicitly a second database. Option 2 is costed opt-in re-embed of one
directory. Option 3 is the destructive nuke-and-rewrite of the whole db, gated
behind an explicit confirm. The feedback always states both signatures, explains
the constraint, quantifies, and never proceeds without intent.

### 6.2 Vector import (no re-embed)

When a manifest directory already has an mdm index of the **same signature** (e.g.
`~/.mdx` = openai/512 = the common default), ingest imports it by decoding its
stored metadata payload `<dir>/.mdm/embeddings/<ns>/vectors.meta.bin` (verified
122 MB, 25,300 entries with full 512-dim embeddings inline — this file supplies the
re-insert payload; the raw `vectors.bin` HNSW graph need not be merged) and
re-inserting via `add(entries)` — precomputed, zero API calls, labels remapped,
`entries` map updated. Keys are rewritten to the canonical document key on import
(Section 7.1). A different-signature directory takes the Section 6.1 path.

### 6.3 Git-style nested ignore inheritance

The `ignore@7` engine is reused, extended so `.gitignore`/`.mdmignore` are read at
**each descended directory level** with git semantics: patterns are **re-anchored**
to the directory of the file they came from (not flattened to the walk root),
nested rules override ancestors, negation (`!keep.md`) is honored across levels, and
an ignore file inside an already-ignored directory is skipped. The existing
type-precedence composes with level (nearer file wins within a tier). Built-in
defaults still guarantee `node_modules`/`.git`/`dist`/`build` exclusion. Deliberate
divergences from git are enumerated in code comments and tests.

## 7. Identity, canonicalization, and atomicity

### 7.1 One canonical document key (the keystone)

Every path-related review finding reduced to one missing definition: a single
canonical **key** that identifies a file everywhere (document index, section index,
links, vectors, BM25, dedup, CLI output, MCP refs), plus **one shared resolver**
from that key to the on-disk file.

- **Form.** The key is the absolute, `~`-expanded, `realpath`-resolved path,
  anchored to `(st_dev, st_ino)` inode identity; on case-insensitive volumes it is
  case-folded for comparison (macOS `realpath` is empirically case-*preserving*, so
  string compares alone break). This replaces today's root-relative `documentPath`
  (`indexer.ts:577`) and the relative keys in `DocumentIndex`/`LinkIndex`.
- **Do NOT flip `documentPath` to absolute in isolation.** Every current consumer
  does `path.join(root, documentPath)` to read the file — `buildIndex`,
  `searcher.searchWithContent`, `buildBM25Index`, `duplicates` `createFileContentCache`,
  `semanticSearchWithContent`, `semantic-search-pipeline`, `search.ts` — and that
  join would turn `/Users/x.md` into `<db-home>/Users/x.md`. The change is: (a) one
  canonical key stored in `DocumentEntry.path`, `SectionEntry.documentPath`, links,
  vector metadata, and BM25 docs; (b) one shared `resolveSourceFile(key)` that
  returns the real on-disk path, replacing **every** `path.join(root, documentPath)`
  caller; (c) a migration rewriting existing relative keys to canonical on
  ingest/import. Touch points, migration, and tests are enumerated in §13 and §16.
- **Prefix comparison is boundary-aware** (reusing `adapter.ts:120`, DRY) so
  `~/work` does not match `~/work-notes`; trailing slashes normalized.
- **Dedup + membership are inode-aware.** On hardlink dedup the file is stored once;
  the **surviving key is the lexicographically-least in-manifest canonical path**
  (deterministic), and the store records **all** in-manifest canonical paths for
  that inode. Partition membership tests inode, not a single string: a file
  hardlinked into two manifest directories **belongs to every partition whose prefix
  contains any of its links** — closing the "looks-covered-isn't" silent-invisible
  gap and honoring the §15/§16 hardlink guarantee.
- **Move / symlink re-target detection.** The manifest stores declared path +
  canonical target captured at ingest; a missing path is reported
  `not found (moved/deleted?)` with relink; a symlink whose target changed (old
  target still exists) is caught by declared-vs-canonical mismatch and treated as a
  move — never a silent wrong corpus.

### 7.2 Atomic generation swap

An index is several files across several directories (structural JSON, the BM25
pair, vectors + metadata, `active-provider.json`), so no per-file `rename`
suffices — a reader could pair a new `vectors.bin` with an old `meta.bin` and
silently drop hits. A rebuild writes a whole new **root generation**
`$MDM_HOME/gen-<n>/` containing the *entire* consistent set (structural JSON, BM25,
vectors, metadata, active-provider), fsyncs it, then flips a single atomic `current`
pointer (a pointer file renamed into place) naming that generation.

- **Reader protocol (one concrete cross-process gate).** A reader: (1) reads
  `current` → generation `G`; (2) acquires a lease on `G` by creating
  `gen-<G>/leases/<pid>-<ts>` **only if `G`'s reaping gate is open** — the
  gate-check-and-lease-create is the single atomic step; (3) re-reads `current` —
  if it no longer names `G`, or `G`'s gate has since closed, the reader releases the
  lease and retries with the new generation; otherwise it now holds a lease that
  protects `G` and opens `G`'s files. This resolve→lease→recheck sequence closes the
  TOCTOU without pretending a multi-file open is itself atomic. The reader holds the
  lease through all reads and releases it on completion.
- **Reaper protocol.** To reap an old generation `G'` (never `current`): (1)
  atomically **close `G'`'s gate** so no new reader can lease it; (2) wait for
  existing leases on `G'` to drain, plus a grace window; (3) delete `G'`. The live
  `current` generation is never gated or reaped.
- **Crash recovery, never reaping a live reader.** A lease records holder PID **and
  process-start identity** (start-time / boot-id) to defeat PID reuse. A lease is
  abandoned **only** when its holder is no longer alive, or a process now holds that
  PID with a *different* start identity (the original crashed). A lease whose holder
  is alive **and** identity matches is retained **indefinitely**, however long the
  read runs — lease age is never on its own an abandonment condition. The reaper
  deletes an old generation only after every lease on it is released or proven
  abandoned by this liveness+identity test, plus the grace window.
- The HNSW/LRU cache key includes the generation (`home::namespace::gen`), so a
  flip invalidates naturally.

Tradeoff acknowledged: absolute keys are machine-specific. They live only in the
database (under the machine-local home) and in the gitignored `.mdm.local.toml`
partition, never in committed portable config. Relocation uses the rehome migration
(Section 18).

## 8. Project partition

A project selects a database (home binding) and declares a partition. Config is
split to keep machine paths out of version control.

```toml
# .mdm.toml         — committed, portable. No machine paths.
[project]
rerank = true

# .mdm.local.toml   — gitignored, machine-local.
[project]
home = "~/work-db"                 # optional: pin this project's db (a path, not a name)
dirs = ["~/.mdx", "~/work/clientA/notes"]   # the partition: canonical prefixes
include_local = "off"              # off | read | ingest  (Section 8.1)
```

- **Database selection precedence:** `env MDM_HOME` > project `home` > default
  `~/.mdm`.
- **Partition = a set of canonical prefixes** (Section 7.1), a subset or sub-slice
  of the db. Membership is **inode-aware** (Section 7.1): a hit belongs iff any
  canonical link of its inode is under a prefix (boundary-aware).
- **Coverage is three-state, per prefix:**
  - *present* — a manifest directory covers the prefix at sufficient depth (best
    coverage across multiple manifest ancestors wins → present): searched normally.
  - *partial* — a manifest directory contains the prefix but its `recurse`/`depth`
    stops short of the prefix's subtree: a **warning** names the gap and the
    `mdm index` that closes it; present files still return. Never a silent
    "looks-covered-isn't."
  - *absent* — no manifest directory contains it: offer to ingest (CLI) or the
    defined non-interactive behavior (MCP, Section 14).
  If **all** declared prefixes are absent (e.g. a repo cloned to a new machine),
  raise a loud blocking error, never a silent degrade to local-only.
- A single-file prefix (a partition entry that is a file, not a directory) is
  supported explicitly.

### 8.1 include_local: read vs ingest are separate

`include_local` never silently mutates a shared home:

- `off` (default) — the project's own directory is not in scope.
- `read` — include the project directory in the *partition* **only if** it is
  already ingested; otherwise warn (partial/absent). A pure read filter, no writes.
- `ingest` — register the project directory into the selected db's manifest and
  ingest it, then include it. A deliberate write, never implicit.

This removes the "every project pollutes the shared `~/.mdm`" trap: reads never
write, and writing a project's files into a shared db is an opt-in.

## 9. Search

Two functions used by **both** CLI and MCP (DRY):

- `resolvePartition(projectRoot, config, env) → { home, prefixes, coverage }`
- `search(home, prefixes, query, opts) → Result[]`

Default path (single database — the common case):

1. Resolve the partition and its coverage (Section 8).
2. Open the db index (HNSW cache keyed by `home::namespace::gen`; read `current`
   once — Section 7.2).
3. **Filtered hybrid search over the one index:**
   - semantic: `searchKnn(query, k·f, filter)` where the filter accepts labels
     whose inode has a canonical link under a prefix (boundary-aware); for a very
     selective partition, brute-force cosine over just the partition's vectors
     (`getPoint`/`entries`) instead;
   - BM25 (wink has no native filter): over-fetch then post-filter by canonical key.
4. **One coherent ranking.** Single index + single signature → the existing
   within-index RRF fuses BM25 + semantic with no cross-index comparability problem.
5. **Optional rerank** (`--rerank`): cross-encoder over the top-K.
6. **Attribute** each result with its origin directory; present keyed by real path.

**Cross-database read** (the across-signature view — Section 2): when a partition,
`mdm search --across`, or `mdm map --across` spans databases with **different
signatures**, embed the query once per signature (per-call provider resolution),
run the filtered single-db search in each db **with a per-db over-fetch (k·f)**,
then rerank the **union of all per-db candidates** with the cross-encoder by
default. Reranking the union — not a pre-truncated RRF top-K — guarantees RRF's
magnitude-blindness never gates a strong deep hit out of the rerank pool. A per-db
relevance floor applies to **both** channels (BM25 min-score, and the semantic
0.35 cosine threshold as the semantic floor) so a tiny db cannot inject rank-1
noise. Deterministic tiebreak (canonical key, then origin, then section id) over a
fixed db iteration order. **Cross-db map/enumerate (`mdm map --across`: themes,
counts, near-dups over the union) is in scope for delivery (step 6); full cross-db
search ranking is a follow-up.**

## 10. CLI surface

No `--in`. Scope is declarative (Section 8). Additive commands:

- `mdm index [dir]` — ingest into the active db (`$MDM_HOME`). No arg refreshes the
  manifest; `<dir>` ingests/updates one directory. Incremental, resumable, cost
  preview before any embedding, vector import when a same-signature index exists,
  the Section 6.1 mismatch flow otherwise. `--embed`, `--watch` (Section 11),
  `--force`, `--reembed`, `--rewrite-signature <sig>`.
- `mdm search "<query>"` — filtered over the resolved partition; keyed by real path,
  origin-tagged; `--rerank`; `--across` for the cross-db read.
- `mdm map [--all] [--across]` — comprehension (Section 12) over the partition, the
  whole db (`--all`), or across dbs (`--across`).
- `mdm manifest list|remove|refresh|relink|inspect|suggest` — manage the manifest
  (`inspect` shows signature, counts, health, staleness; `suggest` reports
  directories with dense markdown as candidates — suggest-only, no crawl-ingest).
- Database selection is ambient via `MDM_HOME`.

## 11. Freshness

`mdm index --watch` today rebuilds only the structural index (`watcher.ts` calls
`buildIndex`, not `buildEmbeddings`), so `--embed --watch` lets vectors go stale.
Fixed: the watch path performs an incremental embedding refresh for changed files
(`buildEmbeddings` is already delta by section id), honoring the manifest's
recurse/depth and the nested ignore rules, writing via the generation swap.
`mdm manifest refresh` refreshes on demand.

## 12. Comprehension layer

The differentiated value ("make chaos legible"), over the partition, the whole db,
or across dbs:

- **Theme map (`mdm map`).** Cluster the in-scope corpus by embedding, label each
  cluster via the existing `aiSummarization` provider, present "N documents in K
  themes across these directories." `--all` covers the whole db; `--across` covers
  every db (Section 9). Text + JSON; over MCP.
- **Near-duplicate detection.** Extend the existing exact-duplicate command
  (`src/cli/commands/duplicates.ts`) with semantic near-dups via cosine threshold.
- **Relationships and orphans.** The existing link/backlink graph plus semantic
  relatedness — hubs, islands, connections.
- **Misfiled flag (descriptive, not prescriptive).** A thin derived signal in
  `mdm map` output: a note whose cluster differs from its directory siblings. The
  v1 organization-suggestion/merge *engine* is **cut**; kept as a flag only.

## 13. Codebase health / refactor map

Pre-existing files over the 700-line limit, decomposed as part of this work (not
grown): `src/cli/commands/search.ts` (~1316), `src/embeddings/vector-store.ts`
(~823), `src/embeddings/embedding-namespace.ts` (~947).

New, focused modules (each well under 700 LOC):

```
src/home.ts                    # resolveMdmHome, dbIndexDir abstraction, config merge (5)
src/db/manifest.ts             # read/write manifest.toml, recurse/depth
src/db/canonical.ts            # canonical document key + boundary-aware prefix +
                               #   shared resolveSourceFile(key) (replaces every
                               #   path.join(root, documentPath) caller) (7.1)
src/db/signature.ts            # signature detect/compare + mismatch UX (6.1)
src/db/generation.ts           # gen-<n> write, current-pointer flip, reader lease/reap (7.2)
src/db/ingest.ts               # manifest-driven ingest, vector import
src/db/partition.ts            # resolve partition -> {home, prefixes, coverage}
src/db/search.ts               # single-db filtered query + selectivity strategy
src/federation/crossdb.ts      # cross-db read: per-signature embed, union rerank (9)
src/comprehension/{cluster,map,neardup}.ts
```

The canonical-key migration is a required, enumerated part of the `canonical.ts`
work: every `path.join(root, documentPath)` site listed in §7.1 moves to
`resolveSourceFile`, and existing on-disk indexes rewrite relative keys to canonical
on first ingest/import.

## 14. MCP surface

- The server resolves `MDM_HOME` + the project partition from cwd at startup and
  serves the db; the partition is the default filter. Removes the `cd ~/.mdx` hack.
- `md_search` / `md_context` gain an optional prefix selector and return path-keyed,
  origin-attributed refs that round-trip into `md_context`. (`md_search` moves from
  `semanticSearch` to the filtered hybrid engine — a called-out change.)
- `md_map` exposes the comprehension map (partition / `--all` / `--across`).
- **Declared-but-not-ingested prefix (non-interactive):** MCP does not prompt. It
  does a cheap structural ingest on first use and returns a "semantic pending" ref,
  or a structured "not indexed" ref. Signature mismatch returns a structured "needs
  its own home or --reembed" ref — never a silent skip or empty result.
- **Bounded LRU vector-store cache** replaces the unbounded `Map`, keyed by
  `home::namespace::gen`, `maxLoadedIndexes` bound, lazy mount.
- **Per-partition path security:** the root-parameterized realpath guard
  (`adapter.ts`) is applied per allowed prefix; only paths inside the partition are
  accepted.

## 15. Failure modes and robustness

| Failure | Behavior |
| --- | --- |
| `mdm index <dir>` signature ≠ db | World-class 3-option guidance (new home / `--reembed` costed / `--rewrite-signature` destructive), cost+time quantified; nothing written until chosen (6.1). |
| Manifest directory missing/moved | Report `not found (moved/deleted?)`, offer relink; continue with the rest. |
| Symlink directory re-targeted | Detect declared-vs-canonical mismatch, treat as move; never wrong corpus silently. |
| File hardlinked into two manifest dirs | Stored once (least-path survives); membership is inode-aware so it belongs to every containing partition (7.1). |
| Partition prefix partially covered | Warn with the exact gap + the `mdm index` to close it; return present files (8). |
| All partition prefixes absent | Loud blocking error (cloned to a new machine?); never silent local-only. |
| Concurrent index/watch/MCP + search (separate processes) | Generation swap + `current` flip + per-generation reader lease; readers pin one generation; no torn reads, no premature reap, no leak (7.2). |
| Home relocated on-disk / to another machine | Rehome migration rewrites canonical keys; a bare copy is flagged, not silently wrong (18). |
| Corrupt/partial generation | Clear error + `--force`; the last-good `current` still serves. |

## 16. Test strategy

- Fixtures: a db over ≥2 directories with deterministic fake embeddings; ≥1
  overlapping/nested pair; ≥1 case-variant path; ≥1 hardlink into two manifest
  dirs; ≥1 missing path; ≥1 symlink re-target; ≥1 depth-partial prefix. A second db
  of a different signature for the cross-db read. No live API calls.
- Regression: single-root behavior unchanged with no `[project].dirs` + no manifest.
- `MDM_HOME` selects the db and its config; two homes fully isolated; no
  `~/.mdm/.mdm/` doubling; a not-yet-existing `MDM_HOME` is created then resolved;
  config merge precedence (`.mdm.local.toml` over `.mdm.toml` over `$MDM_HOME/.mdm.toml`).
- Signature enforcement: mismatch triggers the 3-option flow and writes nothing;
  no-prior-index uses "would produce"; `--reembed` brings one dir in; `--rewrite-signature`
  re-embeds under confirm; same-signature import re-inserts from `vectors.meta.bin`
  with zero embedding calls.
- Canonical key: ingest keys canonical; import rewrites relative→canonical; every
  former `path.join(root, documentPath)` site resolves via `resolveSourceFile`;
  boundary-aware prefix rejects `~/work-notes` for prefix `~/work`; case-fold and
  hardlink dedup verified; **a file hardlinked into two manifest dirs is found by a
  partition on either link.**
- Generation swap: a search during a concurrent rebuild always reads one consistent
  generation; a held (leased) generation is not reaped; a reader whose gate closes
  mid-resolve retries onto `current`; a released one is reaped after grace. A **live
  lease older than any backstop is never reaped**; a crashed holder (dead PID, or
  PID reused with a mismatched start identity) is reclaimed after grace.
- Partition coverage: present/partial/absent behaviors; best-ancestor-coverage →
  present; all-absent blocks loudly; single-file prefix matches one file.
- include_local: `read` never writes; `ingest` writes only on opt-in.
- Nested ignore: negation across levels; ignore file in an ignored dir skipped.
- Cross-db read: mixed-signature embeds once per signature; **rerank scores the
  union of per-db over-fetched candidates** (a large db's deep-but-strong hit is not
  gated out by a tiny db's rank-1); semantic + BM25 floors both applied; tiebreak
  deterministic; `map --across` enumerates.
- `--embed --watch` refreshes embeddings on change.
- MCP: origin-attributed refs; traversal outside partition rejected; LRU evicts;
  not-ingested and signature-mismatch return the defined refs.
- Comprehension: clustering deterministic; near-dup flags the plant; `map --all`
  covers the db; JSON shape stable.

## 17. Delivery sequencing

The target is the whole system; sequencing keeps each step verifiable and green.

1. **Home + canonical key + manifest + consolidated ingest.** `resolveMdmHome` +
   `dbIndexDir` + config merge (§5); `canonical.ts` (the keystone) with the shared
   `resolveSourceFile` and the `path.join` migration; `manifest.toml`; ingest into
   one db; **signature detect + enforcement UX** (6.1); **same-signature vector
   import** (6.2, validate on `~/.mdx` first); nested-ignore re-anchoring (6.3);
   generation swap (7.2). Refactor `embedding-namespace.ts` and `vector-store.ts`
   seams first.
1b. **Thin whole-db `mdm map --all`** (cluster + label + near-dup, no partition
   filter) — a step-1 exit criterion that proves comprehension on the consolidated
   db before any search plumbing, so the differentiator can never stall behind
   step 2.
2. **Partitioned search.** `partition.ts` + `db/search.ts`: config split, home
   binding, inode-aware canonical-prefix filter, 3-state coverage, selectivity
   strategy, `include_local` read/ingest, origin attribution. Refactor `search.ts`.
3. **Full comprehension.** Partition-scoped `mdm map`, relationships/orphans,
   misfiled flag, `manifest suggest`.
4. **MCP.** Home + partition resolution, filtered hybrid engine, bounded LRU,
   per-partition security, refs (incl. not-ingested + signature-mismatch); remove
   the `cd ~/.mdx` hack.
5. **Freshness.** `--embed --watch` embedding refresh; `manifest refresh`.
6. **Cross-db read.** Signature-aware view: per-signature embedding, **union
   rerank**, dual-channel floors, deterministic tiebreak. `mdm map --across` (the
   across-signature "everything" view) ships in scope; full cross-db search ranking
   is the sole deferred follow-up.

Each step ships behind real verification (tests + dogfood on `~/.mdx` and this repo)
and an adversarial review pass **run through the warroom**.

## 18. Migration from v1

- **`[[sources]]`** entries auto-import into the default db's manifest as `[[dir]]`.
  `name` is dropped.
- **Existing per-directory `.mdm` indexes** of the same signature (e.g. `~/.mdx`)
  import by re-inserting their `vectors.meta.bin` payload (Section 6.2); different
  signature takes the 6.1 path.
- **Canonical-key migration**: on first ingest/import an existing index's relative
  document keys are rewritten to canonical (Section 7.1).
- **Rehome migration** (`mdm manifest rehome <old> <new>` / on-copy detection):
  rewrites canonical keys when a home moves on-disk or to another machine.
- `[[sources]]` parsing kept one or two releases with a deprecation note, then
  removed.

## 19. Open questions

1. Clustering algorithm and default cluster-count selection (k-means + silhouette vs
   HDBSCAN) — a small spike on the real `~/.mdx` corpus during step 1b.
2. Whether `mdm map` labels are cached per db or recomputed on demand.
3. `vectors.meta.bin` memory: inline embeddings make the payload large (0.5–1 GB
   read whole into RAM at 100k+ entries; `save()` already warns >100 MB). Whether to
   move to a memory-mapped/chunked store during consolidation, or defer.
4. Nested-ignore performance on very deep trees (per-level ignore reads) — measure,
   cache per directory.

**Resolved:** consolidated-DB pivot (dissolves v1's RRF blocker); signature-homogeneous
db with world-class 3-option enforcement + costed opt-in re-embed (6.1); one
canonical document key + shared resolver with enumerated migration (7.1); inode-aware
partition membership incl. hardlinks (7.1/8); atomic single-root generation swap with
cross-process reader lease (7.2); `MDM_HOME` = db + config home with `dbIndexDir`
abstraction, config-merge precedence, and not-yet-existing-home handling (5);
`include_local` read/ingest split (8.1); 3-state partition coverage (8); cross-db
rerank over the union with dual-channel floors (9); **cross-db map/enumerate in scope,
only full cross-db search ranking deferred** (9/§17 step 6); comprehension pulled to
step 1b; org-suggestion engine cut to a descriptive misfiled flag (12).
