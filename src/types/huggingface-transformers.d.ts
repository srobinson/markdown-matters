/**
 * Type declarations for @huggingface/transformers (optional dependency)
 *
 * This package is an optional peer dependency used for cross-encoder re-ranking.
 * Users who want re-ranking can install it with: npm install @huggingface/transformers
 */

declare module '@huggingface/transformers' {
  export interface ProgressCallbackData {
    file?: string
    progress?: number
  }

  export type ProgressCallback = (data: ProgressCallbackData) => void

  export interface AutoModelOptions {
    progress_callback?: ProgressCallback | undefined
  }

  export interface AutoTokenizerOptions {
    progress_callback?: ProgressCallback | undefined
  }

  export interface TokenizerOutput {
    input_ids: unknown
    attention_mask: unknown
  }

  export interface ModelOutput {
    logits: {
      data: Float32Array
    }
  }

  export const env: {
    cacheDir: string
  }

  export type AutoTokenizerInstance = (
    texts: string[],
    options: {
      text_pair?: string[]
      padding?: boolean
      truncation?: boolean
      max_length?: number
    },
  ) => TokenizerOutput

  export type AutoModelInstance = (
    input: TokenizerOutput,
  ) => Promise<ModelOutput>

  export const AutoTokenizer: {
    from_pretrained(
      model: string,
      options?: AutoTokenizerOptions,
    ): Promise<AutoTokenizerInstance>
  }

  export const AutoModelForSequenceClassification: {
    from_pretrained(
      model: string,
      options?: AutoModelOptions,
    ): Promise<AutoModelInstance>
  }
}
