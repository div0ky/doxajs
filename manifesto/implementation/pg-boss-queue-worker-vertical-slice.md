# pg-boss Queue and Worker Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Incomplete
- **Depends on:** [Class events vertical slice](class-events-vertical-slice.md)

## Outcome

The seventh Doxa implementation proves one durable asynchronous path end to end:

```text
await ProcessCounterJob.dispatch(input)
  → active Doxa execution and transaction
  → doxa.queue outbox intent
  → atomic outbox-to-pg-boss handoff
  → pg-boss claim and attempt
  → fresh actor-aware Doxa execution scope
  → writable job transaction + ModelSession
  → retry or terminal failure
  → graceful worker drain
```

Doxa promises at-least-once execution. A stable job ID survives every attempt, while each attempt
receives a new execution ID. Handlers must remain idempotent around effects that cannot participate
in their local transaction.

pg-boss 12.26.0 is a private implementation engine. Application jobs, events, listeners, Features,
tests, and generated manifests contain no pg-boss types or queue-engine vocabulary.

## Application organization

The public application organization is now:

```text
app.config.ts
src/
├── app/
│   └── app.feature.ts
└── features/
    └── counters/
        ├── counters.feature.ts
        ├── actions/
        ├── events/
        ├── http/
        ├── jobs/
        ├── listeners/
        ├── models/
        ├── queries/
        └── support/
```

`app.config.ts` selects user Features. Doxa contributes pg-boss and the rest of its mandatory core
through a framework-owned Feature generated under `.doxa/`; applications do not declare a queue
adapter or infrastructure Feature. Feature declarations—not directories—own user behavior.

## Job authoring

A job is one class with one handler:

```ts
export class ProcessCounterJob extends Job<ProcessCounterInput> {
  static id = 'process-counter'
  static retries = 2
  static retryDelay = 0
  static backoff = false
  static timeout = 10

  private readonly job = this.inject(CurrentJob)
  private readonly execution = this.inject(CurrentExecution)

  async handle(input: ProcessCounterInput): Promise<void> {
    // normal services and model APIs are available here
  }
}
```

The Feature declares `jobs = [ProcessCounterJob]`. The compiler verifies the stable ID, typed
handler, role-injection graph, retry policy, timeout, and lifecycle restrictions. This proof
recorded them in manifest format v3; scheduling later advanced the required artifact contract to v4.

`Job.dispatch(input)` is inherited and uses the current application execution rather than a
process-global queue. Optional delay and idempotency settings remain concise:

```ts
await ProcessCounterJob.dispatch(input, {
  delaySeconds: 30,
  idempotencyKey: `counter:${counterId}`,
})
```

## Transaction and outbox boundary

Dispatch inside an action or job writes a `doxa.queue` intent into the existing transactional
outbox. Rollback removes that intent with every other state, journal, and outbox write.

The pg-boss adapter claims committed queue intents with `FOR UPDATE SKIP LOCKED`. Inside the same
PostgreSQL transaction it inserts the pg-boss job through pg-boss's external database boundary and
marks the Doxa outbox row dispatched. A crash before commit leaves both operations absent; a
successful commit makes both visible. This preserves the semantic distinction between durable
application intent and queue transport while making their initial PostgreSQL handoff atomic.

Dispatch outside a Unit of Work, but still inside a managed execution, sends directly to the queue.

## Worker execution

Every attempt creates a fresh admitted execution with:

- The original opaque actor and initiator.
- Tenant and delegation metadata.
- The original correlation ID.
- The stable job ID as causation ID.
- A new execution ID.
- Job transport identity.
- Authentication metadata with session identifiers omitted.
- Trace, locale, and time-zone context.
- pg-boss cancellation composed into Doxa cancellation.

Before admission, the runtime validates context-envelope version `1` and rejects unsupported fields,
malformed actors or delegation, raw session-shaped authentication fields, invalid tenant or locale
metadata, excessive constraints or span links, invalid dates, and malformed W3C trace identifiers.
Rejection occurs before tracing, authorization, or application handler code runs.

Worker delivery preserves the actor, initiator, delegation, and bounded authentication attribution
accepted at dispatch; schedules and named system dispatches carry their system actor. Each attempt
re-evaluates current application permissions without revalidating the originating browser
activation, so a later impersonation stop or expiry blocks new dispatch but does not rewrite durable
work already accepted. This matches the accepted actor and queue contracts.

`CurrentJob` exposes the stable ID, one-based attempt, maximum attempts, and optional idempotency
key through constructor injection.

