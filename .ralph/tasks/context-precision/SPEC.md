# Task: context-precision

## Goal

Enhance the `mdtldr context` command with section-level extraction, context lines around matches, and improved truncation UX.

## Context

Validation experiment found agents wasting tokens on full-file context when they only needed specific sections. Truncation behavior was confusing with no way to navigate to missing content.

**Codebase location:** `/Users/alphab/Dev/LLM/DEV/md-tldr/`

## Success Criteria

- [ ] Can extract context for specific sections by name or number
- [ ] Search results can show context lines around matches (-C flag)
- [ ] Truncation warning appears at TOP of output with actionable guidance
- [ ] `--sections` flag lists available sections for targeted retrieval
- [ ] All existing tests pass
- [ ] New tests cover section extraction and context lines

## Phases

### Phase 1: Section-Level Context Extraction (P0 Critical)

**Problem:** `mdtldr context file.md` returns entire file. Agents wanted "just Section 5.3".

**Implementation:**
1. Parse markdown heading structure to build section map
2. Add `--section` flag to filter by section name/number
3. Support glob patterns for section names
4. Include nested subsections by default, add `--shallow` for top-level only

**Acceptance:**
```bash
mdtldr context file.md --section "Memory Model"
# Returns only the "Memory Model" section and its subsections

mdtldr context file.md --section "5.3"
# Returns section numbered 5.3

mdtldr context file.md --section "Memory*"
# Returns all sections starting with "Memory"

mdtldr context file.md --section "Memory Model" --shallow
# Returns only top-level, no nested subsections

mdtldr context file.md --sections
# Lists available sections:
# 1. Introduction
# 2. Architecture
#    2.1 Memory Model
#    2.2 Execution Model
# ...
```

**Tests to add:**
- Section by exact name
- Section by number
- Section by glob pattern
- Shallow vs deep extraction
- `--sections` listing

---

### Phase 2: Context Lines Around Search Results (P1 High)

**Problem:** Search results show line numbers but no surrounding context. Hard to evaluate relevance.

**Implementation:**
1. Add `-C`, `-B`, `-A` flags to search command (like grep)
2. `-C N`: N lines before AND after match
3. `-B N`: N lines before match
4. `-A N`: N lines after match
5. Clearly delineate match lines from context lines

**Acceptance:**
```bash
mdtldr search "checkpoint" -C 3
# Shows:
#   docs/ARCH.md:42
#     39: previous line
#     40: another line
#     41: context before
#   > 42: checkpoint is the key concept
#     43: context after
#     44: another line
#     45: more context

mdtldr search "checkpoint" -B 2 -A 5
# 2 lines before, 5 lines after

mdtldr search "checkpoint" -C 3 --json
# JSON output includes context lines array
```

**Tests to add:**
- Context lines appear correctly
- -B and -A work independently
- -C is shorthand for -B N -A N
- JSON output includes context
- Context doesn't cross file boundaries

---

### Phase 3: Truncation UX Improvement (P1 High)

**Problem:** Truncation note appeared at END of output. Agents didn't know content was missing until they'd already processed it.

**Implementation:**
1. Move truncation warning to TOP of output
2. Show what percentage/sections were included
3. Add `--full` flag to disable truncation
4. Show actionable guidance in truncation message

**Acceptance:**
```bash
mdtldr context large-file.md -t 2000
# Output:
# ⚠️ Truncated: Showing 2000/8500 tokens (24%)
# Sections included: 1, 2, 3.1
# Sections excluded: 3.2, 4, 5, 6
# Use --full for complete content or --section to target specific sections.
#
# --- Content starts here ---
# ...

mdtldr context large-file.md --full
# Shows complete content, no truncation

mdtldr context large-file.md -t 2000 --json
# JSON includes truncation metadata:
# { "truncated": true, "tokens_shown": 2000, "tokens_total": 8500, ... }
```

**Tests to add:**
- Warning appears at top
- Sections included/excluded listed
- `--full` disables truncation
- JSON includes truncation metadata

---

## Technical Notes

- Section parsing likely uses markdown heading detection (# ## ###)
- Consider caching section map for repeated queries
- Context lines feature touches search command, not just context
- Token counting should use existing tokenizer

## Validation

After implementation, test with real docs:
```bash
cd /Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-1
mdtldr context docs/05-MEMORY_MODEL.md --section "Event Memory"
mdtldr context docs/05-MEMORY_MODEL.md --sections
mdtldr search "checkpoint" -C 3
mdtldr context docs/01-ARCHITECTURE.md -t 1000  # Check truncation UX
```

## References

- BACKLOG.md items: #3, #4, #6
- Agent feedback: A1, A2, B2, C2, C4, FINAL-SYNTHESIS
