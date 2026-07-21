# Lessons

Rules learned from corrections. Review at session start.

## Orchestration: use the warroom, not ad-hoc subagents
For any multi-agent review, red-team, peer consensus, or slice-build in the helioy
ecosystem, orchestrate via **/warroom** (helioy-warroom: tmux panes + helioy-bus,
mixed Claude/Codex runtime, orchestrator synthesizes, verify from disk). Do **not**
use backgrounded general-purpose subagents for this: they give Stuart no
observability and proved unreliable (a reviewer subagent returned zero-tool-call
garbage). Reserve the Agent/subagent tool for single, self-contained delegated
lookups. When Stuart says "all general agent, claude use opus," he means the
warroom's general-agent preset with opus on the Claude panes. (2026-07-04)

## Normalize paths at portable text boundaries
Keep declared paths in the platform native form used by filesystem logic.
Normalize backslashes to forward slashes only when writing portable text such
as TOML, and pin every path writer with a backslash input test. (2026-07-20)

## Define discovery path contracts at the producer
Keep absolute filesystem paths in platform native form. Normalize relative paths
returned or stored by discovery to forward slashes where they are constructed,
and pin the producer with a host independent backslash regression. (2026-07-20)

## Prefer exclusion over destructive cleanup for inert artifacts
Before deleting data from a source tree, prove the active read path consumes it.
When an old artifact is inert, leave it untouched and exclude it from discovery.
Do not add source tree deletion merely to remove unused compatibility state.
(2026-07-20)

## Required schema fields require repository wide fixture gates
When a persisted schema field becomes required, audit every constructor in
source, unit tests, integration tests, and shared fixtures. Run the integration
suite that saves and reloads that schema before publishing the branch.
(2026-07-20)

## Spawned CLI tests need cross-platform cold-start budgets
Give every sibling test that spawns the built CLI the same generous timeout.
Slow Windows startup must reach the application response before assertions run,
so tests prove product behavior instead of observing a process timeout.
(2026-07-20)

## Name the "unsupported platform" before writing a failure policy
Never brief "fail clearly on unsupported platforms" without naming which platform
lacks which capability, and whether it is a first-class target. In this repo the
only real gap is directory fsync on Windows: Node cannot open a directory handle
to flush it (EISDIR/EPERM), so POSIX rename-durability is impossible there. Since
Windows is a CI target, the correct policy is a platform-aware DEGRADE (skip the
directory sync, rely on atomic rename for the pointer flip), not a hard failure.
macOS is a strength caveat, not a gap: plain fsync does not flush the drive cache
(true durability needs F_FULLFSYNC, which Node's fs.fsync does not invoke).
Reserve a typed hard failure for a genuinely unknown platform or an unexpected
error where support was expected. Same family as challenging whether a guard is
needed before perfecting it. (2026-07-21)

## Keep complete generation invariants inside the transaction owner
When several entrypoints publish one atomic artifact set, the shared coordinator
must own every required build and reconciliation step. Never make a required
artifact family an optional caller callback, because one omitted callback can
publish a valid looking but incomplete generation. Equivalence tests must run
every live writer and compare all artifact families, including semantic vectors
and the active provider. Green structural summaries cannot prove complete
generation equivalence. (2026-07-21)

## Preserve reader availability across optional state
Map a typed missing generation to first run guidance at the command boundary.
Treat corrupt optional semantic metadata as degraded, log a warning, and keep
structural and keyword reads available. Require writer selected index roots in
write and estimation APIs so ambient home resolution cannot cross a generation
boundary. (2026-07-21)

## Do not relay a delegate's "verified live" claim as authoritative
A subagent can claim it fetched live sources and still be stale or hallucinated.
A pricing pull labelled "verified from live official docs today" reported OpenAI
GPT 5.5 as the flagship when GPT 5.6 had been shipping for weeks. For fast moving
external facts, require proof of currency: the exact URL fetched plus a quoted
figure, and a named latest artifact per item so a missed generation is obvious.
Treat search excerpts as discovery only. Open the cited page and confirm the
claim is present in its current visible content before using it as evidence.
Caveat or withhold anything unproven rather than passing a confident claim
through. Confident and wrong is worse than stale and labelled. (2026-07-21)

## Project writing rules govern supplied copy
Before committing requested text, scan it against the repository writing rules.
Replace prohibited punctuation such as em dashes even when the supplied copy uses
it verbatim, unless the user explicitly overrides the repository rule. (2026-07-21)

## Explicit rebuild intent takes precedence over no-op suppression
A forced rebuild must always publish a new generation, even when its logical
artifacts equal the current generation. Audit explicit command flags before
adding a generic no-op short circuit. Before reporting the full suite green,
run the complete required command to its final summary and report its actual
pass and failure counts. (2026-07-21)

## Resolve optional semantic state inside the degradation boundary
Hybrid search must perform fallible provider and metadata resolution inside its
semantic channel boundary so corrupt optional state cannot suppress keyword
results. Require a resolved embedding signature at the semantic API, reject
provider overrides that disagree with the active index, and never retain a
public provider fallback that can route a query unexpectedly. (2026-07-21)

## Keep verification proportional to change risk
Do not add a regression test for an isolated copy change or literal replacement
when existing behavior already exercises the path. Verify low risk wording edits
through the existing command and relevant established gates. Add tests when they
protect meaningful logic, branching, or a demonstrated recurring failure.
(2026-07-22)
