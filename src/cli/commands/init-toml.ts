/**
 * Default TOML Template Generator
 *
 * Generates a commented .mdm.toml configuration file with all defaults.
 */

import { defaultConfig } from '../../config/index.js'

const tomlArray = (items: readonly string[]): string =>
  `[${items.map((s) => `"${s}"`).join(', ')}]`

export const generateDefaultToml = (): string => `# mdm configuration
# https://github.com/helioy/markdown-matters

[index]
maxDepth = ${defaultConfig.index.maxDepth}
excludePatterns = ${tomlArray(defaultConfig.index.excludePatterns)}
fileExtensions = ${tomlArray(defaultConfig.index.fileExtensions)}
followSymlinks = ${defaultConfig.index.followSymlinks}

[search]
defaultLimit = ${defaultConfig.search.defaultLimit}
maxLimit = ${defaultConfig.search.maxLimit}
minSimilarity = ${defaultConfig.search.minSimilarity}
includeSnippets = ${defaultConfig.search.includeSnippets}
snippetLength = ${defaultConfig.search.snippetLength}
autoIndexThreshold = ${defaultConfig.search.autoIndexThreshold}

[embeddings]
provider = "${defaultConfig.embeddings.provider}"
model = "${defaultConfig.embeddings.model}"
dimensions = ${defaultConfig.embeddings.dimensions}
batchSize = ${defaultConfig.embeddings.batchSize}
maxRetries = ${defaultConfig.embeddings.maxRetries}
retryDelayMs = ${defaultConfig.embeddings.retryDelayMs}
timeoutMs = ${defaultConfig.embeddings.timeoutMs}
hnswM = ${defaultConfig.embeddings.hnswM}
hnswEfConstruction = ${defaultConfig.embeddings.hnswEfConstruction}
# baseURL = "https://custom-endpoint.example.com"
# apiKey = "sk-..."

[summarization]
briefTokenBudget = ${defaultConfig.summarization.briefTokenBudget}
summaryTokenBudget = ${defaultConfig.summarization.summaryTokenBudget}
compressionRatio = ${defaultConfig.summarization.compressionRatio}
minSectionTokens = ${defaultConfig.summarization.minSectionTokens}
maxTopics = ${defaultConfig.summarization.maxTopics}
minPartialBudget = ${defaultConfig.summarization.minPartialBudget}

[aiSummarization]
mode = "${defaultConfig.aiSummarization.mode}"
provider = "${defaultConfig.aiSummarization.provider}"
stream = ${defaultConfig.aiSummarization.stream}
# model = "claude-sonnet-4-20250514"
# baseURL = "https://api.anthropic.com"
# apiKey = "sk-ant-..."

[output]
format = "${defaultConfig.output.format}"
color = ${defaultConfig.output.color}
prettyJson = ${defaultConfig.output.prettyJson}
verbose = ${defaultConfig.output.verbose}
debug = ${defaultConfig.output.debug}

[paths]
# root = "/path/to/project"
# configFile = "/path/to/.mdm.toml"
`
