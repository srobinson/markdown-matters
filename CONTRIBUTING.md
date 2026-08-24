# Contributing to mdm

Thank you for your interest in contributing to mdm! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- pnpm (recommended, version 10+)
- Python 3.12+ (for native module compilation)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/srobinson/markdown-matters.git
cd markdown-matters

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run tests
pnpm test
```

### Available Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build the project |
| `pnpm test` | Run the test suite |
| `pnpm test:all` | Run tests including semantic search tests (requires `OPENAI_API_KEY`) |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Run Biome linter |
| `pnpm format` | Format code with Biome |
| `pnpm check` | Run format, lint, and typecheck |

Note: some tests (for example `config-cmd.test.ts`) spawn the built CLI from `dist/`, so run `pnpm build` before `pnpm test` after changing source.

## Making Changes

1. **Create a branch** for your changes:
   ```bash
   git checkout -b fix/my-bug-fix
   ```

2. **Make your changes** and ensure:
   - All tests pass: `pnpm test`
   - Type checking passes: `pnpm typecheck`
   - Code is formatted: `pnpm format`

3. **Submit a pull request** to the `main` branch with a conventional commit title (see below)

## Versioning and Releases

Releases are managed by [Release Please](https://github.com/googleapis/release-please), driven entirely by commit messages on `main`. There are no changeset files to create.

All PRs are **squash merged**, so the PR title becomes the commit message that Release Please parses. Individual commits on your branch can use any style; only the PR title matters.

### PR Title Format

PR titles must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>
```

| Type | When | Appears in changelog |
|------|------|---------------------|
| `feat` | New feature or capability | Yes (Features) |
| `fix` | Bug fix | Yes (Bug Fixes) |
| `perf` | Performance improvement | Yes (Performance) |
| `refactor` | Code restructuring, no behavior change | Hidden |
| `docs` | Documentation only | Hidden |
| `test` | Adding or updating tests | Hidden |
| `chore` | Maintenance, deps, CI | Hidden |
| `ci` | CI/CD changes | Hidden |

The scope is optional; use a component name when the change is localized:

```
feat(config): project-level index and search roots
fix(mcp): return section content from md_search
perf(index): skip BM25 rebuild on unchanged refreshes
docs: refresh BACKLOG.md against shipped features
```

For a breaking change, add `!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer in the squash commit body.

### Version Bumps

The project is pre-1.0 and configured with `bump-patch-for-minor-pre-major`, so:

- `fix`, `perf`, and `feat` all bump the **patch** version (0.4.1 -> 0.4.2)
- Breaking changes bump the **minor** version (0.4.x -> 0.5.0)

### Release Process

1. Every merge to `main` updates (or opens) a Release Please PR titled `chore(main): release x.y.z`, which accumulates the pending changelog entries and version bump
2. When a maintainer merges that PR, the release workflow tags the release, publishes to npm with `--provenance`, and creates the GitHub release

There is nothing release-related to do in a feature PR beyond a correct title.

## Code Style

- We use [Biome](https://biomejs.dev/) for formatting and linting
- Run `pnpm format` before committing
- TypeScript strict mode is enabled
- Prefer functional patterns (Effect-TS is used throughout)

## Testing

- Write tests for new features and bug fixes
- Tests are located in `*.test.ts` files alongside source files
- Use [Vitest](https://vitest.dev/) for testing
- Semantic search tests require `OPENAI_API_KEY` and are skipped by default

### Running Specific Tests

```bash
# Run a specific test file
pnpm vitest run src/search/searcher.test.ts

# Run tests matching a pattern
pnpm vitest run -t "keyword search"

# Watch mode during development
pnpm test:watch
```

## Questions?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- For questions about using mdm, see the README and docs/

Thank you for contributing!
