import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { parse } from './parser.js'

describe('markdown parser', () => {
  describe('basic parsing', () => {
    it('parses a simple markdown document', async () => {
      const content = `# Hello World

This is a paragraph.

## Section One

Content for section one.

## Section Two

Content for section two.
`

      const result = await Effect.runPromise(parse(content))

      expect(result.title).toBe('Hello World')
      expect(result.sections).toHaveLength(1) // One H1 as root
      expect(result.sections[0]?.heading).toBe('Hello World')
      expect(result.sections[0]?.children).toHaveLength(2) // Two H2 children
    })

    it('extracts frontmatter', async () => {
      const content = `---
title: Custom Title
author: Test Author
tags:
  - markdown
  - parser
---

# Heading

Content here.
`

      const result = await Effect.runPromise(parse(content))

      expect(result.frontmatter).toEqual({
        title: 'Custom Title',
        author: 'Test Author',
        tags: ['markdown', 'parser'],
      })
      expect(result.title).toBe('Heading') // H1 takes precedence
    })

    it('uses frontmatter title when no H1 present', async () => {
      const content = `---
title: Frontmatter Title
---

## Only an H2

Some content.
`

      const result = await Effect.runPromise(parse(content))

      expect(result.title).toBe('Frontmatter Title')
    })

    it('handles malformed YAML frontmatter gracefully', async () => {
      const content = `---
title: Valid Start
But this is not valid YAML:
  - missing colon here
  invalid: [unclosed bracket
---

# Actual Content

This should still parse.
`

      const result = await Effect.runPromise(parse(content))

      // Should not throw, should parse with empty frontmatter
      expect(result.frontmatter).toEqual({})
      expect(result.title).toBe('Actual Content')
    })
  })

  describe('section hierarchy', () => {
    it('builds proper section hierarchy', async () => {
      const content = `# Root

## Level 2 A

### Level 3 A1

Content

### Level 3 A2

Content

## Level 2 B

Content
`

      const result = await Effect.runPromise(parse(content))

      expect(result.sections).toHaveLength(1)

      const root = result.sections[0]!
      expect(root.heading).toBe('Root')
      expect(root.children).toHaveLength(2)

      const level2A = root.children[0]!
      expect(level2A.heading).toBe('Level 2 A')
      expect(level2A.children).toHaveLength(2)

      const level3A1 = level2A.children[0]!
      expect(level3A1.heading).toBe('Level 3 A1')
      expect(level3A1.children).toHaveLength(0)
    })
  })

  describe('links', () => {
    it('extracts internal links', async () => {
      const content = `# Links

Check out [other doc](./other.md).

And [section link](#section).
`

      const result = await Effect.runPromise(parse(content))

      expect(result.links).toHaveLength(2)
      expect(result.links[0]?.type).toBe('internal')
      expect(result.links[0]?.href).toBe('./other.md')
      expect(result.links[1]?.type).toBe('internal')
      expect(result.links[1]?.href).toBe('#section')
    })

    it('extracts external links', async () => {
      const content = `# External Links

Visit [Google](https://google.com).
`

      const result = await Effect.runPromise(parse(content))

      expect(result.links).toHaveLength(1)
      expect(result.links[0]?.type).toBe('external')
      expect(result.links[0]?.href).toBe('https://google.com')
    })

    it('extracts image links', async () => {
      const content = `# Images

![Alt text](./image.png)
`

      const result = await Effect.runPromise(parse(content))

      expect(result.links).toHaveLength(1)
      expect(result.links[0]?.type).toBe('image')
      expect(result.links[0]?.text).toBe('Alt text')
    })
  })

  describe('code blocks', () => {
    it('extracts code blocks with language', async () => {
      const content = `# Code

\`\`\`typescript
const x = 1;
\`\`\`
`

      const result = await Effect.runPromise(parse(content))

      expect(result.codeBlocks).toHaveLength(1)
      expect(result.codeBlocks[0]?.language).toBe('typescript')
      expect(result.codeBlocks[0]?.content).toBe('const x = 1;')
    })

    it('extracts code blocks without language', async () => {
      const content = `# Code

\`\`\`
plain text
\`\`\`
`

      const result = await Effect.runPromise(parse(content))

      expect(result.codeBlocks).toHaveLength(1)
      expect(result.codeBlocks[0]?.language).toBeNull()
    })
  })

  describe('GFM features', () => {
    it('detects tables in sections', async () => {
      const content = `# Tables

| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |
`

      const result = await Effect.runPromise(parse(content))

      expect(result.sections[0]?.metadata.hasTable).toBe(true)
    })

    it('detects lists in sections', async () => {
      const content = `# Lists

- Item 1
- Item 2
- Item 3
`

      const result = await Effect.runPromise(parse(content))

      expect(result.sections[0]?.metadata.hasList).toBe(true)
    })

    it('detects task lists', async () => {
      const content = `# Tasks

- [ ] Todo item
- [x] Completed item
`

      const result = await Effect.runPromise(parse(content))

      expect(result.sections[0]?.metadata.hasList).toBe(true)
    })
  })

  describe('section IDs', () => {
    it('includes line number to prevent slug collisions', async () => {
      const content = `# Document

## Setup: Part 1

First section.

## Setup. Part 1

Second section (different punctuation, same slug).
`

      const result = await Effect.runPromise(parse(content))

      const root = result.sections[0]!
      const child1 = root.children[0]!
      const child2 = root.children[1]!

      // Both headings slugify identically, but IDs differ by line number
      expect(child1.id).not.toBe(child2.id)
      expect(child1.id).toMatch(/-L3$/)
      expect(child2.id).toMatch(/-L7$/)
    })

    it('appends line number to all section IDs', async () => {
      const content = `# Title

## Introduction

Some text.

## Conclusion

More text.
`

      const result = await Effect.runPromise(parse(content))

      const root = result.sections[0]!
      expect(root.id).toMatch(/-L1$/)
      expect(root.children[0]!.id).toMatch(/-L3$/)
      expect(root.children[1]!.id).toMatch(/-L7$/)
    })

    it('uses line numbers in link sectionId references', async () => {
      const content = `# Doc

## Links

[example](https://example.com)
`

      const result = await Effect.runPromise(parse(content))

      const link = result.links[0]!
      expect(link.sectionId).toMatch(/-L3$/)
    })

    it('uses line numbers in code block sectionId references', async () => {
      const content = `# Doc

## Code

\`\`\`js
console.log('test')
\`\`\`
`

      const result = await Effect.runPromise(parse(content))

      const block = result.codeBlocks[0]!
      expect(block.sectionId).toMatch(/-L3$/)
    })
  })

  describe('metadata', () => {
    it('counts tokens and words', async () => {
      const content = `# Document

This is some text content for testing token counting.
`

      const result = await Effect.runPromise(parse(content))

      expect(result.metadata.tokenCount).toBeGreaterThan(0)
      expect(result.metadata.wordCount).toBeGreaterThan(0)
    })

    it('counts links and code blocks', async () => {
      const content = `# Test

[Link 1](./a.md)
[Link 2](./b.md)

\`\`\`js
code
\`\`\`

\`\`\`py
code
\`\`\`
`

      const result = await Effect.runPromise(parse(content))

      expect(result.metadata.linkCount).toBe(2)
      expect(result.metadata.codeBlockCount).toBe(2)
    })

    it('counts headings', async () => {
      const content = `# H1

## H2

### H3

## Another H2
`

      const result = await Effect.runPromise(parse(content))

      expect(result.metadata.headingCount).toBe(4)
    })
  })
})
