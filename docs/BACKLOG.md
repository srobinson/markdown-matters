# Backlog

Ideas and improvements to revisit later.

---

## CLI: Schema-Based Argv Preprocessor

**Date:** 2025-01-19
**Priority:** Medium
**Context:** Current `argv-preprocessor.ts` uses hardcoded flag lists which breaks on unknown flags.

### Problem

```bash
mdm context --json docs/*.md --pretty -x 200
# Error: ENOENT: no such file or directory, open '.../-x'
```

Unknown flags like `-x` get passed through as positional args (file paths) instead of being rejected with a clear error.

### Proposed Solution

Replace hardcoded `flagsWithValues` set with a schema-based approach:

```typescript
interface FlagSpec {
  type: "boolean" | "string";
}

const schema: Record<string, FlagSpec> = {
  "--json": { type: "boolean" },
  "--output": { type: "string" },
};

function parse(argv: string[], schema: Record<string, FlagSpec>) {
  const options: Record<string, any> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("-")) {
      const spec = schema[arg];
      if (!spec) throw new Error(`Unknown option: ${arg}`);
      if (spec.type === "boolean") {
        options[arg] = true;
      } else {
        const value = argv[i + 1];
        if (!value || value.startsWith("-")) {
          throw new Error(`Missing value for option: ${arg}`);
        }
        options[arg] = value;
        i++;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { options, positionals };
}
```

### Benefits

1. **Clear errors** - "Unknown option: -x" instead of cryptic file errors
2. **Single source of truth** - Schema can align with Effect CLI definitions
3. **Per-command schemas** - Each command declares its own flags
4. **Maintainable** - Adding flags = adding to schema, not hunting through code

### Implementation Notes

- Could extract schema from existing Effect CLI option definitions
- Or define shared schema that both preprocessor and CLI use
- Consider generating schema from CLI definitions at build time

### Related Files

- `src/cli/argv-preprocessor.ts` - Current implementation
- `src/cli/commands/*.ts` - Effect CLI command definitions
- `src/cli/options.ts` - Shared options
