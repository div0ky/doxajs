import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fork, spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { HonoHttpHost } from '@doxajs/http-hono'
import { inspectGraph, inspectSurface, type InspectionSurface } from '@doxajs/introspection'
import {
  cancelQueueJob,
  installQueueSchema,
  listQueueJobs,
  retryQueueJob,
} from '@doxajs/queue-pg-boss'
import type { LogFormat, LogLevel, QueueEnvelope } from '@doxajs/core'
import { Doxa } from '@doxajs/runtime'
import { Pool } from 'pg'

import { HotReloadSupervisor, type HotReloadTarget } from './hot-reload.js'
import {
  integerOption,
  kebab,
  numberOption,
  option,
  pascal,
  positiveIntegerOption,
  required,
} from './command-values.js'
import { PraxisCommandError } from './errors.js'
import {
  GNOSIS_CLIENT_RELOAD_GUIDANCE,
  installGnosisRegistration,
  parseGnosisAgents,
} from './gnosis-registration.js'

export { PraxisCommandError } from './errors.js'

export interface PraxisIo {
  readonly out: (message: string) => void
  readonly error: (message: string) => void
  readonly run?: (
    command: string,
    arguments_: readonly string[],
    cwd: string,
    environment: NodeJS.ProcessEnv,
  ) => Promise<number>
  readonly capture?: (
    command: string,
    arguments_: readonly string[],
    cwd: string,
    environment: NodeJS.ProcessEnv,
  ) => Promise<{ code: number; stdout: string; stderr: string }>
}

const help = `Doxa Praxis

Usage: doxa <command> [arguments]

Build and inspect:
  build                 Compile the application manifest and registry
  route:list            List compiled HTTP routes
  model:list            List models and physical storage management/access
  graph                 Summarize the compiled application graph
  gnosis                Generate Gnosis-readable application knowledge
  gnosis:install        Register Gnosis with project MCP clients [--agent=codex,claude,cursor,vscode|all]
  mcp [--cwd=path]      Gnosis stdio entrypoint (normally launched by an MCP client)
  add <module>          Install keryx, opentelemetry, sendgrid, twilio-sms, or theoria
  delivery:list         List durable mail and SMS deliveries
  delivery:retry <id>   Redrive a failed or undelivered delivery
  queue:list            List durable queue jobs
  queue:failed          List terminally failed queue jobs
  queue:retry <id>      Retry a terminally failed queue job
  queue:cancel <id>     Cancel a queued job
  auth:identities       List identities without credential material
  auth:sessions         List browser sessions [--identity=id]
  auth:tokens           List bearer tokens [--identity=id]
  auth:revoke-session <id>
  auth:revoke-token <id>
  auth:prune            Remove expired authentication artifacts
  auth:storage          Describe auth table ownership
  journal:list          List durable domain facts
  outbox:list           List transactional outbox records
  cache:list            List cache keys without values
  cache:forget <key>    Remove one cache entry
  cache:prune           Remove expired cache entries
  schedule:status       Show durable schedule enablement
  schedule:enable <id>
  schedule:disable <id>
  schedule:run <id>     Manually enqueue scheduled work
  event:list            List events and dispatch timing
  listener:list         List listeners and delivery modes
  observer:list         List model observers and phases
  job:list              List jobs and retry policies
  schedule:list         List schedules and targets
  permission-source:list List the application permission source and abilities
  policy:list           List policies and abilities
  command:list          List application console commands

Generate:
  new <Name> [--directory=path]
  make:feature <Name>
  make:model <Feature/Name>
  make:action <Feature/Name> --public|--ability=<ability>
  make:query <Feature/Name> --public|--ability=<ability>
  make:route <Feature/Name> --path=/path [--method=GET] [--ability=<ability>]
  make:event <Feature/Name> [--model=Model] [--broadcast|--broadcast-now] [--channel=name] [--private|--presence]
  make:listener <Feature/Name> --event=Event [--queued|--after-commit|--queued-after-commit] --public|--ability=<ability>
  make:signal <Feature/Name>
  make:signal-handler <Feature/Name> --signal=Signal --public|--ability=<ability>
  make:observer <Feature/Name> --model=Model
  make:job <Feature/Name> --public|--ability=<ability>
  make:schedule <Feature/Name> --job=Job (--cron="..."|--every=seconds) [--misfire=skip|catch-up-once] --public|--ability=<ability>
  make:policy <Feature/Name> --abilities=one,two
  make:permission-source <Feature/Name> --abilities=one,two
  make:config <Feature/Name>
  make:provider <Feature/Name>
  make:service <Feature/Name> [--provide]
  make:command <Feature/Name> [--name=feature:command] --public|--ability=<ability>
  make:migration <Name>
  make:test <Feature/Name>

Runtime:
  serve                 Start the HTTP role
  work                  Start workers and distributed scheduling [--without-scheduler]
  schedule              Start only schedule admission (advanced isolation)
  dev                    Start all roles and hot reload valid src/ changes
  migrate               Apply pending forward migrations
  migrate:status        Show migration state
  db:studio             Browse PostgreSQL with Drizzle Studio [--host=127.0.0.1] [--port=4983] [--verbose]
  theoria               Explore correlated runtime evidence [--host=127.0.0.1] [--port=4400] [--operator=id]
  theoria:prune         Enforce Theoria retention [--days=7] [--maximum=50000]

Framework:
  upgrade [--to=alpha|version] [--dry-run] [--force] [--verify] [--skip-migration-status]
`

