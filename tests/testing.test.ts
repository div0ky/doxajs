import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import {
  ReadOnlyExecutionError,
  ReadOnlyModelError,
  StaleModelError,
  UnknownModelAttributeError,
} from '@doxajs/core'
import {
  DoxaTestHarness,
  FakeMailTransport,
  FakeQueueManager,
  FakeSmsTransport,
  MemoryCache,
  MemoryTelemetry,
  MemoryTransactionManager,
} from '@doxajs/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Application } from '../examples/persistence-app/dist/application.js'
import { CreateCounter } from '../examples/persistence-app/dist/counters/actions/create-counter.js'
import { AssignCounterTag } from '../examples/persistence-app/dist/counters/actions/assign-counter-tag.js'
import { CreateCounterNote } from '../examples/persistence-app/dist/counters/actions/create-counter-note.js'
import { RenameCounter } from '../examples/persistence-app/dist/counters/actions/rename-counter.js'
import { QueueNotifications } from '../examples/persistence-app/dist/counters/actions/queue-notifications.js'
import { RecordLegacyCustomerActivity } from '../examples/persistence-app/dist/counters/actions/record-legacy-customer-activity.js'
import { SaveCounter } from '../examples/persistence-app/dist/counters/actions/save-counter.js'
import { SaveLegacyCustomer } from '../examples/persistence-app/dist/counters/actions/save-legacy-customer.js'
import { ExerciseReadOnlyLegacyCustomer } from '../examples/persistence-app/dist/counters/actions/exercise-read-only-legacy-customer.js'
import { InspectCounterQueries } from '../examples/persistence-app/dist/counters/queries/inspect-counter-queries.js'
import { ConcurrentCounterReads } from '../examples/persistence-app/dist/counters/queries/concurrent-counter-reads.js'
import {
  authorizedActionUser,
  authorizedJobUser,
  authorizedQueryUser,
  ChangeAuthorizedUserBranch,
  ChangeAuthorizedUserBranchJob,
  ReadAuthorizedUser,
  resetAuthorizationOperationProof,
  SeedLegacyAccess,
} from '../examples/persistence-app/dist/authorization/authorization-operations.js'
import {
  permissionSourceDeleteError,
  permissionSourceResolutions,
  permissionSourceUser,
  permissionSourceUsers,
  permissionSourceWriteError,
  resetPermissionSourceProof,
} from '../examples/persistence-app/dist/authorization/application-permissions.js'
import {
  AUTHORIZATION_POLICY_CANCELLATION_BRANCH,
  AUTHORIZATION_POLICY_FAILURE_BRANCH,
  nestedPolicyUser,
  policyAfterCommitRan,
  policyUser,
  policyUnitOfWorkWriteError,
  policyWriteError,
  resetPolicyProof,
} from '../examples/persistence-app/dist/authorization/application-policy.js'
import {
  authorizationEntrypointLog,
  AuthorizationModelSessionCommand,
  AuthorizationModelSessionEvent,
  AuthorizationModelSessionSignal,
  resetAuthorizationEntrypointLog,
} from '../examples/persistence-app/dist/authorization/authorization-entrypoints.js'
import { CounterIncremented } from '../examples/persistence-app/dist/counters/events/counter-incremented.js'
import { CounterSaved } from '../examples/persistence-app/dist/counters/events/counter-saved.js'
import { CounterCreated } from '../examples/persistence-app/dist/counters/events/counter-created.js'
import { RecordCounterIncremented } from '../examples/persistence-app/dist/counters/listeners/record-counter-incremented.js'
import { ProcessCounterJob } from '../examples/persistence-app/dist/counters/jobs/process-counter.job.js'
import { CounterTouched } from '../examples/persistence-app/dist/counters/signals/counter-touched.js'
import {
  recordedEvents,
  resetRecordedEvents,
} from '../examples/persistence-app/dist/support/recorded-events.js'
import {
  recordedJobAttempts,
  resetRecordedJobAttempts,
} from '../examples/persistence-app/dist/support/job-attempts.js'

const workspace = path.resolve(import.meta.dirname, '..')
const applicationRoot = path.join(workspace, 'examples/persistence-app')
let artifacts: string

