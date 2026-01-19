# mdtldr Improvement Backlog

> Generated from validation experiment with 11 AI agents across 3 strategies.
> See `/reports/FINAL-SYNTHESIS.md` for full analysis.

---

## P0 - Critical (Blocking Agent Workflows)

### 1. Boolean Query Operators

**Problem:** Agents couldn't search for multi-term concepts like "architecture AND criticism" or "checkpoint NOT example". Phrases returned 0 results even when concepts were present separately.

**Impact:** 3-5x more commands needed for workaround (multiple single-term searches + manual correlation). Strategy B agents rated tool lower (4.2/5) partly due to this.

**Solution:** Add boolean operators to search command.

**Acceptance Criteria:**
- [ ] `mdtldr search "auth AND criticism"` returns results containing both terms
- [ ] `mdtldr search "checkpoint OR gate"` returns results containing either term
- [ ] `mdtldr search "implementation NOT example"` excludes results with "example"
- [ ] `mdtldr search --help` documents boolean syntax

**Effort:** Medium

**Sources:** B1, B2, B3, C3, C4, FINAL-SYNTHESIS

---

### 2. Graceful Embeddings Fallback

**Problem:** Semantic searches returned 0 results without clear indication that embeddings weren't built. Agent A2 was confused by silent failures.

**Impact:** Inconsistent behavior, wasted agent turns, reduced confidence. A2 rating would be 5/5 with better UX.

**Solution:** Auto-detect embeddings state and provide clear feedback.

**Acceptance Criteria:**
- [ ] When embeddings don't exist, search shows: "Semantic search unavailable. Using structural search. Run `mdtldr index --embed` for semantic search."
- [ ] OR: Auto-prompt on first search: "Enable semantic search? (requires ~30s indexing)"
- [ ] Search output shows mode indicator: `[semantic]` or `[structural]`
- [ ] `mdtldr stats` shows embeddings status: "Embeddings: Yes/No (run index --embed to enable)"

**Effort:** Low-Medium

**Sources:** A2, FINAL-SYNTHESIS

---

### 3. Section-Level Context Extraction

**Problem:** Agents couldn't request context for a specific section without retrieving the entire file. When investigating a specific subsection, full-file context wastes tokens.

**Impact:** Over-retrieval or multiple refined searches needed. Forces choosing between full context or aggressive summarization.

**Solution:** Enable section-targeted context extraction.

**Acceptance Criteria:**
- [ ] `mdtldr context file.md --section "Memory Model"` returns only that section
- [ ] `mdtldr context file.md:5.3` returns section 5.3 (by number)
- [ ] `mdtldr context file.md --section "Memory*"` supports glob patterns
- [ ] Nested sections included by default, `--shallow` flag for top-level only

**Effort:** Medium-High

**Sources:** A1, A2, C2, C4, FINAL-SYNTHESIS

---

## P1 - High Priority (Significant UX Improvement)

### 4. Search Result Context Lines

**Problem:** Search results show line numbers but minimal surrounding context. Hard to evaluate relevance without reading full sections.

**Impact:** Extra commands needed to fetch context around matches. Agents requested grep-like `-C` behavior.

**Solution:** Add context lines around search matches.

**Acceptance Criteria:**
- [ ] `mdtldr search "checkpoint" -C 3` shows 3 lines before/after each match
- [ ] `mdtldr search "checkpoint" -B 2 -A 5` shows 2 before, 5 after
- [ ] Context lines clearly delineated from match lines
- [ ] Works with both structural and semantic search

**Effort:** Low-Medium

**Sources:** B2, C3, C5, FINAL-SYNTHESIS

---

### 5. Remove 10-Result Limit / Add Pagination

**Problem:** Default 10 results per query makes it hard to see ALL occurrences of a theme. Agents needed multiple queries to ensure comprehensive coverage.

**Impact:** Incomplete results for common terms, extra commands for pagination workarounds.

**Solution:** Add flags for result limit control.