export async function runPraxis(
  arguments_: readonly string[],
  cwd = process.cwd(),
  io: PraxisIo = { out: console.log, error: console.error },
): Promise<number> {
  const [command = 'help', ...args] = arguments_
  try {
    if (command === 'help' || command === '--help' || command === '-h') {
      io.out(help)
      return 0
    }
    if (command === 'build') {
      const result = await buildApplication(cwd)
      reportCompilerAdvisories(result.advisories, io)
      io.out(`Built ${result.manifest.applicationId} (${result.manifest.buildHash.slice(0, 12)})`)
      return 0
    }
    if (command === 'upgrade') {
      const { runUpgrade } = await import('./upgrade.js')
      return await runUpgrade(cwd, args, {
        out: io.out,
        run: io.run ?? runProcess,
        capture: io.capture ?? runProcessCapture,
      })
    }
    if (command === 'gnosis') {
      const result = await buildApplication(cwd)
      reportCompilerAdvisories(result.advisories, io)
      io.out(`Generated Gnosis knowledge for ${result.manifest.applicationId} at .doxa/gnosis.json`)
      return 0
    }
    if (command === 'gnosis:install') {
      const files = await installGnosisRegistration(cwd, parseGnosisAgents(args))
      io.out(`Registered Gnosis in ${files.join(', ')}. ${GNOSIS_CLIENT_RELOAD_GUIDANCE}`)
      return 0
    }
    if (command === 'mcp') {
      const applicationCwd = mcpApplicationCwd(cwd, args)
      const result = await buildApplication(applicationCwd, true)
      const { startGnosisServer } = await loadGnosisTools()
      await startGnosisServer(result.manifest, {
        queryModels: (request) =>
          queryGnosisModels(applicationCwd, result.manifest.buildHash, request),
      })
      return 0
    }
    if (command === 'serve' || command === 'work' || command === 'schedule' || command === 'dev') {
      await runRuntimeCommand(command, cwd, args, io)
      return 0
    }
    if (command === 'db:studio') {
      return await runDatabaseStudio(cwd, args, io)
    }
    if (command === 'add') {
      const moduleName = required(args[0], 'Module name is required.')
      if (moduleName === 'keryx') await addKeryx(cwd)
      else await addPlugin(cwd, moduleName)
      io.out(
        moduleName === 'keryx'
          ? 'Installed Keryx. Doxa broadcasting is enabled and deployment configuration was scaffolded.'
          : moduleName === 'theoria'
            ? 'Installed Theoria. Run doxa migrate, then doxa theoria.'
            : `Installed ${moduleName}. Configure its generated environment contract before use.`,
      )
      return 0
    }
    if (command === 'theoria') {
      await runTheoria(cwd, args, io)
      return 0
    }
    if (command === 'theoria:prune') {
      const { pruneTheoria } = await loadTheoriaTools()
      const connectionString = await databaseConnection(cwd, args)
      const count = await pruneTheoria(connectionString, {
        hotRetentionDays: numberOption(args, 'days', 7),
        maximumObservations: positiveIntegerOption(args, 'maximum', 50_000),
      })
      io.out(`Pruned ${count} Theoria observation${count === 1 ? '' : 's'}.`)
      return 0
    }
    if (command === 'test') {
      return await runProcess(
        process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        ['test', ...args],
        cwd,
      )
    }
    if (command === 'route:list' || command === 'model:list' || command === 'graph') {
      const json = jsonOutput(args, command)
      const manifest = (await buildApplication(cwd)).manifest
      if (command === 'route:list') {
        const routes = inspectSurface(manifest, 'routes')
        if (json) io.out(JSON.stringify(routes, null, 2))
        else
          for (const route of routes.items)
            io.out(
              `${String(route.method).padEnd(7)} ${String(route.path).padEnd(32)} ${String(route.access).padEnd(24)} ${String(route.id)}`,
            )
      } else if (command === 'model:list') {
        const models = inspectSurface(manifest, 'models')
        if (json) io.out(JSON.stringify(models, null, 2))
        else
          for (const model of models.items) {
            const storage = model.storage as
              | { kind: 'entity-state' }
              | {
                  kind: 'table'
                  table: string
                  primaryKey: string
                  versionColumn?: string
                  versionSource:
                    { kind: 'column'; column: string } | { kind: 'xmin' } | { kind: 'none' }
                  managed: boolean
                  readOnly: boolean
                }
            const storageDescription =
              storage.kind === 'entity-state'
                ? 'doxa_entity_states managed=true readOnly=false'
                : `${storage.table} managed=${storage.managed} readOnly=${storage.readOnly} key=${storage.primaryKey} version=${
                    storage.versionSource.kind === 'column'
                      ? storage.versionSource.column
                      : storage.versionSource.kind
                  }`
            io.out(`${String(model.id)} ${storageDescription}`)
          }
      } else {
        const graph = inspectGraph(manifest)
        if (json) io.out(JSON.stringify(graph, null, 2))
        else
          for (const [field, count] of Object.entries(graph.counts))
            io.out(`${field.padEnd(16)} ${count}`)
      }
      return 0
    }
    const inspection = inspectionField(command)
    if (inspection) {
      const json = jsonOutput(args, command)
      const manifest = (await buildApplication(cwd)).manifest
      const result = inspectSurface(manifest, inspection)
      if (json) io.out(JSON.stringify(result, null, 2))
      else for (const entry of result.items) io.out(formatInspection(inspection, entry))
      return 0
    }
    if (command === 'delivery:list') {
      await withDatabase(cwd, args, async (pool) => {
        const result = await pool.query<{
          id: string
          channel: string
          state: string
          provider_message_id: string | null
          updated_at: Date
        }>(`
          SELECT id, channel, state, provider_message_id, updated_at
          FROM doxa_delivery_messages ORDER BY updated_at DESC, id LIMIT 100
        `)
        for (const row of result.rows)
          io.out(
            `${row.channel.padEnd(5)} ${row.state.padEnd(12)} ${row.id} ${row.provider_message_id ?? '-'} ${row.updated_at.toISOString()}`,
          )
      })
      return 0
    }
    if (command === 'migrate' || command === 'migrate:status') {
      if (command === 'migrate') await installDeclaredQueueSchema(cwd, args)
      await withDatabase(cwd, args, async (pool) => {
        const migrations = await discoverMigrations(cwd)
        if (command === 'migrate') {
          const applied = await applyMigrations(pool, migrations)
          if (applied.length === 0) io.out('Nothing to migrate.')
          for (const id of applied) io.out(`Migrated ${id}`)
        } else {
          const status = await migrationStatus(pool, migrations)
          for (const entry of status) io.out(`${entry.state.padEnd(8)} ${entry.id}`)
        }
      })
      return 0
    }
    if (command === 'delivery:retry') {
      const id = required(args[0], 'delivery:retry requires a message ID.')
      await withDatabase(cwd, args.slice(1), (pool) => redriveDelivery(pool, id))
      io.out(`Queued delivery ${id} for redrive.`)
      return 0
    }
    if (command === 'queue:list' || command === 'queue:failed') {
      const connectionString = await databaseConnection(cwd, args)
      for (const job of await listQueueJobs(
        connectionString,
        command === 'queue:failed' ? 'failed' : undefined,
      )) {
        io.out(`${job.state.padEnd(10)} ${job.id} attempts=${job.retryCount}/${job.retryLimit + 1}`)
      }
      return 0
    }
    if (command === 'queue:retry' || command === 'queue:cancel') {
      const id = required(args[0], `${command} requires a job ID.`)
      const connectionString = await databaseConnection(cwd, args.slice(1))
      if (command === 'queue:retry') await retryQueueJob(connectionString, id)
      else await cancelQueueJob(connectionString, id)
      io.out(`${command === 'queue:retry' ? 'Retried' : 'Cancelled'} queue job ${id}.`)
      return 0
    }
    if (command === 'auth:storage') {
      await describeAuthStorage(cwd, args, io)
      return 0
    }
    if (command === 'auth:identities' || command === 'auth:sessions' || command === 'auth:tokens') {
      await withDatabase(cwd, args, async (pool) =>
        listAuth(pool, command, option(args, 'identity'), io),
      )
      return 0
    }
    if (command === 'auth:revoke-session' || command === 'auth:revoke-token') {
      const id = required(args[0], `${command} requires an ID.`)
      await withDatabase(cwd, args.slice(1), (pool) => revokeAuth(pool, command, id))
      io.out(`Revoked ${command === 'auth:revoke-session' ? 'session' : 'access token'} ${id}.`)
      return 0
    }
    if (command === 'auth:prune') {
      await withDatabase(cwd, args, async (pool) => {
        const result = await pool.query(`
          WITH challenges AS (
            DELETE FROM doxa_auth_challenges WHERE expires_at < now() - interval '7 days' OR consumed_at < now() - interval '7 days' RETURNING 1
          ), limits AS (
            DELETE FROM doxa_auth_rate_limits WHERE window_started_at < now() - interval '7 days' AND (blocked_until IS NULL OR blocked_until < now()) RETURNING 1
          ), sessions AS (
            DELETE FROM doxa_auth_sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days' RETURNING 1
          ) SELECT (SELECT count(*) FROM challenges) + (SELECT count(*) FROM limits) + (SELECT count(*) FROM sessions) AS count
        `)
        io.out(`Pruned ${String(result.rows[0]?.count ?? 0)} authentication records.`)
      })
      return 0
    }
    if (command === 'journal:list' || command === 'outbox:list' || command === 'cache:list') {
      await withDatabase(cwd, args, (pool) => listInfrastructure(pool, command, io))
      return 0
    }
    if (command === 'cache:forget' || command === 'cache:prune') {
      await withDatabase(cwd, command === 'cache:forget' ? args.slice(1) : args, async (pool) => {
        const result =
          command === 'cache:forget'
            ? await pool.query('DELETE FROM doxa_cache_entries WHERE key = $1', [
                required(args[0], 'cache:forget requires a key.'),
              ])
            : await pool.query(
                'DELETE FROM doxa_cache_entries WHERE expires_at IS NOT NULL AND expires_at <= now()',
              )
        io.out(
          `${command === 'cache:forget' ? 'Forgot' : 'Pruned'} ${result.rowCount ?? 0} cache entr${result.rowCount === 1 ? 'y' : 'ies'}.`,
        )
      })
      return 0
    }
    if (
      command === 'schedule:status' ||
      command === 'schedule:enable' ||
      command === 'schedule:disable' ||
      command === 'schedule:run'
    ) {
      await operateSchedule(command, cwd, args, io)
      return 0
    }
    if (command === 'make:feature') {
      await makeFeature(cwd, required(args[0], 'Feature name is required.'))
      io.out(`Created Feature ${args[0]}`)
      return 0
    }
    if (command === 'new') {
      const name = required(args[0], 'Application name is required.')
      const directory = path.resolve(cwd, option(args.slice(1), 'directory') ?? kebab(name))
      await makeApplication(directory, name)
      io.out(`Created Doxa application at ${directory}`)
      return 0
    }
    if (command === 'make:migration') {
      const file = await makeMigration(cwd, required(args[0], 'Migration name is required.'))
      io.out(`Created ${path.relative(cwd, file)}`)
      return 0
    }
    if (command === 'make:test') {
      const file = await makeTest(
        cwd,
        parseTarget(required(args[0], 'make:test requires Feature/Name.')),
      )
      io.out(`Created ${path.relative(cwd, file)}`)
      return 0
    }
    const role = generatorRole(command)
    if (role) {
      const target = parseTarget(required(args[0], `${command} requires Feature/Name.`))
      const file = await makeRole(cwd, role, target, args.slice(1))
      io.out(`Created ${path.relative(cwd, file)}`)
      return 0
    }
    if (await runApplicationCommand(command, args, cwd)) return 0
    throw new PraxisCommandError(`Unknown Praxis or application command: ${command}`)
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

function mcpApplicationCwd(cwd: string, args: readonly string[]): string {
  if (args.length === 0) return cwd
  if (!args[0]!.startsWith('--cwd=')) {
    throw new PraxisCommandError(`Unknown mcp option ${args[0]}.`)
  }
  if (args.length > 1) {
    throw new PraxisCommandError(`Unknown mcp option ${args[1]}.`)
  }
  const value = args[0]!.slice('--cwd='.length)
  if (value.length === 0) throw new PraxisCommandError('MCP application cwd cannot be empty.')
  return path.resolve(cwd, value)
}

function reportCompilerAdvisories(
  advisories: readonly import('@doxajs/compiler').CompilerArchitectureAdvisory[],
  io: PraxisIo,
): void {
  for (const advisory of advisories) {
    io.error(
      `${advisory.source.file}:${advisory.source.line}:${advisory.source.column} [${advisory.code}] ${advisory.message} See Gnosis guide ${advisory.guideId}.`,
    )
  }
}

async function withDatabase<Output>(
  cwd: string,
  args: readonly string[],
  work: (pool: Pool) => Promise<Output>,
): Promise<Output> {
  const connectionString = await databaseConnection(cwd, args)
  const pool = new Pool({ connectionString, application_name: 'doxa-praxis' })
  try {
    return await work(pool)
  } finally {
    await pool.end()
  }
}

async function databaseConnection(cwd: string, args: readonly string[]): Promise<string> {
  const explicit = args.find((argument) => argument.startsWith('--database='))?.slice(11)
  const connectionString =
    explicit ||
    process.env.DATABASE_CONNECTION_STRING ||
    (await dotenvValue(cwd, 'DATABASE_CONNECTION_STRING'))
  if (!connectionString)
    throw new PraxisCommandError(
      'DATABASE_CONNECTION_STRING is required through the environment, .env, or --database=.',
    )
  return connectionString
}

async function runDatabaseStudio(
  cwd: string,
  args: readonly string[],
  io: PraxisIo,
): Promise<number> {
  for (const argument of args) {
    if (
      argument === '--verbose' ||
      argument.startsWith('--database=') ||
      argument.startsWith('--host=') ||
      argument.startsWith('--port=')
    )
      continue
    throw new PraxisCommandError(`Unknown db:studio option ${argument}.`)
  }
  const connectionString = await databaseConnection(cwd, args)
  const host = option(args, 'host') ?? '127.0.0.1'
  if (host.trim().length === 0) throw new PraxisCommandError('--host must not be empty.')
  const port = integerOption(args, 'port', 4_983)
  const studioDirectory = path.join(cwd, '.doxa', 'drizzle-studio')
  const configPath = path.join(studioDirectory, 'drizzle.config.mjs')
  await mkdir(studioDirectory, { recursive: true })
  await Promise.all([
    writeFile(
      path.join(studioDirectory, 'package.json'),
      `${JSON.stringify(
        {
          private: true,
          dependencies: {
            'drizzle-kit': '0.31.10',
            'drizzle-orm': '0.45.2',
            pg: '8.22.0',
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    writeFile(
      path.join(studioDirectory, 'pnpm-workspace.yaml'),
      `packages:
  - .

allowBuilds:
  esbuild: true
`,
      'utf8',
    ),
    writeFile(
      configPath,
      [
        '// Generated by Doxa Praxis. Do not edit.',
        'export default {',
        "  dialect: 'postgresql',",
        '  dbCredentials: { url: process.env.DATABASE_CONNECTION_STRING },',
        '}',
        '',
      ].join('\n'),
      'utf8',
    ),
  ])

  const run = io.run ?? runProcess
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const installEnvironment = { ...process.env }
  delete installEnvironment.DATABASE_CONNECTION_STRING
  const installCode = await run(
    pnpm,
    ['--config.node-linker=hoisted', 'install'],
    studioDirectory,
    installEnvironment,
  )
  if (installCode !== 0) return installCode

  const drizzleArguments = [
    'exec',
    'drizzle-kit',
    'studio',
    `--config=${configPath}`,
    `--host=${host}`,
    `--port=${port}`,
    ...(args.includes('--verbose') ? ['--verbose'] : []),
  ]
  const environment = {
    ...(await dotenvEnvironment(cwd)),
    ...process.env,
    DATABASE_CONNECTION_STRING: connectionString,
  }
  io.out(`Starting Drizzle Studio for Doxa (proxy ${host}:${port}).`)
  return await run(pnpm, drizzleArguments, studioDirectory, environment)
}

async function runTheoria(cwd: string, args: readonly string[], io: PraxisIo): Promise<void> {
  const { listenTheoria } = await loadTheoriaTools()
  for (const argument of args) {
    if (
      argument.startsWith('--database=') ||
      argument.startsWith('--host=') ||
      argument.startsWith('--port=') ||
      argument.startsWith('--operator=')
    )
      continue
    throw new PraxisCommandError(`Unknown theoria option ${argument}.`)
  }
  const host = option(args, 'host') ?? '127.0.0.1'
  const port = integerOption(args, 'port', 4_400)
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  const environment = { ...(await dotenvEnvironment(cwd)), ...process.env }
  const token = environment.THEORIA_ACCESS_TOKEN
  const operatorId = option(args, 'operator') ?? environment.THEORIA_OPERATOR_ID ?? 'doxa:operator'
  if (!loopback && !token) {
    throw new PraxisCommandError(
      'Non-loopback Theoria requires THEORIA_ACCESS_TOKEN with at least 32 characters.',
    )
  }
  const service = await listenTheoria({
    connectionString: await databaseConnection(cwd, args),
    host,
    port,
    ...(loopback
      ? {}
      : {
          profile: 'production-diagnostics' as const,
          access: { mode: 'bearer' as const, token: token!, operatorId },
          audit: (event) =>
            io.out(
              `Theoria operator access ${event.outcome}: ${event.operatorId ?? 'unknown'} ${event.method} ${event.path}`,
            ),
        }),
  })
  io.out(`Theoria is revealing ${service.url.toString()}`)
  await new Promise<void>((resolve) => {
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      void service.shutdown().finally(resolve)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

async function addPlugin(cwd: string, name: string): Promise<void> {
  const packageName =
    name === 'opentelemetry'
      ? '@doxajs/opentelemetry'
      : name === 'sendgrid'
        ? '@doxajs/sendgrid'
        : name === 'twilio-sms'
          ? '@doxajs/twilio-sms'
          : name === 'theoria'
            ? '@doxajs/theoria'
            : undefined
  if (!packageName) {
    throw new PraxisCommandError(
      `Unknown Doxa plugin ${name}. Supported plugins: opentelemetry, sendgrid, twilio-sms, theoria.`,
    )
  }
  const packagePath = path.join(cwd, 'package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
    dependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
  packageJson.dependencies ??= {}
  packageJson.dependencies[packageName] =
    packageJson.dependencies['@doxajs/core'] ?? (await frameworkDependencyRange())
  if (name === 'theoria') {
    packageJson.scripts ??= {}
    packageJson.scripts.theoria = 'doxa theoria'
    packageJson.scripts['theoria:prune'] = 'doxa theoria:prune'
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

  const configPath = path.join(cwd, 'app.config.ts')
  let source = await readFile(configPath, 'utf8').catch((error: unknown) => {
    throw new PraxisCommandError('app.config.ts is required before adding a plugin.', {
      cause: error,
    })
  })
  if (source.includes(`'${packageName}'`) || source.includes(`"${packageName}"`)) return
  const plugins = /(\n  plugins\s*=\s*\[)([^\]]*)(\])(?:\s+as const)?/
  if (!plugins.test(source)) {
    throw new PraxisCommandError('Application must declare a literal plugins array.')
  }
  source = source.replace(plugins, (_match, open: string, contents: string, close: string) => {
    const trimmed = contents.trim()
    return `${open}${trimmed ? `${trimmed}, ` : ''}'${packageName}'${close} as const`
  })
  await writeFile(configPath, source, 'utf8')
}

async function addKeryx(cwd: string): Promise<void> {
  const configPath = path.join(cwd, 'app.config.ts')
  let source = await readFile(configPath, 'utf8').catch((error: unknown) => {
    throw new PraxisCommandError('app.config.ts is required before adding Keryx.', {
      cause: error,
    })
  })
  const packagePath = path.join(cwd, 'package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  packageJson.dependencies ??= {}
  const range = packageJson.dependencies['@doxajs/core'] ?? (await frameworkDependencyRange())
  packageJson.dependencies['@doxajs/keryx'] = range
  packageJson.dependencies['@doxajs/realtime'] = range
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

  if (!/\bbroadcasting\s*:/.test(source)) {
    if (/\n  framework\s*=\s*\{/.test(source)) {
      source = source.replace(
        /(\n  framework\s*=\s*\{)/,
        '$1\n    broadcasting: { enabled: true },',
      )
    } else {
      const classEnd = source.lastIndexOf('\n}')
      if (classEnd < 0)
        throw new PraxisCommandError('Application must be an exported DoxaApplication class.')
      source =
        `${source.slice(0, classEnd)}\n  framework = {\n` +
        `    broadcasting: { enabled: true },\n` +
        `  }\n${source.slice(classEnd)}`
    }
    await writeFile(configPath, source, 'utf8')
  }

  const environmentPath = path.join(cwd, '.env.example')
  const environment = await readFile(environmentPath, 'utf8').catch(() => '')
  if (!environment.includes('DOXA_KERYX_SECRET=')) {
    await writeFile(
      environmentPath,
      `${environment.replace(/\s*$/, '\n')}DOXA_KERYX_SECRET=replace-with-at-least-32-characters\n` +
        `DOXA_KERYX_HOST=127.0.0.1\n` +
        `DOXA_KERYX_PORT=6001\n` +
        `DOXA_KERYX_KEY=default\n` +
        `DOXA_KERYX_TOPOLOGY=single\n` +
        `# DOXA_KERYX_PUBLISH_URL=http://127.0.0.1:6001\n` +
        `# DOXA_KERYX_REDIS_URL=redis://127.0.0.1:6379\n`,
      'utf8',
    )
  }

  const composePath = path.join(cwd, 'compose.production.yaml')
  let compose = await readFile(composePath, 'utf8').catch(() => '')
  if (compose && !compose.includes('DOXA_KERYX_SECRET:')) {
    compose = compose.replace(
      /(\n    DATABASE_CONNECTION_STRING:.*)/,
      '$1\n    DOXA_KERYX_SECRET: ${DOXA_KERYX_SECRET:?DOXA_KERYX_SECRET is required}' +
        '\n    DOXA_KERYX_HOST: 0.0.0.0' +
        '\n    DOXA_KERYX_PORT: 6001' +
        '\n    DOXA_KERYX_PUBLISH_URL: http://web:6001' +
        '\n    DOXA_KERYX_TOPOLOGY: ${DOXA_KERYX_TOPOLOGY:-single}' +
        '\n    DOXA_KERYX_REDIS_URL: ${DOXA_KERYX_REDIS_URL:-}',
    )
    compose = compose.replace(
      /(\n    ports:\n      - "\$\{PORT:-3000\}:3000")/,
      '$1\n      - "${KERYX_PORT:-6001}:6001"',
    )
    compose = compose.replace(
      /fetch\('http:\/\/127\.0\.0\.1:3000\/health'\)\.then\(r=>\{if\(!r\.ok\)process\.exit\(1\)\}\)/,
      "Promise.all([fetch('http://127.0.0.1:3000/health'),fetch('http://127.0.0.1:6001/ready')]).then(rs=>{if(rs.some(r=>!r.ok))process.exit(1)})",
    )
    await writeFile(composePath, compose, 'utf8')
  }
}

async function redriveDelivery(pool: Pool, id: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query<{
      channel: 'mail' | 'sms'
      state: string
      payload: unknown
      context: Record<string, unknown>
    }>(
      `
      SELECT channel, state, payload, context FROM doxa_delivery_messages WHERE id = $1 FOR UPDATE
    `,
      [id],
    )
    const delivery = found.rows[0]
    if (!delivery) throw new PraxisCommandError(`Delivery ${id} was not found.`)
    if (!['failed', 'undelivered'].includes(delivery.state))
      throw new PraxisCommandError(
        `Delivery ${id} is ${delivery.state}; only failed or undelivered deliveries may be retried.`,
      )
    const outboxId = randomUUID()
    const envelopeId = randomUUID()
    const context = delivery.context
    const { executionId, ...durableContext } = context
    const queueContext = {
      ...durableContext,
      version: 1 as const,
      sourceExecutionId: executionId,
      causationId: id,
    }
    await client.query(
      `
      UPDATE doxa_delivery_messages
      SET state = 'pending', failure_kind = NULL, failure_code = NULL, updated_at = now()
      WHERE id = $1
    `,
      [id],
    )
    await client.query(
      `
      INSERT INTO doxa_outbox_messages (id, message_type, payload, context, status, available_at, created_at)
      VALUES ($1, 'doxa.queue', $2::jsonb, $3::jsonb, 'pending', now(), now())
    `,
      [
        outboxId,
        JSON.stringify({
          id: envelopeId,
          kind: delivery.channel,
          targetId: `doxa:${delivery.channel}`,
          payload: delivery.payload,
          context: queueContext,
          policy: { retries: 3, retryDelay: 1, backoff: true, timeout: 30 },
        }),
        JSON.stringify(context),
      ],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function listAuth(
  pool: Pool,
  command: 'auth:identities' | 'auth:sessions' | 'auth:tokens',
  identityId: string | undefined,
  io: PraxisIo,
): Promise<void> {
  if (command === 'auth:identities') {
    const result = await pool.query<{
      id: string
      email: string
      email_verified_at: Date | null
      created_at: Date
    }>(`
      SELECT id, email, email_verified_at, created_at FROM doxa_auth_identities ORDER BY created_at DESC LIMIT 100
    `)
    for (const row of result.rows)
      io.out(
        `${row.id} ${row.email} verified=${row.email_verified_at ? 'yes' : 'no'} created=${row.created_at.toISOString()}`,
      )
    return
  }
  if (command === 'auth:sessions') {
    const result = await pool.query<{
      id: string
      identity_id: string
      last_seen_at: Date
      expires_at: Date
      revoked_at: Date | null
    }>(
      `
      SELECT id, identity_id, last_seen_at, expires_at, revoked_at FROM doxa_auth_sessions
      WHERE ($1::text IS NULL OR identity_id = $1) ORDER BY created_at DESC LIMIT 100
    `,
      [identityId ?? null],
    )
    for (const row of result.rows)
      io.out(
        `${row.id} identity=${row.identity_id} ${row.revoked_at ? 'revoked' : 'active'} last=${row.last_seen_at.toISOString()} expires=${row.expires_at.toISOString()}`,
      )
    return
  }
  const result = await pool.query<{
    id: string
    identity_id: string
    name: string
    display_prefix: string
    expires_at: Date
    revoked_at: Date | null
  }>(
    `
    SELECT id, identity_id, name, display_prefix, expires_at, revoked_at FROM doxa_auth_access_tokens
    WHERE ($1::text IS NULL OR identity_id = $1) ORDER BY created_at DESC LIMIT 100
  `,
    [identityId ?? null],
  )
  for (const row of result.rows)
    io.out(
      `${row.id} identity=${row.identity_id} ${row.revoked_at ? 'revoked' : 'active'} ${row.name} prefix=${row.display_prefix} expires=${row.expires_at.toISOString()}`,
    )
}

async function revokeAuth(
  pool: Pool,
  command: 'auth:revoke-session' | 'auth:revoke-token',
  id: string,
): Promise<void> {
  const session = command === 'auth:revoke-session'
  const table = session ? 'doxa_auth_sessions' : 'doxa_auth_access_tokens'
  const result = await pool.query<{ identity_id: string }>(
    `
    UPDATE ${table} SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING identity_id
  `,
    [id],
  )
  const row = result.rows[0]
  if (!row)
    throw new PraxisCommandError(
      `${session ? 'Session' : 'Access token'} ${id} is unavailable or already revoked.`,
    )
  await pool.query(
    `
    INSERT INTO doxa_auth_audit_events (id, event_type, identity_id, ${session ? 'session_id,' : ''} metadata, occurred_at)
    VALUES ($1, $2, $3, ${session ? '$4,' : ''} $${session ? 5 : 4}::jsonb, now())
  `,
    session
      ? [randomUUID(), 'session.revoked_by_operator', row.identity_id, id, JSON.stringify({})]
      : [
          randomUUID(),
          'access_token.revoked_by_operator',
          row.identity_id,
          JSON.stringify({ tokenId: id }),
        ],
  )
}

async function listInfrastructure(
  pool: Pool,
  command: 'journal:list' | 'outbox:list' | 'cache:list',
  io: PraxisIo,
): Promise<void> {
  if (command === 'journal:list') {
    const result = await pool.query<{
      id: string
      fact_type: string
      entity_type: string
      entity_id: string
      occurred_at: Date
    }>(`
      SELECT id, fact_type, entity_type, entity_id, occurred_at FROM doxa_journal_entries ORDER BY occurred_at DESC LIMIT 100
    `)
    for (const row of result.rows)
      io.out(
        `${row.occurred_at.toISOString()} ${row.fact_type} ${row.entity_type}/${row.entity_id} ${row.id}`,
      )
    return
  }
  if (command === 'outbox:list') {
    const result = await pool.query<{
      id: string
      message_type: string
      status: string
      available_at: Date
    }>(`
      SELECT id, message_type, status, available_at FROM doxa_outbox_messages ORDER BY created_at DESC LIMIT 100
    `)
    for (const row of result.rows)
      io.out(
        `${row.status.padEnd(10)} ${row.message_type} ${row.id} available=${row.available_at.toISOString()}`,
      )
    return
  }
  const result = await pool.query<{ key: string; expires_at: Date | null }>(`
    SELECT key, expires_at FROM doxa_cache_entries WHERE expires_at IS NULL OR expires_at > now() ORDER BY key LIMIT 100
  `)
  for (const row of result.rows)
    io.out(`${row.key} expires=${row.expires_at?.toISOString() ?? 'never'}`)
}

async function operateSchedule(
  command: 'schedule:status' | 'schedule:enable' | 'schedule:disable' | 'schedule:run',
  cwd: string,
  args: readonly string[],
  io: PraxisIo,
): Promise<void> {
  const result = await loadPrebuiltApplication(cwd)
  const schedules = result.manifest.schedules
  const requested =
    command === 'schedule:status'
      ? undefined
      : required(args[0], `${command} requires a schedule ID.`)
  const schedule = requested
    ? schedules.find((entry) => entry.id === requested || entry.id.endsWith(`/${requested}`))
    : undefined
  if (requested && !schedule) throw new PraxisCommandError(`Schedule ${requested} is not declared.`)
  await withDatabase(cwd, requested ? args.slice(1) : args, async (pool) => {
    for (const entry of schedules)
      await pool.query(
        `INSERT INTO doxa_schedule_controls (schedule_id, enabled) VALUES ($1, true) ON CONFLICT (schedule_id) DO NOTHING`,
        [entry.id],
      )
    if (command === 'schedule:status') {
      const controls = await pool.query<{ schedule_id: string; enabled: boolean }>(
        'SELECT schedule_id, enabled FROM doxa_schedule_controls',
      )
      const enabled = new Map(controls.rows.map((row) => [row.schedule_id, row.enabled]))
      for (const entry of schedules)
        io.out(
          `${enabled.get(entry.id) === false ? 'disabled' : 'enabled '} ${entry.id} -> ${entry.jobId} ${JSON.stringify(entry.cadence)}`,
        )
      return
    }
    if (command === 'schedule:enable' || command === 'schedule:disable') {
      const value = command === 'schedule:enable'
      await pool.query(
        `UPDATE doxa_schedule_controls
         SET enabled = $2, last_reconciled_at = now(), updated_at = now()
         WHERE schedule_id = $1`,
        [schedule!.id, value],
      )
      io.out(
        `${value ? 'Enabled' : 'Disabled'} schedule ${schedule!.id}. Restart a background role to reconcile immediately.`,
      )
      return
    }
    const job = result.manifest.jobs.find((entry) => entry.id === schedule!.jobId)
    if (!job) throw new PraxisCommandError(`Schedule ${schedule!.id} targets a missing job.`)
    const envelopeId = randomUUID()
    const context: QueueEnvelope['context'] = {
      version: 1,
      sourceExecutionId: envelopeId,
      correlationId: envelopeId,
      causationId: schedule!.id,
      actor: { kind: 'system', id: 'doxa:praxis' },
      initiator: { kind: 'system', id: 'doxa:praxis' },
      delegation: [],
      authentication: { state: 'authenticated', identityId: 'doxa:praxis', method: 'console' },
      trace: {},
      timeZone: schedule!.timeZone,
    }
    const envelope: QueueEnvelope = {
      id: envelopeId,
      kind: 'job',
      targetId: schedule!.jobId,
      scheduleId: schedule!.id,
      payload: schedule!.input as import('@doxajs/core').JsonValue,
      context,
      policy: {
        retries: job.retries,
        retryDelay: job.retryDelay,
        backoff: job.backoff,
        timeout: job.timeout,
      },
    }
    await pool.query(
      `
      INSERT INTO doxa_outbox_messages (id, message_type, payload, context, status, available_at, created_at)
      VALUES ($1, 'doxa.queue', $2::jsonb, $3::jsonb, 'pending', now(), now())
    `,
      [randomUUID(), JSON.stringify(envelope), JSON.stringify(context)],
    )
    io.out(`Fired schedule ${schedule!.id} as queue job ${envelopeId}.`)
  })
}

async function dotenvValue(cwd: string, key: string): Promise<string | undefined> {
  let content: string
  try {
    content = await readFile(path.join(cwd, '.env'), 'utf8')
  } catch {
    return undefined
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || match[1] !== key) continue
    const value = match[2]!
    return (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value
  }
  return undefined
}

interface MigrationFile {
  readonly id: string
  readonly sql: string
  readonly checksum: string
}

async function discoverMigrations(cwd: string): Promise<readonly MigrationFile[]> {
  const framework = ['postgres-drizzle', 'auth-postgres', 'queue-pg-boss']
  const authMigrations = await compiledAuthMigrations(cwd)
  if (await packageDeclares(cwd, '@doxajs/theoria')) framework.push('theoria')
  const roots: Array<{ prefix: string; directory: string }> = []
  for (const name of framework) {
    const installed = path.join(cwd, 'node_modules', '@doxajs', name, 'migrations')
    const workspace = path.resolve(import.meta.dirname, '..', '..', name, 'migrations')
    roots.push({
      prefix: `framework/${name}`,
      directory: (await directoryExists(installed)) ? installed : workspace,
    })
  }
  roots.push({ prefix: 'application', directory: path.join(cwd, 'migrations') })
  const migrations: MigrationFile[] = []
  for (const root of roots) {
    let names: string[]
    try {
      names = (await readdir(root.directory)).filter((name) => name.endsWith('.sql')).sort()
    } catch {
      continue
    }
    for (const name of names) {
      if (root.prefix === 'framework/auth-postgres' && !authMigrations.has(name)) continue
      const sql = await readFile(path.join(root.directory, name), 'utf8')
      migrations.push({
        id: `${root.prefix}/${name}`,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      })
    }
  }
  return migrations
}

async function compiledAuthMigrations(cwd: string): Promise<ReadonlySet<string>> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(cwd, '.doxa', 'manifest.json'), 'utf8'),
    ) as {
      authentication?: {
        source?: string
        verification?: { mode?: string }
      }
    }
    const authentication = manifest.authentication
    if (!authentication || authentication.source === 'doxa-owned') {
      return new Set(['0001_doxa_auth.sql', '0003_challenge_recipient_binding.sql'])
    }
    return new Set(['0000_auth_infrastructure.sql'])
  } catch {
    return new Set(['0001_doxa_auth.sql', '0003_challenge_recipient_binding.sql'])
  }
}

async function packageDeclares(cwd: string, dependency: string): Promise<boolean> {
  try {
    const packageJson = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return (
      dependency in (packageJson.dependencies ?? {}) ||
      dependency in (packageJson.devDependencies ?? {})
    )
  } catch {
    return false
  }
}

async function installDeclaredQueueSchema(cwd: string, args: readonly string[]): Promise<void> {
  if (!(await packageDeclares(cwd, '@doxajs/queue-pg-boss'))) return
  await installQueueSchema(await databaseConnection(cwd, args))
}

async function applyMigrations(
  pool: Pool,
  migrations: readonly MigrationFile[],
): Promise<readonly string[]> {
  const client = await pool.connect()
  const applied: string[] = []
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS doxa_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        batch integer NOT NULL,
        applied_at timestamptz NOT NULL
      )
    `)
    await client.query(`SELECT pg_advisory_lock(hashtext('doxa:migrations'))`)
    const existing = await client.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM doxa_migrations',
    )
    const byId = new Map(existing.rows.map((row) => [row.id, row.checksum]))
    for (const migration of migrations) {
      const checksum = byId.get(migration.id)
      if (checksum && checksum !== migration.checksum)
        throw new PraxisCommandError(
          `Applied migration ${migration.id} has changed; create a new migration instead.`,
        )
    }
    const batchResult = await client.query<{ batch: number }>(
      'SELECT COALESCE(max(batch), 0) + 1 AS batch FROM doxa_migrations',
    )
    const batch = batchResult.rows[0]!.batch
    for (const migration of migrations) {
      if (byId.has(migration.id)) continue
      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query(
          'INSERT INTO doxa_migrations (id, checksum, batch, applied_at) VALUES ($1, $2, $3, now())',
          [migration.id, migration.checksum, batch],
        )
        await client.query('COMMIT')
        applied.push(migration.id)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    }
    return applied
  } finally {
    await client
      .query(`SELECT pg_advisory_unlock(hashtext('doxa:migrations'))`)
      .catch(() => undefined)
    client.release()
  }
}

async function migrationStatus(
  pool: Pool,
  migrations: readonly MigrationFile[],
): Promise<readonly { id: string; state: 'applied' | 'pending' | 'drifted' }[]> {
  const exists = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.doxa_migrations') IS NOT NULL AS exists`,
  )
  const rows = exists.rows[0]?.exists
    ? await pool.query<{ id: string; checksum: string }>('SELECT id, checksum FROM doxa_migrations')
    : { rows: [] as Array<{ id: string; checksum: string }> }
  const applied = new Map(rows.rows.map((row) => [row.id, row.checksum]))
  return migrations.map((migration) => ({
    id: migration.id,
    state: !applied.has(migration.id)
      ? 'pending'
      : applied.get(migration.id) === migration.checksum
        ? 'applied'
        : 'drifted',
  }))
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    await readdir(directory)
    return true
  } catch {
    return false
  }
}

