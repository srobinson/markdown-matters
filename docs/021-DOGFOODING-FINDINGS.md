# mdm Dogfooding Findings

**Date:** 2025-01-19
**Method:** 6 autonomous agents explored documentation directories using only mdm CLI
**Target directories:** `./docs`, `./doc.llm`, `./docs.amorphic` (in `/Users/alphab/Dev/LLM/DEV/TMP/ralph`)

---

## Executive Summary

**Verdict: YES - mdm is useful**, with the `context` command being the standout feature delivering 80-99% token reduction. However, several issues limit the tool's effectiveness for discovery workflows.

---

## What Works Well

### 1. Context Command (Killer Feature)

- Consistently achieved 80-99% token reduction across all test directories
- Multi-file assembly with budget allocation works as designed
- `--brief` mode effective for quick overviews
- JSON output useful for programmatic consumption

### 2. Tree Command

- Excellent for initial codebase discovery
- Clean hierarchical output
- Good starting point before diving into specific files

### 3. Help System

- Well-polished with examples
- Subcommand help (`mdm context --help`) informative
- Agents successfully learned the tool from `--help` alone

---

## Issues Found

### Critical: `index` Command Returns "0 Documents"

**Symptom:**

```bash
mdm index ./docs
# Output: "Indexed: 0 documents"
```

**Expected:** Should index markdown files in the directory.

**Impact:** Breaks the discovery workflow. Users can't find content without working index.

**Frequency:** Inconsistent - sometimes works, sometimes doesn't.

---

### High: `search` Only Matches Headings

**Symptom:**

```bash
mdm search "authentication" ./docs
# Returns: Only matches if "authentication" appears in a heading
```

**Expected:** Search should find content anywhere in documents.

**Impact:** Major limitation for discovery. Users searching for concepts/keywords get no results if those words aren't in headings.

**Note:** Full semantic search requires an embedding provider (OpenAI, Ollama, LM Studio, or OpenRouter) + `--embed` flag. See [CONFIG.md](./CONFIG.md) for free local options. Structural search should at least search content.

---

### Medium: Token Budget Sometimes Exceeded

**Symptom:**

```bash
mdm context --tokens 500 --brief file.md
# Output may exceed 500 tokens
```

**Expected:** Output should respect token budget.

**Impact:** Unpredictable context sizes when assembling for LLM consumption.

---

### Low: `stats` Command Minimal Without Embeddings

**Symptom:**

```bash
mdm stats ./docs
# Shows basic counts only
```

**Impact:** Limited usefulness without embeddings enabled.

---

## Recommendations

### P0 - Fix Index Command

The "0 documents" issue breaks the primary discovery workflow. Investigate:

- Directory path resolution
- File extension filtering
- Silent failures in indexing process

### P1 - Expand Structural Search

Make structural search (`--structural` or default without embeddings) search document content, not just headings:

- Full-text regex matching
- Content snippet in results
- Line number references

### P2 - Enforce Token Budgets

Ensure `--tokens` flag is respected:

- Truncate output if necessary
- Warn user if content exceeds budget
- Consider separate flags for hard vs soft limits

### P3 - Improve Stats Without Embeddings

Show useful stats even without embeddings:

- Document count, total tokens, avg tokens/doc
- Section depth analysis
- File size distribution

---

## Test Matrix

| Agent   | Directory       | Commands Used          | Verdict                         |
| ------- | --------------- | ---------------------- | ------------------------------- |
| a3caa1b | ./docs          | tree, context, search  | YES with caveats                |
| a199309 | ./docs          | tree, context, index   | YES - context justifies tool    |
| a7857e0 | ./docs          | help, context, tree    | YES - direction is good         |
| a71de5c | ./doc.llm       | index, search, context | Partially - search/index issues |
| a4ec1e1 | ./docs (ralph)  | tree, context, stats   | YES - solves real problem       |
| a96ff96 | ./docs.amorphic | tree, context, index   | YES - context is valuable       |

---

## Raw Findings Summary

### What Agents Tried That Failed

1. `mdm index <dir>` → "0 documents"
2. `mdm search "keyword" <dir>` → No results (keyword in content, not heading)
3. `mdm stats <dir>` → Minimal output without embeddings

### What Agents Found Valuable

1. `mdm context --brief file.md` → Instant useful summary
2. `mdm tree <dir>` → Quick structure overview
3. `mdm context file1.md file2.md --tokens 1000` → Multi-file assembly
4. `mdm --help` / `mdm <cmd> --help` → Self-discovery worked

---

## Suggested Task Scope

A follow-up task should address:

1. **Index reliability** - Debug why index returns 0 documents
2. **Content search** - Extend structural search beyond headings
3. **Budget enforcement** - Ensure token limits are respected
4. **Error messages** - Surface why operations "silently fail"
