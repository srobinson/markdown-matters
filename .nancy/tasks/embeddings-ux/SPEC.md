# Task: embeddings-ux

## Goal

Make semantic search world-class with proper content embedding, excellent UX, and transparent cost reporting.

## Context

**Current problems discovered:**

1. **Embeddings only capture headings** - `generateEmbeddingText()` embeds heading + parent + doc title, not actual content. This defeats the purpose of semantic search.

2. **Poor error messages** - Missing API key shows stack trace instead of actionable message.

3. **No progress feedback** - User waits blindly during embedding with no indication of progress.

4. **Silent failures** - Semantic search fails silently when embeddings don't exist.

5. **Wrong path check** - `hasEmbeddings()` checks `.tldr/embeddings.bin` but files are at `.md-tldr/vectors.bin`.

6. **Default threshold too high** - 0.5 filters out most results; typical similarity scores are 30-57%.

7. **No cost transparency** - User doesn't know cost upfront or see detailed breakdown.

**Test corpus:** `/Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-1`
- 25 documents, 1024 sections, 1004 embeddable sections
- Embedding time: 17 seconds
- Tokens: 21,475 (headings only)
- Cost: $0.00043 (headings only)

**Codebase:** `/Users/alphab/Dev/LLM/DEV/md-tldr/`

## Success Criteria

- [ ] Embeddings include full section content (not just headings)
- [ ] Clear error when OPENAI_API_KEY missing (no stack trace)
- [ ] Progress feedback during embedding (batch progress, ETA)
- [ ] Cost estimate shown before embedding (grouped by directory)
- [ ] Actual cost reported after embedding completes
- [ ] File-level progress during embedding (not batch-level)
- [ ] `--exclude` pattern support for skipping files
- [ ] Search auto-prompts to create index when missing
- [ ] Auto-index without prompt if estimated time < threshold
- [ ] Fix `hasEmbeddings()` path check
- [ ] Lower default similarity threshold to 0.3
- [ ] All existing tests pass

## Implementation

### Phase 1: Embed Full Content

**Problem:** `generateEmbeddingText()` only embeds headings.

**File:** `src/embeddings/semantic-search.ts`

**Current (lines 27-45):**
```typescript
const generateEmbeddingText = (section, documentTitle, parentHeading) => {
  const parts = [section.heading, '']
  if (parentHeading) parts.push(`Parent: ${parentHeading}`)
  parts.push(`Document: ${documentTitle}`)
  return parts.join('\n')
}
```

**Desired:**
```typescript
const generateEmbeddingText = (
  section: SectionEntry,
  content: string,
  documentTitle: string,
  parentHeading?: string
): string => {
  const parts: string[] = []
  parts.push(`# ${section.heading}`)
  if (parentHeading) parts.push(`Parent section: ${parentHeading}`)
  parts.push(`Document: ${documentTitle}`)
  parts.push('')
  parts.push(content)
  return parts.join('\n')
}
```

**Changes needed:**
1. Read file content during embedding (like `semanticSearchWithContent` does)
2. Pass content to `generateEmbeddingText()`
3. Include content in embedding text

**Impact:**
- More tokens used → higher cost (but still cheap)
- Much better semantic matching
- Queries about content (not just headings) will work

### Phase 2: Cost Estimation & Progress

**Before embedding - show preview by directory:**
```
Found 25 files to embed:
  docs/           12 files   ~$0.002
  docs.llm/        8 files   ~$0.0008
  docs.amorphic/   5 files   ~$0.0002

Total: ~150,000 tokens, ~$0.003, ~15s

Proceed? (Y/n)
```

**Exclude files via `--exclude` pattern:**
```bash
mdtldr index --embed --exclude "drafts/*,*.draft.md" /path/to/docs
```

**During embedding - show file progress:**
```
Embedding 25 files...
  [1/25] docs/01-ARCHITECTURE.md (45 sections)... done
  [2/25] docs/02-CONCEPTS.md (32 sections)... done
  ...
```

**After embedding - summary:**
```
Completed in 16.2s
  Files: 25
  Sections: 1004
  Tokens: 147,832
  Cost: $0.00296
```

**Estimation formulas:**
- Tokens: `sum(section.tokenCount)` from index (we already have this!)
- Cost: `tokens / 1,000,000 * $0.02` (text-embedding-3-small)
- Time: `ceil(sections / 100) * 1.5s`

### Phase 3: Better Error Messages

**Missing API key:**
```
Error: OPENAI_API_KEY not set

