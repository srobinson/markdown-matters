# Ralph Worker - improce-cli-args

**Session:** `{{SESSION_ID}}`

## 0. Start

**Check tokens** (use skill):
- Compare against `token_threshold` in config

**Check directives** (use skill):
- Process any pending messages from orchestrator
- Archive each message after acting on it

## 1. Session History

Use your session-history skill for session continuation -- what did we work on in the previous session

## 2. Goal

Implement SPEC.md completely. Success criteria must all pass.

## Context (read in order)

1. `git log --oneline -10` - recent changes
2. `./sessions/` - previous iteration notes
3. `SPEC.md` - requirements and criteria

## 3. Work

- Break SPEC.md into discrete tasks
- Complete each task fully before moving on
- Commit progress: `ralph(improce-cli-args): <description>`
- Use parallel tool calls when possible

**Check directives periodically** - especially after completing major tasks. The orchestrator may have guidance.

## 4. Communication

**Checking for messages:**
```bash
ralph inbox
```

**Sending updates to orchestrator:**
```bash
ralph msg progress "Status update here"
ralph msg blocker "Describe what's blocking you"
ralph msg review-request "Ready for review"
```

**After processing a directive, archive it:**
```bash
ralph archive <filename>
```

## 5. Tokens

Check periodically using `skills/check-tokens/SKILL.md`.

When approaching threshold:
- **CONTINUE**: Work freely
- **WRAP_UP**: Finish current task, commit, stop
- **END_TURN**: Commit immediately, stop

## 6. Completion

**Before marking complete, verify:**
1. ALL criteria in SPEC.md are met
2. Inbox is empty (`ralph inbox` shows no pending directives)

**Only then:**
```bash
echo "done" > .ralph/tasks/improce-cli-args/COMPLETE
```

⚠️ NEVER mark complete with unread messages in your inbox.

---

# fix-token-budget

Fix critical bugs in token budget enforcement for `mdtldr context --tokens N`.

## Context

During dogfooding review, three issues were found in Phase 3 (token budget enforcement):

1. **Orphaned children bug**: If a parent section is truncated, all children are lost even if they would fit the budget
2. **Token estimation inaccuracy**: The `4 chars/token` approximation can be ±30% off, especially for code
3. **Formatting overhead under-estimated**: Hardcoded 50-token reserve is insufficient for long paths/titles

## Key Files

- `src/summarize/summarizer.ts` - Token budget enforcement, section truncation
- `src/summarize/formatters.ts` - Formatting and overhead calculation
- `src/utils/tokens.ts` - Token counting utilities

## Expected Outcome

After this task, `mdtldr context --tokens 500 file.md` should produce output that actually stays within 500 tokens, with proper handling of edge cases.
