/**
 * MCP input validation schemas.
 *
 * Each schema corresponds to a single MCP tool and validates the
 * arguments received from the client before handler logic runs.
 */

import { Schema } from 'effect'

export const MdSearchArgs = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
  ),
  threshold: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
  path_filter: Schema.optional(Schema.String),
})

export const MdmArgs = Schema.Struct({
  path: Schema.String,
  level: Schema.optional(Schema.Literal('brief', 'summary', 'full')),
  max_tokens: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.positive()),
  ),
})

export const MdStructureArgs = Schema.Struct({
  path: Schema.String,
})

export const MdKeywordSearchArgs = Schema.Struct({
  heading: Schema.optional(Schema.String),
  path_filter: Schema.optional(Schema.String),
  has_code: Schema.optional(Schema.Boolean),
  has_list: Schema.optional(Schema.Boolean),
  has_table: Schema.optional(Schema.Boolean),
  limit: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(1, 500)),
  ),
})

export const MdIndexArgs = Schema.Struct({
  path: Schema.optional(Schema.String),
  force: Schema.optional(Schema.Boolean),
})

export const MdLinksArgs = Schema.Struct({
  path: Schema.String,
})

export const MdBacklinksArgs = Schema.Struct({
  path: Schema.String,
})
