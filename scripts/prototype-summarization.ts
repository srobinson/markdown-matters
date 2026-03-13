#!/usr/bin/env npx tsx
/**
 * Prototype: AI Summarization of Search Results
 *
 * Quick validation script to test the summarization approach.
 * Uses the actual mdm search and Claude CLI integration.
 *
 * Usage:
 *   npx tsx scripts/prototype-summarization.ts
 *   npx tsx scripts/prototype-summarization.ts "your query here"
 */

import { spawn } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'

// Test queries to validate the approach
const TEST_QUERIES = [
  'error handling',
  'configuration',
  'search',
  'embeddings',
  'Effect patterns',
]

interface SearchResult {
  path: string
  heading: string
  score?: number
  similarity?: number
}

interface SummaryResult {
  query: string
  searchResults: SearchResult[]
  summary: string
  durationMs: number
  provider: string
}

/**
 * Run mdm search and get JSON results
 */
async function runSearch(query: string, dir: string): Promise<SearchResult[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [
      path.join(dir, 'dist/cli/main.js'),
      'search',
      query,
      dir,
      '--json',
      '--limit', '5',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        // If search fails (no index), return empty results
        console.log(`  Search returned code ${code}, using empty results`)
        resolve([])
        return
      }

      try {
        const parsed = JSON.parse(stdout)
        const results = (parsed.results || []).map((r: any) => ({
          path: r.path,
          heading: r.heading,
          score: r.score,
          similarity: r.similarity,
        }))
        resolve(results)
      } catch (e) {
        console.log(`  Failed to parse search results: ${e}`)
        resolve([])
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })
  })
}

/**
 * Format search results for LLM input
 */
function formatResultsForLLM(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `Query: "${query}"\n\nNo search results found. The index may need to be built.`
  }

  const resultsText = results.map((r, i) => {
    const score = r.similarity
      ? `${(r.similarity * 100).toFixed(1)}% similarity`
      : r.score
        ? `score: ${r.score.toFixed(2)}`
        : ''
    return `${i + 1}. ${r.path}\n   Section: ${r.heading}\n   ${score}`
  }).join('\n\n')

  return `Query: "${query}"

Search Results (${results.length} found):

${resultsText}

Please provide a concise summary of what these results tell us about "${query}" in this codebase.
Focus on:
1. Key patterns and approaches found
2. Important files to look at
3. Actionable next steps for the developer`
}

/**
 * Call Claude CLI for summarization
 * SECURITY: Uses spawn() with argument arrays - never exec() with strings
 */
async function callClaudeCLI(prompt: string): Promise<{ summary: string; durationMs: number }> {
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    // SECURITY: spawn() with argument array - safe from shell injection
    const proc = spawn('claude', [
      '-p', prompt,
      '--output-format', 'text',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    // Timeout after 60 seconds
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error('Claude CLI timeout after 60s'))
    }, 60000)

    proc.on('close', (code: number | null) => {
      clearTimeout(timeout)
      const durationMs = Date.now() - startTime

      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`))
        return
      }

      resolve({
        summary: stdout.trim(),
        durationMs,
      })
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`))
    })
  })
}

/**
 * Check if Claude CLI is available
 */
async function checkClaudeCLI(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', ['claude'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    proc.on('close', (code) => {
      resolve(code === 0)
    })

    proc.on('error', () => {
      resolve(false)
    })
  })
}

/**
 * Run a single test query
 */
async function testQuery(query: string, projectDir: string): Promise<SummaryResult> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Query: "${query}"`)
  console.log('='.repeat(60))

  // 1. Run search
  console.log('\n1. Running search...')
  const searchResults = await runSearch(query, projectDir)
  console.log(`   Found ${searchResults.length} results`)

  // 2. Format for LLM
  const prompt = formatResultsForLLM(query, searchResults)

  // 3. Call Claude CLI
  console.log('\n2. Calling Claude CLI for summary...')
  const { summary, durationMs } = await callClaudeCLI(prompt)

  // 4. Display result
  console.log(`\n3. Summary (${durationMs}ms):`)
  console.log('-'.repeat(40))
  console.log(summary)
  console.log('-'.repeat(40))

  return {
    query,
    searchResults,
    summary,
    durationMs,
    provider: 'claude',
  }
}

/**
 * Main prototype function
 */
async function main() {
  const projectDir = path.resolve(import.meta.dirname, '..')
  console.log('Prototype: AI Summarization of Search Results')
  console.log(`Project: ${projectDir}`)

  // Check Claude CLI
  const hasClaudeCLI = await checkClaudeCLI()
  if (!hasClaudeCLI) {
    console.error('\nError: Claude CLI not found.')
    console.error('Install it from: https://claude.ai/download')
    process.exit(1)
  }
  console.log('Claude CLI: available')

  // Get query from args or use test queries
  const args = process.argv.slice(2)
  const queries = args.length > 0 ? args : TEST_QUERIES

  // Run tests
  const results: SummaryResult[] = []
  for (const query of queries) {
    try {
      const result = await testQuery(query, projectDir)
      results.push(result)
    } catch (err) {
      console.error(`\nError testing "${query}":`, err)
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('PROTOTYPE RESULTS SUMMARY')
  console.log('='.repeat(60))
  console.log(`\nQueries tested: ${results.length}`)
  console.log(`Total duration: ${results.reduce((sum, r) => sum + r.durationMs, 0)}ms`)
  console.log(`Average duration: ${Math.round(results.reduce((sum, r) => sum + r.durationMs, 0) / results.length)}ms`)

  // Write results to file
  const outputPath = path.join(projectDir, 'research/llm-summarization/prototype-results.md')
  const outputDir = path.dirname(outputPath)

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const markdown = generateResultsMarkdown(results)
  fs.writeFileSync(outputPath, markdown)
  console.log(`\nResults written to: ${outputPath}`)
}

/**
 * Generate markdown report from results
 */
function generateResultsMarkdown(results: SummaryResult[]): string {
  const timestamp = new Date().toISOString()
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0)
  const avgDuration = Math.round(totalDuration / results.length)

  let md = `# Prototype Results: AI Summarization

Generated: ${timestamp}

## Summary

- **Queries tested:** ${results.length}
- **Total duration:** ${totalDuration}ms
- **Average duration:** ${avgDuration}ms
- **Provider:** Claude CLI (free with subscription)

## Results

`

  for (const result of results) {
    md += `### Query: "${result.query}"

**Search Results:** ${result.searchResults.length} found
**Duration:** ${result.durationMs}ms

#### Summary

${result.summary}

---

`
  }

  md += `## Findings

### What Works Well

- [ ] Add observations here after running prototype

### Issues Discovered

- [ ] Add issues here after running prototype

### Recommendations

- [ ] Add recommendations here after running prototype
`

  return md
}

// Run
main().catch(console.error)
