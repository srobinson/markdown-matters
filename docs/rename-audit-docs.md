# Rename Audit: md-tldr to mdcontext

> Complete audit of all "md-tldr" and "mdtldr" references in documentation and configuration files.
> Generated: 2026-01-21

---

## Summary

| Category | Files | References | Priority High | Priority Medium | Priority Low |
|----------|-------|------------|---------------|-----------------|--------------|
| Package Config | 2 | 6 | 6 | 0 | 0 |
| README.md | 1 | 98 | 98 | 0 | 0 |
| .gitignore | 1 | 2 | 2 | 0 | 0 |
| docs/USAGE.md | 1 | 76 | 76 | 0 | 0 |
| docs/BACKLOG.md | 1 | 22 | 22 | 0 | 0 |
| docs/DESIGN.md | 1 | 28 | 0 | 28 | 0 |
| docs/ROADMAP.md | 1 | 14 | 0 | 14 | 0 |
| docs/PROJECT.md | 1 | 2 | 0 | 2 | 0 |
| docs/DOGFOODING-FINDINGS.md | 1 | 18 | 0 | 18 | 0 |
| docs/current-implementation.md | 1 | 4 | 0 | 4 | 0 |
| Research Docs | 9 | ~150 | 0 | 0 | ~150 |
| **Total** | **20** | **~420** | **204** | **66** | **~150** |

---

## HIGH PRIORITY - User-Facing & Package Identity

### 1. package.json

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/package.json`

| Line | Current Text | Suggested Replacement | Notes |
|------|--------------|----------------------|-------|
| 2 | `"name": "md-tldr"` | `"name": "mdcontext"` | npm package name |
| 9 | `"mdtldr": "./dist/cli/main.js"` | `"mdcontext": "./dist/cli/main.js"` | CLI binary name |
| 10 | `"mdtldr-mcp": "./dist/mcp/server.js"` | `"mdcontext-mcp": "./dist/mcp/server.js"` | MCP server binary |

**Additional fields to add/update:**
```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/alphab/mdcontext.git"
  },
  "homepage": "https://github.com/alphab/mdcontext#readme",
  "bugs": {
    "url": "https://github.com/alphab/mdcontext/issues"
  }
}
```

### 2. package-lock.json

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/package-lock.json`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 2 | `"name": "md-tldr"` | `"name": "mdcontext"` |
| 8 | `"name": "md-tldr"` | `"name": "mdcontext"` |
| 29 | `"mdtldr": "dist/cli/index.js"` | `"mdcontext": "dist/cli/index.js"` |

**Note:** This file is auto-generated. Running `pnpm install` after updating package.json will regenerate it.

### 3. README.md

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/README.md`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 1 | `# md-tldr` | `# mdcontext` |
| 7 | `mdtldr index [path]` | `mdcontext index [path]` |
| 8 | `mdtldr search <query> [path]` | `mdcontext search <query> [path]` |
| 9 | `mdtldr context <files...>` | `mdcontext context <files...>` |
| 10 | `mdtldr tree [path\|file]` | `mdcontext tree [path\|file]` |
| 11 | `mdtldr links <file>` | `mdcontext links <file>` |
| 12 | `mdtldr backlinks <file>` | `mdcontext backlinks <file>` |
| 13 | `mdtldr stats [path]` | `mdcontext stats [path]` |
| 22 | `md-tldr extracts *structure*` | `mdcontext extracts *structure*` |
| 25 | `npm install -g md-tldr` | `npm install -g mdcontext` |
| 26-28 | `mdtldr index .` etc. | `mdcontext index .` etc. |
| 36 | `npm install -g md-tldr` | `npm install -g mdcontext` |
| 50-55 | `mdtldr index` commands | `mdcontext index` commands |
| 63-66 | `mdtldr search` commands | `mdcontext search` commands |
| 74-75 | `mdtldr search` context lines | `mdcontext search` context lines |
| 85-90 | `mdtldr context` commands | `mdcontext context` commands |
| 98-102 | `mdtldr context` section filtering | `mdcontext context` section filtering |
| 112-114 | `mdtldr tree` commands | `mdcontext tree` commands |
| 124-125 | `mdtldr links/backlinks` | `mdcontext links/backlinks` |
| 133-134 | `mdtldr stats` | `mdcontext stats` |
| 144-146 | `mdtldr` workflow examples | `mdcontext` workflow examples |
| 152-153 | `mdtldr search` examples | `mdcontext search` examples |
| 160-161 | `mdtldr index/search` | `mdcontext index/search` |
| 173 | `"md-tldr": {` | `"mdcontext": {` |
| 174 | `"command": "mdtldr-mcp"` | `"command": "mdcontext-mcp"` |
| 186 | `"md-tldr": {` | `"mdcontext": {` |
| 187 | `"command": "mdtldr-mcp"` | `"command": "mdcontext-mcp"` |
| 208 | `Indexes are stored in \`.md-tldr/\`` | `Indexes are stored in \`.mdcontext/\`` |
| 211 | `.md-tldr/` | `.mdcontext/` |
| 229 | `md-tldr` in table | `mdcontext` |