async function compile(cwd: string) {
  const { compileApplication } = await loadCompiler()
  return compileApplication({
    tsconfigPath: path.join(cwd, 'tsconfig.json'),
    applicationFile: path.join(cwd, 'app.config.ts'),
    frameworkFile: path.join(cwd, '.doxa/framework.ts'),
    sourceRoot: cwd,
    outputRoot: path.join(cwd, 'dist'),
    artifactsDirectory: path.join(cwd, '.doxa'),
  })
}

async function loadCompiler(): Promise<typeof import('@doxajs/compiler')> {
  try {
    return await import('@doxajs/compiler')
  } catch (error) {
    throw new PraxisCommandError(
      'Doxa compiler tooling is not installed. Reinstall development dependencies before running build or development commands.',
      { cause: error },
    )
  }
}

function typescriptCli(): string {
  try {
    return fileURLToPath(import.meta.resolve('typescript/bin/tsc'))
  } catch (error) {
    throw new PraxisCommandError(
      'Doxa TypeScript tooling is not installed. Reinstall development dependencies before running build or development commands.',
      { cause: error },
    )
  }
}

async function loadTheoriaTools(): Promise<typeof import('@doxajs/theoria')> {
  try {
    return await import('@doxajs/theoria')
  } catch (error) {
    throw new PraxisCommandError(
      'Theoria tooling is not installed. Install @doxajs/theoria before running this command.',
      { cause: error },
    )
  }
}

