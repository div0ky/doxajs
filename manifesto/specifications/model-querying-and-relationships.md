# Model Querying and Relationships

- **Status:** Accepted
- **Accepted:** 2026-07-13
- **Decision:**
  [Typed model queries and relationships](../decisions/0029-typed-model-queries-relationships.md)

## Purpose

This specification defines Doxa's ordinary persistent-model read contract. It covers query
construction, hydration, execution scopes, pagination, cursor iteration, declared relationships, and
eager loading. It does not expose or reproduce Drizzle's query builder.

## Vocabulary

- A **model query** is an immutable Doxa plan expressed with logical model attributes.
- A **terminal operation** executes a model query and returns models, scalars, a page, or an async
  cursor.
- A **relationship** is a declared association between Doxa model identities and mapped attributes.
- **Eager loading** resolves a relationship for a parent result set in bounded operations before
  returning that result.
- A **read session** is a read-only execution-scoped `ModelSession`.
- A **bulk mutation** changes matching records without hydrating each model.

## Query construction

The builder must support these normative shapes:

```ts
Contact.where({ ownerId })
Contact.where('createdAt', '>=', since)
Contact.where((query) => query.where({ active: true }).orWhere({ invited: true }))
Contact.whereIn('status', ['active', 'pending'])
Contact.whereNull('deletedAt')
Contact.whereBetween('createdAt', [start, end])
```

Constraints combine with `and` unless an `or` operation is explicit. Nested groups preserve their
logical boundaries. Attribute names and operator/value combinations must be type checked where
TypeScript can prove them and validated again before adapter execution.

Equality and membership treat null as a comparable Doxa value: equality matches null or a missing
entity-state attribute, inequality is its inverse, and membership can include or exclude null.
Ordered comparisons with a null operand do not match. Ascending order places null first and
descending order places null last so PostgreSQL and memory adapters expose the same result order.

The accepted comparison vocabulary is equality, inequality, less-than, less-than-or-equal,
greater-than, greater-than-or-equal, and SQL-like pattern comparison. Raw expressions are not model
query values.

## Ordering and bounds

Queries must support ascending and descending ordering, `latest`, `oldest`, limits, and offsets.
User-declared ordering is preserved. Pagination and cursor operations must append the model primary
key as a deterministic tiebreaker when it is not already present. Per-page values and cursor page or
batch sizes may not exceed 1,000, and offset pagination must reject a page whose derived offset is
outside the safe integer range.

## Terminal operations

The accepted terminals are:

```text
get
find | findOrFail
first | firstOrFail
exists | count
value | pluck
min | max | sum | average
paginate
cursorPaginate
cursor
```

`get`, `find`, `findOrFail`, `first`, pagination, and cursor iteration return fully hydrated models.
`value`, `pluck`, and aggregates return scalars and must not construct partial models.

Builder-level `find(id)` appends an exact logical `id` equality constraint to the existing immutable
query. It preserves existing constraints, ordering, offset, relationship constraints, and eager
loads, forces a one-row limit, and returns the matching model or `undefined`. Existing constraints
still apply, so a record with the requested ID that does not satisfy the query is absent.

`findOrFail(id)` has the same plan semantics and throws `ModelNotFoundError` containing the
requested ID when no row matches. Both terminals emit their own `find` or `findOrFail` diagnostic.
They do not replace or change the existing static `Model.find(id)` and `Model.findOrFail(id)`
identity fast paths.

For mapped tables, "fully hydrated" means every attribute in the compiler-declared model contract.
It does not mean every physical column in the relation. All model-producing terminals, eager loads,
relationship loads, refreshes, and cursor batches must select the explicit declared physical
projection and reject missing or unexpected adapter fields.

`firstOrFail` uses the stable Doxa model-not-found failure. Invalid plans, attributes,
relationships, operators, or cursors use stable query errors and must fail before returning partial
results.

## Pagination