**Total: 98 replacements**

### 4. .gitignore

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/.gitignore`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 31 | `# md-tldr indexes (local data)` | `# mdcontext indexes (local data)` |
| 32 | `.md-tldr/` | `.mdcontext/` |

### 5. BACKLOG.md (Root)

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/BACKLOG.md`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 1 | `# mdtldr Improvement Backlog` | `# mdcontext Improvement Backlog` |
| 19-22 | `mdtldr search` examples | `mdcontext search` examples |
| 39 | `Run \`mdtldr index --embed\`` | `Run \`mdcontext index --embed\`` |
| 42 | `mdtldr stats` | `mdcontext stats` |
| 59-61 | `mdtldr context` examples | `mdcontext context` examples |
| 81-82 | `mdtldr search` context lines | `mdcontext search` context lines |
| 101-103 | `mdtldr search` pagination | `mdcontext search` pagination |
| 122-124 | `mdtldr context` truncation | `mdcontext context` truncation |
| 141-144 | `mdtldr search` phrase | `mdcontext search` phrase |
| 163-165 | `mdtldr refs/backlinks` | `mdcontext refs/backlinks` |
| 183 | `mdtldr search` context sections | `mdcontext search` context sections |
| 204 | `mdtldr search --mode` | `mdcontext search --mode` |
| 221-230 | `mdtldr search --help` examples | `mdcontext search --help` examples |
| 249-250 | `mdtldr context` glob | `mdcontext context` glob |
| 268-270 | `mdtldr alias` and `.md-tldr/` | `mdcontext alias` and `.mdcontext/` |
| 306 | `mdtldr troubleshoot` | `mdcontext troubleshoot` |

**Total: 22 references across multiple lines**

### 6. docs/USAGE.md

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/USAGE.md`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 1 | `# md-tldr Usage Guide` | `# mdcontext Usage Guide` |
| 3 | `workflows for md-tldr` | `workflows for mdcontext` |
| 27 | `npm install -g md-tldr` | `npm install -g mdcontext` |
| 30 | `npx md-tldr --help` | `npx mdcontext --help` |
| 43-55 | `mdtldr` commands | `mdcontext` commands |
| 67-102 | `mdtldr index` section | `mdcontext index` section |
| 102 | `.md-tldr/indexes/` | `.mdcontext/indexes/` |
| 111-148 | `mdtldr search` section | `mdcontext search` section |
| 158-193 | `mdtldr context` section | `mdcontext context` section |
| 209-236 | `mdtldr tree` section | `mdcontext tree` section |
| 268-285 | `mdtldr links` section | `mdcontext links` section |
| 306-323 | `mdtldr backlinks` section | `mdcontext backlinks` section |
| 340-356 | `mdtldr stats` section | `mdcontext stats` section |
| 375 | `md-tldr includes an MCP server` | `mdcontext includes an MCP server` |
| 380 | `mdtldr-mcp` | `mdcontext-mcp` |
| 398-399 | MCP config `md-tldr`, `mdtldr-mcp` | `mdcontext`, `mdcontext-mcp` |
| 413-414 | MCP config `md-tldr`, `mdtldr-mcp` | `mdcontext`, `mdcontext-mcp` |
| 429-493 | All workflow examples | Replace all `mdtldr` with `mdcontext` |
| 502 | `.md-tldr/` | `.mdcontext/` |
| 505 | `.md-tldr/` | `.mdcontext/` |
| 540-550 | Error troubleshooting `mdtldr` | `mdcontext` |

