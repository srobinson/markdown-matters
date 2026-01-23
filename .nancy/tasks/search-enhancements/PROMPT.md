# Ralph Worker - {{TASK_NAME}}

**Session:** `{{SESSION_ID}}`

## 1. Initiate

**Check tokens** (use skill):
- Compare against `token_threshold` in config

**Check directives** (use skill):
- Process any pending messages from orchestrator
- Archive each message after acting on it

## 2. Goal

Implement SPEC.md completely. Success criteria must all pass.

## Context  (read ALL before starting work)

1. `SPEC.md` - requirements and success criteria (READ FIRST)
2. `git log --format=full -10` - recent changes
3. `SPEC.md` - requirements and criteria

## 3. Work Loop

- Break SPEC.md/phase into discrete tasks
- Complete each task -- do not be concerned if you cannot complete task fully before token threshold
- Commit progress: `ralph({{TASK_NAME}}): <detailed_description>`
- Use parallel tool calls when possible

**Check directives periodically**. The orchestrator may have guidance.

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
echo "done" > .ralph/tasks/{{TASK_NAME}}/COMPLETE
```

⚠️ NEVER mark complete with unread messages in your inbox.
