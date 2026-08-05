# Doxa MVP Viability Bar

Doxa's MVP is the smallest **viable product**, not the smallest executable framework kernel or a
single successful HTTP-to-database demonstration.

The product is not viable unless it expresses the complete application model promised by the
[Doxa Manifesto](index.md). A developer must be able to build an ordinary production-shaped
application without assembling a second framework around Doxa.

## Product versus proof

A vertical proof validates one risky contract, such as transactional entity-state, journal, and
outbox writes. A spike evaluates an implementation engine or API. Both are useful implementation
tools, but neither is the MVP.

The MVP is achieved only when the required capabilities work together through one manifest,
lifecycle, execution context, testing model, diagnostic surface, and CLI.

## Required foundation

The MVP must include:

- Application and feature composition.
- One framework-owned application manifest.
- A first-party, reflection-free dependency container with singleton, execution, and transient
  scopes.
- Build-time manifest generation and constructor autowiring for class-first application code.
- Deterministic boot, readiness, drain, shutdown, partial-startup rollback, and disposal.
- Configuration and secret validation.
- Node.js 26 runtime integration.
- Framework diagnostics for the application graph and lifecycle.

## Required application operations

The MVP must include:

- Actions and queries with one coherent dispatch model.
- Validation, stable errors, and resource serialization.
- Hono-backed HTTP through Doxa-owned declarations.
- Domain models, repositories, optimistic concurrency, and units of work.
- Eloquent-style model hydration, mutation, dirty tracking, lifecycle, and explicit `save()`.
- PostgreSQL persistence through Drizzle.
- Atomic entity-state, journal, and outbox writes.
- Explicit after-commit behavior.

## Required reactive model

The MVP must include distinct, documented semantics for:

- **Domain events** — facts produced by accepted domain changes and recorded durably where the
  contract requires it.
- **Signals** — immediate framework coordination that does not pretend to be durable delivery.
- **Listeners** — reactions whose local, after-commit, or queued execution phase is explicit.
- **Observers** — model lifecycle reactions attached to named persistence and commit phases.

These concepts must not be aliases for one generic event emitter. Their ordering, transaction
visibility, failure behavior, context propagation, observability, and testing APIs must be defined.

## Required asynchronous model

The MVP must include:

- pg-boss on PostgreSQL behind a Doxa-owned job contract.
- Job declaration, enqueueing, serialization, and worker execution.
- Delays, retries, backoff, timeouts, uniqueness or deduplication, and terminal failure.
- Durable actor, initiator, tenant, correlation, causation, and trace propagation.
- Clear idempotency expectations.
- Graceful worker admission, draining, and shutdown.
- Failed-job inspection and recovery.
- Schedule declaration, pg-boss-backed reconciliation, distributed locking, and firing.
- Schedule-to-job dispatch through the same worker and execution-context model.

Queue and scheduling behavior must participate in the same application lifecycle and diagnostics as
HTTP. A separately assembled worker application is not sufficient unless it is a first-party Doxa
runtime produced from the same manifest.

## Required communications model

The MVP must include:

- A first-party Doxa mail contract with a SendGrid plugin adapter.
- A first-party Doxa SMS contract with a Twilio Messaging plugin adapter.
- Outbox-backed, queued delivery for email and SMS.
- Provider response normalization that distinguishes accepted, sent, delivered, undelivered, and
  failed states.
- Signed delivery-status webhook ingestion through Doxa HTTP declarations.
- Correlation of provider message IDs with actor, causation, job, trace, and application message
  IDs.
- Retry classification that distinguishes transient delivery failures from permanent rejection,
  suppression, invalid destination, or opt-out.
- First-party mail and SMS fakes and delivery assertions.

Provider SDKs, request types, response types, template objects, and webhook payloads must not leak
into feature code. Applications use Doxa messages; plugins translate them to provider APIs.

## Required security model

The MVP must include:

- First-party email/password registration and authentication.
- Email verification and password recovery through a Doxa mail contract.
- Opaque, database-backed sessions with rotation and revocation.
- Opaque, database-backed bearer access tokens for APIs, CLIs, and automation, with rotation and
  revocation.
