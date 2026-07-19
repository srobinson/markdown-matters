import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export interface ResolveMdmHomeOptions {
  readonly create?: boolean
  readonly env?: NodeJS.ProcessEnv
}

export const resolveMdmHome = (options: ResolveMdmHomeOptions = {}): string => {
  const value =
    options.env?.MDM_HOME ??
    process.env.MDM_HOME ??
    path.join(os.homedir(), '.mdm')
  const candidate = path.resolve(value.replace(/^~(?=$|[\\/])/, os.homedir()))

  if (options.create) {
    fs.mkdirSync(candidate, { recursive: true })
  }

  try {
    return fs.realpathSync(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return candidate
    }
    throw error
  }
}

export const dbIndexDir = (home: string): string => path.resolve(home)

export const legacyIndexDir = (sourceRoot: string): string =>
  path.join(path.resolve(sourceRoot), '.mdm')
