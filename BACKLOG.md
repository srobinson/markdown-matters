# mdm Improvement Backlog

> Generated from a validation experiment with 11 AI agents across 3 strategies.
> Refreshed 2026-08-24 against v0.4.1: each item was verified against the live CLI.
> Of the original 15 items, 12 have shipped. See Shipped below for how.

---

## Open

### 1. Cross-File Concept References

Originally item 8 (P2).

**Problem:** No command finds which files reference a concept when no markdown link exists. `mdm backlinks` and `mdm links` cover explicit links only.

**Impact:** Manual grep needed to understand document relationships. Particularly wanted by Strategy C agents for architectural investigation.

**Shipped so far:** `mdm backlinks <file>` and `mdm links <file>` work for markdown links.

**Remaining:**
- [ ] `mdm refs "Execution Context"` shows all files mentioning a concept
- [ ] `mdm refs --graph` outputs a dependency graph (mermaid/dot format)
- [ ] Unlinked mention detection: for a doc with no inbound links, report plain-text mentions of its filename separately from links (approved 2026-08-24; motivating case: INTERACTIVE.md has zero inbound links but PROJECT.EXPORT.md names it as an authority in a table)

**Effort:** Medium (mention scan) to High (full concept graph)

**Sources:** C1, C6, FINAL-SYNTHESIS

---

### 2. Neighborhood View Around Search Results

Originally item 9 (P2).

**Problem:** Search results show isolated matches. Agents wanted adjacent sections for context without fetching the entire file. Line-level context (`-C`/`-B`/`-A`) shipped; section-level context did not.

**Acceptance Criteria:**
- [ ] `mdm search "checkpoint" --context-sections 1` shows 1 section before/after each match
- [ ] Section context clearly labeled with headers
- [ ] Works with structural and semantic search

**Effort:** Medium

**Sources:** C2, C3, FINAL-SYNTHESIS

---

### 3. Saved Queries / Aliases

Originally item 13 (P3).

**Problem:** Agents repeatedly ran similar complex queries.

**Acceptance Criteria:**
- [ ] `mdm alias add arch-issues "search 'architecture AND (problem OR issue OR concern)'"`
- [ ] `mdm arch-issues` runs the saved query
- [ ] Aliases stored under the mdm home directory

**Effort:** Medium

**Sources:** FINAL-SYNTHESIS

---

## Shipped

Verified against v0.4.1 on 2026-08-24.

| # | Item | How it shipped |
|---|------|----------------|
| 1 | Boolean query operators | `AND`, `OR`, `NOT`, and grouped expressions: `mdm search "auth AND (error OR bug)"`. Documented in `mdm search --help`. |
| 2 | Graceful embeddings fallback | Search header prints index freshness and `Embeddings: yes (N vectors)`; `mdm stats` has an Embeddings section with provider, model, dimensions, and cost. |
| 3 | Section-level context extraction | `mdm context doc.md --section` by name, number, or glob; `--sections` lists sections; `--shallow` excludes nesting; `-x` excludes sections. |
| 4 | Search result context lines | `-C <n>`, `-B <n>`, `-A <n>`, grep style, in both search modes. |
| 5 | Result limit control | `-n/--limit <n>` plus a `(30 more available, use --limit)` hint. `--all` and `--offset` were not built; `-n` with a large value covers the need. |
| 6 | Truncation UX | Header states the reduction upfront (`Tokens: 785 (98% reduction from 6919)`); `--full` disables truncation; `--sections` enables targeted retrieval. |
| 7 | Phrase search with quotes | `mdm search '"context resumption"'`, combinable with boolean operators. |
| 10 | Search mode indicator | Output header shows `[hybrid]`, `[semantic]`, or `[keyword]`; `--mode` forces a mode. |
| 11 | Query syntax help | `mdm search --help` carries an extensive examples section covering boolean, phrase, regex, and mode syntax. |
| 12 | Multi-file glob context | `mdm context *.md` with `-t <n>` token budget across files; per-file provenance in output. |
| 14 | Relevance score display | Each result shows its score and mode, e.g. `(3.2 RRF, semantic+keyword)`; results sorted by relevance. |
| 15 | Troubleshooting guide | `docs/USAGE.md` has a Troubleshooting section; `mdm search --help` notes cover 0-result and threshold diagnosis. |

---

## Summary

| Status | Count |
|--------|-------|
| Shipped | 12 |
| Open | 3 |

---

## Validation Sources

All tasks derived from agent feedback across three strategies:

- **Strategy A:** A1, A2, A3, A-Synth (4 agents, by-folder approach)
- **Strategy B:** B1, B2, B3, B-Synth (4 agents, by-question approach)
- **Strategy C:** C1, C2-C6, C-Synth (7 agents, two-phase approach)
- **Final Synthesis:** Cross-strategy analysis

Full reports: `/Users/alphab/Dev/LLM/DEV/TMP/memory/reports/`
