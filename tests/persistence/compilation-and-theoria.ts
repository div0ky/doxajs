import { randomUUID } from 'node:crypto'

import type { CompileApplicationResult } from '@doxajs/compiler'
import { type ActionClass, Instant, ObservationRecorder } from '@doxajs/core'
import { HonoHttpEngine } from '@doxajs/http-hono'
import { Doxa, type DoxaRuntime } from '@doxajs/runtime'
import { listenTheoria, PostgresTheoria, pruneTheoria, TheoriaStore } from '@doxajs/theoria'
import type { Pool } from 'pg'
import { expect, it } from 'vitest'

import { Application } from '../../examples/persistence-app/dist/application.js'
import { DispatchProcessCounter } from '../../examples/persistence-app/dist/counters/actions/dispatch-process-counter.js'

interface PersistenceCompilationSuiteContext {
  readonly pool: () => Pool
  readonly connectionString: () => string
  readonly sendGridPublicKey: string
  readonly twilioAuthToken: string
  readonly runtimes: DoxaRuntime[]
  readonly compilePersistenceApplication: (
    artifactsDirectory: string,
  ) => Promise<CompileApplicationResult>
  readonly temporaryDirectory: () => Promise<string>
  readonly bootPersistenceRuntime: () => Promise<DoxaRuntime>
  readonly responseData: <Payload = unknown>(response: Response) => Promise<Payload>
  readonly waitFor: (
    predicate: () => boolean | Promise<boolean>,
    timeoutMilliseconds?: number,
  ) => Promise<void>
  readonly runAction: <Input, Output>(
    runtime: DoxaRuntime,
    action: ActionClass<Input, Output>,
    input: Input,
  ) => Promise<Awaited<Output>>
}

class FailingObservationRecorder extends ObservationRecorder {
  start(): void {}
  drain(): void {}
  dispose(): void {}
  record(): void {
    throw new Error('observation storage unavailable')
  }
}

