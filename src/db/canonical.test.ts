import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import {
  canonicalizeSourceFile,
  type DocumentKey,
  expandDeclaredPath,
  isPathWithin,
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
    const canonicalDir = await fs.realpath(dir)

    expect(selected.key).toBe(realA)
    expect(selected.paths).toEqual([realA, realZ])
    expect(selected.declaredPaths).toEqual([a, z])
    expect(selected.identity.device).toMatch(/^\d+$/)
    expect(selected.identity.inode).toMatch(/^\d+$/)
    expect(sourceBelongsToPrefix(selected, `${canonicalDir}${path.sep}`)).toBe(
      true,
    )

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
