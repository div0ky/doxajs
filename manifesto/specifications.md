# Doxa Specification Status

This page records the current acceptance status of Doxa's public contracts. The
[MVP completion ledger](implementation/mvp-completion-ledger.md) is the aggregate authority for MVP
implementation status: a capability marked complete there has an accepted public contract,
production behavior or adapter evidence, conformance coverage, reference-application evidence,
diagnostics, and agreeing documentation.

MVP implementation acceptance is not a security-stability decision. The
[current framework security audit](implementation/security-audit-2026-07-16.md) has unresolved
critical and high findings that block a public security-stability claim and a 1.0 release.

Individual vertical-slice documents preserve the narrower status and remaining work that existed
when each proof was written. Their historical `MVP status: Incomplete` notes do not override the
later completion ledger.

## What a specification is

A Doxa specification defines externally observable behavior. It is more precise than design prose
and more durable than the implementation chosen to satisfy it.

Each specification should contain:

1. Purpose and boundaries.
2. Developer-facing vocabulary and examples.
3. Manifest representation, when applicable.
4. Runtime phases and ordering.
5. Success, failure, cancellation, and retry semantics.
6. Context and transaction behavior.
7. Diagnostics and observability.
8. Testing APIs and required fakes.
9. Escape hatches.
10. Adapter responsibilities and leak-prevention rules.
11. Conformance scenarios.
12. Open questions and explicit non-goals.

Normative statements should use **must**, **must not**, **should**, and **may** deliberately. Code
examples are illustrations unless the text declares them normative.

## Decision states

Every specification area should carry one status:

- **Unexplored** — named, but not yet investigated.
- **Exploring** — gathering constraints and comparing coherent designs.
- **Proposed** — one design is written and ready for challenge.
- **Accepted** — the contract is stable enough to implement.
- **Implemented** — at least one implementation passes its conformance suite.
- **Revising** — evidence requires a deliberate contract change.

Status describes confidence in the contract, not the amount of code written.

## Foundation

| Area                            | Status      | Contract or evidence                                                                               |
| ------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| Application and feature model   | Implemented | [Explicit features and generated manifest](decisions/0014-explicit-features-generated-manifest.md) |
| Application manifest            | Implemented | [Explicit features and generated manifest](decisions/0014-explicit-features-generated-manifest.md) |
| Lifecycle and failure semantics | Implemented | [Deterministic runtime lifecycle](decisions/0017-deterministic-runtime-lifecycle.md)               |
| Container and execution scopes  | Implemented | [Role injection with plain services](decisions/0024-role-injection-with-plain-services.md)         |
| Package boundaries              | Implemented | [Public package surface](decisions/0018-public-package-surface.md)                                 |

These specifications come first because every other subsystem participates in the application graph,
lifecycle, and execution scope.

## Application operations

| Area                           | Status                        | Contract or evidence                                                                         |
| ------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------- |
| Actions and dispatch           | Implemented                   | [Execution and operations proof](implementation/execution-operations-vertical-slice.md)      |
| Queries and dispatch           | Implemented                   | [Execution and operations proof](implementation/execution-operations-vertical-slice.md)      |
| Domain models and repositories | Implemented                   | [Model querying and relationships](specifications/model-querying-and-relationships.md)       |
| Existing-table model mapping   | Implemented (MVP common path) | [Existing-table model and auth mapping](decisions/0023-existing-table-model-auth-mapping.md) |
| Units of work and transactions | Implemented                   | [PostgreSQL durability proof](implementation/postgresql-durability-vertical-slice.md)        |
| Validation and error documents | Implemented                   | [HTTP response envelopes](specifications/http-response-envelopes.md)                         |
| Resources and serialization    | Implemented                   | [Generated MVP reference flow](implementation/generated-mvp-reference-flow.md)               |

The execution, durability, model, HTTP, and generated-reference proofs collectively cover the
observable action, query, transaction, validation, resource, and serialization contracts recorded as
complete in the MVP ledger.

## Events and asynchronous work

| Area                               | Status      | Contract or evidence                                                                     |
| ---------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| Journal and domain events          | Implemented | [Laravel-like class events](decisions/0015-laravel-like-class-events.md)                 |
| Outbox and delivery                | Implemented | [PostgreSQL durability proof](implementation/postgresql-durability-vertical-slice.md)    |
| Listeners and observers            | Implemented | [Signals and observers proof](implementation/signals-observers-vertical-slice.md)        |
| Jobs and workers                   | Implemented | [pg-boss queue and worker proof](implementation/pg-boss-queue-worker-vertical-slice.md)  |
| Scheduling                         | Implemented | [Scheduling proof](implementation/scheduling-vertical-slice.md)                          |
| Mail and SMS                       | Implemented | [Communications adapter proof](implementation/communications-adapters-vertical-slice.md) |
| Realtime broadcasting and commands | Implemented | [Realtime transport contract](specifications/realtime-broadcasting.md)                   |

