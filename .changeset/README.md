# Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and releases.

## Creating a changeset

When you make a change that should be released:

```bash
pnpm changeset
```

Follow the prompts to:
1. Select the package(s) to bump
2. Choose the bump type (patch/minor/major)
3. Write a summary of the change

## Release process

1. Push your changeset file with your PR
2. Once merged to main, a "Version Packages" PR is automatically created
3. When that PR is merged, packages are automatically published to npm

## Commit conventions

- `patch`: Bug fixes, documentation updates
- `minor`: New features (backwards compatible)
- `major`: Breaking changes
