# Warroom Process

A warroom is a set of specialist agents running in parallel panes, connected by a
message bus, working toward one shared goal. One agent orchestrates; the rest
scout, build, and review. This document is the reusable process. It is
project agnostic: adopt it as is, and fill the adoption table at the end with
your own tools.

## The one principle

The orchestrator's context is the warroom's scarce resource. Spend it on
direction and judgment, never on doing. Everything below follows from this.

- To learn a fact about the code, a spec, or a failure, commission an agent to
  find it and reply in one line. Do not read the source, diff, or log yourself.
- Own every verdict and gate, but verify through cheap bounded signals you can
  afford: a CI status line, a commit SHA, a size check, plus one agent's bounded
  verdict. Never pull a full diff, log, file, or report into your own context.
- Large artifacts go to named files. An agent reads them or a one line signal
  summarizes them. The bus carries the signal, not the artifact.

## The spine: Scout, Build, Review

Every build runs three beats, in order. Skipping a beat is a defect, not a
shortcut.

1. **Scout.** Audit the existing code before designing anything. Produce a reuse
   map: for every capability the work needs, name the existing owner
   (`file:symbol`) or state "none found" with the searches you ran, so "I did not
   find it" can never hide "I did not look." Surface duplication, dead code, and
   design risk in a quality map. Skipping scout bakes in reinvention.
2. **Build.** Implement against the reuse map in small, independently testable
   slices. A slice that adds a new helper, type, or module for a capability the
   reuse map already owns is a defect.
3. **Review.** Verify against the spec, issue, or plan, with review weight scaled
   to blast radius.

## When to spawn a warroom

Do not spawn one when all of these hold: the change is mechanically locked (one
obvious implementation, no open design choice), the design is already adjudicated,
and your own gate is sufficient evidence. Otherwise spawn one whenever parallel
agents improve correctness, coverage, speed, or confidence. Spawning is cheap;
agents cost tokens only once briefed and working.

## Roster archetype

A five agent warroom covers most builds. Roles, not tools:

| Role | Count | Job |
|------|-------|-----|
| **Engineer** | 1 | Sole author of code. One task at a time. Also serves as scout and plan author before the build. |
| **Reviewers** | 3 | Verify slices against the spec. Draw from different model families so their blind spots do not overlap. |
| **Assistant** | 1 | The orchestrator's delegation channel: ad-hoc searches, file lookups, size and CI checks. Keeps the orchestrator's context clean. |

Scale down for small work (one engineer, one reviewer) and up for large work,
but the assistant and at least one cross-family reviewer earn their seat on any
build with real blast radius.

### Model family diversity is the point

When review quality matters, mix model families across the reviewer seats. Agents
from different families catch different classes of defect: one family reliably
finds platform, fixture, and environment bugs; another finds deep logic and state
bugs. On anything with a race condition or a cross-cutting invariant, that
divergence is worth the tokens. For focused mechanical work, pick the one runtime
that fits and skip the ceremony.

## Cadence per task

1. **Compact or recycle the engine before each task.** Every merged slice is a
   hard boundary. Residue from the prior slice (its diff, its test failures, the
   merge chatter) raises the odds the agent conflates merged state with new work.
   The durable knowledge it needs lives on the merged branch and in the spec,
   re-read cheaply. Compaction is hygiene, not a function of how much context you
   have left.
2. **Brief one task**, bound to its reuse-map owners and the exact interfaces it
   consumes and produces. The engineer builds on a branch, drives with tests,
   self-runs the gates, and opens a PR.
3. **Verify independently** through cheap signals only: the CI result, a size
   check delegated to the assistant, a commit SHA. Never the diff itself.
4. **Review**, weight scaled to blast radius (below).
5. **One focused fix round.** Re-verify only the deltas, then merge.

## Scaling review to blast radius

Match review weight to risk instead of reviewing everything the same.

- **High blast radius** (concurrency, cross-process protocols, shared invariants,
  data-loss paths): fan the same review brief to multiple families in parallel.
  Take the union of their findings.
- **Mechanical** (refactors, renames, dead-code removal, single-file changes):
  one reviewer, one family. More ceremony would cost more than the work.

## The surface-and-decide gate

After the scout or plan phase, surface the reuse map and quality map to the human
and record one disposition per finding before building:

- **Reuse**: bind to the existing code. No new implementation.
- **Deviate**: build new despite existing code, with a one line reason. A
  deviation can be right, but it must be a recorded decision, not a silent default.
- **Refactor first / during / defer**: groom the duplication or dead code, with a
  reason. Building on a bad base bakes in the debt.

The plan that follows must reflect these dispositions and carry the reuse map into
its briefs. The human owns what and why; the orchestrator owns how.

## Message protocol

- Every agent replies to the orchestrator only, in one sentence, with evidence
  (IDs, paths, SHAs, test names, `file:line`). No agent-to-agent chatter by
  default.
- Bus pings wake you; they are not truth. Confirm every `done`, `green`, and
  `merged` through a cheap signal or a commissioned check before you act on it.
  Memory-only consensus is false consensus.
- Prefer typed reply shapes: `done: <artifact> <evidence>`,
  `blocked: <cause> <needed>`, `review: clean <evidence>`,
  `review: issue <severity> <path:line> <fact>`.
- Every brief states its goal, exact inputs, the one artifact or verdict it
  produces, the one-sentence done line, and how you will verify it.

## Non-negotiables

- Run identity discovery first; route all replies to the orchestrator.
- Re-confirm the roster after any membership change. Pane and bus IDs churn;
  address only fresh IDs.
- Scout before you build. Any work touching existing code starts with a reuse map.
- Compact or recycle a continuing pane before its next brief, never after it has
  started the next slice. A contaminated or drifted pane is recycled, not
  compacted forward.

## Adoption

Fill this in per environment. The process above does not change; only the tools do.

| Concept | This environment |
|---------|------------------|
| Panes and message bus | _e.g. tmux + a file-based bus_ |
| Orchestration entrypoint | _e.g. a `/warroom` command or skill_ |
| Model families for MoE | _list the distinct families available_ |
| Per-task gates | _e.g. `test`, `typecheck`, `build`, `lint`_ |
| CI signal | _e.g. `gh pr checks`, the CI matrix_ |
| Cross-session memory | _where reuse maps, plans, and decisions persist_ |
