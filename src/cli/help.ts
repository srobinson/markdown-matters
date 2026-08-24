import { MANIFEST_WATCH_UNAVAILABLE_DESCRIPTION } from './flag-schemas.js'

export const shouldUseColor = (): boolean => {
  if (process.env.NO_COLOR !== undefined) return false
  if (process.argv.includes('--no-color')) return false
  if (!process.stdout.isTTY) return false
  return true
}

const ansi = (color: boolean) => ({
  bold: (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s),
  yellow: (s: string) => (color ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (color ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s: string) => (color ? `\x1b[2m${s}\x1b[0m` : s),
})

interface CommandHelp {
  description: string
  usage: string
  examples: string[]
  options: { name: string; description: string }[]
  notes?: string[]
}

export const helpContent: Record<string, CommandHelp> = {
  init: {
    description: 'Initialize mdm in a directory',
    usage: 'mdm init [options]',
    examples: [
      'mdm init                     # Interactive setup',
      'mdm init --local             # Create project config',
      'mdm init --global            # Initialize the active MDM_HOME',
      'mdm init -y                  # Accept all defaults',
    ],
    options: [
      {
        name: '-l, --local',
        description: 'Create .mdm.toml in the current directory',
      },
      {
        name: '-g, --global',
        description: 'Initialize the active MDM_HOME',
      },
      {
        name: '-y, --yes',
        description: 'Accept all defaults without prompting',
      },
    ],
    notes: [
      'Local init creates only the project .mdm.toml.',
      'Indexes and active home config live in MDM_HOME.',
      'Config resolution merges project local, project, and home files by key.',
    ],
  },
  index: {
    description: 'Refresh the manifest index, optionally scoped to one path',
    usage: 'mdm index [path] [options]',
    examples: [
      'mdm index                    # Refresh every manifest directory',
      'mdm index docs/              # Index only docs/ (registered on success)',
      'mdm index --embed            # Refresh and build embeddings',
      'mdm index --force-embed      # Rebuild every semantic embedding',
      'mdm index --watch            # Fails; manifest watch is unavailable',
      'mdm index --force            # Re-process all files (ignores a path scope)',
      '',
      '# Alternative embedding providers:',
      'mdm index --embed --provider ollama --provider-model nomic-embed-text',
      'mdm index --embed --provider openrouter',
    ],
    options: [
      {
        name: '-e, --embed',
        description: 'Build semantic embeddings (enables AI-powered search)',
      },
      {
        name: '--no-embed',
        description: 'Skip semantic vector pruning and refresh',
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
        name: '-x, --exclude <patterns>',
        description: 'Additional comma-separated exclusion patterns',
      },
      {
        name: '--no-gitignore',
        description: 'Do not apply .gitignore patterns',
      },
      {
        name: '--hnsw-m <n>',
        description: 'HNSW maximum connections per node',
      },
      {
        name: '--hnsw-ef-construction <n>',
        description: 'HNSW construction search width',
      },
      {
        name: '-w, --watch',
        description: MANIFEST_WATCH_UNAVAILABLE_DESCRIPTION,
      },
      {
        name: '-f, --force',
        description:
          'Bypass mtime/hash cache and re-process every file (does not delete index)',
      },
      {
        name: '--force-embed',
        description:
          'Rebuild every semantic embedding instead of reusing vectors',
      },
      { name: '--json', description: 'Output results as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'With no path, index refreshes every directory in manifest.toml.',
      'With a path, index appends its absolute declared path before refreshing.',
      'An empty manifest requires mdm index <dir>; the current directory is never implicit.',
      'Existing semantic embeddings refresh atomically. Use --embed to create them, --force-embed to rebuild them, or --no-embed to leave them unchanged.',
      'Providers: openai (default), ollama (free/local), lm-studio, openrouter, voyage.',
      'Set API keys: OPENAI_API_KEY, OPENROUTER_API_KEY, or use local providers.',
      'Manifest and index state are stored in the active MDM_HOME.',
    ],
  },
  fix: {
    description: 'Repair malformed YAML frontmatter in markdown files',
    usage: 'mdm fix [path] [options]',
    examples: [
      'mdm fix                      # Preview repairs in current directory',
      'mdm fix docs/                # Preview repairs in docs/',
      'mdm fix note.md              # Preview repairs for one file',
      'mdm fix docs/ --write        # Apply repairs',
      'mdm fix docs/ --write --force # Apply even if tracked files are modified',
      'mdm fix docs/ --json         # Output structured report',
    ],
    options: [
      {
        name: '-w, --write',
        description: 'Apply repairs. Default is dry-run preview.',
      },
      {
        name: '-f, --force',
        description: 'Write even when tracked files have uncommitted changes',
      },
      { name: '--json', description: 'Output report as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'Dry-run output shows line-level -/+ changes for each repaired frontmatter block.',
      'By default, --write skips modified tracked files to avoid overwriting local work.',
      'Untracked files, clean tracked files, and files outside git repos can be written.',
      'Use this when mdm index reports malformed frontmatter warnings.',
    ],
  },
  search: {
    description: 'Search markdown content by meaning or heading pattern',
    usage: 'mdm search [options] <query> [path]',
    examples: [
      'mdm search "auth"                    # Simple term search',
      'mdm search "auth AND deploy"         # Both terms required',
      'mdm search "error OR bug"            # Either term matches',
      'mdm search "impl NOT test"           # Exclude "test"',
      'mdm search "auth AND (error OR bug)" # Grouped expressions',
      'mdm search \'"exact phrase"\'          # Exact phrase match',
      'mdm search \'"context resumption" AND drift\'  # Phrase + boolean',
      'mdm search -H "API.*"                # Regex on headings only',
      'mdm search --mode keyword "auth"     # Force keyword mode',
      'mdm search --mode semantic "auth"    # Force semantic mode',
      'mdm search -n 5 "setup"              # Limit to 5 results',
      'mdm search "config" docs/            # Search in specific directory',
      '',
      '# Context lines (like grep):',
      'mdm search "checkpoint" -C 3         # 3 lines before AND after',
      'mdm search "error" -B 2 -A 5         # 2 before, 5 after',
      '',
      '# Quality modes (speed vs recall tradeoff):',
      'mdm search "auth" --quality fast       # Faster, slight recall reduction',
      'mdm search "auth" -q thorough          # Best recall, ~30% slower',
      '',
      '# Re-ranking for precision:',
      'mdm search "auth" --rerank           # Re-rank with cross-encoder',
      '',
      '# HyDE for complex queries:',
      'mdm search "how to implement auth" --hyde   # Expands query semantically',
      '',
      '# AI summarization:',
      'mdm search "auth" --summarize        # Get AI summary of results',
      'mdm search "error" -s --yes          # Skip cost confirmation',
      'mdm search "config" -s --stream      # Stream summary output',
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
        name: '-f, --fuzzy',
        description: 'Enable fuzzy matching for typo tolerance',
      },
      {
        name: '--stem',
        description: 'Match word variants such as fail, failed, and failing',
      },
      {
        name: '--fuzzy-distance <n>',
        description: 'Maximum edit distance for --fuzzy (default: 2)',
      },
      {
        name: '--auto-index-threshold <seconds>',
        description: 'Auto-create embeddings within this time estimate',
      },
      {
        name: '--provider <name>',
        description: 'Embedding provider for semantic search',
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
      'Run "mdm index --embed" first for semantic search.',
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
      '  Requires a chat provider: OPENAI_API_KEY, OPENROUTER_API_KEY, or local. Default: gpt-4o-mini.',
      '  Adds ~1-2s latency, improves recall 10-30% on complex queries.',
    ],
  },
  context: {
    description: 'Get LLM-ready summary of markdown files',
    usage: 'mdm context [options] <files>...',
    examples: [
      'mdm context README.md          # Brief skeleton (default)',
      'mdm context --summary doc.md   # Key points per section',
      'mdm context --full doc.md      # Complete content',
      'mdm context *.md               # Multi-file with 2000 token budget',
      'mdm context -t 5000 *.md       # Multi-file with larger budget',
      'mdm context *.md | pbcopy      # Copy to clipboard (macOS)',
      '',
      '# Section filtering:',
      'mdm context doc.md --sections                # List available sections',
      'mdm context doc.md --section "Setup"         # Extract by section name',
      'mdm context doc.md --section "2.1"           # Extract by section number',
      'mdm context doc.md --section "API*"          # Glob pattern matching',
      'mdm context doc.md --section "Config" --shallow  # Top-level only',
      '',
      '# Section exclusion:',
      'mdm context doc.md --exclude "License"       # Exclude License section',
      'mdm context doc.md -x "License" -x "Test*"   # Multiple exclusions',
    ],
    options: [
      {
        name: '-t, --tokens <n>',
        description: 'Token budget for multi-file assembly (default: 2000)',
      },
      {
        name: '--brief',
        description:
          'Structural skeleton: headings + content markers (default)',
      },
      {
        name: '--summary',
        description: 'Key points extracted from each section',
      },
      {
        name: '--full',
        description: 'Complete document content',
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
    usage: 'mdm tree [path] [options]',
    examples: [
      'mdm tree                     # List markdown files in current dir',
      'mdm tree docs/               # List files in specific directory',
      'mdm tree README.md           # Show document outline (headings)',
      'mdm tree doc.md --json       # Outline as JSON',
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
    usage: 'mdm links <file> [options]',
    examples: [
      'mdm links README.md          # Show outgoing links',
      'mdm links doc.md --json      # Output as JSON',
      'mdm links doc.md -r docs/    # Resolve links relative to docs/',
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
    usage: 'mdm backlinks <file> [options]',
    examples: [
      'mdm backlinks api.md         # What links to api.md?',
      'mdm backlinks doc.md --json  # Output as JSON',
      'mdm backlinks doc.md -r ./   # Resolve from current directory',
    ],
    options: [
      {
        name: '-r, --root <dir>',
        description: 'Root directory for resolving relative links',
      },
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: ['Requires index to exist. Run "mdm index" first.'],
  },
  stats: {
    description: 'Show index statistics',
    usage: 'mdm stats [path] [options]',
    examples: [
      'mdm stats                    # Show stats for current directory',
      'mdm stats docs/              # Show stats for specific directory',
      'mdm stats --json             # Output as JSON',
    ],
    options: [
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: ['Shows embedding count, dimensions, and cost if embeddings exist.'],
  },
  config: {
    description: 'Configuration management',
    usage: 'mdm config <command> [options]',
    examples: [
      'mdm config init              # Create a .mdm.toml config file',
      'mdm config init --global     # Create config in active MDM_HOME',
      'mdm config init --force      # Overwrite existing config',
      'mdm config show              # Show config file location',
      'mdm config check             # Validate and show effective config',
      'mdm config check --json      # Output config as JSON',
    ],
    options: [
      { name: 'init', description: 'Create a .mdm.toml config file' },
      { name: 'show', description: 'Display config file location' },
      {
        name: 'check',
        description: 'Validate and show effective configuration',
      },
      {
        name: '--global',
        description: 'Write config to the active MDM_HOME (init only)',
      },
      { name: '--force', description: 'Overwrite existing config (init only)' },
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'Config file: .mdm.toml (TOML format).',
      'Resolution merges project local, project, and active home config by key.',
      'Precedence: CLI flags > environment (MDM_*) > config file > defaults.',
    ],
  },
  duplicates: {
    description: 'Detect duplicate content in markdown files',
    usage: 'mdm duplicates [path] [options]',
    examples: [
      'mdm duplicates                      # Find duplicates in current directory',
      'mdm duplicates docs/                 # Find duplicates in docs/',
      'mdm duplicates --min-length 100      # Only flag sections over 100 chars',
      'mdm duplicates -p "docs/**" --json   # Filter by path, JSON output',
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
      'Requires an index. Run "mdm index" first.',
      'Compares sections by content similarity to find duplicates.',
    ],
  },
  embeddings: {
    description: 'Manage embedding namespaces',
    usage: 'mdm embeddings <command> [options]',
    examples: [
      'mdm embeddings list              # List all embedding namespaces',
      'mdm embeddings current           # Show active namespace',
      'mdm embeddings switch openai     # Switch to OpenAI embeddings',
      'mdm embeddings switch voyage     # Switch to Voyage embeddings',
      'mdm embeddings remove ollama     # Remove Ollama embeddings',
      'mdm embeddings remove openai -f  # Force remove active namespace',
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
      'Run "mdm index --embed" to create embeddings for a provider.',
    ],
  },
}

export const showSubcommandHelp = (
  command: string,
  color: boolean = shouldUseColor(),
): void => {
  const help = helpContent[command]
  if (!help) {
    console.log(`Unknown command: ${command}`)
    console.log('Run "mdm --help" for available commands.')
    process.exit(1)
  }

  const c = ansi(color)

  console.log(`\n${c.bold(`mdm ${command}`)} - ${help.description}`)

  console.log(`\n${c.yellow('USAGE')}`)
  console.log(`  ${help.usage}`)

  console.log(`\n${c.yellow('EXAMPLES')}`)
  for (const example of help.examples) {
    console.log(`  ${example}`)
  }

  console.log(`\n${c.yellow('OPTIONS')}`)
  for (const opt of help.options) {
    const paddedName = opt.name.padEnd(24)
    console.log(`  ${paddedName}${opt.description}`)
  }

  if (help.notes && help.notes.length > 0) {
    console.log(`\n${c.yellow('NOTES')}`)
    for (const note of help.notes) {
      console.log(`  ${note}`)
    }
  }

  console.log('')
}

export const showMainHelp = (color: boolean = shouldUseColor()): void => {
  const c = ansi(color)

  const help = `
${c.bold('mdm')} - Token-efficient markdown analysis for LLMs

${c.yellow('COMMANDS')}
  init                      Initialize mdm in a directory
  index [path]              Refresh the active manifest index
  fix [path]                Repair malformed YAML frontmatter
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
  mdm tree                         # List all markdown files
  mdm tree README.md               # Show document outline
  mdm index                        # Refresh all manifest directories
  mdm index --embed                # Refresh and build embeddings
  mdm fix                          # Preview frontmatter repairs
  mdm search "auth"                # Simple term search
  mdm search "auth AND deploy"     # Boolean AND (both required)
  mdm search "error OR bug"        # Boolean OR (either matches)
  mdm search '"exact phrase"'      # Quoted phrase (exact match)
  mdm search "how to deploy"       # Semantic search (if embeddings exist)
  mdm context README.md            # Summarize a file
  mdm context *.md -t 2000         # Multi-file with token budget

${c.yellow('WORKFLOWS')}
  ${c.dim('# Quick context for LLM')}
  mdm context README.md docs/*.md | pbcopy

  ${c.dim('# Find relevant documentation')}
  mdm search "error handling"

  ${c.dim('# Complex queries with boolean operators')}
  mdm search "auth AND (error OR exception) NOT test"

  ${c.dim('# Explore a new codebase')}
  mdm tree && mdm stats

  ${c.dim('# Build semantic search')}
  mdm index --embed && mdm search "authentication flow"

  ${c.dim('# Set up project')}
  mdm init && mdm index .

  ${c.dim('# Repair malformed frontmatter')}
  mdm fix docs/ && mdm fix docs/ --write

${c.yellow('GLOBAL OPTIONS')}
  --json               Output as JSON
  --pretty             Pretty-print JSON
  --help, -h           Show help
  --version, -v        Show version

Run ${c.cyan('mdm <command> --help')} for command-specific options.
`
  console.log(help)
}

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

export const checkBareSubcommandHelp = (): boolean => {
  const args = process.argv.slice(2)

  if (args.length !== 1) return false

  const command = args[0]

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

export const shouldShowMainHelp = (): boolean => {
  const args = process.argv.slice(2)
  const showHelp =
    args.length === 0 ||
    args.includes('--help') ||
    args.includes('-h') ||
    (args.length === 1 && args[0] === 'help')

  return showHelp && !args.some((a) => !a.startsWith('-') && a !== 'help')
}
