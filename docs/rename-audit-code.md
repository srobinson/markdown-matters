# Code Rename Audit: md-tldr to mdcontext

This document catalogs all code references to "md-tldr", "mdtldr", and related variants that need to change when renaming the project to "mdcontext".

## Summary

| Category | High Priority | Medium Priority | Low Priority | Total |
|----------|---------------|-----------------|--------------|-------|
| Package/Binary | 5 | 1 | 0 | 6 |
| CLI Commands | 3 | 120+ | 0 | 123+ |
| Source Code | 12 | 8 | 4 | 24 |
| Error Messages | 18 | 0 | 0 | 18 |
| Index Directory | 8 | 0 | 0 | 8 |
| Comments | 0 | 0 | 11 | 11 |
| **TOTAL** | **46** | **129+** | **15** | **190+** |

---

## HIGH PRIORITY: Core Identity Changes

### 1. Package Identity (package.json)

| File | Line | Current | Suggested | Priority |
|------|------|---------|-----------|----------|
| `/Users/alphab/Dev/LLM/DEV/md-tldr/package.json` | 2 | `"name": "md-tldr"` | `"name": "mdcontext"` | HIGH |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/package.json` | 9 | `"mdtldr": "./dist/cli/main.js"` | `"mdcontext": "./dist/cli/main.js"` | HIGH |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/package.json` | 10 | `"mdtldr-mcp": "./dist/mcp/server.js"` | `"mdcontext-mcp": "./dist/mcp/server.js"` | HIGH |

### 2. package-lock.json

| File | Line | Current | Suggested | Priority |
|------|------|---------|-----------|----------|
| `/Users/alphab/Dev/LLM/DEV/md-tldr/package-lock.json` | 2 | `"name": "md-tldr"` | `"name": "mdcontext"` | HIGH |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/package-lock.json` | 8 | `"name": "md-tldr"` | `"name": "mdcontext"` | HIGH |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/package-lock.json` | 29 | `"mdtldr": "dist/cli/index.js"` | `"mdcontext": "dist/cli/index.js"` | HIGH |

### 3. Index Directory Constant

| File | Line | Current | Suggested | Priority |
|------|------|---------|-----------|----------|
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/index/types.ts` | 98 | `export const INDEX_DIR = '.md-tldr'` | `export const INDEX_DIR = '.mdcontext'` | HIGH |

This constant is used throughout the codebase for index storage paths.

### 4. CLI Command Name

| File | Line | Current | Suggested | Priority |
|------|------|---------|-----------|----------|
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/cli/main.ts` | 43 | `Command.make('mdtldr')` | `Command.make('mdcontext')` | HIGH |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/cli/main.ts` | 57 | `name: 'mdtldr'` | `name: 'mdcontext'` | HIGH |

### 5. MCP Server Name

| File | Line | Current | Suggested | Priority |
|------|------|---------|-----------|----------|
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/mcp/server.ts` | 414 | `name: 'mdtldr-mcp'` | `name: 'mdcontext-mcp'` | HIGH |

---

## HIGH PRIORITY: Error Messages (User-Facing)

These error messages tell users what commands to run. All must be updated.

### src/cli/main.ts

| Line | Current | Suggested |
|------|---------|-----------|
| 137 | `console.error('\nRun "mdtldr --help" for usage information.')` | `console.error('\nRun "mdcontext --help" for usage information.')` |

### src/cli/argv-preprocessor.ts

| Line | Current | Suggested |
|------|---------|-----------|
| 92 | `console.error('\nRun "mdtldr <command> --help" for usage information.')` | `console.error('\nRun "mdcontext <command> --help" for usage information.')` |

### src/cli/commands/search.ts

| Line | Current | Suggested |
|------|---------|-----------|
| 125 | `yield* Console.log('Run: mdtldr index /path/to/docs')` | `yield* Console.log('Run: mdcontext index /path/to/docs')` |
| 293 | `yield* Console.log("Tip: Run 'mdtldr index --embed' to enable semantic search")` | `yield* Console.log("Tip: Run 'mdcontext index --embed' to enable semantic search")` |
| 367 | `yield* Console.error('Run "mdtldr index --embed" first.')` | `yield* Console.error('Run "mdcontext index --embed" first.')` |