async function loadGnosisTools(): Promise<typeof import('@doxajs/gnosis')> {
  try {
    return await import('@doxajs/gnosis')
  } catch (error) {
    throw new PraxisCommandError(
      'Gnosis tooling is not installed. Reinstall development dependencies before running doxa mcp.',
      { cause: error },
    )
  }
}

async function frameworkDependencyRange(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new PraxisCommandError('The installed Praxis package does not declare a valid version.')
  }
  return `^${packageJson.version}`
}

async function makeApplication(directory: string, rawName: string): Promise<void> {
  const name = pascal(rawName)
  const packageName = kebab(rawName)
  const frameworkRange = await frameworkDependencyRange()
  await mkdir(path.join(directory, 'src', 'app', 'http'), { recursive: true })
  const files: Record<string, string> = {
    'package.json': `${JSON.stringify(
      {
        name: packageName,
        version: '0.1.0',
        private: true,
        type: 'module',
        packageManager: 'pnpm@11.18.0',
        scripts: {
          doxa: 'doxa',
          build: 'doxa build',
          dev: 'doxa dev',
          start: 'doxa serve',
          serve: 'doxa serve',
          background: 'doxa work',
          work: 'doxa work',
          schedule: 'doxa schedule',
          migrate: 'doxa migrate',
          'db:studio': 'doxa db:studio',
          test: 'doxa build && vitest run',
        },
        dependencies: {
          '@doxajs/praxis': frameworkRange,
          '@doxajs/auth-postgres': frameworkRange,
          '@doxajs/core': frameworkRange,
          '@doxajs/http-hono': frameworkRange,
          '@doxajs/postgres-drizzle': frameworkRange,
          '@doxajs/queue-pg-boss': frameworkRange,
          '@doxajs/runtime': frameworkRange,
        },
        devDependencies: {
          '@doxajs/testing': frameworkRange,
          '@types/node': '^24.0.0',
          typescript: '^6.0.0',
          vitest: '^4.0.0',
        },
        engines: { node: '>=24.7 <25' },
      },
      null,
      2,
    )}\n`,
    'pnpm-workspace.yaml': `packages:
  - .

allowBuilds:
  esbuild: true
`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2024',
          lib: ['ES2024'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
          strict: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
          verbatimModuleSyntax: true,
          skipLibCheck: true,
          rootDir: 'src',
          outDir: 'dist',
          sourceMap: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
    '.gitignore': 'node_modules\ndist\n.doxa\n.env\n.env.*\n!.env.example\n',
    '.dockerignore': `.git
.github
.doxa
.env
.env.*
node_modules
dist
coverage
tests
*.log
compose.yaml
compose.production.yaml
README.md
`,
    Dockerfile: `# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.14.0

FROM node:\${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=\${PNPM_HOME}:\${PATH}
WORKDIR /app
RUN corepack enable

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build
RUN pnpm prune --prod --no-optional

FROM node:\${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV PATH=/app/node_modules/.bin:\${PATH}
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/.doxa ./.doxa
COPY --from=build --chown=node:node /app/migrations ./migrations
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["doxa", "serve", "--host=0.0.0.0", "--port=3000"]
`,
    'compose.production.yaml': `name: ${packageName}

x-doxa-service: &doxa-service
  image: \${DOXA_IMAGE:-${packageName}:latest}
  build:
    context: .
    target: runtime
  init: true
  stop_grace_period: 30s
  environment:
    NODE_ENV: production
    DATABASE_CONNECTION_STRING: \${DATABASE_CONNECTION_STRING:?DATABASE_CONNECTION_STRING is required}

services:
  web:
    <<: *doxa-service
    command: ["doxa", "serve", "--host=0.0.0.0", "--port=3000"]
    restart: unless-stopped
    ports:
      - "\${PORT:-3000}:3000"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 10s

  background:
    <<: *doxa-service
    command: ["doxa", "work"]
    restart: unless-stopped

  migrate:
    <<: *doxa-service
    command: ["doxa", "migrate"]
    profiles: ["release"]
    restart: "no"
`,
    'migrations/.gitkeep': '',
    '.env.example':
      'DATABASE_CONNECTION_STRING=postgresql://doxa:doxa@127.0.0.1:54329/doxa\nPORT=3000\nHOST=127.0.0.1\nDOXA_LOG_LEVEL=info\n# DOXA_LOG_FORMAT=pretty\n',
    'compose.yaml': `services:\n  postgres:\n    image: postgres:17-alpine\n    environment:\n      POSTGRES_USER: doxa\n      POSTGRES_PASSWORD: doxa\n      POSTGRES_DB: doxa\n    ports:\n      - "54329:5432"\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U doxa"]\n      interval: 2s\n      timeout: 2s\n      retries: 20\n`,
    'README.md': `# ${name}\n\nGenerated by Doxa Praxis.\n\n\`\`\`sh\npnpm install\ncp .env.example .env\ndocker compose up -d\npnpm migrate\npnpm dev\n\`\`\`\n\n\`pnpm dev\` watches \`src/\`, keeps the last good server alive when a build fails, and hot reloads a fresh runtime after valid changes. Run \`pnpm db:studio\` to browse the configured PostgreSQL database.\n\n## Production containers\n\nDoxa builds one immutable image and runs it as separate web and background services. The background service consumes queues and runs distributed-safe schedules. Migrations are an explicit release job and never run during service startup.\n\n\`\`\`sh\nexport DATABASE_CONNECTION_STRING=postgresql://...\ndocker compose -f compose.production.yaml build\ndocker compose -f compose.production.yaml --profile release run --rm migrate\ndocker compose -f compose.production.yaml up -d web background\n\`\`\`\n\nFor advanced schedule isolation, run background replicas with \`doxa work --without-scheduler\` and a separate \`doxa schedule\` service from the same image.\n`,
    'src/app/http/home.route.ts': `import { type HttpRequest, Route } from '@doxajs/core'\n\nexport class HomeRoute extends Route {\n  static override readonly id = 'home'\n  static override readonly access = 'public'\n  readonly method = 'GET'\n  readonly path = '/'\n  handle(_request: HttpRequest) { this.logger.info('Home visited'); return { application: '${packageName}', framework: 'Doxa' } }\n}\n`,
    'tests/app.test.ts': `import { describe, expect, it } from 'vitest'\n\ndescribe('${name}', () => {\n  it('is ready to build', () => expect(true).toBe(true))\n})\n`,
  }
  files['app.config.ts'] =
    `import { DoxaApplication } from '@doxajs/core'\n\nimport { AppFeature } from './src/app/app.feature.js'\n\nexport class Application extends DoxaApplication {\n  id = '${packageName}'\n  features = [AppFeature]\n  plugins = [] as const\n  framework = {\n    auth: {\n      secureCookies: false,\n      trustedOrigins: ['http://127.0.0.1:3000'],\n    },\n  }\n}\n`
  files['src/app/app.feature.ts'] =
    `import { Feature } from '@doxajs/core'\n\nimport { HomeRoute } from './http/home.route.js'\n\nexport class AppFeature extends Feature {\n  id = 'app'\n  routes = [HomeRoute]\n}\n`
  files['tsconfig.json'] = `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2024',
        lib: ['ES2024'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        types: ['node'],
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
        rootDir: '.',
        outDir: 'dist',
        sourceMap: true,
      },
      include: ['app.config.ts', 'src/**/*.ts', '.doxa/framework.ts'],
    },
    null,
    2,
  )}\n`
  files['.env.example'] =
    'DATABASE_CONNECTION_STRING=postgresql://doxa:doxa@127.0.0.1:54329/doxa\nAUTH_SECURE_COOKIES=false\nAUTH_TRUSTED_ORIGINS=http://127.0.0.1:3000\nPORT=3000\nHOST=127.0.0.1\nDOXA_LOG_LEVEL=info\n# DOXA_LOG_FORMAT=pretty\n'

  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(directory, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeNew(file, content)
  }
  await installGnosisRegistration(directory)
}

async function buildApplication(cwd: string, protocolStdio = false) {
  if (await fileExists(path.join(cwd, 'app.config.ts'))) {
    const { prepareApplication } = await loadCompiler()
    await prepareApplication({
      applicationFile: path.join(cwd, 'app.config.ts'),
      frameworkFile: path.join(cwd, '.doxa/framework.ts'),
    })
  }
  const code = await (protocolStdio ? runProtocolBuild : runProcess)(
    process.execPath,
    [typescriptCli(), '-p', 'tsconfig.json'],
    cwd,
  )
  if (code !== 0) throw new PraxisCommandError(`TypeScript build failed with exit code ${code}.`)
  const result = await compile(cwd)
  await writeGnosisKnowledge(cwd, result.manifest)
  return result
}

interface PrebuiltApplication {
  readonly Application: Parameters<typeof Doxa.boot>[0]
  readonly manifest: {
    readonly applicationId: string
    readonly buildHash: string
    readonly commands: readonly { readonly command: string }[]
    readonly schedules: readonly {
      readonly id: string
      readonly jobId: string
      readonly cadence: unknown
      readonly timeZone: string
      readonly input: unknown
    }[]
    readonly jobs: readonly {
      readonly id: string
      readonly retries: number
      readonly retryDelay: number
      readonly backoff: boolean
      readonly timeout: number
    }[]
  }
}

async function loadPrebuiltApplication(cwd: string): Promise<PrebuiltApplication> {
  const artifactsDirectory = path.join(cwd, '.doxa')
  const manifestPath = path.join(artifactsDirectory, 'manifest.json')
  const registryPath = path.join(artifactsDirectory, 'registry.mjs')
  const applicationPath = path.join(cwd, 'dist/app.config.js')
  let manifest: PrebuiltApplication['manifest']
  try {
    const [manifestJson] = await Promise.all([
      readFile(manifestPath, 'utf8'),
      readFile(registryPath, 'utf8'),
      readFile(applicationPath, 'utf8'),
    ])
    manifest = JSON.parse(manifestJson) as PrebuiltApplication['manifest']
    if (
      !manifest.applicationId ||
      !manifest.buildHash ||
      !Array.isArray(manifest.commands) ||
      !Array.isArray(manifest.schedules) ||
      !Array.isArray(manifest.jobs)
    ) {
      throw new Error('invalid manifest')
    }
  } catch (error) {
    throw new PraxisCommandError(
      `Prebuilt Doxa artifacts are missing or invalid. Run doxa build before starting a production role. (${errorMessage(error)})`,
    )
  }
  const registry = (await import(
    `${pathToFileURL(registryPath).href}?buildHash=${manifest.buildHash}`
  )) as {
    constructors?: Record<string, Parameters<typeof Doxa.boot>[0]>
  }
  const Application = registry.constructors?.[`application:${manifest.applicationId}`]
  if (!Application)
    throw new PraxisCommandError('The prebuilt registry does not export the declared Application.')
  return { Application, manifest }
}

async function writeGnosisKnowledge(
  cwd: string,
  manifest: Parameters<typeof inspectGraph>[0],
): Promise<void> {
  let createGnosisKnowledge: typeof import('@doxajs/gnosis').createGnosisKnowledge
  try {
    ;({ createGnosisKnowledge } = await import('@doxajs/gnosis'))
  } catch (error) {
    throw new PraxisCommandError(
      'Gnosis tooling is not installed. Reinstall development dependencies before generating agent knowledge.',
      { cause: error },
    )
  }
  const knowledge = createGnosisKnowledge(manifest)
  await mkdir(path.join(cwd, '.doxa'), { recursive: true })
  await writeFile(
    path.join(cwd, '.doxa/gnosis.json'),
    `${JSON.stringify(knowledge, null, 2)}\n`,
    'utf8',
  )
}

async function runRuntimeCommand(
  command: 'serve' | 'work' | 'schedule' | 'dev',
  cwd: string,
  args: readonly string[],
  io: PraxisIo,
): Promise<void> {
  if (command === 'dev') {
    await runHotDevelopment(cwd, args, io)
    return
  }
  const applicationModule = await loadPrebuiltApplication(cwd)
  const environment = { ...(await dotenvEnvironment(cwd)), ...process.env }
  const worker = command === 'work'
  const web = command === 'serve'
  const scheduler =
    command === 'schedule' || (command === 'work' && !args.includes('--without-scheduler'))
  const runtime = await Doxa.boot(applicationModule.Application, {
    artifactsDirectory: path.join(cwd, '.doxa'),
    dotenvPath: false,
    environment,
    roles: { web, worker, scheduler },
    logging: loggingOptions(environment),
  })
  let host: HonoHttpHost | undefined
  if (command === 'serve') {
    const port = integerOption(args, 'port', Number(environment.PORT ?? 3000))
    const hostname = option(args, 'host') ?? environment.HOST ?? '127.0.0.1'
    host = await HonoHttpHost.listen(runtime, { port, hostname })
  }
  const shutdown = waitForShutdown(async () => {
    if (host) await host.shutdown()
    else await runtime.shutdown()
  })
  if (command === 'serve' && host) {
    io.out(`Doxa ${command} ready at ${host.url}`)
  } else {
    io.out(
      command === 'work' && scheduler
        ? 'Doxa background role ready (workers + schedules).'
        : `Doxa ${command} role ready.`,
    )
  }
  await shutdown
}

async function runHotDevelopment(
  cwd: string,
  args: readonly string[],
  io: PraxisIo,
): Promise<void> {
  await installDeclaredQueueSchema(cwd, args)
  await withDatabase(cwd, args, async (pool) => {
    await applyMigrations(pool, await discoverMigrations(cwd))
  })
  const supervisor = await HotReloadSupervisor.start({
    watchPaths: [path.join(cwd, 'src'), path.join(cwd, 'app.config.ts')],
    build: () => buildApplication(cwd).then(() => undefined),
    start: () => startDevelopmentChild(cwd, args),
    onWatching: () => io.out('Doxa dev is watching app.config.ts and src/ for changes.'),
    onReloaded: () => io.out('Doxa hot reload complete.'),
    onError: (error, phase) =>
      io.error(
        phase === 'build'
          ? `Doxa hot reload build failed; the last good server remains active. ${errorMessage(error)}`
          : `Doxa hot reload ${phase} failed. ${errorMessage(error)}`,
      ),
  })
  await waitForShutdown(() => supervisor.stop())
}

async function startDevelopmentChild(
  cwd: string,
  args: readonly string[],
): Promise<HotReloadTarget> {
  const child = fork(path.join(import.meta.dirname, 'dev-child.js'), [cwd, JSON.stringify(args)], {
    cwd,
    env: process.env,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })
  await waitForChildReady(child)
  return {
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = waitForChildExit(child)
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
      timer.unref()
      try {
        await exited
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

function waitForChildReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('Development runtime did not become ready within 30 seconds.')),
      30_000,
    )
    timeout.unref()
    const onMessage = (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        (message as { type?: unknown }).type === 'ready'
      )
        finish()
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        new Error(`Development runtime exited before readiness (${code ?? signal ?? 'unknown'}).`),
      )
    }
    const onError = (error: Error) => finish(error)
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
      if (error) reject(error)
      else resolve()
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('exit', () => resolve()))
}

