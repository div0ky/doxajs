# @doxajs/runtime

## 0.1.0-alpha.33

### Minor Changes

- 6354418: Add opt-in, policy-authorized native browser-session impersonation with target
  eligibility, opaque credential rotation, actor/initiator/delegation audit context, restoration,
  expiry, revocation, and unique activation grants across HTTP and Keryx with durable queued actor
  attribution.

### Patch Changes

- 7f546d6: Require Node.js 26.6 or newer within the 26.x line and add first-party Graphite, Instant,
  LocalDate, and Duration handling with execution-scoped clocks, strict validation, UTC PostgreSQL
  persistence, and type-preserving durable serialization.
- 92fc738: Reject invalid datetime, manifest, permission, HTTP, and schedule inputs; make cursor,
  memory transaction/cache, lifecycle cleanup, cookie renewal, delivery reconciliation, provider
  failure, and expired-job transaction behavior deterministic and safe.
- bea1be1: Serialize concurrent model and framework operations on each PostgreSQL transaction
  client, drain queued work before cleanup, and report Promise.all overlaps without production
  warning-log noise.
- Updated dependencies [6354418]
- Updated dependencies [7f546d6]
- Updated dependencies [92fc738]
- Updated dependencies [bea1be1]
  - @doxajs/core@0.1.0-alpha.33
  - @doxajs/manifest@0.1.0-alpha.33

## 0.1.0-alpha.32

### Minor Changes

- efebf4e: Add compiled, authenticated `RealtimeCommand` roles, Keryx protocol v3 command ingress,
  Doxa authorization composition, actor-command throttling, bounded acknowledgements, a no-retry
  realtime client API, testing support, generators, inspection, Gnosis knowledge, and normative
  documentation. Protocol v3 requires a coordinated web, worker, and browser-client rollout.

### Patch Changes

- Updated dependencies [efebf4e]
  - @doxajs/core@0.1.0-alpha.32
  - @doxajs/manifest@0.1.0-alpha.32

## 0.1.0-alpha.31

### Patch Changes

- @doxajs/core@0.1.0-alpha.31
- @doxajs/manifest@0.1.0-alpha.31

## 0.1.0-alpha.30

### Patch Changes

- Updated dependencies [3ffb46f]
  - @doxajs/core@0.1.0-alpha.30
  - @doxajs/manifest@0.1.0-alpha.30

## 0.1.0-alpha.29

### Patch Changes

- @doxajs/core@0.1.0-alpha.29
- @doxajs/manifest@0.1.0-alpha.29

## 0.1.0-alpha.28

### Patch Changes

- @doxajs/core@0.1.0-alpha.28
- @doxajs/manifest@0.1.0-alpha.28

## 0.1.0-alpha.27

### Patch Changes

- @doxajs/core@0.1.0-alpha.27
- @doxajs/manifest@0.1.0-alpha.27

## 0.1.0-alpha.26

### Patch Changes

- 0683b12: Republish the coordinated prerelease with complete built artifacts and fail packaging
  when declared entry points are missing.
- Updated dependencies [0683b12]
  - @doxajs/core@0.1.0-alpha.26
  - @doxajs/manifest@0.1.0-alpha.26

## 0.1.0-alpha.25

### Patch Changes

- d175fa9: Replace Keryx's alpha protocol and process-local publication model with the production
  role contract. `doxa add keryx` now enables framework-owned composition, web roles own
  authenticated protocol v2 sockets and signed publish ingress, worker-only roles publish without
  opening a listener, and Redis topology provides atomic message deduplication, cross-replica
  fanout, distributed presence, readiness loss, and recovery. Realtime now waits for the
  authenticated `connected` frame and exposes connection, subscription, and structured error state.
- Updated dependencies [d175fa9]
  - @doxajs/core@0.1.0-alpha.25
  - @doxajs/manifest@0.1.0-alpha.25
