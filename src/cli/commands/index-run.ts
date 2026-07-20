import { Console, Effect } from 'effect'

import { getConfigValue } from '../../config/service.js'
import { dbIndexDir, resolveMdmHome } from '../../home.js'
import { refreshManifestIndex } from '../../index/manifest-refresh.js'
import { ManifestError, manifestPath } from '../../manifest.js'
import {
  type EmbeddingRefreshInput,
  runEmbeddingRefresh,
} from './index-embeddings.js'
import { clearIndexProgress, renderIndexResult } from './index-output.js'

export interface IndexCommandInput extends EmbeddingRefreshInput {
  readonly path: string | undefined
  readonly exclude: string | undefined
  readonly noGitignore: boolean
  readonly watch: boolean
  readonly pretty: boolean
}

const parseExcludePatterns = (
  exclude: string | undefined,
): readonly string[] | undefined =>
  exclude?.split(',').map((pattern) => pattern.trim())

const rejectManifestWatch = (home: string) =>
  Effect.fail(
    new ManifestError({
      path: manifestPath(home),
      message:
        'Multi-root manifest watching is not available yet. Run mdm index to refresh the manifest.',
    }),
  )

export const runIndexCommand = (input: IndexCommandInput) =>
  Effect.gen(function* () {
    const home = resolveMdmHome({ create: true })
    if (input.watch) return yield* rejectManifestWatch(home)

    const indexRoot = dbIndexDir(home)
    const colorEnabled = yield* getConfigValue('output', 'color')
    const showProgress = Boolean(process.stdout.isTTY && colorEnabled)
    const exclude = parseExcludePatterns(input.exclude)

    yield* Console.log(
      input.path === undefined
        ? 'Refreshing manifest index...'
        : `Adding ${input.path} and refreshing manifest index...`,
    )

    const result = yield* refreshManifestIndex(home, input.path, {
      force: input.force,
      exclude,
      honorGitignore: !input.noGitignore,
      onProgress: (progress) => {
        if (!input.json && showProgress) {
          process.stdout.write(
            `\x1b[2K\r  [${progress.current}/${progress.total}] ${progress.filePath}`,
          )
        }
      },
    })

    clearIndexProgress(!input.json && showProgress)
    if (!input.json) {
      yield* renderIndexResult(result, {
        json: false,
        pretty: input.pretty,
      })
    }

    yield* runEmbeddingRefresh(input, {
      sourceRoot: home,
      indexRoot,
      showProgress,
    })

    if (input.json) {
      yield* renderIndexResult(result, {
        json: true,
        pretty: input.pretty,
      })
    }
  })