export async function runDevelopmentRuntime(cwd: string, args: readonly string[]): Promise<void> {
  const applicationModule = await loadPrebuiltApplication(cwd)
  const environment = { ...(await dotenvEnvironment(cwd)), ...process.env }
  const runtime = await Doxa.boot(applicationModule.Application, {
    artifactsDirectory: path.join(cwd, '.doxa'),
    dotenvPath: false,
    environment,
    roles: { web: true, worker: true, scheduler: true },
    logging: loggingOptions(environment),
  })
  let host: HonoHttpHost | undefined
  try {
    const port = integerOption(args, 'port', Number(environment.PORT ?? 3000))
    const hostname = option(args, 'host') ?? environment.HOST ?? '127.0.0.1'
    host = await HonoHttpHost.listen(runtime, { port, hostname })
    runtime.logger.channel('lifecycle').info('Development server ready', {
      url: host.url.toString(),
      routes: runtime.manifest.routes.length,
      hmr: true,
    })
    process.send?.({ type: 'ready', url: host.url.toString() })
    await waitForShutdown(() => host!.shutdown())
  } catch (error) {
    if (!host) await runtime.shutdown().catch(() => undefined)
    throw error
  }
}

async function runApplicationCommand(
  name: string,
  args: readonly string[],
  cwd: string,
): Promise<boolean> {
  const module = await loadPrebuiltApplication(cwd)
  if (!module.manifest.commands.some((command) => command.command === name)) return false
  const environment = { ...(await dotenvEnvironment(cwd)), ...process.env }
  const runtime = await Doxa.boot(module.Application, {
    artifactsDirectory: path.join(cwd, '.doxa'),
    dotenvPath: false,
    environment,
    roles: { web: false, worker: false, scheduler: false },
    logging: loggingOptions(environment),
  })
  try {
    await runtime.admit(
      {
        actor: { kind: 'system', id: 'doxa:praxis' },
        authentication: { state: 'authenticated', identityId: 'doxa:praxis', method: 'console' },
        transport: { kind: 'console', name },
      },
      () => runtime.dispatchCommand(name, args),
    )
  } finally {
    await runtime.shutdown()
  }
  return true
}

