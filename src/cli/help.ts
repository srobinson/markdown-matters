/**
 * Custom help system for mdtldr CLI
 *
 * Provides beautiful, useful help output that matches the quality of
 * professional CLI tools like git and gh.
 */

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
    usage: 'mdtldr index [path] [options]',
    examples: [
      'mdtldr index                    # Index current directory',
      'mdtldr index docs/              # Index specific directory',
      'mdtldr index --embed            # Include semantic embeddings',
      'mdtldr index --watch            # Watch for file changes',
      'mdtldr index --embed --watch    # Full setup with live updates',
      'mdtldr index --force            # Rebuild from scratch',
    ],
    options: [
      {
        name: '-e, --embed',
        description: 'Build semantic embeddings (enables AI-powered search)',
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
      'First run downloads embedding model (~80MB) if --embed is used.',
      'Index is stored in .md-tldr/ directory.',
    ],
  },
  search: {
    description: 'Search markdown content by meaning or heading pattern',
    usage: 'mdtldr search [options] <query> [path]',
    examples: [
      'mdtldr search "auth"                    # Simple term search',
      'mdtldr search "auth AND deploy"         # Both terms required',
      'mdtldr search "error OR bug"            # Either term matches',
      'mdtldr search "impl NOT test"           # Exclude "test"',
      'mdtldr search "auth AND (error OR bug)" # Grouped expressions',
      'mdtldr search \'"exact phrase"\'          # Exact phrase match',
      'mdtldr search \'"context resumption" AND drift\'  # Phrase + boolean',
      'mdtldr search -H "API.*"                # Regex on headings only',
      'mdtldr search --mode structural "auth"  # Force structural mode',
      'mdtldr search --mode semantic "auth"    # Force semantic mode',
      'mdtldr search -n 5 "setup"              # Limit to 5 results',
      'mdtldr search "config" docs/            # Search in specific directory',
      '',
      '# Context lines (like grep):',
      'mdtldr search "checkpoint" -C 3         # 3 lines before AND after',
      'mdtldr search "error" -B 2 -A 5         # 2 before, 5 after',
    ],
    options: [
      {
        name: '-s, --structural',
        description: 'Force structural search (content text match)',
      },
      {
        name: '-H, --heading-only',
        description: 'Search headings only (not content)',
      },
      {
        name: '-m, --mode <mode>',
        description: 'Force search mode: semantic or structural',
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
          'Similarity threshold 0-1 for semantic search (default: 0.5)',
      },
      { name: '--json', description: 'Output results as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'Auto-detects mode: semantic if embeddings exist, structural otherwise.',
      'Boolean operators: AND, OR, NOT (case-insensitive).',
      'Quoted phrases match exactly: "context resumption".',
      'Regex patterns (e.g., "API.*") always use structural search.',
      'Run "mdtldr index --embed" first for semantic search.',
    ],
  },
  context: {
    description: 'Get LLM-ready summary of markdown files',
    usage: 'mdtldr context [options] <files>...',
    examples: [
      'mdtldr context README.md        # Summarize single file',
      'mdtldr context *.md             # Summarize all markdown files',
      'mdtldr context -t 1000 *.md     # Fit within 1000 token budget',
      'mdtldr context --brief *.md     # Minimal output (headings only)',
      'mdtldr context --full doc.md    # Include full content',
      'mdtldr context *.md | pbcopy    # Copy to clipboard (macOS)',
      '',
      '# Section filtering:',
      'mdtldr context doc.md --sections                # List available sections',
      'mdtldr context doc.md --section "Setup"         # Extract by section name',
      'mdtldr context doc.md --section "2.1"           # Extract by section number',
      'mdtldr context doc.md --section "API*"          # Glob pattern matching',
      'mdtldr context doc.md --section "Config" --shallow  # Top-level only',
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
        description: 'Extract specific section by name, number, or glob pattern',
      },
      {
        name: '--sections',
        description: 'List available sections with numbers and token counts',
      },
      {
        name: '--shallow',
        description: 'Exclude nested subsections when using --section',
      },
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: [
      'Token budget controls how much content is included.',
      'Lower tokens = more aggressive summarization.',
      'Output is formatted for direct use in LLM prompts.',
      'Use --sections to discover section names before filtering.',
    ],
  },
  tree: {
    description: 'Show file tree or document outline',
    usage: 'mdtldr tree [path] [options]',
    examples: [
      'mdtldr tree                     # List markdown files in current dir',
      'mdtldr tree docs/               # List files in specific directory',
      'mdtldr tree README.md           # Show document outline (headings)',
      'mdtldr tree doc.md --json       # Outline as JSON',
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
    usage: 'mdtldr links <file> [options]',
    examples: [
      'mdtldr links README.md          # Show outgoing links',
      'mdtldr links doc.md --json      # Output as JSON',
      'mdtldr links doc.md -r docs/    # Resolve links relative to docs/',
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
    usage: 'mdtldr backlinks <file> [options]',
    examples: [
      'mdtldr backlinks api.md         # What links to api.md?',
      'mdtldr backlinks doc.md --json  # Output as JSON',
      'mdtldr backlinks doc.md -r ./   # Resolve from current directory',
    ],
    options: [
      {
        name: '-r, --root <dir>',
        description: 'Root directory for resolving relative links',
      },
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: ['Requires index to exist. Run "mdtldr index" first.'],
  },
  stats: {
    description: 'Show index statistics',
    usage: 'mdtldr stats [path] [options]',
    examples: [
      'mdtldr stats                    # Show stats for current directory',
      'mdtldr stats docs/              # Show stats for specific directory',
      'mdtldr stats --json             # Output as JSON',
    ],
    options: [
      { name: '--json', description: 'Output as JSON' },
      { name: '--pretty', description: 'Pretty-print JSON output' },
    ],
    notes: ['Shows embedding count, dimensions, and cost if embeddings exist.'],
  },
}

// ============================================================================
// Help Rendering
// ============================================================================

/**
 * Render beautiful subcommand help
 */
export const showSubcommandHelp = (command: string): void => {
  const help = helpContent[command]
  if (!help) {
    console.log(`Unknown command: ${command}`)
    console.log('Run "mdtldr --help" for available commands.')
    process.exit(1)
  }

  // Header
  console.log(`\n\x1b[1mmdtldr ${command}\x1b[0m - ${help.description}`)

  // Usage
  console.log(`\n\x1b[33mUSAGE\x1b[0m`)
  console.log(`  ${help.usage}`)

  // Examples
  console.log(`\n\x1b[33mEXAMPLES\x1b[0m`)
  for (const example of help.examples) {
    console.log(`  ${example}`)
  }

  // Options
  console.log(`\n\x1b[33mOPTIONS\x1b[0m`)
  for (const opt of help.options) {
    // Pad option name to 24 chars for alignment
    const paddedName = opt.name.padEnd(24)
    console.log(`  ${paddedName}${opt.description}`)
  }

  // Notes (if any)
  if (help.notes && help.notes.length > 0) {
    console.log(`\n\x1b[33mNOTES\x1b[0m`)
    for (const note of help.notes) {
      console.log(`  ${note}`)
    }
  }

  console.log('')
}

/**
 * Custom help output for main command - beautiful and useful
 */
export const showMainHelp = (): void => {
  const help = `
\x1b[1mmdtldr\x1b[0m - Token-efficient markdown analysis for LLMs

\x1b[33mCOMMANDS\x1b[0m
  index [path]              Index markdown files (default: .)
  search <query> [path]     Search by meaning or structure
  context <files>...        Get LLM-ready summary
  tree [path]               Show files or document outline
  links <file>              Show outgoing links
  backlinks <file>          Show incoming links
  stats [path]              Index statistics

\x1b[33mEXAMPLES\x1b[0m
  mdtldr tree                         # List all markdown files
  mdtldr tree README.md               # Show document outline
  mdtldr index                        # Index current directory
  mdtldr index --embed                # Index with semantic embeddings
  mdtldr search "auth"                # Simple term search
  mdtldr search "auth AND deploy"     # Boolean AND (both required)
  mdtldr search "error OR bug"        # Boolean OR (either matches)
  mdtldr search '"exact phrase"'      # Quoted phrase (exact match)
  mdtldr search "how to deploy"       # Semantic search (if embeddings exist)
  mdtldr context README.md            # Summarize a file
  mdtldr context *.md -t 2000         # Multi-file with token budget

\x1b[33mWORKFLOWS\x1b[0m
  \x1b[2m# Quick context for LLM\x1b[0m
  mdtldr context README.md docs/*.md | pbcopy

  \x1b[2m# Find relevant documentation\x1b[0m
  mdtldr search "error handling"

  \x1b[2m# Complex queries with boolean operators\x1b[0m
  mdtldr search "auth AND (error OR exception) NOT test"

  \x1b[2m# Explore a new codebase\x1b[0m
  mdtldr tree && mdtldr stats

  \x1b[2m# Build semantic search\x1b[0m
  mdtldr index --embed && mdtldr search "authentication flow"

\x1b[33mGLOBAL OPTIONS\x1b[0m
  --json          Output as JSON
  --pretty        Pretty-print JSON
  --help, -h      Show help
  --version, -v   Show version

Run \x1b[36mmdtldr <command> --help\x1b[0m for command-specific options.
`
  console.log(help)
}

// ============================================================================
// Help Detection
// ============================================================================

/**
 * Check for subcommand help pattern: mdtldr <cmd> --help or mdtldr <cmd> -h
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
