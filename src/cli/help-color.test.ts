/**
 * Tests for color suppression via config file (output.color: false).
 *
 * Validates that shouldUseColor() and peekConfigColor() correctly
 * read the output.color setting from a config file specified via --config.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { peekConfigColor, showMainHelp } from './help.js'

describe('peekConfigColor', () => {
  let tempDir: string
  let originalArgv: string[]

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdcontext-color-test-'))
    originalArgv = process.argv
  })

  afterEach(() => {
    process.argv = originalArgv
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns true when no --config flag is present', () => {
    process.argv = ['node', 'main.js', '--help']
    expect(peekConfigColor()).toBe(true)
  })

  it('returns false when config has output.color: false', () => {
    const configPath = path.join(tempDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ output: { color: false } }))
    process.argv = ['node', 'main.js', '--config', configPath, '--help']
    expect(peekConfigColor()).toBe(false)
  })

  it('returns true when config has output.color: true', () => {
    const configPath = path.join(tempDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ output: { color: true } }))
    process.argv = ['node', 'main.js', '--config', configPath, '--help']
    expect(peekConfigColor()).toBe(true)
  })

  it('returns true when config has no output section', () => {
    const configPath = path.join(tempDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ index: { maxDepth: 5 } }))
    process.argv = ['node', 'main.js', '--config', configPath, '--help']
    expect(peekConfigColor()).toBe(true)
  })

  it('returns true when config file does not exist (fail open)', () => {
    process.argv = [
      'node',
      'main.js',
      '--config',
      '/nonexistent/path.json',
      '--help',
    ]
    expect(peekConfigColor()).toBe(true)
  })

  it('returns true when config file has invalid JSON (fail open)', () => {
    const configPath = path.join(tempDir, 'bad.json')
    fs.writeFileSync(configPath, 'not valid json {{{')
    process.argv = ['node', 'main.js', '--config', configPath, '--help']
    expect(peekConfigColor()).toBe(true)
  })

  it('handles --config=path syntax', () => {
    const configPath = path.join(tempDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ output: { color: false } }))
    process.argv = ['node', 'main.js', `--config=${configPath}`, '--help']
    expect(peekConfigColor()).toBe(false)
  })

  it('handles -c path syntax', () => {
    const configPath = path.join(tempDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ output: { color: false } }))
    process.argv = ['node', 'main.js', '-c', configPath, '--help']
    expect(peekConfigColor()).toBe(false)
  })

  it('handles -c=path syntax', () => {
    const configPath = path.join(tempDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({ output: { color: false } }))
    process.argv = ['node', 'main.js', `-c=${configPath}`, '--help']
    expect(peekConfigColor()).toBe(false)
  })
})

// ESC character used in ANSI escape sequences
const ESC = '\x1b'

describe('showMainHelp color suppression', () => {
  it('produces no ANSI escape sequences when color is false', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      showMainHelp(false)
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
      // Verify no ANSI escape sequences
      expect(output).not.toContain(ESC)
      // Verify content is still present
      expect(output).toContain('mdcontext')
      expect(output).toContain('COMMANDS')
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it('produces ANSI escape sequences when color is true', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      showMainHelp(true)
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n')
      // Verify ANSI escape sequences are present
      expect(output).toContain(ESC)
    } finally {
      consoleSpy.mockRestore()
    }
  })
})
