# @doxajs/postgres-drizzle

## 0.1.0-alpha.33

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

## 0.1.0-alpha.32

### Patch Changes

- f1b8d80: Preserve application and framework errors thrown through PostgreSQL read, write, and
  shared framework transactions. Only errors originating from the PostgreSQL driver are translated
  into a `PersistenceError` after transaction cleanup.
- Updated dependencies [efebf4e]
  - @doxajs/core@0.1.0-alpha.32

## 0.1.0-alpha.31

### Patch Changes

- @doxajs/core@0.1.0-alpha.31

## 0.1.0-alpha.30

### Patch Changes

- Updated dependencies [3ffb46f]
  - @doxajs/core@0.1.0-alpha.30

## 0.1.0-alpha.29

### Patch Changes

- @doxajs/core@0.1.0-alpha.29

## 0.1.0-alpha.28

### Patch Changes

- @doxajs/core@0.1.0-alpha.28

## 0.1.0-alpha.27

### Patch Changes

- @doxajs/core@0.1.0-alpha.27

## 0.1.0-alpha.26

### Patch Changes

- 0683b12: Republish the coordinated prerelease with complete built artifacts and fail packaging
  when declared entry points are missing.
- Updated dependencies [0683b12]
  - @doxajs/core@0.1.0-alpha.26

## 0.1.0-alpha.25

### Patch Changes

- Updated dependencies [d175fa9]
  - @doxajs/core@0.1.0-alpha.25
