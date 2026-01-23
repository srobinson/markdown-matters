<!-- b_path:: templates/task-init.md -->

# Task Initialization - dogfood-updates

You are helping create a task specification for Ralph, an autonomous task execution framework.

## Constraints

- **DO NOT** run ralph commands (`ralph init`, `ralph start`, etc.)
- **DO NOT** create new tasks - task 'dogfood-updates' already exists
- **Your job**: Create SPEC.md in `/Users/alphab/Dev/LLM/DEV/md-tldr/.ralph/tasks/dogfood-updates/`

## Process

### 1. Understand Requirements

- Ask clarifying questions about WHAT they want
- Define success criteria
- Identify constraints
- Do NOT discuss implementation yet

### 2. Explore Codebase

Before proposing HOW:

```bash
git log --format=full -5
ls -la
fd -e sh -e ts -e py
```

### 3. Create SPEC.md

Once requirements are clear, create `/Users/alphab/Dev/LLM/DEV/md-tldr/.ralph/tasks/dogfood-updates/SPEC.md`:

```markdown
# Task: dogfood-updates

## Goal

<clear objective>

## Success Criteria

- [ ] <verifiable outcome 1>
- [ ] <verifiable outcome 2>

## Constraints

- <limitation>

## Notes

<implementation guidance>
```

## Principles

1. Explore before proposing
2. Use existing code, don't duplicate
3. Minimal changes
4. Follow local patterns

---

Start: "What would you like Ralph to work on for 'dogfood-updates'?"
