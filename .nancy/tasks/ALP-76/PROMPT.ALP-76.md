# ALP-76: Consolidated Error Handling

**Session:** `nancy-ALP-76-iter2`

## Description

Comprehensive refactoring of mdcontext error handling to follow Effect best practices. The codebase has significant issues:

1. **Type Safety Loss**: Error info lost by converting to generic `Error` objects
2. **Mixed Paradigms**: Three different error patterns used inconsistently
3. **Silent Failures**: Multiple `catchAll(() => succeed(null))` swallowing errors
4. **Presentation Mixed with Logic**: Error formatting embedded in business logic
5. **Constructor Throws**: `OpenAIProvider` constructor throws, bypassing Effect

**Impact**: Silent failures, difficult debugging, type system can't catch errors at compile time.

## Acceptance Criteria

- [ ] All domain errors use `Data.TaggedError` in centralized module
- [ ] No silent error swallowing - all errors logged or handled explicitly
- [ ] Error presentation only at CLI boundary
- [ ] `catchTag` pattern used for exhaustive error handling
- [ ] Tests verify error type discrimination works

## Context

Full analysis in:

* `research/effect-errors-as-values.md`
* `research/mdcontext-error-analysis.md`
* `research/errors-task-analysis/*.md`

## 0. Working Environment

PROJECT_ROOT: {{NANCY_PROJECT_ROOT}}

- You are working in a git worktree at: /Users/alphab/Dev/LLM/DEV/mdcontext/../nancy-ALP-76
- Branch: nancy/ALP-76
- Main repo remains on 'main' branch at: /Users/alphab/Dev/LLM/DEV/mdcontext
- All your commits stay isolated to this worktree
- Push with: git push -u origin nancy/ALP-76

Use `git log --format=full -10`
 to understand recent changes and context

## 1. Goal

1. Implement all issues `/Users/alphab/Dev/LLM/DEV/mdcontext/.nancy/tasks/ALP-76/ISSUES.md` completely.
2. All Success criteria must all pass.

## 2. Work Loop

0. Select issue to work on in list order
1. Use linear-server - get_issue (MCP)(id: ISSUE_ID): Ingest issue
2. Use linear-server - update_issue (MCP)(id: ISSUE_ID): Update state -> "In Progress"
3. Work each task

IMPORTANT
- Use parallel tool calls whenever possible
- Use your tokens wisely :> spawn subagents whenever possible

## 3. Completing an issue

1. Mark complete with an [X] /Users/alphab/Dev/LLM/DEV/mdcontext/.nancy/tasks/ALP-76/ISSUES.md
2. Use linear-server - update_issue (MCP)(id: ISSUE_ID) to change state to "Worker Done"
3. Commit progress: `nancy[ISSUE_ID]: <detailed_description>`

## 3. Communication

If you have any questions, need more information, get stuck, report status, or to respond to the Orchestrator, use the following protocol:

```bash
nancy msg <msg_type> <message> <priority>

echo "Usage: nancy msg <type> <message> <priority>"
echo ""
echo "Types: blocker, progress, review-request"
echo "Priority: urgent, normal, low (default: normal)"

# For example:
nancy msg progress "Status update here"
nancy msg blocker "Describe what's blocking you"
nancy msg review-request "Ready for review"
```

## 4. Completion

**Before marking complete, verify:**
1. ALL issues are implemented and tested
2. Inbox is empty (`nancy inbox` shows no pending directives)

**Only then:**
```bash
echo "done" > /Users/alphab/Dev/LLM/DEV/mdcontext/.nancy/tasks/ALP-76/COMPLETE
```

⚠️ NEVER mark complete with unread messages in your inbox.