To use semantic search, set your OpenAI API key:
  export OPENAI_API_KEY=sk-...

Or add to .env file in project root.
```

**No embeddings on search:**
```
No semantic index found.

Options:
  1. Create now (recommended, ~15s, ~$0.003)
  2. Use keyword search instead

Choice [1]:
```

### Phase 4: Auto-Index Logic

**Threshold:** 10 seconds (configurable via `--auto-index-threshold`)

**Logic:**
```
if no embeddings:
  estimate = calculate_time_estimate(sections)
  if estimate < threshold:
    print("Creating semantic index (~{estimate}s)...")
    build_embeddings()
  else:
    prompt_user_with_options()
```

### Phase 5: Fix Bugs

1. **Fix `hasEmbeddings()` path:**
   - File: `src/cli/utils.ts`
   - Change: `.tldr/embeddings.bin` → `.md-tldr/vectors.bin`

2. **Lower default threshold:**
   - File: `src/embeddings/semantic-search.ts` line 235
   - Change: `threshold ?? 0` → `threshold ?? 0.3`
   - Or: Make it configurable with sensible default

## Cost Analysis

**Current (headings only):**
- 1004 sections → 21,475 tokens → $0.00043

**Projected (full content):**
- 1004 sections → ~150,000 tokens (estimate based on 203,809 total corpus tokens)
- Cost: ~$0.003 per full index
- Still extremely cheap

**text-embedding-3-small pricing:** $0.02 per 1M tokens

## Validation

```bash
# 1. Test full content embedding
rm -rf /path/to/docs/.md-tldr/vectors.*
OPENAI_API_KEY=... pnpm mdtldr index --embed /path/to/docs
# Should show progress, cost estimate, actual cost

# 2. Test semantic search quality
pnpm mdtldr search "specific content phrase" /path/to/docs
# Should find sections containing that phrase (not just headings)

# 3. Test auto-index flow
rm -rf /path/to/docs/.md-tldr/vectors.*
pnpm mdtldr search "query" /path/to/docs
# Should prompt to create index or auto-create if small corpus

# 4. Test error messages
unset OPENAI_API_KEY
pnpm mdtldr index --embed /path/to/docs
# Should show clean error, no stack trace
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/embeddings/semantic-search.ts` | Embed full content, add progress callback |
| `src/embeddings/openai-provider.ts` | Add batch progress reporting |
| `src/cli/commands/index-cmd.ts` | Show cost estimate, progress, final cost, add `--exclude` flag |
| `src/cli/commands/search-cmd.ts` | Auto-index prompt logic |
| `src/cli/utils.ts` | Fix `hasEmbeddings()` path |

## New CLI Flag

**`--exclude` (new)**

```
-x, --exclude <patterns>  Exclude files matching patterns (comma-separated globs)
```

**Examples in help text:**
```bash
mdtldr index --embed --exclude "drafts/*"           # Skip drafts folder
mdtldr index --embed --exclude "*.draft.md,tmp/*"   # Multiple patterns
```

## Documentation Updates

### Help Text (`index-cmd.ts`)

Add to OPTIONS:
```
-x, --exclude <patterns>  Exclude files matching patterns (comma-separated globs)
```

Add to EXAMPLES:
```
mdtldr index --embed --exclude "drafts/*"    # Skip specific folders
```

Update NOTES:
```
NOTES
  Embedding requires OPENAI_API_KEY environment variable.
  Cost estimate shown before embedding; actual cost shown after.
  Index is stored in .md-tldr/ directory.
```

### README.md

Add section on semantic search setup:
```markdown
## Semantic Search

Enable AI-powered semantic search by building embeddings:

\`\`\`bash
export OPENAI_API_KEY=sk-...
mdtldr index --embed ./docs
\`\`\`

Cost is minimal (~$0.003 per 1000 sections using text-embedding-3-small).

Exclude files from embedding:
\`\`\`bash
mdtldr index --embed --exclude "drafts/*,*.wip.md" ./docs
\`\`\`
```

## Open Questions

1. Should we cap content length per section to control costs? (e.g., max 500 tokens per section)
2. Should cost estimate require confirmation for large corpora? (e.g., > $0.01)
3. Should we support incremental embedding (only new/changed sections)?

## Parked Ideas

- **Interactive file selection:** Checkbox UI to select/deselect files before embedding. Parked in favor of `--exclude` patterns for now. Could add `--interactive` flag later if needed.

### Phase 6: Index Discoverability (NEW)

