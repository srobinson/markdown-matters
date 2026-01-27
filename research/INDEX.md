# Research Documentation Index

**Generated:** 2026-01-24 06:38:24 UTC
**Git Commit:** 07c9e72ba01cda840046b96a1be4743a85e3d4c5
**Worktree:** nancy-ALP-139
**Last Updated:** 2026-01-24 06:49:16 UTC

---

## Overview

This directory contains research documentation created during the development of mdcontext. Documents vary in accuracy and status based on when they were created relative to code changes.

**Legend:**
- **Authoritative** - Most reliable, validated against current code
- **Valid** - Accurate to current code state
- **Outdated** - Based on older code, findings may no longer apply
- **Needs Validation** - Line numbers/findings need checking against current code
- **Historical** - Preserved for methodology reference

---

## Frontmatter Research (LLM Code Navigation)

**Seminal research into how structured metadata enables 88-97% token reduction for LLM code navigation.**

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [frontmatter/LLM-CODE-NAVIGATION.md](frontmatter/LLM-CODE-NAVIGATION.md) | **Authoritative** | 100% | 2026-01-28 | **THE THESIS** - Comprehensive research proving frontmatter reduces LLM token usage by 88-97% on real codebases. Includes methodology, benchmarks, and adoption path. |
| [frontmatter/COMMENTS-ARE-SKIPPED.md](frontmatter/COMMENTS-ARE-SKIPPED.md) | **Authoritative** | 100% | 2026-01-28 | **THE PIVOT** - Critical insight: LLMs skip comments. Frontmatter as comments is invisible. Solution: manifest JSON for LLMs, inline comments for humans. |

**Key Findings:**
- LLMs waste tokens reading entire files to understand what they do
- Frontmatter (metadata in first 10 lines) enables "peek first" triage
- 88-97% token reduction on architecture exploration, refactoring, code review tasks
- **Critical insight:** LLMs skip comments → frontmatter as comments is invisible
- **Solution:** Manifest JSON for LLMs, inline comments for humans - generate both
- fmm CLI generates/maintains frontmatter automatically

