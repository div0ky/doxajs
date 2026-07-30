# @doxajs/testing

## 0.1.0-alpha.30

### Patch Changes

- Updated dependencies [3ffb46f]
  - @doxajs/core@0.1.0-alpha.30
  - @doxajs/http-hono@0.1.0-alpha.30
  - @doxajs/runtime@0.1.0-alpha.30

## 0.1.0-alpha.29

### Patch Changes

- @doxajs/core@0.1.0-alpha.29
- @doxajs/http-hono@0.1.0-alpha.29
- @doxajs/runtime@0.1.0-alpha.29

## 0.1.0-alpha.28

### Patch Changes

- @doxajs/core@0.1.0-alpha.28
- @doxajs/http-hono@0.1.0-alpha.28
- @doxajs/runtime@0.1.0-alpha.28

## 0.1.0-alpha.27

### Patch Changes

- @doxajs/core@0.1.0-alpha.27
- @doxajs/http-hono@0.1.0-alpha.27
- @doxajs/runtime@0.1.0-alpha.27

## 0.1.0-alpha.26

### Patch Changes

- 0683b12: Republish the coordinated prerelease with complete built artifacts and fail packaging
  when declared entry points are missing.
- Updated dependencies [0683b12]
  - @doxajs/core@0.1.0-alpha.26
  - @doxajs/http-hono@0.1.0-alpha.26
  - @doxajs/runtime@0.1.0-alpha.26

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