## Interfaces and policy

| Area                              | Status                        | Contract or evidence                                                                                             |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| HTTP manifest                     | Implemented                   | [Hono HTTP proof](implementation/hono-http-vertical-slice.md)                                                    |
| Hono adapter                      | Implemented                   | [Hono HTTP proof](implementation/hono-http-vertical-slice.md)                                                    |
| HTTP response envelopes           | Implemented                   | [HTTP response envelopes](specifications/http-response-envelopes.md)                                             |
| Authentication                    | Implemented                   | [Authentication completion proof](implementation/authentication-completion-vertical-slice.md)                    |
| Native impersonation              | Implemented                   | [Native impersonation contract](specifications/native-impersonation.md)                                          |
| Existing-table auth mapping       | Implemented (MVP common path) | [Existing-table model and auth mapping](decisions/0023-existing-table-model-auth-mapping.md)                     |
| Authorization                     | Implemented                   | [Actor, execution-context, and authorization contract](specifications/actor-execution-context-authorization.md)  |
| Authorization model sessions      | Implemented                   | [Read-only model sessions during authorization](decisions/0035-read-only-model-sessions-during-authorization.md) |
| Application permission sources    | Implemented                   | [Permission source and shared service proof](implementation/application-permission-source-vertical-slice.md)     |
| First-party roles and permissions | Deferred                      | [First-party permission persistence is intentionally deferred](decisions/0022-defer-first-party-permissions.md)  |
| Execution context                 | Implemented                   | [Actor, execution-context, and authorization contract](specifications/actor-execution-context-authorization.md)  |

## Operations and developer experience

| Area                           | Status                                          | Contract or evidence                                                                   |
| ------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Configuration and secrets      | Implemented                                     | [Injectable configuration classes](decisions/0021-injectable-configuration-classes.md) |
| Logging                        | Implemented                                     | [Logging contract](specifications/logging.md)                                          |
| Metrics and tracing            | Implemented                                     | [Telemetry and distributed tracing](specifications/telemetry-and-tracing.md)           |
| Testing applications and fakes | Implemented                                     | [First-party testing harness proof](implementation/testing-harness-vertical-slice.md)  |
| CLI and generators             | Implemented                                     | [Praxis command kernel proof](implementation/praxis-command-kernel-vertical-slice.md)  |
| Execution debugger             | Implemented                                     | [Theoria contract](specifications/theoria.md)                                          |
| AI observations                | Implemented                                     | [AI observation contract](specifications/ai-observations.md)                           |
| Diagnostics                    | Implemented                                     | [Operational control proof](implementation/operational-control-vertical-slice.md)      |
| Adapter contracts              | Implemented                                     | [MVP completion ledger](implementation/mvp-completion-ledger.md)                       |
| Compatibility releases         | Implemented                                     | [Upgrade workflow](../docs/upgrading/index.md)                                         |
| Gnosis AI-assisted engineering | Implemented (read-only architectural authority) | [Gnosis contract](specifications/gnosis.md)                                            |
| Container deployment           | Implemented                                     | [Container deployment contract](specifications/container-deployment.md)                |

## Maintenance order

Contract revisions should still proceed in dependency order, not in order of visible product appeal:

1. Application model, manifest, lifecycle, scopes, and package rules.
2. Execution context, actions, queries, units of work, and errors.
3. Models, repositories, journal, outbox, observers, and listeners.
4. HTTP declarations, authentication, authorization, resources, and Hono adaptation.
5. Jobs, workers, retries, scheduling, and shutdown coordination.
6. Configuration, observability, testing, diagnostics, CLI, and compatibility releases.

Exploration can happen in parallel, but a revised downstream specification must identify the
accepted upstream contracts it relies on. A newly proposed capability may use **Unexplored**,
**Exploring**, or **Proposed** without changing the implemented status of the completed MVP contract
it extends.

## Acceptance bar

A specification is ready to become **Accepted** when:

- Its vocabulary agrees with the manifesto and neighboring specifications.
- Normal application code can be shown without infrastructure engine types.
- Lifecycle ordering and failure behavior are unambiguous.
- Transaction, durability, and context boundaries are stated.
- The testing surface can prove the promised semantics.
- Conformance scenarios cover boot, normal operation, failure, retry where relevant, and shutdown.
- Escape hatches do not undermine the primary programming model.
- Remaining open questions do not change the contract's foundation.

New implementation should begin with vertical proofs of accepted contracts, but implementation
convenience must not silently settle unresolved specification questions. Once the aggregate
acceptance bar passes, this status page and the completion ledger must be updated together.
