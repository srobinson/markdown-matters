/** Search command option declaration and dispatch. */

import { Args, Command, Options } from '@effect/cli'
import { Console, Effect } from 'effect'
import { withCurrentGeneration } from '../../db/generation-reader.js'
import { resolveMdmHome } from '../../home.js'
import { jsonOption, prettyOption } from '../options.js'
import { formatJson } from '../utils.js'
import { runSearchCommand } from './search-mode.js'

const renderNoIndexGuidance = (
  json: boolean,
  pretty: boolean,
): Effect.Effect<void> =>
  json
    ? Console.log(
        formatJson(
          {
            error: 'No index found.',
            guidance: 'Run: mdm index /path/to/docs',
            hint: 'Add --embed for semantic search capabilities',
          },
          pretty,
        ),
      )
    : Effect.gen(function* () {
        yield* Console.log('No index found.')
        yield* Console.log('')
        yield* Console.log('Run: mdm index /path/to/docs')
        yield* Console.log('  Add --embed for semantic search capabilities')
      })

const searchOptions = {
  query: Args.text({ name: 'query' }).pipe(
    Args.withDescription('Search query (natural language or regex pattern)'),
  ),
  path: Args.directory({ name: 'path' }).pipe(
    Args.withDescription('Directory to search in'),
    Args.withDefault('.'),
  ),
  keyword: Options.boolean('keyword').pipe(
    Options.withAlias('k'),
    Options.withDescription('Force keyword search (content text match)'),
    Options.withDefault(false),
  ),
  headingOnly: Options.boolean('heading-only').pipe(
    Options.withAlias('H'),
    Options.withDescription('Search headings only (not content)'),
    Options.withDefault(false),
  ),
  mode: Options.choice('mode', ['hybrid', 'semantic', 'keyword']).pipe(
    Options.withAlias('m'),
    Options.withDescription(
      'Search mode: hybrid (BM25+semantic), semantic, or keyword',
    ),
    Options.optional,
  ),
  limit: Options.integer('limit').pipe(
    Options.withAlias('n'),
    Options.withDescription('Maximum results'),
    Options.withDefault(10),
  ),
  threshold: Options.float('threshold').pipe(
    Options.withDescription('Similarity threshold for semantic search (0-1)'),
    Options.withDefault(0.35),
  ),
  context: Options.integer('context').pipe(
    Options.withAlias('C'),
    Options.withDescription('Lines of context around matches (like grep -C)'),
    Options.optional,
  ),
  beforeContext: Options.integer('before-context').pipe(
    Options.withAlias('B'),
    Options.withDescription('Lines of context before matches (like grep -B)'),
    Options.optional,
  ),
  afterContext: Options.integer('after-context').pipe(
    Options.withAlias('A'),
    Options.withDescription('Lines of context after matches (like grep -A)'),
    Options.optional,
  ),
  autoIndexThreshold: Options.integer('auto-index-threshold').pipe(
    Options.withDescription(
      'Auto-create semantic index if estimated time is under this threshold (seconds)',
    ),
    Options.optional,
  ),
  provider: Options.choice('provider', [
    'openai',
    'ollama',
    'lm-studio',
    'openrouter',
    'voyage',
  ]).pipe(
    Options.withDescription(
      'Embedding provider for semantic search: openai, ollama, lm-studio, openrouter, or voyage',
    ),
    Options.optional,
  ),
  rerank: Options.boolean('rerank').pipe(
    Options.withAlias('r'),
    Options.withDescription(
      'Re-rank results using cross-encoder for improved precision. Downloads ~90MB model on first use. Requires @huggingface/transformers.',
    ),
    Options.withDefault(false),
  ),
  quality: Options.choice('quality', ['fast', 'balanced', 'thorough']).pipe(
    Options.withAlias('q'),
    Options.withDescription(
      'Search quality mode: fast (quicker, lower recall), balanced (default), thorough (slower, better recall)',
    ),
    Options.optional,
  ),
  hyde: Options.boolean('hyde').pipe(
    Options.withDescription(
      'Use HyDE (Hypothetical Document Embeddings) for complex queries. Generates a hypothetical answer with LLM, then searches using that embedding. Improves recall 10-30% on complex/ambiguous queries at cost of ~1-2s latency and LLM API usage.',
    ),
    Options.withDefault(false),
  ),
  rerankInit: Options.boolean('rerank-init').pipe(
    Options.withDescription(
      'Pre-download the cross-encoder model (~90MB) for re-ranking. Use this before first search to avoid latency.',
    ),
    Options.withDefault(false),
  ),
  json: jsonOption,
  pretty: prettyOption,
  summarize: Options.boolean('summarize').pipe(
    Options.withAlias('s'),
    Options.withDescription('Generate AI summary of search results'),
    Options.withDefault(false),
  ),
  yes: Options.boolean('yes').pipe(
    Options.withAlias('y'),
    Options.withDescription('Skip cost confirmation for paid AI providers'),
    Options.withDefault(false),
  ),
  stream: Options.boolean('stream').pipe(
    Options.withDescription('Stream AI summary output in real-time'),
    Options.withDefault(false),
  ),
  fuzzy: Options.boolean('fuzzy').pipe(
    Options.withAlias('f'),
    Options.withDescription(
      'Enable fuzzy matching for typo tolerance (e.g., "configration" matches "configuration")',
    ),
    Options.withDefault(false),
  ),
  stem: Options.boolean('stem').pipe(
    Options.withDescription(
      'Enable word stemming (e.g., "fail" matches "failed" and "failing")',
    ),
    Options.withDefault(false),
  ),
  fuzzyDistance: Options.integer('fuzzy-distance').pipe(
    Options.withDescription(
      'Max edit distance for fuzzy matching (default: 2)',
    ),
    Options.optional,
  ),
  refine: Options.text('refine').pipe(
    Options.withDescription(
      'Additional filter terms to narrow results (can be used multiple times)',
    ),
    Options.repeated,
  ),
}

export const searchCommand = Command.make('search', searchOptions, (input) =>
  withCurrentGeneration(resolveMdmHome(), (session) =>
    runSearchCommand(input, session),
  ).pipe(
    Effect.catchTag('GenerationReadError', (error) =>
      error.reason === 'NoCurrentGeneration'
        ? renderNoIndexGuidance(input.json, input.pretty)
        : Effect.fail(error),
    ),
  ),
).pipe(Command.withDescription('Search by meaning or structure'))
