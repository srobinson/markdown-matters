/**
 * Batching + retry helper for the embedding capability of the runtime.
 *
 * The runtime's `EmbeddingClient` is intentionally use-case agnostic: a
 * single `embed(texts)` call goes to the API as one request. Indexing a
 * large document set, however, needs to chunk into smaller batches and
 * retry on transient failures. That logic lives here, in the consumer
 * layer, so the runtime stays minimal.
 *
 * Default behavior:
 *  - Batch size defaults to 100 documents per request.
 *  - Requests run serially unless the caller configures concurrency.
 *  - Retry up to 3 times on RateLimit/Network errors with exponential
 *    backoff plus random jitter.
 *  - Per-batch progress callback fires after each successful batch.
 *  - Aggregated `inputTokens` across batches.
 *  - Maps the runtime's generic `EmbeddingError` into the centralized
 *    `EmbeddingError` from `src/errors/index.ts` (with a `reason` field
 *    consumed by the CLI error handler) and surfaces 401-style failures
 *    as `ApiKeyInvalidError`.
 */

import { Effect } from 'effect'
import {
  ApiKeyInvalidError,
  type ApiKeyMissingError,
  EmbeddingError as ConsumerEmbeddingError,
  type EmbeddingErrorCause,
} from '../errors/index.js'
import {
  type CapabilityNotSupported,
  type ClientOverrides,
  type EmbeddingClient,
  type EmbeddingResult,
  type ProviderId,
  type ProviderNotFound,
  type EmbeddingError as RuntimeEmbeddingError,
  resolveClient,
} from '../providers/index.js'

// ============================================================================
// Types
// ============================================================================

export interface BatchProgress {
  readonly batchIndex: number
  readonly totalBatches: number
  readonly processedTexts: number
  readonly totalTexts: number
  readonly completedTextIndexes: readonly number[]
}

export interface EmbeddingExecutionOptions {
  readonly batchSize?: number | undefined
  readonly concurrency?: number | undefined
  readonly maxRetries?: number | undefined
  readonly retryDelayMs?: number | undefined
  readonly timeoutMs?: number | undefined
}

/**
 * A single input the provider refused. `textIndex` is the position in
 * the `texts` array handed to `embedInBatches`, so callers can map it
 * back to whatever produced the text.
 */
export interface InputRejection {
  readonly textIndex: number
  readonly message: string
}

