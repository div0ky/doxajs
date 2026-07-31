import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import { runPraxis } from '@doxajs/praxis'
import { installAuthSchema } from '@doxajs/auth-postgres'
import { PostgresAuth } from '@doxajs/auth-postgres/framework'
import {
  AfterCommitError,
  AuthorizationError,
  type ActionClass,
  type ExecutionContext,
  DetachedModelError,
  EventDispatchError,
  HttpError,
  SignalDispatchError,
  ModelNotFoundError,
  ReadOnlyModelError,
  UnknownModelAttributeError,
  OptimisticConcurrencyError,
  PersistenceError,
  ObservationRecorder,
  isRecentPasswordAuthentication,
  ReadOnlyExecutionError,
  StaleUnitOfWorkError,
  StaleModelError,
  Telemetry,
  type TelemetryRecord,
  type TelemetrySpanEnd,
  type TelemetrySpanHandle,
  type TelemetrySpanStart,
  type UnitOfWork,
  Model,
  type ModelAttributes,
} from '@doxajs/core'
import { ModelSession, runWithModelSession } from '@doxajs/core/runtime'
import {
  installPersistenceSchema,
  installCacheSchema,
  installCommunicationsSchema,
  PostgresTransactionManager,
} from '@doxajs/postgres-drizzle'
import { clearQueueJobs, inspectQueueJob, installQueueSchema } from '@doxajs/queue-pg-boss'
import { HonoHttpEngine, HonoHttpHost } from '@doxajs/http-hono'
import { Doxa, type DoxaRuntime } from '@doxajs/runtime'
import { installTheoriaSchema, listenTheoria, pruneTheoria, TheoriaStore } from '@doxajs/theoria'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { Application } from '../examples/persistence-app/dist/application.js'
import { AttemptCounterWrite } from '../examples/persistence-app/dist/counters/queries/attempt-counter-write.js'
import { AssignCounterTag } from '../examples/persistence-app/dist/counters/actions/assign-counter-tag.js'
import {
  capturedCounter,
  capturedCounterQuery,
  CaptureCounter,
  resetCapturedCounter,
} from '../examples/persistence-app/dist/counters/actions/capture-counter.js'
import { Counter } from '../examples/persistence-app/dist/counters/models/counter.js'
import { HttpPinged } from '../examples/persistence-app/dist/system/events/http-pinged.js'
import { CreateCounter } from '../examples/persistence-app/dist/counters/actions/create-counter.js'
import { CreateCounterNote } from '../examples/persistence-app/dist/counters/actions/create-counter-note.js'
import { CreateDomainCounter } from '../examples/persistence-app/dist/counters/actions/create-domain-counter.js'
import { DeleteCounter } from '../examples/persistence-app/dist/counters/actions/delete-counter.js'
import { DispatchProcessCounter } from '../examples/persistence-app/dist/counters/actions/dispatch-process-counter.js'
import { DispatchCounterSignal } from '../examples/persistence-app/dist/counters/actions/dispatch-counter-signal.js'
import { ExerciseCache } from '../examples/persistence-app/dist/counters/actions/exercise-cache.js'
import { ExerciseReadOnlyLegacyCustomer } from '../examples/persistence-app/dist/counters/actions/exercise-read-only-legacy-customer.js'
import { QueueNotifications } from '../examples/persistence-app/dist/counters/actions/queue-notifications.js'
import { CounterTouched } from '../examples/persistence-app/dist/counters/signals/counter-touched.js'
import { CounterCreated } from '../examples/persistence-app/dist/counters/events/counter-created.js'
import {
  recordedEvents,
  resetRecordedEvents,
} from '../examples/persistence-app/dist/support/recorded-events.js'
import { SaveDetachedCounter } from '../examples/persistence-app/dist/counters/actions/save-detached-counter.js'
import { InspectCounter } from '../examples/persistence-app/dist/counters/actions/inspect-counter.js'
import { IncrementMatchingCounters } from '../examples/persistence-app/dist/counters/actions/increment-matching-counters.js'
import { RefreshCounter } from '../examples/persistence-app/dist/counters/actions/refresh-counter.js'
import { RecordLegacyCustomerActivity } from '../examples/persistence-app/dist/counters/actions/record-legacy-customer-activity.js'
import { RenameCounter } from '../examples/persistence-app/dist/counters/actions/rename-counter.js'
import { SaveCounter } from '../examples/persistence-app/dist/counters/actions/save-counter.js'
import {
  capturedCounterFindQuery,
  InspectCounterQueries,
  resetCapturedCounterFindQuery,
} from '../examples/persistence-app/dist/counters/queries/inspect-counter-queries.js'
import {
  authorizedActionUser,
  authorizedJobUser,
  authorizedQueryUser,
  ChangeAuthorizedUserBranch,
  DispatchChangeAuthorizedUserBranchJob,
  ReadAuthorizedUser,
  resetAuthorizationOperationProof,
  SeedLegacyAccess,
} from '../examples/persistence-app/dist/authorization/authorization-operations.js'
import {
  permissionSourceDeleteError,
  permissionSourceResolutions,
  permissionSourceUser,
  permissionSourceWriteError,
  resetPermissionSourceProof,
} from '../examples/persistence-app/dist/authorization/application-permissions.js'
import {
  nestedPolicyUser,
  policyAfterCommitRan,
  policyUser,
  policyUnitOfWorkWriteError,
  policyWriteError,
  resetPolicyProof,
} from '../examples/persistence-app/dist/authorization/application-policy.js'
import { SaveLegacyCustomer } from '../examples/persistence-app/dist/counters/actions/save-legacy-customer.js'
import { ClearLegacyCustomerNickname } from '../examples/persistence-app/dist/counters/actions/clear-legacy-customer-nickname.js'
import { DeleteLegacyCustomer } from '../examples/persistence-app/dist/counters/actions/delete-legacy-customer.js'
import { SaveLegacyNote } from '../examples/persistence-app/dist/counters/actions/save-legacy-note.js'
import { RequestCounterNotification } from '../examples/persistence-app/dist/counters/actions/request-counter-notification.js'
import {
  recordedJobAttempts,
  resetRecordedJobAttempts,
} from '../examples/persistence-app/dist/support/job-attempts.js'
import {
  observerLog,
  resetObserverLog,
} from '../examples/persistence-app/dist/support/observer-log.js'
import {
  commandLog,
  resetCommandLog,
} from '../examples/persistence-app/dist/support/command-log.js'
import {
  resetTelemetryRecords,
  telemetryRecords,
} from '../examples/persistence-app/dist/infrastructure/telemetry/reference-telemetry.js'
import { registerCompilationAndTheoriaTests } from './persistence/compilation-and-theoria.js'

