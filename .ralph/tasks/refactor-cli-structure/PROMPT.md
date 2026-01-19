# CLI Structure Refactoring

Refactor the CLI module from a monolithic 725-line file into a well-organized modular structure.

## Key Requirements

1. **Rename index.ts** - It should only be for barrel exports
2. **Flexible flags** - Allow `cmd arg --flag` not just `cmd --flag arg`
3. **Split commands** - Each command in its own file

## Priority Order

1. Phase 1 first (renaming) - quick win, low risk
2. Phase 2 (flexible flags) - highest UX impact
3. Phase 3 (split commands) - maintainability
4. Phase 4 (polish) - cleanup

## Critical Files

- `src/cli/index.ts` - Current monolith (rename to main.ts)
- `src/cli/help.ts` - May need import updates
- `package.json` - Update bin path and build script
- `src/cli/cli.test.ts` - Add tests for flexible flags

## Testing

Run `pnpm test` after each phase. All 68 tests must pass.