export function registerCompilationAndTheoriaTests(
  context: PersistenceCompilationSuiteContext,
): void {
  const {
    pool,
    connectionString,
    sendGridPublicKey,
    twilioAuthToken,
    runtimes,
    compilePersistenceApplication,
    temporaryDirectory,
    bootPersistenceRuntime,
    responseData,
    waitFor,
    runAction,
  } = context

  it('compiles Unit of Work and transaction capabilities without engine types', async () => {
    const result = await compilePersistenceApplication(await temporaryDirectory())
    expect(result.manifest.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider:infrastructure/transactions',
          capabilities: ['transactions'],
          scope: 'singleton',
        }),
        expect.objectContaining({
          id: 'provider:infrastructure/queues',
          capabilities: ['queues'],
          scope: 'singleton',
        }),
        expect.objectContaining({
          id: 'provider:infrastructure/auth',
          capabilities: ['authentication'],
          scope: 'singleton',
        }),
        expect.objectContaining({
          id: 'provider:infrastructure/cache',
          capabilities: ['cache'],
          scope: 'singleton',
        }),
        expect.objectContaining({ id: 'provider:infrastructure/mail', capabilities: ['mail'] }),
        expect.objectContaining({ id: 'provider:infrastructure/sms', capabilities: ['sms'] }),
        expect.objectContaining({
          id: 'provider:infrastructure/telemetry',
          capabilities: ['telemetry'],
        }),
        expect.objectContaining({
          id: 'provider:infrastructure/theoria',
          capabilities: ['observations'],
        }),
        expect.objectContaining({
          id: 'provider:counters/counter-event-recorder',
          capabilities: [],
          scope: 'singleton',
        }),
        expect.objectContaining({
          id: 'provider:system/system-event-recorder',
          capabilities: [],
          scope: 'singleton',
        }),
      ]),
    )
    expect(
      result.manifest.configurations.find(
        (configuration) => configuration.name === 'DatabaseConfig',
      )?.properties,
    ).toEqual([
      expect.objectContaining({
        name: 'connectionString',
        kind: 'secret-string',
        sensitive: true,
      }),
    ])
    expect(
      result.manifest.actions.find((action) => action.id === 'action:counters/exercise-cache'),
    ).toEqual(
      expect.objectContaining({
        dependencies: [expect.objectContaining({ targetId: 'provider:infrastructure/cache' })],
      }),
    )
    expect(result.manifest.models).toEqual([
      expect.objectContaining({
        id: 'model:authorization/group',
        entityType: 'model:authorization/group',
        storage: { kind: 'entity-state' },
      }),
      expect.objectContaining({
        id: 'model:authorization/group-permission',
        entityType: 'model:authorization/group-permission',
        storage: { kind: 'entity-state' },
      }),
      expect.objectContaining({
        id: 'model:authorization/permission',
        entityType: 'model:authorization/permission',
        storage: { kind: 'entity-state' },
      }),
      expect.objectContaining({
        id: 'model:authorization/user',
        entityType: 'model:authorization/user',
        storage: { kind: 'entity-state' },
      }),
      expect.objectContaining({
        id: 'model:authorization/user-permission',
        entityType: 'model:authorization/user-permission',
        storage: { kind: 'entity-state' },
      }),
      expect.objectContaining({
        id: 'model:counters/counter',
        entityType: 'model:counters/counter',
        attributes: ['id', 'label', 'value'],
        storage: { kind: 'entity-state' },
      }),
      expect.objectContaining({
        id: 'model:counters/counter-note',
        entityType: 'model:counters/counter-note',
        storage: { kind: 'entity-state' },
      }),
      expect.objectContaining({
        id: 'model:counters/counter-tag',
        entityType: 'model:counters/counter-tag',
        storage: { kind: 'entity-state' },
      }),
      expect.objectContaining({
        id: 'model:counters/counter-tag-assignment',
        entityType: 'model:counters/counter-tag-assignment',
        storage: { kind: 'entity-state' },
      }),
      expect.objectContaining({
        id: 'model:counters/legacy-customer',
        entityType: 'model:counters/legacy-customer',
        storage: {
          kind: 'table',
          table: 'legacy_customers',
          primaryKey: 'customer_id',
          versionColumn: 'lock_version',
          timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
          columns: {
            id: 'customer_id',
            displayName: 'full_name',
            active: 'enabled',
            nickname: 'nickname',
            nullableCode: 'nullable_code',
          },
          attributeTypes: {
            active: { kind: 'boolean', nullable: false, optional: false },
            displayName: { kind: 'string', nullable: false, optional: false },
            id: { kind: 'string', nullable: false, optional: false },
            nickname: { kind: 'string', nullable: false, optional: true },
            nullableCode: { kind: 'string', nullable: true, optional: false },
          },
          optionalAttributes: ['nickname'],
          versionSource: { kind: 'column', column: 'lock_version' },
          managed: false,
          readOnly: false,
        },
      }),
      expect.objectContaining({
        id: 'model:counters/legacy-customer-read-model',
        entityType: 'model:counters/legacy-customer-read-model',
        attributes: ['displayName', 'id'],
        storage: {
          kind: 'table',
          table: 'legacy_customers',
          primaryKey: 'customer_id',
          versionColumn: 'lock_version',
          timestamps: false,
          columns: {
            id: 'customer_id',
            displayName: 'full_name',
          },
          managed: false,
          readOnly: true,
          attributeTypes: {
            id: { kind: 'string', nullable: false, optional: false },
            displayName: { kind: 'string', nullable: false, optional: false },
          },
          versionSource: { kind: 'column', column: 'lock_version' },
        },
      }),
      expect.objectContaining({
        id: 'model:counters/legacy-note',
        storage: {
          kind: 'table',
          table: 'legacy_notes',
          primaryKey: 'id',
          columns: { body: 'body', id: 'id' },
          attributeTypes: {
            body: { kind: 'string', nullable: false, optional: false },
            id: { kind: 'string', nullable: false, optional: false },
          },
          versionSource: { kind: 'xmin' },
          timestamps: false,
          managed: false,
          readOnly: false,
        },
      }),
    ])
    expect(result.manifest.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'route:accounts/change-password',
          method: 'POST',
          path: '/auth/password',
        }),
        expect.objectContaining({
          id: 'route:accounts/issue-access-token',
          method: 'POST',
          path: '/auth/tokens',
        }),
        expect.objectContaining({
          id: 'route:accounts/list-access-tokens',
          method: 'GET',
          path: '/auth/tokens',
        }),
        expect.objectContaining({
          id: 'route:accounts/list-sessions',
          method: 'GET',
          path: '/auth/sessions',
        }),
        expect.objectContaining({
          id: 'route:accounts/login',
          method: 'POST',
          path: '/auth/login',
        }),
        expect.objectContaining({
          id: 'route:accounts/logout',
          method: 'POST',
          path: '/auth/logout',
        }),
        expect.objectContaining({
          id: 'route:accounts/me',
          method: 'GET',
          path: '/auth/me',
        }),
        expect.objectContaining({
          id: 'route:accounts/reauthenticate',
          method: 'POST',
          path: '/auth/reauthenticate',
        }),
        expect.objectContaining({
          id: 'route:accounts/register',
          method: 'POST',
          path: '/auth/register',
        }),
        expect.objectContaining({
          id: 'route:accounts/request-password-reset',
          method: 'POST',
          path: '/auth/password/forgot',
        }),
        expect.objectContaining({
          id: 'route:accounts/resend-verification',
          method: 'POST',
          path: '/auth/email/verification',
        }),
        expect.objectContaining({
          id: 'route:accounts/reset-password',
          method: 'POST',
          path: '/auth/password/reset',
        }),
        expect.objectContaining({
          id: 'route:accounts/revoke-access-token',
          method: 'DELETE',
          path: '/auth/tokens/:id',
        }),
        expect.objectContaining({
          id: 'route:accounts/revoke-session',
          method: 'DELETE',
          path: '/auth/sessions/:id',
        }),
        expect.objectContaining({
          id: 'route:accounts/rotate-access-token',
          method: 'POST',
          path: '/auth/tokens/:id/rotate',
        }),
        expect.objectContaining({
          id: 'route:accounts/verify-email',
          method: 'POST',
          path: '/auth/email/verify',
        }),
        expect.objectContaining({
          id: 'route:counters/delete-counter',
          method: 'DELETE',
          path: '/counters/:id',
        }),
        expect.objectContaining({
          id: 'route:counters/increment-counter',
          method: 'POST',
          path: '/counters/:id/increment',
        }),
        expect.objectContaining({
          id: 'route:counters/secure-increment-counter',
          method: 'POST',
          path: '/secure/counters/:id/increment',
          access: 'counters.write',
        }),
        expect.objectContaining({
          id: 'route:infrastructure/sendgrid-webhook',
          method: 'POST',
          path: '/webhooks/sendgrid',
        }),
        expect.objectContaining({
          id: 'route:infrastructure/twilio-sms-webhook',
          method: 'POST',
          path: '/webhooks/twilio/sms',
        }),
        expect.objectContaining({
          id: 'route:system/health',
          method: 'GET',
          path: '/health',
        }),
        expect.objectContaining({
          id: 'route:system/hello',
          method: 'GET',
          path: '/hello/:name',
        }),
        expect.objectContaining({
          id: 'route:system/home',
          method: 'GET',
          path: '/',
        }),
        expect.objectContaining({
          id: 'route:system/ping',
          method: 'POST',
          path: '/ping',
        }),
      ]),
    )
    expect(result.manifest.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'event:accounts/user-logged-in',
          dispatch: 'immediate',
        }),
        expect.objectContaining({
          id: 'event:accounts/user-registered',
          dispatch: 'immediate',
        }),
        expect.objectContaining({
          id: 'event:counters/counter-created',
          payloadVersion: 1,
          domain: { entityType: 'model:counters/counter' },
        }),
        expect.objectContaining({
          id: 'event:counters/counter-incremented',
          dispatch: 'immediate',
          dependencies: [expect.objectContaining({ targetId: 'doxa:current-execution' })],
        }),
        expect.objectContaining({
          id: 'event:counters/counter-notification-requested',
          dispatch: 'immediate',
          dependencies: [expect.objectContaining({ targetId: 'doxa:current-execution' })],
        }),
        expect.objectContaining({
          id: 'event:counters/counter-saved',
          dispatch: 'after-commit',
        }),
        expect.objectContaining({
          id: 'event:system/http-pinged',
          dispatch: 'immediate',
        }),
      ]),
    )
    expect(result.manifest.listeners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'listener:counters/record-counter-incremented',
          eventId: 'event:counters/counter-incremented',
          delivery: 'local',
        }),
        expect.objectContaining({
          id: 'listener:counters/record-counter-incremented-after-commit',
          eventId: 'event:counters/counter-incremented',
          delivery: 'after-commit',
        }),
        expect.objectContaining({
          id: 'listener:counters/record-counter-saved',
          eventId: 'event:counters/counter-saved',
          delivery: 'local',
        }),
        expect.objectContaining({
          id: 'listener:counters/record-counter-notification',
          eventId: 'event:counters/counter-notification-requested',
          delivery: 'queued',
        }),
      ]),
    )
    expect(result.manifest.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'job:counters/process-counter',
          retries: 2,
          retryDelay: 0,
          backoff: false,
          timeout: 10,
        }),
      ]),
    )
    expect(result.manifest.schedules).toEqual([
      expect.objectContaining({
        id: 'schedule:authorization/authorization-model-session',
        access: 'authorization.contact.read',
        jobId: 'job:authorization/authorization-model-session-schedule',
      }),
      expect.objectContaining({
        id: 'schedule:counters/process-counters',
        jobId: 'job:counters/process-counter',
        cadence: { kind: 'interval', seconds: 3_600 },
        timeZone: 'UTC',
        overlap: 'serialize',
        misfire: 'catch-up-once',
        input: { key: 'scheduled-counter-sweep', counterId: 'scheduled-counter' },
      }),
      expect.objectContaining({
        id: 'schedule:system/daily-health-check',
        jobId: 'job:counters/process-counter',
        cadence: { kind: 'cron', expression: '0 6 * * *' },
        timeZone: 'America/Chicago',
      }),
    ])
    expect(result.manifest.policies).toEqual([
      expect.objectContaining({
        id: 'policy:accounts/account',
        abilities: [
          'accounts.email.verify',
          'accounts.logout',
          'accounts.password.change',
          'accounts.reauthenticate',
          'accounts.sessions.manage',
          'accounts.tokens.manage',
          'accounts.view-self',
        ],
      }),
      expect.objectContaining({
        id: 'policy:authorization/application',
        abilities: ['authorization.branch.override', 'authorization.contact.read'],
      }),
      expect.objectContaining({
        id: 'policy:counters/counter',
        abilities: [
          'broadcast.subscribe',
          'counters.realtime',
          'counters.update',
          'counters.write',
        ],
      }),
    ])
    expect(result.manifest.signals).toEqual([
      expect.objectContaining({
        id: 'signal:authorization/authorization-model-session',
      }),
      expect.objectContaining({
        id: 'signal:counters/counter-touched',
        dependencies: [expect.objectContaining({ targetId: 'doxa:current-execution' })],
      }),
    ])
    expect(result.manifest.signalHandlers).toEqual([
      expect.objectContaining({
        id: 'signal-handler:authorization/authorization-model-session',
        signalId: 'signal:authorization/authorization-model-session',
        access: 'authorization.contact.read',
      }),
      expect.objectContaining({
        id: 'signal-handler:counters/record-counter-touched',
        signalId: 'signal:counters/counter-touched',
        access: 'public',
      }),
    ])
    expect(result.manifest.observers).toEqual([
      expect.objectContaining({
        id: 'observer:counters/counter',
        modelId: 'model:counters/counter',
        phases: [
          'retrieved',
          'saving',
          'creating',
          'updating',
          'created',
          'updated',
          'saved',
          'committed',
        ],
      }),
    ])
    expect(result.manifest.commands).toEqual([
      expect.objectContaining({
        id: 'command:authorization/authorization-model-session',
        command: 'authorization:model-session',
        access: 'authorization.contact.read',
      }),
      expect.objectContaining({
        id: 'command:counters/mark-counter',
        command: 'counter:mark',
        access: 'public',
      }),
      expect.objectContaining({
        id: 'command:system/describe-doxa',
        command: 'doxa:describe',
        access: 'public',
      }),
    ])
    expect(result.manifest.permissionSource).toEqual(
      expect.objectContaining({
        id: 'permission-source:authorization/application-permissions',
        abilities: [
          'authorization.branch.override',
          'authorization.contact.read',
          'authorization.user.update',
        ],
      }),
    )
    expect(JSON.stringify(result.manifest)).not.toContain('drizzle')
    expect(JSON.stringify(result.manifest)).not.toContain('node-postgres')
    expect(JSON.stringify(result.manifest)).not.toContain('pg-boss')
  })

  it('records correlated typed observations and exposes a read-only execution timeline', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    expect((await http.fetch(new Request('http://doxa.test/health'))).status).toBe(200)

    await waitFor(
      async () =>
        Number(
          (await pool().query('SELECT count(*) AS count FROM doxa_theoria_observations')).rows[0]
            ?.count,
        ) >= 4,
    )
    const store = new TheoriaStore(connectionString())
    try {
      const executions = await store.executions({ kind: 'execution' })
      expect(executions[0]).toEqual(
        expect.objectContaining({ name: 'GET /health', phase: 'completed' }),
      )
      const timeline = await store.timeline(executions[0]!.executionId)
      expect(timeline.map((entry) => [entry.kind, entry.phase])).toEqual(
        expect.arrayContaining([
          ['execution', 'started'],
          ['http', 'started'],
          ['http', 'completed'],
          ['execution', 'completed'],
        ]),
      )
      expect(new Set(timeline.map((entry) => entry.context.correlationId)).size).toBe(1)
      expect(
        timeline.every((entry) => entry.context.executionId === executions[0]!.executionId),
      ).toBe(true)
    } finally {
      await store.close()
    }
  })

  it('persists opaque correlation IDs and trace parentage for the waterfall', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const traceId = '5'.repeat(32)
    const parentSpanId = '6'.repeat(16)
    const correlationId = 'everphone:incident:trace-proof'
    const response = await http.fetch(
      new Request('http://doxa.test/health', {
        headers: {
          'x-correlation-id': correlationId,
          traceparent: `00-${traceId}-${parentSpanId}-01`,
        },
      }),
    )
    expect(response.status).toBe(200)
    await waitFor(
      async () =>
        (
          await pool().query(
            `SELECT 1 FROM doxa_theoria_observations WHERE correlation_id = $1 AND phase = 'completed'`,
            [correlationId],
          )
        ).rowCount !== 0,
    )
    const execution = await pool().query<{ execution_id: string }>(
      `SELECT execution_id FROM doxa_theoria_observations WHERE correlation_id = $1 LIMIT 1`,
      [correlationId],
    )
    const store = new TheoriaStore(connectionString())
    try {
      const waterfall = await store.waterfall(execution.rows[0]!.execution_id)
      const root = waterfall.find((span) => span.name === 'GET /health')
      const route = waterfall.find(
        (span) => span.kind === 'http' && span.parentSpanId === root?.spanId,
      )
      expect(root).toEqual(expect.objectContaining({ traceId, parentSpanId, status: 'ok' }))
      expect(route).toEqual(expect.objectContaining({ traceId, status: 'ok' }))
    } finally {
      await store.close()
    }
  })

  it('browses actual terminal observations for category tabs instead of their parent executions', async () => {
    const executionId = randomUUID()
    const correlationId = randomUUID()
    const eventId = 'event:system/example-happened'
    await pool().query(
      `
      INSERT INTO doxa_theoria_observations
        (id, occurred_at, kind, name, phase, role_id, execution_id, correlation_id, transport, attributes)
      VALUES
        ($1, now(), 'execution', 'GET /example', 'completed', NULL, $2, $3, 'http', '{}'::jsonb),
        ($4, now() + interval '1 millisecond', 'event', $5, 'started', $5, $2, $3, 'http', '{}'::jsonb),
        ($6, now() + interval '2 milliseconds', 'event', $5, 'completed', $5, $2, $3, 'http', '{}'::jsonb)
    `,
      [randomUUID(), executionId, correlationId, randomUUID(), eventId, randomUUID()],
    )
    const store = new TheoriaStore(connectionString())
    try {
      expect(await store.entries({ kind: 'event' })).toEqual([
        expect.objectContaining({
          executionId,
          kind: 'event',
          name: eventId,
          phase: 'completed',
          roleId: eventId,
        }),
      ])
      expect(await store.entries({})).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'execution', name: 'GET /example' }),
          expect.objectContaining({ kind: 'event', name: eventId }),
        ]),
      )
      expect(await store.entries({ kind: 'job' })).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'schedule' })]),
      )
    } finally {
      await store.close()
    }
  })

  it('links queued worker executions back to their source execution and correlation', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, DispatchProcessCounter, { key: `theoria-${randomUUID()}` })
    await waitFor(
      async () =>
        (
          await pool().query(`
      SELECT 1 FROM doxa_theoria_observations
      WHERE kind = 'execution' AND transport = 'job' AND phase = 'completed'
        AND source_execution_id IS NOT NULL
    `)
        ).rowCount === 1,
    )
    const result = await pool().query<{
      execution_id: string
      source_execution_id: string
      correlation_id: string
    }>(`
      SELECT execution_id, source_execution_id, correlation_id
      FROM doxa_theoria_observations
      WHERE kind = 'execution' AND transport = 'job' AND phase = 'completed'
      ORDER BY sequence DESC LIMIT 1
    `)
    const worker = result.rows[0]!
    expect(worker.execution_id).not.toBe(worker.source_execution_id)
    expect(worker.correlation_id).toBe(worker.source_execution_id)
    expect(
      (
        await pool().query(
          `
      SELECT 1 FROM doxa_theoria_observations
      WHERE execution_id = $1 AND correlation_id = $2
    `,
          [worker.source_execution_id, worker.correlation_id],
        )
      ).rowCount,
    ).toBeGreaterThan(0)
  })

  it('keeps application execution independent from observation recorder failure', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compilePersistenceApplication(artifactsDirectory)
    const runtime = await Doxa.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment: {
        DATABASE_CONNECTION_STRING: connectionString(),
        COMMUNICATIONS_SEND_GRID_WEBHOOK_PUBLIC_KEY: sendGridPublicKey,
        COMMUNICATIONS_TWILIO_AUTH_TOKEN: twilioAuthToken,
      },
      providerOverrides: {
        'provider:infrastructure/theoria': new FailingObservationRecorder(),
      },
    })
    runtimes.push(runtime)
    const response = await new HonoHttpEngine(runtime).fetch(new Request('http://doxa.test/health'))
    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual({ status: 'ok' })
  })

  it('prunes Theoria deterministically by count and age', async () => {
    for (let index = 0; index < 4; index += 1) {
      await pool().query(
        `
        INSERT INTO doxa_theoria_observations
          (id, occurred_at, kind, name, phase, attributes)
        VALUES ($1, now() + ($2::integer * interval '1 millisecond'), 'log', $3, 'occurred', '{}'::jsonb)
      `,
        [randomUUID(), index, `entry-${index}`],
      )
    }
    expect(
      await pruneTheoria(connectionString(), { hotRetentionDays: 7, maximumObservations: 2 }),
    ).toBe(2)
    expect(
      Number(
        (await pool().query('SELECT count(*) AS count FROM doxa_theoria_observations')).rows[0]
          ?.count,
      ),
    ).toBe(2)
    await pool().query(
      `UPDATE doxa_theoria_observations SET occurred_at = now() - interval '8 days' WHERE name = 'entry-2'`,
    )
    expect(
      await pruneTheoria(connectionString(), { hotRetentionDays: 7, maximumObservations: 10 }),
    ).toBe(1)
  })

  it('moves hot evidence into monthly warm partitions and queries both tiers', async () => {
    const executionId = randomUUID()
    const name = `warm-${randomUUID()}`
    await pool().query(
      `
        INSERT INTO doxa_theoria_observations
          (id, occurred_at, kind, name, phase, execution_id, correlation_id, attributes)
        VALUES ($1, now() - interval '10 days', 'execution', $2, 'completed', $3, $4, '{}'::jsonb)
      `,
      [randomUUID(), name, executionId, `incident:${executionId}`],
    )
    await pruneTheoria(connectionString(), {
      hotRetentionDays: 7,
      warmRetentionDays: 30,
      maximumObservations: 50_000,
    })
    expect(
      (await pool().query('SELECT 1 FROM doxa_theoria_observations WHERE name = $1', [name]))
        .rowCount,
    ).toBe(0)
    expect(
      (await pool().query('SELECT 1 FROM doxa_theoria_observations_warm WHERE name = $1', [name]))
        .rowCount,
    ).toBe(1)
    const store = new TheoriaStore(connectionString())
    try {
      expect(await store.executions({ search: name })).toEqual([
        expect.objectContaining({ executionId, name }),
      ])
    } finally {
      await store.close()
    }
  })

  it('bounds production capture and reports dropped recorder evidence', async () => {
    const recorder = new PostgresTheoria({
      connectionString: connectionString(),
      environment: 'production',
      profile: 'production-diagnostics',
      productionEnabled: true,
      maximumPending: 1,
      batchSize: 100,
      flushIntervalMilliseconds: 60_000,
    })
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: Instant.fromEpochMicroseconds(BigInt(Date.now() + 5_000) * 1_000n),
    }
    await recorder.start(lifecycle)
    recorder.record({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      kind: 'log',
      name: 'accepted',
      phase: 'occurred',
      context: {},
      attributes: {},
    })
    recorder.record({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      kind: 'log',
      name: 'dropped',
      phase: 'occurred',
      context: {},
      attributes: {},
    })
    expect(recorder.health()).toEqual(
      expect.objectContaining({ queued: 1, accepted: 1, dropped: 1, writeFailures: 0 }),
    )
    await recorder.dispose(lifecycle)
    expect(recorder.health()).toEqual(
      expect.objectContaining({ queued: 0, persisted: 1, dropped: 1, writeFailures: 0 }),
    )
  })

  it('filters complete spans and persists production resource identity', async () => {
    const recorder = new PostgresTheoria({
      connectionString: connectionString(),
      environment: 'production',
      profile: 'production-diagnostics',
      productionEnabled: true,
      includeKinds: ['action'],
      includeNames: ['slow-operation'],
      minimumDurationMilliseconds: 10,
      batchSize: 100,
      flushIntervalMilliseconds: 60_000,
      resource: {
        application: 'evergreen',
        service: 'worker',
        environment: 'production',
        release: '2026.07.16',
        instanceId: 'worker-7',
      },
    })
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: Instant.fromEpochMicroseconds(BigInt(Date.now() + 5_000) * 1_000n),
    }
    await recorder.start(lifecycle)
    const executionId = randomUUID()
    const traceId = 'a'.repeat(32)
    const recordSpan = (name: string, spanId: string, durationMilliseconds: number) => {
      recorder.record({
        id: randomUUID(),
        occurredAt: new Date().toISOString(),
        kind: 'action',
        name,
        phase: 'started',
        context: { executionId, traceId, spanId },
        attributes: {},
      })
      recorder.record({
        id: randomUUID(),
        occurredAt: new Date().toISOString(),
        kind: 'action',
        name,
        phase: 'completed',
        durationMilliseconds,
        context: { executionId, traceId, spanId },
        attributes: {},
      })
    }
    recordSpan('slow-operation', 'b'.repeat(16), 25)
    recordSpan('slow-operation', 'c'.repeat(16), 2)
    recordSpan('excluded-name', 'd'.repeat(16), 25)
    await recorder.dispose(lifecycle)

    const result = await pool().query<{ name: string; phase: string; resource: unknown }>(
      `SELECT name, phase, resource
       FROM doxa_theoria_observations
       WHERE execution_id = $1
       ORDER BY sequence`,
      [executionId],
    )
    expect(result.rows).toEqual([
      {
        name: 'slow-operation',
        phase: 'started',
        resource: {
          application: 'evergreen',
          service: 'worker',
          environment: 'production',
          release: '2026.07.16',
          instanceId: 'worker-7',
        },
      },
      {
        name: 'slow-operation',
        phase: 'completed',
        resource: {
          application: 'evergreen',
          service: 'worker',
          environment: 'production',
          release: '2026.07.16',
          instanceId: 'worker-7',
        },
      },
    ])
  })

  it('keeps distinct semantic start records that share one execution span', async () => {
    const recorder = new PostgresTheoria({
      connectionString: connectionString(),
      minimumDurationMilliseconds: 10,
      batchSize: 100,
      flushIntervalMilliseconds: 60_000,
    })
    const lifecycle = {
      signal: new AbortController().signal,
      deadline: Instant.fromEpochMicroseconds(BigInt(Date.now() + 5_000) * 1_000n),
    }
    await recorder.start(lifecycle)
    const executionId = randomUUID()
    const context = {
      executionId,
      traceId: 'e'.repeat(32),
      spanId: 'f'.repeat(16),
    }
    for (const [kind, name] of [
      ['execution', 'GET /shared'] as const,
      ['http', 'GET /shared'] as const,
    ]) {
      recorder.record({
        id: randomUUID(),
        occurredAt: new Date().toISOString(),
        kind,
        name,
        phase: 'started',
        context,
        attributes: {},
      })
    }
    for (const [kind, name] of [
      ['execution', 'GET /shared'] as const,
      ['http', 'GET /shared'] as const,
    ]) {
      recorder.record({
        id: randomUUID(),
        occurredAt: new Date().toISOString(),
        kind,
        name,
        phase: 'completed',
        durationMilliseconds: 25,
        context,
        attributes: {},
      })
    }
    await recorder.dispose(lifecycle)

    const result = await pool().query<{ kind: string; phase: string }>(
      `SELECT kind, phase FROM doxa_theoria_observations
       WHERE execution_id = $1 ORDER BY sequence`,
      [executionId],
    )
    expect(result.rows).toEqual([
      { kind: 'execution', phase: 'started' },
      { kind: 'execution', phase: 'completed' },
      { kind: 'http', phase: 'started' },
      { kind: 'http', phase: 'completed' },
    ])
  })

  it('serves the read-only Theoria explorer from its dedicated loopback host', async () => {
    const host = await listenTheoria({ connectionString: connectionString(), port: 0 })
    try {
      const page = await fetch(host.url)
      expect(page.status).toBe(200)
      const html = await page.text()
      expect(html).toContain('Everything beneath the surface')
      expect(html).toContain('.filters{flex:0 0 auto')
      expect(html).toContain('.scroll{flex:1 1 auto}')
      expect(await (await fetch(new URL('/api/health', host.url))).json()).toEqual({
        ok: true,
        data: { service: 'theoria' },
      })
      expect((await fetch(new URL('/api/executions', host.url))).headers.get('cache-control')).toBe(
        'no-store',
      )
      expect((await fetch(new URL('/api/entries?kind=event', host.url))).status).toBe(200)
      expect((await fetch(new URL('/api/entries', host.url))).status).toBe(200)
      const invalidQuery = await fetch(new URL('/api/executions?limit=not-a-number', host.url))
      expect(invalidQuery.status).toBe(400)
      expect(await invalidQuery.json()).toEqual({
        ok: false,
        code: 'invalid_query',
        message: 'Theoria query parameters are invalid.',
        data: null,
      })
      expect((await fetch(new URL('/api/executions', host.url), { method: 'POST' })).status).toBe(
        405,
      )
    } finally {
      await host.shutdown()
    }
    await expect(
      listenTheoria({ connectionString: connectionString(), host: '0.0.0.0', port: 0 }),
    ).rejects.toThrow('production-diagnostics')
  })

  it('protects and audits non-loopback production explorer access', async () => {
    const audit: Array<{ outcome: string; operatorId?: string }> = []
    const host = await listenTheoria({
      connectionString: connectionString(),
      host: '0.0.0.0',
      port: 0,
      profile: 'production-diagnostics',
      access: { mode: 'bearer', token: 't'.repeat(32), operatorId: 'operator:aaron' },
      audit: (event) => audit.push(event),
    })
    try {
      expect((await fetch(new URL('/api/health', host.url))).status).toBe(401)
      expect(
        (
          await fetch(new URL('/api/health', host.url), {
            headers: { authorization: `bearer ${'t'.repeat(32)}` },
          })
        ).status,
      ).toBe(200)
      expect(audit).toEqual([
        expect.objectContaining({ outcome: 'denied' }),
        expect.objectContaining({ outcome: 'allowed', operatorId: 'operator:aaron' }),
      ])
    } finally {
      await host.shutdown()
    }
  })

  it('accepts trusted-proxy identities only from explicit proxy and operator allowlists', async () => {
    const host = await listenTheoria({
      connectionString: connectionString(),
      host: '127.0.0.1',
      port: 0,
      access: {
        mode: 'trusted-proxy',
        identityHeader: 'x-theoria-operator',
        allowedOperators: ['operator:aaron'],
        trustedProxyAddresses: ['127.0.0.1'],
        proxyTrusted: true,
      },
      audit: () => undefined,
    })
    try {
      expect(
        (
          await fetch(new URL('/api/health', host.url), {
            headers: { 'x-theoria-operator': 'operator:mallory' },
          })
        ).status,
      ).toBe(401)
      expect(
        (
          await fetch(new URL('/api/health', host.url), {
            headers: { 'x-theoria-operator': 'operator:aaron' },
          })
        ).status,
      ).toBe(200)
    } finally {
      await host.shutdown()
    }
  })
}