Each declared job attempt opens a Doxa transaction and gives its handler a writable `ModelSession`.
Protected jobs first authorize through a separate read-only session over the same Unit of Work.
Handlers therefore use the same hydrated model, dirty tracking, journal, outbox, and
optimistic-concurrency APIs as actions. A failed attempt rolls its local mutation back before
pg-boss applies retry policy.

pg-boss expiration aborts inside that writable session. Doxa closes the model session immediately,
rejects the transaction, drains already-started database operations, and catches the handler's late
settlement. Entity, journal, and outbox writes therefore cannot commit after pg-boss has declared
the attempt failed, and later model access fails stale. Provider calls and other external effects
remain at least once and require application idempotency.

## Retries, failure, delay, and idempotency

- `retries` is the number of retries after the initial attempt.
- `retryDelay` is measured in seconds.
- `backoff` selects fixed or exponential pg-boss retry timing.
- `timeout` controls the pg-boss active-job expiration boundary.
- Delays are stored as an absolute availability time so outbox polling does not extend them.
- Terminally failed jobs remain inspectable with normalized Doxa job state.

Idempotency keys deterministically derive the Doxa job UUID from the job type and key. Repeated
dispatches therefore return the same job identity. The atomic handoff treats an existing transport
record with that ID as success and marks every corresponding outbox intent dispatched. This
deduplicates admission; handlers still need idempotency for non-transactional effects under
at-least-once delivery.

## Queued listeners

`ShouldQueue` and `ShouldQueueAfterCommit` listeners now become normal Doxa queue envelopes. When an
event is raised inside a transaction, queued listener intent is always outbox-backed and cannot
become eligible before commit. This also remains true for an event implementing
`ShouldDispatchAfterCommit`: queued listener intent is staged before commit, while its local
listeners remain delayed until durability.

The worker rehydrates the declared event class without invoking its application constructor,
resolves the declared listener with normal injection, and executes it in a fresh job execution.

## Worker lifecycle

The queue provider participates in `start → ready → drain → stop → dispose`:

- Start requires explicitly installed pg-boss schema and binds declared delivery to the runtime.
- Drain stops outbox polling and new worker claims, then waits for active handlers.
- Runtime draining waits for their admitted executions.
- Stop closes pg-boss gracefully.
- Dispose closes the adapter's outbox pool.

The adapter installs no process-global signal handlers. pg-boss schema installation remains an
explicit development/migration step rather than an application boot side effect.

## Executable evidence

At implementation time the complete suite contained thirty-eight passing tests. Queue-specific
PostgreSQL conformance proves:

1. Stable jobs, policies, queue capability, and queued listener relationships in the manifest.
2. Atomic committed outbox-to-pg-boss handoff.
3. No queued job survives a failed action transaction.
4. One retry preserves job, actor, correlation, and causation identity while creating distinct
   attempt execution IDs.
5. Every job attempt receives a writable transaction and handler `ModelSession`; protected attempts
   isolate authorization reads over that same Unit of Work.
6. Retry exhaustion retains a terminal failed job with attempt metadata.
7. Repeated idempotent dispatch returns one stable job and executes it once.
8. Delayed jobs do not execute before their availability boundary.
9. A queued event listener runs in a fresh injected job execution.
10. A one-second zero-retry job that ignores cancellation cannot commit entity, journal, or outbox
    writes after pg-boss expires it; later model access is stale.
11. Shutdown waits for active worker completion before stopping the runtime.

## Deliberate boundary

This is a queue and worker proof, not the complete asynchronous MVP. Still required:

- Crash-process conformance that kills dispatchers and workers at controlled phases.
- First-party idempotency records for external effects and transactional handler helpers.
- Permanent versus transient failure classification beyond retry exhaustion.
- Public failed-job listing, redrive, cancellation, and operator diagnostics.
- Queue fakes and application-scoped assertions.
- Payload schema/version manifests and model-reference serialization.
- Concurrency, uniqueness, priority, and per-key ordering policies beyond the initial default.
- Heartbeats and conformance for jobs approaching their expiration boundary.
- Production topology commands for independent `serve` and `work` roles.
- Metrics, tracing spans, structured logs, and capacity guidance.
- Scheduling declarations and pg-boss reconciliation. Completed in the
  [scheduling vertical slice](scheduling-vertical-slice.md).

## Next slice

Completed next: [scheduling vertical slice](scheduling-vertical-slice.md).
