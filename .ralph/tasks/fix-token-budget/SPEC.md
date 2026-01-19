# Task: fix-token-budget

Fix critical issues in the Phase 3 token budget enforcement implementation discovered during code review.

## Goal

Make token budget enforcement reliable and accurate so that `mdtldr context --tokens N` actually respects the specified limit.

## Success Criteria

### Phase 1: Fix Orphaned Children Bug
- [x] Children of truncated parent sections are evaluated independently
- [x] If a child section fits the budget, it should be included even if parent was truncated
- [x] Tree structure preserved where possible, flattened where necessary
- [x] Test case: Parent (500 tokens) + Child (50 tokens) with 100 token budget → Child included

### Phase 2: Improve Token Estimation Accuracy
- [x] Token counting accounts for code blocks having different char/token ratio
- [x] Consider using actual tiktoken library for accurate counts (optional - evaluate tradeoff)
- [x] At minimum, use more conservative estimate for code-heavy content
- [x] Error margin reduced from ±30% to ±10%

### Phase 3: Fix Formatting Overhead Calculation
- [x] Dynamic overhead calculation based on actual metadata (title length, path depth, topics count)
- [x] Replace hardcoded 50-token reserve with calculated value
- [x] Overhead accounts for: title, path, token line, topics line, truncation warning, blank lines
- [x] Test with long paths and titles to verify budget not exceeded

### Phase 4: Add Budget Verification
- [x] Final output token count verified against budget
- [x] Warning if actual exceeds requested (should be rare after fixes)
- [x] Consider `--strict` flag that errors instead of warns on budget violation

## Constraints

- No breaking changes to CLI interface
- Maintain backward compatibility with existing behavior
- Performance: Token counting should not significantly slow down context generation
- If adding tiktoken dependency, make it optional (graceful fallback to approximation)

## Notes

### Orphaned Children Bug Details
Location: `src/summarize/summarizer.ts` lines 314-325

Current behavior:
```typescript
const filterSections = (sectionList) => {
  for (const section of sectionList) {
    if (includedSections.has(section.heading)) {  // Parent check only
      result.push({
        ...section,
        children: filterSections(section.children)
      })
    }
    // If parent not in set, ALL children lost regardless of tokens
  }
}
```

Fix approach: Evaluate children independently when parent excluded. May need to flatten hierarchy or include children at parent's level.

### Token Estimation Details
Location: `src/utils/tokens.ts` line 37-40

Current: `Math.ceil(text.length / 4)` - assumes 4 chars/token

Problem:
- English prose: ~4 chars/token (accurate)
- Code/punctuation: ~3 chars/token (over-estimates by 15-30%)
- Numbers/symbols: ~2.5 chars/token (over-estimates by 40%)

Options:
1. **Conservative estimate**: Use 3.5 chars/token for general, 3 for code blocks
2. **tiktoken integration**: Add optional dependency for exact counts
3. **Hybrid**: Use tiktoken if available, fallback to conservative estimate

### Formatting Overhead Details
Location: `src/summarize/formatters.ts` lines 64-85

Current: Hardcoded 50-token reserve

Real overhead components:
| Component | Tokens | Variable? |
|-----------|--------|-----------|
| Title line | 5-15 | Yes (title length) |
| Path line | 8-25 | Yes (path depth) |
| Token line | ~8 | Slightly |
| Topics line | 10-30 | Yes (topic count) |
| Truncation warning | ~6 | Only if truncated |
| Blank lines | 2-5 | No |
| **Total** | 40-90 | **Highly** |

Fix: Calculate overhead dynamically before allocating content budget.

## Reference

- Original dogfooding findings: `docs/DOGFOODING-FINDINGS.md`
- Phase 3 implementation: `src/summarize/summarizer.ts`, `src/summarize/formatters.ts`
- Token counting: `src/utils/tokens.ts`
- Review findings: Subagent review from dogfooding task
