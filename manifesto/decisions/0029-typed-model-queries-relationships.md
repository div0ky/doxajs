# 0029: Provide Typed Model Queries and Relationships

- **Status:** Accepted
- **Accepted:** 2026-07-13
- **Amended:** 2026-07-23 by [Decision 0035](0035-read-only-model-sessions-during-authorization.md)
- **Amended:** 2026-08-05 to define concurrent terminal serialization
- **Decision owners:** Doxa maintainers

## Decision

Doxa models will provide a typed, Doxa-owned query builder over logical model attributes and
declared relationships. Ordinary reads must support filtered retrieval, deterministic ordering,
aggregates, offset pagination, cursor pagination, bounded cursor iteration, relationship queries,
and eager loading such as `Post.with('comments')` without exposing Drizzle tables, expressions, or
PostgreSQL types to feature code.

Query handlers receive an execution-scoped, read-only `ModelSession`. Models hydrated in actions and
jobs remain writable through their active Unit of Work; models hydrated in queries retain the same
identity-map and `retrieved` observer semantics but reject `save()`, `create()`, and `delete()` with
`ReadOnlyExecutionError`.

## Public experience

The ordinary query path is:

```ts
const contacts = await Contact.where({ ownerId: aaronId }).get()

const appointments = await Appointment.where({ contactId }).orderBy('scheduledAt').get()

const posts = await Post.with('comments').where({ published: true }).get()
```

The accepted query surface includes:

- equality-object, field/value, and field/operator/value `where` constraints;
- nested boolean groups, `orWhere`, membership, null, range, and mapped-column comparisons;
- deterministic ordering, limits, and offsets;
- `get`, builder-level `find` and `findOrFail`, `first`, `firstOrFail`, `exists`, `count`, scalar
  values, plucking, and aggregates;
- offset pagination, opaque cursor pagination, and bounded async cursor iteration;
- reusable, type-safe model query scopes;
- declared relationships, relationship query builders, relationship-existence constraints,
  constrained eager loading, multiple eager loads, and nested eager loading.

The complete observable behavior is specified by
[Model Querying and Relationships](../specifications/model-querying-and-relationships.md).

## Relationship loading is not a public SQL join contract

`with('comments')` is an eager-loading contract. The private adapter may use bounded secondary
queries, joins, or another deterministic strategy while preserving identity, cardinality, ordering,
and pagination semantics. Doxa does not expose that physical choice to application code.

Relationship-aware filtering and ordering are required. An arbitrary public `join(...)` projection
API is explicitly deferred until PostgreSQL benchmarks and application evaluation show that the
model-query and relationship surface cannot meet ordinary reporting performance or result-shaping
needs. The deferral concerns Doxa's public vocabulary, not engine capability: the private adapter
may use joins whenever they are the correct implementation strategy.

## Observer ownership

Model lifecycle reactions remain the responsibility of declared `Observer<Model>` roles. Doxa will
not add a parallel set of model-local lifecycle hook methods. Model invariants belong in explicit
model behavior; lifecycle reactions belong in observers with named persistence and commit phases.

## Explicit bulk-mutation deferral

Builder-level mutation is intentionally deferred. A future `bulkUpdate()` or `bulkDelete()` contract
must be explicit that matching rows are mutated without hydrating models and therefore cannot claim
ordinary dirty tracking, optimistic model-version checks, or per-model observer semantics.

Until that contract is accepted, the model builder must not expose `update()` or `delete()` terminal
operations. Eventful mutations load models and call instance `save()` or `delete()` inside a
writable execution.

## Boundary

- Feature code speaks in model attributes and relationship names, never tables or SQL expressions.
- Core owns immutable query and relationship plans.
- A Doxa read contract executes those plans inside the current execution.
- Unit of Work extends the same read contract for transaction-scoped action and job queries.
- PostgreSQL/Drizzle translates model mappings and plans into SQL.
- Testing fakes implement the same filtering, ordering, pagination, relationship, and read-only
  semantics.
- Partial projections and aggregates return scalar or purpose-built results; they do not masquerade
  as partially hydrated models.
- A fully hydrated mapped model means the model's complete declared attribute projection, not a
  complete physical table row. Direct, eager, paginated, and cursor reads never select or hydrate
  undeclared physical columns.

## Concurrent terminal execution

One model session owns one persistence transaction and snapshot. If application code starts multiple
model operations concurrently, including through `Promise.all`, the PostgreSQL adapter executes them
serially on that transaction's one client. Concurrent promises are supported, but they do not create
database parallelism. Doxa reports the overlap once per session so application code can use explicit
sequential awaits or reduce round trips.

The transaction waits for queued work before commit or rollback. A failed operation rejects queued
work and the complete transaction fails. Applications that need one coherent business result keep
its reads in one Query; independent admitted Queries are appropriate only when separate snapshots
are acceptable.

## Required proof

1. The accepted query operators compile from logical attributes to both entity-state and mapped
   table storage without engine leakage.
2. Query-mode models are attached and readable but reject every mutation path.
3. Action-mode query results share the active writable identity map and transaction.
4. Repeated and overlapping queries return the same instance for one model identity.
5. Offset and cursor pagination are deterministic under duplicate ordering values.
6. Cursor iteration is bounded and becomes stale when its execution ends.
7. Eager loading avoids N+1 queries, preserves relationship cardinality, and reuses the identity
   map.
8. Multiple, nested, and constrained eager loads preserve read-only or writable attachment based on
   the parent execution.
9. Invalid attributes, operators, relationships, mappings, and cursors fail with stable Doxa errors.
10. PostgreSQL and first-party memory fakes pass the same query and relationship conformance suite.
11. No builder-level bulk mutation is present before its lifecycle-bypass contract is accepted.
12. Representative relationship, relationship-existence, aggregate, pagination, and reporting
    queries are benchmarked with realistic cardinalities and indexes before reconsidering a public
    join projection API.
13. Concurrent model operations serialize inside one transaction without driver warnings, preserve
    one snapshot and model identity, and cannot outlive transaction cleanup.

## Consequences

- Ordinary reads receive the same coherent model experience as identity lookup and persistence.
- Query handlers no longer require bespoke repositories for routine model retrieval.
- Relationship loading is first-party behavior rather than application-written N+1 loops.
- Doxa must define a small relational query vocabulary, but Drizzle remains the SQL engine.
- Physical indexes remain migration/schema concerns even when queries use logical attributes.
- Optimized reports and unusual database-specific reads may still use dedicated read models behind
  Doxa-owned ports.

## Revisit when

- The query vocabulary requires feature code to understand physical storage.
- One adapter cannot preserve query, pagination, or relationship semantics through the conformance
  suite.
- Relationship loading cannot remain deterministic within the execution-scoped identity map.
- Benchmarks or application trials show that relationship queries, correlated subqueries, and
  adapter-private joins cannot meet ordinary reporting performance or result-shaping needs.
- A public join projection can be specified without producing partially hydrated or duplicate model
  identities.

## References

- [Eloquent-style model runtime](0012-eloquent-style-model-runtime.md)
- [PostgreSQL and Drizzle persistence](0002-postgresql-drizzle-persistence.md)
- [Existing-table mapping](0023-existing-table-model-auth-mapping.md)
- [Laravel Eloquent relationships](https://laravel.com/docs/13.x/eloquent-relationships)