export interface EmbedInBatchesOptions extends EmbeddingExecutionOptions {
  readonly model: string
  /**
   * Output dimensions, only set when the model supports Matryoshka
   * reduction. The runtime forwards this to providers that honor it
   * (OpenAI text-embedding-3-*) and ignores it elsewhere.
   */
  readonly dimensions?: number | undefined
  readonly tokenCounts?: readonly number[] | undefined
  readonly maxBatchTokens?: number | undefined
  readonly onBatchProgress?: ((progress: BatchProgress) => void) | undefined
  /** Fires once per input the provider rejected as invalid. */
  readonly onInputRejected?: ((rejection: InputRejection) => void) | undefined
  readonly signal?: AbortSignal | undefined
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BATCH_SIZE = 100
const DEFAULT_CONCURRENCY = 1
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 1000
export const EMBEDDING_REQUEST_TOKEN_LIMIT = 300_000

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify a runtime `EmbeddingError` into a `reason` for the centralized
 * `EmbeddingError`. Mirrors the fallback string-matching path of the
 * previous `OpenAIProvider.classifyError` so the CLI keeps producing the
 * same suggestions for the same failures.
 */
const classifyEmbeddingError = (
  error: RuntimeEmbeddingError,
): EmbeddingErrorCause => {
  const msg = error.message.toLowerCase()

  if (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  ) {
    return 'RateLimit'
  }

  if (
    msg.includes('quota') ||
    msg.includes('insufficient') ||
    msg.includes('billing')
  ) {
    return 'QuotaExceeded'
  }

  if (
    msg.includes('econnrefused') ||
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    msg.includes('network') ||
    msg.includes('enotfound') ||
    msg.includes('connection')
  ) {
    return 'Network'
  }

  if (
    msg.includes('model') &&
    (msg.includes('not found') ||
      msg.includes('not exist') ||
      msg.includes('invalid'))
  ) {
    return 'ModelError'
  }

  if (
    msg.includes('maximum input length') ||
    msg.includes('invalid_request_error') ||
    (msg.includes('400') && msg.includes('input'))
  ) {
    return 'InvalidInput'
  }

  return 'Unknown'
}

const isRetryable = (reason: EmbeddingErrorCause): boolean =>
  reason === 'RateLimit' || reason === 'Network'

const isInvalidApiKey = (error: RuntimeEmbeddingError): boolean => {
  const msg = error.message.toLowerCase()
  return (
    msg.includes('401') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid api key') ||
    msg.includes('invalid_api_key')
  )
}

/**
 * Convert a terminal runtime `EmbeddingError` into the consumer-facing
 * `EmbeddingError` (or `ApiKeyInvalidError` for 401-style failures).
 */
const toConsumerError = (
  error: RuntimeEmbeddingError,
): ApiKeyInvalidError | ConsumerEmbeddingError => {
  if (isInvalidApiKey(error)) {
    return new ApiKeyInvalidError({
      provider: error.provider,
      details: error.message,
    })
  }
  return new ConsumerEmbeddingError({
    reason: classifyEmbeddingError(error),
    message: error.message,
    provider: error.provider,
    cause: error.cause,
  })
}

interface RequestSignal {
  readonly signal: AbortSignal | undefined
  readonly timedOut: () => boolean
  readonly cleanup: () => void
}

const requestSignal = (
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
): RequestSignal => {
  if (timeoutMs === undefined) {
    return { signal: parent, timedOut: () => false, cleanup: () => {} }
  }

  const controller = new AbortController()
  let timeoutReached = false
  const abortFromParent = () => controller.abort(parent?.reason)
  if (parent?.aborted) abortFromParent()
  else parent?.addEventListener('abort', abortFromParent, { once: true })

  const timeoutId = setTimeout(() => {
    timeoutReached = true
    controller.abort(
      new Error(`Embedding request timed out after ${timeoutMs}ms`),
    )
  }, timeoutMs)

  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    cleanup: () => {
      clearTimeout(timeoutId)
      parent?.removeEventListener('abort', abortFromParent)
    },
  }
}

// ============================================================================
// Retry Wrapper
// ============================================================================

/**
 * Call `client.embed`, retrying RateLimit and Network categories with
 * exponential backoff and jitter. The caller controls the retry budget,
 * base delay, and request timeout.
 */
const embedBatchWithRetry = (
  client: EmbeddingClient,
  texts: readonly string[],
  options: {
    readonly model: string
    readonly dimensions?: number | undefined
    readonly signal?: AbortSignal | undefined
    readonly maxRetries?: number | undefined
    readonly retryDelayMs?: number | undefined
    readonly timeoutMs?: number | undefined
  },
): Effect.Effect<
  EmbeddingResult,
  ApiKeyInvalidError | ConsumerEmbeddingError
