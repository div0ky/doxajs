# Typed Model Query and Relationship Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-13
- **Decision:**
  [Typed model queries and relationships](../decisions/0029-typed-model-queries-relationships.md)
- **Specification:**
  [Model querying and relationships](../specifications/model-querying-and-relationships.md)

## Outcome

Doxa models now provide the ordinary query and eager-loading experience without exposing Drizzle:

```ts
const contacts = await Contact.where({ ownerId }).get()
const appointments = await Appointment.where({ contactId }).orderBy('scheduledAt').get()
const posts = await Post.with('comments').where({ published: true }).get()
```

Core owns an immutable plan over logical attributes. The PostgreSQL adapter compiles it to
parameterized Drizzle SQL for both entity-state and mapped-table storage; the first-party memory
adapter evaluates the same plan. Feature code never receives database tables, SQL fragments, or an
adapter builder.

Mapped-table model terminals, relationships, eager loads, pages, and cursor batches select only the
compiled declared physical projection. "Hydrated model" means all declared logical attributes, not
all columns in the underlying relation.

## Execution boundary

`ModelReader` is the read-only persistence contract. `UnitOfWork` extends it with durable mutation,
so actions and jobs query through their existing transaction and identity map. Query dispatch opens
a read-only transaction and read-only `ModelSession`; hydrated models remain attached and observable
but `create`, `save`, and `delete` fail with `ReadOnlyExecutionError` before persistence.

Concurrent model operations share that transaction's one PostgreSQL client and execute through one
FIFO queue. `Promise.all` remains valid JavaScript but provides no database parallelism; Doxa emits
one safe session diagnostic, drains queued work before cleanup, and fails the transaction when any
queued operation fails.

Overlapping queries reuse one model identity. `retrieved` fires once when that identity is first
hydrated in the execution. Lifecycle reactions remain observer-owned; the slice adds no competing
model-local hook vocabulary.

## Query contract

The implemented plan covers equality objects, comparison operators, nested boolean groups,
membership, null and range predicates, logical column comparisons, ordering, limits, and offsets.
Terminals cover hydrated retrieval, scalar values, aggregates, deterministic offset pagination,
opaque cursor pagination, and bounded async cursor iteration. Plans are validated again at runtime
before adapter execution so JavaScript callers and malformed internal plans fail closed.

Builder-level `find(id)` and `findOrFail(id)` append an exact logical identity constraint while
preserving the existing immutable plan, including eager loads, ordering, offset, and relationship
constraints. Both force a one-row limit; the latter reports the requested ID through the stable
model-not-found error. Their distinct diagnostic terminal names leave the existing static
`Model.find()` fast path unchanged.

Cursor ordering appends the model identity as a tiebreaker. Cursors contain only a versioned logical
ordering position, not physical column names.

The compiler records each model's logical attribute vocabulary in generated artifacts. Runtime plan
validation rejects unknown attributes and malformed JavaScript-authored operators before an adapter
runs. Redacted model-query observations identify the terminal, logical constraint count, ordering,
page or batch size, eager-load paths, and resolved storage mapping without recording query values.

## Relationships

The proof covers `belongsTo`, `hasOne`, `hasMany`, and pivot-model-backed `belongsToMany`
declarations. Runtime boot verifies that related and pivot constructors belong to selected Features.
Eager loading supports multiple, nested, and constrained relationships in bounded set queries and
attaches related models through the same identity map. Unloaded access fails instead of triggering
an implicit query.

`has`, `whereHas`, and `whereBelongsTo` resolve through Doxa plans. The PostgreSQL and memory proofs
exercise constrained relationship existence, nested `notes.counter` identity reuse, loaded-empty and
loaded-null states, and ordered many-to-many results.

## Executable evidence

The reference persistence feature declares counters, notes, tags, and tag assignments. The shared
query handler proves:

1. attribute filters, ordering, scalar aggregates, offset pages, cursor pages, and async iteration;
2. mapped-table and entity-state query translation;
3. all four relationship cardinalities plus constrained and nested eager loading;
4. `has`, `whereHas`, and `whereBelongsTo` behavior;
5. one identity and one `retrieved` phase across overlapping hydrated queries;
6. query-mode rejection of `save`, `delete`, and `create`;
7. action-mode query-then-save through the writable transaction; and
8. builder `find` and `findOrFail` found, missing, constrained, eager-loaded, stale-session, and
   diagnostic behavior; and
9. matching behavior in PostgreSQL and the first-party memory adapter; and
10. concurrent reads, writes, and framework participants serialize without PostgreSQL driver
    warnings, retain transaction cleanup, and report one development warning plus production-safe
    telemetry.

Repository-wide verification covers formatting, lint, types, sites, boundaries, documentation,
packages, changesets, security audits, and the shared PostgreSQL/memory query conformance suite.

## Deliberate deferrals

No `update` or `delete` terminal exists on `ModelQuery`. A later explicit `bulkUpdate` or
`bulkDelete` decision must define lifecycle, authorization, audit, concurrency, and return-value
semantics for non-hydrating mutation.

There is no public `join` API. Relationship-aware model queries and eager loading are the starting
point for application evaluation. A future join surface requires representative reporting benchmarks
and a typed projection contract that does not pretend duplicate or partial rows are hydrated model
identities. Adapters may still choose joins privately.
