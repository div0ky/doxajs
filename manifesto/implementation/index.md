# Doxa Implementation Proofs

Implementation proofs record executable evidence for accepted architectural directions. They do not
silently promote an incomplete specification or vertical slice into the Doxa MVP.

The active [MVP completion ledger](mvp-completion-ledger.md) maps every remaining viability
requirement to its implementation and acceptance evidence.

1. [Foundation vertical slice](foundation-vertical-slice.md) — deterministic declarations,
   artifacts, configuration, container boot, readiness, and shutdown.
2. [Execution and operations vertical slice](execution-operations-vertical-slice.md) — immutable
   execution context, one admitted scope, action/query dispatch, transaction boundaries, and
   deterministic scoped disposal.
3. [PostgreSQL durability vertical slice](postgresql-durability-vertical-slice.md) — Drizzle-backed
   transactions, Unit of Work, entity state, journal, outbox, concurrency, and after-commit
   behavior.
4. [Eloquent-style model vertical slice](eloquent-model-vertical-slice.md) — declared models,
   execution-scoped hydration and immutable identity, typed cloned mutation, dirty tracking,
   `save()` lifecycle, operation-boundary entrypoint parity, concurrency, and atomic model-driven
   durability without ordinary Unit of Work ceremony.
5. [Class events vertical slice](class-events-vertical-slice.md) — inherited static dispatch, typed
   listener inference, scoped role injection, execution context, local failure, and
   transaction-aware after-commit delivery.
6. [Hono HTTP vertical slice](hono-http-vertical-slice.md) — compiled framework-owned routes, Web
   Standards requests and responses, Standard Schema validation, actor-aware admission, stable
   errors, and coordinated Node hosting over private Hono mechanics.
7. [pg-boss queue and worker vertical slice](pg-boss-queue-worker-vertical-slice.md) — declared
   jobs, transactional dispatch, atomic outbox handoff, retries, terminal failure, idempotency,
   queued listeners, causal execution, writable job attempts, and graceful worker draining.
8. [Scheduling vertical slice](scheduling-vertical-slice.md) — class-first cron and interval
   declarations, manifest compilation, deterministic pg-boss reconciliation, overlap and misfire
   policy, system actor causation, existing Job execution, and graceful scheduler draining.
9. [Email and password authentication vertical slice](email-password-auth-vertical-slice.md) —
   first-party identities, versioned Argon2id credentials, opaque digest-backed sessions, HTTP actor
   resolution, rotation, CSRF origin enforcement, revocation, and security audit evidence.
10. [Opaque bearer authentication vertical slice](opaque-bearer-auth-vertical-slice.md) — one-time
    opaque credentials, digest-only storage, API actor resolution, authority constraints, ambiguity
    rejection, rotation, revocation, and audit.
11. [Default-deny authorization vertical slice](default-deny-authorization-vertical-slice.md) —
    compiled policies and route access, structured entry/resource decisions, bearer constraint
    narrowing, normalized denial, and durable security audits.
12. [Signals and model observers vertical slice](signals-observers-vertical-slice.md) — immediate
    typed coordination plus Eloquent-style retrieved, persistence, and post-commit lifecycle phases
    with generated metadata and rollback proofs.
13. [Cache vertical slice](cache-vertical-slice.md) — a Doxa-owned port with deterministic memory
    behavior and PostgreSQL TTL/atomic-operation proof behind the compiled provider graph.
14. [Praxis command kernel vertical slice](praxis-command-kernel-vertical-slice.md) — executable
    help/build/inspection plus safe generators that automatically maintain Feature declarations.
15. [Communications adapters vertical slice](communications-adapters-vertical-slice.md) —
    provider-independent contracts and fakes plus SendGrid/Twilio sending, signature verification,
    delivery normalization, and retry classification.
16. [Praxis runtime and observability vertical slice](praxis-runtime-observability-vertical-slice.md)
    — complete generators and operations, application commands, independent runtime roles, Gnosis
    knowledge, structured telemetry, and W3C propagation.
17. [First-party testing harness vertical slice](testing-harness-vertical-slice.md) — real-manifest
    provider overrides, acting-as identity, in-memory durability, queue/comms fakes, and HTTP,
    action, query, command, rollback, and telemetry proofs.
18. [Authentication completion vertical slice](authentication-completion-vertical-slice.md) —
    digest-only challenge records, queued mail, password change, durable abuse controls, recovery
    privacy, user session management, and the documented raw-delivery-payload blocker.
19. [Operational control vertical slice](operational-control-vertical-slice.md) — durable schedule
    enablement and manual firing plus journal, outbox, cache, auth, queue, and delivery inspection
    and recovery through Praxis.
20. [Generated MVP reference flow](generated-mvp-reference-flow.md) — clean Praxis generation plus
    real-manifest fake and PostgreSQL acceptance flows spanning every required framework role.
21. [Existing-table model and authentication mapping](existing-table-mapping-vertical-slice.md) —
    Laravel-like model metadata, explicit first-party auth mappings, independent model migration
    management and read-only access, mixed auth-table ownership, PostgreSQL conformance, fakes, and
    operator/Gnosis inspection.
22. [Next.js Field Guide frontend slice](next-field-guide-vertical-slice.md) — external-consumer
    Next.js, Tailwind, and shadcn/ui proof across public HTTP, sessions, bearer tokens, protected
    models, and queued work.
23. [Development hot reload vertical slice](development-hot-reload-vertical-slice.md) — debounced
    source watching, fail-safe compilation, fresh-process runtime replacement, and recovery without
    manual server restarts.
24. [Distributed observability and Theoria vertical slice](theoria-vertical-slice.md) — nested W3C
    spans, first-party OpenTelemetry, privacy-safe AI evidence, production-grade PostgreSQL capture,
    causal navigation, and a hierarchical waterfall.
25. [Container deployment vertical slice](container-deployment-vertical-slice.md) — one generated
    immutable image, prebuilt production boot, combined workers and schedules, explicit migrations,
    advanced scheduler isolation, Compose topology, and Gnosis deployment knowledge.
26. [Realtime broadcasting and commands vertical slice](realtime-broadcasting-vertical-slice.md) —
    compiled queued/now event capabilities, transactional queue handoff, protocol v3 Keryx
    WebSockets, authenticated ephemeral commands, signed worker publication, Redis replication and
    presence, observable clients, fakes, and framework-owned Praxis composition.
27. [Typed model query and relationship vertical slice](typed-model-query-relationship-vertical-slice.md)
    — logical typed plans, read-only query sessions, PostgreSQL and memory conformance,
    deterministic pagination and cursors, all relationship cardinalities, eager loading, identity
    reuse, and explicit bulk-mutation and public-join deferrals.
28. [Gnosis read-only local engineering vertical slice](gnosis-read-only-vertical-slice.md) — shared
    typed introspection, manifest relationship metadata, bounded MCP tools and resources,
    exact-version local guidance, stdio launch, redaction, and production dependency isolation.
29. [Framework security audit, 2026-07-16](security-audit-2026-07-16.md) — adversarial
    framework-wide review, remediated boundary defects, dependency evidence, and unresolved release
    blockers.
30. [Application permission source and shared service vertical slice](application-permission-source-vertical-slice.md)
    — concrete `Feature.provides` scope preservation plus one application-wide, execution-cached
    permission source composed with credential constraints and resource policies, now with ambient
    read-only declared-model access over the owning authorization persistence boundary.
