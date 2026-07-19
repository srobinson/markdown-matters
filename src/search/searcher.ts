/** Stable facade for search and document context operations. */

export type {
  ContentMatch,
  SearchOptions,
  SearchResult,
} from './content-search.js'
export {
  search,
  searchContent,
  searchWithContent,
} from './content-search.js'
export type {
  ContextOptions,
  DocumentContext,
  SectionContext,
} from './context.js'
export {
  formatContextForLLM,
  getContext,
} from './context.js'
