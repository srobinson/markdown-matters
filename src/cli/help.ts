/**
 * Custom help system for mdcontext CLI
 *
 * Provides beautiful, useful help output that matches the quality of
 * professional CLI tools like git and gh.
 *
 * Color output respects:
 *   1. NO_COLOR environment variable (https://no-color.org/)
 *   2. --no-color CLI flag
 *   3. Non-TTY stdout (piped output)
 *   4. output.color config value (when available via resolveColorEnabled)
 */

// ============================================================================
// Color Support
// ============================================================================

/**
 * Determine whether ANSI color codes should be emitted.
 *
 * Checked before config is loaded, so uses env/argv/TTY signals only.
 * Config-level output.color is handled separately in the command handlers.
 */
export const shouldUseColor = (): boolean => {
  if (process.env.NO_COLOR !== undefined) return false
  if (process.argv.includes('--no-color')) return false
  if (!process.stdout.isTTY) return false
  return true
}

/** ANSI escape helpers that respect a color flag. */
const ansi = (color: boolean) => ({
  bold: (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s),
  yellow: (s: string) => (color ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (color ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s: string) => (color ? `\x1b[2m${s}\x1b[0m` : s),
})

// ============================================================================
// Types
// ============================================================================

interface CommandHelp {
  description: string
  usage: string
  examples: string[]
  options: { name: string; description: string }[]
  notes?: string[]
}

// ============================================================================
// Help Content
// ============================================================================

export const helpContent: Record<string, CommandHelp> = {
  index: {
    description: 'Index markdown files for fast searching',
    usage: 'mdcontext index [path] [options]',
    examples: [
      'mdcontext index                    # Index current directory',
      'mdcontext index docs/              # Index specific directory',
      'mdcontext index --embed            # Include semantic embeddings',
      'mdcontext index --watch            # Watch for file changes',
      'mdcontext index --embed --watch    # Full setup with live updates',
      'mdcontext index --force            # Rebuild from scratch',
      '',
      '# Alternative embedding providers:',
      'mdcontext index --embed --provider ollama --provider-model nomic-embed-text',
      'mdcontext index --embed --provider openrouter',
    ],
    options: [
      {
        name: '-e, --embed',
        description: 'Build semantic embeddings (enables AI-powered search)',
      },
      {
        name: '--no-embed',
        description: 'Skip the prompt to enable semantic search',
      },
      {
        name: '--provider <name>',
        description:
          'Embedding provider: openai, ollama, lm-studio, openrouter, voyage',
      },
      {
        name: '--provider-model <model>',
        description: 'Model name (e.g., nomic-embed-text for Ollama)',
      },
      {
        name: '--provider-base-url <url>',
        description: 'Custom API base URL for the provider',
      },
      {
        name: '-t, --timeout <ms>',
        description: 'Embedding API timeout in milliseconds (default: 30000)',
      },
      {
        name: '-w, --watch',
        description: 'Watch for changes and re-index automatically',
      },
      { name: '--force', description: 'Rebuild from scratch, ignoring cache' },
      { name: '--json', description: 'Output results as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'After indexing, prompts to enable semantic search (use --no-embed to skip).',
      'Providers: openai (default), ollama (free/local), lm-studio, openrouter, voyage.',
      'Set API keys: OPENAI_API_KEY, OPENROUTER_API_KEY, or use local providers.',
      'Index is stored in .mdcontext/ directory.',
    ],
  },
  search: {
    description: 'Search markdown content by meaning or heading pattern',
    usage: 'mdcontext search [options] <query> [path]',
    examples: [
      'mdcontext search "auth"                    # Simple term search',
      'mdcontext search "auth AND deploy"         # Both terms required',
      'mdcontext search "error OR bug"            # Either term matches',
      'mdcontext search "impl NOT test"           # Exclude "test"',
      'mdcontext search "auth AND (error OR bug)" # Grouped expressions',
      'mdcontext search \'"exact phrase"\'          # Exact phrase match',
      'mdcontext search \'"context resumption" AND drift\'  # Phrase + boolean',
      'mdcontext search -H "API.*"                # Regex on headings only',
      'mdcontext search --mode keyword "auth"     # Force keyword mode',
      'mdcontext search --mode semantic "auth"    # Force semantic mode',
      'mdcontext search -n 5 "setup"              # Limit to 5 results',
      'mdcontext search "config" docs/            # Search in specific directory',
      '',
      '# Context lines (like grep):',
      'mdcontext search "checkpoint" -C 3         # 3 lines before AND after',
      'mdcontext search "error" -B 2 -A 5         # 2 before, 5 after',
      '',
      '# Quality modes (speed vs recall tradeoff):',
      'mdcontext search "auth" --quality fast       # Faster, slight recall reduction',
      'mdcontext search "auth" -q thorough          # Best recall, ~30% slower',
      '',
      '# Re-ranking for precision:',
      'mdcontext search "auth" --rerank           # Re-rank with cross-encoder',
      '',
      '# HyDE for complex queries:',
      'mdcontext search "how to implement auth" --hyde   # Expands query semantically',
      '',
      '# AI summarization:',
      'mdcontext search "auth" --summarize        # Get AI summary of results',
      'mdcontext search "error" -s --yes          # Skip cost confirmation',
      'mdcontext search "config" -s --stream      # Stream summary output',
    ],
    options: [
      {
        name: '-k, --keyword',
        description: 'Force keyword search (content text match)',
      },
      {
        name: '-H, --heading-only',
        description: 'Search headings only (not content)',
      },
      {
        name: '-m, --mode <mode>',
        description: 'Force search mode: semantic, keyword, or hybrid',
      },
      {
        name: '-n, --limit <n>',
        description: 'Maximum number of results (default: 10)',
      },
      {
        name: '-C <n>',
        description: 'Show N context lines before AND after each match',
      },
      {
        name: '-B <n>',
        description: 'Show N context lines before each match',
      },
      {
        name: '-A <n>',
        description: 'Show N context lines after each match',
      },
      {
        name: '--threshold <n>',
        description:
          'Similarity threshold 0-1 for semantic search (default: 0.35)',
      },
      {
        name: '--provider <name>',
        description: 'Embedding provider for semantic search',
      },
      {
        name: '--timeout <ms>',
        description: 'Embedding API timeout in milliseconds (default: 30000)',
      },
      {
        name: '-r, --rerank',
        description:
          'Re-rank results with cross-encoder for better precision. Downloads ~90MB model on first use.',
      },
      {
        name: '--rerank-init',
        description:
          'Pre-download cross-encoder model (~90MB) before first search to avoid latency.',
      },
      {
        name: '-q, --quality <mode>',
        description:
          'Search quality: fast (quicker), balanced (default), thorough (best recall)',
      },
      {
        name: '--hyde',
        description:
          'Use HyDE query expansion for complex queries. Improves recall 10-30% at cost of ~1-2s latency.',
      },
      { name: '--json', description: 'Output results as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
      {
        name: '-s, --summarize',
        description: 'Generate AI summary of search results',
      },
      {
        name: '--refine',
        description: 'Additional filter terms to narrow results',
      },
      {
        name: '-y, --yes',
        description: 'Skip cost confirmation for paid AI providers',
      },
      {
        name: '--stream',
        description: 'Stream AI summary output in real-time',
      },
    ],
    notes: [
      'Auto-detects mode: semantic if embeddings exist, keyword otherwise.',
      'Boolean operators: AND, OR, NOT (case-insensitive).',
      'Quoted phrases match exactly: "context resumption".',
      'Regex patterns (e.g., "API.*") always use keyword search.',
      'Run "mdcontext index --embed" first for semantic search.',
      '',
      'Similarity threshold (--threshold):',
      '  Default: 0.35 (35%). Results below this similarity are filtered out.',
      '  If 0 results: content may exist below threshold. Try --threshold 0.25.',
      '  Typical scores: single words ~30-40%, phrases ~50-70%.',
      '  Higher threshold = stricter matching. Lower = more results.',
      '',
      'Re-ranking (--rerank):',
      '  Cross-encoder model improves precision by 20-35%.',
      '  Requires: npm install @huggingface/transformers',
      '  Model is downloaded on first use (~90MB) and cached locally.',
      '  Use --rerank-init to pre-download and avoid latency on first search.',
      '',
      'Quality modes (--quality):',
      '  fast: efSearch=64, ~40% faster, slight recall reduction.',
      '  balanced: efSearch=100 (default), good balance of speed and recall.',
      '  thorough: efSearch=256, ~30% slower, best recall for large corpora.',
      '',
      'HyDE (--hyde):',
      '  Generates hypothetical document using LLM, searches with that embedding.',
      '  Best for: "how to" questions, complex queries, ambiguous searches.',
      '  Requires: OPENAI_API_KEY (uses gpt-4o-mini by default).',
      '  Adds ~1-2s latency, improves recall 10-30% on complex queries.',
    ],
  },
  context: {
    description: 'Get LLM-ready summary of markdown files',
    usage: 'mdcontext context [options] <files>...',
    examples: [
      'mdcontext context README.md        # Summarize single file',
      'mdcontext context *.md             # Summarize all markdown files',
      'mdcontext context -t 1000 *.md     # Fit within 1000 token budget',
      'mdcontext context --brief *.md     # Minimal output (headings only)',
      'mdcontext context --full doc.md    # Include full content',
      'mdcontext context *.md | pbcopy    # Copy to clipboard (macOS)',
      '',
      '# Section filtering:',
      'mdcontext context doc.md --sections                # List available sections',
      'mdcontext context doc.md --section "Setup"         # Extract by section name',
      'mdcontext context doc.md --section "2.1"           # Extract by section number',
      'mdcontext context doc.md --section "API*"          # Glob pattern matching',
      'mdcontext context doc.md --section "Config" --shallow  # Top-level only',
      '',
      '# Section exclusion:',
      'mdcontext context doc.md --exclude "License"       # Exclude License section',
      'mdcontext context doc.md -x "License" -x "Test*"   # Multiple exclusions',
    ],
    options: [
      {
        name: '-t, --tokens <n>',
        description: 'Token budget for output (default: 2000)',
      },
      {
        name: '--brief',
        description: 'Minimal output (headings and key points only)',
      },
      {
        name: '--full',
        description: 'Include full content (no summarization)',
      },
      {
        name: '--section <name>',
        description:
          'Extract specific section by name, number, or glob pattern',
      },
      {
        name: '--sections',
        description: 'List available sections with numbers and token counts',
      },
      {
        name: '--shallow',
        description: 'Exclude nested subsections when using --section',
      },
      {
        name: '-x, --exclude <pattern>',
        description: 'Exclude sections by name, number, or glob (repeatable)',
      },
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'Token budget controls how much content is included.',
      'Lower tokens = more aggressive summarization.',
      'Output is formatted for direct use in LLM prompts.',
      'Use --sections to discover section names before filtering.',
      'Exclusion: -x matches by heading name, section number, or glob pattern.',
    ],
  },
  tree: {
    description: 'Show file tree or document outline',
    usage: 'mdcontext tree [path] [options]',
    examples: [
      'mdcontext tree                     # List markdown files in current dir',
      'mdcontext tree docs/               # List files in specific directory',
      'mdcontext tree README.md           # Show document outline (headings)',
      'mdcontext tree doc.md --json       # Outline as JSON',
    ],
    options: [
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'Pass a directory to list markdown files.',
      'Pass a file to show its heading structure with token counts.',
    ],
  },
  links: {
    description: 'Show what a file links to (outgoing links)',
    usage: 'mdcontext links <file> [options]',
    examples: [
      'mdcontext links README.md          # Show outgoing links',
      'mdcontext links doc.md --json      # Output as JSON',
      'mdcontext links doc.md -r docs/    # Resolve links relative to docs/',
    ],
    options: [
      {
        name: '-r, --root <dir>',
        description: 'Root directory for resolving relative links',
      },
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
  },
  backlinks: {
    description: 'Show what links to a file (incoming links)',
    usage: 'mdcontext backlinks <file> [options]',
    examples: [
      'mdcontext backlinks api.md         # What links to api.md?',
      'mdcontext backlinks doc.md --json  # Output as JSON',
      'mdcontext backlinks doc.md -r ./   # Resolve from current directory',
    ],
    options: [
      {
        name: '-r, --root <dir>',
        description: 'Root directory for resolving relative links',
      },
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: ['Requires index to exist. Run "mdcontext index" first.'],
  },
  stats: {
    description: 'Show index statistics',
    usage: 'mdcontext stats [path] [options]',
    examples: [
      'mdcontext stats                    # Show stats for current directory',
      'mdcontext stats docs/              # Show stats for specific directory',
      'mdcontext stats --json             # Output as JSON',
    ],
    options: [
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: ['Shows embedding count, dimensions, and cost if embeddings exist.'],
  },
  config: {
    description: 'Configuration management',
    usage: 'mdcontext config <command> [options]',
    examples: [
      'mdcontext config init              # Create a starter config file',
      'mdcontext config init --format json  # Create JSON config instead of JS',
      'mdcontext config show              # Show config file location',
      'mdcontext config check             # Validate and show effective config',
      'mdcontext config check --json      # Output config as JSON',
    ],
    options: [
      { name: 'init', description: 'Create a starter config file' },
      { name: 'show', description: 'Display config file location' },
      {
        name: 'check',
        description: 'Validate and show effective configuration',
      },
      {
        name: '-f, --format <format>',
        description: 'Config format: js or json (init only)',
      },
      { name: '--force', description: 'Overwrite existing config (init only)' },
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'Config files set persistent defaults for all commands.',
      'Precedence: CLI flags > environment > config file > defaults.',
      'See docs/CONFIG.md for full configuration reference.',
    ],
  },
  duplicates: {
    description: 'Detect duplicate content in markdown files',
    usage: 'mdcontext duplicates [path] [options]',
    examples: [
      'mdcontext duplicates                      # Find duplicates in current directory',
      'mdcontext duplicates docs/                 # Find duplicates in docs/',
      'mdcontext duplicates --min-length 100      # Only flag sections over 100 chars',
      'mdcontext duplicates -p "docs/**" --json   # Filter by path, JSON output',
    ],
    options: [
      {
        name: '--min-length <n>',
        description:
          'Minimum content length (characters) to consider (default: 50)',
      },
      {
        name: '-p, --path <pattern>',
        description: 'Filter by document path pattern (glob)',
      },
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'Requires an index. Run "mdcontext index" first.',
      'Compares sections by content similarity to find duplicates.',
    ],
  },
  embeddings: {
    description: 'Manage embedding namespaces',
    usage: 'mdcontext embeddings <command> [options]',
    examples: [
      'mdcontext embeddings list              # List all embedding namespaces',
      'mdcontext embeddings current           # Show active namespace',
      'mdcontext embeddings switch openai     # Switch to OpenAI embeddings',
      'mdcontext embeddings switch voyage     # Switch to Voyage embeddings',
      'mdcontext embeddings remove ollama     # Remove Ollama embeddings',
      'mdcontext embeddings remove openai -f  # Force remove active namespace',
    ],
    options: [
      { name: 'list', description: 'List all available embedding namespaces' },
      { name: 'current', description: 'Show the current active namespace' },
      {
        name: 'switch <namespace>',
        description: 'Switch to a different namespace',
      },
      { name: 'remove <namespace>', description: 'Remove a namespace' },
      { name: '-f, --force', description: 'Force remove active namespace' },
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'Namespaces store embeddings separately by provider/model.',
      'Switching namespaces is instant - no rebuild required.',
      'Run "mdcontext index --embed" to create embeddings for a provider.',
    ],
  },
}

// ============================================================================
// Help Rendering
// ============================================================================

/**
 * Render beautiful subcommand help.
 *
 * @param command - subcommand name
 * @param color - override color flag; defaults to shouldUseColor()
 */
export const showSubcommandHelp = (
  command: string,
  color: boolean = shouldUseColor(),
): void => {
  const help = helpContent[command]
  if (!help) {
    console.log(`Unknown command: ${command}`)
    console.log('Run "mdcontext --help" for available commands.')
    process.exit(1)
  }

  const c = ansi(color)

  // Header
  console.log(`\n${c.bold(`mdcontext ${command}`)} - ${help.description}`)

  // Usage
  console.log(`\n${c.yellow('USAGE')}`)
  console.log(`  ${help.usage}`)

  // Examples
  console.log(`\n${c.yellow('EXAMPLES')}`)
  for (const example of help.examples) {
    console.log(`  ${example}`)
  }

  // Options
  console.log(`\n${c.yellow('OPTIONS')}`)
  for (const opt of help.options) {
    // Pad option name to 24 chars for alignment
    const paddedName = opt.name.padEnd(24)
    console.log(`  ${paddedName}${opt.description}`)
  }

  // Notes (if any)
  if (help.notes && help.notes.length > 0) {
    console.log(`\n${c.yellow('NOTES')}`)
    for (const note of help.notes) {
      console.log(`  ${note}`)
    }
  }

  console.log('')
}

/**
 * Custom help output for main command.
 *
 * @param color - override color flag; defaults to shouldUseColor()
 */
export const showMainHelp = (color: boolean = shouldUseColor()): void => {
  const c = ansi(color)

  const help = `
${c.bold('mdcontext')} - Token-efficient markdown analysis for LLMs

${c.yellow('COMMANDS')}
  index [path]              Index markdown files (default: .)
  search <query> [path]     Search by meaning or structure
  context <files>...        Get LLM-ready summary
  tree [path]               Show files or document outline
  config <command>          Configuration management
  duplicates [path]         Detect duplicate content
  embeddings <command>      Manage embedding namespaces
  links <file>              Show outgoing links
  backlinks <file>          Show incoming links
  stats [path]              Index statistics

${c.yellow('EXAMPLES')}
  mdcontext tree                         # List all markdown files
  mdcontext tree README.md               # Show document outline
  mdcontext index                        # Index current directory
  mdcontext index --embed                # Index with semantic embeddings
  mdcontext search "auth"                # Simple term search
  mdcontext search "auth AND deploy"     # Boolean AND (both required)
  mdcontext search "error OR bug"        # Boolean OR (either matches)
  mdcontext search '"exact phrase"'      # Quoted phrase (exact match)
  mdcontext search "how to deploy"       # Semantic search (if embeddings exist)
  mdcontext context README.md            # Summarize a file
  mdcontext context *.md -t 2000         # Multi-file with token budget

${c.yellow('WORKFLOWS')}
  ${c.dim('# Quick context for LLM')}
  mdcontext context README.md docs/*.md | pbcopy

  ${c.dim('# Find relevant documentation')}
  mdcontext search "error handling"

  ${c.dim('# Complex queries with boolean operators')}
  mdcontext search "auth AND (error OR exception) NOT test"

  ${c.dim('# Explore a new codebase')}
  mdcontext tree && mdcontext stats

  ${c.dim('# Build semantic search')}
  mdcontext index --embed && mdcontext search "authentication flow"

  ${c.dim('# Set up project configuration')}
  mdcontext config init && mdcontext config check

${c.yellow('GLOBAL OPTIONS')}
  -c, --config <file>  Use specified config file
  --json               Output as JSON
  --pretty             Pretty-print JSON
  --help, -h           Show help
  --version, -v        Show version

Run ${c.cyan('mdcontext <command> --help')} for command-specific options.
`
  console.log(help)
}

// ============================================================================
// Help Detection
// ============================================================================

/**
 * Check for subcommand help pattern: mdcontext <cmd> --help or mdcontext <cmd> -h
 * Returns true if help was shown and we should exit
 */
export const checkSubcommandHelp = (): boolean => {
  const args = process.argv.slice(2)
  if (args.length < 2) return false

  const command = args[0]
  const hasHelpFlag = args.includes('--help') || args.includes('-h')

  if (hasHelpFlag && command && helpContent[command]) {
    showSubcommandHelp(command)
    process.exit(0)
  }

  return false
}

/**
 * Check for bare subcommand that has nested subcommands (e.g., "config", "embeddings").
 * Shows custom help when running "mdcontext config" without arguments.
 * This prevents the ugly Effect CLI default output.
 */
export const checkBareSubcommandHelp = (): boolean => {
  const args = process.argv.slice(2)

  // Look for: exactly one arg that is a command with subcommands in helpContent
  if (args.length !== 1) return false

  const command = args[0]

  // Only handle commands that have subcommands and custom help
  const commandsWithSubcommands = ['config', 'embeddings']
  if (
    command &&
    commandsWithSubcommands.includes(command) &&
    helpContent[command]
  ) {
    showSubcommandHelp(command)
    process.exit(0)
  }

  return false
}

/**
 * Check if we should show main help
 */
export const shouldShowMainHelp = (): boolean => {
  const args = process.argv.slice(2)
  const showHelp =
    args.length === 0 ||
    args.includes('--help') ||
    args.includes('-h') ||
    (args.length === 1 && args[0] === 'help')

  return showHelp && !args.some((a) => !a.startsWith('-') && a !== 'help')
}
