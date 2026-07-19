/** Stable facade for index construction and link queries. */

export type { BuildBM25Options, BuildBM25Result } from './bm25-build.js'
export { buildBM25Index } from './bm25-build.js'
export type { IndexOptions, IndexProgress } from './index-build.js'
export { buildIndex } from './index-build.js'
export {
  getBrokenLinks,
  getIncomingLinks,
  getOutgoingLinks,
} from './link-index.js'
