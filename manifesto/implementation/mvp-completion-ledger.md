# Doxa MVP Completion Ledger

- **Status:** MVP implementation acceptance complete; public security-stability claim blocked
- **Started:** 2026-07-10
- **Authority:** [MVP viability bar](../mvp.md)
- **Completion rule:** A row is complete only when its public contract, production adapter or
  runtime behavior, conformance tests, reference application evidence, diagnostics, and
  documentation agree.

This ledger prevents a runnable demo from being mislabeled as a viable framework. Implementation
proof means a risky seam works. MVP complete means an ordinary production-shaped application can use
the entire promised model without assembling another framework beside Doxa.

Implementation acceptance is not security-release readiness. The
[current framework security audit](security-audit-2026-07-16.md) records unresolved critical and
high findings that block a public security-stability claim and a 1.0 release even though the
implemented MVP capability set is accepted.

## Ecosystem name

**Praxis** is the canonical name for Doxa's Artisan-like command suite and generator. The package is
`@doxajs/praxis` and the executable is `doxa`:

```text
doxa new
doxa make:feature Accounts
doxa make:model User
doxa make:job SendWelcomeEmail
doxa migrate
doxa serve
doxa work
doxa work --without-scheduler
doxa schedule
doxa route:list
doxa graph
```

Praxis name is accepted. Command semantics and generated output remain described by Gnosis so
applications and tools do not depend on undocumented behavior.

## Foundation and operations

| Capability                             | State    | Acceptance evidence                                                                                                                                                                             |
| -------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application and Feature declarations   | Complete | Compiled declarations, generators, and diagnostics agree.                                                                                                                                       |
| Manifest and constructor registry      | Complete | Versioned JSON, constructor registry, hashes, compatibility, and inspection fail closed.                                                                                                        |
| Container and scopes                   | Complete | Autowiring, ownership, provider overrides, scopes, lifecycle, and fakes are proven.                                                                                                             |
| Configuration and secrets              | Complete | Declared-only environment loading, typed groups, secrets, diagnostics, and overrides are proven.                                                                                                |
| Runtime lifecycle                      | Complete | Independent roles, bounded boot/readiness/drain/stop/dispose, unwind, and lifecycle telemetry are proven.                                                                                       |
| Actions and queries                    | Complete | Transactions, read-only enforcement, shared query authorization snapshots, isolated action/job authorization sessions, resources, and operation rules are proven.                               |
| HTTP envelopes, errors, and validation | Complete | Automatic payload wrapping, discriminated failures, validation details, trace headers, auth errors, raw exceptions, and shutdown behavior are proven.                                           |
| Eloquent-style models and persistence  | Complete | Hydration, immutable identity, typed queries and identity terminals, cloned mutation, dirty state, save/delete/refresh, observers, authorization reads, concurrency, and migrations are proven. |
| Journal and outbox                     | Complete | Atomic writes, causal context, rollback, visibility, queue handoff, and inspection are proven.                                                                                                  |

## Reactive and asynchronous model

| Capability                 | State    | Acceptance evidence                                                                                                        |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Class events and listeners | Complete | Local, after-commit, queued, and queued-after-commit semantics and fakes are proven.                                       |
| Signals                    | Complete | Immediate non-durable semantics, failure behavior, diagnostics, and test API are proven.                                   |
| Model observers            | Complete | Persistence and committed phases, rollback behavior, diagnostics, and memory conformance are proven.                       |
| Jobs and workers           | Complete | Durability, delay, retry, backoff, timeout, idempotency, failure, recovery, causation, and drain are proven.               |
| Scheduling                 | Complete | Cron/interval reconciliation, overlap, misfire, enable/disable, manual fire, system causation, and test firing are proven. |

## Security

| Capability                       | State                      | Acceptance evidence                                                                                                                                                                                         |
| -------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email/password identities        | Complete                   | Registration, verification, reset/change, single-use challenges, breached-password hook, and audit are proven.                                                                                              |
| Browser sessions                 | Complete                   | Digest-only storage, CSRF, rotation, bounded grace, replay rejection, listing, revocation, and pruning are proven.                                                                                          |
| Native impersonation             | Complete                   | Explicit opt-in, application authorization, target eligibility, credential rotation, actor/initiator/delegation audit, restoration, expiry, and HTTP/Keryx parity are proven.                               |
| Opaque bearer access tokens      | Complete                   | Issuance, constraints, ambiguity rejection, rotation, revocation, audit, fakes, and CLI management are proven.                                                                                              |
| Authentication abuse controls    | Complete                   | Durable hashed buckets, stable 429/Retry-After, recovery privacy, dummy verification, and audit are proven.                                                                                                 |
| Authorization                    | Complete                   | Every entry role, ambient read-only model access, application permission sources, resource decisions, default denial, bearer narrowing, audit, fakes, and diagnostics are proven.                           |
| Auth testing                     | Complete                   | `actingAs`, HTTP identity override, stateful identity/session/token fakes, and revocation assertions are proven.                                                                                            |
| Security review and release gate | Complete (release blocked) | Threat model, internal negative review, provenance/boundary audit, redaction, and a mandatory external pre-1.0 gate are documented; the current audit's critical and high findings remain release blockers. |

## Communications and infrastructure

| Capability         | State    | Acceptance evidence                                                                                                                                                              |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doxa mail contract | Complete | Transactional outbox delivery, normalized state, fakes, telemetry, inspection, and redrive are proven.                                                                           |
| SendGrid adapter   | Complete | Request translation, failure classes, signed timestamp-bounded webhooks, deduplication, and conformance fixtures are proven.                                                     |
| Doxa SMS contract  | Complete | Transactional outbox delivery, normalized state, fakes, telemetry, inspection, and redrive are proven.                                                                           |
| Twilio adapter     | Complete | Messaging Service and explicit E.164 sender translation, precedence, permanent sender validation, signed callbacks, opt-out classification, and conformance fixtures are proven. |
| Cache              | Complete | Doxa port, memory/PostgreSQL adapters, TTL, atomic operations, injection, inspection, forget, and prune are proven.                                                              |