**Total: 76 replacements**

---

## MEDIUM PRIORITY - Internal Documentation

### 7. docs/DESIGN.md

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/DESIGN.md`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 1 | `# Design: @hw/md-tldr` | `# Design: @hw/mdcontext` |
| 85 | `.md-tldr/` directory structure | `.mdcontext/` |
| 257-262 | `mdtldr_parse_duration_ms` etc. metrics | `mdcontext_parse_duration_ms` etc. |
| 268-272 | `mdtldr_queries_total` etc. metrics | `mdcontext_queries_total` etc. |
| 278-279 | `mdtldr_search_results_returned` etc. | `mdcontext_search_results_returned` etc. |
| 365-392 | All CLI examples | Replace `mdtldr` with `mdcontext` |

**Total: 28 references**

### 8. docs/ROADMAP.md

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/ROADMAP.md`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 1 | `# Roadmap: @hw/md-tldr` | `# Roadmap: @hw/mdcontext` |
| 91 | `.md-tldr/` | `.mdcontext/` |
| 117 | `.md-tldrignore` | `.mdcontextignore` |
| 304 | `mdtldr metrics` | `mdcontext metrics` |
| 312 | `md-tldr usable from CLI` | `mdcontext usable from CLI` |
| 316-329 | CLI command examples | Replace `mdtldr` with `mdcontext` |

**Total: 14 references**

### 9. docs/PROJECT.md

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/PROJECT.md`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 1 | `# @hw/md-tldr` | `# @hw/mdcontext` |
| 30 | `md-tldr daemon` in diagram | `mdcontext daemon` |

**Total: 2 references**

### 10. docs/DOGFOODING-FINDINGS.md

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/DOGFOODING-FINDINGS.md`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 1 | `# mdtldr Dogfooding Findings` | `# mdcontext Dogfooding Findings` |
| 4 | `using only mdtldr CLI` | `using only mdcontext CLI` |
| 11 | `YES - mdtldr is useful` | `YES - mdcontext is useful` |
| 30 | `mdtldr context --help` | `mdcontext context --help` |
| 41-147 | All command examples | Replace `mdtldr` with `mdcontext` |

**Total: 18 references**

### 11. docs/current-implementation.md

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/current-implementation.md`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 1 | `# md-tldr Semantic Search` | `# mdcontext Semantic Search` |
| 3 | `in md-tldr, covering` | `in mdcontext, covering` |
| 7 | `md-tldr provides semantic search` | `mdcontext provides semantic search` |
| 231 | `.md-tldr/` directory | `.mdcontext/` directory |

**Total: 4 references**

