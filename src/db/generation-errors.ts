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
