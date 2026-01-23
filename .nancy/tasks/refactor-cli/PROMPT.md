# Ralph Worker - refactor-cli

**Session:** `{{SESSION_ID}}`

## 0. Start

**Check tokens AND directives** (use both skills):
```bash
"$RALPH_FRAMEWORK_ROOT/skills/check-tokens/check-tokens.sh"
ralph inbox
```

## 1. Determine Current Phase

Read SPEC.md and check which phase to work on:

| Phase | Focus | Done when |
|-------|-------|-----------|
| 1 | Command Consolidation | All commands refactored, tests pass |
| 2 | Help & Error Messages | Clean help output, friendly errors |
| 3 | Documentation | README + docs/USAGE.md updated |
| 4 | Quality & Polish | All checks pass, ready to ship |

**RULE: Complete ONE phase per turn, then stop.**

Check progress:
```bash
grep -E "^\s*- \[.\]" .ralph/tasks/refactor-cli/SPEC.md
```

## 2. Work on Current Phase

1. Read SPEC.md success criteria for your phase
2. Implement ALL criteria for that phase
3. Run `npm run check` and `npm run test`
4. Commit: `ralph(refactor-cli): phase N - description`
5. Mark criteria as `[x]` in SPEC.md
6. **STOP** - do not start next phase

**Check tokens AND directives periodically:**
```bash
"$RALPH_FRAMEWORK_ROOT/skills/check-tokens/check-tokens.sh"
ralph inbox
```

## 3. End of Turn

After completing your phase:

1. Send progress update:
```bash
ralph msg progress "Phase N complete: <summary>"
```

2. Check tokens - if WRAP_UP or END_TURN, stop immediately

3. **Do NOT start the next phase** - let the loop create a new iteration

## 4. Communication

```bash
ralph inbox                           # Check for directives
ralph msg progress "Status update"    # Send progress
ralph msg blocker "What's blocking"   # Report blockers
ralph archive <filename>              # Archive processed messages
```

## 5. Completion

**Only mark COMPLETE when ALL 4 phases are done:**
```bash
# Verify all phases complete
grep -c "\- \[x\]" .ralph/tasks/refactor-cli/SPEC.md  # Should be ~20

# Then mark complete
echo "done" > .ralph/tasks/refactor-cli/COMPLETE
```

---

**Remember: ONE PHASE PER TURN. Commit, report, stop.**
