# First-Party Testing Harness Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-10

`@doxajs/testing` boots the application's real generated manifest and registry while replacing
declared singleton providers by stable manifest ID. Overrides are validated, visible, and receive
lifecycle behavior based on the replacement instance rather than accidentally invoking hooks from
the production adapter.

`DoxaTestHarness` provides `actingAsUser`, `actingAsSystem`, anonymous execution, HTTP requests,
actions, queries, and console commands through normal runtime admission. `TestAuth` resolves HTTP
actors and captures authorization decisions. Memory implementations cover transactions, models,
journal, outbox, delivery state, queues, cache, mail, SMS, and telemetry.

The memory transaction manager copies state per transaction, validates touched entity versions and
delivery baselines before a synchronous write-set merge, appends only transaction-local journal and
outbox records, releases after-commit callbacks only after success, and hands `doxa.queue` outbox
messages to the fake queue only after commit. Its one durable clone boundary preserves Doxa datetime
values and escapes ordinary `$doxa` objects. Tests prove conflicts, disjoint concurrent commits,
Eloquent-style persistence, rollback, authenticated HTTP, queued mail/SMS worker execution, durable
delivery transitions, and telemetry without PostgreSQL or provider APIs.

Later slices complete event fakes, direct signal/job/schedule APIs, auth and revocation helpers,
observer evidence, and matching model behavior across the memory and PostgreSQL adapters. Reusable
third-party adapter certification remains a post-MVP tooling improvement.
