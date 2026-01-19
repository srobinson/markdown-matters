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