**Acceptance Criteria:**
- [ ] `mdtldr search "workflow" --all` shows all matches (no limit)
- [ ] `mdtldr search "workflow" -n 50` shows up to 50 results
- [ ] `mdtldr search "workflow" --offset 10 -n 10` for pagination
- [ ] Default remains 10 for quick searches

**Effort:** Low

**Sources:** B1, B3, C1, FINAL-SYNTHESIS

---

### 6. Truncation UX Improvement

**Problem:** When output truncated, agents couldn't selectively access missing sections. Truncation note appeared at end, not clearly signaled upfront.

**Impact:** Forces over-retrieval or multiple refined searches. 50-96% reduction sometimes excessive.

**Solution:** Better truncation signaling and navigation.

**Acceptance Criteria:**
- [ ] Truncation warning appears at TOP of output: "Output truncated (showing 2000/8500 tokens). Use --full or --section to retrieve more."
- [ ] `mdtldr context file.md --full` shows complete content (no truncation)
- [ ] Truncated output shows which sections were included/excluded
- [ ] `mdtldr context file.md --sections` lists available sections for targeted retrieval

**Effort:** Medium

**Sources:** A2, B2, C2, FINAL-SYNTHESIS

---

### 7. Phrase Search with Quotes

**Problem:** No way to search for exact phrases. "context resumption" as two words found irrelevant matches.

**Impact:** Reduced precision for multi-word concepts.

**Solution:** Support quoted phrase search.

**Acceptance Criteria:**
- [ ] `mdtldr search '"context resumption"'` matches exact phrase only
- [ ] `mdtldr search '"drift-free"'` matches hyphenated terms
- [ ] Can combine with boolean: `mdtldr search '"context resumption" AND drift`
- [ ] `mdtldr search --help` documents phrase syntax

**Effort:** Medium

**Sources:** B1, B2, FINAL-SYNTHESIS

---

## P2 - Medium Priority (Nice to Have)

### 8. Cross-File Link Analysis

**Problem:** No command to find which files reference which concepts. Backlinks/links commands showed 0 for most queries.

**Impact:** Manual grep needed to understand document relationships. Particularly wanted by Strategy C agents for architectural investigation.

**Solution:** Implement concept-based cross-file analysis.

**Acceptance Criteria:**
- [ ] `mdtldr refs "Execution Context"` shows all files mentioning this concept
- [ ] `mdtldr refs --graph` outputs dependency graph (mermaid/dot format)
- [ ] `mdtldr backlinks file.md` shows files that link TO this file
- [ ] Works with markdown links `[text](file.md)` and concept mentions

**Effort:** High

**Sources:** C1, C6, FINAL-SYNTHESIS

---

### 9. Neighborhood View Around Search Results

**Problem:** Search results show isolated matches. Agents wanted to see adjacent sections for context without fetching entire file.

**Impact:** Extra context commands needed to understand match surroundings.

**Solution:** Add section-level context around search results.

**Acceptance Criteria:**
- [ ] `mdtldr search "checkpoint" --context-sections 1` shows 1 section before/after each match
- [ ] Section context clearly labeled with headers
- [ ] Works with structural and semantic search

**Effort:** Medium

**Sources:** C2, C3, FINAL-SYNTHESIS

---

### 10. Search Mode Indicator

**Problem:** Agents couldn't tell if search was using semantic or structural mode. Behavior varied based on embeddings presence.

**Impact:** Confusion about why some searches worked differently than others.

**Solution:** Always show search mode in output.

**Acceptance Criteria:**
- [ ] Search results header shows: `[semantic search]` or `[structural search]`
- [ ] If semantic attempted but embeddings missing, show: `[structural search - embeddings not found]`
- [ ] `mdtldr search --mode` flag to force mode: `--mode semantic` or `--mode structural`

**Effort:** Low

**Sources:** A2, FINAL-SYNTHESIS

---

### 11. Query Syntax Help

