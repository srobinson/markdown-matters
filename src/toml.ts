import * as fs from 'node:fs'

import { parse, type TomlTable } from 'smol-toml'

export interface TomlParseError {
  readonly path: string
  readonly message: string
}

export type TomlDocumentLoadResult =
  | { readonly status: 'missing'; readonly path: string }
  | {
      readonly status: 'loaded'
      readonly path: string
      readonly value: TomlTable
    }
  | { readonly status: 'error'; readonly error: TomlParseError }

export const loadTomlDocumentWithStatus = (
  filePath: string,
): TomlDocumentLoadResult => {
  try {
    if (!fs.existsSync(filePath)) {
      return { status: 'missing', path: filePath }
    }

    return {
      status: 'loaded',
      path: filePath,
      value: parse(fs.readFileSync(filePath, 'utf-8')),
    }
  } catch (error) {
    return {
      status: 'error',
      error: {
        path: filePath,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