const workspace = path.resolve(import.meta.dirname, '..')
const { privateKey: sendGridPrivateKey, publicKey: sendGridPublicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const twilioAuthToken = 'test-twilio-auth-token'
const persistenceApplication = path.join(workspace, 'examples/persistence-app')
const postgresTestImage = process.env.DOXA_TEST_POSTGRES_IMAGE ?? 'postgres:17-alpine'
const temporaryDirectories: string[] = []
const runtimes: DoxaRuntime[] = []
const hosts: HonoHttpHost[] = []
let container: StartedPostgreSqlContainer
let connectionString: string
let pool: Pool
let executionSequence = 0

class ReplacingSpanTelemetry extends Telemetry {
  record(_record: TelemetryRecord): void {}

  startSpan(input: TelemetrySpanStart): TelemetrySpanHandle {
    return Object.freeze({
      context: Object.freeze({
        ...input.context,
        traceId: input.context.parentSpanId
          ? input.context.traceId!
          : randomBytes(16).toString('hex'),
        spanId: randomBytes(8).toString('hex'),
      }),
      end(_result: TelemetrySpanEnd): void {},
    })
  }
}

describe('PostgreSQL and Drizzle persistence slice', () => {
  beforeAll(async () => {
    await compilePersistenceApplication(path.join(persistenceApplication, '.doxa'))
    await copyFile(
      path.join(persistenceApplication, 'dist/application.js'),
      path.join(persistenceApplication, 'dist/app.config.js'),
    )
    container = await new PostgreSqlContainer(postgresTestImage).start()
    connectionString = container.getConnectionUri()
    await installPersistenceSchema(connectionString)
    await installCacheSchema(connectionString)
    await installCommunicationsSchema(connectionString)
    await installAuthSchema(connectionString)
    await installQueueSchema(connectionString)
    await installTheoriaSchema(connectionString)
    pool = new Pool({ connectionString })
    await pool.query(`
      CREATE TABLE legacy_customers (
        customer_id text PRIMARY KEY,
        full_name text NOT NULL,
        enabled boolean NOT NULL,
        nickname text,
        nullable_code text,
        password_hash text NOT NULL DEFAULT 'never-selected',
        api_token text NOT NULL DEFAULT 'never-selected-token',
        vendor_state text NOT NULL DEFAULT 'externally-managed',
        trigger_revision integer NOT NULL DEFAULT 0,
        lock_version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await pool.query(`
      CREATE FUNCTION maintain_legacy_customer_revision() RETURNS trigger AS $$
      BEGIN
        NEW.trigger_revision = OLD.trigger_revision + 1;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER maintain_legacy_customer_revision
      BEFORE UPDATE ON legacy_customers
      FOR EACH ROW EXECUTE FUNCTION maintain_legacy_customer_revision()
    `)
    await pool.query(`
      CREATE TABLE legacy_auth_users (
        external_id text PRIMARY KEY,
        email_address text NOT NULL UNIQUE,
        verified_at timestamptz,
        created_on timestamptz NOT NULL,
        updated_on timestamptz NOT NULL,
        password_record text NOT NULL
      )
    `)
    await pool.query(
      `CREATE UNIQUE INDEX legacy_auth_users_email_lower_idx ON legacy_auth_users (lower(email_address))`,
    )
    await pool.query(`CREATE TABLE legacy_notes (id text PRIMARY KEY, body text NOT NULL)`)
  })

  beforeEach(async () => {
    resetCapturedCounter()
    resetCapturedCounterFindQuery()
    resetAuthorizationOperationProof()
    resetPermissionSourceProof()
    resetPolicyProof()
    resetRecordedEvents()
    resetRecordedJobAttempts()
    resetObserverLog()
    resetCommandLog()
    resetTelemetryRecords()
    await clearQueueJobs(connectionString)
    await pool.query(`
      TRUNCATE
        doxa_auth_audit_events,
        doxa_auth_rate_limits,
        doxa_auth_challenges,
        doxa_auth_access_tokens,
        doxa_auth_sessions,
        doxa_auth_passwords,
        doxa_auth_identities,
        doxa_outbox_messages,
        doxa_journal_entries,
        doxa_entity_states
        , doxa_cache_entries,
        doxa_delivery_events,
        doxa_delivery_messages
        , legacy_customers
        , legacy_auth_users
        , legacy_notes
        , doxa_theoria_observations
    `)
  })

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.shutdown()))
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()))
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, {
          recursive: true,
          force: true,
        }),
      ),
    )
  })

  afterAll(async () => {
    await pool?.end()
    await container?.stop()
  })

  registerCompilationAndTheoriaTests({
    pool: () => pool,
    connectionString: () => connectionString,
    sendGridPublicKey,
    twilioAuthToken,
    runtimes,
    compilePersistenceApplication,
    temporaryDirectory,
    bootPersistenceRuntime,
    responseData,
    waitFor,
    runAction,
  })

  it('commits entity state, journal, outbox, and causal metadata atomically', async () => {
    const runtime = await bootPersistenceRuntime()
    const result = await runtime.admit(
      {
        actor: { kind: 'user', id: 'actor-42' },
        initiator: { kind: 'service', id: 'importer-7' },
        tenant: { id: 'tenant-3' },
        correlationId: 'correlation-1',
        causationId: 'request-9',
        transport: { kind: 'test' },
      },
      (context) =>
        runtime.actions
          .execute(SaveCounter, {
            id: 'counter-1',
            amount: 2,
          })
          .then((saved) => ({ context, saved })),
    )

    expect(result.saved).toEqual({
      id: 'counter-1',
      value: 2,
      version: 1,
      originalValue: undefined,
      changes: { id: 'counter-1', value: 2 },
      dirtyBeforeSave: true,
      cleanAfterSave: true,
      wasChanged: true,
      exists: true,
      recentlyCreated: true,
    })
    const entity = await pool.query<{
      state: { value: number }
      version: number
    }>(`SELECT state, version FROM doxa_entity_states WHERE entity_id = 'counter-1'`)
    const journal = await pool.query<{
      fact_type: string
      context: Record<string, unknown>
    }>('SELECT fact_type, context FROM doxa_journal_entries')
    const outbox = await pool.query<{
      message_type: string
      status: string
      context: Record<string, unknown>
    }>('SELECT message_type, status, context FROM doxa_outbox_messages')

    expect(entity.rows).toEqual([{ state: { id: 'counter-1', value: 2 }, version: 1 }])
    expect(journal.rows).toEqual([expect.objectContaining({ fact_type: 'counter.incremented' })])
    expect(outbox.rows).toEqual([
      expect.objectContaining({
        message_type: 'counter.changed',
        status: 'pending',
      }),
    ])
    for (const durable of [journal.rows[0]!.context, outbox.rows[0]!.context]) {
      expect(durable).toEqual({
        executionId: result.context.executionId,
        correlationId: 'correlation-1',
        causationId: 'request-9',
        actor: { kind: 'user', id: 'actor-42' },
        initiator: { kind: 'service', id: 'importer-7' },
        tenant: { id: 'tenant-3' },
        trace: result.context.trace,
      })
    }
  })

  it('rolls back entity state, journal, outbox, and after-commit work together', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'rollback-test' },
          transport: { kind: 'test' },
        },
        () =>
          runtime.actions.execute(SaveCounter, {
            id: 'counter-rollback',
            amount: 5,
            failAfterWrites: true,
          }),
      ),
    ).rejects.toThrow('failed after persistence writes')

    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 0, outbox: 0 })
  })

  it('dispatches local and after-commit class listeners from model behavior in order', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit(
      {
        actor: { kind: 'user', id: 'event-user' },
        correlationId: 'event-success',
        transport: { kind: 'test' },
      },
      () =>
        runtime.actions.execute(SaveCounter, {
          id: 'event-counter',
          amount: 2,
        }),
    )

    expect(recordedEvents).toEqual([
      {
        event: 'counter-incremented',
        phase: 'local',
        correlationId: 'event-success',
        actor: 'user',
        value: 2,
      },
      {
        event: 'counter-incremented',
        phase: 'after-commit',
        correlationId: 'event-success',
        actor: 'user',
        value: 2,
      },
      {
        event: 'counter-saved',
        phase: 'after-commit',
        correlationId: 'event-success',
        actor: 'user',
        value: 2,
      },
    ])
  })

  it('journals DomainEvents atomically and refuses to lose them outside a Unit of Work', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit(
      {
        actor: { kind: 'user', id: 'domain-user' },
        correlationId: 'domain-correlation',
        transport: { kind: 'test' },
      },
      () => runtime.actions.execute(CreateDomainCounter, { id: 'domain-counter', value: 4 }),
    )

    await waitFor(() =>
      recordedEvents.some((event) => event.event === 'counter-created:domain-counter'),
    )
    expect(recordedEvents).toContainEqual({
      event: 'counter-created:domain-counter',
      phase: 'domain',
      correlationId: 'domain-correlation',
      actor: 'user',
      value: 4,
    })
    const journal = await pool.query<{
      fact_type: string
      payload_version: number
      entity_type: string
      entity_id: string
      payload: unknown
    }>(
      `SELECT fact_type, payload_version, entity_type, entity_id, payload
       FROM doxa_journal_entries
       WHERE entity_id = 'domain-counter'`,
    )
    expect(journal.rows).toEqual([
      {
        fact_type: 'event:counters/counter-created',
        payload_version: 1,
        entity_type: 'model:counters/counter',
        entity_id: 'domain-counter',
        payload: { value: 4 },
      },
    ])

    await expect(
      runtime.admit(
        { actor: { kind: 'system', id: 'domain-outside' }, transport: { kind: 'test' } },
        () => CounterCreated.dispatch('outside', { value: 1 }),
      ),
    ).rejects.toThrow('requires an active writable Unit of Work')

    await expect(
      runAction(runtime, CreateDomainCounter, { id: 'domain-rollback', value: 2, fail: true }),
    ).rejects.toThrow('Domain event transaction failed')
    expect(
      (await pool.query(`SELECT 1 FROM doxa_journal_entries WHERE entity_id = 'domain-rollback'`))
        .rowCount,
    ).toBe(0)
    expect(
      (await pool.query(`SELECT 1 FROM doxa_entity_states WHERE entity_id = 'domain-rollback'`))
        .rowCount,
    ).toBe(0)
  })

  it('discards after-commit event work on rollback and propagates local listener failures', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'event-rollback' },
          correlationId: 'event-rollback',
          transport: { kind: 'test' },
        },
        () =>
          runtime.actions.execute(SaveCounter, {
            id: 'event-rollback',
            amount: 2,
            failAfterWrites: true,
          }),
      ),
    ).rejects.toThrow('failed after persistence writes')
    expect(recordedEvents).toEqual([
      expect.objectContaining({ phase: 'local', correlationId: 'event-rollback' }),
    ])
    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 0, outbox: 0 })

    resetRecordedEvents()
    await expect(
      runAction(runtime, SaveCounter, { id: 'rejected-event', amount: 13 }),
    ).rejects.toThrow('Unlucky counter increments are rejected locally.')
    expect(recordedEvents).toEqual([])
    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 0, outbox: 0 })
  })

  it('dispatches declared signals immediately inside the current execution', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit(
      {
        actor: { kind: 'user', id: 'signal-user' },
        correlationId: 'signal-correlation',
        transport: { kind: 'test' },
      },
      () => runtime.actions.execute(DispatchCounterSignal, { counterId: 'counter-7' }),
    )

    expect(recordedEvents).toEqual([
      {
        event: 'counter-touched:counter-7',
        phase: 'signal',
        correlationId: 'signal-correlation',
        actor: 'user',
      },
    ])
  })

  it('injects the application cache with atomic add, increment, TTL, and remember semantics', async () => {
    const runtime = await bootPersistenceRuntime()
    const result = await runAction(runtime, ExerciseCache, 'cache-proof')
    expect(result).toEqual({
      added: true,
      duplicateAdded: false,
      incremented: 3,
      remembered: 'computed',
    })
  })

  it('stages mail and SMS atomically and delivers them through queued transports', async () => {
    const runtime = await bootPersistenceRuntime()
    const result = await runAction(runtime, QueueNotifications, undefined)
    await waitFor(async () => {
      const rows = await pool.query<{ state: string }>(
        `
        SELECT state FROM doxa_delivery_messages WHERE id = ANY($1::uuid[]) ORDER BY channel
      `,
        [[result.mailId, result.smsId]],
      )
      return rows.rows.length === 2 && rows.rows.every((row) => row.state === 'accepted')
    })
    const deliveries = await pool.query<{
      channel: string
      state: string
      context: { actor: { kind: string }; correlationId: string }
    }>(
      `
      SELECT channel, state, context FROM doxa_delivery_messages WHERE id = ANY($1::uuid[]) ORDER BY channel
    `,
      [[result.mailId, result.smsId]],
    )
    expect(deliveries.rows).toEqual([
      expect.objectContaining({
        channel: 'mail',
        state: 'accepted',
        context: expect.objectContaining({ actor: expect.objectContaining({ kind: 'system' }) }),
      }),
      expect.objectContaining({
        channel: 'sms',
        state: 'accepted',
        context: expect.objectContaining({ actor: expect.objectContaining({ kind: 'system' }) }),
      }),
    ])
  })

  it('rolls back staged communications and queue handoff with a failed action', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(runAction(runtime, QueueNotifications, { failAfterQueue: true })).rejects.toThrow(
      'failed after queuing communications',
    )
    expect((await pool.query('SELECT 1 FROM doxa_delivery_messages')).rowCount).toBe(0)
    expect(
      (await pool.query(`SELECT 1 FROM doxa_outbox_messages WHERE message_type = 'doxa.queue'`))
        .rowCount,
    ).toBe(0)
  })

  it('verifies, normalizes, and deduplicates provider delivery webhooks', async () => {
    const runtime = await bootPersistenceRuntime()
    const queued = await runAction(runtime, QueueNotifications, undefined)
    await waitFor(async () => {
      const rows = await pool.query<{ state: string }>(
        `SELECT state FROM doxa_delivery_messages WHERE id = ANY($1::uuid[])`,
        [[queued.mailId, queued.smsId]],
      )
      return rows.rows.length === 2 && rows.rows.every((row) => row.state === 'accepted')
    })
    const http = new HonoHttpEngine(runtime)

    const timestamp = String(Math.floor(Date.now() / 1_000))
    const mailBody = JSON.stringify([
      {
        event: 'delivered',
        sg_event_id: 'sendgrid-event-1',
        sg_message_id: 'sendgrid-message-1',
        doxa_message_id: queued.mailId,
      },
    ])
    const mailSignature = sign(
      'sha256',
      Buffer.from(timestamp + mailBody),
      sendGridPrivateKey,
    ).toString('base64')
    const sendGridResponse = await http.fetch(
      new Request('http://doxa.test/webhooks/sendgrid', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-twilio-email-event-webhook-timestamp': timestamp,
          'x-twilio-email-event-webhook-signature': mailSignature,
        },
        body: mailBody,
      }),
    )
    expect(sendGridResponse.status).toBe(204)

    const twilioUrl = `http://doxa.test/webhooks/twilio/sms?doxa_message_id=${queued.smsId}`
    const form = { MessageSid: 'SM-delivery-1', MessageStatus: 'delivered' }
    const formBody = new URLSearchParams(form).toString()
    const twilioSignature = createHmac('sha1', twilioAuthToken)
      .update(
        twilioUrl +
          Object.keys(form)
            .sort()
            .map((key) => key + form[key as keyof typeof form])
            .join(''),
      )
      .digest('base64')
    const twilioResponse = await http.fetch(
      new Request(twilioUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': twilioSignature,
        },
        body: formBody,
      }),
    )
    expect(twilioResponse.status).toBe(204)

    const duplicate = await http.fetch(
      new Request('http://doxa.test/webhooks/sendgrid', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-twilio-email-event-webhook-timestamp': timestamp,
          'x-twilio-email-event-webhook-signature': mailSignature,
        },
        body: mailBody,
      }),
    )
    expect(duplicate.status).toBe(204)
    const rows = await pool.query<{ id: string; state: string; provider_message_id: string }>(
      `
      SELECT id, state, provider_message_id FROM doxa_delivery_messages
      WHERE id = ANY($1::uuid[]) ORDER BY channel
    `,
      [[queued.mailId, queued.smsId]],
    )
    expect(rows.rows).toEqual([
      { id: queued.mailId, state: 'delivered', provider_message_id: 'sendgrid-message-1' },
      { id: queued.smsId, state: 'delivered', provider_message_id: 'SM-delivery-1' },
    ])
    expect(
      (await pool.query(`SELECT 1 FROM doxa_delivery_events WHERE event_id = 'sendgrid-event-1'`))
        .rowCount,
    ).toBe(1)

    const rejected = await http.fetch(
      new Request('http://doxa.test/webhooks/sendgrid', {
        method: 'POST',
        headers: {
          'x-twilio-email-event-webhook-timestamp': timestamp,
          'x-twilio-email-event-webhook-signature': 'invalid',
        },
        body: mailBody,
      }),
    )
    expect(rejected.status).toBe(403)
  })

  it('inspects and safely redrives failed communications through Praxis', async () => {
    const runtime = await bootPersistenceRuntime()
    const queued = await runAction(runtime, QueueNotifications, { smsFrom: '+13125550000' })
    await waitFor(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM doxa_delivery_messages WHERE id = $1 AND state = 'accepted'`,
            [queued.smsId],
          )
        ).rowCount === 1,
    )
    expect(
      (
        await pool.query<{ payload: { from?: string } }>(
          `SELECT payload FROM doxa_delivery_messages WHERE id = $1`,
          [queued.smsId],
        )
      ).rows[0]?.payload.from,
    ).toBe('+13125550000')
    await pool.query(
      `UPDATE doxa_delivery_messages SET state = 'undelivered', failure_kind = 'transient', failure_code = 'test' WHERE id = $1`,
      [queued.smsId],
    )
    const output: string[] = []
    const errors: string[] = []
    expect(
      await runPraxis(['delivery:list', `--database=${connectionString}`], workspace, {
        out: (message) => output.push(message),
        error: (message) => errors.push(message),
      }),
    ).toBe(0)
    expect(output.some((line) => line.includes(queued.smsId) && line.includes('undelivered'))).toBe(
      true,
    )
    expect(
      await runPraxis(
        ['delivery:retry', queued.smsId, `--database=${connectionString}`],
        workspace,
        {
          out: (message) => output.push(message),
          error: (message) => errors.push(message),
        },
      ),
    ).toBe(0)
    expect(
      (
        await pool.query<{ sender: string | null }>(
          `
          SELECT payload->'payload'->>'from' AS sender
          FROM doxa_outbox_messages
          WHERE payload->>'kind' = 'sms' AND payload->'payload'->>'id' = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
          [queued.smsId],
        )
      ).rows[0]?.sender,
    ).toBe('+13125550000')
    await waitFor(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM doxa_delivery_messages WHERE id = $1 AND state = 'accepted'`,
            [queued.smsId],
          )
        ).rowCount === 1,
    )
    expect(errors).toEqual([])
    expect(
      await runPraxis(
        ['delivery:retry', queued.smsId, `--database=${connectionString}`],
        workspace,
        {
          out: () => undefined,
          error: (message) => errors.push(message),
        },
      ),
    ).toBe(1)
    expect(errors.at(-1)).toContain('only failed or undelivered deliveries may be retried')
  })

  it('applies ordered framework and application migrations with status and drift protection', async () => {
    await pool.query('DROP SCHEMA IF EXISTS pgboss CASCADE')
    await pool.query('DROP TABLE IF EXISTS doxa_schedule_controls')
    await pool.query('DROP TABLE IF EXISTS doxa_migrations')
    const root = await temporaryDirectory()
    await mkdir(path.join(root, 'migrations'))
    await writeFile(
      path.join(root, 'package.json'),
      `${JSON.stringify({ dependencies: { '@doxajs/queue-pg-boss': 'workspace:*' } })}\n`,
    )
    const migration = path.join(root, 'migrations/20260710_create_praxis_proof.sql')
    await writeFile(migration, 'CREATE TABLE praxis_migration_proof (id text PRIMARY KEY);\n')
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    }
    expect(await runPraxis(['migrate', `--database=${connectionString}`], root, io)).toBe(0)
    expect(output.filter((line) => line.startsWith('Migrated framework/'))).toEqual([
      'Migrated framework/postgres-drizzle/0001_doxa_cache.sql',
      'Migrated framework/postgres-drizzle/0001_doxa_communications.sql',
      'Migrated framework/postgres-drizzle/0001_doxa_durability.sql',
      'Migrated framework/auth-postgres/0001_doxa_auth.sql',
      'Migrated framework/auth-postgres/0003_challenge_recipient_binding.sql',
      'Migrated framework/queue-pg-boss/0001_doxa_schedule_controls.sql',
      'Migrated framework/queue-pg-boss/0002_doxa_queue_attempt_traces.sql',
    ])
    expect(
      (await pool.query(`SELECT to_regclass('pgboss.job') AS relation`)).rows[0]?.relation,
    ).toBe('pgboss.job')
    expect(
      output.some((line) => line.includes('application/20260710_create_praxis_proof.sql')),
    ).toBe(true)
    output.length = 0
    expect(await runPraxis(['migrate:status', `--database=${connectionString}`], root, io)).toBe(0)
    expect(
      output.some(
        (line) =>
          line.includes('applied') && line.includes('application/20260710_create_praxis_proof.sql'),
      ),
    ).toBe(true)
    await writeFile(migration, 'CREATE TABLE praxis_migration_proof (id uuid PRIMARY KEY);\n')
    output.length = 0
    expect(await runPraxis(['migrate:status', `--database=${connectionString}`], root, io)).toBe(0)
    expect(
      output.some(
        (line) =>
          line.includes('drifted') && line.includes('application/20260710_create_praxis_proof.sql'),
      ),
    ).toBe(true)
    expect(await runPraxis(['migrate', `--database=${connectionString}`], root, io)).toBe(1)
    expect(errors.at(-1)).toContain('has changed; create a new migration instead')
  })

  it('exposes first-party auth table ownership to Praxis', async () => {
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    }

    expect(
      await runPraxis(
        ['auth:storage', `--database=${connectionString}`],
        persistenceApplication,
        io,
      ),
    ).toBe(0)
    expect(output).toEqual(
      expect.arrayContaining([
        'authentication doxa-owned',
        expect.stringContaining('identities'),
        expect.stringContaining('doxa_auth_identities'),
      ]),
    )
    expect(errors).toEqual([])
  })

  it('selects only Doxa-owned infrastructure migrations for external identity mappings', async () => {
    const root = await temporaryDirectory()
    await mkdir(path.join(root, '.doxa'))
    await writeFile(
      path.join(root, 'package.json'),
      `${JSON.stringify({ dependencies: { '@doxajs/auth-postgres': 'workspace:*' } })}\n`,
    )
    const manifestPath = path.join(root, '.doxa/manifest.json')
    await writeFile(
      manifestPath,
      `${JSON.stringify({ authentication: { source: 'table', verification: { mode: 'trusted' } } })}\n`,
    )
    const output: string[] = []
    expect(
      await runPraxis(['migrate:status', `--database=${connectionString}`], root, {
        out: (message) => output.push(message),
        error: () => undefined,
      }),
    ).toBe(0)
    const migrations = output.filter((line) => line.includes('framework/auth-postgres/'))
    expect(migrations.some((line) => line.includes('0000_auth_infrastructure.sql'))).toBe(true)
    expect(migrations.some((line) => line.includes('sidecar'))).toBe(false)
  })

  it('runs HTTP, scheduler, and worker as independent roles from one manifest', async () => {
    const artifactsDirectory = await temporaryDirectory()
    await compilePersistenceApplication(artifactsDirectory)
    const environment = {
      DATABASE_CONNECTION_STRING: connectionString,
      COMMUNICATIONS_SEND_GRID_WEBHOOK_PUBLIC_KEY: sendGridPublicKey,
      COMMUNICATIONS_TWILIO_AUTH_TOKEN: twilioAuthToken,
    }
    const producer = await Doxa.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment,
      roles: { web: false, worker: false, scheduler: false },
    })
    runtimes.push(producer)
    const jobId = await runAction(producer, DispatchProcessCounter, {
      key: 'topology',
      failUntilAttempt: 0,
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(await inspectQueueJob(connectionString, jobId)).toBeUndefined()
    expect(
      (
        await pool.query(
          `SELECT 1 FROM doxa_outbox_messages WHERE payload->>'id' = $1 AND status = 'pending'`,
          [jobId],
        )
      ).rowCount,
    ).toBe(1)

    const scheduler = await Doxa.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment,
      roles: { web: false, worker: false, scheduler: true },
    })
    runtimes.push(scheduler)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(await inspectQueueJob(connectionString, jobId)).toBeUndefined()

    const worker = await Doxa.boot(Application, {
      artifactsDirectory,
      dotenvPath: false,
      environment,
      roles: { web: false, worker: true, scheduler: false },
    })
    runtimes.push(worker)
    await waitFor(
      async () => (await inspectQueueJob(connectionString, jobId))?.state === 'completed',
    )
    expect(recordedJobAttempts.some((attempt) => attempt.jobId === jobId)).toBe(true)
  })

  it('executes declared console commands in an admitted actor-aware scope', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, SaveCounter, { id: 'command-counter', amount: 1 })
    await runtime.admit(
      {
        actor: { kind: 'system', id: 'doxa:praxis' },
        authentication: { state: 'authenticated', identityId: 'doxa:praxis', method: 'console' },
        transport: { kind: 'console', name: 'doxa:describe' },
      },
      () => runtime.dispatchCommand('doxa:describe', ['--verbose']),
    )
    await runtime.admit(
      {
        actor: { kind: 'system', id: 'doxa:praxis' },
        authentication: { state: 'authenticated', identityId: 'doxa:praxis', method: 'console' },
        transport: { kind: 'console', name: 'counter:mark' },
      },
      () => runtime.dispatchCommand('counter:mark', ['command-counter', 'from-console']),
    )
    expect(commandLog).toEqual([{ arguments: ['--verbose'], actor: 'system' }])
    expect(
      (
        await pool.query<{ state: { label?: string } }>(`
          SELECT state FROM doxa_entity_states WHERE entity_id = 'command-counter'
        `)
      ).rows[0]?.state.label,
    ).toBe('from-console')
  })

  it('emits structured telemetry and propagates W3C trace context through HTTP', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const traceId = '0123456789abcdef0123456789abcdef'
    const response = await http.fetch(
      new Request('http://doxa.test/', {
        headers: { traceparent: `00-${traceId}-0123456789abcdef-01` },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('traceparent')).toMatch(
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`),
    )
    expect(telemetryRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'log', event: 'execution.started' }),
        expect.objectContaining({ kind: 'log', event: 'execution.completed' }),
        expect.objectContaining({ kind: 'metric', name: 'doxa.execution.admitted', value: 1 }),
        expect.objectContaining({ kind: 'metric', name: 'doxa.execution.duration' }),
        expect.objectContaining({ kind: 'span', traceId, status: 'ok' }),
      ]),
    )
    expect(JSON.stringify(telemetryRecords)).not.toContain('test-twilio-auth-token')

    const invalid = await http.fetch(
      new Request('http://doxa.test/', { headers: { traceparent: 'invalid' } }),
    )
    expect(invalid.status).toBe(400)
    expect(await responseFailure(invalid)).toEqual(
      expect.objectContaining({ code: 'invalid_traceparent' }),
    )
  })

  it('runs model observers in Eloquent-style create and update order', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit(
      {
        actor: { kind: 'user', id: 'observer-user' },
        correlationId: 'observer-create',
        transport: { kind: 'test' },
      },
      () => runtime.actions.execute(CreateCounter, { id: 'observed', value: 2 }),
    )
    expect(observerLog.map((entry) => entry.phase)).toEqual([
      'saving',
      'creating',
      'created',
      'saved',
      'committed',
    ])
    expect(observerLog.at(-1)).toEqual(
      expect.objectContaining({
        correlationId: 'observer-create',
        version: 1,
      }),
    )

    resetObserverLog()
    await runtime.admit(
      {
        actor: { kind: 'user', id: 'observer-user' },
        correlationId: 'observer-update',
        transport: { kind: 'test' },
      },
      () => runtime.actions.execute(RenameCounter, { id: 'observed', label: 'renamed' }),
    )
    expect(observerLog.map((entry) => entry.phase)).toEqual([
      'retrieved',
      'saving',
      'updating',
      'updated',
      'saved',
      'committed',
    ])
    expect(observerLog.at(-1)).toEqual(
      expect.objectContaining({
        correlationId: 'observer-update',
        version: 2,
      }),
    )
  })

  it('never runs committed observers when the surrounding action rolls back', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(
      runAction(runtime, SaveCounter, {
        id: 'observer-rollback',
        amount: 1,
        failAfterWrites: true,
      }),
    ).rejects.toThrow('failed after persistence writes')
    expect(observerLog.map((entry) => entry.phase)).toEqual([
      'saving',
      'creating',
      'created',
      'saved',
    ])
    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 0, outbox: 0 })
  })

  it('does not roll back an already-handled signal when its action later fails', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(
      runAction(runtime, DispatchCounterSignal, {
        counterId: 'counter-rollback',
        failAfterDispatch: true,
      }),
    ).rejects.toThrow('failed after signal dispatch')
    expect(recordedEvents).toEqual([
      expect.objectContaining({ event: 'counter-touched:counter-rollback', phase: 'signal' }),
    ])
  })

  it('rejects signal dispatch outside a Doxa execution', () => {
    expect(() => CounterTouched.dispatch({ counterId: 'outside' })).toThrow(SignalDispatchError)
  })

  it('hands committed jobs through the outbox and retries with stable job identity', async () => {
    const runtime = await bootPersistenceRuntime({ telemetry: new ReplacingSpanTelemetry() })
    const jobId = await runtime.admit(
      {
        actor: { kind: 'service', id: 'queue-producer' },
        correlationId: 'queue-retry-correlation',
        transport: { kind: 'test' },
      },
      () =>
        runtime.actions.execute(DispatchProcessCounter, {
          key: 'retry-once',
          failUntilAttempt: 1,
          counterId: 'job-counter',
        }),
    )

    await waitFor(
      async () => (await inspectQueueJob(connectionString, jobId))?.state === 'completed',
    )
    expect(recordedJobAttempts).toHaveLength(2)
    expect(recordedJobAttempts.map((attempt) => attempt.jobId)).toEqual([jobId, jobId])
    expect(recordedJobAttempts.map((attempt) => attempt.attempt)).toEqual([1, 2])
    expect(new Set(recordedJobAttempts.map((attempt) => attempt.executionId)).size).toBe(2)
    for (const attempt of recordedJobAttempts) {
      expect(attempt).toEqual(
        expect.objectContaining({
          correlationId: 'queue-retry-correlation',
          causationId: jobId,
          actor: 'service',
        }),
      )
    }
    await waitFor(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM doxa_theoria_observations
             WHERE kind = 'execution' AND execution_id = ANY($1::uuid[])
               AND phase IN ('completed', 'failed')`,
            [recordedJobAttempts.map((attempt) => attempt.executionId)],
          )
        ).rowCount === 2,
    )
    const traceAttempts = await pool.query<{
      execution_id: string
      trace_id: string
      span_id: string
      span_links: Array<{
        traceId: string
        spanId: string
        attributes?: Record<string, unknown>
      }>
    }>(
      `SELECT execution_id, trace_id, span_id, span_links
       FROM doxa_theoria_observations
       WHERE kind = 'execution' AND execution_id = ANY($1::uuid[])
         AND phase IN ('completed', 'failed')`,
      [recordedJobAttempts.map((attempt) => attempt.executionId)],
    )
    const firstTrace = traceAttempts.rows.find(
      (attempt) => attempt.execution_id === recordedJobAttempts[0]!.executionId,
    )!
    const retryTrace = traceAttempts.rows.find(
      (attempt) => attempt.execution_id === recordedJobAttempts[1]!.executionId,
    )!
    expect(retryTrace.span_links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          traceId: firstTrace.trace_id,
          spanId: firstTrace.span_id,
          attributes: expect.objectContaining({ relationship: 'retry', attempt: 1 }),
        }),
      ]),
    )
    expect(
      Number(
        (
          await pool.query(
            'SELECT count(*) AS count FROM doxa_queue_attempt_traces WHERE job_id = $1',
            [jobId],
          )
        ).rows[0]?.count ?? 0,
      ),
    ).toBe(0)
    expect(await inspectQueueJob(connectionString, jobId)).toEqual(
      expect.objectContaining({
        id: jobId,
        state: 'completed',
        retryCount: 1,
        retryLimit: 2,
      }),
    )
    const jobCounter = await pool.query<{ state: { value: number }; version: number }>(`
      SELECT state, version
      FROM doxa_entity_states
      WHERE entity_id = 'job-counter'
    `)
    expect(jobCounter.rows).toEqual([{ state: { id: 'job-counter', value: 1 }, version: 1 }])
    const outbox = await pool.query<{ status: string; payload: { id: string } }>(`
      SELECT status, payload
      FROM doxa_outbox_messages
      WHERE message_type = 'doxa.queue'
    `)
    expect(outbox.rows).toEqual([
      { status: 'dispatched', payload: expect.objectContaining({ id: jobId }) },
    ])
  })

  it('retains terminal failures and rolls back jobs dispatched by failed actions', async () => {
    const runtime = await bootPersistenceRuntime()
    const failedJobId = await runAction(runtime, DispatchProcessCounter, {
      key: 'terminal',
      failUntilAttempt: 99,
    })
    await waitFor(
      async () => (await inspectQueueJob(connectionString, failedJobId))?.state === 'failed',
    )
    expect(recordedJobAttempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3])
    expect(await inspectQueueJob(connectionString, failedJobId)).toEqual(
      expect.objectContaining({
        state: 'failed',
        retryCount: 2,
        retryLimit: 2,
      }),
    )

    resetRecordedJobAttempts()
    await expect(
      runAction(runtime, DispatchProcessCounter, {
        key: 'rolled-back',
        failAfterDispatch: true,
      }),
    ).rejects.toThrow('Counter job dispatch rolled back.')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(recordedJobAttempts).toEqual([])
    const rolledBackOutbox = await pool.query<{ count: string }>(`
      SELECT count(*)
      FROM doxa_outbox_messages
      WHERE message_type = 'doxa.queue'
        AND payload->>'targetId' = 'job:counters/process-counter'
        AND payload->'payload'->>'key' = 'rolled-back'
    `)
    expect(Number(rolledBackOutbox.rows[0]!.count)).toBe(0)
  })

  it('lists, retries, and cancels durable jobs through Praxis operator commands', async () => {
    const runtime = await bootPersistenceRuntime()
    const jobId = await runAction(runtime, DispatchProcessCounter, {
      key: 'operator',
      failUntilAttempt: 99,
    })
    await waitFor(async () => (await inspectQueueJob(connectionString, jobId))?.state === 'failed')
    await runtime.shutdown()
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    }
    expect(await runPraxis(['queue:failed', `--database=${connectionString}`], workspace, io)).toBe(
      0,
    )
    expect(output.some((line) => line.includes(jobId) && line.includes('failed'))).toBe(true)
    expect(
      await runPraxis(['queue:retry', jobId, `--database=${connectionString}`], workspace, io),
    ).toBe(0)
    expect((await inspectQueueJob(connectionString, jobId))?.state).toMatch(/created|retry/)
    expect(
      await runPraxis(['queue:cancel', jobId, `--database=${connectionString}`], workspace, io),
    ).toBe(0)
    expect((await inspectQueueJob(connectionString, jobId))?.state).toBe('cancelled')
    expect(errors).toEqual([])
  })

  it('deduplicates one declared job by a stable Doxa idempotency key', async () => {
    const runtime = await bootPersistenceRuntime()
    const [first, second] = await Promise.all([
      runAction(runtime, DispatchProcessCounter, {
        key: 'idempotent',
        idempotencyKey: 'counter:idempotent',
      }),
      runAction(runtime, DispatchProcessCounter, {
        key: 'idempotent',
        idempotencyKey: 'counter:idempotent',
      }),
    ])
    expect(second).toBe(first)
    await waitFor(
      async () => (await inspectQueueJob(connectionString, first))?.state === 'completed',
    )
    expect(recordedJobAttempts).toEqual([
      expect.objectContaining({ jobId: first, key: 'idempotent', attempt: 1 }),
    ])
    const outbox = await pool.query<{ count: string; dispatched: string }>(`
      SELECT
        count(*) AS count,
        count(*) FILTER (WHERE status = 'dispatched') AS dispatched
      FROM doxa_outbox_messages
      WHERE message_type = 'doxa.queue'
    `)
    expect(outbox.rows[0]).toEqual({ count: '2', dispatched: '2' })
  })

  it('delivers queued listeners with preserved context in a fresh execution', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, SaveCounter, { id: 'queued-counter', amount: 1 })
    await runtime.admit(
      {
        actor: { kind: 'user', id: 'notification-user' },
        correlationId: 'queued-listener-correlation',
        transport: { kind: 'test' },
      },
      () => runtime.actions.execute(RequestCounterNotification, 'queued-counter'),
    )

    await waitFor(() => recordedEvents.some((event) => event.phase === 'queued'))
    const queued = recordedEvents.find((event) => event.phase === 'queued')!
    expect(queued).toEqual(
      expect.objectContaining({
        event: 'counter-notification-requested',
        phase: 'queued',
        correlationId: 'queued-listener-correlation',
        actor: 'user',
        attempt: 1,
      }),
    )
    expect(queued.jobId).toBeDefined()
    expect(queued.executionId).toBeDefined()
    expect(await inspectQueueJob(connectionString, queued.jobId!)).toEqual(
      expect.objectContaining({
        state: 'completed',
        retryCount: 0,
      }),
    )
    expect(
      (
        await pool.query<{ state: { label?: string } }>(`
          SELECT state FROM doxa_entity_states WHERE entity_id = 'queued-counter'
        `)
      ).rows[0]?.state.label,
    ).toBe('notification-delivered')
  })

  it('honors delays and drains an active worker before runtime shutdown', async () => {
    const runtime = await bootPersistenceRuntime()
    const delayedId = await runAction(runtime, DispatchProcessCounter, {
      key: 'delayed',
      delaySeconds: 0.5,
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(recordedJobAttempts).toEqual([])
    await waitFor(
      async () => (await inspectQueueJob(connectionString, delayedId))?.state === 'completed',
    )

    resetRecordedJobAttempts()
    const drainingId = await runAction(runtime, DispatchProcessCounter, {
      key: 'draining',
      holdMilliseconds: 250,
    })
    await waitFor(() => recordedJobAttempts.some((attempt) => attempt.key === 'draining'))
    const shutdown = runtime.shutdown()
    expect(runtime.state).toBe('draining')
    await shutdown
    expect(runtime.state).toBe('stopped')
    expect(await inspectQueueJob(connectionString, drainingId)).toEqual(
      expect.objectContaining({
        state: 'completed',
      }),
    )
  })

  it('reconciles schedules and fires interval work as a causal system job', async () => {
    await bootPersistenceRuntime()
    const schedules = await pool.query<{
      key: string
      cron: string
      timezone: string
    }>(`
      SELECT key, cron, timezone
      FROM pgboss.schedule
      WHERE name = 'doxa-schedules-serial'
    `)
    expect(schedules.rows).toEqual([
      expect.objectContaining({
        key: 'schedule/system/daily-health-check',
        cron: '0 6 * * *',
        timezone: 'America/Chicago',
      }),
    ])

    const interval = await pool.query<{ id: string }>(`
      UPDATE pgboss.job
      SET start_after = now()
      WHERE name = 'doxa-schedules-serial'
        AND data ->> 'id' = 'schedule:counters/process-counters'
      RETURNING id
    `)
    expect(interval.rowCount).toBe(1)
    await waitFor(() =>
      recordedJobAttempts.some((attempt) => attempt.key === 'scheduled-counter-sweep'),
    )
    expect(
      recordedJobAttempts.find((attempt) => attempt.key === 'scheduled-counter-sweep'),
    ).toEqual(
      expect.objectContaining({
        actor: 'system',
        causationId: 'schedule:counters/process-counters',
        attempt: 1,
      }),
    )
    await waitFor(async () => {
      const completed = await pool.query<{ count: string }>(`
        SELECT count(*)
        FROM doxa_theoria_observations
        WHERE execution_id = (
          SELECT execution_id
          FROM doxa_theoria_observations
          WHERE kind = 'schedule' AND name = 'schedule:counters/process-counters'
          ORDER BY occurred_at DESC
          LIMIT 1
        )
          AND kind IN ('execution', 'job')
          AND phase = 'completed'
      `)
      return Number(completed.rows[0]?.count ?? 0) === 2
    })
    const scheduledExecution = await pool.query<{
      kind: string
      transport: string
      phase: string
    }>(`
      SELECT kind, transport, phase
      FROM doxa_theoria_observations
      WHERE execution_id = (
        SELECT execution_id
        FROM doxa_theoria_observations
        WHERE kind = 'schedule' AND name = 'schedule:counters/process-counters'
        ORDER BY occurred_at DESC
        LIMIT 1
      ) AND kind IN ('execution', 'job', 'schedule')
      ORDER BY occurred_at
    `)
    expect(scheduledExecution.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'schedule', transport: 'job', phase: 'occurred' }),
        expect.objectContaining({ kind: 'job', transport: 'job', phase: 'completed' }),
        expect.objectContaining({ kind: 'execution', transport: 'job', phase: 'completed' }),
      ]),
    )
    expect(scheduledExecution.rows.some((entry) => entry.transport === 'schedule')).toBe(false)
    expect(
      (
        await pool.query<{ state: { value: number } }>(`
          SELECT state FROM doxa_entity_states WHERE entity_id = 'scheduled-counter'
        `)
      ).rows[0]?.state.value,
    ).toBe(1)
  })

  it('admits one bounded schedule catch-up across concurrent scheduler replicas', async () => {
    await pool.query(
      `INSERT INTO doxa_schedule_controls (schedule_id, enabled, last_reconciled_at)
       VALUES ('schedule:counters/process-counters', true, now() - interval '3 hours')
       ON CONFLICT (schedule_id) DO UPDATE
       SET enabled = true, last_reconciled_at = EXCLUDED.last_reconciled_at`,
    )

    const [first, second] = await Promise.all([bootPersistenceRuntime(), bootPersistenceRuntime()])
    expect(first.ready).toBe(true)
    expect(second.ready).toBe(true)

    await waitFor(
      () =>
        recordedJobAttempts.filter((attempt) => attempt.key === 'scheduled-counter-sweep').length >=
        1,
    )
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(
      recordedJobAttempts.filter((attempt) => attempt.key === 'scheduled-counter-sweep'),
    ).toHaveLength(1)
  })

  it('inspects journal/outbox/cache and controls schedules through Praxis', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, SaveCounter, { id: 'operator-state', amount: 1 })
    await runAction(runtime, ExerciseCache, 'operator-cache')
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    }
    for (const command of ['journal:list', 'outbox:list', 'cache:list'] as const) {
      expect(await runPraxis([command, `--database=${connectionString}`], workspace, io)).toBe(0)
    }
    expect(output.some((line) => line.includes('counter.incremented'))).toBe(true)
    expect(output.some((line) => line.includes('counter.changed'))).toBe(true)
    expect(output.some((line) => line.includes('operator-cache:counter'))).toBe(true)
    expect(
      await runPraxis(
        ['cache:forget', 'operator-cache:counter', `--database=${connectionString}`],
        workspace,
        io,
      ),
    ).toBe(0)
    expect(
      (await pool.query(`SELECT 1 FROM doxa_cache_entries WHERE key = 'operator-cache:counter'`))
        .rowCount,
    ).toBe(0)

    output.length = 0
    expect(
      await runPraxis(
        ['schedule:status', `--database=${connectionString}`],
        persistenceApplication,
        io,
      ),
    ).toBe(0)
    expect(output.some((line) => line.includes('schedule:counters/process-counters'))).toBe(true)
    expect(
      await runPraxis(
        ['schedule:disable', 'process-counters', `--database=${connectionString}`],
        persistenceApplication,
        io,
      ),
    ).toBe(0)
    expect(
      (
        await pool.query<{ enabled: boolean }>(
          `SELECT enabled FROM doxa_schedule_controls WHERE schedule_id = 'schedule:counters/process-counters'`,
        )
      ).rows[0]?.enabled,
    ).toBe(false)
    await pool.query(
      `UPDATE doxa_schedule_controls
       SET last_reconciled_at = now() - interval '1 day'
       WHERE schedule_id = 'schedule:counters/process-counters'`,
    )
    expect(
      await runPraxis(
        ['schedule:enable', 'process-counters', `--database=${connectionString}`],
        persistenceApplication,
        io,
      ),
    ).toBe(0)
    expect(
      (
        await pool.query<{ fresh: boolean }>(
          `SELECT last_reconciled_at > now() - interval '5 seconds' AS fresh
           FROM doxa_schedule_controls
           WHERE schedule_id = 'schedule:counters/process-counters'`,
        )
      ).rows[0]?.fresh,
    ).toBe(true)
    resetRecordedJobAttempts()
    expect(
      await runPraxis(
        ['schedule:run', 'process-counters', `--database=${connectionString}`],
        persistenceApplication,
        io,
      ),
    ).toBe(0)
    await waitFor(() =>
      Promise.resolve(
        recordedJobAttempts.some((attempt) => attempt.key === 'scheduled-counter-sweep'),
      ),
    )
    expect(errors).toEqual([])
  })

  it('proves the complete actor-aware MVP reference flow through one identity', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const email = 'mvp-flow@example.com'

    const registration = await http.fetch(
      jsonRequest('http://doxa.test/auth/register', {
        identifier: email,
        password: 'complete reference flow password',
      }),
    )
    expect(registration.status).toBe(201)
    const identityId = (await responseData<{ identity: { id: string } }>(registration)).identity.id
    await waitFor(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM doxa_delivery_messages WHERE payload->>'subject' = 'Verify your email'`,
          )
        ).rowCount === 1,
    )
    const verification = await pool.query<{ text: string }>(`
      SELECT payload->>'text' AS text FROM doxa_delivery_messages
      WHERE payload->>'subject' = 'Verify your email' ORDER BY created_at DESC LIMIT 1
    `)
    const verificationToken = verification.rows[0]!.text.split(': ')[1]!
    expect(
      (
        await http.fetch(
          jsonRequest('http://doxa.test/auth/email/verify', { token: verificationToken }),
        )
      ).status,
    ).toBe(200)

    const login = await http.fetch(
      jsonRequest('http://doxa.test/auth/login', {
        identifier: email,
        password: 'complete reference flow password',
      }),
    )
    const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!
    const tokenResponse = await http.fetch(
      new Request('http://doxa.test/auth/tokens', {
        method: 'POST',
        headers: { cookie, origin: 'http://doxa.test', 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'reference-flow',
          constraints: ['counters.write', 'counters.update'],
        }),
      }),
    )
    expect(tokenResponse.status).toBe(201)
    const bearer = (await responseData<{ token: string }>(tokenResponse)).token

    const anonymous = await http.fetch(
      jsonRequest('http://doxa.test/secure/counters/reference-flow/increment', { amount: 2 }),
    )
    expect(anonymous.status).toBe(401)
    const incremented = await http.fetch(
      new Request('http://doxa.test/secure/counters/reference-flow/increment', {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 2 }),
      }),
    )
    expect(incremented.status).toBe(200)
    const result = await responseData<{
      id: string
      value: number
      version: number
      jobId: string
    }>(incremented)
    expect(result).toEqual(expect.objectContaining({ id: 'reference-flow', value: 2, version: 1 }))

    await waitFor(async () => {
      const entity = await pool.query<{ state: { value: number } }>(`
        SELECT state FROM doxa_entity_states WHERE entity_type = 'model:counters/counter' AND entity_id = 'reference-flow'
      `)
      return entity.rows[0]?.state.value === 3
    })
    await waitFor(
      async () =>
        ((await pool.query(`SELECT 1 FROM doxa_delivery_messages WHERE state = 'accepted'`))
          .rowCount ?? 0) >= 3,
    )
    expect(recordedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'counter-incremented', phase: 'local', actor: 'user' }),
        expect.objectContaining({ event: 'counter-saved', phase: 'after-commit', actor: 'user' }),
        expect.objectContaining({
          event: 'counter-touched:reference-flow',
          phase: 'signal',
          actor: 'user',
        }),
        expect.objectContaining({
          event: 'counter-notification-requested',
          phase: 'queued',
          actor: 'user',
        }),
      ]),
    )
    expect(
      observerLog.some(
        (entry) => entry.phase === 'committed' && entry.modelId === 'reference-flow',
      ),
    ).toBe(true)
    expect(recordedJobAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobId: result.jobId,
          key: 'secure:reference-flow',
          actor: 'user',
        }),
      ]),
    )

    const facts = await pool.query(
      `SELECT 1 FROM doxa_journal_entries WHERE entity_id = 'reference-flow' AND fact_type = 'counter.incremented'`,
    )
    const handoffs = await pool.query(
      `SELECT 1 FROM doxa_outbox_messages WHERE context->'actor'->>'id' = $1`,
      [identityId],
    )
    const audit = await pool.query(
      `SELECT 1 FROM doxa_auth_audit_events WHERE identity_id = $1 AND event_type = 'authorization.decided'`,
      [identityId],
    )
    expect(facts.rowCount).toBeGreaterThan(0)
    expect(handoffs.rowCount).toBeGreaterThan(0)
    expect(audit.rowCount).toBeGreaterThan(0)
    expect(telemetryRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'metric', name: 'doxa.authorization.decisions' }),
        expect.objectContaining({ kind: 'metric', name: 'doxa.persistence.transaction.total' }),
        expect.objectContaining({ kind: 'metric', name: 'doxa.queue.delivery.total' }),
        expect.objectContaining({ kind: 'span', status: 'ok' }),
      ]),
    )

    resetRecordedJobAttempts()
    expect(
      await runPraxis(
        ['schedule:run', 'process-counters', `--database=${connectionString}`],
        persistenceApplication,
        { out: () => undefined, error: () => undefined },
      ),
    ).toBe(0)
    await waitFor(() =>
      Promise.resolve(
        recordedJobAttempts.some((attempt) => attempt.key === 'scheduled-counter-sweep'),
      ),
    )
  })

  it('accepts passwords from 8 through 64 characters and rejects either boundary', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const register = (email: string, password: string) =>
      http.fetch(jsonRequest('http://doxa.test/auth/register', { identifier: email, password }))

    const tooShort = await register('seven@example.com', '1234567')
    expect(tooShort.status).toBe(422)
    expect(await responseFailure(tooShort)).toEqual(
      expect.objectContaining({
        code: 'invalid_registration',
        message: 'Passwords must contain between 8 and 64 characters.',
      }),
    )
    expect((await register('eight@example.com', '12345678')).status).toBe(201)
    expect((await register('sixty-four@example.com', 'x'.repeat(64))).status).toBe(201)
    expect((await register('sixty-five@example.com', 'x'.repeat(65))).status).toBe(422)
  })

  it('registers, authenticates, resolves, protects, and revokes first-party browser sessions', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)

    const registered = await http.fetch(
      jsonRequest('http://doxa.test/auth/register', {
        identifier: '  Ada@Example.COM ',
        password: 'correct horse battery staple',
      }),
    )
    expect(registered.status).toBe(201)
    const registration = await responseData<{
      identity: { id: string; identifier: string; verification: string }
    }>(registered)
    expect(registration.identity).toEqual(
      expect.objectContaining({
        identifier: 'ada@example.com',
        verification: 'unverified',
      }),
    )
    expect(recordedEvents.at(-1)).toEqual(
      expect.objectContaining({
        event: 'user-registered',
        actor: 'anonymous',
      }),
    )

    const storedPassword = await pool.query<{
      version: number
      salt: string
      hash: string
      parameters: { algorithm: string; memory: number; passes: number }
    }>(
      `
      SELECT version, salt, hash, parameters
      FROM doxa_auth_passwords
      WHERE identity_id = $1
    `,
      [registration.identity.id],
    )
    expect(storedPassword.rows[0]).toEqual(
      expect.objectContaining({
        version: 1,
        parameters: expect.objectContaining({
          algorithm: 'argon2id',
          memory: 19456,
          passes: 2,
        }),
      }),
    )
    expect(JSON.stringify(storedPassword.rows[0])).not.toContain('correct horse battery staple')

    const duplicate = await http.fetch(
      jsonRequest('http://doxa.test/auth/register', {
        identifier: 'ada@example.com',
        password: 'another valid password',
      }),
    )
    expect(duplicate.status).toBe(422)
    expect(await responseFailure(duplicate)).toEqual({
      ok: false,
      code: 'email_taken',
      message: 'Unable to create an account with the supplied details.',
      data: null,
    })

    const wrongPassword = await http.fetch(
      jsonRequest('http://doxa.test/auth/login', {
        identifier: 'ada@example.com',
        password: 'wrong password value',
      }),
    )
    const unknownIdentity = await http.fetch(
      jsonRequest('http://doxa.test/auth/login', {
        identifier: 'nobody@example.com',
        password: 'wrong password value',
      }),
    )
    expect(wrongPassword.status).toBe(401)
    expect(unknownIdentity.status).toBe(401)
    expect(await wrongPassword.json()).toEqual(await unknownIdentity.json())

    const loggedIn = await http.fetch(
      jsonRequest('http://doxa.test/auth/login', {
        identifier: 'ADA@example.com',
        password: 'correct horse battery staple',
      }),
    )
    expect(loggedIn.status).toBe(200)
    const setCookie = loggedIn.headers.get('set-cookie')
    expect(setCookie).toContain('doxa_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).not.toContain('correct horse battery staple')
    const cookie = setCookie!.split(';', 1)[0]!
    const token = cookie.slice(cookie.indexOf('=') + 1)

    const sessionRow = await pool.query<{
      token_digest: string
      revoked_at: Date | null
    }>(
      `
      SELECT token_digest, revoked_at
      FROM doxa_auth_sessions
      WHERE identity_id = $1
    `,
      [registration.identity.id],
    )
    expect(sessionRow.rows[0]?.token_digest).not.toBe(token)
    expect(sessionRow.rows[0]?.token_digest).toMatch(/^[a-f0-9]{64}$/)
    expect(sessionRow.rows[0]?.revoked_at).toBeNull()
    expect(recordedEvents.at(-1)).toEqual(
      expect.objectContaining({
        event: 'user-logged-in',
        actor: 'anonymous',
      }),
    )

    const me = await http.fetch(
      new Request('http://doxa.test/auth/me', {
        headers: { cookie },
      }),
    )
    expect(me.status).toBe(200)
    expect(await responseData(me)).toEqual(
      expect.objectContaining({
        identity: expect.objectContaining({
          id: registration.identity.id,
          identifier: 'ada@example.com',
        }),
        actor: { kind: 'user', id: registration.identity.id },
        authentication: expect.objectContaining({
          method: 'password',
          assurance: 'single-factor',
        }),
      }),
    )

    const rotated = await http.fetch(
      new Request('http://doxa.test/auth/login', {
        method: 'POST',
        headers: {
          cookie,
          origin: 'http://doxa.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          identifier: 'ada@example.com',
          password: 'correct horse battery staple',
        }),
      }),
    )
    expect(rotated.status).toBe(200)
    const rotatedCookie = rotated.headers.get('set-cookie')!.split(';', 1)[0]!
    expect(rotatedCookie).not.toBe(cookie)
    const replaced = await http.fetch(
      new Request('http://doxa.test/auth/me', {
        headers: { cookie },
      }),
    )
    expect(replaced.status).toBe(401)

    const rejectedCsrf = await http.fetch(
      new Request('http://doxa.test/auth/logout', {
        method: 'POST',
        headers: { cookie: rotatedCookie, origin: 'https://attacker.example' },
      }),
    )
    expect(rejectedCsrf.status).toBe(403)
    expect(await responseFailure(rejectedCsrf)).toEqual(
      expect.objectContaining({ code: 'untrusted_origin' }),
    )

    const loggedOut = await http.fetch(
      new Request('http://doxa.test/auth/logout', {
        method: 'POST',
        headers: { cookie: rotatedCookie, origin: 'http://doxa.test' },
      }),
    )
    expect(loggedOut.status).toBe(204)
    expect(loggedOut.headers.get('set-cookie')).toContain('Max-Age=0')

    const afterLogout = await http.fetch(
      new Request('http://doxa.test/auth/me', {
        headers: { cookie: rotatedCookie },
      }),
    )
    expect(afterLogout.status).toBe(401)
    expect(await responseFailure(afterLogout)).toEqual(
      expect.objectContaining({ code: 'authentication_required' }),
    )

    const audit = await pool.query<{ event_type: string }>(`
      SELECT event_type FROM doxa_auth_audit_events ORDER BY occurred_at, event_type
    `)
    expect(audit.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        'identity.registered',
        'authentication.failed',
        'session.created',
        'session.revoked',
      ]),
    )
  })

  it('verifies email, resets and changes passwords, revokes sessions, and rate limits abuse', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const registered = await http.fetch(
      jsonRequest('http://doxa.test/auth/register', {
        identifier: 'security@example.com',
        password: 'initial secure password',
      }),
    )
    expect(registered.status).toBe(201)
    const identity = (await responseData<{ identity: { id: string } }>(registered)).identity
    await waitFor(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM doxa_delivery_messages WHERE payload->>'text' LIKE 'Verification token:%'`,
          )
        ).rowCount === 1,
    )
    const verificationMail = await pool.query<{ text: string }>(
      `SELECT payload->>'text' AS text FROM doxa_delivery_messages WHERE payload->>'text' LIKE 'Verification token:%' ORDER BY created_at DESC LIMIT 1`,
    )
    const verificationToken = verificationMail.rows[0]!.text.split(': ')[1]!
    expect(verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const challenge = await pool.query<{ token_digest: string }>(
      `SELECT token_digest FROM doxa_auth_challenges WHERE purpose = 'email_verification'`,
    )
    expect(challenge.rows[0]!.token_digest).not.toBe(verificationToken)
    const verified = await http.fetch(
      jsonRequest('http://doxa.test/auth/email/verify', { token: verificationToken }),
    )
    expect(verified.status).toBe(200)
    expect(await responseData(verified)).toEqual(
      expect.objectContaining({
        identity: expect.objectContaining({ id: identity.id, verification: 'verified' }),
      }),
    )
    expect(
      (
        await http.fetch(
          jsonRequest('http://doxa.test/auth/email/verify', { token: verificationToken }),
        )
      ).status,
    ).toBe(422)

    const knownReset = await http.fetch(
      jsonRequest('http://doxa.test/auth/password/forgot', { identifier: 'security@example.com' }),
    )
    const unknownReset = await http.fetch(
      jsonRequest('http://doxa.test/auth/password/forgot', { identifier: 'unknown@example.com' }),
    )
    expect([knownReset.status, unknownReset.status]).toEqual([202, 202])
    expect(await knownReset.text()).toBe(await unknownReset.text())
    await waitFor(
      async () =>
        (
          await pool.query(
            `SELECT 1 FROM doxa_delivery_messages WHERE payload->>'text' LIKE 'Password reset token:%'`,
          )
        ).rowCount === 1,
    )
    const resetMail = await pool.query<{ text: string }>(
      `SELECT payload->>'text' AS text FROM doxa_delivery_messages WHERE payload->>'text' LIKE 'Password reset token:%' ORDER BY created_at DESC LIMIT 1`,
    )
    const resetToken = resetMail.rows[0]!.text.split(': ')[1]!
    expect(
      (
        await http.fetch(
          jsonRequest('http://doxa.test/auth/password/reset', {
            token: resetToken,
            password: 'reset secure password',
          }),
        )
      ).status,
    ).toBe(204)
    expect(
      (
        await http.fetch(
          jsonRequest('http://doxa.test/auth/login', {
            identifier: 'security@example.com',
            password: 'initial secure password',
          }),
        )
      ).status,
    ).toBe(401)
    const loggedIn = await http.fetch(
      jsonRequest('http://doxa.test/auth/login', {
        identifier: 'security@example.com',
        password: 'reset secure password',
      }),
    )
    expect(loggedIn.status).toBe(200)
    const cookie = loggedIn.headers.get('set-cookie')!.split(';', 1)[0]!
    const changed = await http.fetch(
      new Request('http://doxa.test/auth/password', {
        method: 'POST',
        headers: { cookie, origin: 'http://doxa.test', 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'reset secure password',
          newPassword: 'final secure password',
        }),
      }),
    )
    expect(changed.status).toBe(204)
    expect(changed.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(
      (await http.fetch(new Request('http://doxa.test/auth/me', { headers: { cookie } }))).status,
    ).toBe(401)

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect(
        (
          await http.fetch(
            jsonRequest('http://doxa.test/auth/login', {
              identifier: 'abuse@example.com',
              password: 'wrong password value',
            }),
          )
        ).status,
      ).toBe(401)
    }
    const limited = await http.fetch(
      jsonRequest('http://doxa.test/auth/login', {
        identifier: 'abuse@example.com',
        password: 'wrong password value',
      }),
    )
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('issues, resolves, rotates, and revokes opaque bearer access tokens', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    await http.fetch(
      jsonRequest('http://doxa.test/auth/register', {
        identifier: 'bearer@example.com',
        password: 'correct horse battery staple',
      }),
    )
    const login = await http.fetch(
      jsonRequest('http://doxa.test/auth/login', {
        identifier: 'bearer@example.com',
        password: 'correct horse battery staple',
      }),
    )
    const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!

    const excessiveConstraints = await http.fetch(
      new Request('http://doxa.test/auth/tokens', {
        method: 'POST',
        headers: {
          cookie,
          origin: 'http://doxa.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'too-many-constraints',
          constraints: Array.from({ length: 101 }, (_, index) => `scope.${index}`),
        }),
      }),
    )
    expect(excessiveConstraints.status).toBe(422)
    expect(await responseFailure(excessiveConstraints)).toEqual(
      expect.objectContaining({ code: 'invalid_registration' }),
    )

    const issued = await http.fetch(
      new Request('http://doxa.test/auth/tokens', {
        method: 'POST',
        headers: {
          cookie,
          origin: 'http://doxa.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'CI',
          constraints: ['accounts.view-self', 'counters.read', 'counters.write'],
        }),
      }),
    )
    expect(issued.status).toBe(201)
    const issuance = await responseData<{
      accessToken: { id: string; displayPrefix: string; constraints: string[] }
      token: string
    }>(issued)
    expect(issuance.token).toMatch(/^doxa_pat_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/)
    expect(issuance.accessToken).toEqual(
      expect.objectContaining({
        constraints: ['accounts.view-self', 'counters.read', 'counters.write'],
      }),
    )
    const stored = await pool.query<{ token_digest: string }>(
      `
      SELECT token_digest FROM doxa_auth_access_tokens WHERE id = $1
    `,
      [issuance.accessToken.id],
    )
    expect(stored.rows[0]?.token_digest).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.rows[0]?.token_digest).not.toContain(issuance.token)

    const bearerMe = await http.fetch(
      new Request('http://doxa.test/auth/me', {
        headers: { authorization: `Bearer ${issuance.token}` },
      }),
    )
    expect(bearerMe.status).toBe(200)
    expect(await responseData(bearerMe)).toEqual(
      expect.objectContaining({
        actor: expect.objectContaining({ kind: 'user' }),
        authentication: expect.objectContaining({
          method: 'bearer',
          credentialId: issuance.accessToken.id,
          constraints: ['accounts.view-self', 'counters.read', 'counters.write'],
        }),
      }),
    )

    const ambiguous = await http.fetch(
      new Request('http://doxa.test/auth/me', {
        headers: { cookie, authorization: `Bearer ${issuance.token}` },
      }),
    )
    expect(ambiguous.status).toBe(401)
    expect(await responseFailure(ambiguous)).toEqual(
      expect.objectContaining({ code: 'ambiguous_credentials' }),
    )

    const bearerCannotManage = await http.fetch(
      new Request('http://doxa.test/auth/tokens', {
        headers: { authorization: `Bearer ${issuance.token}` },
      }),
    )
    expect(bearerCannotManage.status).toBe(403)

    const rotated = await http.fetch(
      new Request(`http://doxa.test/auth/tokens/${issuance.accessToken.id}/rotate`, {
        method: 'POST',
        headers: { cookie, origin: 'http://doxa.test' },
      }),
    )
    expect(rotated.status).toBe(200)
    const rotation = await responseData<{ accessToken: { id: string }; token: string }>(rotated)
    expect(rotation.accessToken.id).not.toBe(issuance.accessToken.id)
    const oldToken = await http.fetch(
      new Request('http://doxa.test/auth/me', {
        headers: { authorization: `Bearer ${issuance.token}` },
      }),
    )
    expect(oldToken.status).toBe(401)
    const newToken = await http.fetch(
      new Request('http://doxa.test/auth/me', {
        headers: { authorization: `Bearer ${rotation.token}` },
      }),
    )
    expect(newToken.status).toBe(200)

    const revoked = await http.fetch(
      new Request(`http://doxa.test/auth/tokens/${rotation.accessToken.id}`, {
        method: 'DELETE',
        headers: { cookie, origin: 'http://doxa.test' },
      }),
    )
    expect(revoked.status).toBe(204)
    const afterRevoke = await http.fetch(
      new Request('http://doxa.test/auth/me', {
        headers: { authorization: `Bearer ${rotation.token}` },
      }),
    )
    expect(afterRevoke.status).toBe(401)
    const audit = await pool.query<{ event_type: string }>(`
      SELECT event_type FROM doxa_auth_audit_events WHERE event_type LIKE 'access_token.%'
    `)
    expect(audit.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        'access_token.issued',
        'access_token.rotated',
        'access_token.revoked',
      ]),
    )
  })

  it('inspects and revokes sessions and bearer tokens through Praxis without credential leakage', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const registration = await http.fetch(
      jsonRequest('http://doxa.test/auth/register', {
        identifier: 'operator-auth@example.com',
        password: 'operator secure password',
      }),
    )
    const identityId = (await responseData<{ identity: { id: string } }>(registration)).identity.id
    const login = await http.fetch(
      jsonRequest('http://doxa.test/auth/login', {
        identifier: 'operator-auth@example.com',
        password: 'operator secure password',
      }),
    )
    const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!
    const issued = await http.fetch(
      new Request('http://doxa.test/auth/tokens', {
        method: 'POST',
        headers: { cookie, origin: 'http://doxa.test', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'operator-proof' }),
      }),
    )
    const tokenGrant = await responseData<{ accessToken: { id: string }; token: string }>(issued)
    const sessionId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM doxa_auth_sessions WHERE identity_id = $1 AND revoked_at IS NULL`,
        [identityId],
      )
    ).rows[0]!.id
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    }
    for (const command of ['auth:identities', 'auth:sessions', 'auth:tokens'] as const) {
      expect(
        await runPraxis(
          [command, `--identity=${identityId}`, `--database=${connectionString}`],
          workspace,
          io,
        ),
      ).toBe(0)
    }
    expect(output.some((line) => line.includes('operator-auth@example.com'))).toBe(true)
    expect(output.some((line) => line.includes(sessionId))).toBe(true)
    expect(output.some((line) => line.includes(tokenGrant.accessToken.id))).toBe(true)
    expect(output.join('\n')).not.toContain(tokenGrant.token)
    expect(output.join('\n')).not.toMatch(/[a-f0-9]{64}/)
    expect(
      await runPraxis(
        ['auth:revoke-session', sessionId, `--database=${connectionString}`],
        workspace,
        io,
      ),
    ).toBe(0)
    expect(
      await runPraxis(
        ['auth:revoke-token', tokenGrant.accessToken.id, `--database=${connectionString}`],
        workspace,
        io,
      ),
    ).toBe(0)
    expect(
      (await http.fetch(new Request('http://doxa.test/auth/me', { headers: { cookie } }))).status,
    ).toBe(401)
    expect(
      (
        await http.fetch(
          new Request('http://doxa.test/auth/me', {
            headers: { authorization: `Bearer ${tokenGrant.token}` },
          }),
        )
      ).status,
    ).toBe(401)
    expect(errors).toEqual([])
  })

  it('applies structured default-deny entry, resource, and credential-constrained authorization', async () => {
    const runtime = await bootPersistenceRuntime()
    const allowed = await runtime.admit(
      {
        actor: { kind: 'user', id: 'owner-1' },
        authentication: { state: 'authenticated', identityId: 'owner-1', method: 'password' },
        transport: { kind: 'test' },
      },
      async () => {
        const decision = await runtime.authorization.decide('counters.update', {
          ownerId: 'owner-1',
        })
        await runtime.authorization.authorize('counters.update', { ownerId: 'owner-1' })
        return decision
      },
    )
    expect(allowed).toEqual({
      effect: 'allow',
      policy: 'policy:counters/counter',
      code: 'allowed',
    })

    const denied = await runtime
      .admit(
        {
          actor: { kind: 'user', id: 'owner-1' },
          authentication: { state: 'authenticated', identityId: 'owner-1', method: 'password' },
          transport: { kind: 'test' },
        },
        () => runtime.authorization.authorize('counters.update', { ownerId: 'owner-2' }),
      )
      .catch((error: unknown) => error)
    expect(denied).toBeInstanceOf(AuthorizationError)
    expect((denied as AuthorizationError).decision).toEqual({
      effect: 'deny',
      policy: 'policy:counters/counter',
      code: 'counter_owner_required',
    })

    const missing = await runtime.admit(
      {
        actor: { kind: 'user', id: 'owner-1' },
        authentication: { state: 'authenticated', identityId: 'owner-1', method: 'password' },
        transport: { kind: 'test' },
      },
      () => runtime.authorization.decide('undeclared.ability'),
    )
    expect(missing).toEqual({
      effect: 'deny',
      policy: 'doxa:default-deny',
      code: 'policy_missing',
    })

    const constrained = await runtime.admit(
      {
        actor: { kind: 'user', id: 'owner-1' },
        authentication: {
          state: 'authenticated',
          identityId: 'owner-1',
          method: 'bearer',
          constraints: ['counters.read'],
        },
        transport: { kind: 'test' },
      },
      () => runtime.authorization.decide('counters.update', { ownerId: 'owner-1' }),
    )
    expect(constrained).toEqual({
      effect: 'deny',
      policy: 'doxa:credential-constraints',
      code: 'credential_constraint_denied',
    })
    const audits = await pool.query<{
      metadata: { ability: string; effect: string; policy: string; code: string }
    }>(`
      SELECT metadata
      FROM doxa_auth_audit_events
      WHERE event_type = 'authorization.decided'
      ORDER BY occurred_at
    `)
    expect(audits.rows.map((row) => row.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ability: 'counters.update',
          effect: 'allow',
          policy: 'policy:counters/counter',
        }),
        expect.objectContaining({
          ability: 'undeclared.ability',
          effect: 'deny',
          code: 'policy_missing',
        }),
        expect.objectContaining({
          ability: 'counters.update',
          effect: 'deny',
          code: 'credential_constraint_denied',
        }),
      ]),
    )
  })

  it('hydrates permission sources and policies through bounded read-only model sessions', async () => {
    const runtime = await bootPersistenceRuntime()
    const userId = 'permission-model-user'
    await runAction(runtime, SeedLegacyAccess, { userId, branchTag: 'CHI' })

    resetAuthorizationOperationProof()
    resetPermissionSourceProof()
    resetPolicyProof()
    resetTelemetryRecords()
    const queryResult = await runtime.admit(
      {
        actor: { kind: 'user', id: userId },
        authentication: { state: 'authenticated', identityId: userId, method: 'password' },
        transport: { kind: 'test' },
      },
      () =>
        runtime.queries.execute(ReadAuthorizedUser, {
          userId,
          branchTag: 'STL',
        }),
    )

    expect(queryResult).toEqual({
      id: userId,
      branchTag: 'CHI',
      directPermissions: [`${userId}-contact-read`, `${userId}-user-update`],
      groupPermissions: [`${userId}-branch-override`],
    })
    expect(permissionSourceResolutions).toBe(1)
    expect(permissionSourceUser).toBe(policyUser)
    expect(policyUser).toBe(authorizedQueryUser)
    expect(nestedPolicyUser).toBe(policyUser)
    expect(permissionSourceWriteError).toBe(ReadOnlyExecutionError.name)
    expect(permissionSourceDeleteError).toBe(ReadOnlyExecutionError.name)
    expect(policyWriteError).toBe(ReadOnlyExecutionError.name)
    expect(policyUnitOfWorkWriteError).toBe(ReadOnlyExecutionError.name)
    expect(policyAfterCommitRan).toBe(false)
    expect(
      telemetryRecords.filter(
        (record) =>
          record.kind === 'metric' &&
          record.name === 'doxa.persistence.transaction.total' &&
          record.attributes.operation === 'authorization',
      ),
    ).toEqual([])
    expect(() => permissionSourceUser!.refresh()).toThrow(StaleModelError)

    resetAuthorizationOperationProof()
    resetPermissionSourceProof()
    resetPolicyProof()
    resetTelemetryRecords()
    const changedBranch = await runtime.admit(
      {
        actor: { kind: 'user', id: userId },
        authentication: { state: 'authenticated', identityId: userId, method: 'password' },
        transport: { kind: 'test' },
      },
      () =>
        runtime.actions.execute(ChangeAuthorizedUserBranch, {
          userId,
          branchTag: 'STL',
        }),
    )
    expect(changedBranch).toBe('STL')
    expect(permissionSourceResolutions).toBe(1)
    expect(permissionSourceWriteError).toBe(ReadOnlyExecutionError.name)
    expect(permissionSourceDeleteError).toBe(ReadOnlyExecutionError.name)
    expect(permissionSourceUser).not.toBe(authorizedActionUser)
    expect(policyUser).not.toBe(authorizedActionUser)
    expect(nestedPolicyUser).toBe(policyUser)
    expect(policyWriteError).toBe(ReadOnlyExecutionError.name)
    expect(policyUnitOfWorkWriteError).toBe(ReadOnlyExecutionError.name)
    expect(policyAfterCommitRan).toBe(false)
    expect(
      telemetryRecords.filter(
        (record) =>
          record.kind === 'metric' &&
          record.name === 'doxa.persistence.transaction.total' &&
          record.attributes.operation === 'authorization',
      ),
    ).toEqual([])
    expect(
      (
        await pool.query<{ branch_tag: string }>(
          `SELECT state ->> 'branchTag' AS branch_tag
           FROM doxa_entity_states
           WHERE entity_type = 'model:authorization/user'
             AND entity_id = $1`,
          [userId],
        )
      ).rows,
    ).toEqual([{ branch_tag: 'STL' }])

    resetAuthorizationOperationProof()
    resetPermissionSourceProof()
    resetPolicyProof()
    resetTelemetryRecords()
    const directDecision = await runtime.admit(
      {
        actor: { kind: 'user', id: userId },
        authentication: { state: 'authenticated', identityId: userId, method: 'password' },
        transport: { kind: 'test' },
      },
      () => runtime.authorization.decide('authorization.contact.read', { branchTag: 'STL' }),
    )
    expect(directDecision).toEqual({
      effect: 'allow',
      policy: 'policy:authorization/application',
      code: 'allowed',
    })
    expect(permissionSourceResolutions).toBe(1)
    expect(permissionSourceUser).toBe(policyUser)
    expect(nestedPolicyUser).toBe(policyUser)
    expect(permissionSourceWriteError).toBe(ReadOnlyExecutionError.name)
    expect(permissionSourceDeleteError).toBe(ReadOnlyExecutionError.name)
    expect(policyWriteError).toBe(ReadOnlyExecutionError.name)
    expect(policyUnitOfWorkWriteError).toBe(ReadOnlyExecutionError.name)
    expect(policyAfterCommitRan).toBe(false)
    expect(
      telemetryRecords.filter(
        (record) =>
          record.kind === 'metric' &&
          record.name === 'doxa.persistence.transaction.total' &&
          record.attributes.operation === 'authorization',
      ),
    ).toHaveLength(1)
    expect(() => permissionSourceUser!.refresh()).toThrow(StaleModelError)

    resetAuthorizationOperationProof()
    resetPermissionSourceProof()
    resetPolicyProof()
    const jobId = await runtime.admit(
      {
        actor: { kind: 'user', id: userId },
        authentication: { state: 'authenticated', identityId: userId, method: 'password' },
        transport: { kind: 'test' },
      },
      () =>
        runtime.actions.execute(DispatchChangeAuthorizedUserBranchJob, {
          userId,
          branchTag: 'MSP',
        }),
    )
    await waitFor(
      async () => (await inspectQueueJob(connectionString, jobId))?.state === 'completed',
    )
    expect(permissionSourceResolutions).toBe(1)
    expect(permissionSourceWriteError).toBe(ReadOnlyExecutionError.name)
    expect(permissionSourceDeleteError).toBe(ReadOnlyExecutionError.name)
    expect(permissionSourceUser).not.toBe(authorizedJobUser)
    expect(policyUser).not.toBe(authorizedJobUser)
    expect(nestedPolicyUser).toBe(policyUser)
    expect(policyWriteError).toBe(ReadOnlyExecutionError.name)
    expect(policyUnitOfWorkWriteError).toBe(ReadOnlyExecutionError.name)
    expect(policyAfterCommitRan).toBe(false)
    expect(
      (
        await pool.query<{ branch_tag: string }>(
          `SELECT state ->> 'branchTag' AS branch_tag
           FROM doxa_entity_states
           WHERE entity_type = 'model:authorization/user'
             AND entity_id = $1`,
          [userId],
        )
      ).rows,
    ).toEqual([{ branch_tag: 'MSP' }])

    resetPermissionSourceProof()
    const missing = await runtime.admit(
      {
        actor: { kind: 'user', id: 'missing-permission-model-user' },
        transport: { kind: 'test' },
      },
      () => runtime.authorization.decide('authorization.contact.read'),
    )
    expect(missing).toEqual({
      effect: 'deny',
      policy: 'permission-source:authorization/application-permissions',
      code: 'permission_required',
    })
    expect(permissionSourceUser).toBeUndefined()
  })

  it('serves declared routes through Hono with validation, errors, and anonymous context', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)

    const home = await http.fetch(new Request('http://doxa.test/'))
    expect(home.status).toBe(200)
    expect(await responseData(home)).toEqual(
      expect.objectContaining({
        name: 'Doxa',
        status: 'growing',
      }),
    )

    const health = await http.fetch(new Request('http://doxa.test/health'))
    expect(health.status).toBe(200)
    expect(await responseData(health)).toEqual({ status: 'ok' })

    const hello = await http.fetch(new Request('http://doxa.test/hello/Ada?greeting=Welcome'))
    expect(hello.status).toBe(200)
    expect(await responseData(hello)).toEqual({ message: 'Welcome, Ada!' })

    const attachmentNotReady = await http.fetch(
      new Request('http://doxa.test/attachments/scanning/status'),
    )
    expect(attachmentNotReady.status).toBe(409)
    expect(await responseFailure(attachmentNotReady)).toEqual({
      ok: false,
      code: 'direct_message_attachment_not_ready',
      message: 'That attachment is not ready.',
      data: null,
    })

    const incremented = await http.fetch(
      new Request('http://doxa.test/counters/http-counter/increment', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'http-correlation',
        },
        body: JSON.stringify({ amount: 3 }),
      }),
    )
    expect(incremented.status).toBe(200)
    expect(incremented.headers.get('x-correlation-id')).toBe('http-correlation')
    expect(await responseData(incremented)).toEqual(
      expect.objectContaining({
        id: 'http-counter',
        value: 3,
        version: 1,
      }),
    )
    expect(recordedEvents).toEqual([
      expect.objectContaining({
        event: 'counter-incremented',
        phase: 'local',
        correlationId: 'http-correlation',
        actor: 'anonymous',
      }),
      expect.objectContaining({
        event: 'counter-incremented',
        phase: 'after-commit',
        correlationId: 'http-correlation',
        actor: 'anonymous',
      }),
      expect.objectContaining({
        event: 'counter-saved',
        phase: 'after-commit',
        correlationId: 'http-correlation',
        actor: 'anonymous',
      }),
    ])

    const pinged = await http.fetch(
      new Request('http://doxa.test/ping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      }),
    )
    expect(await responseData(pinged)).toEqual({ message: 'hello' })
    expect(recordedEvents.at(-1)).toEqual(
      expect.objectContaining({
        event: 'http-pinged',
        phase: 'http',
        actor: 'anonymous',
      }),
    )

    const invalid = await http.fetch(
      new Request('http://doxa.test/counters/http-counter/increment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 0 }),
      }),
    )
    expect(invalid.status).toBe(422)
    expect(await responseFailure(invalid)).toEqual(
      expect.objectContaining({ code: 'validation_failed' }),
    )

    const failed = await http.fetch(
      new Request('http://doxa.test/counters/rejected-http-event/increment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 13 }),
      }),
    )
    expect(failed.status).toBe(500)
    expect(await responseFailure(failed)).toEqual({
      ok: false,
      code: 'internal_error',
      message: 'The application could not complete the request.',
      data: null,
    })
    const rejectedEntity = await pool.query<{ count: string }>(`
      SELECT count(*) FROM doxa_entity_states WHERE entity_id = 'rejected-http-event'
    `)
    expect(Number(rejectedEntity.rows[0]!.count)).toBe(0)

    const malformed = await http.fetch(
      new Request('http://doxa.test/counters/http-counter/increment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
    )
    expect(malformed.status).toBe(400)
    expect(await responseFailure(malformed)).toEqual({
      ok: false,
      code: 'invalid_json',
      message: 'The request body must contain valid JSON.',
      data: null,
    })

    const afterCommitFailed = await http.fetch(
      new Request('http://doxa.test/counters/after-commit-http/increment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 7 }),
      }),
    )
    expect(afterCommitFailed.status).toBe(500)
    expect(await responseFailure(afterCommitFailed)).toEqual({
      ok: false,
      code: 'after_commit_failed',
      message: 'The action committed, but after-commit processing did not complete successfully.',
      data: null,
    })
    const committedDespiteListener = await pool.query<{ count: string }>(`
      SELECT count(*) FROM doxa_entity_states WHERE entity_id = 'after-commit-http'
    `)
    expect(Number(committedDespiteListener.rows[0]!.count)).toBe(1)

    const missing = await http.fetch(
      new Request('http://doxa.test/counters/missing', {
        method: 'DELETE',
      }),
    )
    expect(missing.status).toBe(404)
    expect(await responseFailure(missing)).toEqual(
      expect.objectContaining({ code: 'model_not_found' }),
    )

    const notFound = await http.fetch(new Request('http://doxa.test/nope'))
    expect(notFound.status).toBe(404)
    expect(await responseFailure(notFound)).toEqual(
      expect.objectContaining({ code: 'route_not_found' }),
    )
  })

  it('hosts Hono on Node, coordinates shutdown, and rejects later admission', async () => {
    const runtime = await bootPersistenceRuntime()
    const signalListeners = {
      sigint: process.listenerCount('SIGINT'),
      sigterm: process.listenerCount('SIGTERM'),
    }
    const host = await HonoHttpHost.listen(runtime, { port: 0, hostname: '127.0.0.1' })
    hosts.push(host)

    const response = await fetch(new URL('/ping', host.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hosted' }),
    })
    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual({ message: 'hosted' })
    expect(host.state).toBe('ready')

    const firstShutdown = host.shutdown()
    expect(host.shutdown()).toBe(firstShutdown)
    await firstShutdown
    expect(host.state).toBe('stopped')
    expect(runtime.state).toBe('stopped')
    expect(process.listenerCount('SIGINT')).toBe(signalListeners.sigint)
    expect(process.listenerCount('SIGTERM')).toBe(signalListeners.sigterm)

    const unavailable = await host.engine.fetch(
      new Request('http://doxa.test/ping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'late' }),
      }),
    )
    expect(unavailable.status).toBe(503)
  })

  it('hydrates one identity-mapped model and reports clean original state', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, SaveCounter, { id: 'inspect', amount: 2 })

    const inspected = await runAction(runtime, InspectCounter, 'inspect')
    expect(inspected).toEqual({
      sameInstance: true,
      cleanSave: false,
      exists: true,
      version: 1,
      dirty: false,
      clean: true,
      changed: false,
      original: { id: 'inspect', value: 2 },
      changes: {},
      recentlyCreated: false,
    })
  })

  it('validates and hydrates quoted mapped relations through the live PostgreSQL catalog', async () => {
    const timestamp = '2026-07-21T12:34:56.789Z'
    await pool.query(`
      CREATE TABLE public."Contact" (
        id text PRIMARY KEY,
        "createdAt" timestamptz NOT NULL
      );
      INSERT INTO public."Contact" (id, "createdAt") VALUES ('contact-1', '${timestamp}');
      CREATE VIEW public."ContactView" AS SELECT id, "createdAt" FROM public."Contact";
    `)
    const contactStorage = {
      kind: 'table' as const,
      table: 'Contact',
      primaryKey: 'id',
      columns: { id: 'id', createdAt: 'createdAt' },
      attributeTypes: {
        id: { kind: 'string' as const, nullable: false, optional: false },
        createdAt: { kind: 'string' as const, nullable: false, optional: false },
      },
      timestamps: false as const,
      managed: false,
      readOnly: false,
      versionSource: { kind: 'xmin' as const },
    }
    const viewStorage = {
      ...contactStorage,
      table: 'public.ContactView',
      readOnly: true,
      versionSource: { kind: 'none' as const },
    }
    const manager = new PostgresTransactionManager({ connectionString })
    const lifecycle = lifecycleContext()
    manager.bindCompiledModels([
      { entityType: 'model:contacts/contact', storage: contactStorage },
      {
        entityType: 'model:contacts/schema-qualified-contact',
        storage: { ...contactStorage, table: 'public.Contact' },
      },
      { entityType: 'model:contacts/contact-view', storage: viewStorage },
    ])
    try {
      await manager.start(lifecycle)
      const hydrated = await manager.transaction(
        executionContext('quoted-mapped-relation'),
        (unit) => unit.findEntity('model:contacts/contact-view', 'contact-1', viewStorage),
      )
      expect(hydrated).toEqual({
        type: 'model:contacts/contact-view',
        id: 'contact-1',
        version: 0,
        state: { id: 'contact-1', createdAt: expect.any(String) },
      })
      const hydratedState = hydrated?.state as { readonly createdAt: string } | undefined
      expect(new Date(String(hydratedState?.createdAt)).toISOString()).toBe(timestamp)
    } finally {
      await manager.dispose(lifecycle)
      await pool.query(
        `DROP VIEW IF EXISTS public."ContactView"; DROP TABLE IF EXISTS public."Contact"`,
      )
    }
  })

  it('queries declared models through bounded logical read-only records', async () => {
    const writer = await bootPersistenceRuntime()
    await runAction(writer, SaveCounter, { id: 'gnosis-low', amount: 1 })
    await runAction(writer, SaveCounter, { id: 'gnosis-high', amount: 3 })
    await expect(
      writer.queryModelRecords(
        { modelId: 'model:counters/counter', fields: ['id'] },
        { actor: { kind: 'system', id: 'not-gnosis' }, transport: { kind: 'test' } },
      ),
    ).rejects.toThrow('model-reader runtime profile')
    await writer.shutdown()
    resetObserverLog()
    resetTelemetryRecords()
    const observationsBefore = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM doxa_theoria_observations',
    )
    const runtime = await bootPersistenceRuntime({
      profile: 'model-reader',
      minimalEnvironment: true,
    })
    await expect(
      runtime.admit(
        { actor: { kind: 'system', id: 'not-a-model-query' }, transport: { kind: 'test' } },
        () => undefined,
      ),
    ).rejects.toThrow('admits only bounded model record queries')
    await expect(
      runtime.queryModelRecords(
        {
          modelId: 'model:counters/counter',
          fields: ['id'],
          filters: [{ attribute: 'id', operator: '=', value: 'a'.repeat(10_001) }],
        },
        {
          actor: { kind: 'system', id: 'oversized-query' },
          authentication: {
            state: 'authenticated',
            identityId: 'oversized-query',
            method: 'console',
          },
          transport: { kind: 'console', name: 'oversized-query' },
        },
      ),
    ).rejects.toThrow('at most 10,000 characters')
    const result = await runtime.queryModelRecords(
      {
        modelId: 'model:counters/counter',
        fields: ['id', 'value'],
        filters: [{ attribute: 'value', operator: '>=', value: 1 }],
        orderBy: [{ attribute: 'value', direction: 'desc' }],
        limit: 1,
      },
      {
        actor: { kind: 'system', id: 'doxa:gnosis' },
        authentication: {
          state: 'authenticated',
          identityId: 'doxa:gnosis',
          method: 'console',
        },
        transport: { kind: 'console', name: 'gnosis:query-models' },
      },
    )
    expect(result).toEqual({
      modelId: 'model:counters/counter',
      fields: ['id', 'value'],
      rows: [{ id: 'gnosis-high', value: 3 }],
      returned: 1,
      truncated: true,
      executionId: expect.any(String),
    })
    expect(runtime.profile).toBe('model-reader')
    expect(observerLog).toEqual([])
    expect(telemetryRecords).toEqual([])
    expect(
      (
        await pool.query<{ count: string }>(
          'SELECT COUNT(*) AS count FROM doxa_theoria_observations',
        )
      ).rows,
    ).toEqual(observationsBefore.rows)
  })

  it('maps Eloquent-style models onto existing tables without losing durability or concurrency', async () => {
    const runtime = await bootPersistenceRuntime()
    await pool.query(`
      INSERT INTO legacy_customers (customer_id, full_name, enabled, nickname, lock_version)
      VALUES ('legacy-existing', 'Before', true, 'Original nickname', 7)
    `)
    const updated = await runAction(runtime, SaveLegacyCustomer, {
      id: 'legacy-existing',
      displayName: 'After',
    })
    expect(updated).toEqual({
      id: 'legacy-existing',
      displayName: 'After',
      version: 8,
      created: false,
    })
    expect(await runAction(runtime, ClearLegacyCustomerNickname, 'legacy-existing')).toEqual({
      nickname: undefined,
      nullableCode: null,
      saved: true,
      version: 9,
    })
    const existing = await pool.query<{
      full_name: string
      enabled: boolean
      nickname: string | null
      password_hash: string
      api_token: string
      vendor_state: string
      trigger_revision: number
      lock_version: number
      updated_at: Date
    }>(`
      SELECT full_name, enabled, nickname, password_hash, api_token, vendor_state,
             trigger_revision, lock_version, updated_at
      FROM legacy_customers
      WHERE customer_id = 'legacy-existing'
    `)
    expect(existing.rows[0]).toEqual(
      expect.objectContaining({
        full_name: 'After',
        enabled: true,
        nickname: null,
        password_hash: 'never-selected',
        api_token: 'never-selected-token',
        vendor_state: 'externally-managed',
        trigger_revision: 2,
        lock_version: 9,
      }),
    )
    expect(await runAction(runtime, ClearLegacyCustomerNickname, 'legacy-existing')).toEqual({
      nickname: undefined,
      nullableCode: null,
      saved: false,
      version: 9,
    })
    expect(await runAction(runtime, RecordLegacyCustomerActivity, 'legacy-existing')).toEqual({
      saved: true,
      version: 9,
    })
    const afterActivity = await pool.query<{
      lock_version: number
      trigger_revision: number
      updated_at: Date
    }>(`
      SELECT lock_version, trigger_revision, updated_at
      FROM legacy_customers
      WHERE customer_id = 'legacy-existing'
    `)
    expect(afterActivity.rows[0]).toEqual({
      lock_version: 9,
      trigger_revision: 2,
      updated_at: existing.rows[0]!.updated_at,
    })
    expect(
      (
        await pool.query(
          `SELECT 1 FROM doxa_entity_states WHERE entity_type = 'model:counters/legacy-customer'`,
        )
      ).rowCount,
    ).toBe(0)

    expect(
      await runAction(runtime, ExerciseReadOnlyLegacyCustomer, {
        id: 'legacy-existing',
        operation: 'read',
      }),
    ).toBe('After')
    expect(
      await runAction(runtime, ExerciseReadOnlyLegacyCustomer, {
        id: 'legacy-existing',
        operation: 'read-suite',
      }),
    ).toBe('After:1:1:1:1')
    expect(
      await runAction(runtime, ExerciseReadOnlyLegacyCustomer, {
        id: 'read-only-made',
        operation: 'make',
      }),
    ).toBe('Changed in memory')
    await expect(
      runAction(runtime, ExerciseReadOnlyLegacyCustomer, {
        id: 'legacy-existing',
        operation: 'unknown',
      }),
    ).rejects.toBeInstanceOf(UnknownModelAttributeError)
    await expect(
      runAction(runtime, ExerciseReadOnlyLegacyCustomer, {
        id: 'legacy-existing',
        operation: 'fill-unknown',
      }),
    ).rejects.toBeInstanceOf(UnknownModelAttributeError)
    for (const operation of ['save', 'delete', 'create'] as const) {
      await expect(
        runAction(runtime, ExerciseReadOnlyLegacyCustomer, {
          id: operation === 'create' ? 'read-only-created' : 'legacy-existing',
          operation,
        }),
      ).rejects.toBeInstanceOf(ReadOnlyModelError)
    }
    expect(
      (await pool.query(`SELECT 1 FROM legacy_customers WHERE customer_id = 'read-only-created'`))
        .rowCount,
    ).toBe(0)
    expect(
      (
        await pool.query(
          `SELECT 1
             FROM doxa_journal_entries
            WHERE entity_type = 'model:counters/legacy-customer'
              AND entity_id = 'legacy-existing'
              AND fact_type = 'legacy-customer.renamed'`,
        )
      ).rowCount,
    ).toBe(1)
    expect(
      (
        await pool.query(
          `SELECT 1 FROM doxa_outbox_messages WHERE message_type = 'legacy-customer.changed'`,
        )
      ).rowCount,
    ).toBe(1)
    expect(
      (
        await pool.query(
          `SELECT 1 FROM doxa_journal_entries WHERE fact_type = 'legacy-customer.activity-recorded'`,
        )
      ).rowCount,
    ).toBe(1)
    expect(
      (
        await pool.query(
          `SELECT 1 FROM doxa_outbox_messages WHERE message_type = 'legacy-customer.activity-recorded'`,
        )
      ).rowCount,
    ).toBe(1)

    const created = await runAction(runtime, SaveLegacyCustomer, {
      id: 'legacy-created',
      displayName: 'Created',
    })
    expect(created).toEqual({
      id: 'legacy-created',
      displayName: 'Created',
      version: 1,
      created: true,
    })
    expect(
      (
        await pool.query(
          `SELECT 1 FROM legacy_customers WHERE customer_id = 'legacy-created' AND created_at IS NOT NULL AND updated_at IS NOT NULL`,
        )
      ).rowCount,
    ).toBe(1)

    const competing = await Promise.allSettled([
      runAction(runtime, SaveLegacyCustomer, {
        id: 'legacy-existing',
        displayName: 'Winner',
        delayAfterLoad: 30,
      }),
      runAction(runtime, SaveLegacyCustomer, {
        id: 'legacy-existing',
        displayName: 'Loser',
        delayAfterLoad: 30,
      }),
    ])
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(competing.filter((result) => result.status === 'rejected')[0]).toEqual(
      expect.objectContaining({ reason: expect.any(OptimisticConcurrencyError) }),
    )

    await runAction(runtime, DeleteLegacyCustomer, 'legacy-created')
    expect(
      (await pool.query(`SELECT 1 FROM legacy_customers WHERE customer_id = 'legacy-created'`))
        .rowCount,
    ).toBe(0)

    const noteCreated = await runAction(runtime, SaveLegacyNote, {
      id: 'simple-table',
      body: 'First',
    })
    const noteUpdated = await runAction(runtime, SaveLegacyNote, {
      id: 'simple-table',
      body: 'Second',
    })
    expect(noteCreated.version).toBeGreaterThan(0)
    expect(noteUpdated.version).not.toBe(noteCreated.version)
    expect(
      (
        await pool.query<{ body: string }>(
          `SELECT body FROM legacy_notes WHERE id = 'simple-table'`,
        )
      ).rows[0]?.body,
    ).toBe('Second')
  })

  it('tracks original, dirty, changed, and clean state across save', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, SaveCounter, { id: 'tracking', amount: 2 })

    const updated = await runAction(runtime, SaveCounter, { id: 'tracking', amount: 3 })
    expect(updated).toEqual({
      id: 'tracking',
      value: 5,
      version: 2,
      originalValue: 2,
      changes: { value: 5 },
      dirtyBeforeSave: true,
      cleanAfterSave: true,
      wasChanged: true,
      exists: true,
      recentlyCreated: false,
    })
  })

  it('tracks added and removed optional attributes without model type ceremony', async () => {
    const runtime = await bootPersistenceRuntime()
    await runAction(runtime, SaveCounter, { id: 'optional', amount: 1 })

    expect(await runAction(runtime, RenameCounter, { id: 'optional', label: 'Primary' })).toEqual({
      label: 'Primary',
      changes: { label: 'Primary' },
    })
    expect(await runAction(runtime, RenameCounter, { id: 'optional' })).toEqual({
      label: undefined,
      changes: { label: undefined },
    })
    const entity = await pool.query<{ state: Record<string, unknown> }>(
      `SELECT state FROM doxa_entity_states WHERE entity_id = 'optional'`,
    )
    expect(entity.rows[0]?.state).toEqual({ id: 'optional', value: 1 })
  })

  it('supports create, refresh, and delete without exposing Unit of Work plumbing', async () => {
    const runtime = await bootPersistenceRuntime()
    const created = await runAction(runtime, CreateCounter, { id: 'lifecycle', value: 4 })
    expect(created).toEqual({
      id: 'lifecycle',
      value: 4,
      version: 1,
      exists: true,
      recentlyCreated: true,
      changes: { id: 'lifecycle', value: 4 },
    })

    const refreshed = await runAction(runtime, RefreshCounter, 'lifecycle')
    expect(refreshed).toEqual({
      value: 4,
      dirtyBefore: true,
      cleanAfter: true,
      original: { id: 'lifecycle', value: 4 },
    })
    expect(await durableRowCounts()).toEqual({ entities: 1, journal: 0, outbox: 0 })

    await runAction(runtime, DeleteCounter, 'lifecycle')
    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 1, outbox: 1 })
  })

  it('executes typed model queries, pagination, cursors, and eager relationships through PostgreSQL', async () => {
    const runtime = await bootPersistenceRuntime()
    for (const [id, amount] of [
      ['query-a', 1],
      ['query-c', 2],
      ['query-b', 2],
    ] as const) {
      await runAction(runtime, SaveCounter, { id, amount })
      await runAction(runtime, RenameCounter, { id, label: 'query-group' })
    }
    await runAction(runtime, CreateCounter, { id: 'query-unlabeled', value: 0 })
    await runAction(runtime, SaveLegacyCustomer, {
      id: 'mapped-zed',
      displayName: 'Zed',
    })
    await runAction(runtime, SaveLegacyCustomer, {
      id: 'mapped-ada',
      displayName: 'Ada',
    })
    await runAction(runtime, CreateCounterNote, {
      id: 'note-a-2',
      counterId: 'query-a',
      body: 'Second',
      rank: 2,
    })
    await runAction(runtime, CreateCounterNote, {
      id: 'note-a-1',
      counterId: 'query-a',
      body: 'First',
      rank: 1,
    })
    await runAction(runtime, CreateCounterNote, {
      id: 'note-c-3',
      counterId: 'query-c',
      body: 'Third',
      rank: 3,
    })
    await runAction(runtime, AssignCounterTag, {
      id: 'assignment-a-z',
      counterId: 'query-a',
      tagId: 'tag-z',
      tagName: 'Zeta',
    })
    await runAction(runtime, AssignCounterTag, {
      id: 'assignment-a-a',
      counterId: 'query-a',
      tagId: 'tag-a',
      tagName: 'Alpha',
    })
    resetObserverLog()
    await runAction(runtime, AssignCounterTag, {
      id: 'assignment-c-a',
      counterId: 'query-c',
      tagId: 'tag-a',
      tagName: 'Alpha',
    })

    const result = await runtime.admit(
      {
        actor: { kind: 'system', id: 'query-test' },
        transport: { kind: 'test' },
      },
      () =>
        runtime.queries.execute(InspectCounterQueries, {
          minimumValue: 1,
          constrainedNoteRank: 2,
          page: 2,
          perPage: 2,
          cursorSize: 2,
        }),
    )

    expect(result).toEqual({
      orderedIds: ['query-a', 'query-b', 'query-c'],
      firstId: 'query-a',
      count: 3,
      totalValue: 5,
      pageIds: ['query-c'],
      pageTotal: 3,
      cursorIds: ['query-a', 'query-b'],
      nextCursorIds: ['query-c'],
      previousCursorIds: ['query-a', 'query-b'],
      invalidCursorError: 'InvalidModelCursorError',
      mismatchedCursorError: 'InvalidModelCursorError',
      eagerNotes: {
        'query-a': ['First', 'Second'],
        'query-b': [],
        'query-c': ['Third'],
      },
      primaryNotes: {
        'query-a': 'First',
        'query-b': undefined,
        'query-c': 'Third',
      },
      eagerTags: {
        'query-a': ['Alpha', 'Zeta'],
        'query-b': [],
        'query-c': ['Alpha'],
      },
      hasNotes: ['query-a', 'query-c'],
      constrainedHasNotes: ['query-a', 'query-c'],
      identityMapped: true,
      readOnlyError: 'ReadOnlyExecutionError',
      readOnlyErrors: [
        'ReadOnlyExecutionError',
        'ReadOnlyExecutionError',
        'ReadOnlyExecutionError',
      ],
      iteratedIds: ['query-a', 'query-b', 'query-c'],
      filteredIds: ['query-a', 'query-b', 'query-c'],
      mappedCustomerIds: ['mapped-ada', 'mapped-zed'],
      nestedIdentityMapped: true,
      hasTags: ['query-a', 'query-c'],
      belongsToNoteIds: ['note-a-1', 'note-a-2'],
      staticWithIdentityMapped: true,
      foundId: 'query-a',
      foundNotes: ['First', 'Second'],
      constrainedFindMissing: true,
      missingFind: true,
      missingFindOrFailError: 'Counter missing-counter was not found.',
      booleanIds: ['query-a', 'query-c'],
      patternIds: ['query-a', 'query-b', 'query-c'],
      nullLabelIds: ['query-unlabeled'],
      notInIds: ['query-b', 'query-c'],
      columnComparisonCount: 0,
      implicitPageIds: ['query-c'],
      nullEqualityIds: ['query-unlabeled'],
      nullInequalityIds: ['query-a', 'query-b', 'query-c'],
      nullMembershipIds: ['query-unlabeled'],
      nonNullMembershipIds: ['query-a', 'query-b', 'query-c'],
      nullOrderedIds: ['query-unlabeled', 'query-a', 'query-b', 'query-c'],
    })
    expect(observerLog).toEqual([
      expect.objectContaining({ phase: 'retrieved', modelId: 'query-a' }),
      expect.objectContaining({ phase: 'retrieved', modelId: 'query-b' }),
      expect.objectContaining({ phase: 'retrieved', modelId: 'query-c' }),
    ])
    expect(await runAction(runtime, IncrementMatchingCounters, 'query-group')).toEqual([
      'query-a',
      'query-b',
      'query-c',
    ])
    const stored = await pool.query<{ entity_id: string; value: string }>(
      `SELECT entity_id, state ->> 'value' AS value
       FROM doxa_entity_states
       WHERE entity_type = 'model:counters/counter'
         AND state ->> 'label' = 'query-group'
       ORDER BY entity_id`,
    )
    expect(stored.rows).toEqual([
      { entity_id: 'query-a', value: '2' },
      { entity_id: 'query-b', value: '3' },
      { entity_id: 'query-c', value: '3' },
    ])
  })

  it('fails clearly for missing, detached, and stale models', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(runAction(runtime, InspectCounter, 'missing')).rejects.toBeInstanceOf(
      ModelNotFoundError,
    )
    await expect(runAction(runtime, SaveDetachedCounter, 'detached')).rejects.toBeInstanceOf(
      DetachedModelError,
    )

    await runAction(runtime, CreateCounter, { id: 'captured', value: 1 })
    await runAction(runtime, CaptureCounter, 'captured')
    expect(capturedCounter).toBeDefined()
    expect(() => capturedCounter!.save()).toThrow(StaleModelError)
    await expect(capturedCounterQuery!.find('captured')).rejects.toBeInstanceOf(StaleModelError)
    await expect(capturedCounterQuery!.findOrFail('captured')).rejects.toBeInstanceOf(
      StaleModelError,
    )
    expect(() => Counter.find('captured')).toThrow(StaleModelError)
    expect(() => HttpPinged.dispatch({ message: 'outside' })).toThrow(EventDispatchError)
  })

  it('rejects Unit of Work writes from query mode before touching PostgreSQL', async () => {
    const runtime = await bootPersistenceRuntime()
    await expect(
      runtime.admit(
        {
          actor: { kind: 'system', id: 'query-test' },
          transport: { kind: 'test' },
        },
        () => runtime.queries.execute(AttemptCounterWrite, 'query-counter'),
      ),
    ).rejects.toBeInstanceOf(ReadOnlyExecutionError)
    expect(await durableRowCounts()).toEqual({ entities: 0, journal: 0, outbox: 0 })
  })

  it('preserves application errors across every PostgreSQL transaction boundary', async () => {
    const manager = new PostgresTransactionManager({ connectionString })
    const lifecycle = lifecycleContext()
    await manager.start(lifecycle)
    try {
      const applicationFailures = [
        {
          error: new HttpError(409, 'read_not_ready', 'The read is not ready.'),
          execute: (error: Error) =>
            manager.read(executionContext('application-read-error'), async () => {
              throw error
            }),
        },
        {
          error: new HttpError(422, 'write_refused', 'The write was refused.'),
          execute: (error: Error) =>
            manager.transaction(executionContext('application-write-error'), async (unitOfWork) => {
              await unitOfWork.saveEntity({
                type: 'application-error-rollback',
                id: 'application-error-rollback',
                state: { staged: true },
              })
              throw error
            }),
        },
        {
          error: Object.assign(new Error('The framework operation was refused.'), {
            code: '23505',
          }),
          execute: (error: Error) =>
            manager.frameworkTransaction(
              executionContext('application-framework-error'),
              async () => {
                throw error
              },
            ),
        },
      ]
      for (const applicationFailure of applicationFailures) {
        const caught = await applicationFailure
          .execute(applicationFailure.error)
          .catch((error: unknown) => error)
        expect(caught).toBe(applicationFailure.error)
        expect(caught).not.toBeInstanceOf(PersistenceError)
      }
      expect(
        (
          await pool.query(
            `SELECT 1 FROM doxa_entity_states
             WHERE entity_type = 'application-error-rollback'
               AND entity_id = 'application-error-rollback'`,
          )
        ).rowCount,
      ).toBe(0)

      const mappedDatabaseFailure = await manager
        .frameworkTransaction(
          executionContext('mapped-postgres-driver-error'),
          async (_unitOfWork, transaction) => {
            try {
              await transaction.query('SELECT * FROM doxa_missing_application_mapping_proof')
            } catch (cause) {
              throw Object.assign(
                new Error('The application mapped the database failure.', { cause }),
                { code: 'mapped_database_conflict' },
              )
            }
          },
        )
        .catch((error: unknown) => error)
      expect(mappedDatabaseFailure).not.toBeInstanceOf(PersistenceError)
      expect(mappedDatabaseFailure).toMatchObject({
        code: 'mapped_database_conflict',
      })

      const databaseFailure = await manager
        .frameworkTransaction(
          executionContext('postgres-driver-error'),
          async (_unitOfWork, transaction) => {
            await transaction.query('SELECT * FROM doxa_missing_translation_proof')
          },
        )
        .catch((error: unknown) => error)
      expect(databaseFailure).toBeInstanceOf(PersistenceError)
      expect((databaseFailure as Error & { cause?: unknown }).cause).toMatchObject({
        code: '42P01',
      })
    } finally {
      await manager.dispose(lifecycle)
    }

    const unavailableManager = new PostgresTransactionManager({
      connectionString: 'postgresql://doxa:doxa@127.0.0.1:1/doxa',
    })
    const connectionFailure = await unavailableManager
      .start(lifecycleContext())
      .catch((error: unknown) => error)
    expect(connectionFailure).toBeInstanceOf(PersistenceError)
  })

  it('turns concurrent version races into one stable optimistic-concurrency failure', async () => {
    const runtime = await bootPersistenceRuntime()
    await runtime.admit(
      {
        actor: { kind: 'system', id: 'seed' },
        transport: { kind: 'test' },
      },
      () => runtime.actions.execute(SaveCounter, { id: 'contended', amount: 1 }),
    )
    const attempts = await Promise.allSettled(
      [2, 3].map((amount) =>
        runtime.admit(
          {
            actor: { kind: 'service', id: `writer-${amount}` },
            transport: { kind: 'test' },
          },
          () =>
            runtime.actions.execute(SaveCounter, {
              id: 'contended',
              amount,
              delayAfterLoad: 20,
            }),
        ),
      ),
    )

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find((attempt) => attempt.status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(OptimisticConcurrencyError),
    })
    const entity = await pool.query<{ version: number; state: { value: number } }>(
      `SELECT version, state FROM doxa_entity_states WHERE entity_id = 'contended'`,
    )
    expect(entity.rows[0]?.version).toBe(2)
    expect([3, 4]).toContain(entity.rows[0]?.state.value)
    expect(await durableRowCounts()).toEqual({ entities: 1, journal: 2, outbox: 2 })
  })

  it('releases after-commit work only after another connection can see durability', async () => {
    const manager = new PostgresTransactionManager({ connectionString })
    const lifecycle = lifecycleContext()
    await manager.start(lifecycle)
    let visibleAfterCommit = false
    let escaped: UnitOfWork | undefined
    try {
      await manager.transaction(executionContext('after-commit'), async (unitOfWork) => {
        escaped = unitOfWork
        await unitOfWork.saveEntity({
          type: 'counter',
          id: 'after-commit',
          state: { value: 1 },
        })
        unitOfWork.afterCommit(async () => {
          const result = await pool.query<{ count: string }>(`
            SELECT count(*) FROM doxa_entity_states WHERE entity_id = 'after-commit'
          `)
          visibleAfterCommit = Number(result.rows[0]!.count) === 1
        })
        expect(visibleAfterCommit).toBe(false)
      })
      expect(visibleAfterCommit).toBe(true)
      await expect(
        escaped!.saveEntity({
          type: 'counter',
          id: 'stale-write',
          state: { value: 2 },
        }),
      ).rejects.toBeInstanceOf(StaleUnitOfWorkError)
    } finally {
      await manager.dispose(lifecycle)
    }
  })

  it('reports after-commit failure without rolling back durable state', async () => {
    const manager = new PostgresTransactionManager({ connectionString })
    const lifecycle = lifecycleContext()
    await manager.start(lifecycle)
    try {
      await expect(
        manager.transaction(executionContext('after-commit-failure'), async (unitOfWork) => {
          await unitOfWork.saveEntity({
            type: 'counter',
            id: 'after-commit-failure',
            state: { value: 1 },
          })
          unitOfWork.afterCommit(() => {
            throw new Error('after-commit listener failed')
          })
        }),
      ).rejects.toBeInstanceOf(AfterCommitError)

      const durable = await pool.query<{ count: string }>(`
        SELECT count(*) FROM doxa_entity_states WHERE entity_id = 'after-commit-failure'
      `)
      expect(Number(durable.rows[0]!.count)).toBe(1)
    } finally {
      await manager.dispose(lifecycle)
    }
  })

  it('rotates opaque browser sessions with bounded concurrent-request grace', async () => {
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
      sessionRenewalSeconds: 0,
      sessionRotationGraceSeconds: 30,
    })
    await auth.start(lifecycleContext())
    try {
      const email = `rotation-${Date.now()}@example.com`
      await auth.register({ identifier: email, password: 'rotation secure password' })
      const grant = await auth.login({ identifier: email, password: 'rotation secure password' })
      const oldToken = grant.token.reveal()
      const rotated = await auth.resolveHttp(
        new Request('http://doxa.test/auth/me', {
          headers: { cookie: `doxa_session=${oldToken}` },
        }),
      )
      expect(rotated.authentication.state).toBe('authenticated')
      const replacementCookie = rotated.responseHeaders?.['set-cookie']
      expect(replacementCookie).toContain('doxa_session=')
      const replacement = replacementCookie!.match(/doxa_session=([^;]+)/)![1]!
      expect(replacement).not.toBe(oldToken)

      const concurrentOld = await auth.resolveHttp(
        new Request('http://doxa.test/auth/me', {
          headers: { cookie: `doxa_session=${oldToken}` },
        }),
      )
      expect(concurrentOld.authentication.state).toBe('authenticated')
      expect(concurrentOld.responseHeaders).toBeUndefined()
      await pool.query(
        `UPDATE doxa_auth_sessions SET previous_token_expires_at = now() - interval '1 second' WHERE id = $1`,
        [grant.session.id],
      )
      expect(
        (
          await auth.resolveHttp(
            new Request('http://doxa.test/auth/me', {
              headers: { cookie: `doxa_session=${oldToken}` },
            }),
          )
        ).authentication.state,
      ).toBe('anonymous')
      expect(
        (
          await auth.resolveHttp(
            new Request('http://doxa.test/auth/me', {
              headers: { cookie: `doxa_session=${replacement}` },
            }),
          )
        ).authentication.state,
      ).toBe('authenticated')
    } finally {
      await auth.dispose(lifecycleContext())
    }
  })

  it('protects cookie-authenticated WebSocket upgrades without rotating the browser session', async () => {
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
      sessionRenewalSeconds: 0,
    })
    await auth.start(lifecycleContext())
    try {
      const email = `websocket-${Date.now()}@example.com`
      await auth.register({ identifier: email, password: 'websocket secure password' })
      const grant = await auth.login({ identifier: email, password: 'websocket secure password' })
      const cookie = `doxa_session=${grant.token.reveal()}`

      await expect(
        auth.resolveHttp(
          new Request('http://doxa.test/app', {
            headers: { cookie, origin: 'https://attacker.example', upgrade: 'websocket' },
          }),
        ),
      ).rejects.toMatchObject({ code: 'untrusted_origin' })

      const admitted = await auth.resolveHttp(
        new Request('http://doxa.test/app', {
          headers: { cookie, origin: 'http://doxa.test', upgrade: 'websocket' },
        }),
      )
      expect(admitted.authentication.state).toBe('authenticated')
      expect(admitted.responseHeaders).toBeUndefined()

      const ordinaryRequest = await auth.resolveHttp(
        new Request('http://doxa.test/auth/me', { headers: { cookie } }),
      )
      expect(ordinaryRequest.authentication.state).toBe('authenticated')
      expect(ordinaryRequest.responseHeaders?.['set-cookie']).toContain('doxa_session=')
    } finally {
      await auth.dispose(lifecycleContext())
    }
  })

  it('refreshes sensitive-operation authority only after first-party password reauthentication', async () => {
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    await auth.start(lifecycleContext())
    try {
      const email = `reauth-${Date.now()}@example.com`
      await auth.register({ identifier: email, password: 'reauthentication secure password' })
      const grant = await auth.login({
        identifier: email,
        password: 'reauthentication secure password',
      })
      await pool.query(
        `UPDATE doxa_auth_sessions SET authenticated_at = now() - interval '1 day' WHERE id = $1`,
        [grant.session.id],
      )
      const cookie = `doxa_session=${grant.token.reveal()}`
      const stale = await auth.resolveHttp(
        new Request('http://doxa.test/auth/me', { headers: { cookie } }),
      )
      expect(isRecentPasswordAuthentication(stale.authentication)).toBe(false)
      await expect(
        auth.reauthenticate(grant.identity.id, grant.session.id, 'wrong password'),
      ).rejects.toThrow('current password is invalid')

      const authenticatedAt = await auth.reauthenticate(
        grant.identity.id,
        grant.session.id,
        'reauthentication secure password',
      )
      expect(isRecentPasswordAuthentication({ ...stale.authentication, authenticatedAt })).toBe(
        true,
      )
      expect(
        (
          await pool.query(
            `SELECT 1 FROM doxa_auth_audit_events
             WHERE session_id = $1 AND event_type = 'session.reauthenticated'`,
            [grant.session.id],
          )
        ).rowCount,
      ).toBe(1)
    } finally {
      await auth.dispose(lifecycleContext())
    }
  })

  it('denies stale sensitive HTTP authority until the session is reauthenticated', async () => {
    const runtime = await bootPersistenceRuntime()
    const http = new HonoHttpEngine(runtime)
    const email = `reauth-route-${Date.now()}@example.com`
    const password = 'reauthentication route password'
    const registration = await http.fetch(
      jsonRequest('http://doxa.test/auth/register', { identifier: email, password }),
    )
    expect(registration.status).toBe(201)
    const login = await http.fetch(
      jsonRequest('http://doxa.test/auth/login', { identifier: email, password }),
    )
    const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!
    await pool.query(
      `UPDATE doxa_auth_sessions SET authenticated_at = now() - interval '1 day'
       WHERE identity_id = (SELECT id FROM doxa_auth_identities WHERE email = $1)`,
      [email],
    )

    const tokenRequest = () =>
      http.fetch(
        jsonRequest(
          'http://doxa.test/auth/tokens',
          { name: 'sensitive-token' },
          { cookie, origin: 'http://doxa.test' },
        ),
      )
    const stale = await tokenRequest()
    expect(stale.status).toBe(403)
    expect(await stale.json()).toEqual(expect.objectContaining({ code: 'forbidden' }))

    const refreshed = await http.fetch(
      jsonRequest(
        'http://doxa.test/auth/reauthenticate',
        { password },
        { cookie, origin: 'http://doxa.test' },
      ),
    )
    expect(refreshed.status).toBe(200)
    expect(await refreshed.json()).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ authenticatedAt: expect.any(String) }),
      }),
    )
    expect((await tokenRequest()).status).toBe(201)
  })

  it('invalidates outstanding verification challenges when the contact email changes', async () => {
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    await auth.start(lifecycleContext())
    try {
      const identity = await auth.register({
        identifier: `challenge-${Date.now()}@example.com`,
        password: 'challenge binding password',
      })
      const challenge = await auth.issueEmailVerification(identity.id)
      await pool.query(
        `UPDATE doxa_auth_identities SET email = $1, updated_at = now() WHERE id = $2`,
        [`changed-${Date.now()}@example.com`, identity.id],
      )
      await expect(auth.verifyEmail(challenge.token.reveal())).rejects.toMatchObject({
        code: 'invalid_token',
      })
      expect(
        (
          await pool.query<{ consumed_at: Date | null }>(
            `SELECT consumed_at FROM doxa_auth_challenges WHERE identity_id = $1`,
            [identity.id],
          )
        ).rows[0]?.consumed_at,
      ).toBeNull()
    } finally {
      await auth.dispose(lifecycleContext())
    }
  })

  it('registers managed identities through the Model lifecycle and rolls every participant back atomically', async () => {
    await pool.query(`
      CREATE TABLE managed_registration_users (
        user_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        username text NOT NULL,
        contact_email text NOT NULL,
        password_hash text NOT NULL DEFAULT 'registration-pending',
        active boolean NOT NULL,
        branch_tag text NOT NULL,
        verified_at timestamptz,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `)
    await pool.query(
      `CREATE UNIQUE INDEX managed_registration_username_lower_idx
       ON managed_registration_users (lower(username))`,
    )

    interface ManagedRegistrationAttributes extends ModelAttributes {
      id: string
      username: string
      contactEmail: string
      active: boolean
      branchTag: string
      verifiedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }
    class ManagedRegistrationUser extends Model<ManagedRegistrationAttributes> {
      recordRegistration(): void {
        this.journal('managed-user.registered', { identityId: this.id })
        this.outbox('managed-user.welcome', { identityId: this.id })
      }
      changeContactEmail(value: string): void {
        this.attributes.contactEmail = value
      }
      forceVerification(value: Date): void {
        this.attributes.verifiedAt = value
      }
    }

    const transactions = new PostgresTransactionManager({ connectionString })
    await transactions.start(lifecycleContext())
    const phases: string[] = []
    let failSaved = false
    const definitions = new Map([
      [
        ManagedRegistrationUser,
        {
          entityType: 'managed-registration-user',
          storage: {
            kind: 'table' as const,
            table: 'managed_registration_users',
            primaryKey: 'user_id',
            columns: {
              id: 'user_id',
              username: 'username',
              contactEmail: 'contact_email',
              active: 'active',
              branchTag: 'branch_tag',
              verifiedAt: 'verified_at',
              createdAt: 'created_at',
              updatedAt: 'updated_at',
            },
            timestamps: false as const,
          },
          attributes: new Set([
            'id',
            'username',
            'contactEmail',
            'active',
            'branchTag',
            'verifiedAt',
            'createdAt',
            'updatedAt',
          ]),
          attributeNormalizers: new Map([
            ['username', (value: unknown) => String(value).trim().toLowerCase()],
            ['contactEmail', (value: unknown) => String(value).trim().toLowerCase()],
          ]),
          authOwnedAttributes: new Set(['verifiedAt']),
          clearAttributeOnChange: new Map([['contactEmail', 'verifiedAt']]),
        },
      ],
    ])
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    auth.bindCompiledAuthentication(
      mappedAuthentication({
        mode: 'managed',
        table: 'managed_registration_users',
        verification: { mode: 'mapped', column: 'verified_at' },
      }),
      {
        registerManagedIdentity: async (request) => {
          return await transactions.frameworkTransaction(
            executionContext('managed-auth-registration'),
            async (unitOfWork, participant) => {
              const models = new ModelSession(unitOfWork, definitions, {
                dispatch: async (phase, model) => {
                  phases.push(phase)
                  if (phase === 'creating') {
                    ;(model as ManagedRegistrationUser).recordRegistration()
                  }
                  if (phase === 'saved' && failSaved)
                    throw new Error('registration observer failed')
                },
              })
              return await runWithModelSession(models, async () => {
                try {
                  const attributes: ManagedRegistrationAttributes = {
                    id: request.id,
                    username: request.identifier,
                    contactEmail: request.contactEmail!,
                    active: true,
                    branchTag: 'north',
                    verifiedAt: null,
                    createdAt: request.createdAt,
                    updatedAt: request.updatedAt,
                  }
                  const identity = models.make(ManagedRegistrationUser, attributes)
                  await identity.save()
                  await request.persistAuthentication(participant, identity.id)
                  return identity.id
                } finally {
                  models.close()
                }
              })
            },
          )
        },
      },
    )
    await auth.start(lifecycleContext())
    try {
      const registered = await auth.register({
        identifier: 'LifecycleUser',
        contactEmail: 'lifecycle@example.com',
        password: 'managed lifecycle password',
      })
      expect(registered.identifier).toBe('lifecycleuser')
      expect(phases).toEqual(
        expect.arrayContaining(['saving', 'creating', 'created', 'saved', 'committed']),
      )
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM doxa_journal_entries
             WHERE entity_type = 'managed-registration-user'`,
          )
        ).rows[0]?.count,
      ).toBe(1)
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM doxa_outbox_messages
             WHERE message_type = 'managed-user.welcome'`,
          )
        ).rows[0]?.count,
      ).toBe(1)

      await pool.query(
        `UPDATE managed_registration_users SET verified_at = now() WHERE user_id = $1`,
        [registered.id],
      )
      await transactions.transaction(
        executionContext('managed-auth-contact-change'),
        async (unitOfWork) => {
          const models = new ModelSession(unitOfWork, definitions)
          await runWithModelSession(models, async () => {
            try {
              const identity = await models.findOrFail(ManagedRegistrationUser, registered.id)
              identity.changeContactEmail(' Changed@Example.COM ')
              await identity.save()
            } finally {
              models.close()
            }
          })
        },
      )
      expect(
        (
          await pool.query<{ contact_email: string; verified_at: Date | null }>(
            `SELECT contact_email, verified_at FROM managed_registration_users WHERE user_id = $1`,
            [registered.id],
          )
        ).rows[0],
      ).toEqual({ contact_email: 'changed@example.com', verified_at: null })
      await expect(
        transactions.transaction(
          executionContext('managed-auth-owned-write'),
          async (unitOfWork) => {
            const models = new ModelSession(unitOfWork, definitions)
            await runWithModelSession(models, async () => {
              try {
                const identity = await models.findOrFail(ManagedRegistrationUser, registered.id)
                identity.forceVerification(new Date())
                await identity.save()
              } finally {
                models.close()
              }
            })
          },
        ),
      ).rejects.toThrow('owned by Doxa Auth')

      failSaved = true
      await expect(
        auth.register({
          identifier: 'RollbackUser',
          contactEmail: 'rollback@example.com',
          password: 'managed rollback password',
        }),
      ).rejects.toThrow('registration observer failed')
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM managed_registration_users
             WHERE username = 'rollbackuser'`,
          )
        ).rows[0]?.count,
      ).toBe(0)
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM managed_registration_users
             WHERE username = 'rollbackuser'`,
          )
        ).rows[0]?.count,
      ).toBe(0)
    } finally {
      await auth.dispose(lifecycleContext())
      await transactions.dispose(lifecycleContext())
    }
  })

  it('upgrades managed bcrypt credentials in the authoritative column and revokes ineligible identities', async () => {
    await pool.query(`
      CREATE TABLE legacy_managed_auth_users (
        user_id text PRIMARY KEY,
        username text NOT NULL,
        contact_email text NOT NULL,
        password_hash text NOT NULL,
        active boolean NOT NULL,
        verified_at timestamptz,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `)
    await pool.query(
      `CREATE UNIQUE INDEX legacy_managed_auth_username_lower_idx
       ON legacy_managed_auth_users (lower(username))`,
    )
    await pool.query(
      `INSERT INTO legacy_managed_auth_users
       (user_id, username, contact_email, password_hash, active, created_at, updated_at)
       VALUES ('managed-1', 'Ada', 'ada@example.com', $1, true, now(), now())`,
      ['$2b$10$rIv/DSLLlVci6r6U.W.N.e0DggFleAwndNLWyGmpJvbsVP//5EQaK'],
    )

    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    auth.bindCompiledAuthentication(
      mappedAuthentication({
        mode: 'managed',
        verification: { mode: 'mapped', column: 'verified_at' },
        eligibility: [{ column: 'active', equals: true }],
      }),
    )
    await auth.start(lifecycleContext())
    try {
      const grant = await auth.login({
        identifier: 'ADA',
        password: 'legacy secure password',
      })
      expect(grant.identity).toEqual(
        expect.objectContaining({
          id: 'managed-1',
          identifier: 'ada',
          contactEmail: 'ada@example.com',
        }),
      )
      const upgraded = await pool.query<{ password_hash: string }>(
        `SELECT password_hash FROM legacy_managed_auth_users WHERE user_id = 'managed-1'`,
      )
      expect(upgraded.rows[0]?.password_hash).toMatch(/^doxa-argon2id:/)

      const access = await auth.issueAccessToken('managed-1', { name: 'eligibility-proof' })
      await pool.query(
        `UPDATE legacy_managed_auth_users SET active = false WHERE user_id = 'managed-1'`,
      )
      expect(
        (
          await auth.resolveHttp(
            new Request('http://doxa.test/auth/me', {
              headers: { cookie: `doxa_session=${grant.token.reveal()}` },
            }),
          )
        ).authentication.state,
      ).toBe('anonymous')
      await expect(
        auth.resolveHttp(
          new Request('http://doxa.test/auth/me', {
            headers: { authorization: `Bearer ${access.token.reveal()}` },
          }),
        ),
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM doxa_auth_audit_events
             WHERE identity_id = 'managed-1' AND event_type = 'identity.ineligible'`,
          )
        ).rows[0]?.count,
      ).toBeGreaterThan(0)

      await pool.query(
        `UPDATE legacy_managed_auth_users SET active = true WHERE user_id = 'managed-1'`,
      )
      await pool.query(
        `UPDATE legacy_managed_auth_users SET password_hash = 'not-a-password-record'
         WHERE user_id = 'managed-1'`,
      )
      await expect(
        auth.login({ identifier: 'ada', password: 'legacy secure password' }),
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
    } finally {
      await auth.dispose(lifecycleContext())
    }
  })

  it('accepts configured SHA-256 credentials in login-only mode without mutating them', async () => {
    await pool.query(`
      CREATE TABLE legacy_login_only_users (
        user_id text PRIMARY KEY,
        username text NOT NULL,
        contact_email text NOT NULL,
        password_hash text NOT NULL,
        active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `)
    await pool.query(
      `CREATE UNIQUE INDEX legacy_login_only_username_lower_idx
       ON legacy_login_only_users (lower(username))`,
    )
    const passwordHash = createHash('sha256').update('legacy password').digest('hex')
    await pool.query(
      `INSERT INTO legacy_login_only_users
       (user_id, username, contact_email, password_hash, active, created_at, updated_at)
       VALUES ('login-only-1', 'encore', 'encore@example.com', $1, true, now(), now())`,
      [passwordHash],
    )

    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    auth.bindCompiledAuthentication(
      mappedAuthentication({
        mode: 'login-only',
        verification: { mode: 'trusted' },
        readers: [{ preset: 'sha256-hex', hash: 'password_hash' }],
      }),
    )
    await auth.start(lifecycleContext())
    try {
      await expect(
        auth.login({ identifier: 'encore', password: 'wrong password' }),
      ).rejects.toMatchObject({
        code: 'invalid_credentials',
        message: 'The supplied identifier or password is invalid.',
      })
      const grant = await auth.login({ identifier: 'encore', password: 'legacy password' })
      expect(grant.identity.id).toBe('login-only-1')
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM doxa_auth_sessions WHERE identity_id = 'login-only-1'`,
          )
        ).rows[0]?.count,
      ).toBe(1)
      expect(
        (
          await pool.query<{ password_hash: string }>(
            `SELECT password_hash FROM legacy_login_only_users WHERE user_id = 'login-only-1'`,
          )
        ).rows[0]?.password_hash,
      ).toBe(passwordHash)
      expect(
        await auth.reauthenticate('login-only-1', grant.session.id, 'legacy password'),
      ).toBeInstanceOf(Date)
      await expect(
        auth.changePassword('login-only-1', 'legacy password', 'replacement password'),
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      await expect(
        auth.register({ identifier: 'new-user', password: 'registration password' }),
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      await expect(auth.issueEmailVerification('login-only-1')).rejects.toMatchObject({
        code: 'invalid_credentials',
      })
      await expect(auth.verifyEmail('unowned-token')).rejects.toMatchObject({
        code: 'invalid_credentials',
      })
      await expect(auth.issuePasswordReset('encore')).rejects.toMatchObject({
        code: 'invalid_credentials',
      })
      await expect(
        auth.resetPassword('unowned-token', 'replacement password'),
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      const replacementHash = createHash('sha256').update('external replacement').digest('hex')
      await pool.query(
        `UPDATE legacy_login_only_users SET password_hash = $1 WHERE user_id = 'login-only-1'`,
        [replacementHash],
      )
      await expect(
        auth.login({ identifier: 'encore', password: 'legacy password' }),
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(
        (await auth.login({ identifier: 'encore', password: 'external replacement' })).identity.id,
      ).toBe('login-only-1')
    } finally {
      await auth.dispose(lifecycleContext())
    }
  })

  it('upgrades and reuses a managed in-place bcrypt credential', async () => {
    await pool.query(`
      CREATE TABLE legacy_in_place_auth_users (
        user_id text PRIMARY KEY,
        username text NOT NULL,
        contact_email text NOT NULL,
        password_hash text NOT NULL,
        active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `)
    await pool.query(
      `CREATE UNIQUE INDEX legacy_in_place_auth_username_lower_idx
       ON legacy_in_place_auth_users (lower(username))`,
    )
    await pool.query(
      `INSERT INTO legacy_in_place_auth_users
       (user_id, username, contact_email, password_hash, active, created_at, updated_at)
       VALUES ('in-place-1', 'Grace', 'grace@example.com', $1, true, now(), now())`,
      ['$2b$10$rIv/DSLLlVci6r6U.W.N.e0DggFleAwndNLWyGmpJvbsVP//5EQaK'],
    )

    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    auth.bindCompiledAuthentication(
      mappedAuthentication({
        mode: 'managed',
        table: 'legacy_in_place_auth_users',
        verification: { mode: 'trusted' },
        upgrade: {
          mode: 'in-place',
          format: 'doxa-argon2id',
          password: 'password_hash',
          updatedAt: 'updated_at',
        },
      }),
    )
    await auth.start(lifecycleContext())
    try {
      expect(
        (await auth.login({ identifier: 'GRACE', password: 'legacy secure password' })).identity,
      ).toEqual(expect.objectContaining({ id: 'in-place-1', identifier: 'grace' }))
      expect(
        (
          await pool.query<{ password_hash: string }>(
            `SELECT password_hash FROM legacy_in_place_auth_users WHERE user_id = 'in-place-1'`,
          )
        ).rows[0]?.password_hash,
      ).toMatch(/^doxa-argon2id:/)
      expect(
        (await auth.login({ identifier: 'grace', password: 'legacy secure password' })).identity.id,
      ).toBe('in-place-1')
    } finally {
      await auth.dispose(lifecycleContext())
    }
  })

  it('upgrades login-only SHA-256 in place and protects concurrent external changes', async () => {
    await pool.query(`
      CREATE TABLE sha_in_place_auth_users (
        user_id text PRIMARY KEY,
        username text NOT NULL,
        contact_email text NOT NULL,
        password_hash text NOT NULL,
        active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `)
    await pool.query(
      `CREATE UNIQUE INDEX sha_in_place_auth_username_lower_idx
       ON sha_in_place_auth_users (lower(username))`,
    )
    const sha = createHash('sha256').update('sha upgrade password').digest('hex')
    await pool.query(
      `INSERT INTO sha_in_place_auth_users
       (user_id, username, contact_email, password_hash, active, created_at, updated_at)
       VALUES
         ('sha-upgrade-1', 'ShaUpgrade', 'sha@example.com', $1, true, now(), now()),
         ('sha-cas-1', 'ShaCas', 'cas@example.com', $1, true, now(), now()),
         ('sha-fail-1', 'ShaFail', 'fail@example.com', $1, true, now(), now())`,
      [sha],
    )
    await pool.query(`
      CREATE FUNCTION control_sha_upgrade() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id = 'sha-cas-1' THEN
          PERFORM pg_sleep(0.2);
        END IF;
        IF NEW.user_id = 'sha-fail-1' THEN
          RAISE EXCEPTION 'forced credential upgrade failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER control_sha_upgrade
      BEFORE UPDATE ON sha_in_place_auth_users
      FOR EACH ROW EXECUTE FUNCTION control_sha_upgrade()
    `)

    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    auth.bindCompiledAuthentication(
      mappedAuthentication({
        mode: 'login-only',
        table: 'sha_in_place_auth_users',
        verification: { mode: 'trusted' },
        readers: [
          { preset: 'doxa-argon2id', hash: 'password_hash' },
          { preset: 'sha256-hex', hash: 'password_hash' },
        ],
        upgrade: {
          mode: 'in-place',
          format: 'doxa-argon2id',
          password: 'password_hash',
          updatedAt: 'updated_at',
        },
      }),
    )
    await auth.start(lifecycleContext())
    try {
      const first = await auth.login({
        identifier: 'shaupgrade',
        password: 'sha upgrade password',
      })
      expect(first.identity.id).toBe('sha-upgrade-1')
      expect(
        (
          await pool.query<{ password_hash: string }>(
            `SELECT password_hash FROM sha_in_place_auth_users WHERE user_id = 'sha-upgrade-1'`,
          )
        ).rows[0]?.password_hash,
      ).toMatch(/^doxa-argon2id:/)
      expect(
        (await auth.login({ identifier: 'shaupgrade', password: 'sha upgrade password' })).identity
          .id,
      ).toBe('sha-upgrade-1')
      expect(
        (
          await pool.query(
            `SELECT 1 FROM doxa_auth_audit_events
             WHERE identity_id = 'sha-upgrade-1' AND event_type = 'session.created'`,
          )
        ).rowCount,
      ).toBe(2)

      const concurrent = await Promise.allSettled([
        auth.login({ identifier: 'shacas', password: 'sha upgrade password' }),
        auth.login({ identifier: 'shacas', password: 'sha upgrade password' }),
      ])
      expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect(
        (await pool.query(`SELECT 1 FROM doxa_auth_sessions WHERE identity_id = 'sha-cas-1'`))
          .rowCount,
      ).toBe(1)

      await expect(
        auth.login({ identifier: 'shafail', password: 'sha upgrade password' }),
      ).rejects.toThrow('forced credential upgrade failure')
      expect(
        (await pool.query(`SELECT 1 FROM doxa_auth_sessions WHERE identity_id = 'sha-fail-1'`))
          .rowCount,
      ).toBe(0)
      expect(
        (
          await pool.query<{ password_hash: string }>(
            `SELECT password_hash FROM sha_in_place_auth_users WHERE user_id = 'sha-fail-1'`,
          )
        ).rows[0]?.password_hash,
      ).toBe(sha)
    } finally {
      await auth.dispose(lifecycleContext())
      await pool.query('DROP TRIGGER control_sha_upgrade ON sha_in_place_auth_users')
      await pool.query('DROP FUNCTION control_sha_upgrade()')
    }
  })

  it('rolls back a mandatory credential upgrade when session issuance fails', async () => {
    await pool.query(`
      CREATE TABLE atomic_upgrade_auth_users (
        user_id text PRIMARY KEY,
        username text NOT NULL,
        contact_email text NOT NULL,
        password_hash text NOT NULL,
        active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `)
    await pool.query(
      `CREATE UNIQUE INDEX atomic_upgrade_auth_username_lower_idx
       ON atomic_upgrade_auth_users (lower(username))`,
    )
    await pool.query(
      `INSERT INTO atomic_upgrade_auth_users
       (user_id, username, contact_email, password_hash, active, created_at, updated_at)
       VALUES ('atomic-upgrade-1', 'Atomic', 'atomic@example.com', $1, true, now(), now())`,
      ['$2b$10$rIv/DSLLlVci6r6U.W.N.e0DggFleAwndNLWyGmpJvbsVP//5EQaK'],
    )
    await pool.query(`
      CREATE FUNCTION reject_atomic_upgrade_session() RETURNS trigger AS $$
      BEGIN
        IF NEW.identity_id = 'atomic-upgrade-1' THEN
          RAISE EXCEPTION 'forced session failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await pool.query(`
      CREATE TRIGGER reject_atomic_upgrade_session
      BEFORE INSERT ON doxa_auth_sessions
      FOR EACH ROW EXECUTE FUNCTION reject_atomic_upgrade_session()
    `)

    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    auth.bindCompiledAuthentication(
      mappedAuthentication({
        mode: 'managed',
        table: 'atomic_upgrade_auth_users',
        verification: { mode: 'trusted' },
      }),
    )
    await auth.start(lifecycleContext())
    try {
      await expect(
        auth.login({ identifier: 'atomic', password: 'legacy secure password' }),
      ).rejects.toThrow('Failed query: insert into "doxa_auth_sessions"')
      expect(
        (
          await pool.query<{ password_hash: string }>(
            `SELECT password_hash FROM atomic_upgrade_auth_users
             WHERE user_id = 'atomic-upgrade-1'`,
          )
        ).rows[0]?.password_hash,
      ).toBe('$2b$10$rIv/DSLLlVci6r6U.W.N.e0DggFleAwndNLWyGmpJvbsVP//5EQaK')
    } finally {
      await auth.dispose(lifecycleContext())
      await pool.query('DROP TRIGGER reject_atomic_upgrade_session ON doxa_auth_sessions')
      await pool.query('DROP FUNCTION reject_atomic_upgrade_session()')
    }
  })

  it('rejects composite and partial identifier uniqueness that leaves login ambiguous', async () => {
    await pool.query(`
      CREATE TABLE ambiguous_auth_users (
        user_id text PRIMARY KEY,
        tenant_id text NOT NULL,
        username text NOT NULL,
        contact_email text NOT NULL,
        password_hash text NOT NULL,
        active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `)
    await pool.query(
      `CREATE UNIQUE INDEX ambiguous_auth_username_tenant_idx
       ON ambiguous_auth_users (lower(username), tenant_id)`,
    )
    await pool.query(
      `CREATE UNIQUE INDEX ambiguous_auth_active_username_idx
       ON ambiguous_auth_users (lower(username)) WHERE active`,
    )

    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    auth.bindCompiledAuthentication(
      mappedAuthentication({
        mode: 'login-only',
        table: 'ambiguous_auth_users',
        verification: { mode: 'trusted' },
      }),
    )
    await expect(auth.start(lifecycleContext())).rejects.toThrow(
      'Normalized auth identifiers require citext uniqueness or a unique lower(column) index.',
    )
  })

  it('uses direct case-insensitive lookup for a unique citext identifier', async () => {
    await pool.query('CREATE EXTENSION IF NOT EXISTS citext')
    await pool.query(`
      CREATE TABLE citext_auth_users (
        user_id text PRIMARY KEY,
        username citext NOT NULL UNIQUE,
        contact_email text NOT NULL,
        password_hash text NOT NULL,
        active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `)
    await pool.query(
      `INSERT INTO citext_auth_users
       (user_id, username, contact_email, password_hash, active, created_at, updated_at)
       VALUES ('citext-1', 'CaseUser', 'case@example.com', $1, true, now(), now())`,
      ['$2b$10$rIv/DSLLlVci6r6U.W.N.e0DggFleAwndNLWyGmpJvbsVP//5EQaK'],
    )

    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    auth.bindCompiledAuthentication(
      mappedAuthentication({
        mode: 'login-only',
        table: 'citext_auth_users',
        verification: { mode: 'trusted' },
        upgrade: {
          mode: 'in-place',
          format: 'doxa-argon2id',
          password: 'password_hash',
          updatedAt: 'updated_at',
        },
      }),
    )
    await auth.start(lifecycleContext())
    try {
      expect(
        (await auth.login({ identifier: 'CASEUSER', password: 'legacy secure password' })).identity,
      ).toEqual(expect.objectContaining({ id: 'citext-1', identifier: 'caseuser' }))
    } finally {
      await auth.dispose(lifecycleContext())
    }
  })

  it('maps first-party identities and passwords onto an existing user table', async () => {
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
      identityId: () => 'employee-42',
      tables: {
        identities: {
          table: 'legacy_auth_users',
          id: 'external_id',
          email: 'email_address',
          contactEmail: 'email_address',
          emailVerifiedAt: 'verified_at',
          createdAt: 'created_on',
          updatedAt: 'updated_on',
        },
        passwords: {
          table: 'legacy_auth_users',
          identityId: 'external_id',
          password: 'password_record',
          readers: [{ preset: 'doxa-argon2id', hash: 'password_record' }],
          mode: 'managed',
          upgrade: {
            mode: 'in-place',
            format: 'doxa-argon2id',
            updatedAt: 'updated_on',
          },
        },
      },
    })
    expect(auth.storage()).toEqual({
      kind: 'mapped',
      identities: { table: 'legacy_auth_users', ownership: 'external' },
      passwords: { table: 'legacy_auth_users', ownership: 'external' },
      sessions: { table: 'doxa_auth_sessions', ownership: 'doxa' },
      accessTokens: { table: 'doxa_auth_access_tokens', ownership: 'doxa' },
      challenges: { table: 'doxa_auth_challenges', ownership: 'doxa' },
      audit: { table: 'doxa_auth_audit_events', ownership: 'doxa' },
    })
    await auth.start(lifecycleContext())
    try {
      const identity = await auth.register({
        identifier: 'legacy@example.com',
        password: 'legacy secure password',
      })
      expect(identity).toEqual(
        expect.objectContaining({
          id: 'employee-42',
          identifier: 'legacy@example.com',
          verification: 'unverified',
        }),
      )
      const legacy = await pool.query<{
        external_id: string
        email_address: string
        password_record: string
      }>(`
        SELECT external_id, email_address, password_record FROM legacy_auth_users WHERE external_id = 'employee-42'
      `)
      expect(legacy.rows[0]).toEqual(
        expect.objectContaining({
          external_id: 'employee-42',
          email_address: 'legacy@example.com',
        }),
      )
      expect(legacy.rows[0]!.password_record).toMatch(/^doxa-argon2id:/)
      expect((await pool.query(`SELECT 1 FROM doxa_auth_identities`)).rowCount).toBe(0)
      expect((await pool.query(`SELECT 1 FROM doxa_auth_passwords`)).rowCount).toBe(0)

      const verification = await auth.issueEmailVerification(identity.id)
      expect((await auth.verifyEmail(verification.token.reveal())).verification).toBe('verified')
      expect(
        (
          await pool.query<{ verified_at: Date | null }>(
            `SELECT verified_at FROM legacy_auth_users WHERE external_id = 'employee-42'`,
          )
        ).rows[0]?.verified_at,
      ).toBeInstanceOf(Date)

      const grant = await auth.login({
        identifier: 'legacy@example.com',
        password: 'legacy secure password',
      })
      expect(grant.session.identityId).toBe('employee-42')
      expect(
        (
          await auth.resolveHttp(
            new Request('http://doxa.test/auth/me', {
              headers: { cookie: `doxa_session=${grant.token.reveal()}` },
            }),
          )
        ).actor,
      ).toEqual({ kind: 'user', id: 'employee-42' })

      const access = await auth.issueAccessToken(identity.id, {
        name: 'legacy-api',
        constraints: ['profile.view'],
      })
      expect(
        (
          await auth.resolveHttp(
            new Request('http://doxa.test/auth/me', {
              headers: { authorization: `Bearer ${access.token.reveal()}` },
            }),
          )
        ).authentication,
      ).toEqual(expect.objectContaining({ identityId: 'employee-42', method: 'bearer' }))

      await auth.changePassword(
        identity.id,
        'legacy secure password',
        'replacement secure password',
      )
      await expect(
        auth.login({ identifier: 'legacy@example.com', password: 'legacy secure password' }),
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(
        (
          await auth.login({
            identifier: 'legacy@example.com',
            password: 'replacement secure password',
          })
        ).identity.id,
      ).toBe('employee-42')
      await auth.recordAuthorization(
        'profile.view',
        { effect: 'allow', policy: 'legacy', code: 'owner' },
        {
          executionId: 'mapped-auth-execution',
          correlationId: 'mapped-auth-correlation',
          actor: { kind: 'user', id: 'employee-42' },
          initiator: { kind: 'user', id: 'employee-42' },
          delegation: [],
          authentication: { state: 'authenticated', identityId: 'employee-42', method: 'bearer' },
          transport: { kind: 'test' },
          trace: {},
          cancellation: new AbortController().signal,
        },
      )
      expect(
        (await pool.query(`SELECT 1 FROM doxa_auth_audit_events WHERE identity_id = 'employee-42'`))
          .rowCount,
      ).toBeGreaterThan(0)
    } finally {
      await auth.dispose(lifecycleContext())
    }
  })

  it('fails readiness when mapped auth columns do not exist', async () => {
    const auth = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
      tables: {
        identities: {
          table: 'legacy_auth_users',
          id: 'external_id',
          email: 'missing_email_column',
          emailVerifiedAt: 'verified_at',
          createdAt: 'created_on',
          updatedAt: 'updated_on',
        },
        passwords: {
          table: 'legacy_auth_users',
          identityId: 'external_id',
          password: 'password_record',
          readers: [{ preset: 'doxa-argon2id', hash: 'password_record' }],
          mode: 'managed',
          upgrade: {
            mode: 'in-place',
            format: 'doxa-argon2id',
            updatedAt: 'updated_on',
          },
        },
      },
    })
    await expect(auth.start(lifecycleContext())).rejects.toThrow('missing_email_column')
  })

  it('fails in-place readiness for insufficient password capacity and unsafe timestamps', async () => {
    await pool.query(`
      CREATE TABLE short_credential_auth_users (
        user_id text PRIMARY KEY,
        username text NOT NULL,
        contact_email text NOT NULL,
        password_hash varchar(255) NOT NULL,
        active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE UNIQUE INDEX short_credential_auth_username_lower_idx
        ON short_credential_auth_users (lower(username));

      CREATE TABLE nullable_timestamp_auth_users (
        user_id text PRIMARY KEY,
        username text NOT NULL,
        contact_email text NOT NULL,
        password_hash text NOT NULL,
        active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz
      );
      CREATE UNIQUE INDEX nullable_timestamp_auth_username_lower_idx
        ON nullable_timestamp_auth_users (lower(username));

      CREATE EXTENSION IF NOT EXISTS citext;
      CREATE TABLE case_insensitive_password_auth_users (
        user_id text PRIMARY KEY,
        username text NOT NULL,
        contact_email text NOT NULL,
        password_hash citext NOT NULL,
        active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE UNIQUE INDEX case_insensitive_password_auth_username_lower_idx
        ON case_insensitive_password_auth_users (lower(username));

      CREATE TABLE nonunique_credential_auth_users (
        user_id text PRIMARY KEY,
        username text NOT NULL,
        contact_email text NOT NULL,
        active boolean NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE UNIQUE INDEX nonunique_credential_auth_username_lower_idx
        ON nonunique_credential_auth_users (lower(username));
      CREATE TABLE nonunique_auth_credentials (
        user_id text NOT NULL,
        password_hash text NOT NULL
      )
    `)
    const configured = (table: string) => {
      const auth = new PostgresAuth({
        connectionString,
        secureCookies: false,
        trustedOrigins: ['http://doxa.test'],
      })
      auth.bindCompiledAuthentication(
        mappedAuthentication({
          mode: 'login-only',
          table,
          verification: { mode: 'trusted' },
          upgrade: {
            mode: 'in-place',
            format: 'doxa-argon2id',
            password: 'password_hash',
            updatedAt: 'updated_at',
          },
        }),
      )
      return auth
    }

    await expect(
      configured('short_credential_auth_users').start(lifecycleContext()),
    ).rejects.toThrow('must hold at least 272 characters')
    await expect(
      configured('nullable_timestamp_auth_users').start(lifecycleContext()),
    ).rejects.toThrow('credential timestamp must be writable and NOT NULL')

    const caseInsensitive = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    caseInsensitive.bindCompiledAuthentication(
      mappedAuthentication({
        mode: 'login-only',
        table: 'case_insensitive_password_auth_users',
        verification: { mode: 'trusted' },
      }),
    )
    await expect(caseInsensitive.start(lifecycleContext())).rejects.toThrow(
      'credential column password_hash has an incompatible PostgreSQL type',
    )

    const nonunique = new PostgresAuth({
      connectionString,
      secureCookies: false,
      trustedOrigins: ['http://doxa.test'],
    })
    const nonuniqueConfiguration = mappedAuthentication({
      mode: 'login-only',
      table: 'nonunique_credential_auth_users',
      verification: { mode: 'trusted' },
    })
    nonunique.bindCompiledAuthentication({
      ...nonuniqueConfiguration,
      credentials: {
        ...nonuniqueConfiguration.credentials,
        table: 'nonunique_auth_credentials',
      },
    })
    await expect(nonunique.start(lifecycleContext())).rejects.toThrow(
      'credential identity key requires a direct unique index',
    )
  })
})

async function bootPersistenceRuntime(
  options: {
    readonly profile?: 'application' | 'model-reader'
    readonly minimalEnvironment?: boolean
    readonly telemetry?: Telemetry
  } = {},
): Promise<DoxaRuntime> {
  const artifactsDirectory = await temporaryDirectory()
  await compilePersistenceApplication(artifactsDirectory)
  const runtime = await Doxa.boot(Application, {
    artifactsDirectory,
    ...(options.profile ? { profile: options.profile } : {}),
    dotenvPath: false,
    environment: {
      DATABASE_CONNECTION_STRING: connectionString,
      ...(options.minimalEnvironment
        ? {}
        : {
            COMMUNICATIONS_SEND_GRID_WEBHOOK_PUBLIC_KEY: sendGridPublicKey,
            COMMUNICATIONS_TWILIO_AUTH_TOKEN: twilioAuthToken,
          }),
    },
    ...(options.telemetry
      ? {
          providerOverrides: {
            'provider:infrastructure/telemetry': options.telemetry,
          },
        }
      : {}),
  })
  runtimes.push(runtime)
  return runtime
}

function runAction<Input, Output>(
  runtime: DoxaRuntime,
  action: ActionClass<Input, Output>,
  input: Input,
): Promise<Awaited<Output>> {
  executionSequence += 1
  return runtime.admit(
    {
      actor: { kind: 'system', id: `model-test-${executionSequence}` },
      transport: { kind: 'test' },
    },
    () => runtime.actions.execute(action, input),
  )
}

async function compilePersistenceApplication(artifactsDirectory: string) {
  return compileApplication({
    tsconfigPath: path.join(persistenceApplication, 'tsconfig.json'),
    applicationFile: path.join(persistenceApplication, 'src/application.ts'),
    sourceRoot: path.join(persistenceApplication, 'src'),
    outputRoot: path.join(persistenceApplication, 'dist'),
    artifactsDirectory,
  })
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'doxa-persistence-'))
  temporaryDirectories.push(directory)
  return directory
}

function mappedAuthentication(options: {
  readonly mode: 'managed' | 'login-only'
  readonly table?: string
  readonly verification: CompiledAuthentication['verification']
  readonly eligibility?: CompiledAuthentication['eligibility']
  readonly readers?: CompiledAuthentication['credentials']['readers']
  readonly upgrade?: CompiledAuthentication['credentials']['upgrade']
}): CompiledAuthentication {
  const table =
    options.table ??
    (options.mode === 'managed' ? 'legacy_managed_auth_users' : 'legacy_login_only_users')
  const upgrade =
    options.upgrade ??
    (options.mode === 'managed'
      ? ({
          mode: 'in-place',
          format: 'doxa-argon2id',
          password: 'password_hash',
          updatedAt: 'updated_at',
        } as const)
      : ({ mode: 'never' } as const))
  const readers =
    options.readers ??
    (upgrade.mode === 'in-place'
      ? ([
          { preset: 'doxa-argon2id', hash: 'password_hash' },
          { preset: 'bcrypt', hash: 'password_hash' },
        ] as const)
      : ([{ preset: 'bcrypt', hash: 'password_hash' }] as const))
  return {
    mode: options.mode,
    source: options.mode === 'managed' ? 'model' : 'table',
    ...(options.mode === 'managed' ? { modelId: 'model:accounts/user' } : {}),
    table,
    columns: {
      id: 'user_id',
      identifier: 'username',
      contactEmail: 'contact_email',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    identifier: { kind: 'username', normalization: { preset: 'lowercase' } },
    verification: options.verification,
    eligibility: options.eligibility ?? [{ column: 'active', equals: true }],
    credentials: {
      table,
      identityId: 'user_id',
      password: 'password_hash',
      readers,
      upgrade,
    },
    routes: {
      registration: options.mode === 'managed',
      verification: options.mode === 'managed' && options.verification.mode === 'mapped',
      recovery: options.mode === 'managed',
      passwordChange: options.mode === 'managed',
    },
  }
}

type CompiledAuthentication = Parameters<PostgresAuth['bindCompiledAuthentication']>[0]

async function durableRowCounts(): Promise<{
  entities: number
  journal: number
  outbox: number
}> {
  const result = await pool.query<{
    entities: string
    journal: string
    outbox: string
  }>(`
    SELECT
      (SELECT count(*) FROM doxa_entity_states) AS entities,
      (SELECT count(*) FROM doxa_journal_entries) AS journal,
      (SELECT count(*) FROM doxa_outbox_messages) AS outbox
  `)
  const counts = result.rows[0]!
  return {
    entities: Number(counts.entities),
    journal: Number(counts.journal),
    outbox: Number(counts.outbox),
  }
}

function lifecycleContext() {
  return {
    signal: new AbortController().signal,
    deadline: new Date(Date.now() + 10_000),
  }
}

function jsonRequest(
  url: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function responseData<Payload = unknown>(response: Response): Promise<Payload> {
  const envelope = (await response.json()) as { ok?: unknown; data?: unknown }
  expect(envelope.ok).toBe(true)
  return envelope.data as Payload
}

async function responseFailure(response: Response): Promise<{
  readonly ok: false
  readonly code: string
  readonly message: string
  readonly data: null
  readonly details?: unknown
}> {
  const envelope = (await response.json()) as {
    ok: false
    code: string
    message: string
    data: null
    details?: unknown
  }
  expect(envelope).toEqual(expect.objectContaining({ ok: false, data: null }))
  return envelope
}

function executionContext(id: string): ExecutionContext {
  const actor = Object.freeze({ kind: 'system' as const, id: 'persistence-test' })
  return Object.freeze({
    executionId: id,
    correlationId: id,
    actor,
    initiator: actor,
    delegation: Object.freeze([]),
    authentication: Object.freeze({ state: 'anonymous' as const }),
    transport: Object.freeze({ kind: 'test' as const }),
    trace: Object.freeze({}),
    cancellation: new AbortController().signal,
  })
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMilliseconds = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Condition was not met within ${timeoutMilliseconds}ms.`)
}
