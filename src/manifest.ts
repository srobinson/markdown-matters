import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { Data, Effect } from 'effect'
import { stringify, type TomlTable } from 'smol-toml'

import { type DeclaredPath, expandDeclaredPath } from './db/canonical.js'
import { loadTomlDocumentWithStatus } from './toml.js'

export interface ManifestDirectory {
  readonly path: DeclaredPath
  readonly recurse: boolean
  readonly depth?: number | undefined
}

export interface MdmManifest {
  readonly directories: readonly ManifestDirectory[]
}

export class ManifestError extends Data.TaggedError('ManifestError')<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}

export const manifestPath = (home: string): string =>
  path.join(home, 'manifest.toml')

const decodeDirectory = (
  value: unknown,
  filePath: string,
): ManifestDirectory => {
  if (!value || typeof value !== 'object') {
    throw new ManifestError({
      path: filePath,
      message: 'Each [[dir]] must be a table',
    })
  }

  const raw = value as Record<string, unknown>
  if (typeof raw.path !== 'string' || raw.path.trim() === '') {
    throw new ManifestError({
      path: filePath,
      message: 'Each [[dir]] needs a non-empty path',
    })
  }

  const recurse = raw.recurse ?? true
  if (typeof recurse !== 'boolean') {
    throw new ManifestError({
      path: filePath,
      message: 'dir.recurse must be a boolean',
    })
  }

  const depth = raw.depth
  if (
    depth !== undefined &&
    (!Number.isInteger(depth) || (depth as number) < 0)
  ) {
    throw new ManifestError({
      path: filePath,
      message: 'dir.depth must be a non-negative integer',
    })
  }
  if (recurse === false && typeof depth === 'number' && depth > 0) {
    throw new ManifestError({
      path: filePath,
      message: 'dir.depth cannot be positive when recurse is false',
    })
  }

  return {
    path: expandDeclaredPath(raw.path),
    recurse,
    ...(typeof depth === 'number' ? { depth } : {}),
  }
}

const decodeManifest = (value: TomlTable, filePath: string): MdmManifest => ({
  directories: Array.isArray(value.dir)
    ? value.dir.map((entry) => decodeDirectory(entry, filePath))
    : [],
})

export const loadManifest = (
  home: string,
): Effect.Effect<MdmManifest, ManifestError> => {
  const filePath = manifestPath(home)
  const result = loadTomlDocumentWithStatus(filePath)
  if (result.status === 'missing') {
    return Effect.succeed({ directories: [] })
  }
  if (result.status === 'error') {
    return Effect.fail(new ManifestError({ ...result.error }))
  }

  return Effect.try({
    try: () => decodeManifest(result.value, filePath),
    catch: (cause) =>
      cause instanceof ManifestError
        ? cause
        : new ManifestError({
            path: filePath,
            message: String(cause),
            cause,
          }),
  })
}

const toTomlTable = (entry: ManifestDirectory): TomlTable => ({
  path: entry.path,
  ...(entry.recurse === false ? { recurse: false } : {}),
  ...(entry.depth !== undefined ? { depth: entry.depth } : {}),
})

const readManifestText = async (filePath: string): Promise<string> => {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      return ''
    }
    throw cause
  }
}

const appendDirectoryBlock = async (
  home: string,
  filePath: string,
  entry: ManifestDirectory,
): Promise<void> => {
  await fs.mkdir(home, { recursive: true })
  const current = await readManifestText(filePath)
  const block = stringify({ dir: [toTomlTable(entry)] }).trim()
  const separator = current ? `${current.endsWith('\n') ? '' : '\n'}\n` : ''
  await fs.writeFile(filePath, `${current}${separator}${block}\n`)
}

export const appendManifestDirectory = (
  home: string,
  input: {
    readonly path: string
    readonly recurse?: boolean
    readonly depth?: number
  },
): Effect.Effect<
  { readonly manifest: MdmManifest; readonly added: boolean },
  ManifestError
> =>
  Effect.gen(function* () {
    const filePath = manifestPath(home)
    const manifest = yield* loadManifest(home)
    const entry = decodeDirectory(input, filePath)

    if (
      manifest.directories.some((directory) => directory.path === entry.path)
    ) {
      return { manifest, added: false }
    }

    yield* Effect.tryPromise({
      try: () => appendDirectoryBlock(home, filePath, entry),
      catch: (cause) =>
        new ManifestError({
          path: filePath,
          message: 'Cannot update manifest',
          cause,
        }),
    })

    return {
      manifest: { directories: [...manifest.directories, entry] },
      added: true,
    }
  })