### 12. docs/BACKLOG.md (in docs/)

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/BACKLOG.md`

| Line | Current Text | Suggested Replacement |
|------|--------------|----------------------|
| 16 | `mdtldr context --json` | `mdcontext context --json` |

**Total: 1 reference**

---

## LOW PRIORITY - Research Documents (Historical)

These documents are research/analysis and may be kept as historical records. Consider whether to update or note they refer to the pre-rename version.

### 13. docs/research-embedding-models.md

| Line | References |
|------|------------|
| 1, 5, 27, 106, 124, 179, 189, 191, 256, 291, 305 | 11 references to `md-tldr` |

### 14. docs/research-vector-search.md

| Line | References |
|------|------------|
| 3, 160, 199, 220, 282, 288, 346, 351, 402, 408, 479, 518, 528, 539, 548, 554 | 16 references to `md-tldr` |

### 15. docs/research-rag-alternatives.md

| Line | References |
|------|------------|
| 3, 57, 164, 252, 466 | 5 references to `md-tldr` |

### 16. docs/name-research-synthesis.md

| Line | References |
|------|------------|
| 1, 10, 14, 45, 53, 57, 161, 187, 258 | 9 references to `md-tldr` |

### 17. docs/name-research-agent1.md through docs/name-research-agent5.md

Combined total: ~60 references to `md-tldr`

### 18. docs/npm-workflow-synthesis.md

| Line | References |
|------|------------|
| 1, 36, 146, 164, 418, 434 | 6 references to `md-tldr` |

### 19. docs/npm-workflow-research-agent1.md, agent2.md, agent3.md

Combined total: ~15 references

---

## Source Code References (For Reference)

These are source code references that will need to change as part of the code rename, but are not documentation/config:

### src/index.ts
- Line 2: `* md-tldr - Token-efficient markdown analysis`

### src/index/types.ts
- Line 2: `* Index data types for md-tldr`
- Line 98: `export const INDEX_DIR = '.md-tldr'`

### src/cli/main.ts
- Lines 4-17: Comment block with `mdtldr` examples
- Line 43: `Command.make('mdtldr')`
- Line 57: `name: 'mdtldr'`
- Line 137: `Run "mdtldr --help"`

### src/cli/help.ts
- Lines 27-345: Extensive help text with `mdtldr` examples (~100 references)

### src/mcp/server.ts
- Line 414: `name: 'mdtldr-mcp'`

### Other src/ files
- Multiple files with `mdtldr` in error messages, comments, and CLI output

---

## Recommended Rename Order

1. **Phase 1 - Package Identity (Critical)**
   - [ ] package.json (name, bin entries)
   - [ ] src/index/types.ts (INDEX_DIR constant)
   - [ ] Run `pnpm install` to update lockfile

2. **Phase 2 - CLI & Help System**
   - [ ] src/cli/main.ts (command name)
   - [ ] src/cli/help.ts (all examples)
   - [ ] src/mcp/server.ts (server name)

3. **Phase 3 - User-Facing Documentation**
   - [ ] README.md
   - [ ] .gitignore
   - [ ] BACKLOG.md
   - [ ] docs/USAGE.md

4. **Phase 4 - Internal Documentation**
   - [ ] docs/DESIGN.md
   - [ ] docs/ROADMAP.md
   - [ ] docs/PROJECT.md
   - [ ] docs/DOGFOODING-FINDINGS.md
   - [ ] docs/current-implementation.md

5. **Phase 5 - Research Documents (Optional)**
   - [ ] Consider adding a note at top: "Note: This document refers to the tool before its rename from md-tldr to mdcontext"
   - [ ] Or update all references

---

## Search & Replace Commands

For bulk replacement in documentation:

```bash
# Replace "md-tldr" with "mdcontext" (hyphenated form)
find . -name "*.md" -not -path "./node_modules/*" -exec sed -i '' 's/md-tldr/mdcontext/g' {} \;

# Replace "mdtldr" with "mdcontext" (CLI command form)
find . -name "*.md" -not -path "./node_modules/*" -exec sed -i '' 's/mdtldr/mdcontext/g' {} \;

# Replace ".md-tldr" with ".mdcontext" (directory name)
find . -name "*.md" -not -path "./node_modules/*" -exec sed -i '' 's/\.md-tldr/\.mdcontext/g' {} \;
```

**Note:** Review changes manually after bulk replacement to ensure accuracy.

---

## Additional Considerations

1. **npm Package Name**: Verify `mdcontext` is available on npm before rename
2. **GitHub Repository**: Rename repository from `md-tldr` to `mdcontext`
3. **GitHub Actions**: No changes needed (no hardcoded references)
4. **MCP Server Name**: Update in src/mcp/server.ts and all MCP config examples
5. **Index Directory**: The `.md-tldr` to `.mdcontext` change will require users to re-index
6. **Migration Notice**: Add deprecation notice if keeping old npm package
