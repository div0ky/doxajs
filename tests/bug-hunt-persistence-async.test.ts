import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  applyModelQueryPlan,
  Duration,
  Graphite,
  Instant,
  LocalDate,
  MemoryCache,
  Model,
  ModelReader,
  OptimisticConcurrencyError,
  type JsonValue,
  type ModelQueryPlan,
  type ModelQueryValue,
  type ModelStorage,
  type PersistedEntity,
} from '@doxajs/core'
import { ModelSession, runWithModelSession } from '@doxajs/core/runtime'
import { runPraxis } from '@doxajs/praxis'
import { MemoryTransactionManager } from '@doxajs/testing'
import { describe, expect, it, vi } from 'vitest'

const postgres = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
}))

vi.mock('pg', async (importOriginal) => {
  const original = await importOriginal<typeof import('pg')>()
  return {
    ...original,
    Pool: class {
      query = postgres.query
      end = postgres.end
    },
  }
})

class BugHuntItem extends Model<{
  id: string
  active: boolean
  rank: string | null
}> {
  static override readonly id = 'model:bug-hunt/items'
}

const itemRows: readonly PersistedEntity[] = [
  { type: BugHuntItem.id, id: 'a', version: 1, state: { id: 'a', active: true, rank: null } },
  { type: BugHuntItem.id, id: 'b', version: 1, state: { id: 'b', active: false, rank: null } },
  { type: BugHuntItem.id, id: 'c', version: 1, state: { id: 'c', active: true, rank: 'x' } },
]

class BugHuntReader extends ModelReader {
  async findEntity<State extends JsonValue>(
    type: string,
    id: string,
  ): Promise<PersistedEntity<State> | undefined> {
    return itemRows.find((row) => row.type === type && row.id === id) as
      PersistedEntity<State> | undefined
  }

  async queryEntities<State extends JsonValue>(
    type: string,
    _storage: ModelStorage,
    plan: ModelQueryPlan,
  ): Promise<readonly PersistedEntity<State>[]> {
    const matching = itemRows
      .filter((row) => row.type === type)
      .map((row) => ({ ...(row.state as Record<string, JsonValue>), __row: row }))
    return applyModelQueryPlan(matching, plan).map(
      (value) => value.__row,
    ) as unknown as readonly PersistedEntity<State>[]
  }

  async aggregateEntities(
    _type: string,
    _storage: ModelStorage,
    _plan: ModelQueryPlan,
    _operation: 'count' | 'min' | 'max' | 'sum' | 'average',
    _attribute?: string,
  ): Promise<number | ModelQueryValue | undefined> {
    return undefined
  }
}

function itemSession(): ModelSession {
  return new ModelSession(
    new BugHuntReader(),
    new Map([
      [
        BugHuntItem,
        {
          entityType: BugHuntItem.id,
          storage: { kind: 'entity-state' as const },
          attributes: new Set(['id', 'active', 'rank']),
        },
      ],
    ]),
    undefined,
    false,
  )
}

