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
git clone https://github.com/mdm/mdm.git
cd mdm

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

## Making Changes

1. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/my-awesome-feature
   ```

2. **Make your changes** and ensure:
   - All tests pass: `pnpm test`
   - Type checking passes: `pnpm typecheck`
   - Code is formatted: `pnpm format`

3. **Create a changeset** (see below)

4. **Submit a pull request** to the `main` branch

## Changeset Workflow

We use [Changesets](https://github.com/changesets/changesets) to manage versions and releases. **Every PR that affects the published package should include a changeset.**

### Creating a Changeset

After making your changes, run:

```bash
pnpm changeset
```

This will prompt you to:
1. Select the package (mdm)
2. Choose a bump type (patch/minor/major)
3. Write a summary of your changes

A markdown file will be created in the `.changeset/` directory. **Commit this file with your PR.**

### Choosing a Bump Type

| Type | When to use | Example |
|------|-------------|---------|
| **patch** | Bug fixes, documentation updates, internal refactors | Fixing a search result formatting bug |
| **minor** | New features that are backwards compatible | Adding a new CLI flag or command |
| **major** | Breaking changes to public API or CLI | Changing command syntax, removing flags |

#### Examples

**Patch** (bug fix):
```markdown
---
"mdm": patch
---

Fixed section extraction to correctly handle nested headings
```

**Minor** (new feature):
```markdown
---
"mdm": minor
---

Added --json flag to context command for structured output
```

**Major** (breaking change):
```markdown
---
"mdm": major
---

Changed search command syntax: path argument now comes before query

Migration: `mdm search "query" path/` becomes `mdm search path/ "query"`
```

### When You Don't Need a Changeset

- Documentation-only changes (README, comments)
- Test-only changes
- CI/tooling changes that don't affect the package
- Internal refactors with no user-facing changes

If the changesets bot comments on your PR asking for a changeset and you believe one isn't needed, you can add an empty changeset:

```bash
pnpm changeset add --empty
```

## Release Process

Here's what happens after your PR is merged:

1. **Changesets are collected**: The release workflow detects changeset files in `main`

2. **Version Packages PR is created**: GitHub Actions creates a PR titled "chore: release packages" that:
   - Bumps the version in `package.json`
   - Updates `CHANGELOG.md` with your changeset descriptions
   - Deletes the changeset files

3. **Publish on merge**: When a maintainer merges the "Version Packages" PR:
   - The package is automatically published to npm
   - A GitHub release is created
   - Package provenance is attached via npm's OIDC support

### For Maintainers

To trigger a release:
1. Review the auto-generated "Version Packages" PR
2. Verify the version bump and changelog look correct
3. Merge the PR
4. The release happens automatically

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
