# Eloquent-Style Model Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP completed:** 2026-07-14
- **Depends on:** [PostgreSQL durability vertical slice](postgresql-durability-vertical-slice.md)

## Outcome

The fourth Doxa implementation proves the ordinary persistent-model path end to end:

```text
Feature declares a Model class
  → compiler assigns a stable model and entity identity
  → action receives an execution-scoped ModelSession
  → Model.find() hydrates one behavior-bearing identity
  → model behavior mutates attributes and stages durable facts
  → model.save() writes state, journal, and outbox through the active Unit of Work
  → PostgreSQL enforces optimistic concurrency
  → the surrounding action transaction commits atomically
```

Ordinary actions no longer inject `UnitOfWork` or construct persistence records. The reference
action is deliberately small:

```ts
const counter = (await Counter.find(id)) ?? Counter.make({ id, value: 0 })

counter.increment(amount)
await counter.save()
```

`Counter` owns its behavior. It stages journal facts and outbox messages through protected model
methods without importing Drizzle, PostgreSQL, table definitions, or Unit of Work types.

## Declaration and compilation

Models are framework-facing roles and therefore remain explicit in their Feature:

```ts
export class PersistenceFeature extends Feature {
  static id = 'persistence'
  models = [Counter]
  actions = [SaveCounter, CreateCounter, DeleteCounter]
}
```

The semantic compiler verifies that every entry is a concrete Doxa `Model` with a stable local ID.
It emits a stable identity such as `model:persistence/counter` into both generated artifacts. Model
constructors are not injectable services; the compiler reports direct constructor injection and
directs application code to the static model API instead.

Folder names remain semantically irrelevant. Only imports and the Feature declaration establish
ownership.

## Model session and identity

Every admitted action transaction owns one Unit of Work. Its handler receives one writable
`ModelSession` attached to the existing execution scope and Unit of Work rather than another
container scope. Protected actions may first receive an isolated read-only authorization session
over that same Unit of Work under the later
[authorization model-session decision](../decisions/0035-read-only-model-sessions-during-authorization.md).
`ModelSession` remains private runtime integration machinery and is not exported from the ordinary
`@doxajs/core` application surface.

Within that execution:

- Repeated retrieval of the same model identity returns the same object instance.
- `find`, `findOrFail`, `make`, and `create` resolve the active session without application
  plumbing.
- Hydrated models know their original persisted attributes and version.
- New models begin detached from persistence but attached to the active session.
- The session becomes unusable when the action transaction ends.

A manually constructed model fails with `DetachedModelError`. A retained model or static model API
used after its action ends fails with `StaleModelError`. Missing required state fails with
`ModelNotFoundError`.

Static model access was initially enabled only for mutating action executions in this proof. The
later [typed model query and relationship slice](typed-model-query-relationship-vertical-slice.md)
adds the accepted read-only query session, builder, relationships, pagination, and eager loading.
The later
[authorization model-session decision](../decisions/0035-read-only-model-sessions-during-authorization.md)
extends read-only model access to permission sources and policies without adding application-facing
persistence plumbing.

## Persistence semantics

The proof implements:

- `Model.find(id)` and `Model.findOrFail(id)`.
- `Model.make(attributes)` and `Model.create(attributes)`.
- `model.save()`, `model.delete()`, and `model.refresh()`.
- Typed cloned `getAttribute`, `setAttribute`, and `fill` access with immutable model identity.
- `isDirty`, `isClean`, `wasChanged`, `getChanges`, and `getOriginal`.
- `exists`, `version`, and `wasRecentlyCreated` lifecycle state.
- Automatic expected-version writes and stable optimistic-concurrency failures.
- A no-op `save()` for a clean model with no pending durable work.
- Change detection for added, updated, and removed attributes.
- Ordinary optional attributes without index-signature ceremony.

A successful save updates the version, marks current attributes as original, and retains the saved
change set for `wasChanged()` and diagnostics. `wasRecentlyCreated` remains true on a newly inserted
model for the rest of that model's execution. Refresh replaces transient mutations with the latest
stored state and resets change metadata.

Doxa datetime values remain immutable typed attributes through cloning, dirty tracking, query
cursors, and refresh. Mapped `Graphite` and `Instant` attributes persist their exact UTC instant;
Graphite's viewing zone is not hidden model state and a zone-only change is clean.

Model behavior may stage journal facts and outbox messages before `save()`. State, journal, and
outbox writes use the same Unit of Work and PostgreSQL transaction. If the action later fails, all
of them roll back together.

## Mapper boundary

The initial proof used the generic JSON entity-state mapper. The later
[existing-table mapping slice](existing-table-mapping-vertical-slice.md) adds the ordinary
single-table path with Laravel-like table, key, column, timestamp, and version metadata while
preserving this lifecycle. Explicit multi-record mapper composition remains future work.

## Executable evidence

The complete suite contains twenty-eight passing tests. The model-specific PostgreSQL tests prove:

1. Model declarations and stable identities appear in the generated manifest and registry.
2. Ordinary model actions have no persistence dependencies or engine leakage.
3. New and existing models save state, journal facts, and outbox messages atomically.
4. An action failure after `save()` rolls all durable writes back.
5. Repeated retrieval returns one identity-mapped hydrated instance.
6. Clean saves are no-ops and added, changed, and removed optional attributes are tracked without
   type ceremony.
7. `create`, `refresh`, and `delete` work without Unit of Work ceremony.
8. Missing, detached, and stale model access produces stable framework errors.
9. Concurrent model saves produce one winner and one `OptimisticConcurrencyError`.

Run the proof with `pnpm test`. Docker must be available for the PostgreSQL conformance suite.

## MVP completion

Later slices complete the original proof with existing-table mapping, observer phases, journaled
Domain Events, writable job and scheduled execution, read-only model queries, first-party memory
fakes, and explicit operation-boundary parity through HTTP, console, and listeners. The reference
application exercises the same Action-owned model lifecycle through each entrypoint, and both the
PostgreSQL and memory suites exercise public attribute mutation and optional-attribute removal.

Advanced multi-record mappers remain an explicit post-MVP extension point under Decision 0023.
Non-hydrating bulk mutation and public flat-row joins remain deliberately unavailable under Decision
0029; those absent APIs do not weaken the completed hydrated-model contract.

## Next slice

Completed: [Class events vertical slice](class-events-vertical-slice.md).

Completed later: queued events, workers, schedules, model queries, testing fakes, and existing-table
mapping.
