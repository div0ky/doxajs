import { Duration, Model } from '@doxajs/core'

import { Counter, CounterNote } from '../examples/persistence-app/dist/counters/models/counter.js'

function modelQueryTypeProofs(): void {
  Counter.where({ value: 1 }).orderBy('value')
  Counter.query().find('counter')
  Counter.where({ value: 1 }).findOrFail('counter')
  Counter.with('notes')
  Counter.with('notes.counter')
  Counter.with({ notes: (query) => query.where('rank', '>=', 1).orderBy('body') })
  CounterNote.query().whereBelongsTo(new Counter({ id: 'counter', value: 1 }), 'counter')
  Counter.query().whereHas('notes', (query) => query.where('rank', '>=', 1))
  Counter.prototype.getAttribute('value')
  Counter.prototype.setAttribute('value', 2)
  Counter.prototype.setAttribute('label', undefined)
  Counter.prototype.fill({ value: 2, label: undefined })

  // @ts-expect-error Unknown model attributes fail at compilation.
  Counter.where({ unknown: true })
  // @ts-expect-error Unknown relationship names fail at compilation.
  Counter.with('unknown')
  // @ts-expect-error Unknown nested relationship names fail at compilation.
  Counter.with('notes.unknown')
  // @ts-expect-error Constrained eager-load callbacks retain the related model's attributes.
  Counter.with({ notes: (query) => query.where('unknown', true) })
  // @ts-expect-error Relationship-existence callbacks retain the related model's attributes.
  Counter.query().whereHas('notes', (query) => query.where('unknown', true))
  // @ts-expect-error Pattern comparisons require string attributes.
  Counter.where('value', 'like', 1)
  // @ts-expect-error Undefined is not a query value; use a null predicate for missing attributes.
  Counter.where({ label: undefined })
  // @ts-expect-error Numeric aggregates require numeric attributes.
  Counter.query().sum('label')
  // @ts-expect-error Model identity is immutable after construction.
  Counter.prototype.setAttribute('id', 'other')
  // @ts-expect-error Model identity cannot be mass assigned.
  Counter.prototype.fill({ id: 'other' })
  // @ts-expect-error Unknown model attributes fail at compilation.
  Counter.prototype.setAttribute('unknown', true)
  // @ts-expect-error Unknown model attributes cannot be read through a permissive string overload.
  Counter.prototype.getAttribute('password')
  // @ts-expect-error Attribute values retain their declared types.
  Counter.prototype.fill({ value: 'two' })
  // @ts-expect-error Required attributes cannot be removed.
  Counter.prototype.fill({ value: undefined })
  // @ts-expect-error Logical model identities are strings.
  Counter.query().find(1)
}

class ModelIdentityTypeProof extends Counter {
  attemptIdentityMutation(): void {
    // @ts-expect-error Model identity is readonly inside model behavior too.
    this.attributes.id = 'other'
    // @ts-expect-error The protected attribute bag cannot be replaced.
    this.attributes = { id: 'other', value: 1 }
  }
}

class RequiredUndefinedTypeProof extends Model<{
  id: string
  required: string | undefined
  optional?: string
}> {}

RequiredUndefinedTypeProof.prototype.setAttribute('required', 'value')
RequiredUndefinedTypeProof.prototype.setAttribute('optional', undefined)
// @ts-expect-error Only optional attributes can be removed.
RequiredUndefinedTypeProof.prototype.setAttribute('required', undefined)
// @ts-expect-error Required attributes cannot be removed through fill.
RequiredUndefinedTypeProof.prototype.fill({ required: undefined })

void modelQueryTypeProofs
void ModelIdentityTypeProof

class DurationQueryTypeProof extends Model<{ id: string; elapsed: Duration }> {}

DurationQueryTypeProof.where('elapsed', Duration.parse('PT1H'))
DurationQueryTypeProof.query().whereIn('elapsed', [Duration.parse('PT1H')])
// @ts-expect-error Duration supports equality and membership only.
DurationQueryTypeProof.where('elapsed', '<', Duration.parse('PT1H'))
// @ts-expect-error Duration is not range-orderable.
DurationQueryTypeProof.query().whereBetween('elapsed', [
  Duration.parse('PT1H'),
  Duration.parse('PT2H'),
])
// @ts-expect-error Duration is not orderable.
DurationQueryTypeProof.query().orderBy('elapsed')