**Related Project:** [fmm (Frontmatter Matters)](https://github.com/mdcontext/fmm) - CLI tool for generating frontmatter

---

## Config System Research

Research into the configuration system, including bugs, documentation gaps, and implementation validation.

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [config-docs/fix-validation.md](config-docs/fix-validation.md) | Authoritative | 100% | 2026-01-24 | **START HERE** - Validates all proposed fixes against actual code. Most critical issues already fixed. |
| [config-docs/help-system-analysis.md](config-docs/help-system-analysis.md) | Valid | 100% | 2026-01-24 | **Architecture deep-dive** - How custom help and Effect CLI work together. Pattern matching logic and implementation details. |
| [config-docs/help-audit.md](config-docs/help-audit.md) | Valid | 100% | 2026-01-24 | Help system UX analysis. Identifies ugly Effect CLI output for bare `config` command. |
| [config-docs/TEST-RESULTS.md](config-docs/TEST-RESULTS.md) | Valid | 95% | 2026-01-24 | Manual test audit of config commands. Accurate for time tested (pre-fix). |
| [config-docs/SUMMARY.md](config-docs/SUMMARY.md) | Outdated | 60% | 2026-01-24 | Executive summary of config issues. **Note:** Most issues described here have been fixed. |
| [config-docs/analysis.md](config-docs/analysis.md) | Outdated | 60% | 2026-01-24 | Deep dive analysis (711 lines). Based on pre-fix code. Excellent methodology. |
| [config-docs/TODO.md](config-docs/TODO.md) | Outdated | 40% | 2026-01-24 | Action plan with code examples. 5 of 6 P0/P1 tasks complete. Only troubleshooting docs remain. |

**Key Findings:**
- TypeScript config loading: Fixed (documented limitation, default changed to .js)
- Summarization config exposure: Fixed (fully implemented)
- README configuration section: Fixed (comprehensive)
- Remaining work: Add troubleshooting section to CONFIG.md

---

## Config Analysis (Architecture)

Strategic analysis of configuration management approaches and implementation recommendations.

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [config-analysis/01-current-implementation.md](config-analysis/01-current-implementation.md) | Historical | TBD | Pending | Current config implementation analysis |
| [config-analysis/02-strategy-recommendation.md](config-analysis/02-strategy-recommendation.md) | Historical | TBD | Pending | Configuration strategy recommendations |
| [config-analysis/03-task-candidates.md](config-analysis/03-task-candidates.md) | Historical | TBD | Pending | Task breakdown for config work |
| [config-analysis/04-consolidated-task-candidates.md](config-analysis/04-consolidated-task-candidates.md) | Historical | TBD | Pending | Consolidated task list |
| [config-analysis/033-research-configuration-management.md](config-analysis/033-research-configuration-management.md) | Historical | TBD | Pending | Configuration management patterns research |
| [config-analysis/034-research-effect-cli-config.md](config-analysis/034-research-effect-cli-config.md) | Historical | TBD | Pending | Effect CLI configuration research |

---

## Code Reviews

Detailed code reviews identifying bugs, anti-patterns, and quality issues.

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [code-review/main-ts-review.md](code-review/main-ts-review.md) | Needs Validation | TBD | Pending | 16 issues in main.ts (1 critical, 7 high, 5 medium, 3 low). **Warning:** Line numbers may be outdated. |
| [code-review/cli-error-handling-review.md](code-review/cli-error-handling-review.md) | Needs Validation | TBD | Pending | Error handling pattern analysis across 7 CLI commands. Identifies duplication and migration path. |

**Note:** Both code reviews reference specific line numbers that may have shifted since creation. Validation recommended before acting on findings.

---

## Error Handling Research

Analysis of error handling patterns and migration strategies.

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [effect-cli-error-handling.md](effect-cli-error-handling.md) | Historical | TBD | Pending | Effect CLI error handling patterns |
| [effect-errors-as-values.md](effect-errors-as-values.md) | Historical | TBD | Pending | Errors-as-values pattern research |
| [mdcontext-error-analysis.md](mdcontext-error-analysis.md) | Historical | TBD | Pending | mdcontext error handling analysis |
| [errors-task-analysis/00-consolidated-tasks.md](errors-task-analysis/00-consolidated-tasks.md) | Historical | TBD | Pending | Consolidated error handling tasks |
| [errors-task-analysis/cli-commands-analysis.md](errors-task-analysis/cli-commands-analysis.md) | Historical | TBD | Pending | CLI commands error analysis |
| [errors-task-analysis/embeddings-analysis.md](errors-task-analysis/embeddings-analysis.md) | Historical | TBD | Pending | Embeddings module error analysis |
| [errors-task-analysis/index-search-analysis.md](errors-task-analysis/index-search-analysis.md) | Historical | TBD | Pending | Index/search error analysis |

---

## NPM Publishing Research

Research for setting up automated npm publishing workflow.

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [npm_publish/014-npm-workflow-synthesis.md](npm_publish/014-npm-workflow-synthesis.md) | Historical | TBD | Pending | Synthesis of npm workflow research |
| [npm_publish/031-npm-workflow-task-analysis.md](npm_publish/031-npm-workflow-task-analysis.md) | Historical | TBD | Pending | Task analysis for npm workflow |
| [npm_publish/011-npm-workflow-research-agent2.md](npm_publish/011-npm-workflow-research-agent2.md) | Historical | TBD | Pending | Agent 2 research findings |
| [npm_publish/012-npm-workflow-research-agent1.md](npm_publish/012-npm-workflow-research-agent1.md) | Historical | TBD | Pending | Agent 1 research findings |
| [npm_publish/013-npm-workflow-research-agent3.md](npm_publish/013-npm-workflow-research-agent3.md) | Historical | TBD | Pending | Agent 3 research findings |

---

## Semantic Search Research

Research into semantic search, embeddings, and vector search capabilities.

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [semantic-search/032-research-semantic-search.md](semantic-search/032-research-semantic-search.md) | Historical | TBD | Pending | Semantic search implementation research |
| [semantic-search/004-research-vector-search.md](semantic-search/004-research-vector-search.md) | Historical | TBD | Pending | Vector search technologies |
| [semantic-search/003-research-rag-alternatives.md](semantic-search/003-research-rag-alternatives.md) | Historical | TBD | Pending | RAG and alternative approaches |
| [semantic-search/002-research-embedding-models.md](semantic-search/002-research-embedding-models.md) | Historical | TBD | Pending | Embedding model evaluation |

---

## Task Management Research

Evaluation of task management tools and workflows for AI-assisted development.

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [task-management-2026/00-synthesis-recommendations.md](task-management-2026/00-synthesis-recommendations.md) | Historical | TBD | Pending | Synthesis and recommendations |
| [task-management-2026/01-ai-workflow-tools.md](task-management-2026/01-ai-workflow-tools.md) | Historical | TBD | Pending | AI workflow tools evaluation |
| [task-management-2026/02-agent-framework-patterns.md](task-management-2026/02-agent-framework-patterns.md) | Historical | TBD | Pending | Agent framework patterns |
| [task-management-2026/03-lightweight-file-based.md](task-management-2026/03-lightweight-file-based.md) | Historical | TBD | Pending | Lightweight file-based approaches |
| [task-management-2026/04-established-tools-ai-features.md](task-management-2026/04-established-tools-ai-features.md) | Historical | TBD | Pending | Established tools with AI features |

### Linear Deep Dive

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [task-management-2026/linear/01-core-features-workflow.md](task-management-2026/linear/01-core-features-workflow.md) | Historical | TBD | Pending | Linear core features and workflow |
| [task-management-2026/linear/02-api-integrations.md](task-management-2026/linear/02-api-integrations.md) | Historical | TBD | Pending | Linear API and integrations |
| [task-management-2026/linear/03-ai-features.md](task-management-2026/linear/03-ai-features.md) | Historical | TBD | Pending | Linear AI features |
| [task-management-2026/linear/04-pricing-setup.md](task-management-2026/linear/04-pricing-setup.md) | Historical | TBD | Pending | Linear pricing and setup |
| [task-management-2026/linear/05-usage-patterns-best-practices.md](task-management-2026/linear/05-usage-patterns-best-practices.md) | Historical | TBD | Pending | Linear usage patterns |

---

## Dogfooding / Strategy Research

Strategic analysis of mdcontext usage for its own development.

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [dogfood/consolidated-tool-evaluation.md](dogfood/consolidated-tool-evaluation.md) | Historical | TBD | Pending | Consolidated evaluation of strategies |

### Strategy A: Documentation-First

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [dogfood/strategy-a/a-synthesis.md](dogfood/strategy-a/a-synthesis.md) | Historical | TBD | Pending | Strategy A synthesis |
| [dogfood/strategy-a/a1-docs.md](dogfood/strategy-a/a1-docs.md) | Historical | TBD | Pending | Documentation approach |
| [dogfood/strategy-a/a2-amorphic.md](dogfood/strategy-a/a2-amorphic.md) | Historical | TBD | Pending | Amorphic patterns |
| [dogfood/strategy-a/a3-llm.md](dogfood/strategy-a/a3-llm.md) | Historical | TBD | Pending | LLM integration |

### Strategy B: Architecture-First

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [dogfood/strategy-b/b-synthesis.md](dogfood/strategy-b/b-synthesis.md) | Historical | TBD | Pending | Strategy B synthesis |
| [dogfood/strategy-b/b1-architecture.md](dogfood/strategy-b/b1-architecture.md) | Historical | TBD | Pending | Architecture analysis |
| [dogfood/strategy-b/b2-gaps.md](dogfood/strategy-b/b2-gaps.md) | Historical | TBD | Pending | Gap analysis |
| [dogfood/strategy-b/b3-workflows.md](dogfood/strategy-b/b3-workflows.md) | Historical | TBD | Pending | Workflow patterns |

### Strategy C: Deep Dive

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [dogfood/strategy-c/c-synthesis.md](dogfood/strategy-c/c-synthesis.md) | Historical | TBD | Pending | Strategy C synthesis |
| [dogfood/strategy-c/c1-explorer.md](dogfood/strategy-c/c1-explorer.md) | Historical | TBD | Pending | Explorer pattern |
| [dogfood/strategy-c/c2-diver-memory.md](dogfood/strategy-c/c2-diver-memory.md) | Historical | TBD | Pending | Memory management |
| [dogfood/strategy-c/c3-diver-control.md](dogfood/strategy-c/c3-diver-control.md) | Historical | TBD | Pending | Control patterns |
| [dogfood/strategy-c/c4-diver-failure.md](dogfood/strategy-c/c4-diver-failure.md) | Historical | TBD | Pending | Failure handling |
| [dogfood/strategy-c/c5-diver-execution.md](dogfood/strategy-c/c5-diver-execution.md) | Historical | TBD | Pending | Execution patterns |
| [dogfood/strategy-c/c6-diver-org.md](dogfood/strategy-c/c6-diver-org.md) | Historical | TBD | Pending | Organization patterns |

---

## Meta / Quality Reviews

Reviews of the research documentation itself.

| Document | Status | Accuracy | Last Validated | Summary |
|----------|--------|----------|----------------|---------|
| [research-quality-review.md](research-quality-review.md) | Valid | 100% | 2026-01-24 | Comprehensive quality review of all config research. Identifies accuracy issues and timeline problems. |
| [issue-review.md](issue-review.md) | Valid | 100% | 2026-01-24 | Review of Linear issues ALP-149, ALP-150, ALP-151, ALP-152. Finds 2 of 4 issues obsolete. |
| [test-path-issues.md](test-path-issues.md) | Valid | 100% | 2026-01-24 | Test path fix validation |

---

## Document Statistics

- **Total Documents:** 61
- **Authoritative:** 3 (fix-validation.md, LLM-CODE-NAVIGATION.md, COMMENTS-ARE-SKIPPED.md)
- **Valid:** 5 (help-system-analysis, help-audit, TEST-RESULTS, quality reviews)
- **Outdated:** 3 (SUMMARY, analysis, TODO)
- **Needs Validation:** 2 (code reviews)
- **Historical/TBD:** 48

---

## Usage Guidelines

### For Current Work

1. **Start with Authoritative docs** - [fix-validation.md](config-docs/fix-validation.md) for config system status
2. **Check Valid docs** - These are accurate to current code
3. **Be cautious with Outdated** - Cross-reference with fix-validation.md
4. **Validate before using** - Code review docs may have stale line numbers

### For Research Methodology

1. **Use Historical docs as templates** - Excellent analysis patterns
2. **Note the validation process** - fix-validation.md shows proper validation
3. **Learn from mistakes** - research-quality-review.md explains what went wrong

### For Creating New Research

1. **Add metadata header** with date, commit hash, status
2. **Validate against current code** before creating issues
3. **Use file:line format** for references
4. **Update this index** when adding new documents
5. **Mark status clearly** - Authoritative/Valid/Outdated/Needs Validation

---

## Recommended Reading Order

### Understanding Config System (Current State)

1. [config-docs/fix-validation.md](config-docs/fix-validation.md) - What's actually implemented
2. [config-docs/help-system-analysis.md](config-docs/help-system-analysis.md) - How help system works (architecture)
3. [config-docs/help-audit.md](config-docs/help-audit.md) - Help UX quality evaluation
4. [config-docs/TODO.md](config-docs/TODO.md) - Check which items are still needed

### Understanding Code Quality Issues

1. [code-review/main-ts-review.md](code-review/main-ts-review.md) - Async/await bugs (validate line numbers first)
2. [code-review/cli-error-handling-review.md](code-review/cli-error-handling-review.md) - Error patterns (validate first)

### Understanding Research Quality

1. [research-quality-review.md](research-quality-review.md) - Meta-analysis of research quality
2. [issue-review.md](issue-review.md) - Linear issue accuracy review

---

## Contributing to Research

When adding new research documents:

1. Add metadata header (see template below)
2. Update this INDEX.md
3. Link from related documents
4. Mark status appropriately

### Metadata Template

```markdown
---
**RESEARCH METADATA**

- Analysis Date: YYYY-MM-DD
- Git Commit: [full SHA]
- Status: [Authoritative | Valid | Outdated | Needs Validation | Historical]
- Last Validated: YYYY-MM-DD
- Superseded By: [document if applicable]

**ACCURACY NOTE**

[Brief note about current accuracy and any known issues]
---
```

---

## Known Issues

1. **Line number drift** - Code review docs may have outdated line numbers
2. **Validation needed** - 48 historical docs need validation against current code
3. **Timeline confusion** - Some docs created after fixes were implemented

---

## Maintenance

This index should be updated:
- When new research documents are created
- When document status changes (e.g., Valid → Outdated)
- When validation is performed
- When documents are removed or consolidated

**Last maintenance:** 2026-01-28 by Claude Opus 4.5 (added frontmatter research)
