# Rename Audit: Storage and Data Paths

**Audit Date:** 2026-01-21
**Current Name:** md-tldr / .md-tldr
**Target Name:** mdcontext / .mdcontext
**Scope:** Data storage, file paths, and user-facing storage locations

---

## Executive Summary

This audit identifies all storage-related references to "md-tldr" and "mdtldr" that need consideration when renaming to "mdcontext". The primary concern is **backwards compatibility** - users may have existing `.md-tldr/` directories in their projects containing indexes and embeddings.

### Key Findings

| Category | Count | Breaking Change Risk |
|----------|-------|---------------------|
| Directory constant (INDEX_DIR) | 1 | **HIGH** |
| Hardcoded path references | 6 | **HIGH** |
| Documentation references | 20+ | Low |
| Planned features (.md-tldrignore) | 2 | Low |
| Test assertions | 1 | Low |

---

## Critical Findings (Breaking Changes)

### 1. INDEX_DIR Constant

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/src/index/types.ts`
**Line:** 98

```typescript
export const INDEX_DIR = '.md-tldr'
```

**Current Behavior:**
- All indexes stored in `.md-tldr/` directory
- Used by `getIndexPaths()` function to construct all storage paths
- Creates directory structure: `.md-tldr/indexes/`, `.md-tldr/cache/`, `.md-tldr/cache/parsed/`

**Breaking Change Assessment:** **HIGH**
- Existing user projects have `.md-tldr/` directories with indexed data
- Changing this breaks all existing installations immediately
- Users would need to re-index after rename

**Suggested Approach:** Migration with backwards compatibility

```typescript
export const INDEX_DIR = '.mdcontext'
export const LEGACY_INDEX_DIR = '.md-tldr'  // For migration support
```

**Migration Strategy:**
1. On startup, check if `.md-tldr/` exists but `.mdcontext/` does not
2. If legacy exists, prompt user: "Found legacy .md-tldr/ directory. Migrate to .mdcontext/? [Y/n]"
3. If yes, rename directory atomically
4. If no, continue using legacy path (deprecation warning)
5. Add `--migrate` flag to index command for explicit migration

---

### 2. getIndexPaths Function

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/src/index/types.ts`
**Lines:** 101-109

```typescript
export const getIndexPaths = (rootPath: string) => ({
  root: `${rootPath}/${INDEX_DIR}`,
  config: `${rootPath}/${INDEX_DIR}/config.json`,
  documents: `${rootPath}/${INDEX_DIR}/indexes/documents.json`,
  sections: `${rootPath}/${INDEX_DIR}/indexes/sections.json`,
  links: `${rootPath}/${INDEX_DIR}/indexes/links.json`,
  cache: `${rootPath}/${INDEX_DIR}/cache`,
  parsed: `${rootPath}/${INDEX_DIR}/cache/parsed`,
})
```

**Current Behavior:**
- Derives all storage paths from INDEX_DIR constant
- Used by storage.ts and indexer.ts

