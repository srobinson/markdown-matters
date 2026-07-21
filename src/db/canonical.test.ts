import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import {
  belongsToAnyPrefix,
  canonicalizeSourceFile,
  type DocumentKey,
  expandDeclaredPath,
  isPathWithin,
  resolvePathWithinRoot,
  resolveSourceFile,
  selectCanonicalSource,
  sourceBelongsToPrefix,
} from './canonical.js'

const cleanup: string[] = []

const makeTempDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdm-canonical-'))
  cleanup.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((target) => fs.rm(target, { recursive: true, force: true })),
  )
})

describe('canonical document identity', () => {
  it('realpaths, tracks retargets, and collapses hardlinks deterministically', async () => {
    const dir = await makeTempDir()
    const z = path.join(dir, 'z.md')
    const a = path.join(dir, 'a.md')
    await fs.writeFile(z, '# Shared\n')
    await fs.link(z, a)

    const sources = await Effect.runPromise(
      Effect.all([canonicalizeSourceFile(z), canonicalizeSourceFile(a)]),
    )
    const selected = selectCanonicalSource(sources)
    const realA = await fs.realpath(a)
    const realZ = await fs.realpath(z)

    expect(selected.key).toBe(realA)
    expect(selected.paths).toEqual([realA, realZ])
    expect(selected.declaredPaths).toEqual([a, z])
    expect(selected.identity.device).toMatch(/^\d+$/)
    expect(selected.identity.inode).toMatch(/^\d+$/)
    expect(sourceBelongsToPrefix(selected, `${dir}${path.sep}`)).toBe(true)

    const declared = path.join(dir, 'declared.md')
    const target = path.join(dir, 'target.md')
    await fs.symlink(z, declared)
    const before = await Effect.runPromise(canonicalizeSourceFile(declared))
    await fs.writeFile(target, '# Target\n')
    await fs.unlink(declared)
    await fs.symlink(target, declared)
    const after = await Effect.runPromise(canonicalizeSourceFile(declared))

    expect(before.declaredPath).toBe(after.declaredPath)
    expect(before.key).not.toBe(after.key)
    expect(before.identity).not.toEqual(after.identity)
  })

  it('selects the lexically least raw hardlink key', async () => {
    const dir = await makeTempDir()
    const zoo = path.join(dir, 'Zoo.md')
    const apple = path.join(dir, 'apple.md')
    await fs.writeFile(zoo, '# Shared\n')
    await fs.link(zoo, apple)

    const sources = await Effect.runPromise(
      Effect.all([canonicalizeSourceFile(apple), canonicalizeSourceFile(zoo)]),
    )
    const selected = selectCanonicalSource(sources)

    expect(selected.key).toBe(await fs.realpath(zoo))
  })

  it('matches a declared prefix against realpath canonical keys', async () => {
    const dir = await makeTempDir()
    const file = path.join(dir, 'source.md')
    await fs.writeFile(file, '# Source\n')
    const source = await Effect.runPromise(canonicalizeSourceFile(file))

    expect(sourceBelongsToPrefix(selectCanonicalSource([source]), dir)).toBe(
      true,
    )
  })

  it('matches every hardlink alias against partition prefixes', async () => {
    const dir = await makeTempDir()
    const firstPrefix = path.join(dir, 'first')
    const secondPrefix = path.join(dir, 'second')
    await Promise.all([
      fs.mkdir(firstPrefix, { recursive: true }),
      fs.mkdir(secondPrefix, { recursive: true }),
    ])
    const first = path.join(firstPrefix, 'shared.md')
    const second = path.join(secondPrefix, 'shared.md')
    await fs.writeFile(first, '# Shared\n')
    await fs.link(first, second)

    const selected = selectCanonicalSource(
      await Effect.runPromise(
        Effect.all([
          canonicalizeSourceFile(first),
          canonicalizeSourceFile(second),
        ]),
      ),
    )
    const documentAliases = {
      paths: selected.paths,
      declaredPaths: selected.declaredPaths,
    }

    expect(belongsToAnyPrefix(documentAliases, [firstPrefix])).toBe(true)
    expect(belongsToAnyPrefix(documentAliases, [secondPrefix])).toBe(true)
    expect(
      belongsToAnyPrefix(documentAliases, [path.join(dir, 'second-notes')]),
    ).toBe(false)
  })

  it('folds comparison paths only when the containing volume is insensitive', async () => {
    const dir = await makeTempDir()
    const exactDir = path.join(dir, 'CaseProbe')
    const alternateDir = path.join(dir, 'caseProbe')
    await fs.mkdir(exactDir)
    const file = path.join(exactDir, 'MixedCase.md')
    await fs.writeFile(file, '# Case\n')

    const source = await Effect.runPromise(canonicalizeSourceFile(file))
    const originalStat = await fs.stat(file, { bigint: true })
    const alternatePath = path.join(alternateDir, 'MixedCase.md')
    const alternateMatches = await fs
      .stat(alternatePath, { bigint: true })
      .then(
        (alternateStat) =>
          alternateStat.dev === originalStat.dev &&
          alternateStat.ino === originalStat.ino,
      )
      .catch(() => false)

    expect(source.caseSensitive).toBe(!alternateMatches)
    expect(source.comparisonKey).toBe(
      source.caseSensitive ? source.key : source.key.toLowerCase(),
    )
    expect(
      isPathWithin(
        path.join(dir.toUpperCase(), 'MIXEDCASE.MD'),
        dir.toLowerCase(),
        false,
      ),
    ).toBe(true)
  })

  it('uses volume case behavior before lexical root containment', async () => {
    const dir = await makeTempDir()
    const exactRoot = path.join(dir, 'CaseRoot')
    const alternateRoot = path.join(dir, 'caseroot')
    const file = path.join(exactRoot, 'guide.md')
    await fs.mkdir(exactRoot)
    await fs.writeFile(file, '# Guide\n')
    const source = await Effect.runPromise(canonicalizeSourceFile(file))

    if (source.caseSensitive) return

    expect(await resolvePathWithinRoot(alternateRoot, file)).toBe(
      await fs.realpath(file),
    )
  })

  it('keeps broken links lexical and expands a leading home marker', () => {
    expect(expandDeclaredPath('~/missing/../target.md')).toBe(
      path.join(os.homedir(), 'target.md'),
    )
  })

  it('rejects sibling prefixes and normalizes trailing separators', () => {
    const parent = path.resolve('/work')
    expect(isPathWithin(path.resolve('/work-notes/a.md'), parent, true)).toBe(
      false,
    )
    expect(
      isPathWithin(
        path.join(parent, 'notes', 'a.md'),
        `${parent}${path.sep}`,
        true,
      ),
    ).toBe(true)
    expect(isPathWithin(parent, `${parent}${path.sep}`, true)).toBe(true)
  })

  it('resolves an absolute document key without adding another root', async () => {
    const dir = await makeTempDir()
    const file = path.join(dir, 'source.md')
    await fs.writeFile(file, '# Source\n')
    const source = await Effect.runPromise(canonicalizeSourceFile(file))

    expect(resolveSourceFile(source.key)).toBe(await fs.realpath(file))
    expect(() => resolveSourceFile('relative.md' as DocumentKey)).toThrow(
      'DocumentKey must be absolute',
    )
  })

  it('keeps every realpath call on the shared nonnative variant', async () => {
    const source = await fs.readFile(
      new URL('./canonical.ts', import.meta.url),
      'utf-8',
    )

    expect(source).not.toContain('realpathSync.native')
  })

  it('reports missing source files through FileReadError', async () => {
    const dir = await makeTempDir()
    const missing = path.join(dir, 'missing.md')

    const error = await Effect.runPromise(
      Effect.flip(canonicalizeSourceFile(missing)),
    )

    expect(error).toMatchObject({
      _tag: 'FileReadError',
      path: missing,
      message: `Cannot canonicalize ${missing}`,
    })
  })
})
