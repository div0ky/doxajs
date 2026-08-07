# @doxajs/praxis

## 0.1.0-alpha.33

### Minor Changes

- 6354418: Add opt-in, policy-authorized native browser-session impersonation with target
  eligibility, opaque credential rotation, actor/initiator/delegation audit context, restoration,
  expiry, revocation, and unique activation grants across HTTP and Keryx with durable queued actor
  attribution.

### Patch Changes

- ee59765: Resolve default framework upgrades through npm's sole moving `latest` dist-tag,
  regardless of whether the newest coordinated release is an alpha, beta, release candidate, or
  stable version.
- 7f546d6: Require Node.js 26.6 or newer within the 26.x line and add first-party Graphite, Instant,
  LocalDate, and Duration handling with execution-scoped clocks, strict validation, UTC PostgreSQL
  persistence, and type-preserving durable serialization.
- 92fc738: Reject invalid datetime, manifest, permission, HTTP, and schedule inputs; make cursor,
  memory transaction/cache, lifecycle cleanup, cookie renewal, delivery reconciliation, provider
  failure, and expired-job transaction behavior deterministic and safe.
- Updated dependencies [6354418]
- Updated dependencies [7f546d6]
- Updated dependencies [92fc738]
- Updated dependencies [bea1be1]
  - @doxajs/core@0.1.0-alpha.33
  - @doxajs/http-hono@0.1.0-alpha.33
  - @doxajs/runtime@0.1.0-alpha.33
  - @doxajs/introspection@0.1.0-alpha.33
  - @doxajs/queue-pg-boss@0.1.0-alpha.33

## 0.1.0-alpha.32

### Minor Changes

- efebf4e: Add compiled, authenticated `RealtimeCommand` roles, Keryx protocol v3 command ingress,
  Doxa authorization composition, actor-command throttling, bounded acknowledgements, a no-retry
  realtime client API, testing support, generators, inspection, Gnosis knowledge, and normative
  documentation. Protocol v3 requires a coordinated web, worker, and browser-client rollout.

### Patch Changes

- 596e7e4: Treat `--help` and `-h` as side-effect-free help flags in every Praxis command position
  instead of parsing them as generator targets or other command arguments.
- Updated dependencies [efebf4e]
  - @doxajs/core@0.1.0-alpha.32
  - @doxajs/runtime@0.1.0-alpha.32
  - @doxajs/introspection@0.1.0-alpha.32
  - @doxajs/http-hono@0.1.0-alpha.32
  - @doxajs/queue-pg-boss@0.1.0-alpha.32

## 0.1.0-alpha.31

### Patch Changes

- 1a2775d: Generate and upgrade Doxa applications with pnpm 11.18.0.
  - @doxajs/core@0.1.0-alpha.31
  - @doxajs/http-hono@0.1.0-alpha.31
  - @doxajs/queue-pg-boss@0.1.0-alpha.31
  - @doxajs/runtime@0.1.0-alpha.31
  - @doxajs/introspection@0.1.0-alpha.31

## 0.1.0-alpha.30

### Patch Changes

- Updated dependencies [3ffb46f]
  - @doxajs/core@0.1.0-alpha.30
  - @doxajs/http-hono@0.1.0-alpha.30
  - @doxajs/queue-pg-boss@0.1.0-alpha.30
  - @doxajs/runtime@0.1.0-alpha.30
  - @doxajs/introspection@0.1.0-alpha.30

## 0.1.0-alpha.29

### Patch Changes

- a541e16: Launch a nested application's generated Gnosis MCP server from the application directory
  so TypeScript and package resolution remain correct when the MCP client starts at the repository
  root.
  - @doxajs/core@0.1.0-alpha.29
  - @doxajs/http-hono@0.1.0-alpha.29
  - @doxajs/queue-pg-boss@0.1.0-alpha.29
  - @doxajs/runtime@0.1.0-alpha.29
  - @doxajs/introspection@0.1.0-alpha.29

## 0.1.0-alpha.28

### Patch Changes

- b0c73f7: Use a portable repository-relative Node launcher for generated Gnosis MCP registrations
  instead of embedding machine-specific absolute paths or undocumented client working-directory
  fields.
- 6ec9ec4: Make Gnosis Doxa's version-matched architectural authority. Ship a comprehensive
  structured handbook, automatic MCP and managed-agent programming-model guidance, role and
  component explanations, consistency-aware architecture review, provider/service diagnostics, and
  unified Praxis knowledge generation. Reject direct and transitive `ActionBus` reachability from
  Actions, Queries, and Jobs at compilation with the ordinary-service remedy. Return matching
  handbook-linked provider/service and canonical-folder advisories from compilation and print them
  through Praxis. Limit folder advisories to the nearest role-like path segment so Features with
  role-like names do not produce false architecture warnings. Keep role lifecycle guidance aligned
  with the compiler's execution-local disposal contract, and distinguish after-durability Observer
  phases in component transaction explanations. Traverse shared dependency graphs once per operation
  when enforcing the nested `ActionBus` rule. Reject application lifecycle phases on ordinary
  services while retaining explicit scope-local disposal without reserving ordinary business-method
  names. Exclude role-like Feature directory names from folder advisories, and explain retrieved
  Observer phases across read-only and writable model sessions.
- Updated dependencies [6ec9ec4]
  - @doxajs/introspection@0.1.0-alpha.28
  - @doxajs/core@0.1.0-alpha.28
  - @doxajs/http-hono@0.1.0-alpha.28
  - @doxajs/queue-pg-boss@0.1.0-alpha.28
  - @doxajs/runtime@0.1.0-alpha.28

## 0.1.0-alpha.27

### Patch Changes

- 5078787: Add framework-owned browser admission for separately addressed Keryx listeners. Generated
  applications now expose a same-origin authorization route, Realtime obtains a fresh short-lived
  ticket before each connection, and Keryx consumes encrypted, origin-bound tickets once locally or
  atomically through Redis.
  - @doxajs/core@0.1.0-alpha.27
  - @doxajs/http-hono@0.1.0-alpha.27
  - @doxajs/queue-pg-boss@0.1.0-alpha.27
  - @doxajs/runtime@0.1.0-alpha.27
  - @doxajs/introspection@0.1.0-alpha.27

## 0.1.0-alpha.26

### Patch Changes

- 0683b12: Republish the coordinated prerelease with complete built artifacts and fail packaging
  when declared entry points are missing.
- Updated dependencies [0683b12]
  - @doxajs/core@0.1.0-alpha.26
  - @doxajs/http-hono@0.1.0-alpha.26
  - @doxajs/introspection@0.1.0-alpha.26
  - @doxajs/queue-pg-boss@0.1.0-alpha.26
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
  - @doxajs/queue-pg-boss@0.1.0-alpha.25
  - @doxajs/introspection@0.1.0-alpha.25
