import { Data } from 'effect'

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
