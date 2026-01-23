# CSS Shorthand Expand - Build Commands
set shell := ["bash", "-cu"]

# Default task
default: check test

# ------------- Build & Test -------------
build:
    pnpm run build

test:
    pnpm test

coverage:
    pnpm run test:coverage

watch:
    pnpm run test:watch

# ------------- Quality Gates -------------

typecheck:
    pnpm run typecheck

lint:
    biome check .

format:
    biome format --write .

fix:
    biome check --write .

check: format fix typecheck


# test:
#     npx tsx --test src/**/*.test.ts

# check: lint format typecheck
