# Task: world-class-help

## Goal

Create world-class subcommand help that matches the quality of the main help. Every `mdtldr <command> --help` should be beautiful, useful, and copy-pasteable.

**Current problem:** Effect CLI generates verbose, unhelpful help:
- "A true or false value" (useless)
- "This setting is optional" repeated twice
- No examples
- No context about when to use options

**Target:** Subcommand help that's as good as `git <cmd> --help` or `gh <cmd> --help`.

## Design

Each subcommand help should have:
1. **One-liner** - What it does
2. **Usage** - Clean syntax
3. **Examples** - 3-5 copy-pasteable examples
4. **Options** - Compact table or list (no boilerplate)
5. **Notes** - When relevant (tips, gotchas)

### Example: `mdtldr index --help`

```
mdtldr index - Index markdown files for fast searching

USAGE
  mdtldr index [path] [options]

EXAMPLES
  mdtldr index                    # Index current directory
  mdtldr index docs/              # Index specific directory
  mdtldr index --embed            # Include semantic embeddings
  mdtldr index --watch            # Watch for file changes
  mdtldr index --embed --watch    # Full setup with live updates

OPTIONS
  -e, --embed     Build semantic embeddings (enables AI-powered search)
  -w, --watch     Watch for changes and re-index automatically
  --force         Rebuild from scratch, ignoring cache
  --json          Output results as JSON
  --pretty        Pretty-print JSON output

NOTES
  First run downloads embedding model (~80MB) if --embed is used.
  Index is stored in .tldr/ directory.
```

## Success Criteria

### Phase 1: Custom Help System
- [x] Create help handler that intercepts `<cmd> --help`
- [x] Define help content structure (description, usage, examples, options, notes)
- [x] Implement colored output matching main help style

### Phase 2: All Subcommand Help
- [x] `index --help` - Clean help with embedding/watch examples
- [x] `search --help` - Structural vs semantic, result limiting
- [x] `context --help` - Token budgets, multi-file, output formats
- [x] `tree --help` - Directory vs file modes
- [x] `links --help` - Simple, clear
- [x] `backlinks --help` - Simple, clear
- [x] `stats --help` - Simple, clear

### Phase 3: Polish
- [x] Consistent formatting across all commands
- [x] All examples actually work (verified)
- [x] Tests for help output content
- [x] No Effect CLI boilerplate visible anywhere

### Phase 4: Documentation Alignment
- [x] README.md quick reference matches actual commands/flags
- [x] README.md examples align with new help examples
- [x] docs/USAGE.md aligned with help content
- [x] All documented flags/options are accurate
- [x] MCP tools section reflects current capabilities

### Phase 5: Token Counting & Summarizer Cleanup
- [x] Fix token counting in assembleContext (lines 331-332, 351-356) - count formatted output not pre-format
- [x] Fix misleading token display in formatSummary (line 268)
- [x] Extract formatting functions to src/summarize/formatters.ts
- [x] Extract magic numbers to named constants (MIN_SENTENCE_LENGTH, TOKENS_PER_SENTENCE_ESTIMATE, etc.)
- [x] Add tests verifying token counts match actual output length

## Implementation Notes

### Approach Options

1. **Intercept before Effect CLI** (recommended)
   - Check for `<cmd> --help` pattern in argv
   - Show custom help and exit
   - Simple, no Effect CLI changes needed

2. **Custom HelpDoc renderer**
   - Effect CLI supports custom renderers
   - More complex but more integrated

### Help Content Location

Store help content as data, not inline strings:
```typescript
const helpContent: Record<string, CommandHelp> = {
  index: {
    description: 'Index markdown files for fast searching',
    usage: 'mdtldr index [path] [options]',
    examples: [...],
    options: [...],
    notes: [...]
  },
  // ...
}
```

## Constraints

- Keep Effect CLI for actual command execution (just override help)
- Match visual style of main help (colors, spacing)
- Examples must be real, working commands
- No placeholder text like "A true or false value"

## Definition of Done

- All 7 subcommands have beautiful custom help
- All examples in help are verified working
- Tests confirm help content is present
- No Effect CLI boilerplate visible to users

---

_Created: 2025-01-19_
