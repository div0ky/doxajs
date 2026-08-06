# Foundation Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Incomplete

## Outcome

The first Doxa implementation proves this path end to end:

```text
declaration-only Application and Features
  → strict semantic TypeScript analysis
  → deterministic manifest and constructor registry
  → artifact validation
  → declared configuration materialization
  → dependency-ordered construction and startup
  → runtime readiness
  → reverse-ordered, idempotent shutdown
```

This is a foundational proof, not the Doxa MVP. HTTP, execution scopes, actions, queries,
persistence, events, queues, scheduling, auth, observability, the CLI, and Gnosis remain to be
implemented.

## Developer-facing proof

The reference application uses declaration-only composition:

```ts
export class OperationsFeature extends Feature {
  id = 'operations'
  configs = [WorkerConfig]
  providers = [DatabaseConnection, Worker]
}

export class Application extends DoxaApplication {
  id = 'reference-app'
  configs = [AppConfig]
  features = [OperationsFeature]
}
```

Configuration is ordinary typed code and direct constructor injection:

```ts
export class AppConfig extends Configuration {
  environment: 'development' | 'test' | 'production' = 'development'
  port = 3000
}

export class DatabaseConnection {
  constructor(readonly config: AppConfig) {}
}
```

Doxa derives `APP_ENVIRONMENT` and `APP_PORT`, validates values before singleton construction,
materializes the configuration without executing its field initializers, and injects a frozen
instance.

## Compiler proof

The compiler:

- Requires a semantically valid TypeScript project.
- Reads Application and Feature declarations from the TypeScript AST without constructing them.
- Accepts only literal declaration fields and direct class references in this slice.
- Requires explicit application, Feature, and provider IDs.
- Follows reachable concrete constructor dependencies without provider registration ceremony.
- Treats Feature-declared provider roots as singleton lifecycle participants and reachable ordinary
  services as transient.
- Rejects missing required dependencies, undeclared cross-Feature provider access, duplicate IDs
  including configuration IDs derived from distinct same-named declarations, and dependency cycles.
- Emits deterministic JSON semantics separately from constructor linkage.

The implementation is pinned to TypeScript 6.0.2. TypeScript 7 exposes its replacement native
compiler API through an explicitly unstable entry point; Doxa will migrate only through a deliberate
compatibility release and conformance pass.

## Runtime proof

The runtime:

- Reads generated artifacts and never imports the compiler or analyzes application source.
- Fails closed on unsupported formats, stale hashes, registry ID mismatches, duplicate configuration
  IDs, and framework-owned permission-source abilities.
- Recomputes the canonical semantic manifest hash rather than trusting declared hash fields.
- Verifies that `Doxa.boot(Application)` receives the exact declaration linked by the registry.
- Resolves configuration from overrides, environment, an exact `.env` path, then defaults.
- Aggregates configuration failures before constructing singleton services.
- Constructs dependencies before dependents and invokes lifecycle startup in that order.
- Reverses the order for drain, stop, and disposal.
- Aborts timed-out startup and uses one shared, configurable cleanup budget for late settlement,
  reverse-order stop, and disposal. Late completion is unwound, late rejection is secondary, and
  budget exhaustion reports every unsettled participant/phase pair without blocking boot forever.
- Preserves a normalized lifecycle timeout as the primary startup failure and records cleanup
  failures separately.
- Reaches `ready` only after successful startup.
- Gives concurrent shutdown callers the same promise.
- Installs no process-global signal handlers.

## Executable evidence

The conformance suite proves:

1. Repeated compilation produces byte-identical manifest and registry artifacts.
2. Registry output contains constructors only, not a second semantic graph.
3. Configuration conventions, defaults, parsing, aggregation, and freezing work before services.
4. Boot and shutdown obey dependency order.
5. Startup failure and deadline cancellation unwind successfully completed participants within one
   cleanup budget without racing late resource acquisition, waiting indefinitely, or masking the
   cause; late rejection and unsettled phases remain inspectable secondary failures.
6. Manifest-registry divergence and Application identity mismatch fail closed.
7. Runtime shutdown is idempotent.
8. Boot does not mutate process signal listeners.

Run the proof with `pnpm test`.

## Next slice

Completed: [Execution and operations vertical slice](execution-operations-vertical-slice.md).

The next slice should connect the action transaction boundary to PostgreSQL and Drizzle through an
execution-scoped Unit of Work, then prove atomic entity state, journal, and outbox behavior.
