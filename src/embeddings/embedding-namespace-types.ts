/**
 * Active provider configuration stored in active-provider.json.
 */
export interface ActiveProvider {
  /** Namespace directory name, for example openai_text-embedding-3-small_512. */
  readonly namespace: string
  readonly provider: string
  readonly model: string
  readonly dimensions: number
  readonly activatedAt: string
}

/**
 * Information about an available embedding namespace.
 */
export interface EmbeddingNamespace {
  readonly namespace: string
  readonly provider: string
  readonly model: string
  readonly dimensions: number
  readonly vectorCount: number
  readonly totalCost: number
  readonly totalTokens: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly isActive: boolean
  readonly sizeBytes: number
}

export class EmbeddingNamespaceError extends Error {
  readonly _tag = 'EmbeddingNamespaceError'
  readonly operation: string
  readonly cause?: unknown

  constructor(params: { operation: string; message: string; cause?: unknown }) {
    super(params.message)
    this.name = 'EmbeddingNamespaceError'
    this.operation = params.operation
    this.cause = params.cause
  }
}