async function queryGnosisModels(
  cwd: string,
  buildHash: string,
  request: import('@doxajs/gnosis').GnosisModelQueryRequest,
): Promise<import('@doxajs/gnosis').GnosisModelQueryResult> {
  const environment = { ...(await dotenvEnvironment(cwd)), ...process.env }
  if (environment.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new PraxisCommandError('Gnosis model queries are disabled in production.')
  }
  const module = await loadPrebuiltApplication(cwd)
  if (module.manifest.buildHash !== buildHash) {
    throw new PraxisCommandError(
      'Doxa artifacts changed after Gnosis started. Restart the MCP client.',
    )
  }
  const runtime = await Doxa.boot(module.Application, {
    artifactsDirectory: path.join(cwd, '.doxa'),
    profile: 'model-reader',
    dotenvPath: false,
    environment,
    roles: { web: false, worker: false, scheduler: false },
    logging: false,
  })
  try {
    return await runtime.queryModelRecords(request, {
      actor: { kind: 'system', id: 'doxa:gnosis' },
      authentication: { state: 'authenticated', identityId: 'doxa:gnosis', method: 'console' },
      transport: { kind: 'console', name: 'gnosis:query-models' },
      deadline: new Date(Date.now() + 30_000),
    })
  } finally {
    await runtime.shutdown()
  }
}

async function describeAuthStorage(
  cwd: string,
  args: readonly string[],
  io: PraxisIo,
): Promise<void> {
  const module = await loadPrebuiltApplication(cwd)
  const runtime = await Doxa.boot(module.Application, {
    artifactsDirectory: path.join(cwd, '.doxa'),
    dotenvPath: false,
    environment: {
      ...(await dotenvEnvironment(cwd)),
      ...process.env,
      DATABASE_CONNECTION_STRING: await databaseConnection(cwd, args),
    },
    roles: { web: false, worker: false, scheduler: false },
    logging: false,
  })
  try {
    const storage = runtime.authenticationStorage()
    io.out(`authentication ${storage.kind}`)
    if (storage.mapping) {
      const mapping = storage.mapping
      io.out(`mode           ${mapping.mode}`)
      io.out(`source         ${mapping.modelId ?? mapping.source}`)
      io.out(
        `identifier     ${mapping.identifier.field} (${mapping.identifier.kind}, ${mapping.identifier.normalization})`,
      )
      if (mapping.contactEmail) io.out(`contact email  ${mapping.contactEmail}`)
      io.out(`verification   ${mapping.verification}`)
      io.out(`eligibility    ${mapping.eligibility.join(', ') || 'none'}`)
      io.out(`hashers        ${mapping.hashers.join(', ')}`)
      io.out(`upgrade        ${mapping.credentialUpgrade}`)
      for (const warning of mapping.securityWarnings) io.out(`warning        ${warning}`)
    }
    for (const [name, entry] of Object.entries(storage)) {
      if (name === 'kind' || name === 'mapping' || !entry || typeof entry !== 'object') continue
      const table = entry as { table: string; ownership: string }
      io.out(`${name.padEnd(14)} ${table.ownership.padEnd(8)} ${table.table}`)
    }
  } finally {
    await runtime.shutdown()
  }
}

function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: 'inherit', env: environment })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

function runProtocolBuild(
  command: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: ['ignore', process.stderr, process.stderr],
      env: environment,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
}

function runProcessCapture(
  command: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: environment,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) =>
      resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr }),
    )
  })
}

async function waitForShutdown(shutdown: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let closing = false
    const keepAlive = setInterval(() => undefined, 2_147_483_647)
    const close = () => {
      if (closing) return
      closing = true
      clearInterval(keepAlive)
      process.off('SIGINT', close)
      process.off('SIGTERM', close)
      void shutdown().then(resolve, reject)
    }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
  })
}

