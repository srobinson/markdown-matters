/**
 * Per-Command Flag Schemas
 *
 * Defines the valid flags for each CLI command to enable:
 * - Unknown flag detection
 * - Typo suggestions
 * - Accurate flag/value parsing in the preprocessor
 */

/**
 * Type of flag
 */
export type FlagType = 'boolean' | 'string'

/**
 * Flag specification
 */
export interface FlagSpec {
  /** Flag name without leading dashes (e.g., 'json') */
  name: string
  /** Flag type: boolean (no value) or string (takes value) */
  type: FlagType
  /** Short alias without leading dash (e.g., 'n' for --limit) */
  alias?: string
  /** Description for error messages */
  description?: string
}

/**
 * Command flag schema
 */
export interface CommandSchema {
  /** Command name */
  name: string
  /** Valid flags for this command */
  flags: FlagSpec[]
}

// ============================================================================
// Shared Flags (used by multiple commands)
// ============================================================================

const jsonFlag: FlagSpec = {
  name: 'json',
  type: 'boolean',
  description: 'Output as JSON',
}

const prettyFlag: FlagSpec = {
  name: 'pretty',
  type: 'boolean',
  description: 'Pretty-print JSON output',
}

const forceFlag: FlagSpec = {
  name: 'force',
  type: 'boolean',
  description: 'Force full rebuild',
}

const rootFlag: FlagSpec = {
  name: 'root',
  type: 'string',
  alias: 'r',
  description: 'Root directory',
}

// ============================================================================
// Per-Command Schemas
// ============================================================================

export const indexSchema: CommandSchema = {
  name: 'index',
  flags: [
    {
      name: 'embed',
      type: 'boolean',
      alias: 'e',
      description: 'Build semantic embeddings',
    },
    {
      name: 'no-embed',
      type: 'boolean',
      description: 'Skip semantic search prompt',
    },
    {
      name: 'watch',
      type: 'boolean',
      alias: 'w',
      description: 'Watch for changes',
    },
    forceFlag,
    jsonFlag,
    prettyFlag,
  ],
}

export const searchSchema: CommandSchema = {
  name: 'search',
  flags: [
    {
      name: 'keyword',
      type: 'boolean',
      alias: 'k',
      description: 'Force keyword search',
    },
    {
      name: 'heading-only',
      type: 'boolean',
      alias: 'H',
      description: 'Search headings only',
    },
    {
      name: 'mode',
      type: 'string',
      alias: 'm',
      description: 'Force search mode (semantic or keyword)',
    },
    {
      name: 'limit',
      type: 'string',
      alias: 'n',
      description: 'Maximum results',
    },
    { name: 'threshold', type: 'string', description: 'Similarity threshold' },
    {
      name: 'context',
      type: 'string',
      alias: 'C',
      description: 'Lines of context around matches (like grep -C)',
    },
    {
      name: 'before-context',
      type: 'string',
      alias: 'B',
      description: 'Lines of context before matches (like grep -B)',
    },
    {
      name: 'after-context',
      type: 'string',
      alias: 'A',
      description: 'Lines of context after matches (like grep -A)',
    },
    {
      name: 'fuzzy',
      type: 'boolean',
      alias: 'f',
      description: 'Enable fuzzy matching for typo tolerance',
    },
    {
      name: 'stem',
      type: 'boolean',
      description: 'Enable word stemming (fail matches failure, failed)',
    },
    {
      name: 'fuzzy-distance',
      type: 'string',
      description: 'Max edit distance for fuzzy matching (default: 2)',
    },
    {
      name: 'refine',
      type: 'string',
      description:
        'Additional filter to narrow results (can be used multiple times)',
    },
    jsonFlag,
    prettyFlag,
  ],
}

export const contextSchema: CommandSchema = {
  name: 'context',
  flags: [
    { name: 'tokens', type: 'string', alias: 't', description: 'Token budget' },
    { name: 'brief', type: 'boolean', description: 'Minimal output' },
    { name: 'full', type: 'boolean', description: 'Include full content' },
    {
      name: 'section',
      type: 'string',
      alias: 'S',
      description: 'Filter by section name, number, or glob pattern',
    },
    {
      name: 'sections',
      type: 'boolean',
      description: 'List available sections',
    },
    {
      name: 'shallow',
      type: 'boolean',
      description: 'Exclude nested subsections when filtering',
    },
    {
      name: 'exclude',
      type: 'string',
      alias: 'x',
      description:
        'Exclude sections matching pattern (can be used multiple times)',
    },
    jsonFlag,
    prettyFlag,
  ],
}

export const treeSchema: CommandSchema = {
  name: 'tree',
  flags: [jsonFlag, prettyFlag],
}

export const linksSchema: CommandSchema = {
  name: 'links',
  flags: [rootFlag, jsonFlag, prettyFlag],
}

export const backlinksSchema: CommandSchema = {
  name: 'backlinks',
  flags: [rootFlag, jsonFlag, prettyFlag],
}

export const statsSchema: CommandSchema = {
  name: 'stats',
  flags: [jsonFlag, prettyFlag],
}

// ============================================================================
// Schema Registry
// ============================================================================

/**
 * All command schemas indexed by command name
 */
export const commandSchemas: Record<string, CommandSchema> = {
  index: indexSchema,
  search: searchSchema,
  context: contextSchema,
  tree: treeSchema,
  links: linksSchema,
  backlinks: backlinksSchema,
  stats: statsSchema,
}

/**
 * Get schema for a command
 */
export const getCommandSchema = (
  commandName: string,
): CommandSchema | undefined => {
  return commandSchemas[commandName]
}

/**
 * Get all valid flag names for a command (both long and short forms)
 */
export const getValidFlags = (schema: CommandSchema): Set<string> => {
  const flags = new Set<string>()
  for (const spec of schema.flags) {
    flags.add(`--${spec.name}`)
    if (spec.alias) {
      flags.add(`-${spec.alias}`)
    }
  }
  return flags
}

/**
 * Check if a flag takes a value for a given command
 */
export const flagTakesValue = (
  schema: CommandSchema,
  flag: string,
): boolean => {
  // Handle --flag=value syntax
  if (flag.includes('=')) {
    return false // Value is already embedded
  }

  for (const spec of schema.flags) {
    if (
      flag === `--${spec.name}` ||
      (spec.alias && flag === `-${spec.alias}`)
    ) {
      return spec.type === 'string'
    }
  }
  return false
}

/**
 * Find the canonical name for a flag (for suggestions)
 */
export const getCanonicalFlagName = (
  schema: CommandSchema,
  flag: string,
): string | undefined => {
  for (const spec of schema.flags) {
    if (
      flag === `--${spec.name}` ||
      (spec.alias && flag === `-${spec.alias}`)
    ) {
      return `--${spec.name}`
    }
  }
  return undefined
}
