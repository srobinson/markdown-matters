# Comments Are Skipped: The Format Problem

**Date:** 2026-01-28
**Status:** Critical insight - updates the thesis

---

## The Original Thesis

Frontmatter in file headers → LLMs read first 20 lines → 94% token reduction.

## The Problem

LLMs already read the first 20 lines.

**They skip the comments.**

```typescript
// ---
// file: ./auth.ts
// exports: [validateUser]
// ---
```

LLM cognition: "Comment block → noise → skip → find code"

**Frontmatter as comments is invisible.**

---

## The Evidence

When I (Claude) read a file with frontmatter without being told to use it:

1. Registered lines 1-8 as "comment header decoration"
2. Skipped to line 10+ looking for actual code
3. Never used the exports/imports metadata
4. Read the full file to understand what it does

**The data was there. I ignored it.**

---

## The Fix: Format, Not Behavior

The problem isn't LLM read behavior. The problem is the format.

### Comments = Skipped

```typescript
// ---
// exports: [validateUser]
// ---
```

Invisible. Dead on arrival.

### Code = Parsed

```typescript
export const __meta = {
  exports: ["validateUser"],
  imports: ["crypto"],
  loc: 234
};
```

LLM reads this as code. It's visible.

### JSON = Queryable

```json
// .fmm/index.json
{
  "src/auth.ts": {
    "exports": ["validateUser"],
    "imports": ["crypto"],
    "loc": 234
  }
}
```

LLM queries this before reading files. No comments to skip.

---

## The Updated Model

| Format | Human Readable | LLM Visible | Recommendation |
|--------|----------------|-------------|----------------|
| Comment frontmatter | Yes | **No** | Keep for humans |
| Code export | Yes | Yes | Bundler issues |
| Manifest JSON | No | **Yes** | Add for LLMs |

**Generate both:**
- Inline comments → human readability
- Manifest JSON → LLM queryability

---

## Implications for mdcontext

mdcontext is about giving LLMs exactly what they need.

**Lesson:** Format matters as much as content.

- Markdown headers → LLMs parse these (structured)
- Markdown prose → LLMs read this (content)
- Code comments → LLMs skip this (noise)

When designing LLM-readable formats:
1. **Avoid comment syntax** - it signals "ignore me"
2. **Use structured data** - JSON, YAML, code
3. **Put it where LLMs look** - separate files, explicit markers

---

## The Meta Point

We're generating markdown research docs.

mdcontext exists to make markdown LLM-readable.

The insight applies recursively:
- **Structure** your markdown (headers, lists) → LLMs parse it
- **Avoid** wall-of-text prose → LLMs skim it
- **Use** explicit markers for key info → LLMs find it

This document uses:
- Headers for navigation
- Tables for comparison
- Code blocks for examples
- Short paragraphs for scannability

**Format is interface.**

---

*Captured: 2026-01-28*