async function dotenvEnvironment(cwd: string): Promise<Record<string, string>> {
  let content: string
  try {
    content = await readFile(path.join(cwd, '.env'), 'utf8')
  } catch {
    return {}
  }
  const environment: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const value = match[2]!
    environment[match[1]!] =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value
  }
  return environment
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await readFile(file)
    return true
  } catch {
    return false
  }
}

function loggingOptions(environment: Readonly<Record<string, string | undefined>>): {
  readonly level: LogLevel
  readonly format?: LogFormat
  readonly color?: boolean
} {
  const level = environment.DOXA_LOG_LEVEL ?? 'info'
  if (!['debug', 'info', 'warn', 'error', 'fatal'].includes(level)) {
    throw new PraxisCommandError('DOXA_LOG_LEVEL must be debug, info, warn, error, or fatal.')
  }
  const format = environment.DOXA_LOG_FORMAT
  if (format !== undefined && format !== 'pretty' && format !== 'json') {
    throw new PraxisCommandError('DOXA_LOG_FORMAT must be pretty or json.')
  }
  return {
    level: level as LogLevel,
    ...(format ? { format } : {}),
    ...(environment.NO_COLOR !== undefined ? { color: false } : {}),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function makeFeature(cwd: string, rawName: string): Promise<void> {
  const name = pascal(rawName)
  const segment = kebab(name)
  const directory = path.join(cwd, 'src', 'features', segment)
  const file = path.join(directory, `${segment}.feature.ts`)
  await mkdir(directory, { recursive: true })
  await writeNew(
    file,
    `import { Feature } from '@doxajs/core'\n\nexport class ${name}Feature extends Feature {\n  id = '${segment}'\n}\n`,
  )
  try {
    await registerApplicationFeature(
      path.join(cwd, 'app.config.ts'),
      `${name}Feature`,
      `./src/features/${segment}/${segment}.feature.js`,
    )
  } catch (error) {
    await rm(file, { force: true })
    throw error
  }
}

async function registerApplicationFeature(
  applicationFile: string,
  className: string,
  specifier: string,
): Promise<void> {
  let source: string
  try {
    source = await readFile(applicationFile, 'utf8')
  } catch {
    return
  }
  if (source.includes(`{ ${className} }`)) return
  source = source.replace(/(export class )/, `import { ${className} } from '${specifier}'\n\n$1`)
  const existing = /(\n  features\s*=\s*\[)([^\]]*)(\])/
  if (!existing.test(source))
    throw new PraxisCommandError('Application must declare a literal features array.')
  source = source.replace(existing, (_match, open: string, contents: string, close: string) => {
    const trimmed = contents.trim()
    return `${open}${trimmed ? `${trimmed}, ` : ''}${className}${close}`
  })
  await writeFile(applicationFile, source, 'utf8')
}

interface Target {
  readonly feature: string
  readonly name: string
}
type GeneratorRole =
  | 'model'
  | 'action'
  | 'query'
  | 'route'
  | 'event'
  | 'listener'
  | 'signal'
  | 'signal-handler'
  | 'observer'
  | 'job'
  | 'schedule'
  | 'policy'
  | 'permission-source'
  | 'config'
  | 'provider'
  | 'service'
  | 'command'

async function makeRole(
  cwd: string,
  role: GeneratorRole,
  target: Target,
  arguments_: readonly string[],
): Promise<string> {
  const definition = roleDefinition(role, target, arguments_)
  const field = definition.field
  const folder = definition.folder
  const className = pascal(target.name)
  const fileName = `${kebab(className)}.ts`
  const featureFile = await resolveFeatureFile(cwd, target.feature)
  const directory = path.join(path.dirname(featureFile), folder)
  await mkdir(directory, { recursive: true })
  const source = definition.source(className)
  const file = path.join(directory, fileName)
  await writeNew(file, source)
  try {
    if (field)
      await registerFeatureClass(
        featureFile,
        field,
        role,
        className,
        `./${folder}/${kebab(className)}.js`,
      )
  } catch (error) {
    await rm(file, { force: true })
    throw error
  }
  return file
}

async function resolveFeatureFile(cwd: string, feature: string): Promise<string> {
  const conventional = path.join(cwd, 'src', 'features', feature, `${feature}.feature.ts`)
  if (await fileExists(conventional)) return conventional

  let applicationSource: string
  try {
    applicationSource = await readFile(path.join(cwd, 'app.config.ts'), 'utf8')
  } catch {
    return conventional
  }
  const featureClass = `${pascal(feature)}Feature`
  const featureImport = namedImports(applicationSource).find(
    (binding) => binding.local === featureClass && binding.specifier.startsWith('.'),
  )
  if (!featureImport) return conventional
  const sourceSpecifier = featureImport.specifier.replace(/\.js$/, '.ts')
  const imported = path.resolve(cwd, sourceSpecifier)
  return (await fileExists(imported)) ? imported : conventional
}

function roleDefinition(
  role: GeneratorRole,
  target: Target,
  args: readonly string[],
): {
  readonly field?: string
  readonly folder: string
  readonly source: (name: string) => string
} {
  const access =
    role === 'route'
      ? parseRouteAccess(args)
      : ['action', 'query', 'listener', 'signal-handler', 'job', 'schedule', 'command'].includes(
            role,
          )
        ? parseAccess(args)
        : undefined
  const simple =
    (base: string, extra = '') =>
    (name: string) =>
      `import { ${base} } from '@doxajs/core'\n\nexport class ${name} extends ${base} {\n  static override readonly id = '${kebab(name)}'\n${extra}}\n`
  if (role === 'model')
    return {
      field: 'models',
      folder: 'models',
      source: (name) =>
        `import { Model, type ModelAttributes } from '@doxajs/core'\n\nexport interface ${name}Attributes extends ModelAttributes {}\n\nexport class ${name} extends Model<${name}Attributes> {\n  static override readonly id = '${kebab(name)}'\n}\n`,
    }
  if (role === 'action' || role === 'query')
    return {
      field: role === 'query' ? 'queries' : 'actions',
      folder: role === 'query' ? 'queries' : 'actions',
      source: (name) =>
        `import { ${pascal(role)} } from '@doxajs/core'\n\nexport class ${name} extends ${pascal(role)}<void, void> {\n  static id = '${kebab(name)}'\n  static override readonly access = '${access}'\n\n  async handle(): Promise<void> {\n    // TODO: implement ${name}.\n  }\n}\n`,
    }
  if (role === 'event') {
    const queued = args.includes('--broadcast')
    const now = args.includes('--broadcast-now')
    const domainModel = option(args, 'model')
    const base = domainModel ? 'DomainEvent' : 'Event'
    const modelDeclaration = domainModel
      ? `import { ${pascal(domainModel)} } from '../models/${kebab(domainModel)}.js'\n`
      : ''
    const modelProperty = domainModel
      ? `  static override readonly model = ${pascal(domainModel)}\n`
      : ''
    if (queued && now)
      throw new PraxisCommandError('Events cannot combine --broadcast and --broadcast-now.')
    if (!queued && !now)
      return {
        field: 'events',
        folder: 'events',
        source: (name) =>
          `import { ${base} } from '@doxajs/core'\n${modelDeclaration}\nexport class ${name} extends ${base} {\n  static override readonly id = '${kebab(name)}'\n${modelProperty}}\n`,
      }
    const channel = required(
      option(args, 'channel'),
      'Broadcast events require --channel=<channel-name>.',
    )
    const privateChannel = args.includes('--private')
    const presence = args.includes('--presence')
    if (privateChannel && presence)
      throw new PraxisCommandError('Broadcast events cannot combine --private and --presence.')
    const channelClass = presence
      ? 'PresenceChannel'
      : privateChannel
        ? 'PrivateChannel'
        : 'Channel'
    const capability = now ? 'ShouldBroadcastNow' : 'ShouldBroadcast'
    return {
      field: 'events',
      folder: 'events',
      source: (name) =>
        `import { ${channelClass}, ${base}, type ${capability} } from '@doxajs/core'\n${modelDeclaration}\nexport class ${name} extends ${base} implements ${capability} {\n  static override readonly id = '${kebab(name)}'\n${modelProperty}\n  broadcastOn() {\n    return new ${channelClass}('${channel}')\n  }\n}\n`,
    }
  }
  if (role === 'signal') return { field: 'signals', folder: 'signals', source: simple('Signal') }
  if (role === 'route') {
    const method = (option(args, 'method') ?? 'GET').toUpperCase()
    const routePath = option(args, 'path')
    if (!['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'].includes(method))
      throw new PraxisCommandError(
        '--method must be GET, POST, PUT, PATCH, DELETE, HEAD, or OPTIONS.',
      )
    if (!routePath?.startsWith('/'))
      throw new PraxisCommandError('Routes require an absolute --path=/... value.')
    return {
      field: 'routes',
      folder: 'http',
      source: (name) =>
        `import { type HttpRequest, Route } from '@doxajs/core'\n\nexport class ${name} extends Route {\n  static override readonly id = '${kebab(name)}'\n  static override readonly access = '${access}'\n  readonly method = '${method}'\n  readonly path = '${routePath}'\n\n  handle(_request: HttpRequest) {\n    return { message: '${kebab(name)}' }\n  }\n}\n`,
    }
  }
  if (role === 'listener') {
    const related = pascal(required(option(args, 'event'), 'Listeners require --event=EventName.'))
    const delivery = args.includes('--queued-after-commit')
      ? 'ShouldQueueAfterCommit'
      : args.includes('--queued')
        ? 'ShouldQueue'
        : args.includes('--after-commit')
          ? 'ShouldHandleEventsAfterCommit'
          : undefined
    return {
      field: 'listeners',
      folder: 'listeners',
      source: (name) =>
        `import { Listener${delivery ? `, type ${delivery}` : ''} } from '@doxajs/core'\nimport { ${related} } from '../events/${kebab(related)}.js'\n\nexport class ${name} extends Listener<${related}>${delivery ? ` implements ${delivery}` : ''} {\n  static id = '${kebab(name)}'\n  static override readonly access = '${access}'\n  async handle(_event: ${related}): Promise<void> {}\n}\n`,
    }
  }
  if (role === 'signal-handler') {
    const related = pascal(
      required(option(args, 'signal'), 'Signal handlers require --signal=SignalName.'),
    )
    return {
      field: 'signalHandlers',
      folder: 'signal-handlers',
      source: (name) =>
        `import { SignalHandler } from '@doxajs/core'\nimport { ${related} } from '../signals/${kebab(related)}.js'\n\nexport class ${name} extends SignalHandler<${related}> {\n  static id = '${kebab(name)}'\n  static override readonly access = '${access}'\n  async handle(_signal: ${related}): Promise<void> {}\n}\n`,
    }
  }
  if (role === 'observer') {
    const related = pascal(required(option(args, 'model'), 'Observers require --model=ModelName.'))
    return {
      field: 'observers',
      folder: 'observers',
      source: (name) =>
        `import { Observer } from '@doxajs/core'\nimport { ${related} } from '../models/${kebab(related)}.js'\n\nexport class ${name} extends Observer<${related}> {\n  static id = '${kebab(name)}'\n  async saved(_model: ${related}): Promise<void> {}\n}\n`,
    }
  }
  if (role === 'job')
    return {
      field: 'jobs',
      folder: 'jobs',
      source: (name) =>
        `import { Job } from '@doxajs/core'\n\nexport class ${name} extends Job<void> {\n  static override readonly id = '${kebab(name)}'\n  static override readonly access = '${access}'\n  async handle(): Promise<void> {}\n}\n`,
    }
  if (role === 'schedule') {
    const job = pascal(required(option(args, 'job'), 'Schedules require --job=JobName.'))
    const cron = option(args, 'cron')
    const every = option(args, 'every')
    const misfire = option(args, 'misfire') ?? 'skip'
    if (Boolean(cron) === Boolean(every))
      throw new PraxisCommandError('Schedules require exactly one of --cron= or --every=seconds.')
    if (every && (!Number.isFinite(Number(every)) || Number(every) <= 0))
      throw new PraxisCommandError('--every must be a positive number of seconds.')
    if (misfire !== 'skip' && misfire !== 'catch-up-once')
      throw new PraxisCommandError('--misfire must be skip or catch-up-once.')
    return {
      field: 'schedules',
      folder: 'schedules',
      source: (name) =>
        `import { Schedule } from '@doxajs/core'\nimport { ${job} } from '../jobs/${kebab(job)}.js'\n\nexport class ${name} extends Schedule<void> {\n  static override readonly id = '${kebab(name)}'\n  static override readonly access = '${access}'\n  static override readonly job = ${job}\n  static override readonly ${cron ? `cron = ${JSON.stringify(cron)}` : `everySeconds = ${Number(every)}`}\n  static override readonly misfire = '${misfire}'\n  static override readonly input = undefined\n}\n`,
    }
  }
  if (role === 'policy') {
    const abilities = generatorAbilities(args, 'Policies')
    return {
      field: 'policies',
      folder: 'policies',
      source: (name) =>
        `import { allow, deny, Policy, type PolicyRequest, type PolicyDecision } from '@doxajs/core'\n\nexport class ${name} extends Policy {\n  static id = '${kebab(name)}'\n  static override readonly abilities = ${JSON.stringify(abilities)}\n  decide(request: PolicyRequest): PolicyDecision {\n    return request.actor.kind === 'anonymous' ? deny('authentication_required') : allow('authenticated')\n  }\n}\n`,
    }
  }
  if (role === 'permission-source') {
    const abilities = generatorAbilities(args, 'Permission sources')
    return {
      field: 'permissionSources',
      folder: 'permission-sources',
      source: (name) =>
        `import { PermissionSource, type PermissionSourceRequest } from '@doxajs/core'\n\nexport class ${name} extends PermissionSource {\n  static override readonly id = '${kebab(name)}'\n  static override readonly abilities = ${JSON.stringify(abilities)}\n\n  async resolve(_request: PermissionSourceRequest): Promise<readonly string[]> {\n    return []\n  }\n}\n`,
    }
  }
  if (role === 'config')
    return {
      field: 'configs',
      folder: 'config',
      source: (name) =>
        `import { Configuration } from '@doxajs/core'\n\nexport class ${name} extends Configuration {\n  declare enabled: boolean\n}\n`,
    }
  if (role === 'provider')
    return {
      field: 'providers',
      folder: 'providers',
      source: (name) => `export class ${name} {\n  static id = '${kebab(name)}'\n}\n`,
    }
  if (role === 'command') {
    const commandName = option(args, 'name') ?? `${target.feature}:${kebab(target.name)}`
    const description = option(args, 'description') ?? ''
    return {
      field: 'commands',
      folder: 'commands',
      source: (name) =>
        `import { Command } from '@doxajs/core'\n\nexport class ${name} extends Command {\n  static override readonly id = '${kebab(name)}'\n  static override readonly name = '${commandName}'\n  static override readonly description = ${JSON.stringify(description)}\n  static override readonly access = '${access}'\n\n  async handle(_arguments: readonly string[]): Promise<void> {}\n}\n`,
    }
  }
  return {
    ...(args.includes('--provide') ? { field: 'provides' } : {}),
    folder: 'services',
    source: (name) => `export class ${name} {}\n`,
  }
}

function generatorAbilities(args: readonly string[], label: string): readonly string[] {
  const abilities = required(option(args, 'abilities'), `${label} require --abilities=one,two.`)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (abilities.length === 0) {
    throw new PraxisCommandError(`${label} require at least one ability.`)
  }
  if (new Set(abilities).size !== abilities.length) {
    throw new PraxisCommandError(`${label} require unique abilities.`)
  }
  const invalid = abilities.find((ability) => !/^[a-z][a-z0-9._:-]{1,127}$/.test(ability))
  if (invalid) {
    throw new PraxisCommandError(`${label} received invalid ability ${invalid}.`)
  }
  return abilities
}

async function registerFeatureClass(
  featureFile: string,
  field: string,
  role: GeneratorRole,
  className: string,
  specifier: string,
): Promise<void> {
  let source = await readFile(featureFile, 'utf8')
  const existing = new RegExp(`(\\n  ${field}\\s*=\\s*\\[)([^\\]]*)(\\])`)
  const match = existing.exec(source)
  const registered = new Set(
    (match?.[2] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  const imports = namedImports(source)
  const exactImport = imports.find(
    (binding) => binding.imported === className && binding.specifier === specifier,
  )
  if (exactImport && registered.has(exactImport.local))
    throw new PraxisCommandError(`${className} is already registered.`)

  const localName = exactImport?.local ?? availableRoleName(imports, className, role)
  if (!exactImport) {
    const importedName = localName === className ? className : `${className} as ${localName}`
    const updated = source.replace(
      /(export class )/,
      `import { ${importedName} } from '${specifier}'\n\n$1`,
    )
    if (updated === source)
      throw new PraxisCommandError('Feature must export a class before roles can be registered.')
    source = updated
  }
  if (existing.test(source)) {
    source = source.replace(existing, (_match, open: string, contents: string, close: string) => {
      const trimmed = contents.trim()
      return `${open}${trimmed ? `${trimmed}, ` : ''}${localName}${close}`
    })
  } else {
    const updated = source.replace(/\n}\s*$/, `\n  ${field} = [${localName}]\n}\n`)
    if (updated === source)
      throw new PraxisCommandError(
        'Feature must end with a class declaration before roles can be registered.',
      )
    source = updated
  }
  await writeFile(featureFile, source, 'utf8')
}

interface NamedImport {
  readonly imported: string
  readonly local: string
  readonly specifier: string
}

function namedImports(source: string): NamedImport[] {
  const imports: NamedImport[] = []
  for (const match of source.matchAll(/import\s*{([^}]*)}\s*from\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[2]!
    for (const entry of match[1]!.split(',')) {
      const [imported, local = imported] = entry.trim().split(/\s+as\s+/)
      if (imported) imports.push({ imported, local: local!, specifier })
    }
  }
  return imports
}

function availableRoleName(
  imports: readonly NamedImport[],
  className: string,
  role: GeneratorRole,
): string {
  const used = new Set(imports.map((binding) => binding.local))
  if (!used.has(className)) return className
  const base = `${className}${pascal(role)}`
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base}${suffix++}`
  return candidate
}

function generatorRole(command: string): GeneratorRole | undefined {
  const value = command.startsWith('make:') ? command.slice(5) : ''
  return [
    'model',
    'action',
    'query',
    'route',
    'event',
    'listener',
    'signal',
    'signal-handler',
    'observer',
    'job',
    'schedule',
    'policy',
    'permission-source',
    'config',
    'provider',
    'service',
    'command',
  ].includes(value)
    ? (value as GeneratorRole)
    : undefined
}

function inspectionField(command: string): InspectionSurface | undefined {
  return (
    {
      'event:list': 'events',
      'listener:list': 'listeners',
      'observer:list': 'observers',
      'job:list': 'jobs',
      'schedule:list': 'schedules',
      'permission-source:list': 'permissionSources',
      'policy:list': 'policies',
      'command:list': 'commands',
    } as Record<string, InspectionSurface>
  )[command]
}

function jsonOutput(args: readonly string[], command: string): boolean {
  for (const argument of args) {
    if (argument !== '--json')
      throw new PraxisCommandError(`Unknown ${command} option ${argument}.`)
  }
  return args.includes('--json')
}

function formatInspection(field: string, entry: Record<string, unknown>): string {
  if (field === 'events')
    return `${String(entry.id)} ${String(entry.dispatch)} broadcast=${String(entry.broadcast)}`
  if (field === 'listeners')
    return `${String(entry.id)} <- ${String(entry.eventId)} ${String(entry.delivery)} ${String(entry.access)}`
  if (field === 'observers')
    return `${String(entry.id)} <- ${String(entry.modelId)} ${(entry.phases as unknown[]).join(',')}`
  if (field === 'jobs')
    return `${String(entry.id)} retries=${String(entry.retries)} timeout=${String(entry.timeout)} access=${String(entry.access)}`
  if (field === 'schedules')
    return `${String(entry.id)} -> ${String(entry.jobId)} ${JSON.stringify(entry.cadence)}`
  if (field === 'permissionSources')
    return `${String(entry.id)} ${(entry.abilities as unknown[]).join(',')}`
  if (field === 'policies') return `${String(entry.id)} ${(entry.abilities as unknown[]).join(',')}`
  return `${String(entry.command)} ${String(entry.access)} ${String(entry.description)}`
}

async function makeMigration(cwd: string, rawName: string): Promise<string> {
  const now = new Date()
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('')
  const directory = path.join(cwd, 'migrations')
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, `${timestamp}_${kebab(rawName)}.sql`)
  await writeNew(file, `-- ${rawName}\n-- Write a forward-only, production-safe migration.\n`)
  return file
}

async function makeTest(cwd: string, target: Target): Promise<string> {
  const name = pascal(target.name)
  const directory = path.join(cwd, 'tests', target.feature)
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, `${kebab(name)}.test.ts`)
  await writeNew(
    file,
    `import { describe, expect, it } from 'vitest'\n\ndescribe('${name}', () => {\n  it('works', () => {\n    expect(true).toBe(true)\n  })\n})\n`,
  )
  return file
}

function parseTarget(value: string): Target {
  const parts = value.split('/').filter(Boolean)
  if (parts.length !== 2) throw new PraxisCommandError('Generator target must be Feature/Name.')
  return { feature: kebab(parts[0]!), name: parts[1]! }
}

function parseAccess(arguments_: readonly string[]): string {
  if (arguments_.includes('--public')) return 'public'
  const ability = arguments_.find((argument) => argument.startsWith('--ability='))?.slice(10)
  if (ability) return ability
  throw new PraxisCommandError(
    'Framework entry roles require --public or --ability=<stable ability>.',
  )
}

function parseRouteAccess(arguments_: readonly string[]): string {
  if (arguments_.includes('--public'))
    throw new PraxisCommandError(
      'Routes are public by default; omit --public or use --ability=<stable ability>.',
    )
  const abilityArgument = arguments_.find((argument) => argument.startsWith('--ability='))
  if (abilityArgument === undefined) return 'public'
  return required(abilityArgument.slice(10), '--ability requires a stable ability name.')
}

async function writeNew(file: string, content: string): Promise<void> {
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new PraxisCommandError(`${file} already exists.`)
    throw error
  }
}
