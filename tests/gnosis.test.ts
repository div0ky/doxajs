import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import {
  createGnosisKnowledge,
  createGnosisServer,
  handbookIndex,
  renderGnosisGuidelines,
  renderHandbookMarkdown,
  reviewArchitecture,
  searchDocumentation,
} from '@doxajs/gnosis'
import {
  IntrospectionError,
  applicationInfo,
  assertCurrentManifest,
  describeAuthentication,
  explainComponent,
  inspectArchitectureDiagnostics,
  inspectSurface,
  sanitizeInspectionValue,
} from '@doxajs/introspection'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { runPraxis } from '@doxajs/praxis'
import { canonicalJson, type DoxaManifest } from '../packages/manifest/dist/index.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const workspace = path.resolve(import.meta.dirname, '..')
const compilerVersion = packageVersion('compiler')
const gnosisVersion = packageVersion('gnosis')
const applicationRoot = path.join(workspace, 'examples/persistence-app')
let artifactsDirectory: string
let generatedApplication: string
let manifest: Awaited<ReturnType<typeof compileApplication>>['manifest']

describe('Gnosis read-only local engineering server', () => {
  beforeAll(async () => {
    artifactsDirectory = await mkdtemp(path.join(tmpdir(), 'doxa-gnosis-'))
    generatedApplication = path.join(artifactsDirectory, 'garden')
    const errors: string[] = []
    const code = await runPraxis(
      ['new', 'Garden', `--directory=${generatedApplication}`],
      workspace,
      { out: () => undefined, error: (message) => errors.push(message) },
    )
    if (code !== 0) throw new Error(errors.join('\n'))
    await symlink(
      path.join(workspace, 'node_modules'),
      path.join(generatedApplication, 'node_modules'),
    )
    ;({ manifest } = await compileApplication({
      tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
      applicationFile: path.join(applicationRoot, 'src/application.ts'),
      sourceRoot: path.join(applicationRoot, 'src'),
      outputRoot: path.join(applicationRoot, 'dist'),
      artifactsDirectory,
    }))
  })

  afterAll(async () => {
    await rm(artifactsDirectory, { recursive: true, force: true })
  })

  it('compiles model relationships into the canonical manifest', () => {
    expect(manifest.formatVersion).toBe(7)
    expect(manifest.frameworkVersion).toBe(compilerVersion)
    expect(manifest.models.find((model) => model.id.endsWith('/counter'))?.relationships).toEqual([
      {
        name: 'notes',
        kind: 'hasMany',
        relatedModelId: 'model:counters/counter-note',
        localKey: 'id',
        foreignKey: 'counterId',
      },
      {
        name: 'primaryNote',
        kind: 'hasOne',
        relatedModelId: 'model:counters/counter-note',
        localKey: 'id',
        foreignKey: 'counterId',
      },
      {
        name: 'tags',
        kind: 'belongsToMany',
        relatedModelId: 'model:counters/counter-tag',
        throughModelId: 'model:counters/counter-tag-assignment',
        localKey: 'id',
        relatedKey: 'id',
        foreignKey: 'counterId',
        relatedForeignKey: 'tagId',
      },
    ])
  })

  it('shares deterministic bounded facts and fails closed for stale manifests', () => {
    const routes = inspectSurface(manifest, 'routes')
    expect(routes.total).toBeGreaterThan(0)
    expect(routes.items.length).toBeLessThanOrEqual(100)
    expect(applicationInfo(manifest)).toEqual(
      expect.objectContaining({
        applicationId: 'persistence-reference-app',
        manifestFormatVersion: 7,
        frameworkVersion: compilerVersion,
      }),
    )

    expect(
      sanitizeInspectionValue({
        dependency: { token: 'doxa:transactions' },
        schedule: { token: 'plain-secret', authorization: 'Bearer top-secret' },
        database: 'postgres://doxa:password@localhost/doxa',
        queue: 'redis://doxa:password@localhost/0',
        assertion: 'eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZA.c2lnbmF0dXJl',
      }),
    ).toEqual({
      dependency: { token: 'doxa:transactions' },
      schedule: { token: '[REDACTED]', authorization: '[REDACTED]' },
      database: 'postgres://doxa:[REDACTED]@localhost/doxa',
      queue: 'redis://doxa:[REDACTED]@localhost/0',
      assertion: '[REDACTED]',
    })
    expect(
      Object.keys(
        sanitizeInspectionValue(
          Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field${index}`, index])),
        ) as object,
      ),
    ).toHaveLength(100)
    expect(describeAuthentication(manifest)).toEqual(
      expect.objectContaining({
        mode: 'doxa-owned',
        source: 'doxa-owned',
        hashers: ['doxa-argon2id'],
        credentialOwnership: 'doxa',
        credentialUpgrade: 'in-place',
        securityWarnings: [],
      }),
    )
    expect(
      sanitizeInspectionValue(
        'primary postgres://doxa:first@localhost/doxa fallback https://user:second@example.test/',
      ),
    ).toBe(
      'primary postgres://doxa:[REDACTED]@localhost/doxa fallback https://user:[REDACTED]@example.test/',
    )
    expect(
      sanitizeInspectionValue(
        `-----BEGIN PRIVATE KEY-----${'a'.repeat(25_000)}-----END PRIVATE KEY-----`,
      ),
    ).toBe('[REDACTED]')

    let staleError: unknown
    try {
      applicationInfo({ ...manifest, applicationId: 'tampered' })
    } catch (error) {
      staleError = error
    }
    expect(staleError).toBeInstanceOf(IntrospectionError)
    expect((staleError as IntrospectionError).code).toBe('stale_manifest')

    const mismatched = rehashManifest({
      ...manifest,
      frameworkVersion: '0.1.0-alpha.26',
    })
    expect(() => createGnosisKnowledge(mismatched)).toThrow(
      `Gnosis ${gnosisVersion} cannot guide Doxa 0.1.0-alpha.26`,
    )
  })

  it('returns the same structured route facts through Praxis JSON', async () => {
    const output: string[] = []
    const errors: string[] = []
    expect(
      await runPraxis(['route:list', '--json'], generatedApplication, {
        out: (message) => output.push(message),
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    expect(errors).toEqual([])
    const generatedManifest: unknown = JSON.parse(
      await readFile(path.join(generatedApplication, '.doxa/manifest.json'), 'utf8'),
    )
    assertCurrentManifest(generatedManifest)
    expect(JSON.parse(output.at(-1)!)).toEqual(inspectSurface(generatedManifest, 'routes'))
  })

  it('ships one complete role handbook and filters first-party module guidance from the manifest', async () => {
    const knowledge = createGnosisKnowledge(manifest)
    expect(knowledge).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        handbook: expect.objectContaining({ schemaVersion: 1 }),
        programmingModel: expect.objectContaining({ title: 'Doxa Programming Model' }),
      }),
    )
    expect(renderGnosisGuidelines()).toContain(
      'stop Doxa-specific structural and architectural changes',
    )
    const entries = handbookIndex(manifest.frameworkVersion)
    const roles = entries.filter((entry) => entry.kind === 'role')
    expect(roles.map((entry) => entry.role)).toEqual([
      'action',
      'application',
      'command',
      'configuration',
      'event',
      'feature',
      'job',
      'listener',
      'model',
      'observer',
      'permission-source',
      'policy',
      'provider',
      'query',
      'route',
      'schedule',
      'service',
      'signal',
      'signal-handler',
    ])
    for (const entry of roles) {
      expect(entry.details).toEqual(
        expect.objectContaining({
          purpose: expect.any(String),
          useWhen: expect.any(String),
          registration: expect.any(String),
          generator: expect.any(String),
          canonicalFolder: expect.any(String),
          invocation: expect.any(String),
          authorization: expect.any(String),
          transaction: expect.any(String),
          injection: expect.any(String),
          scope: expect.any(String),
          lifecycle: expect.any(String),
          dependencies: expect.any(String),
          rationale: expect.any(String),
          example: expect.any(String),
          antiPatterns: expect.any(Array),
          testing: expect.any(Array),
        }),
      )
    }
    for (const role of [
      'action',
      'command',
      'job',
      'listener',
      'permission-source',
      'policy',
      'query',
      'route',
      'service',
      'signal-handler',
    ] as const) {
      const lifecycle = roles.find((entry) => entry.role === role)?.details?.lifecycle
      expect(lifecycle).toContain('dispose')
      expect(lifecycle).toContain('start')
      expect(lifecycle).toContain('drain')
      expect(lifecycle).toContain('stop')
    }
    expect(
      roles
        .map((entry) => entry.details?.generator)
        .filter((generator): generator is string => generator !== undefined),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('doxa new'),
        expect.stringContaining('doxa make:feature'),
        expect.stringContaining('doxa make:action'),
        expect.stringContaining('doxa make:query'),
        expect.stringContaining('doxa make:route'),
        expect.stringContaining('doxa make:event'),
        expect.stringContaining('doxa make:listener'),
        expect.stringContaining('doxa make:job'),
        expect.stringContaining('doxa make:service'),
        expect.stringContaining('doxa make:provider'),
      ]),
    )
    expect(entries.find((entry) => entry.id === 'concept.capability-catalog')?.aliases).toEqual(
      expect.arrayContaining([
        'ExecutionScoped',
        'ShouldDispatchAfterCommit',
        'ShouldHandleEventsAfterCommit',
        'ShouldQueue',
        'ShouldQueueAfterCommit',
        'ShouldBroadcast',
        'ShouldBroadcastNow',
        'Starts',
        'Drains',
        'Stops',
        'Disposes',
      ]),
    )
    expect(entries.find((entry) => entry.id === 'concept.praxis-generators')?.aliases).toEqual([
      'doxa new',
      'doxa make:feature',
      'doxa make:model',
      'doxa make:action',
      'doxa make:query',
      'doxa make:route',
      'doxa make:event',
      'doxa make:listener',
      'doxa make:signal',
      'doxa make:signal-handler',
      'doxa make:observer',
      'doxa make:job',
      'doxa make:schedule',
      'doxa make:policy',
      'doxa make:permission-source',
      'doxa make:config',
      'doxa make:provider',
      'doxa make:service',
      'doxa make:command',
      'doxa make:migration',
      'doxa make:test',
    ])
    expect(roles.find((entry) => entry.role === 'action')?.details?.canonicalFolder).toBe(
      'src/features/<feature>/actions',
    )
    expect(roles.find((entry) => entry.role === 'route')?.details?.canonicalFolder).toBe(
      'src/features/<feature>/http',
    )
    for (const [query, expectedId] of [
      ['Feature.provides singleton infrastructure', 'concept.providers-provides'],
      ['service joins caller transaction', 'role.service'],
      ['nested ActionBus', 'diagnostic.nested-action-dispatch'],
      ['event facts queued consistency', 'concept.orchestration-consistency'],
      ['folders runtime meaning', 'programming-model.core'],
    ] as const) {
      expect(searchDocumentation(entries, query, 5).map((entry) => entry.id)).toContain(expectedId)
    }
    expect(searchDocumentation(entries, 'folders runtime meaning', 1)[0]?.id).toBe(
      'programming-model.core',
    )
    expect(entries.filter((entry) => entry.kind === 'module').map((entry) => entry.id)).toEqual([
      'module.auth-postgres',
      'module.compiler',
      'module.core',
      'module.gnosis',
      'module.http-hono',
      'module.introspection',
      'module.keryx',
      'module.manifest',
      'module.opentelemetry',
      'module.postgres-drizzle',
      'module.praxis',
      'module.queue-pg-boss',
      'module.realtime',
      'module.runtime',
      'module.sendgrid',
      'module.testing',
      'module.theoria',
      'module.twilio-sms',
    ])

    const emptyManifest = {
      ...manifest,
      plugins: [],
      providers: [],
      routes: [],
      models: [],
      jobs: [],
      schedules: [],
      listeners: [],
    } satisfies DoxaManifest
    const alwaysInstalledModules = [
      'module.auth-postgres',
      'module.compiler',
      'module.core',
      'module.gnosis',
      'module.http-hono',
      'module.introspection',
      'module.manifest',
      'module.postgres-drizzle',
      'module.praxis',
      'module.queue-pg-boss',
      'module.runtime',
      'module.testing',
    ]
    expect(
      handbookIndex(manifest.frameworkVersion, emptyManifest)
        .filter((entry) => entry.kind === 'module')
        .map((entry) => entry.id),
    ).toEqual(alwaysInstalledModules)
    const sendgridManifest = {
      ...emptyManifest,
      plugins: [
        {
          id: 'sendgrid',
          package: '@doxajs/sendgrid',
          source: manifest.application.source,
        },
      ],
    } satisfies DoxaManifest
    expect(
      handbookIndex(manifest.frameworkVersion, sendgridManifest)
        .filter((entry) => entry.kind === 'module')
        .map((entry) => entry.id),
    ).toEqual([...alwaysInstalledModules.slice(0, 11), 'module.sendgrid', 'module.testing'])
    const mailCapabilityManifest = {
      ...emptyManifest,
      providers: [{ ...manifest.providers[0]!, capabilities: ['mail'] }],
    } satisfies DoxaManifest
    expect(
      handbookIndex(manifest.frameworkVersion, mailCapabilityManifest)
        .filter((entry) => entry.kind === 'module')
        .map((entry) => entry.id),
    ).toEqual([...alwaysInstalledModules.slice(0, 11), 'module.sendgrid', 'module.testing'])

    const publicHandbook = await readFile(
      path.join(workspace, 'docs/guides/doxa-agent-handbook.md'),
      'utf8',
    )
    expect(publicHandbook).toBe(renderHandbookMarkdown(manifest.frameworkVersion))
    const testingGuidance =
      'Use admitted Action, Query, HTTP, event, and Job harness paths to prove transaction, authorization, and delivery guarantees.'
    expect(publicHandbook.match(new RegExp(testingGuidance, 'g'))).toHaveLength(1)
  })

  it('explains component transaction behavior and emits advisory-only structure diagnostics', () => {
    const action = manifest.actions[0]
    const provider = manifest.providers.find((entry) => entry.role === 'provider')
    if (!action || !provider) throw new Error('fixture is missing an action or provider')
    const existingDiagnostics = inspectArchitectureDiagnostics(manifest)
    expect(explainComponent(manifest, action.id)).toEqual(
      expect.objectContaining({
        kind: 'action',
        transaction: {
          mode: 'owns-writable',
          description: expect.stringContaining('writable unit of work'),
        },
        guideIds: expect.arrayContaining(['role.action', 'concept.orchestration-consistency']),
      }),
    )
    const queuedListener = manifest.listeners.find(
      (entry) => entry.delivery === 'queued' || entry.delivery === 'queued-after-commit',
    )
    if (!queuedListener) throw new Error('fixture is missing a queued listener')
    expect(explainComponent(manifest, queuedListener.id)).toEqual(
      expect.objectContaining({
        kind: 'listener',
        transaction: expect.objectContaining({
          mode: 'delivery-dependent',
          description: expect.stringContaining('no automatic writable transaction'),
        }),
      }),
    )
    const committedObserver = manifest.observers.find((entry) => entry.phases.includes('committed'))
    if (!committedObserver) throw new Error('fixture is missing a committed observer')
    expect(explainComponent(manifest, committedObserver.id)).toEqual(
      expect.objectContaining({
        kind: 'observer',
        transaction: {
          mode: 'delivery-dependent',
          description: expect.stringContaining(
            'committed phase runs after durability and cannot roll back',
          ),
        },
      }),
    )

    const diagnosticManifest = rehashManifest({
      ...manifest,
      actions: manifest.actions.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              source: { ...entry.source, file: 'src/app/queries/misplaced-action.ts' },
            }
          : entry,
      ),
      providers: [
        ...manifest.providers.map((entry) =>
          entry.id === provider.id
            ? {
                ...entry,
                name: `${entry.name}Service`,
                source: { ...entry.source, file: 'src/app/services/application-provider.ts' },
              }
            : entry,
        ),
        {
          ...provider,
          id: 'service:app/notification-provider',
          ownerId: 'app',
          name: 'NotificationProvider',
          exportName: 'NotificationProvider',
          role: 'service',
          scope: 'transient',
          durableIdentity: false,
          capabilities: [],
          source: { ...provider.source, file: 'src/app/providers/notification-provider.ts' },
          dependencies: [],
          lifecycle: { start: false, drain: false, stop: false, dispose: false },
        },
      ],
    })
    expect(inspectArchitectureDiagnostics(diagnosticManifest)).toEqual({
      items: expect.arrayContaining([
        expect.objectContaining({
          code: 'DOXA-GNOSIS-STRUCTURE-002',
          componentId: provider.id,
          severity: 'warning',
          guideId: 'diagnostic.provider-service-location',
        }),
        expect.objectContaining({
          code: 'DOXA-GNOSIS-STRUCTURE-004',
          componentId: provider.id,
          severity: 'warning',
        }),
        expect.objectContaining({
          code: 'DOXA-GNOSIS-STRUCTURE-001',
          componentId: 'service:app/notification-provider',
          severity: 'warning',
        }),
        expect.objectContaining({
          code: 'DOXA-GNOSIS-STRUCTURE-003',
          componentId: 'service:app/notification-provider',
          severity: 'warning',
        }),
        expect.objectContaining({
          code: 'DOXA-GNOSIS-STRUCTURE-005',
          componentId: manifest.actions[0]?.id,
          severity: 'warning',
          guideId: 'diagnostic.canonical-folder',
        }),
      ]),
      total: existingDiagnostics.total + 5,
      truncated: false,
    })
  })

  it('recommends shared-service atomicity for the reminder invariant and refuses to infer missing intent', () => {
    const atomic = reviewArchitecture(manifest, {
      goal: 'Deliver due reminders',
      invariants: ['The reminder is removed if and only if the notification is created.'],
      consistency: 'atomic',
    })
    expect(atomic).toEqual(
      expect.objectContaining({
        status: 'recommendation',
        consistency: 'atomic',
        recommendation: expect.stringContaining('ordinary service'),
        transactionOwnership: expect.stringContaining('Action or Job owns'),
        collaboration: expect.stringContaining('Feature.provides'),
        guarantees: expect.arrayContaining([
          'Required mutations commit together or roll back together.',
        ]),
        rejectedAlternatives: expect.arrayContaining([
          expect.stringContaining('Queued listener delivery'),
          expect.stringContaining('Nested ActionBus dispatch'),
        ]),
      }),
    )

    expect(
      reviewArchitecture(manifest, {
        goal: 'Deliver due reminders',
        invariants: ['A notification may or may not need to commit with reminder deletion.'],
        componentIds: [manifest.actions[0]!.id],
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'insufficient-intent',
        consistency: null,
        recommendation: expect.stringContaining('Declare the business invariant'),
      }),
    )
    expect(
      reviewArchitecture(manifest, {
        goal: 'Invalidate a cache only after the record commits',
        invariants: ['A rolled-back record change must never trigger cache invalidation.'],
        consistency: 'after-commit',
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'recommendation',
        consistency: 'after-commit',
        recommendation: expect.stringContaining('after-commit Listener'),
        transactionOwnership: expect.stringContaining('already committed'),
      }),
    )
    expect(
      reviewArchitecture(manifest, {
        goal: 'Send a retryable notification later',
        invariants: ['Reminder deletion may commit before notification delivery.'],
        consistency: 'eventual',
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'recommendation',
        consistency: 'eventual',
        recommendation: expect.stringContaining(
          'queued Listener that dispatches a later top-level Action',
        ),
        transactionOwnership: expect.stringContaining('no automatic writable transaction'),
      }),
    )

    expect(() =>
      reviewArchitecture(manifest, {
        goal: 'Too many invariants',
        invariants: Array.from({ length: 11 }, (_, index) => `Invariant ${index}`),
        consistency: 'atomic',
      }),
    ).toThrow('Architecture review accepts at most 10 invariants.')
    expect(() =>
      reviewArchitecture(manifest, {
        goal: 'Invalid component',
        invariants: ['The operation is atomic.'],
        consistency: 'atomic',
        componentIds: [''],
      }),
    ).toThrow('Each component ID must contain 1 through 256 characters.')
  })

  it('compiles and explains the canonical Action and Job shared-service reminder architecture', async () => {
    const root = path.join(artifactsDirectory, 'reminder-architecture')
    const errors: string[] = []
    const io = { out: () => undefined, error: (message: string) => errors.push(message) }
    expect(
      await runPraxis(['new', 'ReminderArchitecture', `--directory=${root}`], workspace, io),
    ).toBe(0)
    await symlink(path.join(workspace, 'node_modules'), path.join(root, 'node_modules'))
    expect(await runPraxis(['make:feature', 'Notifications'], root, io)).toBe(0)
    expect(await runPraxis(['make:feature', 'Reminders'], root, io)).toBe(0)
    expect(
      await runPraxis(['make:service', 'Notifications/NotificationCreator', '--provide'], root, io),
    ).toBe(0)
    expect(
      await runPraxis(['make:action', 'Notifications/CreateNotification', '--public'], root, io),
    ).toBe(0)
    expect(
      await runPraxis(['make:job', 'Reminders/DeliverDueReminders', '--public'], root, io),
    ).toBe(0)
    await writeFile(
      path.join(root, 'src/features/notifications/services/notification-creator.ts'),
      `export class NotificationCreator {\n  create(): void {}\n}\n`,
    )
    await writeFile(
      path.join(root, 'src/features/notifications/actions/create-notification.ts'),
      `import { Action } from '@doxajs/core'\nimport { NotificationCreator } from '../services/notification-creator.js'\n\nexport class CreateNotification extends Action<void, void> {\n  static id = 'create-notification'\n  static override readonly access = 'public'\n  private readonly creator = this.inject(NotificationCreator)\n  async handle(): Promise<void> { this.creator.create() }\n}\n`,
    )
    await writeFile(
      path.join(root, 'src/features/reminders/jobs/deliver-due-reminders.ts'),
      `import { Job } from '@doxajs/core'\nimport { NotificationCreator } from '../../notifications/services/notification-creator.js'\n\nexport class DeliverDueReminders extends Job<void> {\n  static override readonly id = 'deliver-due-reminders'\n  static override readonly access = 'public'\n  private readonly creator = this.inject(NotificationCreator)\n  async handle(_input: void): Promise<void> { this.creator.create() }\n}\n`,
    )
    const buildCode = await runPraxis(['build'], root, io)
    if (buildCode !== 0) throw new Error(errors.join('\n'))
    expect(errors).toEqual([])
    const compiled: unknown = JSON.parse(
      await readFile(path.join(root, '.doxa/manifest.json'), 'utf8'),
    )
    assertCurrentManifest(compiled)
    const serviceId = 'service:notifications/notification-creator'
    expect(compiled.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: serviceId,
          role: 'service',
          scope: 'transient',
        }),
      ]),
    )
    expect(
      compiled.actions.find((entry) => entry.id === 'action:notifications/create-notification')
        ?.dependencies,
    ).toEqual([expect.objectContaining({ targetId: serviceId })])
    expect(
      compiled.jobs.find((entry) => entry.id === 'job:reminders/deliver-due-reminders')
        ?.dependencies,
    ).toEqual([expect.objectContaining({ targetId: serviceId })])

    const explanation = explainComponent(compiled, serviceId)
    expect(explanation).toEqual(
      expect.objectContaining({
        kind: 'service',
        transaction: expect.objectContaining({
          mode: 'joins-caller',
          description: expect.stringContaining('no transaction of its own'),
        }),
        consumers: [
          'action:notifications/create-notification',
          'job:reminders/deliver-due-reminders',
        ],
      }),
    )
    expect(
      reviewArchitecture(compiled, {
        goal: 'Deliver due reminders',
        invariants: ['The reminder is removed if and only if the notification is created.'],
        consistency: 'atomic',
        componentIds: [
          'action:notifications/create-notification',
          'job:reminders/deliver-due-reminders',
          serviceId,
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'recommendation',
        collaboration: expect.stringContaining('Feature.provides'),
        rejectedAlternatives: expect.arrayContaining([
          expect.stringContaining('Queued listener delivery'),
        ]),
      }),
    )
  })

  it('serves the real MCP protocol with parity, structured errors, and exact-version docs', async () => {
    const modelQueries: unknown[] = []
    const server = createGnosisServer(manifest, {
      queryModels: async (request) => {
        modelQueries.push(request)
        if (request.limit === 100) {
          return {
            modelId: request.modelId,
            fields: request.fields,
            rows: Array.from({ length: 100 }, (_, index) => ({
              id: `counter-${index}-${'a'.repeat(20_000)}`,
              value: 'b'.repeat(20_000),
            })),
            returned: 100,
            truncated: false,
            executionId: 'execution-large',
          }
        }
        return {
          modelId: request.modelId,
          fields: request.fields,
          rows: [{ id: 'counter-1', value: 2, password: 'not-for-agents' }],
          returned: 1,
          truncated: false,
          executionId: 'execution-1',
        }
      },
    })
    const client = new Client({ name: 'gnosis-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    try {
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'application_info',
          'get_programming_model',
          'explain_role',
          'explain_component',
          'review_architecture',
          'read_doc',
          'inspect_graph',
          'list_routes',
          'list_services',
          'list_providers',
          'list_permission_sources',
          'describe_model',
          'describe_authentication',
          'query_models',
          'search_docs',
        ]),
      )
      expect(tools.tools.find((tool) => tool.name === 'application_info')?.outputSchema).toEqual(
        expect.objectContaining({ type: 'object' }),
      )
      expect(client.getInstructions()).toContain(
        'Gnosis is the version-matched architectural authority',
      )

      const programmingModelResult = await client.callTool({
        name: 'get_programming_model',
        arguments: {},
      })
      expect(programmingModelResult.structuredContent).toEqual(
        expect.objectContaining({
          title: 'Doxa Programming Model',
          rules: expect.arrayContaining([
            expect.stringContaining('Job attempts are top-level asynchronous writable boundaries'),
          ]),
        }),
      )
      const jobGuide = await client.callTool({
        name: 'explain_role',
        arguments: { role: 'job' },
      })
      expect(jobGuide.structuredContent).toEqual(
        expect.objectContaining({
          id: 'role.job',
          details: expect.objectContaining({
            transaction: expect.stringContaining('writable transaction'),
            antiPatterns: expect.arrayContaining(['Job-to-Action dispatch']),
          }),
        }),
      )
      const orchestrationGuide = await client.callTool({
        name: 'read_doc',
        arguments: { id: 'concept.orchestration-consistency' },
      })
      expect(orchestrationGuide.structuredContent).toEqual(
        expect.objectContaining({
          id: 'concept.orchestration-consistency',
          text: expect.stringContaining('DeliverDueReminders'),
        }),
      )

      const routes = await client.callTool({ name: 'list_routes', arguments: {} })
      expect(routes.structuredContent).toEqual(inspectSurface(manifest, 'routes'))
      const providers = await client.callTool({ name: 'list_providers', arguments: {} })
      expect(providers.structuredContent).toEqual(inspectSurface(manifest, 'providers'))
      const services = await client.callTool({ name: 'list_services', arguments: {} })
      expect(services.structuredContent).toEqual(inspectSurface(manifest, 'services'))

      const permissionSources = await client.callTool({
        name: 'list_permission_sources',
        arguments: {},
      })
      expect(permissionSources.structuredContent).toEqual(
        inspectSurface(manifest, 'permissionSources'),
      )

      const authentication = await client.callTool({
        name: 'describe_authentication',
        arguments: {},
      })
      expect(authentication.structuredContent).toEqual(describeAuthentication(manifest))

      const model = await client.callTool({
        name: 'describe_model',
        arguments: { id: 'model:counters/counter' },
      })
      expect(model.structuredContent).toEqual(
        expect.objectContaining({
          id: 'model:counters/counter',
          relationships: expect.arrayContaining([
            expect.objectContaining({ name: 'tags', kind: 'belongsToMany' }),
          ]),
        }),
      )
      const explainedAction = await client.callTool({
        name: 'explain_component',
        arguments: { id: manifest.actions[0]!.id },
      })
      expect(explainedAction.structuredContent).toEqual(
        expect.objectContaining({
          id: manifest.actions[0]!.id,
          transaction: expect.objectContaining({ mode: 'owns-writable' }),
          guidance: expect.arrayContaining([
            expect.objectContaining({ id: 'role.action' }),
            expect.objectContaining({ id: 'concept.orchestration-consistency' }),
          ]),
        }),
      )

      const queried = await client.callTool({
        name: 'query_models',
        arguments: {
          modelId: 'model:counters/counter',
          fields: ['id', 'value'],
          filters: [{ attribute: 'value', operator: '>=', value: 2 }],
          orderBy: [{ attribute: 'value', direction: 'desc' }],
          limit: 5,
        },
      })
      expect(modelQueries).toEqual([
        {
          modelId: 'model:counters/counter',
          fields: ['id', 'value'],
          filters: [{ attribute: 'value', operator: '>=', value: 2 }],
          orderBy: [{ attribute: 'value', direction: 'desc' }],
          limit: 5,
        },
      ])
      expect(queried.structuredContent).toEqual({
        modelId: 'model:counters/counter',
        fields: ['id', 'value'],
        rows: [{ id: 'counter-1', value: 2, password: '[REDACTED]' }],
        returned: 1,
        truncated: false,
        executionId: 'execution-1',
      })

      const unknownAttribute = await client.callTool({
        name: 'query_models',
        arguments: {
          modelId: 'model:counters/counter',
          fields: ['missing'],
        },
      })
      expect(unknownAttribute.isError).toBe(true)
      expect(modelQueries).toHaveLength(1)

      const oversizedFilter = await client.callTool({
        name: 'query_models',
        arguments: {
          modelId: 'model:counters/counter',
          fields: ['id'],
          filters: [{ attribute: 'id', operator: '=', value: 'a'.repeat(10_001) }],
        },
      })
      expect(oversizedFilter.isError).toBe(true)
      expect(modelQueries).toHaveLength(1)

      const oversizedResult = await client.callTool({
        name: 'query_models',
        arguments: {
          modelId: 'model:counters/counter',
          fields: ['id', 'value'],
          limit: 100,
        },
      })
      expect(oversizedResult.isError).toBe(true)
      const oversizedResultContent = oversizedResult.content as Array<{
        type: string
        text?: string
      }>
      expect(
        JSON.parse(
          oversizedResultContent[0]?.type === 'text' ? (oversizedResultContent[0].text ?? '') : '',
        ),
      ).toEqual({
        code: 'invalid_input',
        message: 'Model query result exceeds 1,000,000 bytes. Request fewer fields or rows.',
      })
      expect(modelQueries).toHaveLength(2)

      const missing = await client.callTool({
        name: 'describe_model',
        arguments: { id: 'model:missing' },
      })
      expect(missing.isError).toBe(true)
      expect(missing.structuredContent).toBeUndefined()
      const missingContent = missing.content as Array<{ type: string; text?: string }>
      expect(
        JSON.parse(missingContent[0]?.type === 'text' ? (missingContent[0].text ?? '') : ''),
      ).toEqual({
        code: 'not_found',
        message: 'Model model:missing is not declared.',
      })

      const sensitiveMissing = await client.callTool({
        name: 'describe_model',
        arguments: { id: 'password=not-for-errors' },
      })
      const sensitiveContent = sensitiveMissing.content as Array<{ type: string; text?: string }>
      expect(
        JSON.parse(sensitiveContent[0]?.type === 'text' ? (sensitiveContent[0].text ?? '') : ''),
      ).toEqual({
        code: 'not_found',
        message: 'Model password=[REDACTED] is not declared.',
      })

      const invalid = await client.callTool({
        name: 'describe_model',
        arguments: { id: '' },
      })
      expect(invalid.isError).toBe(true)
      expect(invalid.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Input validation'),
        }),
      ])

      const docs = await client.callTool({
        name: 'search_docs',
        arguments: { query: 'model relationships', limit: 2 },
      })
      expect(docs.structuredContent).toEqual(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              package: '@doxajs/core',
              version: compilerVersion,
              source: 'models.md',
            }),
          ]),
        }),
      )

      const architecture = await client.callTool({
        name: 'review_architecture',
        arguments: {
          goal: 'Deliver due reminders',
          invariants: ['The reminder is removed if and only if the notification is created.'],
          consistency: 'atomic',
        },
      })
      expect(architecture.structuredContent).toEqual(
        expect.objectContaining({
          status: 'recommendation',
          recommendation: expect.stringContaining('ordinary service'),
          rejectedAlternatives: expect.arrayContaining([
            expect.stringContaining('Queued listener delivery'),
          ]),
        }),
      )

      const resources = await client.listResources()
      expect(resources.resources.map((resource) => resource.uri)).toEqual(
        expect.arrayContaining([
          'doxa://application/manifest',
          'doxa://application/graph',
          'doxa://documentation/index',
          'doxa://guidance/programming-model',
          'doxa://guidance/roles',
          'doxa://guidance/modules',
          'doxa://guidance/consistency',
          'doxa://application/diagnostics',
        ]),
      )
      const consistencyResource = await client.readResource({
        uri: 'doxa://guidance/consistency',
      })
      expect(consistencyResource.contents).toEqual([
        expect.objectContaining({
          uri: 'doxa://guidance/consistency',
          text: expect.stringContaining('concept.orchestration-consistency'),
        }),
      ])
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('is spawned by generated project registration without a manual start', async () => {
    const registrationFile = path.join(generatedApplication, '.codex/config.toml')
    const registration = await readFile(registrationFile, 'utf8')
    expect(registration).toContain('command = "node"')
    expect(registration).toContain('args = ["./node_modules/@doxajs/praxis/dist/bin.js","mcp"]')
    expect(registration).not.toContain('cwd = ')
    const client = new Client({ name: 'gnosis-stdio-test', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['./node_modules/@doxajs/praxis/dist/bin.js', 'mcp'],
      cwd: generatedApplication,
      env: { ...getDefaultEnvironment(), CI: '1' },
      stderr: 'pipe',
    })
    let stderr = ''
    transport.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    try {
      await client.connect(transport)
    } catch (error) {
      throw new Error(`doxa mcp failed: ${String(error)}\n${stderr}`, { cause: error })
    }
    try {
      const result = await client.callTool({ name: 'application_info', arguments: {} })
      expect(result.structuredContent).toEqual(
        expect.objectContaining({
          applicationId: 'garden',
          manifestFormatVersion: 7,
          gnosisVersion,
        }),
      )
      expect(client.getInstructions()).toContain('Nested Action dispatch')
      const model = await client.callTool({ name: 'get_programming_model', arguments: {} })
      expect(model.structuredContent).toEqual(
        expect.objectContaining({ title: 'Doxa Programming Model' }),
      )
    } finally {
      await client.close()
    }
  }, 15_000)

  it('rejects relationship declarations that can diverge from runtime behavior', async () => {
    const root = path.join(artifactsDirectory, 'relationship-guard')
    const errors: string[] = []
    expect(
      await runPraxis(['new', 'RelationshipGuard', `--directory=${root}`], workspace, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    await symlink(path.join(workspace, 'node_modules'), path.join(root, 'node_modules'))
    await writeFile(
      path.join(root, 'src/app/app.feature.ts'),
      `import { Feature } from '@doxajs/core'\n\nimport { Owner, Related, Other } from './models.js'\n\nexport class AppFeature extends Feature {\n  id = 'app'\n  models = [Owner, Related, Other]\n}\n`,
    )
    const models = path.join(root, 'src/app/models.ts')
    await writeFile(
      models,
      `import { hasMany as doxaHasMany, Model, type ModelRelationship } from '@doxajs/core'\n\ninterface Attributes { id: string; ownerId: string }\nexport class Related extends Model<Attributes> { static override readonly id = 'related' }\nexport class Other extends Model<Attributes> { static override readonly id = 'other' }\nfunction hasMany(related: Parameters<typeof doxaHasMany>[0], options: Parameters<typeof doxaHasMany>[1]): ModelRelationship {\n  return doxaHasMany(related, { foreignKey: \`ignored-\${options.foreignKey}\` })\n}\nexport class Owner extends Model<Attributes> {\n  static override readonly id = 'owner'\n  static override readonly relationships = {\n    related: hasMany(() => Related, { foreignKey: 'ownerId' }),\n  }\n}\n`,
    )
    expect(
      await runPraxis(['build'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors.at(-1)).toContain('must call a Doxa relationship helper directly')

    errors.length = 0
    await writeFile(
      models,
      `import { hasMany, Model } from '@doxajs/core'\n\ninterface Attributes { id: string; ownerId: string }\nexport class Related extends Model<Attributes> { static override readonly id = 'related' }\nexport class Other extends Model<Attributes> { static override readonly id = 'other' }\nexport class Owner extends Model<Attributes> {\n  static override readonly id = 'owner'\n  static override readonly relationships = {\n    related: hasMany(() => {\n      if (Date.now() > 0) return Related\n      return Other\n    }, { foreignKey: 'ownerId' }),\n  }\n}\n`,
    )
    expect(
      await runPraxis(['build'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors.at(-1)).toContain('must reference a model selected by an application Feature')

    errors.length = 0
    await writeFile(
      models,
      `import { hasMany, Model } from '@doxajs/core'\n\ninterface Attributes { id: string; ownerId: string }\nconst runtimeOptions = Date.now() > 0 ? { foreignKey: 'runtimeOwnerId' } : {}\nexport class Related extends Model<Attributes> { static override readonly id = 'related' }\nexport class Other extends Model<Attributes> { static override readonly id = 'other' }\nexport class Owner extends Model<Attributes> {\n  static override readonly id = 'owner'\n  static override readonly relationships = {\n    related: hasMany(() => Related, { foreignKey: 'ownerId', ...runtimeOptions }),\n  }\n}\n`,
    )
    expect(
      await runPraxis(['build'], root, {
        out: () => undefined,
        error: (message) => errors.push(message),
      }),
    ).toBe(1)
    expect(errors.at(-1)).toContain('relationship options must use explicit property assignments')
  })

  it('keeps TypeScript diagnostics off MCP stdout when compilation fails', async () => {
    const invalidSource = path.join(generatedApplication, 'src/app/invalid.ts')
    await writeFile(invalidSource, 'const invalid: string = 42\n')
    try {
      const result = await runChild(
        process.execPath,
        [path.join(workspace, 'packages/praxis/dist/bin.js'), 'mcp'],
        generatedApplication,
      )
      expect(result.code).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('TypeScript build failed with exit code')
      expect(result.stderr).toContain('error TS2322')
    } finally {
      await rm(invalidSource, { force: true })
    }
  })
})

function packageVersion(packageName: 'compiler' | 'gnosis'): string {
  const packageJson = JSON.parse(
    readFileSync(path.join(workspace, 'packages', packageName, 'package.json'), 'utf8'),
  ) as { version: string }
  return packageJson.version
}

function rehashManifest(value: DoxaManifest): DoxaManifest {
  const { buildHash: _buildHash, ...semanticManifest } = value
  return {
    ...semanticManifest,
    buildHash: createHash('sha256').update(canonicalJson(semanticManifest)).digest('hex'),
  }
}

function runChild(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
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
