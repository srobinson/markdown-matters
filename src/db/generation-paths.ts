import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Effect } from 'effect'
import { FileReadError } from '../errors/index.js'
import { resolveMdmHome } from '../home.js'
import { GenerationPathError } from './generation-errors.js'
import type {
  GenerationHomeLayout,
  GenerationLayout,
  GenerationName,
} from './generation-types.js'

const GENERATION_NAME_PATTERN = /^gen-[1-9][0-9]*$/
const STAGING_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

const portablePath = (value: string): string => value.split(path.sep).join('/')

const normalizeHome = (home: string): string =>
  resolveMdmHome({ env: { MDM_HOME: home } })

const invalidGenerationName = (raw: string): GenerationPathError =>
  new GenerationPathError({
    path: raw,
    reason: 'InvalidGenerationName',
    message: `Invalid generation name: ${JSON.stringify(raw)}`,
  })

const assertGenerationName = (raw: string): GenerationName => {
  if (!GENERATION_NAME_PATTERN.test(raw)) {
    throw invalidGenerationName(raw)
  }
  return raw as GenerationName
}

const containedPath = (
  home: string,
  candidate: string,
  label: string,
): string => {
  const resolvedHome = path.resolve(home)
  const resolvedCandidate = path.resolve(candidate)
  const relative = path.relative(resolvedHome, resolvedCandidate)
  const contained =
    relative !== '' &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)

  if (!contained) {
    throw new GenerationPathError({
      path: portablePath(resolvedCandidate),
      reason: 'OutsideHome',
      message: `${label} must resolve beneath the MDM home`,
    })
  }

  return portablePath(resolvedCandidate)
}

export const generationHomeLayout = (home: string): GenerationHomeLayout => {
  const normalizedHome = normalizeHome(home)
  return {
    home: portablePath(normalizedHome),
    current: containedPath(
      normalizedHome,
      path.join(normalizedHome, 'current'),
      'Current pointer',
    ),
    staging: containedPath(
      normalizedHome,
      path.join(normalizedHome, 'staging'),
      'Staging root',
    ),
    writerLock: containedPath(
      normalizedHome,
      path.join(normalizedHome, 'writer.lock'),
      'Writer lock',
    ),
    writerReclaim: containedPath(
      normalizedHome,
      path.join(normalizedHome, 'writer.reclaim'),
      'Writer reclaim marker',
    ),
  }
}

export const parseGenerationName = (
  raw: string,
): Effect.Effect<GenerationName, GenerationPathError> =>
  GENERATION_NAME_PATTERN.test(raw)
    ? Effect.succeed(raw as GenerationName)
    : Effect.fail(invalidGenerationName(raw))

export const generationLayout = (
  home: string,
  name: GenerationName,
): GenerationLayout => {
  const normalizedName = assertGenerationName(name)
  const normalizedHome = normalizeHome(home)
  const root = containedPath(
    normalizedHome,
    path.join(normalizedHome, normalizedName),
    'Generation root',
  )
  const leasesRoot = containedPath(
    normalizedHome,
    path.join(root, 'leases'),
    'Lease root',
  )

  return {
    home: portablePath(normalizedHome),
    name: normalizedName,
    root,
    leasesRoot,
    openLeases: containedPath(
      normalizedHome,
      path.join(leasesRoot, 'open'),
      'Open lease directory',
    ),
    closedLeases: containedPath(
      normalizedHome,
      path.join(leasesRoot, 'closed'),
      'Closed lease directory',
    ),
  }
}

export const stagingGenerationPath = (
  home: string,
  name: GenerationName,
  token: string,
): string => {
  const normalizedName = assertGenerationName(name)
  if (!STAGING_TOKEN_PATTERN.test(token)) {
    throw new GenerationPathError({
      path: token,
      reason: 'InvalidStagingToken',
      message: `Invalid staging token: ${JSON.stringify(token)}`,
    })
  }

  const layout = generationHomeLayout(home)
  return containedPath(
    layout.home,
    path.join(layout.staging, `${normalizedName}-${token}`),
    'Staged generation',
  )
}

export const readCurrentGeneration = (
  home: string,
): Effect.Effect<GenerationName | null, FileReadError | GenerationPathError> =>
  Effect.gen(function* () {
    const layout = generationHomeLayout(home)
    const pointerStat = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await fs.lstat(layout.current)
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ENOENT'
          ) {
            return null
          }
          throw error
        }
      },
      catch: (error) =>
        new FileReadError({
          path: layout.current,
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        }),
    })

    if (pointerStat === null) return null
    if (!pointerStat.isFile()) {
      return yield* new GenerationPathError({
        path: layout.current,
        reason: 'InvalidPointerType',
        message: 'Current pointer must be a regular file',
      })
    }

    const contents = yield* Effect.tryPromise({
      try: () => fs.readFile(layout.current, 'utf8'),
      catch: (error) =>
        new FileReadError({
          path: layout.current,
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        }),
    })
    const name = yield* parseGenerationName(contents)
    generationLayout(layout.home, name)
    return name
  })

export const nextGenerationName = (
  existing: readonly GenerationName[],
): GenerationName => {
  const highest = existing.reduce((maximum, name) => {
    const normalizedName = assertGenerationName(name)
    const value = BigInt(normalizedName.slice('gen-'.length))
    return value > maximum ? value : maximum
  }, 0n)

  return `gen-${highest + 1n}` as GenerationName
}
