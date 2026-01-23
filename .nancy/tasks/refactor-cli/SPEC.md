# Task: refactor-cli

## Goal

Refactor md-tldr CLI from 13 complex commands to 7 simple commands with intuitive positional arguments.

**Current problem:** API is too complex for everyday use. Required flags (`-f`, `-q`), inconsistent naming, split functionality.

**Target:** Simple, memorable commands that follow llm-tldr patterns.

## Simplified API

### Before → After

| Old (complex) | New (simple) |
|---------------|--------------|
| `mdtldr index -d .` | `mdtldr index` |
| `mdtldr embed -r .` | `mdtldr index --embed` |
| `mdtldr semantic -q "query"` | `mdtldr search "query"` |
| `mdtldr search --heading "X"` | `mdtldr search -s "X"` |
| `mdtldr context -f file.md` | `mdtldr context file.md` |
| `mdtldr summarize -f file.md` | `mdtldr context file.md` |
| `mdtldr assemble -s "a,b"` | `mdtldr context a.md b.md` |
| `mdtldr tree -d .` | `mdtldr tree` |
| `mdtldr structure -f file.md` | `mdtldr tree file.md` |
| `mdtldr parse -f file.md` | (removed) |
| `mdtldr links -f file.md` | `mdtldr links file.md` |
| `mdtldr backlinks -f file.md` | `mdtldr backlinks file.md` |
| `mdtldr stats -r .` | `mdtldr stats` |

### New Command Reference

```
CORE COMMANDS (memorize these 4)
  mdtldr index [path]           Index markdown files (default: .)
  mdtldr search <query> [path]  Search by meaning or structure
  mdtldr context <files...>     Get LLM-ready summary
  mdtldr tree [path|file]       Show files or document outline

OPTIONS
  mdtldr index --embed          Also build semantic embeddings
  mdtldr index --watch          Watch for changes
  mdtldr search -s "pattern"    Structural search (heading regex)
  mdtldr search -n 5            Limit results
  mdtldr context -t 500         Token budget
  mdtldr context --brief        Minimal output
  mdtldr context --full         Include full content

LINK ANALYSIS
  mdtldr links <file>           What does this link to?
  mdtldr backlinks <file>       What links to this?

INSPECTION
  mdtldr stats [path]           Index statistics
```

## Success Criteria

### Phase 1: Command Consolidation
- [x] `index` accepts positional path, `--embed` flag (merges `embed`)
- [x] `search` accepts positional query, auto-detects semantic vs structural
- [x] `context` accepts positional files (multiple), merges `summarize` and `assemble`
- [x] `tree` auto-detects: directory → file list, file → document outline (merges `structure`)
- [x] `parse` command removed
- [x] All tests updated and passing

### Phase 2: Help & Error Messages
- [x] `mdtldr --help` shows clean, minimal output (not Effect boilerplate)
- [x] Each command has clear 1-line description
- [x] Error messages are human-friendly, not stack traces
- [x] Missing argument errors show usage example
- [x] `--version` works

### Phase 3: Documentation
- [x] README.md rewritten with new API (follow llm-tldr style)
- [x] docs/USAGE.md updated with new commands
- [x] All command examples in docs actually work
- [x] Quick reference card at top of README

### Phase 4: Quality & Polish
- [x] `npm run check` passes
- [x] `npm run test` passes (all tests updated for new API)
- [x] No console.log debugging left
- [x] Collocated tests for any new code
- [x] `pnpm link --global` and test from different directory

## Constraints

- **One turn per phase** - Each phase must complete in a single iteration
- **Backward compat optional** - Old flags can be removed (breaking change is OK)
- **Keep core logic** - Only refactor CLI layer, not parser/indexer/search internals
- **Effect stays** - Keep using Effect for error handling

## Implementation Notes

### CLI Framework
Current: Effect CLI (`@effect/cli`)
Keep it, but simplify the command definitions.

### Auto-Detection Logic for `search`
```typescript
// If embeddings exist AND query is natural language → semantic
// If query has regex chars OR --struct flag → structural
const isStructural = opts.struct || /[.*+?^${}()|[\]\\]/.test(query)
```

### Auto-Detection Logic for `tree`
```typescript
// If path is file → show document outline
// If path is directory → show file list
const stat = fs.statSync(path)
if (stat.isFile()) showOutline(path)
else showFileList(path)
```

### Multi-File Context
```typescript
// Accept glob patterns and multiple files
mdtldr context README.md docs/*.md CONTRIBUTING.md -t 2000
// Internally calls assembleContext with token budget
```

## Definition of Done

Each phase is complete when:
1. All success criteria for that phase checked off
2. `npm run check` passes
3. `npm run test` passes
4. Changes committed with descriptive message

Task is COMPLETE when all 4 phases pass.

---

_Created: 2025-01-19_
