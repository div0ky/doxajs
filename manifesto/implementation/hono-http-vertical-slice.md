# Hono HTTP Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Incomplete
- **Depends on:** [Class events vertical slice](class-events-vertical-slice.md)

## Outcome

The sixth Doxa implementation proves a real HTTP request through the complete implemented stack:

```text
Node HTTP request
  → private Hono router
  → declared Doxa Route
  → anonymous actor-aware execution context
  → Standard Schema request validation
  → transactional ActionBus dispatch
  → hydrated Model + class events
  → PostgreSQL commit + after-commit listeners
  → normalized Web Standards Response
```

Hono 4.12.29 and `@hono/node-server` 2.0.8 are pinned implementation engines. Application code
imports only `@doxajs/core`; Hono contexts, middleware types, validators, exceptions, and route
builders do not enter the Feature, route, action, model, event, or listener source.

## Authoring experience

One class owns one HTTP endpoint:

```ts
export class IncrementCounterRoute extends Route {
  static id = 'increment-counter'
  method = 'POST'
  path = '/counters/:id/increment'

  private readonly actions = this.inject(ActionBus)

  async handle(request: HttpRequest) {
    const body = await request.validate(Input, await request.json())

    return this.actions.execute(SaveCounter, {
      id: request.param('id'),
      amount: body.amount,
    })
  }
}
```

The Feature declares `routes = [IncrementCounterRoute]`. Folder names remain irrelevant. Routes
receive scoped dependencies through `this.inject()` and normally return only their payload. Doxa
wraps every JSON-compatible value in the canonical `{ ok: true, data }` envelope. `undefined`
produces a 204; an explicit `Response` is the visible escape hatch for streams, files, redirects,
webhooks, or unusual protocol behavior.

`HttpRequest` provides the raw Web Standards `Request` plus path parameters, URL queries, headers,
JSON/text body parsing, and Standard Schema validation. Zod is the pinned documented default, but
the public validation contract does not depend on Zod types.

## Compilation and adaptation

The semantic compiler verifies each declared route's concrete role, stable ID, HTTP method, absolute
path, single `handle(request)` method, dependency graph, and lifecycle restrictions. It rejects
duplicate method/path pairs before boot.

The generated manifest is the only route table consumed by `@doxajs/http-hono`. The adapter
registers those facts with Hono and calls back into the runtime by stable route ID. It never scans
application files or reconstructs ownership.

The transport-neutral `HttpEngine` contract lives in `@doxajs/core`:

```ts
interface HttpEngine {
  fetch(request: Request): Promise<Response>
}
```

`HonoHttpEngine` implements that boundary for direct/serverless fetch usage. `HonoHttpHost` binds a
real Node server, exposes its address, stops admission by closing the listener, waits for active
connections, then shuts down the Doxa runtime. Shutdown is idempotent. It installs no process-global
signal handlers.

## Context and errors

Each matched request creates one Doxa execution scope. In this original proof the HTTP adapter
established an anonymous actor and never trusted identity headers. The later
[email and password authentication vertical slice](email-password-auth-vertical-slice.md) now asks
the runtime to resolve a first-party session before admission. The request signal participates in
execution cancellation. A valid `X-Correlation-ID` is preserved; otherwise the runtime creates one
and returns it as a response header.

The adapter returns the stable `{ ok: false, code, message, data: null, details? }` envelope for:

- Unknown routes: 404 `route_not_found`.
- Missing models: 404 `model_not_found`.
- Invalid JSON: 400 `invalid_json`.
- Standard Schema failures: 422 `validation_failed` with normalized issues.
- Optimistic concurrency: 409 `optimistic_concurrency_conflict`.
- Failed post-durability processing: 500 `after_commit_failed`, explicitly stating that the action
  committed.
- Draining or stopped runtime: 503 `service_unavailable`.
- Unexpected application failures: sanitized 500 `internal_error`.

Unexpected error messages and stack traces do not cross the HTTP boundary. `HttpError` accepts only
integer statuses from `400` through `599`; malformed or mutated instances are defensively reduced to
the same sanitized `500 internal_error` response. Authentication renewal headers are merged without
replacing route-issued cookies, so logout and impersonation cookies stay authoritative while
unrelated cookies coexist.

## Executable evidence

The complete suite contains thirty-three passing tests. HTTP-specific conformance proves:

1. Stable route identities, methods, paths, dependencies, and sources in generated artifacts.
2. Hono dispatch without Hono types in application code or manifest data.
3. Path parameters, JSON parsing, Zod/Standard Schema validation, and response normalization.
4. Anonymous actor context and correlation propagation into local and after-commit listeners.
5. HTTP-to-action-to-model-to-PostgreSQL atomic persistence.
6. Local event failure becomes a sanitized 500 and rolls back the transaction.
7. Stable validation, malformed-body, missing-model, and route-not-found documents.
8. After-commit failure reports that durability already occurred and leaves the committed row.
9. A real ephemeral Node listener serves a request and coordinates idempotent shutdown.
10. The fetch engine rejects new work with 503 after runtime shutdown.

## Deliberate boundary

This proof does not yet claim the complete public HTTP specification. Remaining work includes:

- Authorization middleware. First-party authentication, session cookies, and initial CSRF origin
  policy are completed in the
  [email and password authentication vertical slice](email-password-auth-vertical-slice.md).
- Declarative route groups, prefixes, names, middleware, and API versioning.
- Automatic operation input binding where it is provably unambiguous.
- Resource serialization, content negotiation, streaming, files, and redirects.
- Request body size and upload limits.
- Trusted proxy, host, forwarded-header, CORS, and rate-limit policy.
- Trace-context parsing, structured access logs, and HTTP metrics.
- OpenAPI/schema emission and first-party HTTP test helpers.
- Deadline policy and graceful handling of long-lived streaming connections.

These are specification and hardening requirements, not reasons for Hono concepts to leak into
application code.

## Next slice

Completed: [pg-boss queue and worker vertical slice](pg-boss-queue-worker-vertical-slice.md).
