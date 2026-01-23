# Task: refactor-cli-structure

## Goal

Refactor the CLI module for better organization, maintainability, and UX. Address three key issues:
1. `index.ts` should only be for barrel exports, not implementation
2. Flags must come before positional args (annoying UX limitation)
3. 725-line monolithic file should be split into logical modules

## Success Criteria

### Phase 1: File Renaming
- [ ] Rename `src/cli/index.ts` → `src/cli/main.ts`
- [ ] Create new `src/cli/index.ts` as barrel export
- [ ] Update `package.json` bin path to `./dist/cli/main.js`
- [ ] Update build script entry point
- [ ] Tests pass

### Phase 2: Flexible Flag Positioning
- [ ] Create `src/cli/argv-preprocessor.ts` to rearrange args
- [ ] Preprocessor moves options before positional args
- [ ] Handle options with values (--limit 5) vs boolean flags (--json)
- [ ] Handle --option=value syntax
- [ ] Integrate into main.ts before CLI parsing
- [ ] Add tests for flexible flag positioning (`search "query" --limit 5` works)

### Phase 3: Split Commands
- [ ] Create `src/cli/options.ts` - shared options (json, pretty, force)
- [ ] Create `src/cli/utils.ts` - helpers (formatJson, walkDir, isMarkdownFile, etc.)
- [ ] Create `src/cli/commands/` directory
- [ ] Extract `index-cmd.ts` (index command)
- [ ] Extract `search.ts`
- [ ] Extract `context.ts`
- [ ] Extract `tree.ts`
- [ ] Extract `links.ts`
- [ ] Extract `backlinks.ts`
- [ ] Extract `stats.ts`
- [ ] Create `src/cli/commands/index.ts` barrel export
- [ ] Update `src/cli/index.ts` to re-export from commands
- [ ] All imports use `./commands` not individual files
- [ ] Tests pass

### Phase 4: Polish
- [ ] Consistent imports across all command files
- [ ] No circular dependencies
- [ ] Build succeeds
- [ ] All 68 tests pass

## Implementation Notes

### Argv Preprocessor Logic

```typescript
// Input:  ['search', 'query', '--limit', '5', 'path']
// Output: ['search', '--limit', '5', 'query', 'path']

const optionsWithValues = new Set([
  '--limit', '-n',
  '--tokens', '-t',
  '--threshold',
  '--root', '-r',
])
```

### Target Structure

```
src/cli/
├── index.ts              # Barrel: export * from './commands'
├── main.ts               # Entry point (renamed from index.ts)
├── argv-preprocessor.ts  # Flexible flag positioning
├── options.ts            # Shared options (json, pretty, force)
├── utils.ts              # Helpers
├── help.ts               # Existing custom help
├── commands/
│   ├── index.ts          # Barrel: export all commands
│   ├── index-cmd.ts      # Index command (can't use index.ts)
│   ├── search.ts
│   ├── context.ts
│   ├── tree.ts
│   ├── links.ts
│   ├── backlinks.ts
│   └── stats.ts
└── cli.test.ts
```

### Barrel Export Pattern

`src/cli/commands/index.ts`:
```typescript
export { indexCommand } from './index-cmd.js'
export { searchCommand } from './search.js'
export { contextCommand } from './context.js'
export { treeCommand } from './tree.js'
export { linksCommand } from './links.js'
export { backlinksCommand } from './backlinks.js'
export { statsCommand } from './stats.js'
```

`src/cli/index.ts`:
```typescript
export * from './commands/index.js'
export { formatJson, walkDir, isMarkdownFile } from './utils.js'
export { preprocessArgv } from './argv-preprocessor.js'
```

## Constraints

- Keep Effect CLI for command execution
- Don't break existing tests
- Use `.js` extensions in imports (NodeNext resolution)
- Command file for `index` must be `index-cmd.ts` (not `index.ts`)

## Definition of Done

- All commands in separate files under `commands/`
- Barrel exports work: `import { searchCommand } from './commands'`
- Flexible flag positioning: `mdtldr search "query" --limit 5` works
- All 68 tests pass
- Build succeeds

---

_Created: 2025-01-19_
