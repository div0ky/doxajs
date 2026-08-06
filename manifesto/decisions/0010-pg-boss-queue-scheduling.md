# 0010: Use pg-boss for Queueing and Scheduling

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Amended:** 2026-08-06 — Define dispatch-time authority snapshots for accepted durable work.
- **Decision owners:** Doxa maintainers

## Decision

Doxa will use pg-boss on PostgreSQL as its initial private queue and scheduling engine. Doxa will
own the public job, worker, retry, uniqueness, failure, schedule, execution-context, testing, and
diagnostic contracts.

Doxa promises **at-least-once job execution**. Job handlers and external effects must be idempotent
even where pg-boss describes its internal delivery behavior as exactly once.

## Context

The Doxa MVP requires queues, workers, retries, terminal failure, delayed jobs, schedules, actor and
causal propagation, observability, testing fakes, and lifecycle integration. PostgreSQL and Drizzle
are already accepted foundations.

pg-boss provides a focused Node.js job engine on PostgreSQL with transactional enqueueing, delayed
jobs, retries, backoff, dead-letter handling, concurrency controls, and cron scheduling. Selecting
it avoids adding Redis as a second required data service while preserving a Doxa-owned boundary for
future queue engines.

## Boundary

Application and feature code must not depend on:

- pg-boss clients, jobs, options, queue names, errors, or schedule objects.
- pg-boss database tables or migrations.
- PostgreSQL polling, locking, or notification details.

Application code declares Doxa jobs and schedules. The adapter translates those declarations to
pg-boss and normalizes provider state into Doxa job and schedule states.

## Outbox relationship

The transactional outbox and pg-boss remain distinct concepts:

- The outbox records committed application intent atomically with entity state and the journal.
- The outbox dispatcher claims committed intent and enqueues the corresponding Doxa job through the
  pg-boss adapter.
- pg-boss owns transport availability, claiming, attempts, delays, and worker delivery after that
  handoff.
- Provider delivery outcomes may produce new journal, audit, or application events through normal
  Doxa operations.

Because both initially use PostgreSQL, an adapter may optimize their handoff after the semantic
boundary is proven. It must not collapse the outbox into pg-boss tables or make application
durability depend on pg-boss internals.

## Execution guarantee

Doxa does not promise exactly-once effects. A process can perform an external side effect and fail
before acknowledging completion, causing the job to be delivered again.

The framework contract therefore requires:

- At-least-once execution.
- Stable job identity across attempts.
- A distinct execution ID and span for every attempt.
- Preserved actor, initiator, tenant, correlation, and causation metadata.
- Explicit retry classification for transient, permanent, and unrecoverable failures.
- Idempotency keys and first-party idempotency helpers.
- Atomic local idempotency records where PostgreSQL state is involved.
- Terminal failed-job retention, inspection, redrive, and audit.

Deduplication and uniqueness reduce duplicate admission or concurrency. They do not replace
idempotent handlers.

### Accepted durable authority

Queue dispatch from an admitted execution snapshots its authorized actor, initiator, delegation, and
bounded authentication attribution at acceptance. Schedules and named system dispatches carry their
system actor. Raw session IDs, credentials, and permission results never cross the durable boundary.

Each attempt creates a fresh execution and re-evaluates the operation's current application
PermissionSource and Policy rules. It does not revalidate the browser activation that authorized the
already-accepted dispatch. Impersonation stop, expiry, target ineligibility, or session revocation
prevents future delegated dispatch but does not rewrite or cancel durable work already accepted.

If pg-boss expires an active attempt, Doxa races that cancellation inside the attempt's writable
model session. Cancellation closes the session, rejects the local transaction, drains
already-started database operations, and rolls back before the late handler can commit. A handler
that continues settling cannot use stale models. External effects remain at least once and still
require idempotency because they cannot be rolled back with local state.

## Scheduling model

