# `@doxajs/postgres-drizzle`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Doxa's first-party PostgreSQL transaction, durability, Eloquent-style model persistence, journal,
outbox, communications ledger, and cache adapter implemented with Drizzle.

Every transaction serializes model and framework-participant operations through its one PostgreSQL
client, drains queued work before cleanup, and rejects the complete queue after an operation fails.
This preserves one snapshot and avoids relying on node-postgres's deprecated implicit query queue.

```sh
pnpm add @doxajs/postgres-drizzle
```

The package includes developer-reviewed, forward-only Doxa-owned migrations. Praxis applies those
alongside developer-authored application SQL migrations. Application models and domain code remain
independent from both migration ownership and Drizzle types.

Mapped-table reads use the compiler-declared physical projection rather than `SELECT *`, and updates
contain only the declared dirty patch plus adapter-owned timestamp/version changes. Readiness
inspects mapped relations read-only and validates declared columns, types, nullability, keys,
generated behavior, views, and insert viability without importing unrelated physical schema into
Doxa artifacts. Because PostgreSQL views do not preserve reliable `NOT NULL` catalog metadata,
required view attributes are checked against each projected row during strict hydration. Catalog
inspection preserves quoted mixed-case and schema-qualified relation names.

Mapped `Graphite` and `Instant` attributes use one `timestamptz` or `timestamp` column; no time-zone
sidecar is required. Doxa persists the exact UTC instant, hydrates Graphite in UTC, treats existing
`timestamp without time zone` values strictly as UTC wall values, and keeps the PostgreSQL session
time zone at UTC. `LocalDate` maps to `date`, while `Duration` maps to canonical ISO text. Any
driver-level JavaScript `Date` conversion remains private to this adapter.
