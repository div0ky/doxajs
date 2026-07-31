# `@doxajs/keryx`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Keryx is Doxa's first-party authenticated WebSocket transport for broadcasting and registered
ephemeral commands. It is an optional core module, not an application plugin or an application-owned
provider.

```sh
pnpm doxa add keryx
```

The command enables `framework.broadcasting`, installs `@doxajs/keryx` and `@doxajs/realtime`, and
generates the provider, environment contract, production port, internal worker publish URL, and
Keryx readiness check. Application events continue to use `ShouldBroadcast`, `ShouldBroadcastNow`,
and channels from `@doxajs/core`.

## Production roles

`doxa serve` starts Keryx in the existing web process. `doxa work` starts no WebSocket listener and
publishes through Keryx's signed internal HTTP endpoint. The generated Compose deployment wires that
URL to `http://web:6001`; other platforms set `DOXA_KERYX_PUBLISH_URL` to their equivalent private
web-service origin.

One web replica uses `DOXA_KERYX_TOPOLOGY=single` and does not need Redis. Multiple web replicas
use:

```dotenv
DOXA_KERYX_TOPOLOGY=redis
DOXA_KERYX_REDIS_URL=redis://redis.internal:6379
```

Every role sharing publication authority must receive the same `DOXA_KERYX_SECRET` with at least 32
characters. Do not expose the internal publish URL or Redis publicly. Route browser WebSockets to
`/app` on the Keryx port and include `GET /ready` in load-balancer readiness.

If the browser reaches Keryx on a different hostname from authenticated application HTTP, use the
generated `POST /broadcasting/authorize` route. The route mints a 30-second, encrypted,
origin-bound, single-use admission ticket. The realtime client presents that ticket in the WebSocket
subprotocol offer, so production does not widen the Doxa session cookie to sibling subdomains or put
credentials in a URL. In Redis topology, ticket consumption is atomic across web replicas.

Keryx protocol v3 waits for Doxa authentication before emitting `connected`. It accepts only
manifest-registered `RealtimeCommand` names, uses the admitted actor, and delegates throttling,
schema validation, declared-ability authorization, deadlines, and safe acknowledgements to Doxa.
Signed publication, bounded message-ID deduplication, admission tickets, Redis fanout, distributed
presence leases, and backplane recovery are framework behavior; applications do not implement a
backchannel.
