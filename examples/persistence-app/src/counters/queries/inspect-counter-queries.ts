import { Query, type ModelQuery } from '@doxajs/core'

import {
  Counter,
  CounterNote,
  type CounterAttributes,
  type CounterRelations,
} from '../models/counter.js'
import { LegacyCustomer } from '../models/legacy-customer.js'

export let capturedCounterFindQuery:
  ModelQuery<Counter, CounterAttributes, CounterRelations> | undefined

export function resetCapturedCounterFindQuery(): void {
  capturedCounterFindQuery = undefined
}

export interface InspectCounterQueriesInput {
  readonly minimumValue: number
  readonly constrainedNoteRank: number
  readonly page: number
  readonly perPage: number
  readonly cursorSize: number
}

export interface InspectCounterQueriesResult {
  readonly orderedIds: readonly string[]
  readonly firstId: string | undefined
  readonly count: number
  readonly totalValue: number
  readonly pageIds: readonly string[]
  readonly pageTotal: number
  readonly cursorIds: readonly string[]
  readonly nextCursorIds: readonly string[]
  readonly previousCursorIds: readonly string[]
  readonly invalidCursorError: string | undefined
  readonly mismatchedCursorError: string | undefined
  readonly eagerNotes: Readonly<Record<string, readonly string[]>>
  readonly primaryNotes: Readonly<Record<string, string | undefined>>
  readonly eagerTags: Readonly<Record<string, readonly string[]>>
  readonly hasNotes: readonly string[]
  readonly constrainedHasNotes: readonly string[]
  readonly identityMapped: boolean
  readonly readOnlyError: string | undefined
  readonly readOnlyErrors: readonly string[]
  readonly iteratedIds: readonly string[]
  readonly filteredIds: readonly string[]
  readonly mappedCustomerIds: readonly string[]
  readonly nestedIdentityMapped: boolean
  readonly hasTags: readonly string[]
  readonly belongsToNoteIds: readonly string[]
  readonly staticWithIdentityMapped: boolean
  readonly foundId: string | undefined
  readonly foundNotes: readonly string[]
  readonly constrainedFindMissing: boolean
  readonly missingFind: boolean
  readonly missingFindOrFailError: string | undefined
  readonly booleanIds: readonly string[]
  readonly patternIds: readonly string[]
  readonly nullLabelIds: readonly string[]
  readonly notInIds: readonly string[]
  readonly columnComparisonCount: number
  readonly implicitPageIds: readonly string[]
  readonly nullEqualityIds: readonly string[]
  readonly nullInequalityIds: readonly string[]
  readonly nullMembershipIds: readonly string[]
  readonly nonNullMembershipIds: readonly string[]
  readonly nullOrderedIds: readonly string[]
  readonly nullableAscendingCursorPages: readonly (readonly string[])[]
  readonly nullableAscendingBeforeIds: readonly string[]
  readonly nullableDescendingCursorPages: readonly (readonly string[])[]
  readonly nullableDescendingBeforeIds: readonly string[]
}

export class InspectCounterQueries extends Query<
  InspectCounterQueriesInput,
  InspectCounterQueriesResult
