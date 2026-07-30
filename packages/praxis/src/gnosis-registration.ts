import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { PraxisCommandError } from './errors.js'

export const GNOSIS_AGENTS = ['codex', 'claude', 'cursor', 'vscode'] as const
export type GnosisAgent = (typeof GNOSIS_AGENTS)[number]

const serverCommand = 'node'

export const GNOSIS_CLIENT_RELOAD_GUIDANCE =
  'Reload or reopen your MCP client, approve project trust if prompted, and start a new agent task. Existing tasks do not acquire newly registered tools. If a new task still lacks them, inspect the client startup error; registration files alone do not prove that the server initialized.'

export async function installGnosisRegistration(
  applicationRoot: string,
  agents: readonly GnosisAgent[] = GNOSIS_AGENTS,
): Promise<readonly string[]> {
  const resolvedApplicationRoot = path.resolve(applicationRoot)
  const repositoryRoot = await findRepositoryRoot(resolvedApplicationRoot)
  const applicationCwd = path.relative(repositoryRoot, resolvedApplicationRoot) || '.'
  const files: string[] = [await installGnosisGuidelines(repositoryRoot)]
  for (const agent of agents) {
    const file = await registerAgent(repositoryRoot, applicationCwd, agent)
    files.push(path.relative(repositoryRoot, file))
  }
  return files
}

async function findRepositoryRoot(applicationRoot: string): Promise<string> {
  const resolvedApplicationRoot = path.resolve(applicationRoot)
  let directory = resolvedApplicationRoot
  while (true) {
    if (await exists(path.join(directory, '.git'))) return directory
    const parent = path.dirname(directory)
    if (parent === directory) return resolvedApplicationRoot
    directory = parent
  }
}

async function installGnosisGuidelines(cwd: string): Promise<string> {
  const file = path.join(cwd, 'AGENTS.md')
  const startMarker = '<doxa-gnosis-guidelines>'
  const endMarker = '</doxa-gnosis-guidelines>'
  const existing = (await readOptional(file)) ?? ''
  const starts = occurrences(existing, startMarker)
  const ends = occurrences(existing, endMarker)
  const start = existing.indexOf(startMarker)
  const end = existing.indexOf(endMarker)
  if (starts !== ends || starts > 1 || (starts === 1 && end < start)) {
    throw new PraxisCommandError(
      'AGENTS.md contains malformed or duplicate Doxa Gnosis guideline markers.',
    )
  }
  const { renderGnosisGuidelines } = await loadGnosisGuidelines()
  const block = `${startMarker}\n${renderGnosisGuidelines().trim()}\n\n${endMarker}`
  let content: string
  if (starts === 0) {
    const separator =
      existing.length === 0
        ? ''
        : existing.endsWith('\n\n')
          ? ''
          : existing.endsWith('\n')
            ? '\n'
            : '\n\n'
    content = `${existing}${separator}${block}\n`
  } else {
    const afterBlock = end + endMarker.length
    const suffix = existing.slice(afterBlock)
    content = `${existing.slice(0, start)}${block}${suffix || '\n'}`
  }
  await writeChanged(file, content)
  return path.relative(cwd, file)
}

async function loadGnosisGuidelines(): Promise<
  Pick<typeof import('@doxajs/gnosis'), 'renderGnosisGuidelines'>
> {
  try {
    return await import('@doxajs/gnosis')
  } catch (error) {
    throw new PraxisCommandError(
      'Gnosis tooling is not installed. Reinstall development dependencies before installing agent guidance.',
      { cause: error },
    )
  }
}

function occurrences(value: string, search: string): number {
  return value.split(search).length - 1
}

export function parseGnosisAgents(args: readonly string[]): readonly GnosisAgent[] {
  if (args.length === 0) return GNOSIS_AGENTS
  const selected = new Set<GnosisAgent>()
  for (const argument of args) {
    if (!argument.startsWith('--agent=')) {
      throw new PraxisCommandError(`Unknown gnosis:install option ${argument}.`)
    }
    const values = argument.slice('--agent='.length).split(',')
    for (const value of values) {
      if (value === 'all') {
        for (const agent of GNOSIS_AGENTS) selected.add(agent)
        continue
      }
      if (!isGnosisAgent(value)) {
        throw new PraxisCommandError(
          `Unsupported Gnosis agent ${value || '(empty)'}. Choose codex, claude, cursor, vscode, or all.`,
        )
      }
      selected.add(value)
    }
  }
  return GNOSIS_AGENTS.filter((agent) => selected.has(agent))
}

