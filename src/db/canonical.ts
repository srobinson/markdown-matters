import { realpathSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { Effect, Schema } from 'effect'

import { FileReadError } from '../errors/index.js'

declare const keyBrand: unique symbol
declare const declaredBrand: unique symbol

export type DocumentKey = string & {
  readonly [keyBrand]: 'DocumentKey'
}

export type DeclaredPath = string & {
  readonly [declaredBrand]: 'DeclaredPath'
}

export const CANONICAL_SCHEMA_VERSION = 2 as const

const isAbsoluteNormalizedPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  path.isAbsolute(value) &&
  path.normalize(value) === value

export const isDocumentKey = (value: unknown): value is DocumentKey =>
  isAbsoluteNormalizedPath(value)

export const isDeclaredPath = (value: unknown): value is DeclaredPath =>
  isAbsoluteNormalizedPath(value)

export const DocumentKeySchema = Schema.declare(isDocumentKey, {
  identifier: 'DocumentKey',
})

export const DeclaredPathSchema = Schema.declare(isDeclaredPath, {
  identifier: 'DeclaredPath',
})

export interface FileIdentity {
  readonly device: string
  readonly inode: string
}

export interface CanonicalSource {
  readonly key: DocumentKey
  readonly declaredPath: DeclaredPath
  readonly comparisonKey: string
  readonly identity: FileIdentity
  readonly caseSensitive: boolean
}

export interface CanonicalSourceSelection
  extends Omit<CanonicalSource, 'declaredPath'> {
  readonly paths: readonly DocumentKey[]
  readonly declaredPaths: readonly DeclaredPath[]
}

export interface CanonicalSourceAliases {
  readonly paths: readonly DocumentKey[]
  readonly declaredPaths: readonly DeclaredPath[]
  readonly caseSensitive?: boolean
}

export type CaseSensitivityProbe = (
  key: string,
  device: bigint,
  inode: bigint,
) => Promise<boolean>

export const expandDeclaredPath = (value: string): DeclaredPath => {
  const expanded = value.replace(/^~(?=$|[\\/])/, os.homedir())
  return path.resolve(path.normalize(expanded)) as DeclaredPath
}

const resolveCanonicalFilePath = (value: string): Promise<string> =>
  fs.realpath(value)

const resolveCanonicalPathSync = (value: string): string => realpathSync(value)

export const resolveCanonicalPathOrFallback = (value: string): string => {
  const declaredPath = expandDeclaredPath(value)
  try {
    return resolveCanonicalPathSync(declaredPath)
  } catch {
    return declaredPath
  }
}

const asciiCaseVariantInRange = (
  value: string,
  start: number,
  end: number,
): string | undefined => {
  for (let index = start; index >= end; index -= 1) {
    const character = value.charAt(index)
    if (character >= 'a' && character <= 'z') {
      return `${value.slice(0, index)}${character.toUpperCase()}${value.slice(index + 1)}`
    }
    if (character >= 'A' && character <= 'Z') {
      return `${value.slice(0, index)}${character.toLowerCase()}${value.slice(index + 1)}`
    }
  }
  return undefined
}

const asciiCaseVariant = (value: string): string | undefined => {
  const basenameStart = value.lastIndexOf(path.sep) + 1
  return (
    asciiCaseVariantInRange(value, basenameStart - 2, 0) ??
    asciiCaseVariantInRange(value, value.length - 1, basenameStart)
  )
}

export const probeCaseSensitivity: CaseSensitivityProbe = async (
  key: string,
  device: bigint,
  inode: bigint,
): Promise<boolean> => {
  const variant = asciiCaseVariant(key)
  if (variant === undefined) return true

  try {
    const variantStat = await fs.stat(variant, { bigint: true })
    return variantStat.dev !== device || variantStat.ino !== inode
  } catch {
    return true
  }
}

export const canonicalizeSourceFile = (
  value: string,
  caseSensitivityProbe: CaseSensitivityProbe = probeCaseSensitivity,
): Effect.Effect<CanonicalSource, FileReadError> =>
  Effect.tryPromise({
    try: async () => {
      const declaredPath = expandDeclaredPath(value)
      const key = (await resolveCanonicalFilePath(declaredPath)) as DocumentKey
      const stat = await fs.stat(key, { bigint: true })
      const caseSensitive = await caseSensitivityProbe(key, stat.dev, stat.ino)

      return {
        key,
        declaredPath,
        comparisonKey: caseSensitive ? key : key.toLowerCase(),
        identity: {
          device: String(stat.dev),
          inode: String(stat.ino),
        },
        caseSensitive,
      }
    },
    catch: (cause) =>
      new FileReadError({
        path: value,
        message: `Cannot canonicalize ${value}`,
        cause,
      }),
  })

const compareText = (left: string, right: string): number => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const compareCanonicalSources = (
  left: CanonicalSource,
  right: CanonicalSource,
): number =>
  compareText(left.key, right.key) ||
  compareText(left.declaredPath, right.declaredPath)

export const fileIdentityKey = ({ device, inode }: FileIdentity): string =>
  `${device}:${inode}`

export const selectCanonicalSource = (
  group: readonly CanonicalSource[],
): CanonicalSourceSelection => {
  const sorted = [...group].sort(compareCanonicalSources)
  const primary = sorted[0]
  if (primary === undefined) {
    throw new TypeError('Cannot select a canonical source from an empty group')
  }

  const expectedIdentity = fileIdentityKey(primary.identity)
  if (
    sorted.some(
      (source) => fileIdentityKey(source.identity) !== expectedIdentity,
    )
  ) {
    throw new TypeError(
      'Canonical source group contains multiple file identities',
    )
  }

  return {
    key: primary.key,
    comparisonKey: primary.comparisonKey,
    identity: primary.identity,
    caseSensitive: primary.caseSensitive,
    paths: [...new Set(sorted.map(({ key }) => key))],
    declaredPaths: [...new Set(sorted.map(({ declaredPath }) => declaredPath))],
  }
}

export const isPathWithin = (
  candidate: string,
  parent: string,
  caseSensitive: boolean,
): boolean => {
  const fold = (value: string): string => {
    const resolved = path.resolve(value)
    return caseSensitive ? resolved : resolved.toLowerCase()
  }
  const relative = path.relative(fold(parent), fold(candidate))
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  )
}

export const sourceBelongsToPrefix = (
  source: CanonicalSourceSelection,
  prefix: string,
): boolean => belongsToAnyPrefix(source, [prefix])

const belongsToPrefix = (
  source: CanonicalSourceAliases,
  prefix: string,
): boolean => {
  const caseSensitive = source.caseSensitive ?? true
  const declaredPrefix = expandDeclaredPath(prefix)
  if (
    source.declaredPaths.some((declaredPath) =>
      isPathWithin(declaredPath, declaredPrefix, caseSensitive),
    )
  ) {
    return true
  }
  const canonicalPrefix = resolveCanonicalPathOrFallback(declaredPrefix)
  return source.paths.some((key) =>
    isPathWithin(key, canonicalPrefix, caseSensitive),
  )
}

export const belongsToAnyPrefix = (
  source: CanonicalSourceAliases,
  prefixes: readonly string[],
): boolean => prefixes.some((prefix) => belongsToPrefix(source, prefix))

export const resolveSourceFile = (key: DocumentKey): string => {
  if (!path.isAbsolute(key)) {
    throw new TypeError(`DocumentKey must be absolute: ${key}`)
  }
  return path.normalize(key)
}
