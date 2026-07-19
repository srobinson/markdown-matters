import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateDefaultToml } from '../cli/commands/init-toml.js'
import { loadDetailed, readGlobalSources } from './loader.js'

const tempDirs: string[] = []

const makeTempDir = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('config precedence', () => {
  it('merges all tiers by key', () => {
    const home = makeTempDir('mdm-config-home-')
    const project = makeTempDir('mdm-config-project-')
    const write = (dir: string, file: string, content: string): void =>
      fs.writeFileSync(path.join(dir, file), content)

    write(home, '.mdm.toml', '[search]\ndefaultLimit=11\nmaxLimit=55\n')
    write(
      project,
      '.mdm.toml',
      '[search]\ndefaultLimit=22\n[output]\nprettyJson=false\n',
    )
    write(project, '.mdm.local.toml', '[search]\ndefaultLimit=33\n')
    vi.stubEnv('MDM_HOME', home)
    vi.stubEnv('MDM_SEARCH_DEFAULTLIMIT', '44')

    const result = loadDetailed({
      workingDir: project,
      cliOverrides: { search: { defaultLimit: 45 } },
    })

    expect(result.config.search).toMatchObject({
      defaultLimit: 45,
      maxLimit: 55,
    })
    expect(result.config.output.prettyJson).toBe(false)
    expect(result.sourceFiles).toEqual([
      path.join(home, '.mdm.toml'),
      path.join(project, '.mdm.toml'),
      path.join(project, '.mdm.local.toml'),
    ])
  })

  it('switches home config without leaking values between databases', () => {
    const firstHome = makeTempDir('mdm-config-first-home-')
    const secondHome = makeTempDir('mdm-config-second-home-')
    const project = makeTempDir('mdm-config-project-')
    fs.writeFileSync(
      path.join(firstHome, '.mdm.toml'),
      '[search]\ndefaultLimit=17\n',
    )
    fs.writeFileSync(
      path.join(secondHome, '.mdm.toml'),
      '[search]\ndefaultLimit=29\n',
    )

    vi.stubEnv('MDM_HOME', firstHome)
    const first = loadDetailed({ workingDir: project, skipEnv: true })
    vi.stubEnv('MDM_HOME', secondHome)
    const second = loadDetailed({ workingDir: project, skipEnv: true })

    expect(first.config.search.defaultLimit).toBe(17)
    expect(first.sourceFiles).toEqual([path.join(firstHome, '.mdm.toml')])
    expect(second.config.search.defaultLimit).toBe(29)
    expect(second.sourceFiles).toEqual([path.join(secondHome, '.mdm.toml')])
  })

  it('skips a malformed tier while retaining valid lower and higher tiers', () => {
    const home = makeTempDir('mdm-config-home-')
    const project = makeTempDir('mdm-config-project-')
    fs.writeFileSync(path.join(home, '.mdm.toml'), '[search]\nmaxLimit=55\n')
    fs.writeFileSync(path.join(project, '.mdm.toml'), '{ invalid toml <<<')
    fs.writeFileSync(
      path.join(project, '.mdm.local.toml'),
      '[search]\ndefaultLimit=33\n',
    )
    vi.stubEnv('MDM_HOME', home)

    const result = loadDetailed({
      workingDir: project,
      skipEnv: true,
      suppressWarnings: true,
    })

    expect(result.config.search).toMatchObject({
      defaultLimit: 33,
      maxLimit: 55,
    })
    expect(result.sourceFiles).toEqual([
      path.join(home, '.mdm.toml'),
      path.join(project, '.mdm.local.toml'),
    ])
    expect(result.parseErrors.map((error) => error.path)).toEqual([
      path.join(project, '.mdm.toml'),
    ])
  })

  it('reads registered sources from the selected home', () => {
    const home = makeTempDir('mdm-config-home-')
    fs.writeFileSync(
      path.join(home, '.mdm.toml'),
      '[[sources]]\npath="/notes/one"\nname="one"\n',
    )
    vi.stubEnv('MDM_HOME', home)

    expect(readGlobalSources()).toEqual([{ path: '/notes/one', name: 'one' }])
  })

  it('omits obsolete index and cache directory settings', () => {
    const toml = generateDefaultToml()

    expect(toml).not.toContain('indexDir')
    expect(toml).not.toContain('cacheDir')
  })
})