Offset pagination returns a Doxa-owned page containing `items`, `page`, `perPage`, `total`, and
`lastPage`. Page and per-page inputs must be positive bounded integers.

Cursor pagination uses an opaque, versioned cursor containing the model identity and complete
deterministic logical ordering position, including the primary-key tiebreaker. A cursor from another
model or ordering is invalid. The result contains the hydrated items and opaque next and previous
cursors when those directions exist. Adapters must not expose encoded physical column names.

Async cursor iteration fetches bounded batches and yields attached models. It must not buffer the
complete result set. An iterator used after its execution ends fails as stale.

## Execution and hydration

Every model query requires an active Doxa execution and `ModelSession`.

- Actions and jobs use the active Unit of Work as a writable model reader.
- Query handlers use a read-only model reader and read-only `ModelSession`.
- Permission sources and policies use the read-only authorization session defined by
  [Decision 0035](../decisions/0035-read-only-model-sessions-during-authorization.md). Query
  authorization shares the query session; action and job authorization receives a separate read-only
  identity map over the owning Unit of Work.
- Query results pass through the session identity map.
- A read-only session observes one stable persistence snapshot across pagination, cursor, aggregate,
  and relationship-loading statements.
- Concurrent terminal operations in one session are accepted but execute serially on its persistence
  transaction. `Promise.all` does not add database parallelism or weaken snapshot consistency.
- Overlapping results for the same model identity return the same object instance.
- `retrieved` fires only when an identity is newly hydrated into that session.
- Query-mode `save`, `create`, and `delete` fail with `ReadOnlyExecutionError` before persistence.
- A model declared `readOnly = true` remains readable in any session, but its `save`, `create`, and
  `delete` paths fail with `ReadOnlyModelError` before lifecycle observers or persistence.
- A query or cursor used after the execution closes fails with the stable stale-model/session error.

## Relationships

Doxa must support the ordinary relational cardinalities required for model work:

```text
belongsTo
hasOne
hasMany
belongsToMany
```

Declarations use Doxa model constructors, logical attribute names, and explicit pivot metadata where
many-to-many storage requires it. They must not import Drizzle table objects.

Relationship declarations must be inspectable and validated before boot completes. Both sides of a
relationship must be models declared by selected Features. Invalid local keys, foreign keys,
cardinality, or pivot mapping fail closed.

A relationship is itself queryable, so application code may add the same supported constraints and
ordering before executing it. Relationship-existence predicates such as `has`, `whereHas`, and
`whereBelongsTo` are required and compile through Doxa plans rather than public joins.

## Eager loading

The required public behavior includes:

```ts
await Post.with('comments').get()
await Post.with(['author', 'comments']).get()
await Post.with('comments.author').get()
await Post.with({ comments: (query) => query.where({ approved: true }) }).get()
```

Eager loading must avoid one query per parent model. A `hasMany` load normally resolves all children
for the parent key set in one bounded query; a `belongsTo` load normally resolves all unique owner
keys in one bounded query. The adapter may choose another strategy, including joins, only when the
observable cardinality, ordering, pagination, identity, and failure semantics remain identical.

Related models are attached to the same `ModelSession` as their parents. Nested eager loading
continues breadth by breadth and reuses that identity map. Relationship access must distinguish
unloaded from loaded-empty and loaded-null states.

Lazy loading is not implicit. Accessing an unloaded relationship must fail with a stable error that
names the relationship and recommends `with(...)` or explicit relationship loading. This prevents
hidden N+1 behavior. An explicit `load`/`loadMissing` operation may resolve relationships through
the active session.

## Lifecycle and observers

Hydrating related models follows the same `retrieved` observer rule as direct queries. Relationship
loading does not add model-local lifecycle hooks. Declared observers remain the only lifecycle
reaction mechanism.

## Bulk mutation deferral

