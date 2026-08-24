import { describe, expect, it } from 'vitest'

import { buildSnippet } from './snippet.js'

describe('buildSnippet', () => {
  it('drops the leading heading and collapses the body to one line', () => {
    const content = '## Setup\n\nInstall the CLI.\nThen run the indexer.\n'
    expect(buildSnippet(content, 200)).toBe(
      'Install the CLI. Then run the indexer.',
    )
  })

  it('keeps body text that is not a heading', () => {
    expect(buildSnippet('Plain body with no heading.', 200)).toBe(
      'Plain body with no heading.',
    )
  })

  it('cuts on a word boundary and marks the elision', () => {
    const snippet = buildSnippet(`# H\n${'alpha beta '.repeat(40)}`, 30)
    expect(snippet).toBeDefined()
    expect(snippet?.endsWith('…')).toBe(true)
    expect(snippet?.length).toBeLessThanOrEqual(31)
    expect(snippet).not.toMatch(/\s…$/u)
  })

  it('cuts mid-word rather than returning almost nothing', () => {
    // No space until well past the limit, so a boundary cut would leave
    // a uselessly short snippet.
    const snippet = buildSnippet(`# H\n${'x'.repeat(50)} tail`, 20)
    expect(snippet).toBe(`${'x'.repeat(20)}…`)
  })

  it('returns undefined when there is no body to show', () => {
    expect(buildSnippet(undefined, 200)).toBeUndefined()
    expect(buildSnippet('# Heading only', 200)).toBeUndefined()
    expect(buildSnippet('# Heading\n\n   \n', 200)).toBeUndefined()
    expect(buildSnippet('body', 0)).toBeUndefined()
  })
})