### src/cli/commands/stats.ts

| Line | Current | Suggested |
|------|---------|-----------|
| 57 | `yield* Console.log("Run 'mdtldr index <path>' to create an index.")` | `yield* Console.log("Run 'mdcontext index <path>' to create an index.")` |
| 141 | `"    Run 'mdtldr index --embed' to build embeddings."` | `"    Run 'mdcontext index --embed' to build embeddings."` |

### src/cli/commands/context.ts

| Line | Current | Suggested |
|------|---------|-----------|
| 72 | `'At least one file is required. Usage: mdtldr context <file> [files...]'` | `'At least one file is required. Usage: mdcontext context <file> [files...]'` |

### src/search/searcher.ts

| Line | Current | Suggested |
|------|---------|-----------|
| 486 | `new Error("Index not found. Run 'mdtldr index' first.")` | `new Error("Index not found. Run 'mdcontext index' first.")` |

### src/embeddings/semantic-search.ts

| Line | Current | Suggested |
|------|---------|-----------|
| 83 | `new Error("Index not found. Run 'mdtldr index' first.")` | `new Error("Index not found. Run 'mdcontext index' first.")` |
| 196 | `new Error("Index not found. Run 'mdtldr index' first.")` | `new Error("Index not found. Run 'mdcontext index' first.")` |
| 422 | `new Error("Embeddings not found. Run 'mdtldr embed' first.")` | `new Error("Embeddings not found. Run 'mdcontext embed' first.")` |

---

## HIGH PRIORITY: CLI Help System

The help system has extensive references to `mdtldr`. These must all be updated.

### src/cli/help.ts

| Line | Current | Suggested | Priority |
|------|---------|-----------|----------|
| 2 | `* Custom help system for mdtldr CLI` | `* Custom help system for mdcontext CLI` | LOW (comment) |
| 27 | `usage: 'mdtldr index [path] [options]'` | `usage: 'mdcontext index [path] [options]'` | HIGH |
| 29-34 | All `mdtldr index` examples | All `mdcontext index` examples | HIGH |
| 56 | `'Index is stored in .md-tldr/ directory.'` | `'Index is stored in .mdcontext/ directory.'` | HIGH |
| 61 | `usage: 'mdtldr search [options] <query> [path]'` | `usage: 'mdcontext search [options] <query> [path]'` | HIGH |
| 63-78 | All `mdtldr search` examples | All `mdcontext search` examples | HIGH |
| 122 | `'Run "mdtldr index --embed" first for semantic search.'` | `'Run "mdcontext index --embed" first for semantic search.'` | HIGH |
| 127 | `usage: 'mdtldr context [options] <files>...'` | `usage: 'mdcontext context [options] <files>...'` | HIGH |
| 129-141 | All `mdtldr context` examples | All `mdcontext context` examples | HIGH |
| 180 | `usage: 'mdtldr tree [path] [options]'` | `usage: 'mdcontext tree [path] [options]'` | HIGH |
| 182-185 | All `mdtldr tree` examples | All `mdcontext tree` examples | HIGH |
| 198 | `usage: 'mdtldr links <file> [options]'` | `usage: 'mdcontext links <file> [options]'` | HIGH |
| 200-202 | All `mdtldr links` examples | All `mdcontext links` examples | HIGH |
| 215 | `usage: 'mdtldr backlinks <file> [options]'` | `usage: 'mdcontext backlinks <file> [options]'` | HIGH |
| 217-219 | All `mdtldr backlinks` examples | All `mdcontext backlinks` examples | HIGH |
| 229 | `'Requires index to exist. Run "mdtldr index" first.'` | `'Requires index to exist. Run "mdcontext index" first.'` | HIGH |
| 233 | `usage: 'mdtldr stats [path] [options]'` | `usage: 'mdcontext stats [path] [options]'` | HIGH |
| 235-237 | All `mdtldr stats` examples | All `mdcontext stats` examples | HIGH |
| 258 | `console.log('Run "mdtldr --help" for available commands.')` | `console.log('Run "mdcontext --help" for available commands.')` | HIGH |
| 263 | `console.log(\`\n\x1b[1mmdtldr ${command}\x1b[0m ...` | `console.log(\`\n\x1b[1mmdcontext ${command}\x1b[0m ...` | HIGH |
| 299 | `\x1b[1mmdtldr\x1b[0m - Token-efficient markdown analysis for LLMs` | `\x1b[1mmdcontext\x1b[0m - Token-efficient markdown analysis for LLMs` | HIGH |
| 311-337 | All `mdtldr` examples in workflows section | All `mdcontext` examples | HIGH |
| 345 | `Run \x1b[36mmdtldr <command> --help\x1b[0m ...` | `Run \x1b[36mmdcontext <command> --help\x1b[0m ...` | HIGH |
| 355 | Comment about `mdtldr <cmd> --help` pattern | Update to `mdcontext <cmd> --help` | LOW (comment) |

