# `@doxajs/runtime`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The artifact-only Doxa runtime. It validates compiled artifacts, constructs the dependency graph,
admits execution scopes, dispatches framework roles, and owns deterministic lifecycle behavior. If a
startup hook exceeds its deadline, Doxa aborts it and gives it one bounded settlement window. A
late-completing hook joins reverse-order stop and disposal; a non-settling hook cannot block boot
failure forever or race cleanup. Settlement, stop, and disposal share `deadlines.cleanup`, which
defaults to 30 seconds and caps their individual phase deadlines. Late rejection and
`LifecycleCleanupTimeoutError` remain secondary; the normalized startup timeout stays primary.

For transaction managers that declare shared-client serialization, concurrent model operations
retain their owning transaction and snapshot. Runtime records one diagnostic per affected model
session, warns outside production that `Promise.all` adds no database parallelism, and leaves
production warning logs quiet.

The runtime never compiles source. Ordinary Feature and domain code should import `@doxajs/core`,
not this package.

Every admitted execution resolves a clock, IANA time zone, and locale for first-party Graphite
datetimes. Application configuration defaults to `UTC` and `en-US`; an execution seed may override
the locale or time zone. Clock-relative APIs fail outside admission rather than reading the host
clock or host time zone implicitly. Durable context carries locale and time zone, never mutable
clock state.

Authorization resolves an application's selected permission source at most once per admitted
execution, applies credential constraints first, and permits policies only to narrow source grants.
Permission results never enter propagated execution context. Runtime-invoked permission sources and
policies receive ambient read-only model access: queries share their read session, actions and jobs
use an isolated read-only identity map over the owning Unit of Work, and standalone authorization
opens a bounded read transaction only when application evaluation is required.

Queued work gets a fresh execution and re-evaluates current application permissions. When dispatch
explicitly carries delegated user authority, the accepted actor, initiator, delegation, and bounded
authentication attribution remain fixed across attempts; later impersonation stop or expiry prevents
new dispatch without rewriting already-durable work.

Job cancellation closes the writable model session and rejects its transaction before a late handler
can commit. Already-started database operations drain into rollback; later model access is stale.
External effects remain at least once and require idempotency.

Praxis may boot the named `model-reader` profile for Gnosis. That profile validates the same
artifacts but starts only the transaction provider's declared dependency closure and admits only the
bounded model-record query entrypoint from an authenticated system console execution; it is not a
general partial-application boot mechanism.
