# 0005: Use Node.js 26 as the Runtime

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Amended:** 2026-08-05 — Raised the runtime baseline from Node.js 24 to Node.js 26
- **Decision owners:** Doxa maintainers

## Decision

Doxa will target Node.js 26 as its application, worker, console, and tooling runtime. The minimum
version is Node.js 26.6.

Doxa packages will express the supported range as Node.js 26.6 or newer within the 26.x release
line. Doxa releases may raise the minimum 26.x patch when required for correctness or security, but
they will document that change explicitly.

## Context

Selecting one runtime lets Doxa provide a coherent compatibility contract for HTTP serving,
cryptography, asynchronous execution context, process signals, diagnostics, workers, and the CLI.
Doxa should not weaken its initial programming model to claim portability across runtimes that have
different process, networking, cryptographic, or lifecycle behavior.

Node.js 26 preserves the Web Standards `Request` and `Response` boundary, built-in Argon2 support,
and the process and lifecycle primitives Doxa requires. It also makes Temporal available by default,
allowing Doxa to build first-party datetime semantics on the platform instead of adopting a
foundational third-party datetime engine.

Node.js 26 is still the Current release when Doxa adopts it and is scheduled to enter Active LTS in
October 2026. Controlled alpha adoption accepts that short pre-LTS window in exchange for validating
one runtime baseline before broader production support.

## Boundary

- Node.js APIs may be used inside the kernel, runtime adapters, workers, CLI, and infrastructure
  packages where Doxa owns their lifecycle.
- Feature APIs should prefer Doxa contracts and Web Standards where doing so preserves the intended
  semantics.
- Doxa v1 does not promise that applications run unchanged on Bun, Deno, edge runtimes, or
  browser-like worker environments.
- HTTP application code remains independent of Node's request and response types.
- Runtime-specific failures are normalized into Doxa diagnostics and lifecycle errors.

## Consequences

- Doxa can design and test one deterministic process and shutdown model.
- First-party authentication can use Node's built-in Argon2id implementation.
- The Hono adapter can use its Node.js server integration without making Node HTTP types public.
- Applications that require another runtime will need a future runtime adapter and conformance
  suite.
- The supported Node patch range becomes part of every Doxa release's compatibility contract.

## Required implementation proof

The runtime conformance suite must cover:

1. Boot, readiness, partial-startup failure, drain, and shutdown.
2. Request and job execution-context isolation.
3. Signal handling and deterministic resource disposal.
4. Cryptographic randomness and Argon2id password hashing.
5. Hono request handling through Web Standards objects.
6. Worker and console execution under the same application manifest.
7. CLI behavior in interactive and non-interactive environments.

## Revisit when

- Node.js 26 approaches the end of Doxa's supported maintenance window.
- A newer Node.js line materially improves security or removes required compatibility work.
- Another runtime can satisfy the full kernel, HTTP, cryptography, worker, CLI, and lifecycle
  conformance suites without weakening the application model.

## References

- [Doxa HTTP engine decision](0001-hono-http-engine.md)
- [Doxa first-party authentication decision](0003-first-party-authentication.md)
- [Node.js 26.6.0 release](https://nodejs.org/en/blog/release/v26.6.0)
- [Node.js release schedule](https://github.com/nodejs/release#release-schedule)
- [Node.js cryptography documentation](https://nodejs.org/api/crypto.html)
