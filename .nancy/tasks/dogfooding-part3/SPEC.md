# Experiment 4: Strategy D - Feature Battle

## Goal

Compare the effectiveness of mdtldr's NEW search features by having specialized agents compete on the same task.

**Your Strategy:** Feature specialists. Each agent uses ONLY one search feature type.

## Your Workspace

```
/Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-4/
├── docs/              <- Original project spec
├── docs.amorphic/     <- LLM chat analysis of spec
└── docs.llm/          <- More chat feedback
```

## The Mission

The `docs/` folder contains an original project specification. The `docs.amorphic/` and `docs.llm/` folders contain LLM chat logs that reviewed and critiqued that spec.

**Objective:** Propose changes to the original spec based on feedback in the chat logs.

**Meta-Objective:** Compare which search feature is most effective for this task.

## Execution Plan

### Phase 0: Setup (orchestrator)

Before launching agents:
```bash
cd /Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-4
mdtldr index --embed --force
```

### Phase 1: Feature Battle (3 agents in parallel)

**Agent D1 - Semantic Search Specialist**

- Feature: Natural language semantic search (requires embeddings)
- Allowed: `mdtldr search "natural language query"`
- Forbidden: Boolean operators (AND/OR/NOT), quoted phrases
- Output: `reports/strategy-d/d1-semantic.md`

**Agent D2 - Boolean Operator Specialist**

- Feature: Boolean logic with AND, OR, NOT
- Allowed: `mdtldr search "term1 AND term2"`, `mdtldr search "A OR B NOT C"`
- Forbidden: Natural language queries, quoted phrases
- Output: `reports/strategy-d/d2-boolean.md`

**Agent D3 - Phrase Search Specialist**

- Feature: Exact phrase matching with quotes
- Allowed: `mdtldr search '"exact phrase"'`, `mdtldr search '"multi word match"'`
- Forbidden: Boolean operators, natural language queries
- Output: `reports/strategy-d/d3-phrase.md`

### Phase 2: Synthesis

**Agent D-Synth**

- Reads: D1, D2, D3 reports (may use Read tool for reports only)
- Mission:
  1. Combine findings into spec change proposals
  2. **Judge the battle**: Which feature was most effective?
- Output: `reports/strategy-d/d-synthesis.md`

## Rules

### MUST

1. Use ONLY `mdtldr` commands to access markdown content
2. Run `mdtldr --help` and `mdtldr search --help` first
3. Log every command in the Command Log table
4. Work from directory: `/Users/alphab/Dev/LLM/DEV/TMP/memory/mdtldr-exp-4/`
5. **STAY IN YOUR LANE**: Only use your assigned feature type
6. Report honestly on tool experience

### MUST NOT

1. Use `cat`, `head`, `tail`, `less` on markdown files
2. Use `Read` tool on markdown files in docs/, docs.amorphic/, docs.llm/
3. Use `grep`/`Grep` tool on markdown files
4. Use any bash command that reads markdown content directly
5. **Cross features**: Don't use another agent's search style

### IF STUCK

- Document WHY in your report - this is valuable feedback!
- Try creative queries within your feature constraints
- Do NOT fall back to forbidden tools or other features

## Report Template

Save to: `/Users/alphab/Dev/LLM/DEV/TMP/memory/reports/strategy-d/[agent-id].md`

```markdown
# Report: [Agent ID] - [Feature Type] Specialist

## Mission

Find spec change proposals using ONLY [feature type] search.

## Feature Constraints

- Allowed: [what I can use]
- Forbidden: [what I cannot use]

## Command Log

| # | Command | Purpose | Result | Useful? |
|---|---------|---------|--------|---------|
| 1 | mdtldr search --help | Learn feature | ... | Yes |
| 2 | ... | ... | ... | ... |

## Search Strategy

[How did you approach finding relevant content with your limited feature set?]

## Findings

### Key Discoveries

- [Discovery 1]
- [Discovery 2]

### Relevant Quotes/Sections Found

> [Quote from docs via mdtldr]
> Source: [file, section]

### Themes Identified

1. [Theme]
2. [Theme]

## Proposed Spec Changes

- [ ] [Change 1]
- [ ] [Change 2]

## Feature Evaluation

### Strengths of [Feature Type]

-

### Weaknesses of [Feature Type]

-

### Best Use Cases

-

### Worst Use Cases

-

## Comparison Notes

[How do you think your feature compares to the others for this task?]

## Confidence Level

[ ] High - Feature surfaced exactly what I needed
[ ] Medium - Found useful stuff but felt limited
[ ] Low - Feature was wrong tool for this job

### Feature Score (1-5)

[Score] - [Brief justification for this specific task type]

## Time & Efficiency

- Commands run: [N]
- Successful queries: [N]
- Dead-end queries: [N]
```

## Synthesis Report Template

Save to: `/Users/alphab/Dev/LLM/DEV/TMP/memory/reports/strategy-d/d-synthesis.md`

```markdown
# Report: D-Synth - Feature Battle Synthesis

## Mission

1. Combine findings into spec change proposals
2. Judge which feature won the battle

## Spec Change Proposals (Combined)

### From D1 (Semantic)
- [ ] ...

### From D2 (Boolean)
- [ ] ...

### From D3 (Phrase)
- [ ] ...

### Unique to Multiple Agents
- [ ] ...

## Feature Battle Results

### Winner: [Feature Name]

**Why:**
-

### Runner-up: [Feature Name]

**Why:**
-

### Third Place: [Feature Name]

**Why:**
-

## Feature Comparison Matrix

| Aspect | Semantic | Boolean | Phrase |
|--------|----------|---------|--------|
| Discoveries found | | | |
| Unique discoveries | | | |
| Query efficiency | | | |
| Learning curve | | | |
| Best for | | | |

## Recommendations

### When to use Semantic Search
-

### When to use Boolean Operators
-

### When to use Phrase Search
-

## Meta-Feedback

[What did this experiment reveal about mdtldr's search features?]
```

## Hints

- `mdtldr index --embed` enables semantic search (REQUIRED for D1)
- D1: Think like a human asking questions
- D2: Think like a database query - combine terms logically
- D3: Think about exact terminology used in the docs
- `mdtldr context` can be used by all agents to get detailed content once you find relevant files
- `mdtldr tree [file]` shows document outline - allowed for all agents

## Success Criteria

- [x] All 3 specialist agents complete their reports
- [x] Each agent stays within their feature constraints
- [x] Synthesis report declares a winner with justification
- [x] At least 5 spec change proposals generated across all agents (got 10+ unique)
- [x] Clear comparison data on feature effectiveness
