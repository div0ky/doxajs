import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { runPraxis } from '@doxajs/praxis'
import type { DoxaApplication } from '@doxajs/core'
import {
  DoxaTestHarness,
  FakeMailTransport,
  FakeQueueManager,
  FakeSmsTransport,
  MemoryCache,
  MemoryTransactionManager,
} from '@doxajs/testing'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
const workspace = path.resolve(import.meta.dirname, '..')

describe('Praxis command suite', () => {
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('shows help from every command position without running generators', async () => {
    const root = await temporaryDirectory()
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    }

    const requests = [
      ['--help'],
      ['-h'],
      ['help'],
      ['make:migration', '--help'],
      ['make:model', '--help'],
      ['make:model', 'Accounts/User', '--help'],
      ['new', 'Example', '-h'],
      ['build', '--help'],
      ['migrate', '-h'],
      ['upgrade', '--help'],
      ['accounts:sync', '--help'],
    ]
    for (const arguments_ of requests) expect(await runPraxis(arguments_, root, io)).toBe(0)

    expect(output).toHaveLength(requests.length)
    expect(output.every((message) => message.includes('Usage: doxa <command>'))).toBe(true)
    expect(errors).toEqual([])
    expect(await fileExists(path.join(root, 'migrations'))).toBe(false)
    expect(await fileExists(path.join(root, 'src'))).toBe(false)
    expect(await fileExists(path.join(root, 'example'))).toBe(false)
    expect(await fileExists(path.join(root, '.doxa'))).toBe(false)
  })

  it('generates a Feature and registers generated model and action declarations', async () => {
    const root = await temporaryDirectory()
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    }

    expect(await runPraxis(['make:feature', 'Accounts'], root, io)).toBe(0)
    expect(await runPraxis(['make:model', 'Accounts/User'], root, io)).toBe(0)
    expect(
      await runPraxis(
        ['make:action', 'Accounts/RegisterUser', '--ability=accounts.register'],
        root,
        io,
      ),
    ).toBe(0)

    const feature = await readFile(
      path.join(root, 'src/features/accounts/accounts.feature.ts'),
      'utf8',
    )
    expect(feature).toContain("import { User } from './models/user.js'")
    expect(feature).toContain("import { RegisterUser } from './actions/register-user.js'")
    expect(feature).toContain('models = [User]')
    expect(feature).toContain('actions = [RegisterUser]')
    expect(
      await readFile(path.join(root, 'src/features/accounts/actions/register-user.ts'), 'utf8'),
    ).toContain("static override readonly access = 'accounts.register'")
    expect(errors).toEqual([])
  })

  it('generates App roles beside the Feature created by doxa new', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'example')
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    }

    expect(await runPraxis(['new', 'Example', `--directory=${destination}`], root, io)).toBe(0)
    expect(await runPraxis(['make:model', 'App/Contact'], destination, io)).toBe(0)
    expect(
      await runPraxis(['make:service', 'App/ApplicationAccess', '--provide'], destination, io),
    ).toBe(0)
    expect(
      await runPraxis(
        ['make:permission-source', 'App/ApplicationPermissions', '--abilities=contact.read'],
        destination,
        io,
      ),
    ).toBe(0)
    expect(await fileExists(path.join(destination, 'src/app/models/contact.ts'))).toBe(true)
    const feature = await readFile(path.join(destination, 'src/app/app.feature.ts'), 'utf8')
    expect(feature).toContain('models = [Contact]')
    expect(feature).toContain('provides = [ApplicationAccess]')
    expect(feature).toContain('permissionSources = [ApplicationPermissions]')

    await symlink(path.join(workspace, 'node_modules'), path.join(destination, 'node_modules'))
    expect(await runPraxis(['build'], destination, io)).toBe(0)
    expect(await runPraxis(['permission-source:list', '--json'], destination, io)).toBe(0)
    expect(JSON.parse(output.at(-1)!)).toEqual({
      items: [
        expect.objectContaining({
          id: 'permission-source:app/application-permissions',
          abilities: ['contact.read'],
        }),
      ],
      total: 1,
      truncated: false,
    })
    expect(errors).toEqual([])
  })

  it('pluralizes queries and permits same-named classes in different roles', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'example')
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    }

    expect(await runPraxis(['new', 'Example', `--directory=${destination}`], root, io)).toBe(0)
    expect(await runPraxis(['make:feature', 'Crm'], destination, io)).toBe(0)
    expect(await runPraxis(['make:query', 'Crm/CurrentUser', '--public'], destination, io)).toBe(0)
    expect(
      await runPraxis(['make:route', 'Crm/CurrentUser', '--path=/current-user'], destination, io),
    ).toBe(0)

    const feature = await readFile(
      path.join(destination, 'src/features/crm/crm.feature.ts'),
      'utf8',
    )
    expect(feature).toContain("import { CurrentUser } from './queries/current-user.js'")
    expect(feature).toContain(
      "import { CurrentUser as CurrentUserRoute } from './http/current-user.js'",
    )
    expect(feature).toContain('queries = [CurrentUser]')
    expect(feature).toContain('routes = [CurrentUserRoute]')
    expect(
      await fileExists(path.join(destination, 'src/features/crm/querys/current-user.ts')),
    ).toBe(false)

    await symlink(path.join(workspace, 'node_modules'), path.join(destination, 'node_modules'))
    expect(await runPraxis(['graph'], destination, io)).toBe(0)
    expect(output).toContainEqual(expect.stringMatching(/^queries\s+1$/))
    expect(errors).toEqual([])
  })

  it('removes a generated role file when Feature registration fails', async () => {
    const root = await temporaryDirectory()
    const featureDirectory = path.join(root, 'src/features/accounts')
    await mkdir(featureDirectory, { recursive: true })
    await writeFile(
      path.join(featureDirectory, 'accounts.feature.ts'),
      `import { Feature } from '@doxajs/core'\n\nimport { Contact } from './models/contact.js'\n\nexport class AccountsFeature extends Feature {\n  id = 'accounts'\n  models = [Contact]\n}\n`,
    )
    const errors: string[] = []

    expect(
      await runPraxis(['make:model', 'Accounts/Contact'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors).toEqual(['Contact is already registered.'])
    expect(await fileExists(path.join(featureDirectory, 'models/contact.ts'))).toBe(false)
  })

  it('fails closed when an operation generator omits its authorization posture', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    await runPraxis(['make:feature', 'Accounts'], root, {
      out: () => undefined,
      error: () => undefined,
    })
    expect(
      await runPraxis(['make:action', 'Accounts/RegisterUser'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors).toEqual([
      'Framework entry roles require --public or --ability=<stable ability>.',
    ])
  })

  it('generates public GET routes by default with optional method and ability overrides', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    const io = {
      out: () => undefined,
      error: (message: string) => errors.push(message),
    }
    await runPraxis(['make:feature', 'Accounts'], root, io)

    expect(
      await runPraxis(['make:route', 'Accounts/ListAccounts', '--path=/accounts'], root, io),
    ).toBe(0)
    const publicRoute = await readFile(
      path.join(root, 'src/features/accounts/http/list-accounts.ts'),
      'utf8',
    )
    expect(publicRoute).toContain("static override readonly access = 'public'")
    expect(publicRoute).toContain("readonly method = 'GET'")

    expect(
      await runPraxis(
        [
          'make:route',
          'Accounts/CreateAccount',
          '--path=/accounts',
          '--method=POST',
          '--ability=accounts.create',
        ],
        root,
        io,
      ),
    ).toBe(0)
    const protectedRoute = await readFile(
      path.join(root, 'src/features/accounts/http/create-account.ts'),
      'utf8',
    )
    expect(protectedRoute).toContain("static override readonly access = 'accounts.create'")
    expect(protectedRoute).toContain("readonly method = 'POST'")
    expect(errors).toEqual([])
  })

  it('rejects the removed --public route option', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    await runPraxis(['make:feature', 'Accounts'], root, {
      out: () => undefined,
      error: () => undefined,
    })

    expect(
      await runPraxis(
        ['make:route', 'Accounts/ListAccounts', '--path=/accounts', '--public'],
        root,
        {
          out: () => undefined,
          error: (message) => errors.push(message),
        },
      ),
    ).toBe(1)
    expect(errors).toEqual([
      'Routes are public by default; omit --public or use --ability=<stable ability>.',
    ])
  })

  it('rejects malformed MCP application directory options before startup', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    const io = {
      out: () => undefined,
      error: (message: string) => errors.push(message),
    }

    expect(await runPraxis(['mcp', '--cwd='], root, io)).toBe(1)
    expect(await runPraxis(['mcp', '--cwd=apps/demo', '--unexpected'], root, io)).toBe(1)
    expect(errors).toEqual([
      'MCP application cwd cannot be empty.',
      'Unknown mcp option --unexpected.',
    ])
  })

  it('launches pinned Drizzle Studio through db:studio without exposing credentials in arguments', async () => {
    const root = await temporaryDirectory()
    const connectionString = 'postgresql://doxa:private-password@127.0.0.1:54329/doxa'
    await writeFile(path.join(root, '.env'), `DATABASE_CONNECTION_STRING=${connectionString}\n`)
    const output: string[] = []
    const invocations: Array<{
      command: string
      arguments_: readonly string[]
      cwd: string
      environment: NodeJS.ProcessEnv
    }> = []

    expect(
      await runPraxis(['db:studio', '--host=127.0.0.1', '--port=5099', '--verbose'], root, {
        out: (message) => output.push(message),
        error: (message) => {
          throw new Error(message)
        },
        run: (command, arguments_, cwd, environment) => {
          invocations.push({ command, arguments_, cwd, environment })
          return Promise.resolve(0)
        },
      }),
    ).toBe(0)

    const studioDirectory = path.join(root, '.doxa/drizzle-studio')
    expect(invocations[0]).toEqual(
      expect.objectContaining({
        command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        arguments_: ['--config.node-linker=hoisted', 'install'],
        cwd: studioDirectory,
      }),
    )
    expect(invocations[0]?.environment.DATABASE_CONNECTION_STRING).toBeUndefined()
    expect(invocations[1]).toEqual(
      expect.objectContaining({
        command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        cwd: studioDirectory,
        environment: expect.objectContaining({ DATABASE_CONNECTION_STRING: connectionString }),
      }),
    )
    expect(invocations[1]?.arguments_).toEqual([
      'exec',
      'drizzle-kit',
      'studio',
      `--config=${path.join(studioDirectory, 'drizzle.config.mjs')}`,
      '--host=127.0.0.1',
      '--port=5099',
      '--verbose',
    ])
    expect(invocations[1]?.arguments_.join(' ')).not.toContain('private-password')
    expect(JSON.parse(await readFile(path.join(studioDirectory, 'package.json'), 'utf8'))).toEqual({
      private: true,
      dependencies: {
        'drizzle-kit': '0.31.10',
        'drizzle-orm': '0.45.2',
        pg: '8.22.0',
      },
    })
    expect(await readFile(path.join(studioDirectory, 'pnpm-workspace.yaml'), 'utf8')).toBe(
      `packages:\n  - .\n\nallowBuilds:\n  esbuild: true\n`,
    )
    expect(await readFile(path.join(studioDirectory, 'drizzle.config.mjs'), 'utf8')).toContain(
      'process.env.DATABASE_CONNECTION_STRING',
    )
    expect(output).toEqual(['Starting Drizzle Studio for Doxa (proxy 127.0.0.1:5099).'])
  })

  it('does not launch Drizzle Studio when its pinned tool installation fails', async () => {
    const root = await temporaryDirectory()
    await writeFile(
      path.join(root, '.env'),
      'DATABASE_CONNECTION_STRING=postgresql://doxa:doxa@127.0.0.1:54329/doxa\n',
    )
    const invocations: string[][] = []

    expect(
      await runPraxis(['db:studio'], root, {
        out: () => undefined,
        error: (message) => {
          throw new Error(message)
        },
        run: (_command, arguments_) => {
          invocations.push([...arguments_])
          return Promise.resolve(17)
        },
      }),
    ).toBe(17)
    expect(invocations).toEqual([['--config.node-linker=hoisted', 'install']])
  })

  it('rejects Theoria-only operator options on db:studio', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    expect(
      await runPraxis(['db:studio', '--operator=operator:aaron'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors).toEqual(['Unknown db:studio option --operator=operator:aaron.'])
  })

  it('generates and registers every canonical framework role', async () => {
    const root = await temporaryDirectory()
    const io = {
      out: () => undefined,
      error: (message: string) => {
        throw new Error(message)
      },
    }
    await runPraxis(['make:feature', 'Commerce'], root, io)
    const commands = [
      ['make:model', 'Commerce/Order'],
      [
        'make:event',
        'Commerce/OrderPlaced',
        '--model=Order',
        '--broadcast',
        '--channel=orders',
        '--private',
      ],
      [
        'make:listener',
        'Commerce/NotifyWarehouse',
        '--event=OrderPlaced',
        '--queued-after-commit',
        '--public',
      ],
      ['make:signal', 'Commerce/OrderTouched'],
      ['make:signal-handler', 'Commerce/RecordOrderTouched', '--signal=OrderTouched', '--public'],
      ['make:observer', 'Commerce/OrderObserver', '--model=Order'],
      ['make:job', 'Commerce/ShipOrder', '--ability=orders.ship'],
      [
        'make:realtime-command',
        'Commerce/TouchOrder',
        '--ability=orders.view',
        '--id=commerce.touch-order',
        '--limit=8',
        '--window-ms=1000',
        '--timeout-ms=750',
      ],
      [
        'make:schedule',
        'Commerce/ShipPendingOrders',
        '--job=ShipOrder',
        '--every=60',
        '--misfire=catch-up-once',
        '--public',
      ],
      ['make:policy', 'Commerce/OrderPolicy', '--abilities=orders.view,orders.ship'],
      [
        'make:permission-source',
        'Commerce/ApplicationPermissions',
        '--abilities=orders.view,orders.ship',
      ],
      [
        'make:route',
        'Commerce/ListOrdersRoute',
        '--method=GET',
        '--path=/orders',
        '--ability=orders.view',
      ],
      ['make:config', 'Commerce/CommerceConfig'],
      ['make:provider', 'Commerce/WarehouseProvider'],
      ['make:service', 'Commerce/CalculateOrderTotal', '--provide'],
      [
        'make:command',
        'Commerce/RebuildProjections',
        '--name=commerce:rebuild-projections',
        '--public',
      ],
    ]
    for (const command of commands) expect(await runPraxis(command, root, io)).toBe(0)
    const feature = await readFile(
      path.join(root, 'src/features/commerce/commerce.feature.ts'),
      'utf8',
    )
    for (const field of [
      'models',
      'events',
      'listeners',
      'signals',
      'signalHandlers',
      'observers',
      'jobs',
      'realtimeCommands',
      'schedules',
      'policies',
      'permissionSources',
      'routes',
      'configs',
      'providers',
      'provides',
      'commands',
    ]) {
      expect(feature).toContain(`${field} = [`)
    }
    expect(feature).not.toContain('services =')
    expect(
      await readFile(path.join(root, 'src/features/commerce/events/order-placed.ts'), 'utf8'),
    ).toContain('implements ShouldBroadcast')
    expect(
      await readFile(path.join(root, 'src/features/commerce/events/order-placed.ts'), 'utf8'),
    ).toContain('static override readonly model = Order')
    expect(
      await readFile(
        path.join(root, 'src/features/commerce/listeners/notify-warehouse.ts'),
        'utf8',
      ),
    ).toContain('implements ShouldQueueAfterCommit')
    expect(
      await readFile(
        path.join(root, 'src/features/commerce/schedules/ship-pending-orders.ts'),
        'utf8',
      ),
    ).toContain('everySeconds = 60')
    expect(
      await readFile(
        path.join(root, 'src/features/commerce/schedules/ship-pending-orders.ts'),
        'utf8',
      ),
    ).toContain("misfire = 'catch-up-once'")
    const realtimeCommand = await readFile(
      path.join(root, 'src/features/commerce/realtime-commands/touch-order.ts'),
      'utf8',
    )
    expect(realtimeCommand).toContain("id = 'commerce.touch-order'")
    expect(realtimeCommand).toContain('throttle = { limit: 8, windowMs: 1000 }')
    expect(realtimeCommand).toContain('timeoutMs = 750')
    expect(
      await readFile(path.join(root, 'src/features/commerce/policies/order-policy.ts'), 'utf8'),
    ).toContain('orders.ship')
    expect(
      await readFile(
        path.join(root, 'src/features/commerce/permission-sources/application-permissions.ts'),
        'utf8',
      ),
    ).toContain('extends PermissionSource')
  })

  it('registers new Features in an existing Application and creates migrations and tests', async () => {
    const root = await temporaryDirectory()
    await writeFile(
      path.join(root, 'app.config.ts'),
      "import { DoxaApplication } from '@doxajs/core'\n\nexport class Application extends DoxaApplication {\n  id = 'fixture'\n  features = []\n  plugins = []\n}\n",
    )
    const io = {
      out: () => undefined,
      error: (message: string) => {
        throw new Error(message)
      },
    }
    expect(await runPraxis(['make:feature', 'Accounts'], root, io)).toBe(0)
    expect(await readFile(path.join(root, 'app.config.ts'), 'utf8')).toContain(
      'features = [AccountsFeature]',
    )
    expect(await runPraxis(['make:migration', 'create orders'], root, io)).toBe(0)
    expect(await runPraxis(['make:test', 'Accounts/RegisterUser'], root, io)).toBe(0)
    expect(
      await readFile(path.join(root, 'tests/accounts/register-user.test.ts'), 'utf8'),
    ).toContain("describe('RegisterUser'")
  })

  it('creates an opinionated runnable application skeleton in a clean directory', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'garden')
    const output: string[] = []
    const errors: string[] = []
    expect(
      await runPraxis(['new', 'Garden', `--directory=${destination}`], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    const application = await readFile(path.join(destination, 'app.config.ts'), 'utf8')
    const feature = await readFile(path.join(destination, 'src/app/app.feature.ts'), 'utf8')
    expect(application).toContain("id = 'garden'")
    expect(application).toContain('features = [AppFeature]')
    expect(application).toContain('plugins = [] as const')
    expect(feature).toContain('routes = [HomeRoute]')
    expect(feature).not.toContain('HealthRoute')
    expect(JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8'))).toEqual(
      expect.objectContaining({
        packageManager: 'pnpm@11.18.0',
        scripts: expect.objectContaining({
          dev: 'doxa dev',
          start: 'doxa serve',
          background: 'doxa work',
          work: 'doxa work',
          schedule: 'doxa schedule',
          'db:studio': 'doxa db:studio',
        }),
        engines: { node: '>=24.7 <25' },
      }),
    )
    expect(await readFile(path.join(destination, 'pnpm-workspace.yaml'), 'utf8')).toBe(
      `packages:\n  - .\n\nallowBuilds:\n  esbuild: true\n`,
    )
    expect(await readFile(path.join(destination, '.codex/config.toml'), 'utf8')).toBe(
      `[mcp_servers.gnosis]\ncommand = "node"\nargs = ["./node_modules/@doxajs/praxis/dist/bin.js","mcp"]\nstartup_timeout_sec = 120\n`,
    )
    const agents = await readFile(path.join(destination, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('<doxa-gnosis-guidelines>')
    expect(agents).toContain('Call `application_info` and `get_programming_model`')
    expect(agents).toContain(
      'If Gnosis is unavailable or version-mismatched, stop Doxa-specific structural and architectural changes.',
    )
    expect(agents).toContain('Never dispatch an Action from an Action, Query, or Job')
    expect(agents).toContain('Use `Feature.provides` to export ordinary services')
    expect(agents).toContain('Use `query_models` instead of raw SQL')
    expect(JSON.parse(await readFile(path.join(destination, '.mcp.json'), 'utf8'))).toEqual({
      mcpServers: {
        gnosis: {
          command: 'node',
          args: ['./node_modules/@doxajs/praxis/dist/bin.js', 'mcp'],
          env: {},
        },
      },
    })
    expect(JSON.parse(await readFile(path.join(destination, '.cursor/mcp.json'), 'utf8'))).toEqual({
      mcpServers: {
        gnosis: {
          command: 'node',
          args: ['./node_modules/@doxajs/praxis/dist/bin.js', 'mcp'],
          env: {},
        },
      },
    })
    expect(JSON.parse(await readFile(path.join(destination, '.vscode/mcp.json'), 'utf8'))).toEqual({
      servers: {
        gnosis: {
          type: 'stdio',
          command: 'node',
          args: ['./node_modules/@doxajs/praxis/dist/bin.js', 'mcp'],
          cwd: '${workspaceFolder}',
        },
      },
    })
    const dockerfile = await readFile(path.join(destination, 'Dockerfile'), 'utf8')
    expect(dockerfile).toContain('FROM node:${NODE_VERSION}-bookworm-slim AS runtime')
    expect(dockerfile).toContain('RUN pnpm build')
    expect(dockerfile).toContain('RUN pnpm prune --prod')
    expect(dockerfile).toContain('USER node')
    expect(dockerfile).toContain('CMD ["doxa", "serve", "--host=0.0.0.0", "--port=3000"]')
    const productionCompose = await readFile(
      path.join(destination, 'compose.production.yaml'),
      'utf8',
    )
    expect(productionCompose).toContain('command: ["doxa", "work"]')
    expect(productionCompose).toContain('command: ["doxa", "migrate"]')
    expect(productionCompose).not.toContain('doxa schedule')
    expect(productionCompose).not.toContain('depends_on')
    expect(productionCompose).toContain('profiles: ["release"]')
    expect(await readFile(path.join(destination, '.dockerignore'), 'utf8')).toContain('.env.*')
    expect(await readFile(path.join(destination, '.env.example'), 'utf8')).toContain(
      'DATABASE_CONNECTION_STRING=',
    )
    expect(await fileExists(path.join(destination, 'src/accounts'))).toBe(false)
    expect(await fileExists(path.join(destination, 'src/infrastructure'))).toBe(false)
    expect(await fileExists(path.join(destination, 'src/tasks'))).toBe(false)
    expect(await fileExists(path.join(destination, 'src/app/http/health.route.ts'))).toBe(false)
    const generatedHome = await readFile(
      path.join(destination, 'src/app/http/home.route.ts'),
      'utf8',
    )
    expect(generatedHome).toContain('this.logger.info')
    expect(generatedHome).not.toContain('constructor(')
    await symlink(path.join(workspace, 'node_modules'), path.join(destination, 'node_modules'))
    expect(
      await runPraxis(['build'], destination, {
        out: (message) => output.push(message),
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    const generatedManifest = JSON.parse(
      await readFile(path.join(destination, '.doxa/manifest.json'), 'utf8'),
    ) as {
      applicationId: string
      buildHash: string
      plugins: Array<{ package: string }>
      features: Array<{ id: string }>
      providers: Array<{ id: string; capabilities: string[] }>
      routes: Array<{ id: string; path: string }>
    }
    expect(generatedManifest).toEqual(
      expect.objectContaining({ applicationId: 'garden', plugins: [] }),
    )
    expect(generatedManifest.features.map((entry) => entry.id)).toEqual(['app', 'doxa'])
    expect(generatedManifest.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'route:app/home', path: '/' }),
        expect.objectContaining({ id: 'route:doxa/health', path: '/health' }),
        expect.objectContaining({ id: 'route:doxa/login', path: '/auth/login' }),
      ]),
    )
    const listedRoutes: string[] = []
    expect(
      await runPraxis(['route:list'], destination, {
        out: (message) => listedRoutes.push(message),
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    expect(listedRoutes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/health'),
        expect.stringContaining('route:doxa/health'),
        expect.stringContaining('/auth/login'),
      ]),
    )
    const gnosis = JSON.parse(
      await readFile(path.join(destination, '.doxa/gnosis.json'), 'utf8'),
    ) as {
      schemaVersion: number
      deployment: Record<string, unknown>
      handbook: { schemaVersion: number; entries: Array<{ id: string }> }
      programmingModel: { title: string; rules: string[] }
    }
    expect(gnosis.schemaVersion).toBe(3)
    expect(gnosis.handbook).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        entries: expect.arrayContaining([
          expect.objectContaining({ id: 'concept.orchestration-consistency' }),
          expect.objectContaining({ id: 'role.service' }),
        ]),
      }),
    )
    expect(gnosis.programmingModel).toEqual(
      expect.objectContaining({
        title: 'Doxa Programming Model',
        rules: expect.arrayContaining([
          expect.stringContaining('service joins its caller’s execution and transaction'),
        ]),
      }),
    )
    expect(gnosis.deployment).toEqual(
      expect.objectContaining({
        strategy: 'one-immutable-image',
        roles: expect.objectContaining({
          web: expect.objectContaining({ command: 'doxa serve' }),
          background: expect.objectContaining({ command: 'doxa work', admitsSchedules: true }),
          migration: expect.objectContaining({ command: 'doxa migrate', automaticOnBoot: false }),
        }),
        advancedIsolation: {
          workerCommand: 'doxa work --without-scheduler',
          schedulerCommand: 'doxa schedule',
          useWhen: 'schedule admission requires independent resources or fault isolation',
        },
      }),
    )
    const manifest = generatedManifest
    const registry = (await import(
      `${pathToFileURL(path.join(destination, '.doxa/registry.mjs')).href}?buildHash=${manifest.buildHash}`
    )) as {
      constructors: Record<string, abstract new () => DoxaApplication>
    }
    const GeneratedApplication = registry.constructors['application:garden']!
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const harness = await DoxaTestHarness.boot(GeneratedApplication, {
      artifactsDirectory: path.join(destination, '.doxa'),
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'generated-memory-database' },
      authProviderId: 'provider:doxa/auth',
      providerOverrides: {
        'provider:doxa/transactions': transactions,
        'provider:doxa/queues': queue,
        'provider:doxa/cache': new MemoryCache(),
        'provider:doxa/mail': new FakeMailTransport(),
        'provider:doxa/sms': new FakeSmsTransport(),
      },
    })
    try {
      const health = await harness.request('http://doxa.test/health')
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ ok: true, data: { status: 'ok' } })
    } finally {
      await harness.shutdown()
    }
    expect(errors).toEqual([])
  })

  it('registers a generated monorepo application at the repository root', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'apps/doxaapp')
    await mkdir(path.join(root, '.git'))
    await writeFile(path.join(root, 'AGENTS.md'), '# Monorepo guidance\n')

    expect(
      await runPraxis(['new', 'Doxa App', `--directory=${destination}`], root, {
        out: () => undefined,
        error: (message) => {
          throw new Error(message)
        },
      }),
    ).toBe(0)

    expect(await fileExists(path.join(destination, '.codex/config.toml'))).toBe(false)
    expect(await fileExists(path.join(destination, '.cursor/mcp.json'))).toBe(false)
    expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toContain(
      '# Monorepo guidance\n\n<doxa-gnosis-guidelines>',
    )
    expect(await readFile(path.join(root, '.codex/config.toml'), 'utf8')).toContain(
      'args = ["./apps/doxaapp/node_modules/@doxajs/praxis/dist/bin.js","mcp","--cwd=apps/doxaapp"]',
    )
    expect(JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'))).toEqual({
      mcpServers: {
        gnosis: expect.objectContaining({
          command: 'node',
          args: [
            './apps/doxaapp/node_modules/@doxajs/praxis/dist/bin.js',
            'mcp',
            '--cwd=apps/doxaapp',
          ],
        }),
      },
    })
    expect(JSON.parse(await readFile(path.join(root, '.cursor/mcp.json'), 'utf8'))).toEqual({
      mcpServers: {
        gnosis: expect.objectContaining({
          command: 'node',
          args: [
            './apps/doxaapp/node_modules/@doxajs/praxis/dist/bin.js',
            'mcp',
            '--cwd=apps/doxaapp',
          ],
        }),
      },
    })
    expect(JSON.parse(await readFile(path.join(root, '.vscode/mcp.json'), 'utf8'))).toEqual({
      servers: {
        gnosis: expect.objectContaining({
          command: 'node',
          args: [
            './apps/doxaapp/node_modules/@doxajs/praxis/dist/bin.js',
            'mcp',
            '--cwd=apps/doxaapp',
          ],
          cwd: '${workspaceFolder}',
        }),
      },
    })

    expect(
      await runPraxis(['gnosis:install'], destination, {
        out: () => undefined,
        error: (message) => {
          throw new Error(message)
        },
      }),
    ).toBe(0)
    expect(await fileExists(path.join(destination, 'AGENTS.md'))).toBe(false)
  })

  it('installs selected Gnosis clients idempotently without replacing unrelated configuration', async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, '.codex'), { recursive: true })
    await writeFile(
      path.join(root, '.codex/config.toml'),
      `model = "gpt-example"\n\n[mcp_servers.existing]\ncommand = "existing-server"\n`,
    )
    await writeFile(
      path.join(root, '.mcp.json'),
      `${JSON.stringify({ mcpServers: { existing: { command: 'existing-server' } } }, null, 2)}\n`,
    )
    await writeFile(path.join(root, 'AGENTS.md'), '# Project instructions\n\nKeep this text.\n')
    const output: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => {
        throw new Error(message)
      },
    }

    expect(await runPraxis(['gnosis:install', '--agent=codex,claude'], root, io)).toBe(0)
    const codex = await readFile(path.join(root, '.codex/config.toml'), 'utf8')
    const claude = await readFile(path.join(root, '.mcp.json'), 'utf8')
    expect(codex).toContain('model = "gpt-example"')
    expect(codex).toContain('[mcp_servers.existing]')
    expect(codex.match(/\[mcp_servers\.gnosis\]/g)).toHaveLength(1)
    expect(codex).toContain('args = ["./node_modules/@doxajs/praxis/dist/bin.js","mcp"]')
    expect(codex).not.toContain('cwd = ')
    expect(JSON.parse(claude)).toEqual({
      mcpServers: {
        existing: { command: 'existing-server' },
        gnosis: {
          command: 'node',
          args: ['./node_modules/@doxajs/praxis/dist/bin.js', 'mcp'],
          env: {},
        },
      },
    })
    expect(await fileExists(path.join(root, '.cursor/mcp.json'))).toBe(false)
    expect(await fileExists(path.join(root, '.vscode/mcp.json'))).toBe(false)
    const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('# Project instructions\n\nKeep this text.')
    expect(agents.match(/<doxa-gnosis-guidelines>/g)).toHaveLength(1)
    expect(agents).toContain('Use `query_models` instead of raw SQL')
    expect(agents).toContain('stop Doxa-specific structural and architectural changes')

    expect(await runPraxis(['gnosis:install', '--agent=codex,claude'], root, io)).toBe(0)
    expect(await readFile(path.join(root, '.codex/config.toml'), 'utf8')).toBe(codex)
    expect(await readFile(path.join(root, '.mcp.json'), 'utf8')).toBe(claude)
    expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toBe(agents)
    expect(output.at(-1)).toContain(
      'Reload or reopen your MCP client, approve project trust if prompted, and start a new agent task.',
    )
    expect(output.at(-1)).toContain('Existing tasks do not acquire newly registered tools.')
    expect(output.at(-1)).toContain(
      'registration files alone do not prove that the server initialized.',
    )
  })

  it('fails Gnosis installation closed on malformed managed guidance', async () => {
    for (const original of [
      '# Project instructions\n\n<doxa-gnosis-guidelines>\nIncomplete block.\n',
      '</doxa-gnosis-guidelines>\nReversed block.\n<doxa-gnosis-guidelines>\n',
    ]) {
      const root = await temporaryDirectory()
      await writeFile(path.join(root, 'AGENTS.md'), original)
      const errors: string[] = []

      expect(
        await runPraxis(['gnosis:install', '--agent=codex'], root, {
          out: () => undefined,
          error: (message) => errors.push(message),
        }),
      ).toBe(1)
      expect(errors).toEqual([
        'AGENTS.md contains malformed or duplicate Doxa Gnosis guideline markers.',
      ])
      expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toBe(original)
      expect(await fileExists(path.join(root, '.codex/config.toml'))).toBe(false)
    }
  })

  it('installs and wires Theoria without manual package or Feature edits', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'garden')
    const messages: string[] = []
    const io = {
      out: (message: string) => messages.push(message),
      error: (message: string) => {
        throw new Error(message)
      },
    }
    expect(await runPraxis(['new', 'Garden', `--directory=${destination}`], root, io)).toBe(0)
    expect(await runPraxis(['add', 'theoria'], destination, io)).toBe(0)
    const packageJson = JSON.parse(
      await readFile(path.join(destination, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(packageJson.dependencies['@doxajs/theoria']).toBe(
      packageJson.dependencies['@doxajs/core'],
    )
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        theoria: 'doxa theoria',
        'theoria:prune': 'doxa theoria:prune',
      }),
    )
    expect(await readFile(path.join(destination, 'app.config.ts'), 'utf8')).toContain(
      "plugins = ['@doxajs/theoria']",
    )
    expect(await fileExists(path.join(destination, 'src/infrastructure'))).toBe(false)
    expect(messages.at(-1)).toContain('Run doxa migrate, then doxa theoria')
  })

  it('installs Keryx as a framework-owned core module and generates its provider', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'garden')
    const messages: string[] = []
    const io = {
      out: (message: string) => messages.push(message),
      error: (message: string) => {
        throw new Error(message)
      },
    }

    expect(await runPraxis(['new', 'Garden', `--directory=${destination}`], root, io)).toBe(0)
    expect(await runPraxis(['add', 'keryx'], destination, io)).toBe(0)

    const packageJson = JSON.parse(
      await readFile(path.join(destination, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    expect(packageJson.dependencies['@doxajs/keryx']).toBe(packageJson.dependencies['@doxajs/core'])
    expect(packageJson.dependencies['@doxajs/realtime']).toBe(
      packageJson.dependencies['@doxajs/core'],
    )

    const application = await readFile(path.join(destination, 'app.config.ts'), 'utf8')
    expect(application).toContain('broadcasting: { enabled: true }')
    expect(application).toContain('plugins = [] as const')
    const environment = await readFile(path.join(destination, '.env.example'), 'utf8')
    expect(environment).toContain('DOXA_KERYX_SECRET=')
    expect(environment).toContain('DOXA_KERYX_TOPOLOGY=single')
    expect(environment).toContain('# DOXA_KERYX_REDIS_URL=redis://127.0.0.1:6379')
    const compose = await readFile(path.join(destination, 'compose.production.yaml'), 'utf8')
    expect(compose).toContain('DOXA_KERYX_PUBLISH_URL: http://web:6001')
    expect(compose).toContain('"${KERYX_PORT:-6001}:6001"')
    expect(compose).toContain("fetch('http://127.0.0.1:6001/ready')")

    await symlink(path.join(workspace, 'node_modules'), path.join(destination, 'node_modules'))
    expect(await runPraxis(['build'], destination, io)).toBe(0)
    const framework = await readFile(path.join(destination, '.doxa/framework.ts'), 'utf8')
    expect(framework).toContain("import { Keryx } from '@doxajs/keryx'")
    expect(framework).toContain('export class ApplicationBroadcasting extends Keryx')
    expect(framework).toContain("static override readonly id = 'broadcasting'")
    expect(framework).toContain('export class BroadcastAuthorizeRoute extends Route')
    expect(framework).toContain("readonly path = '/broadcasting/authorize'")
    expect(framework).toContain('this.broadcasting.issueConnectionTicket')
    expect(messages.at(-1)).toContain('Built garden')
  })

  it('accepts an explicit Theoria operator option before enforcing non-loopback access', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    const previous = process.env.THEORIA_ACCESS_TOKEN
    delete process.env.THEORIA_ACCESS_TOKEN
    try {
      expect(
        await runPraxis(['theoria', '--host=0.0.0.0', '--operator=operator:aaron'], root, {
          out: () => undefined,
          error: (message) => errors.push(message),
        }),
      ).toBe(1)
      expect(errors).toEqual([
        'Non-loopback Theoria requires THEORIA_ACCESS_TOKEN with at least 32 characters.',
      ])
    } finally {
      if (previous === undefined) delete process.env.THEORIA_ACCESS_TOKEN
      else process.env.THEORIA_ACCESS_TOKEN = previous
    }
  })

  it('installs the first-party OpenTelemetry composition adapter', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'observed')
    const messages: string[] = []
    const io = {
      out: (message: string) => messages.push(message),
      error: (message: string) => {
        throw new Error(message)
      },
    }
    expect(await runPraxis(['new', 'Observed', `--directory=${destination}`], root, io)).toBe(0)
    expect(await runPraxis(['add', 'opentelemetry'], destination, io)).toBe(0)
    const packageJson = JSON.parse(
      await readFile(path.join(destination, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    expect(packageJson.dependencies['@doxajs/opentelemetry']).toBe(
      packageJson.dependencies['@doxajs/core'],
    )
    expect(await readFile(path.join(destination, 'app.config.ts'), 'utf8')).toContain(
      "plugins = ['@doxajs/opentelemetry'] as const",
    )
    expect(messages.at(-1)).toContain('Installed opentelemetry')
  })

  it('fails production roles closed when prebuilt artifacts are absent', async () => {
    const root = await temporaryDirectory()
    const errors: string[] = []
    expect(
      await runPraxis(['work'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors).toEqual([
      expect.stringContaining('Prebuilt Doxa artifacts are missing or invalid. Run doxa build'),
    ])
  })

  it('plans a framework-aligned upgrade without changing a dirty application during a dry run', async () => {
    const root = await temporaryDirectory()
    const original = `${JSON.stringify(upgradeFixturePackage(), null, 2)}\n`
    await writeFile(path.join(root, 'package.json'), original)
    const output: string[] = []
    const runs: string[] = []

    expect(
      await runPraxis(['upgrade', '--to=alpha', '--dry-run'], root, {
        out: (message) => output.push(message),
        error: (message) => {
          throw new Error(message)
        },
        run: (command, args) => {
          runs.push([command, ...args].join(' '))
          return Promise.resolve(0)
        },
        capture: (_command, args) =>
          Promise.resolve(
            args[0] === 'view'
              ? registryUpgradeTarget('0.1.0-alpha.5')
              : { code: 0, stdout: ' M package.json\n', stderr: '' },
          ),
      }),
    ).toBe(0)

    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(original)
    expect(runs).toEqual([])
    expect(output).toContain('Doxa upgrade plan: 0.1.0-alpha.4 -> 0.1.0-alpha.5')
    expect(output).toContain('Dry run only; no files were changed.')
  })

  it('reports same-version dependency normalization as alignment instead of an upgrade', async () => {
    const root = await temporaryDirectory()
    const packageJson = upgradeFixturePackage('0.1.0-alpha.5') as {
      packageManager: string
      engines: { node: string }
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    packageJson.packageManager = 'pnpm@11.18.0'
    packageJson.engines.node = '>=24.7 <25'
    packageJson.dependencies['@doxajs/core'] = '0.1.0-alpha.5'
    packageJson.devDependencies.typescript = '^6.0.0'
    await writeFile(path.join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
    const output: string[] = []
    const invocations: string[][] = []
    const registryQueries: string[][] = []

    expect(
      await runPraxis(['upgrade'], root, {
        out: (message) => output.push(message),
        error: (message) => {
          throw new Error(message)
        },
        run: (_command, args) => {
          invocations.push([...args])
          return Promise.resolve(0)
        },
        capture: (_command, args) => {
          if (args[0] === 'view') registryQueries.push([...args])
          return Promise.resolve(
            args[0] === 'view'
              ? registryUpgradeTarget('0.1.0-alpha.5')
              : { code: 0, stdout: '', stderr: '' },
          )
        },
      }),
    ).toBe(0)

    expect(output).toContain('Doxa is already on the latest release: 0.1.0-alpha.5.')
    expect(output).toContain('Doxa package and toolchain alignment plan:')
    expect(output).not.toContain('Doxa upgrade plan: 0.1.0-alpha.5 -> 0.1.0-alpha.5')
    expect(output).toContain('Aligning Doxa package and toolchain declarations with pnpm...')
    expect(output).toContain('Validating the alignment with the installed Praxis...')
    expect(registryQueries).toEqual([
      ['view', '@doxajs/praxis@latest', 'version', 'doxaCompatibility', '--json'],
    ])
    expect(invocations).toEqual([
      ['install'],
      ['exec', 'doxa', 'upgrade', '--continue', '--from=0.1.0-alpha.5', '--to=0.1.0-alpha.5'],
    ])
  })

  it('refuses a mutating upgrade in a dirty Git worktree', async () => {
    const root = await temporaryDirectory()
    await writeFile(
      path.join(root, 'package.json'),
      `${JSON.stringify(upgradeFixturePackage(), null, 2)}\n`,
    )
    const errors: string[] = []
    expect(
      await runPraxis(['upgrade', '--to=alpha'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
        run: () => Promise.resolve(0),
        capture: (_command, args) =>
          Promise.resolve(
            args[0] === 'view'
              ? registryUpgradeTarget('0.1.0-alpha.5')
              : { code: 0, stdout: ' M package.json\n', stderr: '' },
          ),
      }),
    ).toBe(1)
    expect(errors).toEqual([
      'Refusing to upgrade a dirty Git worktree. Commit or stash changes, or rerun with --force.',
    ])
  })

  it('aligns existing Doxa packages, installs them, and hands off to the upgraded Praxis', async () => {
    const root = await temporaryDirectory()
    await writeFile(
      path.join(root, 'package.json'),
      `${JSON.stringify(upgradeFixturePackage(), null, 2)}\n`,
    )
    const invocations: Array<{ command: string; args: readonly string[] }> = []
    expect(
      await runPraxis(['upgrade', '--to=0.1.0-alpha.5', '--verify'], root, {
        out: () => undefined,
        error: (message) => {
          throw new Error(message)
        },
        run: (command, args) => {
          invocations.push({ command, args })
          return Promise.resolve(0)
        },
        capture: (_command, args) =>
          Promise.resolve(
            args[0] === 'view'
              ? registryUpgradeTarget('0.1.0-alpha.5')
              : { code: 0, stdout: '', stderr: '' },
          ),
      }),
    ).toBe(0)
    const upgraded = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      packageManager: string
    }
    expect(upgraded.dependencies).toEqual({
      '@doxajs/core': '^0.1.0-alpha.5',
      '@doxajs/praxis': '^0.1.0-alpha.5',
      hono: '^4.0.0',
    })
    expect(upgraded.devDependencies).toEqual({
      '@doxajs/testing': '^0.1.0-alpha.5',
      typescript: '^6.0.0',
    })
    expect(upgraded.packageManager).toBe('pnpm@11.18.0')
    expect(invocations.map(({ args }) => args)).toEqual([
      ['install'],
      [
        'exec',
        'doxa',
        'upgrade',
        '--continue',
        '--from=0.1.0-alpha.4',
        '--to=0.1.0-alpha.5',
        '--verify',
      ],
    ])
  })

  it('restores package.json when dependency installation fails', async () => {
    const root = await temporaryDirectory()
    const original = `${JSON.stringify(upgradeFixturePackage(), null, 2)}\n`
    await writeFile(path.join(root, 'package.json'), original)
    expect(
      await runPraxis(['upgrade', '--to=alpha'], root, {
        out: () => undefined,
        error: () => undefined,
        run: () => Promise.resolve(17),
        capture: (_command, args) =>
          Promise.resolve(
            args[0] === 'view'
              ? registryUpgradeTarget('0.1.0-alpha.5')
              : { code: 0, stdout: '', stderr: '' },
          ),
      }),
    ).toBe(1)
    expect(await readFile(path.join(root, 'package.json'), 'utf8')).toBe(original)
  })

  it('validates an installed upgrade with build, migration status, and optional tests', async () => {
    const root = await temporaryDirectory()
    const application = path.join(root, 'apps/doxaapp')
    await mkdir(path.join(root, '.git'))
    await mkdir(application, { recursive: true })
    const currentPraxis = JSON.parse(
      await readFile(path.join(workspace, 'packages/praxis/package.json'), 'utf8'),
    ) as { version: string }
    await writeFile(
      path.join(application, 'package.json'),
      `${JSON.stringify(upgradeFixturePackage(currentPraxis.version), null, 2)}\n`,
    )
    const invocations: string[][] = []
    const output: string[] = []
    expect(
      await runPraxis(
        [
          'upgrade',
          '--continue',
          '--from=0.1.0-alpha.0',
          `--to=${currentPraxis.version}`,
          '--verify',
        ],
        application,
        {
          out: (message) => output.push(message),
          error: (message) => {
            throw new Error(message)
          },
          run: (_command, args) => {
            invocations.push([...args])
            return Promise.resolve(0)
          },
        },
      ),
    ).toBe(0)
    expect(invocations).toEqual([
      ['exec', 'doxa', 'build'],
      ['exec', 'doxa', 'migrate:status'],
      ['test'],
    ])
    expect(await fileExists(path.join(root, '.codex/config.toml'))).toBe(true)
    expect(await fileExists(path.join(root, '.mcp.json'))).toBe(true)
    expect(await fileExists(path.join(root, '.cursor/mcp.json'))).toBe(true)
    expect(await fileExists(path.join(root, '.vscode/mcp.json'))).toBe(true)
    expect(await fileExists(path.join(application, '.codex/config.toml'))).toBe(false)
    expect(await readFile(path.join(root, '.codex/config.toml'), 'utf8')).toContain(
      'args = ["./apps/doxaapp/node_modules/@doxajs/praxis/dist/bin.js","mcp","--cwd=apps/doxaapp"]',
    )
    expect(output).toContainEqual(
      expect.stringContaining(
        'Reload or reopen your MCP client, approve project trust if prompted, and start a new agent task.',
      ),
    )
    expect(output).toContainEqual(
      expect.stringContaining('Existing tasks do not acquire newly registered tools.'),
    )
  })

  it('describes same-version continuation as validated alignment', async () => {
    const root = await temporaryDirectory()
    const currentPraxis = JSON.parse(
      await readFile(path.join(workspace, 'packages/praxis/package.json'), 'utf8'),
    ) as { version: string }
    await writeFile(
      path.join(root, 'package.json'),
      `${JSON.stringify(upgradeFixturePackage(currentPraxis.version), null, 2)}\n`,
    )
    const output: string[] = []

    expect(
      await runPraxis(
        [
          'upgrade',
          '--continue',
          `--from=${currentPraxis.version}`,
          `--to=${currentPraxis.version}`,
        ],
        root,
        {
          out: (message) => output.push(message),
          error: (message) => {
            throw new Error(message)
          },
          run: () => Promise.resolve(0),
        },
      ),
    ).toBe(0)

    expect(output).toContain(
      'Checking forward migration status (read-only; "applied" means already recorded)...',
    )
    expect(output.at(-1)).toBe(
      `Doxa was already on ${currentPraxis.version}. Package and toolchain declarations are aligned and the application passed validation. Review and commit the package and lockfile changes.`,
    )
  })

  it('migrates a pre-alpha.7 scaffold to the framework-owned application core before validation', async () => {
    const root = await temporaryDirectory()
    const currentPraxis = JSON.parse(
      await readFile(path.join(workspace, 'packages/praxis/package.json'), 'utf8'),
    ) as { version: string }
    const packageJson = upgradeFixturePackage(currentPraxis.version) as {
      type?: string
      dependencies: Record<string, string>
    }
    packageJson.type = 'module'
    packageJson.dependencies['@doxajs/theoria'] = `^${currentPraxis.version}`
    await writeFile(path.join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
    await mkdir(path.join(root, 'src/app/http'), { recursive: true })
    await mkdir(path.join(root, 'src/accounts'), { recursive: true })
    await mkdir(path.join(root, 'src/infrastructure'), { recursive: true })
    await mkdir(path.join(root, 'src/tasks'), { recursive: true })
    await writeFile(
      path.join(root, 'src/application.ts'),
      `import { DoxaApplication } from '@doxajs/core'

import { AccountsFeature } from './accounts/accounts.feature.js'
import { AppFeature } from './app/app.feature.js'
import { InfrastructureFeature } from './infrastructure/infrastructure.feature.js'
import { TasksFeature } from './tasks/tasks.feature.js'

export class Application extends DoxaApplication {
  id = 'legacy-garden'
  features = [InfrastructureFeature, AccountsFeature, TasksFeature, AppFeature]
}
`,
    )
    for (const [directory, name] of [
      ['accounts', 'Accounts'],
      ['infrastructure', 'Infrastructure'],
      ['tasks', 'Tasks'],
    ] as const) {
      await writeFile(
        path.join(root, `src/${directory}/${directory}.feature.ts`),
        `import { Feature } from '@doxajs/core'\n\nexport class ${name}Feature extends Feature {\n  id = '${directory}'\n}\n`,
      )
    }
    await writeFile(
      path.join(root, 'src/app/app.feature.ts'),
      `import { Feature } from '@doxajs/core'
import { HealthRoute } from './http/health.route.js'
import { HomeRoute } from './http/home.route.js'

export class AppFeature extends Feature {
  id = 'app'
  routes = [HomeRoute, HealthRoute]
}
`,
    )
    await writeFile(
      path.join(root, 'src/app/http/home.route.ts'),
      `import { type HttpRequest, Route } from '@doxajs/core'\n\nexport class HomeRoute extends Route {\n  static override readonly id = 'home'\n  static override readonly access = 'public'\n  readonly method = 'GET'\n  readonly path = '/'\n  handle(_request: HttpRequest) { return { application: 'legacy-garden' } }\n}\n`,
    )
    await writeFile(
      path.join(root, 'src/app/http/health.route.ts'),
      `import { type HttpRequest, Route } from '@doxajs/core'\n\nexport class HealthRoute extends Route {\n  static override readonly id = 'health'\n  static override readonly access = 'public'\n  readonly method = 'GET'\n  readonly path = '/health'\n  handle(_request: HttpRequest) { return { status: 'ok' } }\n}\n`,
    )
    await writeFile(
      path.join(root, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2024',
            lib: ['ES2024'],
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            types: ['node'],
            strict: true,
            rootDir: 'src',
            outDir: 'dist',
            skipLibCheck: true,
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      )}\n`,
    )

    const output: string[] = []
    expect(
      await runPraxis(
        [
          'upgrade',
          '--continue',
          '--from=0.1.0-alpha.5',
          `--to=${currentPraxis.version}`,
          '--skip-migration-status',
        ],
        root,
        {
          out: (message) => output.push(message),
          error: (message) => {
            throw new Error(message)
          },
          run: () => Promise.resolve(0),
        },
      ),
    ).toBe(0)

    const application = await readFile(path.join(root, 'app.config.ts'), 'utf8')
    expect(application).toContain("from './src/app/app.feature.js'")
    expect(application).toContain("from './src/tasks/tasks.feature.js'")
    expect(application).toContain('features = [TasksFeature, AppFeature]')
    expect(application).toContain("plugins = ['@doxajs/theoria'] as const")
    expect(application).not.toContain('AccountsFeature')
    expect(application).not.toContain('InfrastructureFeature')
    expect(await readFile(path.join(root, 'src/application.ts'), 'utf8')).toContain(
      'InfrastructureFeature',
    )
    expect(await readFile(path.join(root, 'src/app/app.feature.ts'), 'utf8')).toContain(
      'routes = [HomeRoute]',
    )
    const tsconfig = JSON.parse(await readFile(path.join(root, 'tsconfig.json'), 'utf8')) as {
      compilerOptions: { rootDir: string }
      include: string[]
    }
    expect(tsconfig.compilerOptions.rootDir).toBe('.')
    expect(tsconfig.include).toEqual(['app.config.ts', 'src/**/*.ts', '.doxa/framework.ts'])
    expect(output).toContainEqual(expect.stringContaining('Applied framework-owned application'))

    await symlink(path.join(workspace, 'node_modules'), path.join(root, 'node_modules'))
    const buildErrors: string[] = []
    expect(
      await runPraxis(['build'], root, {
        out: () => undefined,
        error: (message) => buildErrors.push(message),
      }),
    ).toBe(0)
    const manifest = JSON.parse(await readFile(path.join(root, '.doxa/manifest.json'), 'utf8')) as {
      features: Array<{ id: string }>
      plugins: Array<{ package: string }>
    }
    expect(manifest.features.map(({ id }) => id)).toEqual(['app', 'doxa', 'tasks'])
    expect(manifest.plugins).toEqual([expect.objectContaining({ package: '@doxajs/theoria' })])
    expect(buildErrors).toEqual([])
  })

  it('installs optional plugins through package metadata and app.config.ts only', async () => {
    const root = await temporaryDirectory()
    const destination = path.join(root, 'garden')
    const errors: string[] = []
    expect(
      await runPraxis(['new', 'Garden', `--directory=${destination}`], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    expect(
      await runPraxis(['add', 'sendgrid'], destination, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    const packageJson = JSON.parse(
      await readFile(path.join(destination, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> }
    expect(packageJson.dependencies['@doxajs/sendgrid']).toBe(
      packageJson.dependencies['@doxajs/core'],
    )
    expect(await readFile(path.join(destination, 'app.config.ts'), 'utf8')).toContain(
      "plugins = ['@doxajs/sendgrid'] as const",
    )
    expect(await fileExists(path.join(destination, 'src/infrastructure'))).toBe(false)
    await symlink(path.join(workspace, 'node_modules'), path.join(destination, 'node_modules'))
    expect(
      await runPraxis(['build'], destination, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    const manifest = JSON.parse(
      await readFile(path.join(destination, '.doxa/manifest.json'), 'utf8'),
    ) as { plugins: Array<{ package: string }> }
    expect(manifest.plugins).toEqual([expect.objectContaining({ package: '@doxajs/sendgrid' })])
    expect(errors).toEqual([])
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'doxa-praxis-'))
  directories.push(directory)
  return directory
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

function upgradeFixturePackage(version = '0.1.0-alpha.4'): Record<string, unknown> {
  return {
    name: 'upgrade-fixture',
    private: true,
    packageManager: 'pnpm@10.0.0',
    engines: { node: '>=22' },
    dependencies: {
      '@doxajs/core': `^${version}`,
      '@doxajs/praxis': `^${version}`,
      hono: '^4.0.0',
    },
    devDependencies: {
      '@doxajs/testing': `^${version}`,
      typescript: '^5.0.0',
    },
  }
}

function registryUpgradeTarget(version: string): { code: number; stdout: string; stderr: string } {
  return {
    code: 0,
    stdout: JSON.stringify({
      version,
      doxaCompatibility: {
        schemaVersion: 1,
        channel: 'alpha',
        frameworkPackages: ['@doxajs/core', '@doxajs/praxis', '@doxajs/testing'],
        toolchain: {
          node: '>=24.7 <25',
          packageManager: 'pnpm@11.18.0',
          devDependencies: {
            '@types/node': '^24.0.0',
            typescript: '^6.0.0',
            vitest: '^4.0.0',
          },
        },
        upgradeRecipes: [],
      },
    }),
    stderr: '',
  }
}