`update`, `delete`, and equivalent mutation terminals must not exist on `ModelQuery` in this
contract. A future specification may introduce explicitly named `bulkUpdate` and `bulkDelete`
operations after defining authorization, diagnostics, audit/journal behavior, concurrency, return
values, and the deliberate absence of per-model observer phases.

This deferral does not prevent eventful multi-model work: an action may query attached models,
invoke their behavior, and call instance `save()` or `delete()` for each model inside one Unit of
Work.

## Deferred public joins

Relationship-aware filtering, ordering, existence predicates, and eager loading are required. An
application-facing arbitrary `join(...)` projection API is deferred until representative PostgreSQL
benchmarks and application evaluation show that the accepted model-query route is insufficient for
ordinary reporting workloads. The adapter remains free to compile Doxa query plans to joins
internally.

Reconsidering the deferral requires evidence from realistic data volumes and indexes covering:

- parent pagination with eager `hasMany` and `belongsToMany` relationships;
- relationship-existence filters and constrained eager loading;
- relationship counts and min/max/sum/average aggregates;
- nested eager loading and bounded cursor iteration;
- reports that need one flat row per cross-model combination rather than hydrated model graphs.

If that evidence requires a public join surface, it must be a typed projection contract rather than
a `ModelQuery` terminal that pretends duplicated or partially selected rows are hydrated models. The
contract must define duplicate parent rows, selected fields, aliases, nullability, pagination,
identity interaction, and adapter portability before acceptance.

## Adapter contract

Core supplies storage-neutral plans. The PostgreSQL adapter maps logical attributes to declared
physical columns or entity-state paths and delegates SQL construction to Drizzle. It must preserve
parameterization and must never concatenate untrusted values into SQL.

The first-party memory adapter must implement the same comparison, null, ordering, pagination,
cursor, identity, and relationship semantics. Adapter-specific capabilities cannot appear on the
ordinary builder without first becoming Doxa contracts.

Mapped adapters operate only on the compiled declared attribute set. They must neither select nor
hydrate undeclared physical columns, and updates must translate only the declared dirty patch plus
adapter-owned timestamp and version changes.

## Diagnostics

Query observations must identify the model, terminal, constraint count, ordering, page/batch size,
and eager-loaded relationship names without recording sensitive values. Diagnostics must be able to
show the logical plan and resolved mapping separately from engine SQL.

The first concurrent overlap emits one privacy-safe serialization observation and metric per model
session. Development and test runtimes also warn that `Promise.all` does not improve transactional
database parallelism; production retains structured diagnostics without warning-log noise.

`find` and `findOrFail` are distinct terminal names in query observations even though both append
the same identity constraint and force a one-row limit.

## Conformance scenarios

1. Equality, operator, nested boolean, membership, null, and range queries return identical results
   in PostgreSQL and memory.
2. Mapped logical attributes resolve to physical columns without leaking those names publicly.
3. Offset and cursor pagination remain stable when ordering values are duplicated.
4. Cursor iteration is bounded, ordered, identity-mapped, and stale after execution.
5. Query handlers hydrate read-only models and reject all writes.
6. Actions query writable models through their existing transaction.
7. `belongsTo`, `hasOne`, `hasMany`, and `belongsToMany` preserve cardinality.
8. Multiple, nested, and constrained eager loading avoid N+1 behavior and preserve identity.
9. Unloaded relationship access fails rather than lazy loading implicitly.
10. Invalid plans, mappings, relationships, and cursors fail closed with stable errors.
11. Model queries expose no bulk mutation terminal.
12. Builder `find` and `findOrFail` preserve existing plan clauses, eager-load relationships, report
    distinct diagnostics, become stale with their bound session, and return or fail with the exact
    requested identity.
13. Concurrent terminals execute serially, emit one serialization diagnostic, retain one snapshot,
    and drain or fail before transaction cleanup.

## Deferred question

- Does measured reporting performance or required flat-row shaping justify a separate Doxa-owned
  typed projection and join API?
