import { Console, Effect } from 'effect'

import { indexSummaryLines } from '../../index/summary.js'
import type { IndexResult } from '../../index/types.js'
import { formatJson } from '../utils.js'

export interface IndexOutputOptions {
  readonly json: boolean
  readonly pretty: boolean
}

export const clearIndexProgress = (showProgress: boolean): void => {
  if (showProgress) process.stdout.write('\x1b[2K\r')
}

export const renderIndexResult = (
  result: IndexResult,
  options: IndexOutputOptions,
) =>
  Effect.gen(function* () {
    if (options.json) {
      yield* Console.log(formatJson(result, options.pretty))
      return
    }

    yield* Console.log('')
    for (const line of indexSummaryLines(result)) {
      yield* Console.log(line)
    }

    if (result.errors.length === 0) return

    yield* Console.log('')
    yield* Console.log(`Errors (${result.errors.length}):`)
    for (const error of result.errors) {
      yield* Console.log(`  ${error.path}: ${error.message}`)
    }
  })
