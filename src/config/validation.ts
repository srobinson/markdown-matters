import { Option } from 'effect'
import type { MdmConfig } from './schema.js'
import {
  AI_SUMMARIZATION_MODES,
  defaultConfig,
  EMBEDDING_PROVIDER_NAMES,
  OUTPUT_FORMATS,
  SUMMARIZATION_PROVIDER_NAMES,
} from './schema.js'

export const CONFIG_ENUM_VALUES = {
  'embeddings.provider': EMBEDDING_PROVIDER_NAMES,
  'output.format': OUTPUT_FORMATS,
  'aiSummarization.mode': AI_SUMMARIZATION_MODES,
  'aiSummarization.provider': SUMMARIZATION_PROVIDER_NAMES,
} as const satisfies Record<string, readonly string[]>

export interface ConfigIssue {
  path: string
  expected: string
  received: unknown
  defaultValue: unknown
}

interface ConfigRule {
  path: string
  expected: string
  defaultValue: unknown | ((config: MdmConfig) => unknown)
  isValid: (value: unknown, config: MdmConfig) => boolean
}

const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isPositiveInteger = (value: unknown): value is number =>
  isInteger(value) && value >= 1

const isNonNegativeInteger = (value: unknown): value is number =>
  isInteger(value) && value >= 0

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isNonEmptyStringArray = (value: unknown): value is string[] =>
  isStringArray(value) && value.length > 0

const optionStringIsValid = (value: unknown): boolean =>
  Option.isOption(value) &&
  (!Option.isSome(value) || typeof value.value === 'string')

const enumRule = (
  path: keyof typeof CONFIG_ENUM_VALUES,
  defaultValue: string,
): ConfigRule => {
  const validValues: readonly string[] = CONFIG_ENUM_VALUES[path]
  return {
    path,
    expected: `one of ${validValues.map((value) => `"${value}"`).join(', ')}`,
    defaultValue,
    isValid: (value) =>
      typeof value === 'string' && validValues.includes(value),
  }
}

const booleanRule = (path: string, defaultValue: boolean): ConfigRule => ({
  path,
  expected: 'a boolean',
  defaultValue,
  isValid: (value) => typeof value === 'boolean',
})

const stringRule = (path: string, defaultValue: string): ConfigRule => ({
  path,
  expected: 'a string',
  defaultValue,
  isValid: (value) => typeof value === 'string',
})

const stringArrayRule = (
  path: string,
  defaultValue: readonly string[],
  options: { allowEmpty?: boolean } = {},
): ConfigRule => ({
  path,
  expected:
    options.allowEmpty === false
      ? 'a non-empty array of strings'
      : 'an array of strings',
  defaultValue,
  isValid: options.allowEmpty === false ? isNonEmptyStringArray : isStringArray,
})

const optionStringRule = (
  path: string,
  defaultValue: Option.Option<string>,
): ConfigRule => ({
  path,
  expected: 'a string or unset',
  defaultValue,
  isValid: optionStringIsValid,
})

const numberRule = (
  path: string,
  expected: string,
  defaultValue: ConfigRule['defaultValue'],
  isValid: (value: unknown, config: MdmConfig) => boolean,
): ConfigRule => ({
  path,
  expected,
  defaultValue,
  isValid,
})

const numberRules: ConfigRule[] = [
  numberRule(
    'index.maxDepth',
    'an integer greater than or equal to 1',
    defaultConfig.index.maxDepth,
    isPositiveInteger,
  ),
  numberRule(
    'search.defaultLimit',
    'an integer greater than or equal to 1 and less than or equal to search.maxLimit',
    (config: MdmConfig) =>
      isPositiveInteger(config.search.maxLimit)
        ? Math.min(defaultConfig.search.defaultLimit, config.search.maxLimit)
        : defaultConfig.search.defaultLimit,
    (value, config) =>
      isPositiveInteger(value) &&
      (!isPositiveInteger(config.search.maxLimit) ||
        value <= config.search.maxLimit),
  ),
  numberRule(
    'search.maxLimit',
    'an integer greater than or equal to 1',
    defaultConfig.search.maxLimit,
    isPositiveInteger,
  ),
  numberRule(
    'search.minSimilarity',
    'a number between 0 and 1',
    defaultConfig.search.minSimilarity,
    (value) => isFiniteNumber(value) && value >= 0 && value <= 1,
  ),
  numberRule(
    'search.snippetLength',
    'an integer greater than or equal to 0',
    defaultConfig.search.snippetLength,
    isNonNegativeInteger,
  ),
  numberRule(
    'search.autoIndexThreshold',
    'an integer greater than or equal to 1',
    defaultConfig.search.autoIndexThreshold,
    isPositiveInteger,
  ),
  numberRule(
    'embeddings.dimensions',
    'an integer greater than or equal to 1',
    defaultConfig.embeddings.dimensions,
    isPositiveInteger,
  ),
  numberRule(
    'embeddings.batchSize',
    'an integer greater than or equal to 1',
    defaultConfig.embeddings.batchSize,
    isPositiveInteger,
  ),
  numberRule(
    'embeddings.maxRetries',
    'an integer greater than or equal to 0',
    defaultConfig.embeddings.maxRetries,
    isNonNegativeInteger,
  ),
  numberRule(
    'embeddings.retryDelayMs',
    'an integer greater than or equal to 0',
    defaultConfig.embeddings.retryDelayMs,
    isNonNegativeInteger,
  ),
  numberRule(
    'embeddings.timeoutMs',
    'an integer greater than or equal to 1',
    defaultConfig.embeddings.timeoutMs,
    isPositiveInteger,
  ),
  numberRule(
    'embeddings.hnswM',
    'an integer greater than or equal to 1',
    defaultConfig.embeddings.hnswM,
    isPositiveInteger,
  ),
  numberRule(
    'embeddings.hnswEfConstruction',
    'an integer greater than or equal to 1',
    defaultConfig.embeddings.hnswEfConstruction,
    isPositiveInteger,
  ),
  numberRule(
    'summarization.briefTokenBudget',
    'an integer greater than or equal to 1',
    defaultConfig.summarization.briefTokenBudget,
    isPositiveInteger,
  ),
  numberRule(
    'summarization.summaryTokenBudget',
    'an integer greater than or equal to 1',
    defaultConfig.summarization.summaryTokenBudget,
    isPositiveInteger,
  ),
  numberRule(
    'summarization.compressionRatio',
    'a number greater than 0 and less than or equal to 1',
    defaultConfig.summarization.compressionRatio,
    (value) => isFiniteNumber(value) && value > 0 && value <= 1,
  ),
  numberRule(
    'summarization.minSectionTokens',
    'an integer greater than or equal to 1',
    defaultConfig.summarization.minSectionTokens,
    isPositiveInteger,
  ),
  numberRule(
    'summarization.maxTopics',
    'an integer greater than or equal to 1',
    defaultConfig.summarization.maxTopics,
    isPositiveInteger,
  ),
  numberRule(
    'summarization.minPartialBudget',
    'an integer greater than or equal to 1',
    defaultConfig.summarization.minPartialBudget,
    isPositiveInteger,
  ),
]