**Problem:** Agents had to discover search syntax through trial and error. No examples in help.

**Impact:** Wasted turns on failed queries, inconsistent usage patterns.

**Solution:** Improve search help with examples.

**Acceptance Criteria:**
- [ ] `mdtldr search --help` includes example section:
  ```
  EXAMPLES:
    mdtldr search "auth"                    # Single term (structural)
    mdtldr search "how to deploy"           # Semantic (if embeddings exist)
    mdtldr search "auth AND deploy"         # Boolean AND
    mdtldr search '"context resumption"'    # Exact phrase
    mdtldr search "impl NOT test" -C 3      # Exclude term, show context
  ```
- [ ] `mdtldr search --examples` shows extended examples with explanations

**Effort:** Low

**Sources:** B2, B3, FINAL-SYNTHESIS

---

## P3 - Low Priority (Future Enhancements)

### 12. Multi-File Glob Context

**Problem:** Agents had to run context command on each file separately for batch operations.

**Impact:** More commands needed for comprehensive extraction.

**Solution:** Support glob patterns in context command.

**Acceptance Criteria:**
- [ ] `mdtldr context "docs/**/*.md"` extracts context from all matching files
- [ ] `mdtldr context "docs/*.md" -t 5000` applies token budget across all files
- [ ] Output clearly shows which content came from which file

**Effort:** Medium

**Sources:** FINAL-SYNTHESIS

---

### 13. Saved Queries / Aliases

**Problem:** Agents repeatedly ran similar complex queries.

**Impact:** Command duplication, typo risk.

**Solution:** Allow saving common query patterns.

**Acceptance Criteria:**
- [ ] `mdtldr alias add arch-issues "search 'architecture AND (problem OR issue OR concern)'"`
- [ ] `mdtldr arch-issues` runs saved query
- [ ] Aliases stored in `.md-tldr/aliases.json`

**Effort:** Medium

**Sources:** FINAL-SYNTHESIS

---

### 14. Relevance Score Display

**Problem:** Search results showed matches but not how relevant each match was.

**Impact:** Harder to prioritize which results to investigate first.

**Solution:** Show relevance/similarity scores.

**Acceptance Criteria:**
- [ ] Semantic search shows similarity score: `[0.87] docs/ARCH.md:45 - Control Plane...`
- [ ] Results sorted by relevance by default
- [ ] `--sort recent` flag to sort by file modification time instead

**Effort:** Low-Medium

**Sources:** C1, FINAL-SYNTHESIS

---

### 15. Troubleshooting Guide

**Problem:** Agents encountered issues (0 results, truncation, embeddings) without clear resolution paths.

**Impact:** Wasted turns debugging tool behavior.

**Solution:** Add troubleshooting documentation.

**Acceptance Criteria:**
- [ ] `mdtldr troubleshoot` command shows common issues and fixes
- [ ] Covers: 0 results, embeddings setup, truncation, index staleness
- [ ] OR: Add troubleshooting section to README

**Effort:** Low

**Sources:** FINAL-SYNTHESIS

---

## Summary

| Priority | Count | Theme |
|----------|-------|-------|
| P0 Critical | 3 | Boolean search, embeddings UX, section extraction |
| P1 High | 4 | Context lines, pagination, truncation, phrases |
| P2 Medium | 4 | Cross-file analysis, neighborhood view, mode indicator, help |
| P3 Low | 4 | Glob context, aliases, relevance scores, docs |

**Total: 15 actionable tasks**

---

## Validation Sources

All tasks derived from agent feedback across three strategies:

- **Strategy A:** A1, A2, A3, A-Synth (4 agents, by-folder approach)
- **Strategy B:** B1, B2, B3, B-Synth (4 agents, by-question approach)
- **Strategy C:** C1, C2-C6, C-Synth (7 agents, two-phase approach)
- **Final Synthesis:** Cross-strategy analysis

Full reports: `/Users/alphab/Dev/LLM/DEV/TMP/memory/reports/`
