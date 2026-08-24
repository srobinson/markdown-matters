/**
 * Presentation-side snippet for a search hit.
 *
 * A hit is only useful if the caller can tell whether it is worth
 * opening. Heading plus score cannot answer that, so surfaces that
 * cannot show the whole section show a snippet of it instead.
 */

/**
 * Reduce section content to a single trimmed line of at most
 * `maxLength` characters.
 *
 * Section content opens with its own heading, which every caller
 * already renders, so the first line goes. What remains is collapsed to
 * one line and cut on a word boundary when it overruns.
 *
 * Returns undefined when there is no body to show, so callers can omit
 * the line entirely rather than print an empty one.
 */
export const buildSnippet = (
  content: string | undefined,
  maxLength: number,
): string | undefined => {
  if (content === undefined || maxLength < 1) return undefined

  const lines = content.split('\n')
  const body = (lines[0]?.startsWith('#') ? lines.slice(1) : lines)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()

  if (body.length === 0) return undefined
  if (body.length <= maxLength) return body

  const cut = body.slice(0, maxLength)
  const boundary = cut.lastIndexOf(' ')
  const trimmed = boundary > maxLength * 0.6 ? cut.slice(0, boundary) : cut
  return `${trimmed.trimEnd()}…`
}