describe('@doxajs/testing', () => {
  beforeAll(async () => {
    artifacts = await mkdtemp(path.join(tmpdir(), 'doxa-testing-'))
    await compileApplication({
      tsconfigPath: path.join(applicationRoot, 'tsconfig.json'),
      applicationFile: path.join(applicationRoot, 'src/application.ts'),
      sourceRoot: path.join(applicationRoot, 'src'),
      outputRoot: path.join(applicationRoot, 'dist'),
      artifactsDirectory: artifacts,
    })
  })

  afterAll(async () => {
    await rm(artifacts, { recursive: true, force: true })
  })

  it('boots the real manifest with visible deterministic provider overrides', async () => {
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const mail = new FakeMailTransport()
    const sms = new FakeSmsTransport()
    const telemetry = new MemoryTelemetry()
    const harness = await DoxaTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': queue,
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': mail,
        'provider:infrastructure/sms': sms,
        'provider:infrastructure/telemetry': telemetry,
      },
    })
    try {
      harness.actingAsUser('ada')
      expect(await harness.action(CreateCounter, { id: 'memory-counter', value: 4 })).toEqual(
        expect.objectContaining({ id: 'memory-counter', version: 1 }),
      )
      expect(transactions.state.entities.get('model:counters/counter/memory-counter')).toEqual(
        expect.objectContaining({ state: { id: 'memory-counter', value: 4 }, version: 1 }),
      )

      const me = await harness.request('http://doxa.test/auth/me')
      expect(me.status).toBe(200)
      expect(await me.json()).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ actor: { kind: 'user', id: 'ada' } }),
        }),
      )
      const home = await harness.request('http://doxa.test/')
      expect(home.status).toBe(200)
      expect((await harness.request('http://doxa.test/missing')).status).toBe(404)
      expect(harness.logs.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channel: 'home-route',
            message: 'Doxa home visited',
            context: expect.objectContaining({ transport: 'http', actorKind: 'user' }),
          }),
          expect.objectContaining({ channel: 'http', message: 'Execution completed' }),
          expect.objectContaining({
            channel: 'http',
            level: 'warn',
            message: 'GET /missing',
            attributes: { status: 404 },
          }),
        ]),
      )

      const ids = await harness.action(QueueNotifications, { smsFrom: '+13125550000' })
      expect(queue.queued).toHaveLength(2)
      expect(transactions.state.deliveries.get(ids.smsId)?.payload).toEqual(
        expect.objectContaining({ from: '+13125550000' }),
      )
      expect(queue.queued.find((envelope) => envelope.kind === 'sms')?.payload).toEqual(
        expect.objectContaining({ from: '+13125550000' }),
      )
      await queue.runNext()
      await queue.runNext()
      expect(mail.sent).toHaveLength(1)
      expect(sms.sent).toHaveLength(1)
      expect(sms.sent[0]?.from).toBe('+13125550000')
      expect(transactions.state.deliveries.get(ids.mailId)?.state).toBe('accepted')
      expect(transactions.state.deliveries.get(ids.smsId)?.state).toBe('accepted')
      expect(telemetry.records.some((record) => record.kind === 'span')).toBe(true)
      expect(await harness.query(ConcurrentCounterReads, undefined)).toEqual(
        Array.from({ length: 9 }, () => 1),
      )
      expect(
        harness.logs.records.some((record) =>
          record.message.includes('Promise.all does not add database parallelism'),
        ),
      ).toBe(false)
      expect(
        telemetry.records.some(
          (record) =>
            record.kind === 'metric' &&
            record.name === 'doxa.persistence.transaction.serialization.total',
        ),
      ).toBe(false)
      expect(harness.observations?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'action', phase: 'completed' }),
          expect.objectContaining({ kind: 'log', name: 'Doxa home visited' }),
        ]),
      )
    } finally {
      await harness.shutdown()
    }
  })

  it('preserves rollback and after-commit semantics in memory', async () => {
    const transactions = new MemoryTransactionManager()
    const harness = await DoxaTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': new FakeQueueManager(),
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': new FakeMailTransport(),
        'provider:infrastructure/sms': new FakeSmsTransport(),
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
      },
    })
    try {
      harness.actingAsSystem()
      await expect(
        harness.action(SaveCounter, { id: 'rolled-back', amount: 1, failAfterWrites: true }),
      ).rejects.toThrow('failed after persistence writes')
      expect(transactions.state.entities.size).toBe(0)
      expect(transactions.state.journal).toEqual([])
      expect(transactions.state.outbox).toEqual([])
    } finally {
      await harness.shutdown()
    }
  })

  it('preserves mapped-model semantics in the first-party memory fake', async () => {
    const transactions = new MemoryTransactionManager()
    const harness = await DoxaTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': new FakeQueueManager(),
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': new FakeMailTransport(),
        'provider:infrastructure/sms': new FakeSmsTransport(),
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
      },
    })
    try {
      harness.actingAsSystem()
      expect(
        await harness.action(SaveLegacyCustomer, { id: 'mapped-memory', displayName: 'Mapped' }),
      ).toEqual({ id: 'mapped-memory', displayName: 'Mapped', version: 1, created: true })
      const mapped = transactions.state.entities.get(
        'model:counters/legacy-customer/mapped-memory',
      )!
      ;(mapped.state as Record<string, unknown>).passwordHash = 'must-survive'
      ;(mapped.state as Record<string, unknown>).apiToken = 'must-survive'
      ;(mapped.state as Record<string, unknown>).triggerRevision = 17
      await harness.action(SaveLegacyCustomer, {
        id: 'mapped-memory',
        displayName: 'Mapped again',
        nickname: 'Temporary',
      })
      await harness.action(SaveLegacyCustomer, {
        id: 'mapped-memory',
        displayName: 'Mapped again',
        nickname: undefined,
      })
      expect(
        transactions.state.entities.get('model:counters/legacy-customer/mapped-memory'),
      ).toEqual(
        expect.objectContaining({
          state: {
            id: 'mapped-memory',
            displayName: 'Mapped again',
            active: true,
            nullableCode: null,
            passwordHash: 'must-survive',
            apiToken: 'must-survive',
            triggerRevision: 17,
          },
          version: 3,
        }),
      )
      expect(await harness.action(RecordLegacyCustomerActivity, 'mapped-memory')).toEqual({
        saved: true,
        version: 3,
      })
      expect(
        transactions.state.entities.get('model:counters/legacy-customer/mapped-memory')?.version,
      ).toBe(3)
      expect(transactions.state.journal.at(-1)?.type).toBe('legacy-customer.activity-recorded')
      expect(transactions.state.outbox.at(-1)?.type).toBe('legacy-customer.activity-recorded')
      transactions.state.entities.set(
        'model:counters/legacy-customer-read-model/mapped-read-only',
        {
          type: 'model:counters/legacy-customer-read-model',
          id: 'mapped-read-only',
          version: 1,
          state: {
            id: 'mapped-read-only',
            displayName: 'Read only',
            passwordHash: 'never-hydrated',
          },
        },
      )
      expect(
        await harness.action(ExerciseReadOnlyLegacyCustomer, {
          id: 'mapped-read-only',
          operation: 'read',
        }),
      ).toBe('Read only')
      expect(
        await harness.action(ExerciseReadOnlyLegacyCustomer, {
          id: 'mapped-read-only',
          operation: 'read-suite',
        }),
      ).toBe('Read only:1:1:1:1')
      expect(
        await harness.action(ExerciseReadOnlyLegacyCustomer, {
          id: 'mapped-read-only-made',
          operation: 'make',
        }),
      ).toBe('Changed in memory')
      await expect(
        harness.action(ExerciseReadOnlyLegacyCustomer, {
          id: 'mapped-read-only',
          operation: 'unknown',
        }),
      ).rejects.toBeInstanceOf(UnknownModelAttributeError)
      await expect(
        harness.action(ExerciseReadOnlyLegacyCustomer, {
          id: 'mapped-read-only',
          operation: 'fill-unknown',
        }),
      ).rejects.toBeInstanceOf(UnknownModelAttributeError)
      for (const operation of ['save', 'delete', 'create'] as const) {
        await expect(
          harness.action(ExerciseReadOnlyLegacyCustomer, {
            id: operation === 'create' ? 'mapped-read-only-created' : 'mapped-read-only',
            operation,
          }),
        ).rejects.toBeInstanceOf(ReadOnlyModelError)
      }
    } finally {
      await harness.shutdown()
    }
  })

  it('matches typed query, cursor, and eager-relationship semantics in memory', async () => {
    const transactions = new MemoryTransactionManager()
    const harness = await DoxaTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': new FakeQueueManager(),
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': new FakeMailTransport(),
        'provider:infrastructure/sms': new FakeSmsTransport(),
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
      },
    })
    try {
      harness.actingAsSystem()
      for (const [id, value] of [
        ['memory-a', 1],
        ['memory-c', 2],
        ['memory-b', 2],
      ] as const) {
        await harness.action(CreateCounter, { id, value })
        await harness.action(RenameCounter, { id, label: 'memory-group' })
      }
      await harness.action(CreateCounter, { id: 'memory-unlabeled', value: 0 })
      await harness.action(SaveLegacyCustomer, { id: 'memory-zed', displayName: 'Zed' })
      await harness.action(SaveLegacyCustomer, { id: 'memory-ada', displayName: 'Ada' })
      await harness.action(CreateCounterNote, {
        id: 'memory-note-2',
        counterId: 'memory-a',
        body: 'Second',
        rank: 2,
      })
      await harness.action(CreateCounterNote, {
        id: 'memory-note-1',
        counterId: 'memory-a',
        body: 'First',
        rank: 1,
      })
      await harness.action(CreateCounterNote, {
        id: 'memory-note-3',
        counterId: 'memory-c',
        body: 'Third',
        rank: 3,
      })
      await harness.action(AssignCounterTag, {
        id: 'memory-assignment-a-z',
        counterId: 'memory-a',
        tagId: 'memory-tag-z',
        tagName: 'Zeta',
      })
      await harness.action(AssignCounterTag, {
        id: 'memory-assignment-a-a',
        counterId: 'memory-a',
        tagId: 'memory-tag-a',
        tagName: 'Alpha',
      })
      await harness.action(AssignCounterTag, {
        id: 'memory-assignment-c-a',
        counterId: 'memory-c',
        tagId: 'memory-tag-a',
        tagName: 'Alpha',
      })

      expect(
        await harness.query(InspectCounterQueries, {
          minimumValue: 1,
          constrainedNoteRank: 2,
          page: 2,
          perPage: 2,
          cursorSize: 2,
        }),
      ).toEqual(
        expect.objectContaining({
          orderedIds: ['memory-a', 'memory-b', 'memory-c'],
          count: 3,
          totalValue: 5,
          pageIds: ['memory-c'],
          cursorIds: ['memory-a', 'memory-b'],
          nextCursorIds: ['memory-c'],
          previousCursorIds: ['memory-a', 'memory-b'],
          invalidCursorError: 'InvalidModelCursorError',
          mismatchedCursorError: 'InvalidModelCursorError',
          eagerNotes: {
            'memory-a': ['First', 'Second'],
            'memory-b': [],
            'memory-c': ['Third'],
          },
          primaryNotes: {
            'memory-a': 'First',
            'memory-b': undefined,
            'memory-c': 'Third',
          },
          eagerTags: {
            'memory-a': ['Alpha', 'Zeta'],
            'memory-b': [],
            'memory-c': ['Alpha'],
          },
          hasNotes: ['memory-a', 'memory-c'],
          constrainedHasNotes: ['memory-a', 'memory-c'],
          identityMapped: true,
          readOnlyError: 'ReadOnlyExecutionError',
          readOnlyErrors: [
            'ReadOnlyExecutionError',
            'ReadOnlyExecutionError',
            'ReadOnlyExecutionError',
          ],
          iteratedIds: ['memory-a', 'memory-b', 'memory-c'],
          filteredIds: ['memory-a', 'memory-b', 'memory-c'],
          mappedCustomerIds: ['memory-ada', 'memory-zed'],
          nestedIdentityMapped: true,
          hasTags: ['memory-a', 'memory-c'],
          belongsToNoteIds: ['memory-note-1', 'memory-note-2'],
          staticWithIdentityMapped: true,
          foundId: 'memory-a',
          foundNotes: ['First', 'Second'],
          constrainedFindMissing: true,
          missingFind: true,
          missingFindOrFailError: 'Counter missing-counter was not found.',
          booleanIds: ['memory-a', 'memory-c'],
          patternIds: ['memory-a', 'memory-b', 'memory-c'],
          nullLabelIds: ['memory-unlabeled'],
          notInIds: ['memory-b', 'memory-c'],
          columnComparisonCount: 0,
          implicitPageIds: ['memory-c'],
          nullEqualityIds: ['memory-unlabeled'],
          nullInequalityIds: ['memory-a', 'memory-b', 'memory-c'],
          nullMembershipIds: ['memory-unlabeled'],
          nonNullMembershipIds: ['memory-a', 'memory-b', 'memory-c'],
          nullOrderedIds: ['memory-unlabeled', 'memory-a', 'memory-b', 'memory-c'],
        }),
      )
      expect(harness.observations?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'model',
            name: 'query',
            phase: 'occurred',
            roleId: 'model:counters/counter',
            attributes: expect.objectContaining({
              model: 'Counter',
              terminal: 'get',
              constraintCount: 1,
              ordering: ['value:asc', 'id:asc'],
              eagerLoads: ['notes', 'primaryNote', 'tags', 'notes.counter'],
              storage: { kind: 'entity-state' },
            }),
          }),
          expect.objectContaining({
            kind: 'model',
            name: 'query',
            phase: 'occurred',
            roleId: 'model:counters/counter',
            attributes: expect.objectContaining({
              model: 'Counter',
              terminal: 'find',
              constraintCount: 2,
              relationshipConstraintCount: 1,
              ordering: ['id:asc'],
              eagerLoads: ['notes'],
              limit: 1,
              offset: 0,
            }),
          }),
          expect.objectContaining({
            kind: 'model',
            name: 'query',
            phase: 'occurred',
            roleId: 'model:counters/counter',
            attributes: expect.objectContaining({
              model: 'Counter',
              terminal: 'findOrFail',
              constraintCount: 1,
              limit: 1,
            }),
          }),
        ]),
      )
    } finally {
      await harness.shutdown()
    }
  })

  it('gives authorization a bounded read-only model session across runtime paths', async () => {
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const telemetry = new MemoryTelemetry()
    const harness = await DoxaTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': queue,
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': new FakeMailTransport(),
        'provider:infrastructure/sms': new FakeSmsTransport(),
        'provider:infrastructure/telemetry': telemetry,
      },
    })
    const userId = 'authorization-model-user'
    const limitedUserId = 'authorization-model-limited-user'
    const resetProof = () => {
      resetAuthorizationOperationProof()
      resetAuthorizationEntrypointLog()
      resetPermissionSourceProof()
      resetPolicyProof()
      telemetry.reset()
    }
    const decideFor = (actorId: string, branchTag?: string, cancellation?: AbortSignal) =>
      harness.runtime.admit(
        {
          actor: { kind: 'user', id: actorId },
          authentication: { state: 'authenticated', identityId: actorId, method: 'test' },
          transport: { kind: 'test', name: 'test:direct-authorization' },
          ...(cancellation ? { cancellation } : {}),
        },
        () =>
          harness.runtime.authorization.decide(
            'authorization.contact.read',
            branchTag === undefined ? undefined : { branchTag },
          ),
      )
    const authorizationReadTransactions = () =>
      telemetry.records.filter(
        (record) =>
          record.kind === 'metric' &&
          record.name === 'doxa.persistence.transaction.total' &&
          record.attributes.operation === 'authorization',
      )

    try {
      harness.actingAsSystem()
      await harness.action(SeedLegacyAccess, { userId, branchTag: 'CHI' })
      await harness.action(SeedLegacyAccess, {
        userId: limitedUserId,
        branchTag: 'CHI',
        includeGroupOverride: false,
      })
      await harness.action(SeedLegacyAccess, {
        userId: 'doxa:test-scheduler',
        branchTag: 'CHI',
      })

      resetProof()
      harness.actingAsUser(userId)
      expect(
        await harness.query(ReadAuthorizedUser, {
          userId,
          branchTag: 'STL',
        }),
      ).toEqual({
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
      expect(authorizationReadTransactions()).toEqual([])
      expect(() => permissionSourceUser!.refresh()).toThrow(StaleModelError)

      resetProof()
      expect(
        await harness.action(ChangeAuthorizedUserBranch, {
          userId,
          branchTag: 'STL',
        }),
      ).toBe('STL')
      expect(permissionSourceResolutions).toBe(1)
      expect(permissionSourceUser).not.toBe(authorizedActionUser)
      expect(policyUser).not.toBe(authorizedActionUser)
      expect(nestedPolicyUser).toBe(policyUser)
      expect(permissionSourceWriteError).toBe(ReadOnlyExecutionError.name)
      expect(permissionSourceDeleteError).toBe(ReadOnlyExecutionError.name)
      expect(policyWriteError).toBe(ReadOnlyExecutionError.name)
      expect(policyUnitOfWorkWriteError).toBe(ReadOnlyExecutionError.name)
      expect(policyAfterCommitRan).toBe(false)
      expect(authorizationReadTransactions()).toEqual([])
      expect(transactions.state.entities.get(`model:authorization/user/${userId}`)?.state).toEqual(
        expect.objectContaining({ branchTag: 'STL' }),
      )

      resetProof()
      expect(await decideFor(userId, 'STL')).toEqual({
        effect: 'allow',
        policy: 'policy:authorization/application',
        code: 'allowed',
      })
      expect(permissionSourceResolutions).toBe(1)
      expect(permissionSourceUser).toBe(policyUser)
      expect(nestedPolicyUser).toBe(policyUser)
      expect(authorizationReadTransactions()).toHaveLength(1)
      expect(() => policyUser!.refresh()).toThrow(StaleModelError)

      resetProof()
      expect(
        await harness.runtime.admit(
          {
            actor: { kind: 'user', id: userId },
            authentication: {
              state: 'authenticated',
              identityId: userId,
              method: 'bearer',
              constraints: ['authorization.user.update'],
            },
            transport: { kind: 'test', name: 'test:credential-constraint' },
          },
          () => harness.runtime.authorization.decide('authorization.contact.read'),
        ),
      ).toEqual({
        effect: 'deny',
        policy: 'doxa:credential-constraints',
        code: 'credential_constraint_denied',
      })
      expect(permissionSourceResolutions).toBe(0)
      expect(authorizationReadTransactions()).toEqual([])

      resetProof()
      expect(
        await harness.runtime.admit(
          {
            actor: { kind: 'user', id: userId },
            transport: { kind: 'test', name: 'test:default-deny' },
          },
          () => harness.runtime.authorization.decide('authorization.undeclared'),
        ),
      ).toEqual({
        effect: 'deny',
        policy: 'doxa:default-deny',
        code: 'policy_missing',
      })
      expect(permissionSourceResolutions).toBe(0)
      expect(authorizationReadTransactions()).toEqual([])

      resetProof()
      expect(await decideFor('authorization-missing-user')).toEqual({
        effect: 'deny',
        policy: 'permission-source:authorization/application-permissions',
        code: 'permission_required',
      })
      expect(permissionSourceUser).toBeUndefined()
      expect(authorizationReadTransactions()).toHaveLength(1)

      resetProof()
      harness.actingAsUser('authorization-missing-user')
      await expect(
        harness.action(ChangeAuthorizedUserBranch, {
          userId,
          branchTag: 'DENIED',
        }),
      ).rejects.toThrow('not authorized')
      expect(authorizedActionUser).toBeUndefined()
      expect(transactions.state.entities.get(`model:authorization/user/${userId}`)?.state).toEqual(
        expect.objectContaining({ branchTag: 'STL' }),
      )

      resetProof()
      harness.actingAsUser(userId)
      const jobId = await harness.job(ChangeAuthorizedUserBranchJob, {
        userId,
        branchTag: 'MSP',
      })
      await queue.runNext()
      expect(jobId).toBeTruthy()
      expect(permissionSourceResolutions).toBe(1)
      expect(permissionSourceUser).not.toBe(authorizedJobUser)
      expect(policyUser).not.toBe(authorizedJobUser)
      expect(nestedPolicyUser).toBe(policyUser)
      expect(permissionSourceWriteError).toBe(ReadOnlyExecutionError.name)
      expect(permissionSourceDeleteError).toBe(ReadOnlyExecutionError.name)
      expect(policyWriteError).toBe(ReadOnlyExecutionError.name)
      expect(policyUnitOfWorkWriteError).toBe(ReadOnlyExecutionError.name)
      expect(policyAfterCommitRan).toBe(false)
      expect(authorizationReadTransactions()).toEqual([])
      expect(transactions.state.entities.get(`model:authorization/user/${userId}`)?.state).toEqual(
        expect.objectContaining({ branchTag: 'MSP' }),
      )

      resetProof()
      expect(await decideFor(limitedUserId, 'STL')).toEqual({
        effect: 'deny',
        policy: 'policy:authorization/application',
        code: 'branch_scope_required',
      })
      expect(permissionSourceResolutions).toBe(1)
      expect(authorizationReadTransactions()).toHaveLength(1)
      expect(() => policyUser!.refresh()).toThrow(StaleModelError)

      resetProof()
      await expect(decideFor(userId, AUTHORIZATION_POLICY_FAILURE_BRANCH)).rejects.toThrow(
        'Authorization policy fixture failed.',
      )
      expect(() => policyUser!.refresh()).toThrow(StaleModelError)

      resetProof()
      const cancellation = new AbortController()
      const cancelled = decideFor(
        userId,
        AUTHORIZATION_POLICY_CANCELLATION_BRANCH,
        cancellation.signal,
      ).catch((error: unknown) => error)
      for (let attempt = 0; attempt < 100 && !policyUser; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(policyUser).toBeDefined()
      cancellation.abort()
      expect(await cancelled).toEqual(
        expect.objectContaining({
          message: 'Authorization policy fixture cancelled.',
        }),
      )
      expect(() => policyUser!.refresh()).toThrow(StaleModelError)

      resetProof()
      const concurrent = await Promise.all([decideFor(userId, 'MSP'), decideFor(userId, 'MSP')])
      expect(concurrent.map((decision) => decision.effect)).toEqual(['allow', 'allow'])
      expect(permissionSourceResolutions).toBe(2)
      expect(permissionSourceUsers).toHaveLength(2)
      expect(permissionSourceUsers[0]).not.toBe(permissionSourceUsers[1])
      for (const user of permissionSourceUsers) {
        expect(() => user.refresh()).toThrow(StaleModelError)
      }

      resetProof()
      harness.actingAsUser(userId)
      const route = await harness.request('http://doxa.test/authorization/model-session')
      expect(route.status).toBe(200)
      expect(authorizationEntrypointLog).toEqual(['route'])
      expect(permissionSourceResolutions).toBe(1)
      expect(authorizationReadTransactions()).toHaveLength(1)

      resetProof()
      await harness.command(AuthorizationModelSessionCommand.name)
      expect(authorizationEntrypointLog).toEqual(['command'])
      expect(permissionSourceResolutions).toBe(1)
      expect(authorizationReadTransactions()).toHaveLength(1)

      resetProof()
      await harness.event(AuthorizationModelSessionEvent)
      expect(authorizationEntrypointLog).toEqual(['listener'])
      expect(permissionSourceResolutions).toBe(1)
      expect(authorizationReadTransactions()).toHaveLength(1)

      resetProof()
      await harness.signal(AuthorizationModelSessionSignal)
      expect(authorizationEntrypointLog).toEqual(['signal'])
      expect(permissionSourceResolutions).toBe(1)
      expect(authorizationReadTransactions()).toHaveLength(1)

      resetProof()
      await queue.runSchedule('schedule:authorization/authorization-model-session')
      expect(authorizationEntrypointLog).toEqual(['schedule'])
      expect(permissionSourceResolutions).toBe(1)
      expect(authorizationReadTransactions()).toHaveLength(1)
    } finally {
      await harness.shutdown()
    }
  })

  it('drives events, signals, jobs, and schedules through first-party test APIs', async () => {
    resetRecordedEvents()
    resetRecordedJobAttempts()
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const harness = await DoxaTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': queue,
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': new FakeMailTransport(),
        'provider:infrastructure/sms': new FakeSmsTransport(),
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
      },
    })
    try {
      harness.actingAsSystem()
      harness.events.fake([CounterIncremented])
      await harness.event(CounterIncremented, {
        counterId: 'faked-event',
        amount: 1,
        value: 1,
      })
      harness.events.assertDispatched(
        CounterIncremented,
        (event) => event.payload.counterId === 'faked-event',
      )
      harness.events.assertNotDispatched(CounterCreated)
      harness.events.assertListening(CounterIncremented, RecordCounterIncremented)
      expect(recordedEvents.some((event) => event.event === 'counter-incremented')).toBe(false)
      harness.events.restore().clear()

      resetRecordedEvents()
      harness.events.fake([CounterSaved])
      await harness.action(SaveCounter, { id: 'faked-after-commit', amount: 2 })
      harness.events.assertDispatched(CounterSaved)
      expect(recordedEvents.some((event) => event.event === 'counter-saved')).toBe(false)
      harness.events.restore().clear()

      await harness.event(CounterIncremented, { counterId: 'direct-event', amount: 2, value: 2 })
      await harness.signal(CounterTouched, { counterId: 'direct-signal' })
      const jobId = await harness.job(ProcessCounterJob, { key: 'direct-job' })
      expect(queue.hasQueued(ProcessCounterJob)).toBe(true)
      await queue.runNext()
      await queue.runSchedule('schedule:counters/process-counters')
      expect(transactions.state.entities.get('model:counters/counter/scheduled-counter')).toEqual(
        expect.objectContaining({ state: { id: 'scheduled-counter', value: 1 } }),
      )
      expect(recordedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'counter-incremented', value: 2 }),
          expect.objectContaining({ event: 'counter-touched:direct-signal', phase: 'signal' }),
        ]),
      )
      expect(recordedJobAttempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ jobId, key: 'direct-job' }),
          expect.objectContaining({
            key: 'scheduled-counter-sweep',
            causationId: 'schedule:counters/process-counters',
          }),
        ]),
      )
    } finally {
      await harness.shutdown()
    }
  })

  it('rejects unsupported or credential-shaped queued context before job code runs', async () => {
    resetRecordedJobAttempts()
    const queue = new FakeQueueManager()
    const transactions = new MemoryTransactionManager(queue)
    const harness = await DoxaTestHarness.boot(Application, {
      artifactsDirectory: artifacts,
      dotenvPath: false,
      environment: { DATABASE_CONNECTION_STRING: 'test-memory-database' },
      authProviderId: 'provider:infrastructure/auth',
      providerOverrides: {
        'provider:infrastructure/transactions': transactions,
        'provider:infrastructure/queues': queue,
        'provider:infrastructure/cache': new MemoryCache(),
        'provider:infrastructure/mail': new FakeMailTransport(),
        'provider:infrastructure/sms': new FakeSmsTransport(),
        'provider:infrastructure/telemetry': new MemoryTelemetry(),
      },
    })
    try {
      harness.actingAsSystem()
      await harness.job(ProcessCounterJob, { key: 'invalid-context-version' })
      ;(queue.queued[0]!.context as { version: number }).version = 2
      await expect(queue.runNext()).rejects.toThrow('context version is unsupported')

      await harness.job(ProcessCounterJob, { key: 'invalid-session-context' })
      ;(queue.queued[0]!.context.authentication as unknown as Record<string, unknown>).sessionId =
        'must-not-cross-the-queue-boundary'
      await expect(queue.runNext()).rejects.toThrow('authentication context is invalid')
      expect(recordedJobAttempts).toEqual([])
    } finally {
      await harness.shutdown()
    }
  })
})
