import type { EmbeddingErrorCause } from '../errors/index.js'
import { EmbeddingError } from '../errors/index.js'

export interface RetryOptions {
  readonly maxRetries: number
  readonly retryDelayMs: number
  readonly classifyError: (error: unknown) => EmbeddingErrorCause
}

const isRetryable = (cause: EmbeddingErrorCause): boolean =>
  cause === 'RateLimit' || cause === 'Network'

const getRetryDelay = (attempt: number, baseDelayMs: number): number =>
  Math.max(0, baseDelayMs) * 2 ** attempt

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export const retryEmbeddingOperation = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> => {
  let attempt = 0

  while (true) {
    try {
      return await operation()
    } catch (error) {
      const cause =
        error instanceof EmbeddingError
          ? error.reason
          : options.classifyError(error)

      if (!isRetryable(cause) || attempt >= options.maxRetries) {
        throw error
      }

      await sleep(getRetryDelay(attempt, options.retryDelayMs))
      attempt += 1
    }
  }
}
