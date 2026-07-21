# markdown-matters

## Unreleased

### Features

* Add `mdm fix` for repairing malformed YAML frontmatter, including dry-run diffs, guarded writes, and parser hints when indexing encounters broken frontmatter.
* Recover usable frontmatter keys during indexing with tolerant YAML parsing while stripping malformed frontmatter blocks from the indexed markdown body.

### Breaking Changes

* The OpenRouter provider no longer accepts `OPENAI_API_KEY` as a fallback credential. Selecting `provider: 'openrouter'` requires `OPENROUTER_API_KEY` to be set; the runtime fails fast with a missing-key error otherwise. Migration: set `OPENROUTER_API_KEY=sk-or-...` in your environment, or switch to `provider: 'openai'` if you intended to use OpenAI directly.
* HyDE no longer silently substitutes `openai` when the embedding side is `voyage`. Selecting `providerConfig.provider: 'voyage'` together with `hyde: true` now fails fast with a `CapabilityNotSupported` error before any HTTP call. Migration: pin `hydeOptions.provider` explicitly to one of `openai`, `openrouter`, `ollama`, or `lm-studio`.

### Bug Fixes

* `providerConfig.baseURL` is now honored on the embedding path for the four OpenAI-compatible providers (openai, openrouter, ollama, lm-studio). Previously the field was documented as "carried for HyDE inheritance only" and the embed path silently routed to the transport default. Private ollama hosts, self-hosted lm-studio instances, and openrouter proxies now receive embedding traffic on the configured URL during both index build and query. Vector-store metadata also records the endpoint the runtime actually dialled rather than the caller-supplied override, so on-disk observability matches the requests that were sent.

## [0.4.0](https://github.com/srobinson/markdown-matters/compare/v0.3.5...v0.4.0) (2026-07-21)


### Features

* federated knowledge layer — Plans 1-3 §7.2, path coherence, wikilinks ([#77](https://github.com/srobinson/markdown-matters/issues/77)) ([a9cfcb0](https://github.com/srobinson/markdown-matters/commit/a9cfcb0255c567c476ae586dd0334152d4e5154f))

## [0.3.5](https://github.com/srobinson/markdown-matters/compare/v0.3.4...v0.3.5) (2026-06-21)


### Bug Fixes

* create local config when index dir exists ([#43](https://github.com/srobinson/markdown-matters/issues/43)) ([a1682d6](https://github.com/srobinson/markdown-matters/commit/a1682d64c8b80056c687f3217dcbd8710cc5eab7))
* validate config check ([#41](https://github.com/srobinson/markdown-matters/issues/41)) ([769ae53](https://github.com/srobinson/markdown-matters/commit/769ae53ac7fc2ab4d3c654d0c1f7338cfb17b995))

## [0.3.4](https://github.com/srobinson/markdown-matters/compare/v0.3.3...v0.3.4) (2026-04-29)


### Bug Fixes

* atomically persist index JSON via temp-file-then-rename ([#31](https://github.com/srobinson/markdown-matters/issues/31)) ([f1c3fb5](https://github.com/srobinson/markdown-matters/commit/f1c3fb57d86e92117df3699c4c1161a2db02b26c))

## [0.3.3](https://github.com/srobinson/markdown-matters/compare/v0.3.2...v0.3.3) (2026-04-29)


### Features

* **fix:** repair malformed YAML frontmatter ([#33](https://github.com/srobinson/markdown-matters/issues/33)) ([b340b12](https://github.com/srobinson/markdown-matters/commit/b340b12d92a62800cf7288864f4fb83ab6638a25))

## [0.3.2](https://github.com/srobinson/markdown-matters/compare/v0.3.1...v0.3.2) (2026-04-09)


### Bug Fixes

* correct md_context MCP tool definition and update docs ([24e7261](https://github.com/srobinson/markdown-matters/commit/24e726159d0a152e69fc402b5cf6339869e8d575))
* **embeddings:** hyde no longer a no-op in semantic search ([#23](https://github.com/srobinson/markdown-matters/issues/23)) ([18d9240](https://github.com/srobinson/markdown-matters/commit/18d924009c4aa35e77b24ab3bd295c11855691c8))
* **providers:** extract use case agnostic provider runtime for embeddings and HyDE ([#29](https://github.com/srobinson/markdown-matters/issues/29)) ([aa52f29](https://github.com/srobinson/markdown-matters/commit/aa52f29cb2cf838e20f05d327fa16e1f3e5acb88))

## [0.3.1](https://github.com/srobinson/markdown-matters/compare/v0.3.0...v0.3.1) (2026-03-17)


### Bug Fixes

* eliminate redundant CI runs across workflows ([#14](https://github.com/srobinson/markdown-matters/issues/14)) ([49c5f44](https://github.com/srobinson/markdown-matters/commit/49c5f4445c1d4c421a77db3f86d171e38b179591))

## 0.3.0

### Minor Changes

- [#12](https://github.com/srobinson/markdown-matters/pull/12) [`65e498c`](https://github.com/srobinson/markdown-matters/commit/65e498cab179e053d86f7db71a36ddd941becca5) Thanks [@srobinson](https://github.com/srobinson)! - Rename CLI from mdcontext to mdm, rewrite config system, redesign context command level/budget system, and add line ranges to section output.
