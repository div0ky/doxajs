# `@doxajs/queue-pg-boss`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Doxa's first-party PostgreSQL queue, outbox handoff, worker, retry, failure, schedule, and operator
adapter implemented with pg-boss.

```sh
pnpm add @doxajs/queue-pg-boss
```

Delivery is at least once. Jobs must be idempotent. Multiple background replicas may safely admit
schedules because cron declarations and interval slots use distributed identities.

When pg-boss expires an attempt, Doxa aborts its writable model session and rolls back local entity,
journal, and outbox writes. PostgreSQL cancellation remains armed through operation drain and
commit. A handler that settles late cannot use stale models; external effects still require
idempotency.

`doxa migrate` installs queue-owned schedule controls and short-lived attempt-trace lineage used to
link retries across worker processes. Terminal jobs remove their attempt lineage, and orphaned rows
expire defensively.
