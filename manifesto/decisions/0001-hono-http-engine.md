# 0001: Use Hono as the Initial Private HTTP Engine

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Doxa maintainers

## Decision

Doxa will use Hono with its Node.js adapter as the initial engine for HTTP routing and request
mechanics. Doxa's public HTTP contract will be framework-owned and grounded in Web Standards
`Request` and `Response` objects.

## Context

Doxa needs a capable HTTP implementation without placing a second application framework beneath its
own kernel. The engine must handle routing and middleware mechanics while allowing Doxa to own
controllers, validation, authentication, authorization, execution context, errors, resources,
testing, lifecycle, and diagnostics.

Hono is focused on HTTP and uses Web Standards across its supported runtimes. That makes it a good
implementation engine for a Doxa-owned transport contract rather than a competing application model.

## Boundary

Application and feature code must not depend on:

- Hono contexts or environment types.
- Hono middleware, validators, or exceptions.
- Hono route builders or RPC types.
- Hono-specific testing APIs.

Doxa will compile its HTTP manifest into Hono registrations inside an adapter. The foundational
engine contract remains:

```ts
export interface HttpEngine {
  fetch(request: Request): Promise<Response>
}
```

An explicit low-level escape hatch may expose Web Standards objects. It must not expose a Hono
context.

## Integration responsibilities

The Hono adapter will:

- Register routes produced by the Doxa HTTP manifest.
- Translate requests into Doxa execution contexts.
- Invoke the Doxa middleware and action/query pipelines.
- Translate Doxa responses and error documents into `Response` objects.
- Coordinate admission, readiness, draining, and shutdown with the application lifecycle.
- Provide adapter conformance tests without becoming the public testing vocabulary.

## Alternatives considered

### NestJS

Rejected as the kernel foundation because it owns the application graph, dependency injection,
modules, controllers, middleware, guards, pipes, interceptors, filters, lifecycle, discovery, and
testing conventions that Doxa must own itself.

### H3

Not selected initially. H3 remains a credible future engine because it is focused and composable,
but Hono provides the more settled initial foundation. The adapter boundary preserves the option to
revisit this choice.

### Nitro

Rejected as the kernel. Nitro may eventually host a Doxa Web Standards handler, but Doxa will not
adopt Nitro's application model, routing, plugin lifecycle, or configuration as its own.

## Consequences

- Doxa must design and maintain its own HTTP manifest and adapter conformance suite.
- Hono upgrades are absorbed through Doxa releases rather than application code.
- Application code remains portable across future HTTP engines that satisfy the contract.
- Some useful Hono capabilities may require deliberate Doxa APIs before applications can use them.
- Node.js 26 is the hosting runtime, but the public HTTP model does not unnecessarily depend on
  Node.js.

## Revisit when

- Hono can no longer implement the Doxa HTTP contract without leaking engine concepts.
- Another engine materially improves correctness or operability while passing the same conformance
  suite.
- A supported deployment environment cannot host the Hono adapter.

## Implementation evidence

The [Hono HTTP vertical slice](../implementation/hono-http-vertical-slice.md) proves compiled
Doxa-owned routes, Web Standards request/response handling, Standard Schema validation, actor-aware
runtime admission, normalized failures, direct fetch usage, and a real lifecycle-owned Node listener
without exposing Hono to application code.

## References

- [Doxa Manifesto: Hono is the initial HTTP engine](../index.md#hono-is-the-initial-http-engine)
- [Hono Web Standards documentation](https://hono.dev/docs/concepts/web-standard)
