import { Console, Effect } from 'effect'

import { getConfigSection, getConfigValue } from '../../config/service.js'
import { resolveMdmHome } from '../../home.js'
import { refreshManifestIndex } from '../../index/manifest-refresh.js'
import { ManifestError, manifestPath } from '../../manifest.js'
import {
  type EmbeddingRefreshInput,
  renderSemanticRefresh,
  semanticRefreshOptions,
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

    const colorEnabled = yield* getConfigValue('output', 'color')
    const embeddingsConfig = yield* getConfigSection('embeddings')
    const showProgress = Boolean(process.stdout.isTTY && colorEnabled)
    const exclude = parseExcludePatterns(input.exclude)

    yield* Console.log(
      input.path === undefined
        ? 'Refreshing manifest index...'
        : `Indexing ${input.path}...`,
    )

    const published = yield* refreshManifestIndex(home, input.path, {
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
      semantic: semanticRefreshOptions(input, showProgress, embeddingsConfig),
    })
    const result = published.value

    clearIndexProgress(!input.json && showProgress)
    yield* renderSemanticRefresh(published.semantic, input, showProgress)
    if (!input.json) {
      yield* renderIndexResult(result, {
        json: false,
        pretty: input.pretty,
      })
    }

    if (input.json) {
      yield* renderIndexResult(result, {
        json: true,
        pretty: input.pretty,
      })
    }
  })