**Total in help.ts: ~100+ occurrences of `mdtldr`**

---

## MEDIUM PRIORITY: Hardcoded Index Paths

These use the `.md-tldr` directory path directly instead of using the `INDEX_DIR` constant.

### src/cli/utils.ts

| Line | Current | Suggested | Priority |
|------|---------|-----------|----------|
| 62 | `path.join(dir, '.md-tldr', 'vectors.bin')` | Use `INDEX_DIR` constant or update to `.mdcontext` | MEDIUM |
| 83 | `path.join(dir, '.md-tldr', 'indexes', 'sections.json')` | Use `INDEX_DIR` constant or update to `.mdcontext` | MEDIUM |
| 84 | `path.join(dir, '.md-tldr', 'vectors.meta.json')` | Use `INDEX_DIR` constant or update to `.mdcontext` | MEDIUM |

**Recommendation:** Refactor these to use the `INDEX_DIR` constant from `src/index/types.ts` for single source of truth.

---

## MEDIUM PRIORITY: Test Files

### src/cli/cli.test.ts

| Line | Current | Suggested | Priority |
|------|---------|-----------|----------|
| 2 | `* E2E tests for mdtldr CLI commands` | `* E2E tests for mdcontext CLI commands` | LOW (comment) |
| 10 | `const CLI = 'pnpm mdtldr'` | `const CLI = 'pnpm mdcontext'` | HIGH |
| 32 | `describe('mdtldr CLI e2e', () => {` | `describe('mdcontext CLI e2e', () => {` | MEDIUM |
| 70 | `expect(output).toContain(\`mdtldr ${cmd}\`)` | `expect(output).toContain(\`mdcontext ${cmd}\`)` | MEDIUM |
| 101 | `expect(indexHelp).toContain('.md-tldr')` | `expect(indexHelp).toContain('.mdcontext')` | MEDIUM |

### src/cli/argv-preprocessor.test.ts

| Line | Current | Suggested | Priority |
|------|---------|-----------|----------|
| 10 | `const script = '/path/to/mdtldr'` | `const script = '/path/to/mdcontext'` | MEDIUM |

---

## LOW PRIORITY: File Header Comments

These are module documentation comments that reference the old name.

| File | Line | Current | Suggested |
|------|------|---------|-----------|
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/index.ts` | 2 | `* md-tldr - Token-efficient markdown analysis for LLMs` | `* mdcontext - Token-efficient markdown analysis for LLMs` |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/index/types.ts` | 2 | `* Index data types for md-tldr` | `* Index data types for mdcontext` |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/core/types.ts` | 2 | `* Core data types for md-tldr` | `* Core data types for mdcontext` |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/cli/main.ts` | 4 | `* md-tldr CLI - Token-efficient markdown analysis` | `* mdcontext CLI - Token-efficient markdown analysis` |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/mcp/server.ts` | 4 | `* MCP Server for md-tldr` | `* MCP Server for mdcontext` |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/search/query-parser.ts` | 2 | `* Query Parser for md-tldr search` | `* Query Parser for mdcontext search` |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/search/searcher.ts` | 2 | `* Keyword search for md-tldr` | `* Keyword search for mdcontext` |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/embeddings/types.ts` | 2 | `* Embedding types for md-tldr` | `* Embedding types for mdcontext` |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/summarize/summarizer.ts` | 2 | `* Summarization engine for md-tldr` | `* Summarization engine for mdcontext` |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/cli/help.ts` | 2 | `* Custom help system for mdtldr CLI` | `* Custom help system for mdcontext CLI` |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/src/cli/cli.test.ts` | 2 | `* E2E tests for mdtldr CLI commands` | `* E2E tests for mdcontext CLI commands` |

---

## Configuration Files

### .gitignore

| File | Line | Current | Suggested | Priority |
|------|------|---------|-----------|----------|
| `/Users/alphab/Dev/LLM/DEV/md-tldr/.gitignore` | 31 | `# md-tldr indexes (local data)` | `# mdcontext indexes (local data)` | LOW (comment) |
| `/Users/alphab/Dev/LLM/DEV/md-tldr/.gitignore` | 32 | `.md-tldr/` | `.mdcontext/` | HIGH |