describe('bug-hunt persistence and async reproductions', () => {
  it('continues nullable ascending cursor pagination into non-null rows', async () => {
    const session = itemSession()
    try {
      await runWithModelSession(session, async () => {
        const first = await BugHuntItem.query().orderBy('rank').cursorPaginate({ first: 2 })
        expect(first.items.map((item) => item.id)).toEqual(['a', 'b'])

        const second = await BugHuntItem.query()
          .orderBy('rank')
          .cursorPaginate({ first: 2, after: first.nextCursor! })
        expect(second.items.map((item) => item.id)).toEqual(['c'])
      })
    } finally {
      session.close()
    }
  })

  it('applies a leading orWhere predicate in the memory query adapter', async () => {
    const session = itemSession()
    try {
      await runWithModelSession(session, async () => {
        const items = await BugHuntItem.query().orWhere('active', true).get()
        expect(items.map((item) => item.id)).toEqual(['a', 'c'])
      })
    } finally {
      session.close()
    }
  })

  it('rejects one of two competing memory transactions at the optimistic version boundary', async () => {
    const transactions = new MemoryTransactionManager()
    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.saveEntity({ type: 'counter', id: 'one', state: { id: 'one', value: 0 } }),
    )

    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let ready = 0
    const write = (value: number) =>
      transactions.transaction({} as never, async (unitOfWork) => {
        const current = await unitOfWork.findEntity<{ id: string; value: number }>('counter', 'one')
        ready += 1
        if (ready === 2) release()
        await barrier
        return unitOfWork.saveEntity({
          type: 'counter',
          id: 'one',
          expectedVersion: current!.version,
          state: { id: 'one', value },
        })
      })

    const results = await Promise.allSettled([write(1), write(2)])
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toEqual(
      expect.objectContaining({ reason: expect.any(OptimisticConcurrencyError) }),
    )
    expect([1, 2]).toContain(
      (transactions.state.entities.get('counter/one')?.state as { value: number }).value,
    )
  })

  it('merges disjoint memory transactions and their journal and outbox writes', async () => {
    const transactions = new MemoryTransactionManager()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let ready = 0
    const write = (id: string) =>
      transactions.transaction({} as never, async (unitOfWork) => {
        await unitOfWork.saveEntity({ type: 'counter', id, state: { id, value: 1 } })
        await unitOfWork.record({
          type: 'counter.created',
          entityType: 'counter',
          entityId: id,
          payload: { id },
        })
        await unitOfWork.enqueue({ type: 'counter.created', payload: { id } })
        ready += 1
        if (ready === 2) release()
        await barrier
      })

    await Promise.all([write('first'), write('second')])

    expect([...transactions.state.entities.keys()].sort()).toEqual([
      'counter/first',
      'counter/second',
    ])
    expect(transactions.state.journal.map((fact) => fact.entityId).sort()).toEqual([
      'first',
      'second',
    ])
    expect(
      transactions.state.outbox.map((message) => (message.payload as { id: string }).id).sort(),
    ).toEqual(['first', 'second'])
  })

  it('rejects a concurrent memory delivery transition without partially applying its writes', async () => {
    const transactions = new MemoryTransactionManager()
    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.stageDelivery({
        id: 'delivery-one',
        channel: 'mail',
        recipients: ['reader@example.test'],
        payload: { id: 'delivery-one' },
      }),
    )
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let ready = 0
    const transition = (state: 'accepted' | 'failed') =>
      transactions.transaction({} as never, async (unitOfWork) => {
        await unitOfWork.saveEntity({
          type: 'delivery-proof',
          id: state,
          state: { id: state },
        })
        await unitOfWork.transitionDelivery({ messageId: 'delivery-one', state })
        ready += 1
        if (ready === 2) release()
        await barrier
      })

    const results = await Promise.allSettled([transition('accepted'), transition('failed')])

    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.any(OptimisticConcurrencyError) }),
    ])
    expect(['accepted', 'failed']).toContain(
      transactions.state.deliveries.get('delivery-one')?.state,
    )
    expect([...transactions.state.entities.keys()]).toHaveLength(1)
  })

  it('uses monotonic delivery transitions and clears stale failure metadata in memory', async () => {
    const transactions = new MemoryTransactionManager()
    await transactions.transaction({} as never, async (unitOfWork) => {
      await unitOfWork.stageDelivery({
        id: 'delivery-two',
        channel: 'sms',
        recipients: ['+13125550000'],
        payload: { id: 'delivery-two' },
      })
      await unitOfWork.transitionDelivery({
        messageId: 'delivery-two',
        state: 'failed',
        failureKind: 'permanent',
        code: 'provider-rejected',
      })
    })
    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.transitionDelivery({ messageId: 'delivery-two', state: 'suppressed' }),
    )

    expect(transactions.state.deliveries.get('delivery-two')).toEqual(
      expect.objectContaining({ state: 'suppressed' }),
    )
    expect(transactions.state.deliveries.get('delivery-two')).not.toHaveProperty('failureKind')
    expect(transactions.state.deliveries.get('delivery-two')).not.toHaveProperty('code')
  })

  it('records provider events once even when their delivery transition is ignored', async () => {
    const transactions = new MemoryTransactionManager()
    await transactions.transaction({} as never, async (unitOfWork) => {
      await unitOfWork.stageDelivery({
        id: 'delivery-events',
        channel: 'mail',
        recipients: ['reader@example.test'],
        payload: { id: 'delivery-events' },
      })
      await unitOfWork.transitionDelivery({ messageId: 'delivery-events', state: 'delivered' })
    })
    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.transitionDelivery({
        messageId: 'delivery-events',
        eventId: 'provider-event-one',
        state: 'accepted',
      }),
    )
    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.transitionDelivery({
        messageId: 'delivery-events',
        eventId: 'provider-event-one',
        state: 'suppressed',
      }),
    )

    expect(transactions.state.deliveryEvents).toContain('provider-event-one')
    expect(transactions.state.deliveries.get('delivery-events')?.state).toBe('delivered')
  })

  it('records provider events that arrive before their delivery is staged', async () => {
    const transactions = new MemoryTransactionManager()
    const transition = {
      messageId: 'early-delivery-event',
      eventId: 'early-provider-event',
      state: 'delivered' as const,
    }
    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.transitionDelivery(transition),
    )
    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.stageDelivery({
        id: 'early-delivery-event',
        channel: 'mail',
        recipients: ['reader@example.test'],
        payload: { id: 'early-delivery-event' },
      }),
    )
    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.transitionDelivery(transition),
    )

    expect(transactions.state.deliveryEvents).toContain('early-provider-event')
    expect(transactions.state.deliveries.get('early-delivery-event')?.state).toBe('pending')
  })

  it('does not replay an early provider event onto a concurrently staged delivery', async () => {
    const transactions = new MemoryTransactionManager()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let ready!: () => void
    const earlyTransitionStarted = new Promise<void>((resolve) => {
      ready = resolve
    })
    const earlyTransition = transactions.transaction({} as never, async (unitOfWork) => {
      await unitOfWork.transitionDelivery({
        messageId: 'concurrent-early-event',
        eventId: 'concurrent-early-provider-event',
        state: 'delivered',
      })
      ready()
      await barrier
    })
    await earlyTransitionStarted
    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.stageDelivery({
        id: 'concurrent-early-event',
        channel: 'mail',
        recipients: ['reader@example.test'],
        payload: { id: 'concurrent-early-event' },
      }),
    )
    release()
    await earlyTransition

    expect(transactions.state.deliveryEvents).toContain('concurrent-early-provider-event')
    expect(transactions.state.deliveries.get('concurrent-early-event')?.state).toBe('pending')
  })

  it('treats concurrent duplicate provider events as harmless no-ops', async () => {
    const transactions = new MemoryTransactionManager()
    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.stageDelivery({
        id: 'concurrent-delivery-event',
        channel: 'sms',
        recipients: ['+13125550000'],
        payload: { id: 'concurrent-delivery-event' },
      }),
    )
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let ready = 0
    const reconcile = (id: string) =>
      transactions.transaction({} as never, async (unitOfWork) => {
        await unitOfWork.saveEntity({ type: 'event-proof', id, state: { id } })
        await unitOfWork.transitionDelivery({
          messageId: 'concurrent-delivery-event',
          eventId: 'duplicate-provider-event',
          state: 'delivered',
        })
        ready += 1
        if (ready === 2) release()
        await barrier
      })

    await expect(Promise.all([reconcile('first'), reconcile('second')])).resolves.toEqual([
      undefined,
      undefined,
    ])
    expect(transactions.state.deliveries.get('concurrent-delivery-event')?.state).toBe('delivered')
    expect([...transactions.state.entities.keys()].sort()).toEqual([
      'event-proof/first',
      'event-proof/second',
    ])
  })

  it('preserves Doxa datetime values in memory-backed mapped models', async () => {
    const transactions = new MemoryTransactionManager()
    const occurredAt = Instant.parse('2026-08-05T12:00:00.000000Z')
    const localDate = LocalDate.parse('2026-08-05')
    const duration = Duration.parse('PT90M')
    const graphite = Graphite.parse('2026-08-05T07:00:00.000000-05:00[America/Chicago]')
    const collision = { $doxa: 'application-data', value: 'untouched' }
    const storage = {
      kind: 'table',
      table: 'events',
      primaryKey: 'id',
      columns: {
        id: 'id',
        occurredAt: 'occurred_at',
        localDate: 'local_date',
        duration: 'duration',
        graphite: 'graphite',
        collision: 'collision',
      },
      timestamps: false,
    } satisfies ModelStorage

    await transactions.transaction({} as never, (unitOfWork) =>
      unitOfWork.saveEntity({
        type: 'event',
        id: 'one',
        state: { id: 'one', occurredAt, localDate, duration, graphite, collision } as never,
        storage,
      }),
    )
    const found = await transactions.read({} as never, (reader) =>
      reader.findEntity('event', 'one', storage),
    )

    const state = found!.state as unknown as {
      occurredAt: Instant
      localDate: LocalDate
      duration: Duration
      graphite: Graphite
      collision: typeof collision
    }
    expect(state.occurredAt).toBeInstanceOf(Instant)
    expect(state.localDate).toBeInstanceOf(LocalDate)
    expect(state.duration).toBeInstanceOf(Duration)
    expect(state.graphite).toBeInstanceOf(Graphite)
    expect(state.occurredAt.toString()).toBe(occurredAt.toString())
    expect(state.localDate.toString()).toBe(localDate.toString())
    expect(state.duration.toString()).toBe(duration.toString())
    expect(state.graphite.toString()).toBe(graphite.toString())
    expect(state.collision).toEqual(collision)

    const patch = { collision: { nested: { value: 'saved' } } }
    await transactions.transaction({} as never, async (unitOfWork) => {
      await unitOfWork.saveEntity({
        type: 'event',
        id: 'one',
        expectedVersion: 1,
        state: found!.state,
        patch,
        storage,
      })
      patch.collision.nested.value = 'mutated-after-save'
    })
    const updated = await transactions.read({} as never, (reader) =>
      reader.findEntity('event', 'one', storage),
    )
    expect((updated!.state as { collision: unknown }).collision).toEqual({
      nested: { value: 'saved' },
    })
  })

  it('keeps MemoryCache add and increment atomic under concurrent callers', async () => {
    const cache = new MemoryCache()
    const additions = await Promise.all([cache.add('lock', 'first'), cache.add('lock', 'second')])
    const increments = await Promise.all([cache.increment('count'), cache.increment('count')])

    expect.soft(additions).toEqual([true, false])
    expect.soft(increments).toEqual([1, 2])
    expect.soft(await cache.get('count')).toBe(2)
  })

  it('rejects an ambiguous short schedule ID before mutating schedule state', async () => {
    postgres.query.mockClear()
    postgres.end.mockClear()
    postgres.query.mockResolvedValue({ rows: [], rowCount: 1 })
    postgres.end.mockResolvedValue(undefined)
    const root = await mkdtemp(path.join(tmpdir(), 'doxa-schedule-ambiguity-'))
    const errors: string[] = []
    try {
      await mkdir(path.join(root, '.doxa'), { recursive: true })
      await mkdir(path.join(root, 'dist'), { recursive: true })
      await writeFile(
        path.join(root, '.doxa', 'manifest.json'),
        JSON.stringify({
          applicationId: 'bug-hunt',
          buildHash: 'bug-hunt-schedule-ambiguity',
          commands: [],
          schedules: [
            {
              id: 'schedule:first/cleanup',
              jobId: 'job:first/cleanup',
              cadence: { kind: 'interval', seconds: 60 },
              timeZone: 'UTC',
              input: {},
            },
            {
              id: 'schedule:second/cleanup',
              jobId: 'job:second/cleanup',
              cadence: { kind: 'interval', seconds: 60 },
              timeZone: 'UTC',
              input: {},
            },
          ],
          jobs: [
            {
              id: 'job:first/cleanup',
              retries: 0,
              retryDelay: 1,
              backoff: false,
              timeout: 30,
            },
            {
              id: 'job:second/cleanup',
              retries: 0,
              retryDelay: 1,
              backoff: false,
              timeout: 30,
            },
          ],
        }),
      )
      await writeFile(
        path.join(root, '.doxa', 'registry.mjs'),
        `export class Application {}\nexport const constructors = { 'application:bug-hunt': Application }\n`,
      )
      await writeFile(path.join(root, 'dist', 'app.config.js'), 'export {}\n')

      const code = await runPraxis(
        ['schedule:disable', 'cleanup', '--database=postgresql://unused'],
        root,
        { out: () => undefined, error: (message) => errors.push(message) },
      )

      expect.soft(code).toBe(1)
      expect.soft(errors.join('\n')).toMatch(/ambiguous/i)
      expect.soft(errors.join('\n')).toContain('schedule:first/cleanup')
      expect.soft(errors.join('\n')).toContain('schedule:second/cleanup')
      expect.soft(postgres.query).not.toHaveBeenCalled()
      expect
        .soft(
          postgres.query.mock.calls.some(([statement]) =>
            String(statement).includes('UPDATE doxa_schedule_controls'),
          ),
        )
        .toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
