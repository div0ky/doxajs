# @doxajs/realtime

## 0.1.0-alpha.33

### Patch Changes

- 7f546d6: Require Node.js 26.6 or newer within the 26.x line and add first-party Graphite, Instant,
  LocalDate, and Duration handling with execution-scoped clocks, strict validation, UTC PostgreSQL
  persistence, and type-preserving durable serialization.

## 0.1.0-alpha.32

### Minor Changes

- efebf4e: Add compiled, authenticated `RealtimeCommand` roles, Keryx protocol v3 command ingress,
  Doxa authorization composition, actor-command throttling, bounded acknowledgements, a no-retry
  realtime client API, testing support, generators, inspection, Gnosis knowledge, and normative
  documentation. Protocol v3 requires a coordinated web, worker, and browser-client rollout.

## 0.1.0-alpha.31

## 0.1.0-alpha.30

## 0.1.0-alpha.29

## 0.1.0-alpha.28

## 0.1.0-alpha.27

### Patch Changes

- 5078787: Add framework-owned browser admission for separately addressed Keryx listeners. Generated
  applications now expose a same-origin authorization route, Realtime obtains a fresh short-lived
  ticket before each connection, and Keryx consumes encrypted, origin-bound tickets once locally or
  atomically through Redis.

## 0.1.0-alpha.26

### Patch Changes

- 0683b12: Republish the coordinated prerelease with complete built artifacts and fail packaging
  when declared entry points are missing.

## 0.1.0-alpha.25

### Patch Changes

- d175fa9: Replace Keryx's alpha protocol and process-local publication model with the production
  role contract. `doxa add keryx` now enables framework-owned composition, web roles own
  authenticated protocol v2 sockets and signed publish ingress, worker-only roles publish without
  opening a listener, and Redis topology provides atomic message deduplication, cross-replica
  fanout, distributed presence, readiness loss, and recovery. Realtime now waits for the
  authenticated `connected` frame and exposes connection, subscription, and structured error state.
