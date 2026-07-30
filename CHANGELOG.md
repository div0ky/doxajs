# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A comprehensive version-matched Gnosis agent handbook with automatic MCP instructions, role and
  component explanations, consistency-aware architecture review, provider/service diagnostics,
  shared Praxis knowledge generation, and compiler rejection of direct or transitive nested Action
  dispatch.
- The initial pnpm, native ESM, strict TypeScript workspace.
- Application-facing `@doxajs/core` declaration and lifecycle contracts.
- A versioned manifest package and semantic TypeScript compiler.
- Deterministic `.doxa/manifest.json` and constructor-only `.doxa/registry.mjs` generation.
- Artifact-only runtime boot with injectable configuration classes, dependency ordering, startup
  unwind, readiness, and idempotent shutdown.
- A reference application and compile-to-boot conformance suite.
- Class-first actions and queries with scoped `this.inject()` dependencies and typed `handle(input)`
  methods.
- Immutable actor-aware execution contexts carried privately through `AsyncLocalStorage`.
- One dependency scope per admitted execution with explicit `implements ExecutionScoped` caching and
  deterministic disposal.
- Transaction-wrapped action dispatch, non-transactional query dispatch, nested-action rejection,
  concurrent execution isolation, deadline cancellation, and shutdown draining.
- A Doxa-owned Unit of Work contract with entity state, journal, outbox, and after-commit phases.
- A PostgreSQL/Drizzle adapter with explicit migrations, optimistic concurrency, durable causal
  metadata, stable persistence failures, and lifecycle-owned connection pooling.
- Docker-backed PostgreSQL conformance tests for atomic commit, rollback, read-only enforcement,
  version races, stale units of work, and after-commit visibility.
- Feature-declared Eloquent-style models with generated stable identities and compiler diagnostics.
- An execution-scoped identity-mapped `ModelSession` with static `find`, `findOrFail`, `make`, and
  `create` APIs.
- Hydrated model `save`, `delete`, and `refresh` behavior with dirty, original, changed, version,
  existence, and recently-created state.
- Model-driven journal and outbox staging with automatic optimistic concurrency and stable missing,
  detached, and stale model failures.
- Feature-declared class events and listeners with compiler-inferred typed relationships, static
  typed-payload dispatch, scoped role injection, and execution-local isolation.
- Automatic class-bound `this.logger` for every framework role, required and optional
  `this.inject()` edges in manifest format v11, and constructor injection retained for ordinary
  services.
- `doxa db:studio`, backed by framework-pinned Drizzle Kit and `.env` database discovery without
  exposing credentials in process arguments.
- Theoria, the optional first-party development debugger with typed runtime observations, recursive
  secret redaction, PostgreSQL retention, causal timelines, a read-only loopback UI, Gnosis
  knowledge, and `doxa add theoria`, `theoria`, and `theoria:prune` commands.
- Theoria category browsing that lists actual HTTP, queue, event, and schedule observations and
  opens each selected observation inside its complete causal timeline.
- One-image production deployment generation with a multi-stage non-root Dockerfile,
  `.dockerignore`, production Compose topology, prebuilt artifact-only startup, explicit migration
  jobs, and a horizontally scalable `doxa work` role that runs workers and schedules together.
- Local listener failure propagation plus Laravel-aligned event-level and listener-level
  after-commit delivery that is discarded on rollback.
- Feature-declared HTTP routes compiled into the manifest with stable identities, methods, paths,
  dependency graphs, and duplicate-route diagnostics.
- A framework-owned Web Standards HTTP surface with path/query/header/body access, Standard Schema
  validation, response helpers, and stable JSON error documents.
- A private Hono 4 adapter and Node host with actor-aware admission, correlation propagation,
  idempotent shutdown, and no process-global signal handlers.
- A distinct sanitized HTTP outcome for failures that occur after the action transaction has already
  committed.
- Manifest format v2, which adds required route, event, and listener graph sections and rejects
  stale v1 artifacts before runtime interpretation.
- A domain-first integrated example organized into infrastructure, counters, and system Features
  with role folders that carry no runtime semantics.
- Feature-declared jobs with compiler-validated retry, delay, backoff, timeout, dependency, and
  lifecycle metadata.
- An application-facing static job dispatch API plus injectable current-job attempt context.
- A private pg-boss 12 adapter with explicit schema installation, atomic transactional outbox
  handoff, delayed delivery, normalized inspection, and graceful worker lifecycle.
- Writable job-attempt transactions and ModelSessions with stable job identity, fresh execution
  identity, actor/correlation/causation propagation, retry rollback, and terminal retention.
- Deterministic idempotency-key job identities and duplicate outbox handoff handling.
- `ShouldQueue` and `ShouldQueueAfterCommit` listener delivery through the same durable worker path.
- Manifest format v3, which adds required job declarations and queue capabilities and rejects stale
  v2 artifacts before runtime interpretation.