---

## Documentation Files (Not covered in this audit)

The following files contain documentation references that will need separate handling:

- `README.md` - Extensive command examples
- `BACKLOG.md` - Future feature examples using CLI
- `docs/USAGE.md` - Complete usage guide
- `docs/DESIGN.md` - Architecture docs
- `docs/ROADMAP.md` - Future CLI commands
- `docs/*.md` - Various research and project docs
- `digest.txt` - Generated digest of all files

These contain 500+ references to `md-tldr`/`mdtldr` across examples, usage guides, and documentation.

---

## Underscore Variant: md_tldr

Found in documentation only (metrics/telemetry naming):

| File | Line | Current | Notes |
|------|------|---------|-------|
| `docs/ROADMAP.md` | 279-293 | `md_tldr_query_duration_ms`, etc. | Future metrics names |
| `docs/DESIGN.md` | 257-279 | `mdtldr_*` metric names | Design doc metrics |

**Recommendation:** Update to `mdcontext_*` when implementing metrics.

---

## Migration Checklist

### Phase 1: Core Identity (Must Do First)
- [ ] Update `package.json` name and bin entries
- [ ] Update `package-lock.json`
- [ ] Update `INDEX_DIR` constant in `src/index/types.ts`
- [ ] Update CLI command name in `src/cli/main.ts`
- [ ] Update MCP server name in `src/mcp/server.ts`
- [ ] Update `.gitignore` for new index directory name

### Phase 2: Error Messages (User-Facing)
- [ ] Update all error messages in `src/cli/commands/*.ts`
- [ ] Update error messages in `src/search/searcher.ts`
- [ ] Update error messages in `src/embeddings/semantic-search.ts`
- [ ] Update error messages in `src/cli/argv-preprocessor.ts`

### Phase 3: Help System
- [ ] Bulk replace `mdtldr` with `mdcontext` in `src/cli/help.ts`
- [ ] Update `.md-tldr` references to `.mdcontext` in help notes

### Phase 4: Tests
- [ ] Update CLI constant in `src/cli/cli.test.ts`
- [ ] Update test descriptions and assertions
- [ ] Update `src/cli/argv-preprocessor.test.ts`

### Phase 5: Code Cleanup
- [ ] Update hardcoded paths in `src/cli/utils.ts` to use `INDEX_DIR` constant
- [ ] Update file header comments across all source files

### Phase 6: Documentation (Separate Task)
- [ ] Update README.md
- [ ] Update BACKLOG.md
- [ ] Update docs/*.md files
- [ ] Regenerate digest.txt

---

## Search Commands Used

```bash
# Find all references
grep -rn "md-tldr" --include="*.ts" --include="*.json"
grep -rn "mdtldr" --include="*.ts" --include="*.json"
grep -rn "md_tldr" --include="*.ts" --include="*.md"
grep -rn "MDTLDR" --include="*.ts" --include="*.md"
grep -rn "MD-TLDR" --include="*.ts" --include="*.md"
grep -rn "MdTldr" --include="*.ts" --include="*.md"
```

Results:
- `md-tldr`: 307 matches (many in docs/digest.txt)
- `mdtldr`: 520+ matches (CLI commands in help/examples)
- `md_tldr`: 12 matches (metrics names in ROADMAP.md, DESIGN.md)
- `MDTLDR`: 0 matches
- `MD-TLDR`: 0 matches
- `MdTldr`: 0 matches
