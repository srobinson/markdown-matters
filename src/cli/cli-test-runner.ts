import { exec } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
const cliPath = path.join(process.cwd(), 'dist', 'cli', 'main.js')
const cliCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)}`

export interface CliExecution {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface CliExecutionOptions {
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeout?: number
}

export const executeCli = async (
  args: string,
  options: CliExecutionOptions,
): Promise<CliExecution> => {
  try {
    const { stdout, stderr } = await execAsync(`${cliCommand} ${args}`, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      encoding: 'utf-8',
      timeout: options.timeout ?? 60_000,
    })
    return { exitCode: 0, stdout, stderr }
  } catch (cause) {
    const error = cause as {
      readonly code?: number | string
      readonly stdout?: string
      readonly stderr?: string
    }
    return {
      exitCode: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }
  }
}
