# Task: embeddings-ux

## Goal

Improve the embeddings/semantic search UX with graceful fallback messaging and clear status indicators.

## Context

Agent A2 in validation experiment was confused when semantic searches returned 0 results with no explanation. The tool silently fell back to structural search (or failed) without indicating embeddings weren't available.

**Codebase location:** `/Users/alphab/Dev/LLM/DEV/md-tldr/`

## Success Criteria

- [ ] Search shows clear message when embeddings unavailable
- [ ] `mdtldr stats` shows embeddings status
- [ ] Graceful fallback from semantic to structural with explanation
- [ ] All existing tests pass
- [ ] New tests cover embeddings status detection

## Implementation

### Single Phase: Graceful Embeddings Fallback (P0 Critical)

**Problem:** Semantic searches silently failed or returned 0 results when embeddings weren't built.

**Current behavior (assumed):**
- User runs `mdtldr search "how to deploy"` expecting semantic search
- No embeddings exist
- Returns 0 results or falls back silently
- User confused about why it didn't work

**Desired behavior:**
1. Detect if embeddings exist in index
2. If semantic search attempted without embeddings:
   - Show clear message explaining the situation
   - Fall back to structural search
   - Indicate which mode was used
3. Add embeddings status to `mdtldr stats`

**Implementation steps:**

1. **Add embeddings detection function**
   ```typescript
   function hasEmbeddings(indexPath: string): boolean {
     // Check if embeddings file/data exists in .md-tldr/
   }
   ```

2. **Update search command fallback logic**
   ```typescript
   if (isSemanticQuery(query) && !hasEmbeddings(indexPath)) {
     console.log("ℹ️  Semantic search unavailable (no embeddings).");
     console.log("   Using structural search instead.");
     console.log("   Run 'mdtldr index --embed' to enable semantic search.\n");
     // Fall back to structural search
   }
   ```

3. **Add embeddings status to stats command**
   ```bash
   mdtldr stats
   # Output includes:
   # Embeddings: No (run 'mdtldr index --embed' to enable)
   # -- or --
   # Embeddings: Yes (1024 sections indexed)
   ```

4. **Add search mode to output header**
   ```bash
   mdtldr search "how to deploy"
   # [structural search - embeddings not found]
   # Results:
   # ...
   ```

**Acceptance:**
```bash
# Without embeddings:
mdtldr search "how to deploy"
# Output:
# ℹ️  Semantic search unavailable (no embeddings).
#    Using structural search instead.
#    Run 'mdtldr index --embed' to enable semantic search.
#
# [structural search]
# Results:
# ...

# Stats shows embeddings status:
mdtldr stats
# Files: 25
# Sections: 1024
# Tokens: 156,000
# Embeddings: No (run 'mdtldr index --embed' to enable)

# After building embeddings:
mdtldr index --embed
mdtldr stats
# Embeddings: Yes (1024 sections)

mdtldr search "how to deploy"
# [semantic search]
# Results:
# ...
```

**Tests to add:**
- Fallback message appears when no embeddings
- Stats shows embeddings status correctly
- Search mode indicator reflects actual mode used
- Fallback still returns useful structural results
- No message when embeddings exist and semantic search works

---

## Technical Notes

- Embeddings likely stored in `.md-tldr/` directory
- Check for embeddings file/database presence
- May need to handle partial embeddings (some files embedded, some not)
- Keep fallback message concise but actionable

## Edge Cases

1. **Partial embeddings:** Some files embedded, others not
   - Show: "Embeddings: Partial (500/1024 sections). Re-run 'mdtldr index --embed' to complete."

2. **Stale embeddings:** Files changed since embeddings built
   - Show: "Embeddings: Stale (index modified). Run 'mdtldr index --embed --force' to refresh."

3. **Embeddings in progress:** Large corpus being indexed
   - This is likely not applicable (sync operation), but consider if relevant

## Validation

After implementation:
```bash
# Test without embeddings
rm -rf /Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-1/.md-tldr
mdtldr index /Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-1
mdtldr stats /Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-1
mdtldr search "how to deploy" /Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-1

# Test with embeddings
mdtldr index --embed /Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-1
mdtldr stats /Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-1
mdtldr search "how to deploy" /Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-1
```

## References

- BACKLOG.md item: #2
- Agent feedback: A2, FINAL-SYNTHESIS