Doxa schedule declarations live in the application manifest. At startup or through an explicit
reconciliation command, the scheduler adapter will reconcile those declarations into pg-boss.

The schedule specification must define:

- Stable schedule identity.
- Cron and interval declarations.
- Time-zone handling.
- Overlap and concurrency policy.
- Misfire and catch-up behavior.
- Distributed ownership and locking.
- Enable, disable, and deployment reconciliation behavior.
- Schedule firing as causation for the resulting job.

Schedules dispatch Doxa jobs. They do not introduce a separate execution or handler model.

## Runtime topology

HTTP, worker, and scheduler roles consume the same application manifest and kernel:

```text
doxa serve
doxa work
doxa schedule
```

Development and tests may run all roles in one process. Production may run them independently. Every
role uses the same lifecycle, execution-scope, actor, context, configuration, observability, and
graceful-shutdown contracts.

## Testing

The first-party job and schedule fakes must support assertions for:

- Enqueued job type, payload, delay, and idempotency key.
- Actor, initiator, tenant, correlation, and causation propagation.
- Delegated work retaining its accepted actor after the originating browser activation stops or
  expires, while later dispatch uses the restored actor.
- Retry and terminal-failure classification.
- Scheduled declarations and simulated firing.
- Outbox-to-job handoff.
- Attempt-specific execution IDs and preserved business causality.

pg-boss integration tests must use disposable PostgreSQL instances and exercise concurrency,
locking, crashes, retries, redrive, reconciliation, drain, and shutdown.

## Consequences

- The MVP needs PostgreSQL but not Redis for queueing and scheduling.
- Queue and schedule records remain operational infrastructure rather than application domain state.
- Doxa must maintain a strict adapter boundary around pg-boss schema and APIs.
- Heavy queue workloads share the PostgreSQL operational envelope and require documented capacity
  guidance.
- A future BullMQ or other adapter must satisfy the same Doxa conformance suite without changing
  feature code.

## Required implementation proof

Before the adapter is production-ready, it must prove:

1. Outbox work is not lost when a dispatcher or worker crashes.
2. Duplicate execution is safe through the Doxa idempotency model.
3. Retries and terminal failures preserve causal metadata.
4. Concurrent workers respect queue, job, and uniqueness policies.
5. Schedule reconciliation is deterministic across multiple processes and deployments.
6. Misfires, overlap, clock changes, and time zones behave according to the specification.
7. Shutdown stops admission and drains or safely releases claimed work.
8. An expired handler cannot commit late entity, journal, or outbox writes; its later model access
   fails stale.
9. No pg-boss types appear in feature APIs, generated contracts, or test assertions.

## Revisit when

- PostgreSQL queue load compromises primary application persistence.
- pg-boss cannot implement accepted job or schedule semantics without leaking its model.
- Independent queue scaling or isolation becomes an MVP requirement.
- Another engine passes the Doxa conformance suite with materially better reliability or
  operability.

## Implementation evidence

The
[pg-boss queue and worker vertical slice](../implementation/pg-boss-queue-worker-vertical-slice.md)
proves declared jobs, atomic outbox handoff, at-least-once attempts, retries, terminal retention,
stable idempotent identity, queued listeners, context propagation, writable job transactions, and
graceful draining. The later
[scheduling vertical slice](../implementation/scheduling-vertical-slice.md) proves cron and interval
declarations, deterministic reconciliation, time zones, overlap defaults, skipped misfires, schedule
causation, and graceful scheduler draining. Crash-process tests, operator redrive, first-party
fakes, bounded catch-up misfires, and advanced concurrency are covered by the completed scheduling
and operational-control proofs. Independent pre-1.0 review remains part of Doxa's release gate.

## References

- [pg-boss documentation](https://timgit.github.io/pg-boss/)
- [Doxa MVP viability bar](../mvp.md)
- [Doxa persistence decision](0002-postgresql-drizzle-persistence.md)
