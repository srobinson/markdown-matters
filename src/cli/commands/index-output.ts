import { Console, Effect } from 'effect'

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
    const newlyIndexed =
      result.documentsIndexed < result.totalDocuments
        ? ` (${result.documentsIndexed} updated)`
        : ''
    yield* Console.log(
      `Indexed ${result.totalDocuments} documents${newlyIndexed}`,
    )
    yield* Console.log(`  Sections: ${result.totalSections}`)
    yield* Console.log(`  Links: ${result.totalLinks}`)
    yield* Console.log(`  Duration: ${result.duration}ms`)

    if (result.skipped.total > 0) {
      const skipParts: string[] = []
      if (result.skipped.unchanged > 0) {
        skipParts.push(`${result.skipped.unchanged} unchanged`)
      }
      if (result.skipped.hidden > 0) {
        skipParts.push(`${result.skipped.hidden} hidden`)
      }
      if (result.skipped.excluded > 0) {
        skipParts.push(`${result.skipped.excluded} excluded`)
      }
      yield* Console.log(`  Skipped: ${skipParts.join(', ')}`)
    }

    if (result.errors.length === 0) return

    yield* Console.log('')
    yield* Console.log(`Errors (${result.errors.length}):`)
    for (const error of result.errors) {
      yield* Console.log(`  ${error.path}: ${error.message}`)
    }
  })
