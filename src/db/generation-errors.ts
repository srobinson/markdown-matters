import { Data } from 'effect'

export const errorCode = (cause: unknown): string | undefined => {
  const seen = new Set<unknown>()
  let current = cause
  while (
    typeof current === 'object' &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current)
    if ('code' in current && typeof current.code === 'string') {
      return current.code
    }
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}

export type GenerationPathErrorReason =
  | 'InvalidGenerationName'
  | 'InvalidPointerType'
  | 'OutsideHome'
  | 'InvalidStagingToken'

export class GenerationPathError extends Data.TaggedError(
  'GenerationPathError',
)<{
  readonly path: string
  readonly reason: GenerationPathErrorReason
  readonly message: string
  readonly cause?: unknown
}> {}

export type GenerationDurabilityOperation =
  | 'link'
  | 'read-directory'
  | 'rename'
  | 'sync-directory'
  | 'sync-file'
  | 'unlink'
  | 'write-file'

export class GenerationDurabilityError extends Data.TaggedError(
  'GenerationDurabilityError',
)<{
  readonly operation: GenerationDurabilityOperation
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}

export type ProcessIdentityOperation = 'current' | 'inspect'

export class ProcessIdentityError extends Data.TaggedError(
  'ProcessIdentityError',
)<{
  readonly operation: ProcessIdentityOperation
  readonly pid: number
  readonly message: string
  readonly cause?: unknown
}> {}

export type WriterLockOperation = 'acquire' | 'read' | 'reclaim' | 'release'

export class WriterLockError extends Data.TaggedError('WriterLockError')<{
  readonly operation: WriterLockOperation
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}

export type GenerationReadOperation =
  | 'initialize-gate'
  | 'insert-lease'
  | 'read-current'
  | 'release-lease'
  | 'verify-lease'

export type GenerationReadErrorReason = 'NoCurrentGeneration'

export class GenerationReadError extends Data.TaggedError(
  'GenerationReadError',
)<{
  readonly operation: GenerationReadOperation
  readonly path: string
  readonly reason?: GenerationReadErrorReason
  readonly message: string
  readonly cause?: unknown
}> {}

export class GenerationValidationError extends Data.TaggedError(
  'GenerationValidationError',
)<{
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}

export type GenerationCommitState = 'not-published' | 'published'

export class GenerationWriteError extends Data.TaggedError(
  'GenerationWriteError',
)<{
  readonly commitState: GenerationCommitState
  readonly generation: import('./generation-types.js').GenerationName | null
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}

export type GenerationReaperOperation =
  | 'close-gate'
  | 'delete-generation'
  | 'inspect-generation'
  | 'inspect-lease'
  | 'remove-lease'

export class GenerationReaperError extends Data.TaggedError(
  'GenerationReaperError',
)<{
  readonly operation: GenerationReaperOperation
  readonly path: string
  readonly message: string
  readonly cause?: unknown
}> {}