**Problem:** Users don't know embeddings/semantic search exist unless they read help.

**Solution:** When `mdtldr index` runs WITHOUT `--embed`, prompt user:

```
Indexed 25 documents (1024 sections)

Enable semantic search? This allows natural language queries like:
  "how does authentication work" instead of exact keyword matches

Cost: ~$0.003 for this corpus (~15 seconds)
Requires: OPENAI_API_KEY environment variable

Create semantic index? [y/N]:
```

**If user says yes:**
- Check for OPENAI_API_KEY, show setup help if missing
- Build embeddings with normal progress feedback
- Show completion message

**If user says no (or just Enter):**
- Continue silently (current behavior)

**Flag to skip prompt:** `--no-embed` explicitly skips the prompt

**Implementation:**
- File: `src/cli/commands/index-cmd.ts`
- After successful index, check if embeddings exist
- If no embeddings and not `--no-embed`, show prompt
- Use readline for interactive input (like search auto-index does)

### Phase 7: Always-On Index Feedback (NEW)

**Problem:** User doesn't know what index is being used or its state.

**Solution:** Always show index info at start of search:

```
Using index from 2024-01-21 08:56
  Sections: 1024
  Embeddings: yes (1004 vectors)

[semantic] Results: 5
  ...
```

**When embeddings exist (default to semantic):**
```
Using index from 2024-01-21 08:56
  Sections: 1024
  Embeddings: yes (1004 vectors)

[semantic] Results: 5
  ...

Tip: Use --mode keyword for exact text matching
```

**When no embeddings (structural only):**
```
Using index from 2024-01-21 08:56
  Sections: 1024
  Embeddings: no

[structural] Results: 3
  ...

Tip: Run 'mdtldr index --embed' to enable semantic search
```

**Or if no index at all:**
```
No index found.

Run: mdtldr index /path/to/docs
  Add --embed for semantic search capabilities
```

**Implementation:**
- File: `src/cli/commands/search.ts`
- Read index metadata (creation time, section count)
- Check for vectors.bin existence and count
- Display info before results
- Show tip when embeddings missing but would help

### Phase 8: Cache Hit Feedback (NEW)

**Problem:** When embeddings already exist, `index --embed` is silent about reusing cache.

**Current output:**
```
Building embeddings...
Embedded 0 sections
  Tokens used: 0
  Cost: $0.000000
```

**Better output:**
```
Embeddings already exist (1004 vectors, created 2024-01-21 08:56)
  Use --force to rebuild

Skipped embedding generation (saved ~$0.003)
```

**Or with --force:**
```
Rebuilding embeddings (--force specified)...
  [1/25] docs/01-ARCHITECTURE.md (45 sections)...
  ...
```

**Implementation:**
- File: `src/embeddings/semantic-search.ts` and `src/cli/commands/index-cmd.ts`
- When cache hit detected, return early with message
- Include: vector count, creation date, estimated cost saved
- Only show "Building embeddings..." when actually building

## New Success Criteria (Phase 6-8)

- [x] `index` without `--embed` prompts user to enable semantic search
- [x] `--no-embed` flag skips the prompt
- [x] `--no-embed` flag documented in help text and README
- [x] Search always shows index info (datetime, sections, embeddings status)
- [x] Search defaults to semantic when embeddings exist (no flag required)
- [x] Rename --mode structural → --mode keyword (and -s → -k, --structural → --keyword)
- [x] Search shows tip: "use --mode keyword for exact text matching" when using semantic
- [x] Search shows tip: "run 'mdtldr index --embed' to enable semantic search" when no embeddings
- [x] Cache hit shows clear message with vector count and date
- [x] `--force` explicitly shown when rebuilding cached embeddings

## Future: Multi-Provider Support

The `EmbeddingProvider` interface already exists, making this straightforward to add later.

**Potential providers:**
- **OpenAI** (current): text-embedding-3-small, text-embedding-3-large
- **Local/Ollama:** nomic-embed-text, mxbai-embed-large (free, private)
- **Cohere:** embed-english-v3.0
- **Voyage:** voyage-large-2

**CLI design:**
```bash
mdtldr index --embed --provider openai        # default
mdtldr index --embed --provider ollama        # local, free
mdtldr index --embed --provider ollama:nomic  # specific model
```

**Considerations:**
- Different providers have different dimensions (must match at search time)
- Local models are free but slower
- Some users want privacy (no API calls)
- Cost estimation varies by provider

**Not in scope for this task** - complete UX improvements first, then revisit.
