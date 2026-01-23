# Task: validate-usefulness

## Goal

Validate whether `mdtldr` genuinely helps AI agents synthesize information from large markdown documentation sets. Run a controlled experiment with three different strategies, then synthesize findings into actionable spec change proposals and a tool evaluation.

## Context

**Base Documentation:** `/Users/alphab/Dev/LLM/DEV/TMP/memory/`

Each strategy gets its own isolated copy:
```
mdtldr-exp-1/        <- Strategy A (By Folder)
├── docs/
├── docs.amorphic/
└── docs.llm/

mdtldr-exp-2/        <- Strategy B (By Question)
├── docs/
├── docs.amorphic/
└── docs.llm/

mdtldr-exp-3/        <- Strategy C (Two-Phase)
├── docs/
├── docs.amorphic/
└── docs.llm/

reports/             <- Shared output location
├── strategy-a/
├── strategy-b/
└── strategy-c/
```

**The Question:** Can an agent propose changes to the original spec (`./docs/`) based on feedback scattered across `./docs.amorphic/` and `./docs.llm/` — using ONLY mdtldr?

## Experiment SPECs

Each experiment has its own focused SPEC:
- `mdtldr-exp-1/SPEC.md` - Strategy A instructions
- `mdtldr-exp-2/SPEC.md` - Strategy B instructions
- `mdtldr-exp-3/SPEC.md` - Strategy C instructions

## Experiment Design

### Phase 1-3: Three Parallel Strategies (Isolated)

Each strategy runs independently. Agents do NOT see other strategies' results.

#### Strategy A: By Folder
- **Agent A1:** Owns `./docs/` - extracts current spec structure & claims
- **Agent A2:** Owns `./docs.amorphic/` - extracts feedback & criticism
- **Agent A3:** Owns `./docs.llm/` - extracts additional feedback
- **Agent A-Synth:** Combines A1-A3 findings into proposals

#### Strategy B: By Question
- **Agent B1:** "What architecture/design criticisms exist?" (searches ALL folders)
- **Agent B2:** "What's missing from the spec?" (searches ALL folders)
- **Agent B3:** "What workflow/process improvements are suggested?" (searches ALL folders)
- **Agent B-Synth:** Combines B1-B3 findings into proposals

#### Strategy C: Two-Phase
- **Agent C1 (Explorer):** Maps everything - `tree`, `stats`, broad `search` - identifies themes
- **Agent C2-N (Divers):** Deep-dive into themes C1 identified (spawned based on C1's findings)
- **Agent C-Synth:** Combines all findings into proposals

### Phase 4: Final Synthesis
- **Agent Final:** Reviews all three strategy reports
  - Compares effectiveness of each approach
  - Synthesizes unified spec change proposals
  - Delivers verdict on mdtldr usefulness

## Rules for All Agents

### MUST
1. Use ONLY `mdtldr` commands to access markdown content
2. Run `mdtldr --help` and subcommand `--help` as their first action
3. Log every command in the Command Log table
4. May use `--force` flag if indexing seems stale
5. Report on tool experience honestly

### MUST NOT
1. Use `cat`, `head`, `tail`, `less` on markdown files
2. Use `Read` tool on markdown files
3. Use `grep`/`Grep` tool directly on markdown files
4. Use any bash command that reads markdown file contents

### IF STUCK
- Document WHY in the report rather than falling back to forbidden tools
- This is valuable data about tool gaps!

## Report Location

All reports go to: `/Users/alphab/Dev/LLM/DEV/TMP/memory/reports/`

```
reports/
├── strategy-a/
│   ├── a1-docs.md
│   ├── a2-amorphic.md
│   ├── a3-llm.md
│   └── a-synthesis.md
├── strategy-b/
│   ├── b1-architecture.md
│   ├── b2-gaps.md
│   ├── b3-workflows.md
│   └── b-synthesis.md
├── strategy-c/
│   ├── c1-explorer.md
│   ├── c2-diver-[theme].md  (multiple)
│   └── c-synthesis.md
└── FINAL-SYNTHESIS.md
```

## Report Template

Each agent report MUST follow this structure:

```markdown
# Report: [Agent ID] - [Brief Title]

## Mission
[What was this agent trying to accomplish?]

## Command Log

| # | Command | Purpose | Result | Useful? |
|---|---------|---------|--------|---------|
| 1 | mdtldr --help | Learn tool | Listed commands | Yes |
| 2 | mdtldr tree ./docs | See structure | Found 10 files | Yes |
| ... | ... | ... | ... | ... |

## Findings

### Key Discoveries
- [Discovery 1]
- [Discovery 2]

### Relevant Quotes/Sections Found
> [Quote from docs via mdtldr context]
> Source: [file, section]

### Themes Identified
1. [Theme]
2. [Theme]

## Proposed Spec Changes (if applicable)
- [ ] [Change 1]
- [ ] [Change 2]

## Tool Evaluation

### What Worked Well
- [Feature/workflow that helped]

### What Was Frustrating
- [Pain point]

### What Was Missing
- [Capability gap that would have helped]

### Confidence Level
How confident are you that you found the relevant information?
[ ] High - Tool surfaced what I needed
[ ] Medium - Found useful stuff but might have missed things
[ ] Low - Struggled to find relevant content

### Would Use Again? (1-5)
[Score] - [Brief justification]

## Time & Efficiency
- Commands run: [N]
- Estimated tokens consumed: [if knowable]
- Compared to reading all files: [much less / about same / more]
```

## Success Criteria

- [ ] Strategy A completed with 4 reports
- [ ] Strategy B completed with 4 reports
- [ ] Strategy C completed with 3+ reports
- [ ] Final synthesis produced
- [ ] Each report follows template
- [ ] Each report includes honest tool evaluation
- [ ] Final synthesis includes concrete spec change proposals
- [ ] Final synthesis includes verdict on mdtldr usefulness

## Execution Order

1. Create report directory structure
2. Run Strategy A (spawn A1, A2, A3 in parallel, then A-Synth)
3. Run Strategy B (spawn B1, B2, B3 in parallel, then B-Synth)
4. Run Strategy C (C1 first, then spawn divers, then C-Synth)
5. Run Final Synthesis

Strategies A, B, C can run in parallel if desired.

## Notes

- Agents should be spawned with `haiku` model for cost efficiency (upgrade to `sonnet` if struggling)
- Index may need `mdtldr index --embed` for semantic search - let agents discover this
- The command log is critical data - it shows HOW agents use the tool
- "Stuck" moments are valuable - they reveal tool gaps
