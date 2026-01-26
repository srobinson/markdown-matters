/**
 * Tests for path-matcher utilities
 */

import { describe, expect, it } from 'vitest'
import { matchPath } from './path-matcher.js'

describe('path-matcher', () => {
  describe('matchPath', () => {
    describe('basic patterns', () => {
      it('matches exact paths', () => {
        expect(matchPath('docs/readme.md', 'docs/readme.md')).toBe(true)
        expect(matchPath('src/index.ts', 'src/index.ts')).toBe(true)
      })

      it('does not match different paths', () => {
        expect(matchPath('docs/readme.md', 'src/readme.md')).toBe(false)
        expect(matchPath('docs/readme.md', 'docs/other.md')).toBe(false)
      })

      it('is case-insensitive', () => {
        expect(matchPath('docs/README.md', 'docs/readme.md')).toBe(true)
        expect(matchPath('DOCS/readme.md', 'docs/readme.md')).toBe(true)
        expect(matchPath('docs/readme.MD', 'docs/readme.md')).toBe(true)
      })
    })

    describe('asterisk wildcard (*)', () => {
      it('matches any characters within filename', () => {
        expect(matchPath('docs/readme.md', 'docs/*.md')).toBe(true)
        expect(matchPath('docs/guide.md', 'docs/*.md')).toBe(true)
        expect(matchPath('docs/api-reference.md', 'docs/*.md')).toBe(true)
      })

      it('matches empty string with asterisk', () => {
        expect(matchPath('docs/.md', 'docs/*.md')).toBe(true)
      })

      it('matches patterns at start of path', () => {
        expect(matchPath('src/index.ts', '*/index.ts')).toBe(true)
        expect(matchPath('lib/index.ts', '*/index.ts')).toBe(true)
      })

      it('matches patterns in middle of path', () => {
        expect(matchPath('src/utils/index.ts', 'src/*/index.ts')).toBe(true)
        expect(matchPath('src/helpers/index.ts', 'src/*/index.ts')).toBe(true)
      })

      it('matches multiple wildcards', () => {
        expect(matchPath('src/utils/test.ts', '*/*/*.ts')).toBe(true)
        expect(matchPath('a/b/c.ts', '*/*/*.ts')).toBe(true)
      })

      it('single asterisk does NOT match directory separators', () => {
        // Standard glob semantics: * matches within a segment only
        expect(matchPath('file.md', '*.md')).toBe(true)
        expect(matchPath('dir/file.md', '*.md')).toBe(false) // * doesn't match /
        expect(matchPath('deeply/nested/path/file.md', '*')).toBe(false)
        expect(matchPath('a/b/c.ts', '*.ts')).toBe(false)
      })

      it('does not match nested paths with single asterisk', () => {
        expect(matchPath('docs/nested/api.md', 'docs/*.md')).toBe(false)
        expect(matchPath('src/sub/file.ts', 'src/*.ts')).toBe(false)
      })
    })

    describe('double asterisk wildcard (**)', () => {
      it('matches across directory separators', () => {
        expect(matchPath('deeply/nested/path/file.md', '**')).toBe(true)
        expect(matchPath('a/b/c.ts', '**.ts')).toBe(true)
        expect(matchPath('a/b/c.ts', '**/*.ts')).toBe(true)
      })

      it('matches nested paths recursively', () => {
        expect(matchPath('docs/nested/api.md', 'docs/**/*.md')).toBe(true)
        expect(matchPath('docs/deeply/nested/file.md', 'docs/**/*.md')).toBe(
          true,
        )
        expect(matchPath('src/a/b/c/file.ts', 'src/**/*.ts')).toBe(true)
      })

      it('matches at beginning of pattern', () => {
        expect(matchPath('any/path/to/file.md', '**/*.md')).toBe(true)
        // Note: **/*.md requires at least one /; for root files use *.md or **.md
        expect(matchPath('file.md', '**.md')).toBe(true)
        expect(matchPath('file.md', '*.md')).toBe(true)
      })
    })

    describe('question mark wildcard (?)', () => {
      it('matches exactly one character', () => {
        expect(matchPath('file1.md', 'file?.md')).toBe(true)
        expect(matchPath('fileA.md', 'file?.md')).toBe(true)
        expect(matchPath('file-.md', 'file?.md')).toBe(true)
      })

      it('does not match zero characters', () => {
        expect(matchPath('file.md', 'file?.md')).toBe(false)
      })

      it('does not match multiple characters', () => {
        expect(matchPath('file12.md', 'file?.md')).toBe(false)
        expect(matchPath('fileABC.md', 'file?.md')).toBe(false)
      })

      it('matches multiple question marks', () => {
        expect(matchPath('file12.md', 'file??.md')).toBe(true)
        expect(matchPath('fileAB.md', 'file??.md')).toBe(true)
        expect(matchPath('file1.md', 'file??.md')).toBe(false)
      })

      it('can be combined with asterisk', () => {
        expect(matchPath('v1/readme.md', 'v?/*.md')).toBe(true)
        expect(matchPath('v2/guide.md', 'v?/*.md')).toBe(true)
        expect(matchPath('v10/readme.md', 'v?/*.md')).toBe(false)
      })

      it('does not match directory separators', () => {
        expect(matchPath('a/b', 'a?b')).toBe(false) // ? should not match /
      })
    })

    describe('dot handling', () => {
      it('treats dot as literal character', () => {
        expect(matchPath('file.md', 'file.md')).toBe(true)
        expect(matchPath('fileXmd', 'file.md')).toBe(false)
      })

      it('escapes dots in patterns correctly', () => {
        expect(matchPath('src.utils.index.ts', 'src.utils.index.ts')).toBe(true)
        expect(matchPath('srcXutilsXindexXts', 'src.utils.index.ts')).toBe(
          false,
        )
      })

      it('matches file extensions correctly', () => {
        expect(matchPath('readme.md', '*.md')).toBe(true)
        expect(matchPath('readme.markdown', '*.md')).toBe(false)
        expect(matchPath('readmeXmd', '*.md')).toBe(false)
      })
    })

    describe('special regex characters', () => {
      it('handles paths with special characters', () => {
        // The path-matcher now escapes all regex special chars
        expect(matchPath('file.test.md', 'file.test.md')).toBe(true)
      })

      it('handles patterns with multiple dots', () => {
        expect(matchPath('package.config.json', '*.config.json')).toBe(true)
        expect(matchPath('app.module.ts', '*.module.ts')).toBe(true)
      })

      it('treats parentheses as literal characters', () => {
        expect(matchPath('file(1).md', 'file(1).md')).toBe(true)
        expect(matchPath('file1.md', 'file(1).md')).toBe(false)
      })

      it('treats square brackets as literal characters', () => {
        expect(matchPath('[ab].md', '[ab].md')).toBe(true)
        expect(matchPath('a.md', '[ab].md')).toBe(false)
        expect(matchPath('b.md', '[ab].md')).toBe(false)
      })

      it('treats plus as literal character', () => {
        expect(matchPath('C++.md', 'C++.md')).toBe(true)
        expect(matchPath('C.md', 'C++.md')).toBe(false)
      })

      it('treats caret as literal character', () => {
        expect(matchPath('test^2.md', 'test^2.md')).toBe(true)
        expect(matchPath('test2.md', 'test^2.md')).toBe(false)
      })

      it('treats dollar sign as literal character', () => {
        expect(matchPath('price$100.md', 'price$100.md')).toBe(true)
        expect(matchPath('price100.md', 'price$100.md')).toBe(false)
      })

      it('treats curly braces as literal characters', () => {
        expect(matchPath('obj{}.md', 'obj{}.md')).toBe(true)
        expect(matchPath('obj.md', 'obj{}.md')).toBe(false)
      })

      it('treats pipe as literal character', () => {
        expect(matchPath('a|b.md', 'a|b.md')).toBe(true)
        expect(matchPath('a.md', 'a|b.md')).toBe(false)
      })

      it('treats backslash as literal character', () => {
        expect(matchPath('path\\file.md', 'path\\file.md')).toBe(true)
        expect(matchPath('pathfile.md', 'path\\file.md')).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('matches empty path with empty pattern', () => {
        expect(matchPath('', '')).toBe(true)
      })

      it('does not match non-empty path with empty pattern', () => {
        expect(matchPath('file.md', '')).toBe(false)
      })

      it('does not match empty path with non-empty pattern', () => {
        expect(matchPath('', 'file.md')).toBe(false)
      })

      it('matches only asterisk pattern', () => {
        expect(matchPath('anything', '*')).toBe(true)
        expect(matchPath('', '*')).toBe(true)
        expect(matchPath('a/b/c', '*')).toBe(false) // * doesn't match /
        expect(matchPath('a/b/c', '**')).toBe(true) // ** matches everything
      })

      it('matches only question mark pattern', () => {
        expect(matchPath('a', '?')).toBe(true)
        expect(matchPath('ab', '?')).toBe(false)
        expect(matchPath('', '?')).toBe(false)
      })

      it('handles very long paths', () => {
        const longPath = `${'a/'.repeat(50)}file.md`
        const longPattern = `${'a/'.repeat(50)}*.md`
        expect(matchPath(longPath, longPattern)).toBe(true)
      })

      it('handles paths with spaces', () => {
        expect(matchPath('my docs/readme.md', 'my docs/*.md')).toBe(true)
        expect(matchPath('path with spaces/file.md', '*/file.md')).toBe(true)
        // Nested requires **
        expect(matchPath('a/path with spaces/file.md', '*/file.md')).toBe(false)
        expect(matchPath('a/path with spaces/file.md', '**/file.md')).toBe(true)
      })

      it('handles unicode characters', () => {
        expect(matchPath('docs/日本語.md', 'docs/*.md')).toBe(true)
        expect(matchPath('文档/readme.md', '*/readme.md')).toBe(true)
        expect(matchPath('a/文档/readme.md', '**/readme.md')).toBe(true)
      })
    })

    describe('real-world patterns', () => {
      it('matches markdown files in docs folder', () => {
        expect(matchPath('docs/readme.md', 'docs/*.md')).toBe(true)
        expect(matchPath('docs/api.md', 'docs/*.md')).toBe(true)
        // * doesn't match /, use ** for nested paths
        expect(matchPath('docs/nested/api.md', 'docs/*.md')).toBe(false)
        expect(matchPath('docs/nested/api.md', 'docs/**/*.md')).toBe(true)
      })

      it('matches typescript files in src', () => {
        expect(matchPath('src/index.ts', 'src/*.ts')).toBe(true)
        expect(matchPath('src/utils.ts', 'src/*.ts')).toBe(true)
        // Nested requires **
        expect(matchPath('src/nested/index.ts', 'src/*.ts')).toBe(false)
        expect(matchPath('src/nested/index.ts', 'src/**/*.ts')).toBe(true)
      })

      it('matches test files', () => {
        expect(matchPath('test.spec.ts', '*.spec.ts')).toBe(true)
        expect(matchPath('utils.test.ts', '*.test.ts')).toBe(true)
        // Nested requires **
        expect(matchPath('src/utils.test.ts', '*.test.ts')).toBe(false)
        expect(matchPath('src/utils.test.ts', '**/*.test.ts')).toBe(true)
      })

      it('matches config files', () => {
        expect(matchPath('tsconfig.json', '*.json')).toBe(true)
        expect(matchPath('package.json', 'package.json')).toBe(true)
        expect(matchPath('.eslintrc.json', '*.json')).toBe(true)
      })
    })
  })
})