async function registerAgent(
  repositoryRoot: string,
  applicationCwd: string,
  agent: GnosisAgent,
): Promise<string> {
  if (agent === 'codex') return registerCodex(repositoryRoot, applicationCwd)
  if (agent === 'claude') {
    return registerJson(repositoryRoot, '.mcp.json', 'mcpServers', {
      command: serverCommand,
      args: serverArguments(applicationCwd),
      env: {},
    })
  }
  if (agent === 'cursor') {
    return registerJson(repositoryRoot, '.cursor/mcp.json', 'mcpServers', {
      command: serverCommand,
      args: serverArguments(applicationCwd),
      env: {},
    })
  }
  return registerJson(repositoryRoot, '.vscode/mcp.json', 'servers', {
    type: 'stdio',
    command: serverCommand,
    args: serverArguments(applicationCwd),
    cwd: '${workspaceFolder}',
  })
}

async function registerCodex(repositoryRoot: string, applicationCwd: string): Promise<string> {
  const file = path.join(repositoryRoot, '.codex/config.toml')
  const header = '[mcp_servers.gnosis]'
  const block = [
    header,
    `command = ${JSON.stringify(serverCommand)}`,
    `args = ${JSON.stringify(serverArguments(applicationCwd))}`,
    'startup_timeout_sec = 120',
  ].join('\n')
  const existing = await readOptional(file)
  let content: string
  if (existing === undefined || existing.trim().length === 0) {
    content = `${block}\n`
  } else {
    const lines = existing.replace(/\r\n/g, '\n').split('\n')
    const start = lines.findIndex((line) => line.trim() === header)
    if (start === -1) {
      if (/^\s*mcp_servers\.gnosis\b/m.test(existing)) {
        throw new PraxisCommandError(
          `${path.relative(repositoryRoot, file)} declares Gnosis with unsupported dotted TOML keys. Convert it to ${header} before reinstalling.`,
        )
      }
      content = `${existing.trimEnd()}\n\n${block}\n`
    } else {
      let end = start + 1
      while (end < lines.length) {
        const line = lines[end]!.trim()
        if (/^\[\[?.*\]\]?$/.test(line) && !line.startsWith('[mcp_servers.gnosis.')) break
        end += 1
      }
      lines.splice(start, end - start, ...block.split('\n'))
      content = `${lines.join('\n').trimEnd()}\n`
    }
  }
  await writeChanged(file, content)
  return file
}

function serverArguments(applicationCwd: string): readonly string[] {
  const normalizedApplicationCwd =
    applicationCwd === '.' ? '.' : applicationCwd.split(path.sep).join('/')
  const script =
    normalizedApplicationCwd === '.'
      ? './node_modules/@doxajs/praxis/dist/bin.js'
      : `./${normalizedApplicationCwd}/node_modules/@doxajs/praxis/dist/bin.js`
  return [
    script,
    'mcp',
    ...(normalizedApplicationCwd === '.' ? [] : [`--cwd=${normalizedApplicationCwd}`]),
  ]
}

async function registerJson(
  cwd: string,
  relative: string,
  section: 'mcpServers' | 'servers',
  server: Readonly<Record<string, unknown>>,
): Promise<string> {
  const file = path.join(cwd, relative)
  const existing = await readOptional(file)
  let document: Record<string, unknown> = {}
  if (existing !== undefined && existing.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(existing)
      if (!isRecord(parsed)) throw new Error('root must be an object')
      document = parsed
    } catch (error) {
      throw new PraxisCommandError(`Cannot update invalid MCP configuration ${relative}.`, {
        cause: error,
      })
    }
  }
  const current = document[section]
  if (current !== undefined && !isRecord(current)) {
    throw new PraxisCommandError(`${relative} field ${section} must be an object.`)
  }
  document[section] = { ...(current ?? {}), gnosis: server }
  await writeChanged(file, `${JSON.stringify(document, null, 2)}\n`)
  return file
}

async function writeChanged(file: string, content: string): Promise<void> {
  if ((await readOptional(file)) === content) return
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function isGnosisAgent(value: string): value is GnosisAgent {
  return (GNOSIS_AGENTS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