## Observability and operability

| Capability            | State    | Acceptance evidence                                                                                                                                                                                               |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured logs       | Complete | Automatic role-bound loggers, ordinary-service constructor injection, recursive redaction, contextual framework channels, colored TTY output, NDJSON output, and in-memory assertions are proven.                 |
| W3C distributed spans | Complete | Inbound parentage, nested Doxa scopes, durable propagation, fan-out/retry links, and shared IDs across HTTP, logs, observations, and OpenTelemetry are proven.                                                    |
| Metrics               | Complete | Lifecycle, execution/HTTP, persistence, auth, authorization, queue/schedule, and communications instruments are proven.                                                                                           |
| Diagnostics           | Complete | Graph, routes, permission sources, policies, observers, listeners, jobs, schedules, auth, delivery, journal, outbox, and cache are inspectable through Praxis; `db:studio` provides safe local database browsing. |
| Execution diagnostics | Complete | Theoria proves causal timelines, hierarchical waterfalls, redaction, AI evidence, production sampling/filtering/buffering, resource identity, partitioned retention, protected audited access, and test fakes.    |
| Operator recovery     | Complete | Queue, delivery, schedule, session, token, cache, and auth-pruning operations are proven through Praxis.                                                                                                          |
| Production topology   | Complete | One immutable image boots independent web and combined background roles from prebuilt artifacts; explicit migration, horizontal scheduling safety, advanced scheduler isolation, and bounded shutdown are proven. |

## Developer experience

| Capability                  | State    | Acceptance evidence                                                                                                                                                                                                                                               |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Praxis command kernel       | Complete | One first-party executable owns generation, build, run, migration, inspection, recovery, and application commands.                                                                                                                                                |
| `new` application generator | Complete | A clean generated app compiles and boots auth, HTTP, persistence, policy, model, observer, event, signal, job, schedule, mail, SMS, telemetry, and tests.                                                                                                         |
| `make:*` generators         | Complete | Every canonical role is generated, registered, overwrite-safe, and authorization-explicit.                                                                                                                                                                        |
| Database commands           | Complete | Forward migration, status, batching, checksums, advisory lock, and drift refusal are proven; destructive rollback is intentionally excluded.                                                                                                                      |
| Runtime commands            | Complete | `serve`, default combined `work`, advanced isolated `work --without-scheduler`/`schedule`, combined dev, and fail-safe fresh-runtime hot reload are proven.                                                                                                       |
| Inspection commands         | Complete | Graph, routes, reactive roles, permission sources, policies, commands, queues, deliveries, infrastructure, auth, and schedules are proven.                                                                                                                        |
| Testing package and fakes   | Complete | HTTP/auth/persistence/queue/comms/cache/telemetry plus direct event, signal, job, and schedule APIs are proven against real manifests.                                                                                                                            |
| Gnosis integration          | Complete | Shared typed introspection, comprehensive packaged handbook, automatic programming-model instructions, component and consistency explanations, architecture diagnostics, bounded read-only MCP tools/resources, stdio launch, and generated knowledge are proven. |
| Compatibility and upgrades  | Complete | Release metadata aligns the framework package and toolchain matrix; safe planning, built-in recipes, installation handoff, build, migration-status, and optional test validation are proven.                                                                      |

## Reference application acceptance

The final generated application must prove this single connected flow:

1. Generate the application and its domain classes through Praxis.
2. Migrate PostgreSQL through Praxis.
3. Register and verify an identity, then authenticate by cookie and bearer token.
4. Authorize a mutating HTTP action through a default-deny policy.
5. Hydrate and save a model with observer phases.
6. Commit entity state, journal, audit, and outbox atomically.
7. Run local, after-commit, queued listener, and signal behavior in documented phases.
8. Execute retrying queued work with preserved actor and causation.
9. Deliver mail and SMS through fakes and production-adapter conformance.
10. Fire scheduled work through the same job runtime.
11. Inspect the entire path through logs, traces, metrics, audit, journal, outbox, and Praxis.
12. Express the same flow using first-party testing helpers.

## Final completion gate

Doxa may be called an MVP only when:

- Every required row above is complete or the MVP authority explicitly removes it.
- The generated reference application starts from a clean directory and passes its own tests.
- Production adapter conformance and first-party fake conformance both pass.
- Multi-process, crash, retry, shutdown, migration, and security negative paths pass.
- `pnpm check`, every package test, generator fixtures, residue scans, and documentation link checks
  are green.
- The development server and independent production roles are runnable through Praxis.
- The final audit finds no required application import of Hono, Drizzle, pg-boss, telemetry vendor,
  SendGrid, Twilio, or third-party authentication types.

## Post-MVP compatibility commitments

| Capability                        | State                    | Direction                                                                                                                                                                                              |
| --------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing-table model mapping      | MVP common path complete | Strict declared projections, patch writes, independent managed/read-only modes, readiness validation, and Laravel-like physical metadata are proven; advanced multi-record mappers remain future work. |
| Existing-table auth mapping       | MVP common path complete | One authoritative external password column with explicit never/in-place upgrade policy, login-only fail-closed mutation boundaries, and Doxa-owned session, token, challenge, abuse, and audit tables. |
| First-party roles and permissions | Deferred                 | Stable abilities, application permission sources, and policies are core; Doxa-owned storage and assignment wait for broader production evidence.                                                       |
