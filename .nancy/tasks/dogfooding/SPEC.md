# Task: dogfooding

Address all issues discovered during the mdtldr dogfooding session where 6 autonomous agents explored documentation directories using only the CLI.

## Goal

Fix the 4 prioritized issues from the dogfooding findings to make mdtldr's discovery workflow reliable and complete.

## Success Criteria

### Phase 1: Fix Index Command (P0 - Critical)
- [x] `mdtldr index ./docs` reliably indexes all markdown files (no "0 documents" issue)
- [x] Directory path resolution works correctly for relative and absolute paths
- [x] File discovery correctly identifies `.md` and `.mdx` files
- [x] Errors during indexing are surfaced, not silently swallowed
- [x] Incremental indexing doesn't skip files that should be indexed

### Phase 2: Expand Structural Search (P1 - High)
- [x] Structural search matches content within documents, not just headings
- [x] `mdtldr search "authentication" ./docs` finds sections containing "authentication" anywhere
- [x] Results include a snippet showing the matching content
- [x] Line numbers are included in results for easy navigation
- [x] Performance remains acceptable for typical documentation directories

### Phase 3: Enforce Token Budgets (P2 - Medium)
- [x] `mdtldr context --tokens N` output respects the specified token limit
- [x] Output is truncated if content exceeds budget
- [x] Warning is displayed when content is truncated
- [x] Budget enforcement accounts for formatting overhead (not just raw content)

### Phase 4: Improve Stats Without Embeddings (P3 - Low)
- [x] `mdtldr stats` shows useful information without embeddings enabled
- [x] Basic stats include: document count, total tokens, avg tokens/doc
- [x] Section depth analysis (how many h1, h2, h3, etc.)
- [x] File size distribution or token distribution summary

### Phase 5: Testing Inbox Comms (Meta)
- [ ] Worker receives directives via automatic injection (no polling)
- [ ] Worker responds to orchestrator commands promptly
- [ ] Bidirectional communication flow verified

## Constraints

- No new dependencies unless absolutely necessary
- Maintain backward compatibility with existing CLI interface
- Preserve the existing Effect-based architecture
- Keep tests passing (run `npm test` before completing each phase)
- Follow existing code patterns and conventions

## Notes

### Phase 1 Investigation Areas
- `src/index/indexer.ts`: `walkDirectory()` function may be too aggressive in exclusions
- `src/index/indexer.ts`: Incremental indexing (lines 218-227) may skip files incorrectly
- Path resolution between relative and absolute paths
- `.tldrignore` file handling

### Phase 2 Implementation Approach
- Current search (`src/search/searcher.ts`) only filters by `heading` regex (line 85)
- Need to add a `content` option to `SearchOptions` interface
- Load file content and search using regex or full-text matching
- Consider using the section's `plainText` field for efficient matching

### Phase 3 Implementation Notes
- `src/summarize/summarizer.ts`: `summarizeDocument()` calculates ratio but doesn't truncate (lines 269-274)
- Need to actually truncate sections when over budget
- Account for `formatSummary()` overhead in token counting
- Consider adding `--strict` flag for hard limit vs soft limit

### Phase 4 Enhancement Strategy
- `src/cli/commands/stats.ts`: Currently only shows embedding stats
- Load document and section indexes directly
- Calculate aggregate stats: sum tokens, count sections by level, etc.
- Show useful info even when `hasEmbeddings: false`

## Reference

- Dogfooding findings: `docs/DOGFOODING-FINDINGS.md`
- Key source files:
  - `src/index/indexer.ts` - Index building
  - `src/search/searcher.ts` - Structural search
  - `src/summarize/summarizer.ts` - Token budget handling
  - `src/cli/commands/stats.ts` - Stats command
