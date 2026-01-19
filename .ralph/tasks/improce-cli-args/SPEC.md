# Task: improve-cli-args

## Goal

Replace hardcoded flag handling in `argv-preprocessor.ts` with a schema-based approach that provides clear error messages for unknown flags, including typo suggestions.

## Success Criteria

- [x] Unknown flags produce clear error: `Unknown option: -x`
- [x] Typo detection suggests correct flag: `Did you mean '--json'?`
- [x] Each command declares its own flag schema
- [x] Flags with values are correctly identified per command
- [x] Boolean flags are correctly identified per command
- [x] Existing functionality preserved (flag reordering for Effect CLI)
- [x] All existing tests pass
- [x] Tests added for unknown flag handling

## Constraints

- Schema must be per-command (not global) for accurate suggestions
- Leverage existing Effect CLI option definitions where possible
- Minimize duplication between preprocessor schema and Effect CLI definitions
- Maintain backward compatibility with current CLI behavior

## Notes

### Current Problem

```bash
mdtldr context --json docs/*.md --pretty -x 200
# Current: ENOENT: no such file or directory, open '.../-x'
# Expected: Unknown option: -x
```

The `flagsWithValues` set in `argv-preprocessor.ts` only knows about 6 flags. Unknown flags get passed through as positional args.

### Implementation Guidance

1. **Schema structure** - Define flag specs per command:
   ```typescript
   interface FlagSpec {
     type: "boolean" | "string"  // string includes integers/floats
     aliases?: string[]          // e.g., ['n'] for --limit
   }
   ```

2. **Schema location options**:
   - Co-locate with Effect CLI commands
   - Or derive from Effect CLI definitions at runtime/build time
   - Or create shared schema file that both use

3. **Typo suggestion** - Use Levenshtein distance or similar:
   - Only suggest if distance ≤ 2
   - Prefer exact prefix matches

4. **Error format**:
   ```
   Error: Unknown option '-jsno' for 'context'
   Did you mean '--json'?

   Valid options for 'context':
     --tokens, -t    Token budget
     --brief         Minimal output
     --json          Output as JSON
     ...
   ```

### Related Files

- `src/cli/argv-preprocessor.ts` - Main file to modify
- `src/cli/commands/*.ts` - Effect CLI command definitions (source of truth for options)
- `src/cli/options.ts` - Shared options
