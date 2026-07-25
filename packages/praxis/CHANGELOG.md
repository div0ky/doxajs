# @doxajs/praxis

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
  - @doxajs/runtime@0.1.0-alpha.25
  - @doxajs/http-hono@0.1.0-alpha.25
  - @doxajs/queue-pg-boss@0.1.0-alpha.25
  - @doxajs/introspection@0.1.0-alpha.25