> =>
  Effect.gen(function* () {
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    const maxAttempts = maxRetries + 1

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const request = requestSignal(options.signal, options.timeoutMs)
      const result = yield* Effect.either(
        client.embed(texts, {
          model: options.model,
          ...(options.dimensions !== undefined
            ? { dimensions: options.dimensions }
            : {}),
          ...(request.signal !== undefined ? { signal: request.signal } : {}),
        }),
      ).pipe(Effect.ensuring(Effect.sync(request.cleanup)))

      if (result._tag === 'Right') {
        return result.right
      }

      const error = result.left

      if (isInvalidApiKey(error)) {
        return yield* Effect.fail(toConsumerError(error))
      }

      const reason = request.timedOut()
        ? 'Network'
        : classifyEmbeddingError(error)
      const isLastAttempt = attempt === maxAttempts - 1

      if (!isRetryable(reason) || isLastAttempt) {
        if (request.timedOut()) {
          return yield* Effect.fail(
            new ConsumerEmbeddingError({
              reason: 'Network',
              message: `Embedding request timed out after ${options.timeoutMs}ms`,
              provider: error.provider,
              cause: error.cause,
            }),
          )
        }
        return yield* Effect.fail(toConsumerError(error))
      }

      const baseDelay = 2 ** attempt * retryDelayMs
      const jitter = Math.random() * retryDelayMs
      const delay = Math.round(baseDelay + jitter)

      console.info(
        `[mdm] Embedding API ${reason} error, retry ${attempt + 1}/${maxRetries} after ${delay}ms`,
      )

      yield* Effect.sleep(`${delay} millis`)
    }

    // Loop exits via return/fail; the compiler needs an explicit terminus.
    return yield* Effect.fail(
      new ConsumerEmbeddingError({
        reason: 'Unknown',
        message: 'embedBatchWithRetry: unreachable',
      }),
    )
  })

// ============================================================================
// Rejection Isolation
// ============================================================================

type BatchRetryOptions = Parameters<typeof embedBatchWithRetry>[2]

const isInvalidInput = (
  error: ApiKeyInvalidError | ConsumerEmbeddingError,
): boolean => error._tag === 'EmbeddingError' && error.reason === 'InvalidInput'

/**
 * Embed one batch, isolating inputs the provider refuses.
 *
 * A provider rejects the whole request when a single input is invalid
 * (an over-long section, say), and it never says which one in a form we
 * can trust across providers. Bisect instead: split the batch until the
 * offending input stands alone, drop it, and keep the rest. Dropped
 * positions come back as empty vectors so the result stays aligned with
 * `texts`; callers skip them.
 *
 * One bad section costs O(log n) extra requests. It no longer costs the
 * whole index build.
 */
const embedBatchIsolatingRejections = (
  client: EmbeddingClient,
  texts: readonly string[],
  textIndexes: readonly number[],
  options: BatchRetryOptions,
  onInputRejected: ((rejection: InputRejection) => void) | undefined,
): Effect.Effect<
  EmbeddingResult,
  ApiKeyInvalidError | ConsumerEmbeddingError
> =>
  embedBatchWithRetry(client, texts, options).pipe(
    Effect.catchIf(isInvalidInput, (error) => {
      if (texts.length === 1) {
        onInputRejected?.({
          textIndex: textIndexes[0] ?? 0,
          message: error.message,
        })
        return Effect.succeed({
          embeddings: [[]],
          model: options.model,
          usage: { inputTokens: 0 },
        } satisfies EmbeddingResult)
      }

      const middle = Math.ceil(texts.length / 2)
      return Effect.zipWith(
        embedBatchIsolatingRejections(
          client,
          texts.slice(0, middle),
          textIndexes.slice(0, middle),
          options,
          onInputRejected,
        ),
        embedBatchIsolatingRejections(
          client,
          texts.slice(middle),
          textIndexes.slice(middle),
          options,
          onInputRejected,
        ),
        (left, right) =>
          ({
            embeddings: [...left.embeddings, ...right.embeddings],
            model: right.model,
            usage: {
              inputTokens:
                (left.usage?.inputTokens ?? 0) +
                (right.usage?.inputTokens ?? 0),
            },
          }) satisfies EmbeddingResult,
      )
    }),
  )

// ============================================================================
// Client Factory
// ============================================================================

/**
 * Resolve an `EmbeddingClient` for the given provider id.
 *
 * Thin wrapper over the runtime-layer `resolveClient` entry point so
 * the embed consumer does not own any provider-dispatch logic. See
 * `src/providers/resolve-client.ts` for the full fast-path vs
 * override-path contract.
 */
