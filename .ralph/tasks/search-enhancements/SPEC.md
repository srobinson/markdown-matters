# Task: search-enhancements

## Goal

Enhance the `mdtldr search` command with boolean operators, phrase search, mode indicators, and better help documentation.

## Context

Validation experiment with 11 AI agents identified search query limitations as the #1 pain point. Agents couldn't express complex queries like "architecture AND criticism" or exact phrases like "context resumption".

**Codebase location:** `/Users/alphab/Dev/LLM/DEV/md-tldr/`

## Success Criteria

- [ ] Boolean AND/OR/NOT operators work in search queries
- [ ] Quoted phrases match exactly
- [ ] Search output shows mode indicator (semantic vs structural)
- [ ] `--help` includes comprehensive examples
- [ ] All existing tests pass
- [ ] New tests cover boolean/phrase functionality

## Phases

### Phase 1: Boolean Operators (P0 Critical)

**Problem:** `mdtldr search "auth AND criticism"` returns 0 results even when both terms exist.

**Implementation:**
1. Locate search query parsing logic (likely in `src/`)
2. Add tokenizer for AND/OR/NOT operators
3. For AND: filter results to include all terms
4. For OR: union results from each term
5. For NOT: exclude results containing term
6. Handle operator precedence (NOT > AND > OR)

**Acceptance:**
```bash
mdtldr search "auth AND criticism"        # Both terms required
mdtldr search "checkpoint OR gate"        # Either term matches
mdtldr search "implementation NOT example" # Exclude "example"
mdtldr search "auth AND (error OR bug)"   # Grouped expressions
```

**Tests to add:**
- Boolean AND returns intersection
- Boolean OR returns union
- Boolean NOT excludes matches
- Mixed operators respect precedence
- Case insensitivity for operators

---

### Phase 2: Phrase Search (P1 High)

**Problem:** No way to search for exact multi-word phrases.

**Implementation:**
1. Detect quoted strings in query: `"exact phrase"`
2. Treat quoted content as single search unit
3. Match phrases in content (not just individual words)
4. Allow combining with boolean: `"context resumption" AND drift`

**Acceptance:**
```bash
mdtldr search '"context resumption"'      # Exact phrase only
mdtldr search '"drift-free"'              # Hyphenated terms
mdtldr search '"memory model" AND event'  # Phrase + boolean
```

**Tests to add:**
- Quoted phrases match exactly
- Phrases with special chars (hyphens, apostrophes)
- Phrases combined with boolean operators

---

### Phase 3: Search Mode Indicator (P2 Medium)

**Problem:** Agents couldn't tell if search used semantic or structural mode.

**Implementation:**
1. Detect current search mode (check embeddings existence)
2. Add mode indicator to search output header
3. Add `--mode` flag to force specific mode

**Acceptance:**
```bash
mdtldr search "auth"
# Output shows: [structural search] or [semantic search]

mdtldr search "auth" --mode semantic
# Forces semantic (errors if no embeddings)

mdtldr search "auth" --mode structural
# Forces structural (ignores embeddings)
```

**Tests to add:**
- Mode indicator appears in output
- `--mode` flag overrides auto-detection
- Error message when forcing semantic without embeddings

---

### Phase 4: Query Syntax Help (P2 Medium)

**Problem:** No examples in `--help` showing search capabilities.

**Implementation:**
1. Expand `search --help` with examples section
2. Add `--examples` flag for extended examples
3. Document all operators and syntax

**Acceptance:**
```bash
mdtldr search --help
# Shows:
# EXAMPLES:
#   mdtldr search "auth"                    # Single term
#   mdtldr search "auth AND deploy"         # Boolean AND
#   mdtldr search "auth OR login"           # Boolean OR
#   mdtldr search "impl NOT test"           # Boolean NOT
#   mdtldr search '"context resumption"'    # Exact phrase
#   mdtldr search "auth" --mode structural  # Force mode
```

---

## Technical Notes

- Check existing search implementation in `src/commands/search.ts` (or similar)
- Boolean parsing may benefit from a small expression parser
- Maintain backward compatibility (single terms still work)
- Consider performance: boolean may require multiple index queries

## Validation

After implementation, re-run a mini validation:
```bash
cd /Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-1
mdtldr search "architecture AND criticism"
mdtldr search '"context resumption"'
mdtldr search "checkpoint NOT example" --mode structural
```

Confirm these return meaningful results.

## References

- BACKLOG.md items: #1, #7, #10, #11
- Agent feedback: B1, B2, B3, C3, FINAL-SYNTHESIS