> {
  static id = 'inspect-counter-queries'
  static override readonly access = 'public'

  async handle(input: InspectCounterQueriesInput): Promise<InspectCounterQueriesResult> {
    const base = Counter.where('value', '>=', input.minimumValue).orderBy('value').orderBy('id')
    const staticWithFirst = await Counter.with('notes')
      .where('value', '>=', input.minimumValue)
      .orderBy('value')
      .orderBy('id')
      .first()
    const counters = await base
      .with({
        notes: (query) => query.orderBy('rank').orderBy('id'),
        primaryNote: (query) => query.orderBy('rank').orderBy('id'),
        tags: (query) => query.orderBy('name').orderBy('id'),
      })
      .with('notes.counter')
      .get()
    const first = counters[0]
    const firstAgain = first ? await Counter.where({ id: first.id }).first() : undefined
    const findQuery = Counter.with({
      notes: (query) => query.orderBy('rank').orderBy('id'),
    })
      .where('value', '>=', input.minimumValue)
      .has('notes')
      .orderBy('id')
      .limit(7)
      .offset(0)
    capturedCounterFindQuery = findQuery
    const found = first ? await findQuery.find(first.id) : undefined
    const constrainedFindMissing = first
      ? (await Counter.where('value', '<', input.minimumValue).find(first.id)) === undefined
      : true
    const missingFind = (await Counter.query().find('missing-counter')) === undefined
    let missingFindOrFailError: string | undefined
    try {
      await Counter.query().findOrFail('missing-counter')
    } catch (error) {
      missingFindOrFailError = error instanceof Error ? error.message : String(error)
    }
    const page = await base.paginate({ page: input.page, perPage: input.perPage })
    const cursorPage = await base.cursorPaginate({ first: input.cursorSize })
    const nextCursorPage = cursorPage.nextCursor
      ? await base.cursorPaginate({ first: input.cursorSize, after: cursorPage.nextCursor })
      : { items: [] }
    const previousCursorPage = nextCursorPage.previousCursor
      ? await base.cursorPaginate({
          first: input.cursorSize,
          before: nextCursorPage.previousCursor,
        })
      : { items: [] }
    let invalidCursorError: string | undefined
    try {
      await base.cursorPaginate({ first: input.cursorSize, after: 'not-a-doxa-cursor' })
    } catch (error) {
      invalidCursorError = error instanceof Error ? error.name : String(error)
    }
    let mismatchedCursorError: string | undefined
    if (cursorPage.nextCursor) {
      try {
        await Counter.query()
          .orderBy('label')
          .orderBy('id')
          .cursorPaginate({ first: input.cursorSize, after: cursorPage.nextCursor })
      } catch (error) {
        mismatchedCursorError = error instanceof Error ? error.name : String(error)
      }
    }
    const iteratedIds: string[] = []
    for await (const counter of base.cursor({ batchSize: input.cursorSize })) {
      iteratedIds.push(counter.id)
    }
    let readOnlyError: string | undefined
    const readOnlyErrors: string[] = []
    if (first) {
      first.setAttribute('label', 'query-mutation-must-not-persist')
      try {
        await first.save()
      } catch (error) {
        readOnlyError = error instanceof Error ? error.name : String(error)
        readOnlyErrors.push(readOnlyError)
      }
      try {
        await first.delete()
      } catch (error) {
        readOnlyErrors.push(error instanceof Error ? error.name : String(error))
      }
    }
    try {
      await Counter.create({ id: 'query-forbidden-create', value: 0 })
    } catch (error) {
      readOnlyErrors.push(error instanceof Error ? error.name : String(error))
    }
    const nullableAscending = Counter.query().orderBy('label').orderBy('value').orderBy('id')
    const nullableAscendingFirst = await nullableAscending.cursorPaginate({ first: 2 })
    const nullableAscendingSecond = nullableAscendingFirst.nextCursor
      ? await nullableAscending.cursorPaginate({
          first: 2,
          after: nullableAscendingFirst.nextCursor,
        })
      : undefined
    const nullableAscendingThird = nullableAscendingSecond?.nextCursor
      ? await nullableAscending.cursorPaginate({
          first: 2,
          after: nullableAscendingSecond.nextCursor,
        })
      : undefined
    const nullableAscendingBefore = nullableAscendingSecond?.previousCursor
      ? await nullableAscending.cursorPaginate({
          first: 2,
          before: nullableAscendingSecond.previousCursor,
        })
      : undefined
    const nullableDescending = Counter.query()
      .orderBy('label', 'desc')
      .orderBy('value', 'desc')
      .orderBy('id', 'desc')
    const nullableDescendingFirst = await nullableDescending.cursorPaginate({ first: 2 })
    const nullableDescendingSecond = nullableDescendingFirst.nextCursor
      ? await nullableDescending.cursorPaginate({
          first: 2,
          after: nullableDescendingFirst.nextCursor,
        })
      : undefined
    const nullableDescendingThird = nullableDescendingSecond?.nextCursor
      ? await nullableDescending.cursorPaginate({
          first: 2,
          after: nullableDescendingSecond.nextCursor,
        })
      : undefined
    const nullableDescendingBefore = nullableDescendingThird?.previousCursor
      ? await nullableDescending.cursorPaginate({
          first: 2,
          before: nullableDescendingThird.previousCursor,
        })
      : undefined
    return {
      orderedIds: counters.map((counter) => counter.id),
      firstId: (await base.first())?.id,
      count: await base.count(),
      totalValue: await base.sum('value'),
      pageIds: page.items.map((counter) => counter.id),
      pageTotal: page.total,
      cursorIds: cursorPage.items.map((counter) => counter.id),
      nextCursorIds: nextCursorPage.items.map((counter) => counter.id),
      previousCursorIds: previousCursorPage.items.map((counter) => counter.id),
      invalidCursorError,
      mismatchedCursorError,
      eagerNotes: Object.fromEntries(
        counters.map((counter) => [counter.id, counter.notes.map((note) => note.body)]),
      ),
      primaryNotes: Object.fromEntries(
        counters.map((counter) => [counter.id, counter.primaryNote?.body]),
      ),
      eagerTags: Object.fromEntries(
        counters.map((counter) => [counter.id, counter.tags.map((tag) => tag.name)]),
      ),
      hasNotes: await Counter.query().has('notes').orderBy('id').pluck('id'),
      constrainedHasNotes: await Counter.query()
        .whereHas('notes', (query) => query.where('rank', '>=', input.constrainedNoteRank))
        .orderBy('id')
        .pluck('id'),
      identityMapped: first !== undefined && first === firstAgain,
      readOnlyError,
      readOnlyErrors,
      iteratedIds,
      filteredIds: await Counter.query()
        .where((query) =>
          query
            .whereBetween('value', [input.minimumValue, input.minimumValue + 1])
            .whereNotNull('label'),
        )
        .whereIn(
          'id',
          counters.map((counter) => counter.id),
        )
        .orderBy('id')
        .pluck('id'),
      mappedCustomerIds: await LegacyCustomer.where({ active: true })
        .orderBy('displayName')
        .pluck('id'),
      nestedIdentityMapped: counters.every((counter) =>
        counter.notes.every((note) => note.counter === counter),
      ),
      hasTags: await Counter.query().has('tags').orderBy('id').pluck('id'),
      belongsToNoteIds: first
        ? await CounterNote.query().whereBelongsTo(first, 'counter').orderBy('id').pluck('id')
        : [],
      staticWithIdentityMapped: first !== undefined && first === staticWithFirst,
      foundId: found?.id,
      foundNotes: found?.notes.map((note) => note.body) ?? [],
      constrainedFindMissing,
      missingFind,
      missingFindOrFailError,
      booleanIds:
        first && counters.at(-1)
          ? await Counter.query()
              .where((query) => query.where({ id: first.id }).orWhere({ id: counters.at(-1)!.id }))
              .orderBy('id')
              .pluck('id')
          : [],
      patternIds: await Counter.query().where('label', 'ilike', '%GROUP').orderBy('id').pluck('id'),
      nullLabelIds: await Counter.query().whereNull('label').orderBy('id').pluck('id'),
      notInIds: await base
        .whereNotIn('id', first ? [first.id] : [])
        .orderBy('id')
        .pluck('id'),
      columnComparisonCount: await Counter.query().whereColumn('id', '=', 'label').count(),
      implicitPageIds: (
        await Counter.where('value', '>=', input.minimumValue)
          .orderBy('value')
          .paginate({ page: input.page, perPage: input.perPage })
      ).items.map((counter) => counter.id),
      nullEqualityIds: await Counter.where('label', null).orderBy('id').pluck('id'),
      nullInequalityIds: await Counter.where('label', '!=', null).orderBy('id').pluck('id'),
      nullMembershipIds: await Counter.query().whereIn('label', [null]).orderBy('id').pluck('id'),
      nonNullMembershipIds: await Counter.query()
        .whereNotIn('label', [null])
        .orderBy('id')
        .pluck('id'),
      nullOrderedIds: await Counter.query().orderBy('label').orderBy('id').pluck('id'),
      nullableAscendingCursorPages: [
        nullableAscendingFirst.items.map((counter) => counter.id),
        ...(nullableAscendingSecond
          ? [nullableAscendingSecond.items.map((counter) => counter.id)]
          : []),
        ...(nullableAscendingThird
          ? [nullableAscendingThird.items.map((counter) => counter.id)]
          : []),
      ],
      nullableAscendingBeforeIds: nullableAscendingBefore?.items.map((counter) => counter.id) ?? [],
      nullableDescendingCursorPages: [
        nullableDescendingFirst.items.map((counter) => counter.id),
        ...(nullableDescendingSecond
          ? [nullableDescendingSecond.items.map((counter) => counter.id)]
          : []),
        ...(nullableDescendingThird
          ? [nullableDescendingThird.items.map((counter) => counter.id)]
          : []),
      ],
      nullableDescendingBeforeIds:
        nullableDescendingBefore?.items.map((counter) => counter.id) ?? [],
    }
  }
}