- The accepted identity, actor, initiator, delegation, tenant, and execution-context model.
- Default-deny entry and resource authorization policies.
- Authentication and authorization audit records.
- Rate-limit and abuse-control integration for authentication flows.

OAuth, passkeys, multifactor authentication, API keys, and machine credentials may remain optional
plugins after the core authentication contract is complete.

## Required observability

The MVP must include:

- Structured framework logs.
- Distributed tracing compatible with W3C Trace Context.
- Metrics for framework lifecycle, HTTP, persistence, jobs, schedules, and delivery.
- Automatic actor and causal correlation across synchronous and asynchronous work.
- Security-audit, journal, outbox, and failed-job inspection.
- Redaction, pseudonymization, and high-cardinality safeguards.
- Diagnostics that explain resolved routes, handlers, policies, observers, listeners, jobs, and
  schedules.

Observability cannot be deferred because the framework's automatic behavior is acceptable only when
developers can explain what ran, under whose authority, in which phase, and why it failed.

## Required developer experience

The MVP must include:

- `doxa new` for a complete application.
- Artisan-style generators for features, models, actions, queries, controllers, policies, events,
  listeners, observers, jobs, schedules, migrations, and tests.
- Database generation, migration, and status commands.
- Worker and scheduler commands.
- Route, graph, event, listener, job, and schedule inspection commands.
- A first-party test application with HTTP, auth, persistence, event, queue, schedule, and
  observability fakes and assertions.
- A generated reference application that demonstrates the complete framework model.

## Required reference flow

The MVP reference application should prove one connected business flow:

1. A user registers, verifies their email, and establishes a session.
2. The same identity can authenticate through a browser session or an opaque bearer access token.
3. The user submits an authenticated and authorized HTTP request.
4. An action retrieves a hydrated model, invokes domain behavior, and calls `save()` inside the
   active unit of work.
5. The entity-state writes, domain journal, and outbox commit atomically.
6. An observer runs in a documented lifecycle phase.
7. A local or after-commit listener reacts in the correct phase.
8. A queued listener becomes a job with preserved actor and causal metadata.
9. A worker executes the job with retry, idempotency, and terminal-failure behavior.
10. A queued notification is delivered through the SendGrid or Twilio plugin and its later delivery
    status is reconciled through a signed webhook.
11. A schedule later dispatches related work through the same job system.
12. Logs, traces, metrics, audits, journal entries, outbox records, jobs, messages, and schedule
    firings can be correlated and inspected through Doxa tooling.
13. A test expresses the flow entirely through Doxa-owned fakes and assertions.

The domain may be small. The framework path must be complete.

## Deferred from the MVP

The following may be deferred without making the initial product incoherent:

- Optional OAuth, passkey, multifactor, API-key, and machine-auth plugins. First-party bearer access
  tokens for existing identities are not deferred.
- Multiple HTTP, database, queue, cache, mail, or SMS implementations.
- A third-party plugin marketplace.
- Multiple JavaScript runtimes.
- A graphical administration interface.
- Cloud-specific deployment automation.

Deferred capabilities must not be required to complete the reference flow or operate the framework
safely.

Realtime broadcasting is implemented as an optional post-MVP package family. It is not required to
complete the MVP reference flow or satisfy this viability bar.

## MVP acceptance bar

The MVP is viable when:

- Every required capability is represented in the application manifest.
- HTTP, workers, and the scheduler share the same lifecycle and execution-context semantics.
- Mutating work cannot commit without its required journal, outbox, actor, and causal metadata.
- Events, signals, listeners, and observers have non-overlapping documented meanings.
- Jobs and schedules behave deterministically under success, retry, concurrency, failure, and
  shutdown.
- The reference application is created and extended through the Doxa CLI.
- The complete reference flow passes production-adapter conformance tests and first-party fake
  tests.
- Diagnostics make all automatic work and failure states explainable.
- No required application code imports Hono, Drizzle, queue-engine, telemetry-transport, or vendor
  auth types.
