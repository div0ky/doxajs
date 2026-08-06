# Operational Control Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-10

Praxis exposes the framework-owned operational state without requiring an application to import or
understand pg-boss, Drizzle, Hono, or provider SDK internals. Operators can inspect journal facts,
outbox handoffs, cache keys, identities, sessions, bearer credentials, queue jobs, deliveries, and
compiled schedules. Secret values and credential digests are never printed.

Schedule enablement is durable in `doxa_schedule_controls`. Scheduler startup creates missing
controls and reconciles only enabled declarations. `schedule:enable` and `schedule:disable` update
that state explicitly. `schedule:run` writes the same actor-aware `doxa.queue` outbox envelope as
framework dispatch, so manual work is durable with or without a live worker and retains schedule
causation. Schedule commands accept a full schedule ID or a unique slash-delimited suffix. Ambiguous
short IDs fail before any database mutation and report the matching full IDs.

Queue and delivery retries fail closed around eligible terminal states. Session and bearer-token
revocation plus auth pruning are first-party commands. Cache pruning removes only expired values;
cache inspection lists keys and expiry, never values. Integration tests exercise these operations
against PostgreSQL and the compiled application manifest.