export const createEmbeddingClient = (
  id: ProviderId,
  overrides?: ClientOverrides,
): Effect.Effect<
  EmbeddingClient,
  ApiKeyMissingError | CapabilityNotSupported | ProviderNotFound
> => resolveClient('embed', id, overrides)

interface EmbeddingBatch {
  readonly index: number
  readonly texts: readonly string[]
  readonly textIndexes: readonly number[]
}

const createEmbeddingBatches = (
  texts: readonly string[],
  batchSize: number,
  tokenCounts: readonly number[] | undefined,
  maxBatchTokens: number,
): readonly EmbeddingBatch[] => {
  const batches: EmbeddingBatch[] = []
  let batchTexts: string[] = []
  let textIndexes: number[] = []
  let batchTokens = 0

  const flush = () => {
    if (batchTexts.length === 0) return
    batches.push({ index: batches.length, texts: batchTexts, textIndexes })
    batchTexts = []
    textIndexes = []
    batchTokens = 0
  }

  for (let index = 0; index < texts.length; index++) {
    const tokenCount = tokenCounts?.[index] ?? 0
    if (
      batchTexts.length > 0 &&
      (batchTexts.length >= batchSize ||
        batchTokens + tokenCount > maxBatchTokens)
    ) {
      flush()
    }
    batchTexts.push(texts[index]!)
    textIndexes.push(index)
    batchTokens += tokenCount
  }
  flush()
  return batches
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Embed `texts` through the runtime client in batches of `batchSize`,
 * retrying on transient errors and emitting progress per batch.
 *
 * Returns a single aggregated `EmbeddingResult` whose `embeddings` array
 * preserves input order and whose `usage.inputTokens` is the sum of
 * per-batch token counts. `cost` is left unset; consumers compute cost
 * from the token count + `lookupPricing('embed', model)`.
 */
export const embedInBatches = (
  client: EmbeddingClient,
  texts: readonly string[],
  options: EmbedInBatchesOptions,
): Effect.Effect<
  EmbeddingResult,
  ApiKeyInvalidError | ConsumerEmbeddingError
> =>
  Effect.gen(function* () {
    if (texts.length === 0) {
      return {
        embeddings: [],
        model: options.model,
        usage: { inputTokens: 0 },
      } satisfies EmbeddingResult
    }

    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
    const batches = createEmbeddingBatches(
      texts,
      batchSize,
      options.tokenCounts,
      options.maxBatchTokens ?? EMBEDDING_REQUEST_TOKEN_LIMIT,
    )
    const totalBatches = batches.length
    let completedBatches = 0
    let processedTexts = 0

    const results = yield* Effect.forEach(
      batches,
      (batch) =>
        embedBatchIsolatingRejections(
          client,
          batch.texts,
          batch.textIndexes,
          {
            model: options.model,
            dimensions: options.dimensions,
            signal: options.signal,
            maxRetries: options.maxRetries,
            retryDelayMs: options.retryDelayMs,
            timeoutMs: options.timeoutMs,
          },
          options.onInputRejected,
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              completedBatches++
              processedTexts += batch.texts.length
              options.onBatchProgress?.({
                batchIndex: completedBatches,
                totalBatches,
                processedTexts,
                totalTexts: texts.length,
                completedTextIndexes: batch.textIndexes,
              })
            }),
          ),
          Effect.map((result) => ({ index: batch.index, result })),
        ),
      { concurrency },
    )
    results.sort((left, right) => left.index - right.index)

    const allEmbeddings = results.flatMap(({ result }) => result.embeddings)
    const totalTokens = results.reduce(
      (total, { result }) => total + (result.usage?.inputTokens ?? 0),
      0,
    )
    const resolvedModel = results.at(-1)?.result.model ?? options.model

    return {
      embeddings: allEmbeddings,
      model: resolvedModel,
      usage: { inputTokens: totalTokens },
    } satisfies EmbeddingResult
  })
