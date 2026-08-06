# HTTP Response Envelopes

- **Status:** Accepted and implemented
- **Accepted:** 2026-07-11

Doxa JSON endpoints have one framework-owned response grammar. Application routes return their
payload; they do not construct the envelope.

```ts
export class ShowUserRoute extends Route {
  async handle(request: HttpRequest) {
    return { user: await User.findOrFail(request.param('id')) }
  }
}
```

The HTTP adapter serializes that payload as:

```json
{
  "ok": true,
  "data": {
    "user": {}
  }
}
```

## Canonical union

```ts
type HttpEnvelope<Payload> =
  | {
      ok: true
      data: Payload
    }
  | {
      ok: false
      code: string
      message: string
      data: null
      details?: unknown
    }
```

`ok` is the discriminant. A successful response has only `ok` and `data`. A failed response always
has a stable machine-readable `code`, a safe human-readable `message`, and `data: null`. Optional
`details` carries standardized structured diagnostics such as validation issues; it never contains
successful domain data or private exception material.

`details` must be JSON-serializable. If application-provided diagnostics cannot be serialized, the
HTTP boundary omits `details` and still returns the canonical failure envelope; error handling never
falls through to an engine-native response while attempting to describe another error.

HTTP status codes retain their normal meaning. The envelope does not turn failures into `200`
responses. Creation may use `201`, accepted work may use `202`, validation uses `422`, and so on.
`Http.created(payload)`, `Http.accepted(payload)`, and `Http.json(payload, status, headers)` exist
for the cases where a route must select status or headers; these helpers still construct the
canonical success envelope automatically.

## Automatic boundary behavior

- The first-party Hono boundary reads request bodies through a byte-counted stream before route
  admission. The default maximum is 1 MiB; applications may deliberately configure
  `maxRequestBodyBytes`. Invalid `Content-Length` receives `400 invalid_content_length`, and a
  declared or streamed over-limit body receives canonical `413 payload_too_large` without running
  application code.
- Any non-`Response`, non-`undefined` route result becomes `{ ok: true, data: result }`.
- Framework and application `HttpError` failures with an integer `400` through `599` status become
  the canonical failure shape. Construction rejects other statuses. The Hono boundary defensively
  sanitizes a malformed or mutated instance to `500 internal_error`.
- Unknown routes, authentication, authorization, validation, persistence conflicts, lifecycle
  refusal, and sanitized internal errors use the same failure shape.
- `undefined` and `Http.noContent()` produce a bodyless `204` response.
- `HEAD`, redirects, files, streams, server-sent events, and third-party webhook acknowledgements
  may return an explicit raw Web Standards `Response` and are not rewritten.
- Returning an explicit `Response` is the visible escape hatch. Ordinary JSON endpoints should
  return payloads directly.

Pagination and collection metadata belong inside successful `data`. Machine clients branch on `ok`
and `code`, never parse `message`, and never need endpoint-specific error object locations.
Generated routes, tests, the Field Guide client, and future Gnosis-generated clients must all use
this contract.
