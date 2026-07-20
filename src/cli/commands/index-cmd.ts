import { Args, Command, Options } from '@effect/cli'
import { Option } from 'effect'

import { forceOption, jsonOption, prettyOption } from '../options.js'
import { runIndexCommand } from './index-run.js'

const pathArg = Args.directory({ name: 'path' }).pipe(
  Args.withDescription('Directory to append before refreshing the manifest'),
  Args.optional,
)

const embedOption = Options.boolean('embed').pipe(
  Options.withAlias('e'),
  Options.withDescription('Also build semantic embeddings'),
  Options.withDefault(false),
)

const noEmbedOption = Options.boolean('no-embed').pipe(
  Options.withDescription('Skip semantic search prompt'),
  Options.withDefault(false),
)

const excludeOption = Options.text('exclude').pipe(
  Options.withAlias('x'),
  Options.withDescription(
    'Additional patterns to exclude (comma-separated). Patterns from .gitignore and .mdmignore are honored automatically.',
  ),
  Options.optional,
)

const noGitignoreOption = Options.boolean('no-gitignore').pipe(
  Options.withDescription('Ignore .gitignore file'),
  Options.withDefault(false),
)

const providerOption = Options.choice('provider', [
  'openai',
  'ollama',
  'lm-studio',
  'openrouter',
  'voyage',
]).pipe(
  Options.withDescription(
    'Embedding provider: openai, ollama, lm-studio, openrouter, or voyage',
  ),
  Options.optional,
)

const providerBaseUrlOption = Options.text('provider-base-url').pipe(
  Options.withDescription('Custom provider API base URL'),
  Options.optional,
)

const providerModelOption = Options.text('provider-model').pipe(
  Options.withDescription('Embedding model to use'),
  Options.optional,
)

const hnswMOption = Options.integer('hnsw-m').pipe(
  Options.withDescription(
    'HNSW M parameter: max connections per node. Higher = better recall, larger index. Recommended: 12 (speed), 16 (balanced, default), 24 (quality)',
  ),
  Options.optional,
)

const hnswEfConstructionOption = Options.integer('hnsw-ef-construction').pipe(
  Options.withDescription(
    'HNSW efConstruction: construction-time search width. Higher = better quality, slower builds. Recommended: 128 (speed), 200 (balanced, default), 256 (quality)',
  ),
  Options.optional,
)

const timeoutOption = Options.integer('timeout').pipe(
  Options.withAlias('t'),
  Options.withDescription(
    'Request timeout in milliseconds for embedding API calls (default: 30000)',
  ),
  Options.optional,
)

const watchOption = Options.boolean('watch').pipe(
  Options.withAlias('w'),
  Options.withDescription(
    'Reject until multi-root manifest watching is available',
  ),
  Options.withDefault(false),
)

export const indexCommand = Command.make(
  'index',
  {
    path: pathArg,
    embed: embedOption,
    noEmbed: noEmbedOption,
    exclude: excludeOption,
    noGitignore: noGitignoreOption,
    provider: providerOption,
    providerBaseUrl: providerBaseUrlOption,
    providerModel: providerModelOption,
    hnswM: hnswMOption,
    hnswEfConstruction: hnswEfConstructionOption,
    timeout: timeoutOption,
    watch: watchOption,
    force: forceOption,
    json: jsonOption,
    pretty: prettyOption,
  },
  (input) =>
    runIndexCommand({
      path: Option.getOrUndefined(input.path),
      embed: input.embed,
      noEmbed: input.noEmbed,
      exclude: Option.getOrUndefined(input.exclude),
      noGitignore: input.noGitignore,
      provider: Option.getOrUndefined(input.provider),
      providerBaseUrl: Option.getOrUndefined(input.providerBaseUrl),
      providerModel: Option.getOrUndefined(input.providerModel),
      hnswM: Option.getOrUndefined(input.hnswM),
      hnswEfConstruction: Option.getOrUndefined(input.hnswEfConstruction),
      timeout: Option.getOrUndefined(input.timeout),
      watch: input.watch,
      force: input.force,
      json: input.json,
      pretty: input.pretty,
    }),
).pipe(Command.withDescription('Refresh the active manifest index'))