const CONFIG_RULES: ConfigRule[] = [
  enumRule('embeddings.provider', defaultConfig.embeddings.provider),
  enumRule('output.format', defaultConfig.output.format),
  enumRule('aiSummarization.mode', defaultConfig.aiSummarization.mode),
  enumRule('aiSummarization.provider', defaultConfig.aiSummarization.provider),
  booleanRule('index.followSymlinks', defaultConfig.index.followSymlinks),
  booleanRule('search.includeSnippets', defaultConfig.search.includeSnippets),
  booleanRule('aiSummarization.stream', defaultConfig.aiSummarization.stream),
  booleanRule('output.color', defaultConfig.output.color),
  booleanRule('output.prettyJson', defaultConfig.output.prettyJson),
  booleanRule('output.verbose', defaultConfig.output.verbose),
  booleanRule('output.debug', defaultConfig.output.debug),
  stringArrayRule('index.excludePatterns', defaultConfig.index.excludePatterns),
  stringArrayRule('index.fileExtensions', defaultConfig.index.fileExtensions, {
    allowEmpty: false,
  }),
  stringRule('embeddings.model', defaultConfig.embeddings.model),
  optionStringRule('embeddings.baseURL', defaultConfig.embeddings.baseURL),
  optionStringRule('embeddings.apiKey', defaultConfig.embeddings.apiKey),
  optionStringRule(
    'aiSummarization.model',
    defaultConfig.aiSummarization.model,
  ),
  optionStringRule(
    'aiSummarization.baseURL',
    defaultConfig.aiSummarization.baseURL,
  ),
  optionStringRule(
    'aiSummarization.apiKey',
    defaultConfig.aiSummarization.apiKey,
  ),
  optionStringRule('paths.root', defaultConfig.paths.root),
  optionStringRule('paths.configFile', defaultConfig.paths.configFile),
  ...numberRules,
]

export const CONFIG_VALIDATION_PATHS = CONFIG_RULES.map((rule) => rule.path)

const readConfigPath = (config: MdmConfig, path: string): unknown => {
  const [section, key] = path.split('.') as [keyof MdmConfig, string]
  return (config[section] as unknown as Record<string, unknown>)[key]
}

const resolveDefaultValue = (
  config: MdmConfig,
  defaultValue: ConfigRule['defaultValue'],
): unknown =>
  typeof defaultValue === 'function' ? defaultValue(config) : defaultValue

const writeConfigPath = (
  config: MdmConfig,
  path: string,
  value: unknown,
): void => {
  const [section, key] = path.split('.') as [keyof MdmConfig, string]
  ;(config[section] as unknown as Record<string, unknown>)[key] = value
}

const cloneConfig = (config: MdmConfig): MdmConfig => ({
  index: { ...config.index },
  search: { ...config.search },
  embeddings: { ...config.embeddings },
  summarization: { ...config.summarization },
  aiSummarization: { ...config.aiSummarization },
  output: { ...config.output },
  paths: { ...config.paths },
})

const formatValue = (value: unknown): string => {
  if (Option.isOption(value)) {
    return Option.isSome(value) ? `"${String(value.value)}"` : 'unset'
  }
  if (typeof value === 'string') return `"${value}"`
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

export const collectConfigIssues = (config: MdmConfig): ConfigIssue[] =>
  CONFIG_RULES.flatMap((rule) => {
    const received = readConfigPath(config, rule.path)
    return rule.isValid(received, config)
      ? []
      : [
          {
            path: rule.path,
            expected: rule.expected,
            received,
            defaultValue: resolveDefaultValue(config, rule.defaultValue),
          },
        ]
  })

export const coerceConfig = (
  config: MdmConfig,
  issues: ConfigIssue[] = collectConfigIssues(config),
): MdmConfig => {
  const result = cloneConfig(config)
  for (const issue of issues) {
    writeConfigPath(result, issue.path, issue.defaultValue)
  }
  return result
}

export const formatConfigIssue = (issue: ConfigIssue): string =>
  `${issue.path} must be ${issue.expected}; received ${formatValue(
    issue.received,
  )}, using default ${formatValue(issue.defaultValue)}`
