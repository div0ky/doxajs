import {
  applyModelQueryPlan,
  MemoryCache,
  Model,
  ModelReader,
  type JsonValue,
  type ModelQueryPlan,
  type ModelQueryValue,
  type ModelStorage,
  type PersistedEntity,
} from '@doxajs/core'
import { ModelSession, runWithModelSession } from '@doxajs/core/runtime'
import { describe, expect, it } from 'vitest'

class CursorItem extends Model<{
  id: string
  active: boolean
  priority: number
  rank?: string | null
}> {
  static override readonly id = 'model:core-regressions/cursor-items'
}

const rows: readonly PersistedEntity[] = [
  {
    type: CursorItem.id,
    id: 'a',
    version: 1,
    state: { id: 'a', active: true, priority: 2, rank: null },
  },
  {
    type: CursorItem.id,
    id: 'b',
    version: 1,
    state: { id: 'b', active: false, priority: 1 },
  },
  {
    type: CursorItem.id,
    id: 'c',
    version: 1,
    state: { id: 'c', active: true, priority: 2, rank: 'x' },
  },
  {
    type: CursorItem.id,
    id: 'd',
    version: 1,
    state: { id: 'd', active: false, priority: 1, rank: 'x' },
  },
  {
    type: CursorItem.id,
    id: 'e',
    version: 1,
    state: { id: 'e', active: true, priority: 1, rank: 'y' },
  },
]

class CursorReader extends ModelReader {
  async findEntity<State extends JsonValue>(
    type: string,
    id: string,
  ): Promise<PersistedEntity<State> | undefined> {
    return rows.find((row) => row.type === type && row.id === id) as
      PersistedEntity<State> | undefined
  }

  async queryEntities<State extends JsonValue>(
    type: string,
    _storage: ModelStorage,
    plan: ModelQueryPlan,
  ): Promise<readonly PersistedEntity<State>[]> {
    const matching = rows
      .filter((row) => row.type === type)
      .map((row) => ({ ...(row.state as Record<string, JsonValue>), row }))
    return applyModelQueryPlan(matching, plan).map(
      (value) => value.row,
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

function cursorSession(): ModelSession {
  return new ModelSession(
    new CursorReader(),
    new Map([
      [
        CursorItem,
        {
          entityType: CursorItem.id,
          storage: { kind: 'entity-state' as const },
          attributes: new Set(['id', 'active', 'priority', 'rank']),
          optionalAttributes: new Set(['rank']),
        },
      ],
    ]),
    undefined,
    false,
  )
}

describe('core correctness regressions', () => {
  it('paginates nullable multi-column ordering in both directions', async () => {
    const session = cursorSession()
    try {
      await runWithModelSession(session, async () => {
        const dirty = await CursorItem.findOrFail('b')
        dirty.setAttribute('rank', 'dirty-but-unsaved')
        const ascending = () => CursorItem.query().orderBy('rank').orderBy('priority')
        const first = await ascending().cursorPaginate({ first: 2 })
        const second = await ascending().cursorPaginate({ first: 2, after: first.nextCursor! })
        const third = await ascending().cursorPaginate({ first: 2, after: second.nextCursor! })
        expect(first.items.map(({ id }) => id)).toEqual(['b', 'a'])
        expect(second.items.map(({ id }) => id)).toEqual(['d', 'c'])
        expect(third.items.map(({ id }) => id)).toEqual(['e'])
        expect(
          (
            await ascending().cursorPaginate({ first: 2, before: second.previousCursor! })
          ).items.map(({ id }) => id),
        ).toEqual(['b', 'a'])

        const firstNull = await ascending().cursorPaginate({ first: 1 })
        expect(
          (await ascending().cursorPaginate({ first: 1, before: firstNull.nextCursor! })).items,
        ).toEqual([])

        const descending = () => CursorItem.query().orderBy('rank', 'desc').orderBy('priority')
        const descendingFirst = await descending().cursorPaginate({ first: 2 })
        const descendingSecond = await descending().cursorPaginate({
          first: 2,
          after: descendingFirst.nextCursor!,
        })
        const descendingThird = await descending().cursorPaginate({
          first: 2,
          after: descendingSecond.nextCursor!,
        })
        expect(descendingFirst.items.map(({ id }) => id)).toEqual(['e', 'd'])
        expect(descendingSecond.items.map(({ id }) => id)).toEqual(['c', 'b'])
        expect(descendingThird.items.map(({ id }) => id)).toEqual(['a'])
        expect(
          (
            await descending().cursorPaginate({
              first: 2,
              before: descendingThird.previousCursor!,
            })
          ).items.map(({ id }) => id),
        ).toEqual(['c', 'b'])
      })
    } finally {
      session.close()
    }
  })

  it('evaluates a leading OR directly at top level and inside groups', () => {
    const values = [
      { active: false, id: 'a' },
      { active: true, id: 'b' },
    ]
    expect(
      applyModelQueryPlan(values, CursorItem.query().orWhere('active', true).plan).map(
        ({ id }) => id,
      ),
    ).toEqual(['b'])
    expect(
      applyModelQueryPlan(
        values,
        CursorItem.query().where((query) => query.orWhere('active', true)).plan,
      ).map(({ id }) => id),
    ).toEqual(['b'])
  })

  it('keeps memory cache add and increment read-modify-write operations synchronous', async () => {
    let now = 1_000
    const cache = new MemoryCache(() => now)
    expect(await Promise.all([cache.add('lock', 'first'), cache.add('lock', 'second')])).toEqual([
      true,
      false,
    ])
    expect(await Promise.all([cache.increment('count'), cache.increment('count')])).toEqual([1, 2])

    await cache.put('expiring', 1, { ttlSeconds: 2 })
    expect(await cache.increment('expiring', 1, { ttlSeconds: 10 })).toBe(2)
    now = 3_001
    expect(await cache.get('expiring')).toBeUndefined()

    await cache.put('label', 'not-a-number')
    await expect(cache.increment('label')).rejects.toBeInstanceOf(TypeError)
    expect(await cache.get('label')).toBe('not-a-number')
  })
})
