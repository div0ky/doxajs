# `@doxajs/runtime`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The artifact-only Doxa runtime. It validates compiled artifacts, constructs the dependency graph,
admits execution scopes, dispatches framework roles, and owns deterministic lifecycle behavior.

Concurrent model operations retain their owning transaction and snapshot. Runtime records one
serialization diagnostic per affected model session, warns outside production that `Promise.all`
adds no database parallelism, and leaves production warning logs quiet.

The runtime never compiles source. Ordinary Feature and domain code should import `@doxajs/core`,
not this package.

Authorization resolves an application's selected permission source at most once per admitted
execution, applies credential constraints first, and permits policies only to narrow source grants.
Permission results never enter propagated execution context. Runtime-invoked permission sources and
policies receive ambient read-only model access: queries share their read session, actions and jobs
use an isolated read-only identity map over the owning Unit of Work, and standalone authorization
opens a bounded read transaction only when application evaluation is required.

Praxis may boot the named `model-reader` profile for Gnosis. That profile validates the same
artifacts but starts only the transaction provider's declared dependency closure and admits only the
bounded model-record query entrypoint from an authenticated system console execution; it is not a
general partial-application boot mechanism.
