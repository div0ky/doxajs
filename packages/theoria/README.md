# `@doxajs/theoria`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Theoria is Doxa's optional first-party execution debugger. It records redacted correlated
observations in PostgreSQL and exposes a read-only causal timeline plus hierarchical waterfall for
requests, operations, models, reactions, events, jobs, schedules, AI work, logs, and exceptions.
Automatic refresh preserves the current navigation and pane scroll positions.

```sh
doxa add theoria
doxa migrate
doxa theoria
```

Development is loopback-only by default. Supported production diagnostics require the explicit
`production-diagnostics` application profile, bounded sampling/buffering, hot and partitioned warm
retention, capture filters, persisted deployment identity, and authenticated audited operator
access. See the [observability guide](../../docs/guides/observability.md).