**Breaking Change Assessment:** **HIGH** (same as #1, resolved by fixing INDEX_DIR)

**Suggested Approach:** No change needed if INDEX_DIR is updated correctly. Function uses the constant.

---

### 3. Vector Storage Paths

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/src/embeddings/vector-store.ts`
**Lines:** 16-17, 75-84

```typescript
const VECTOR_INDEX_FILE = 'vectors.bin'
const VECTOR_META_FILE = 'vectors.meta.json'

// Uses INDEX_DIR from types.ts:
private getIndexDir(): string {
  return path.join(this.rootPath, INDEX_DIR)
}
```

**Current Behavior:**
- Stores `vectors.bin` and `vectors.meta.json` in `.md-tldr/`
- Files contain expensive embeddings (API cost to regenerate)

**Breaking Change Assessment:** **HIGH**
- Embeddings are expensive to regenerate ($0.02/1M tokens)
- Users should not lose embeddings on rename

**Suggested Approach:** Same migration as INDEX_DIR. Files will be preserved if directory is renamed.

---

### 4. CLI Utils Hardcoded Paths

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/src/cli/utils.ts`
**Lines:** 62, 83-84

```typescript
const vectorsPath = path.join(dir, '.md-tldr', 'vectors.bin')
// ...
const sectionsPath = path.join(dir, '.md-tldr', 'indexes', 'sections.json')
const vectorsMetaPath = path.join(dir, '.md-tldr', 'vectors.meta.json')
```

**Current Behavior:**
- Hardcoded paths for checking embeddings existence
- Used by `hasEmbeddings()` and `getIndexInfo()` functions

**Breaking Change Assessment:** **HIGH**
- These bypass the INDEX_DIR constant
- Must be updated to use the constant or a shared path function

**Suggested Approach:** Refactor to use INDEX_DIR constant

```typescript
import { INDEX_DIR } from '../index/types.js'

const vectorsPath = path.join(dir, INDEX_DIR, 'vectors.bin')
const sectionsPath = path.join(dir, INDEX_DIR, 'indexes', 'sections.json')
const vectorsMetaPath = path.join(dir, INDEX_DIR, 'vectors.meta.json')
```

---

## Medium Priority Findings

### 5. .gitignore Entry

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/.gitignore`
**Lines:** 31-32

```
# md-tldr indexes (local data)
.md-tldr/
```

**Current Behavior:**
- Ignores .md-tldr/ directory from git

**Breaking Change Assessment:** **LOW** (project-level, not user-facing)

**Suggested Approach:** Update comment and pattern

```
# mdcontext indexes (local data)
.mdcontext/
```

**Note:** Users with existing projects should update their own .gitignore files if they've committed it.

---

### 6. Test Assertion

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/src/cli/cli.test.ts`
**Line:** 101

```typescript
expect(indexHelp).toContain('.md-tldr')
```

**Current Behavior:**
- Verifies help text mentions storage location

**Breaking Change Assessment:** **LOW** (internal test)

**Suggested Approach:** Update test to expect new directory name

```typescript
expect(indexHelp).toContain('.mdcontext')
```

---

### 7. Help Text Storage Reference

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/src/cli/help.ts`
**Line:** 56

```typescript
'Index is stored in .md-tldr/ directory.',
```

**Current Behavior:**
- User-facing help text describing storage location

**Breaking Change Assessment:** **LOW** (documentation only)

**Suggested Approach:** Update to new name

```typescript
'Index is stored in .mdcontext/ directory.',
```

---

## Low Priority Findings (Documentation Only)

### 8. README.md Storage Documentation

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/README.md`
**Lines:** 208-211

```markdown
Indexes are stored in `.md-tldr/` in your project root:

.md-tldr/
```

**Suggested Approach:** Update all references to `.mdcontext/`

---

### 9. docs/USAGE.md Storage Documentation

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/USAGE.md`
**Lines:** 102, 502-505

```markdown
**Index location:** `.md-tldr/indexes/`

By default, indexes are stored in `.md-tldr/` in your project root:

.md-tldr/
```

**Suggested Approach:** Update all references to `.mdcontext/`

---

### 10. docs/DESIGN.md Architecture Diagram

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/DESIGN.md`
**Line:** 85

```markdown
.md-tldr/
```

**Suggested Approach:** Update diagram

---

### 11. docs/current-implementation.md

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/current-implementation.md`
**Line:** 231

```markdown
Located in `.md-tldr/` directory:
```

**Suggested Approach:** Update reference

---

### 12. docs/ROADMAP.md FileMdStore Reference

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/ROADMAP.md`
**Line:** 91

```markdown
- `FileMdStore` (JSON files in `.md-tldr/`)
```

**Suggested Approach:** Update reference

---

## Planned Features (Not Yet Implemented)

### 13. .md-tldrignore Support (Planned)

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/docs/ROADMAP.md`
**Line:** 117

```markdown
- `.md-tldrignore` support
```

**Current Behavior:** Not implemented yet

**Suggested Approach:**
- Implement as `.mdcontextignore`
- Add fallback to check for `.md-tldrignore` for backwards compatibility during transition

---

### 14. aliases.json (Planned)

**File:** `/Users/alphab/Dev/LLM/DEV/md-tldr/BACKLOG.md`
**Line:** 270

```markdown
- [ ] Aliases stored in `.md-tldr/aliases.json`
```

**Current Behavior:** Not implemented yet

**Suggested Approach:** Implement with new path: `.mdcontext/aliases.json`

---

## Migration Strategy

### Phase 1: Prepare for Dual-Path Support

1. Extract INDEX_DIR usage into a function that checks both paths:

```typescript
export const getEffectiveIndexDir = async (rootPath: string): Promise<string> => {
  const newPath = path.join(rootPath, '.mdcontext')
  const legacyPath = path.join(rootPath, '.md-tldr')

  // Prefer new path if exists
  if (await pathExists(newPath)) {
    return '.mdcontext'
  }

  // Fall back to legacy if exists
  if (await pathExists(legacyPath)) {
    return '.md-tldr'
  }

  // Default to new path for fresh installations
  return '.mdcontext'
}
```

### Phase 2: Add Migration Command

```bash
mdcontext migrate
```

- Renames `.md-tldr/` to `.mdcontext/`
- Updates any internal path references in stored JSON files
- Outputs success message with instructions to update .gitignore

### Phase 3: Deprecation Warnings

When using legacy `.md-tldr/` path:

```
Warning: Using legacy .md-tldr/ directory. Run 'mdcontext migrate' to update.
```

### Phase 4: Remove Legacy Support (Future Version)

After sufficient deprecation period (e.g., 6 months / 2 major versions):
- Remove fallback path checking
- Update documentation to remove legacy references

---

## Implementation Checklist

### Must Change (Breaking)

- [ ] `src/index/types.ts`: Update INDEX_DIR constant
- [ ] `src/cli/utils.ts`: Replace hardcoded '.md-tldr' paths with INDEX_DIR
- [ ] Add migration utility function
- [ ] Add `--migrate` flag or `migrate` command

### Should Change (User-Facing)

- [ ] `src/cli/help.ts`: Update help text
- [ ] `.gitignore`: Update pattern

### Documentation Updates

- [ ] `README.md`: Update storage location references
- [ ] `docs/USAGE.md`: Update storage location references
- [ ] `docs/DESIGN.md`: Update architecture diagram
- [ ] `docs/current-implementation.md`: Update storage references
- [ ] `docs/ROADMAP.md`: Update FileMdStore reference

### Test Updates

- [ ] `src/cli/cli.test.ts`: Update assertion for .mdcontext

### Future Features

- [ ] Implement `.mdcontextignore` (with `.md-tldrignore` fallback)
- [ ] Implement `aliases.json` with new path

---

## Risk Assessment Summary

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Users lose existing indexes | High without migration | High | Implement auto-migration |
| Users lose embeddings | High without migration | Very High | Preserve during migration |
| Confusion during transition | Medium | Low | Clear deprecation warnings |
| Old tutorials/docs outdated | Medium | Low | Update all docs, add notes |

---

## Recommendation

**Recommended Approach: Gradual Migration**

1. **v2.0**: Introduce `.mdcontext/` as default, with automatic detection and use of legacy `.md-tldr/`
2. **v2.0**: Add `migrate` command for explicit migration
3. **v2.0**: Show deprecation warning when using legacy path
4. **v2.x**: Continue supporting both paths
5. **v3.0**: Remove legacy support, require explicit migration

This approach ensures:
- Zero data loss for existing users
- Smooth transition period
- Clear communication of the change
- Eventual cleanup of legacy code
