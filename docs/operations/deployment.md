# Deployment

Doxa generates one immutable multi-stage image and specializes it by command:

| Role       | Command        | Scaling                           |
| ---------- | -------------- | --------------------------------- |
| Web        | `doxa serve`   | Horizontal                        |
| Background | `doxa work`    | Horizontal; workers and schedules |
| Migration  | `doxa migrate` | One release job                   |

The release order is:

1. Build and publish one image digest.
2. Run `doxa migrate` once from that digest.
3. Promote web and background services from the same digest.
4. Let old replicas drain under Doxa lifecycle deadlines.

## Keryx broadcasting

`doxa add keryx` keeps this role model. Each web replica starts Keryx in the same process on its
configured Keryx port; no additional Keryx service is required. Background replicas start no public
listener and publish to a web replica through an HMAC-authenticated internal endpoint.

Generated Compose sets `DOXA_KERYX_PUBLISH_URL=http://web:6001`, exposes the browser-facing Keryx
port, and checks both application health and Keryx `GET /ready`. On another platform, configure the
publish URL once with the platform's private web-service origin. Give web and background roles the
same `DOXA_KERYX_SECRET`.

When Keryx has a separate public hostname, configure the browser client with the generated
same-origin `POST /broadcasting/authorize` path (including any application proxy prefix). Doxa uses
that existing HTTP path to mint an encrypted, 30-second, origin-bound, single-use admission ticket;
the browser does not need the private worker publish URL. Keep Doxa session cookies host-only and do
not place admission credentials in WebSocket query strings.

Use `DOXA_KERYX_TOPOLOGY=single` with exactly one web replica. Redis is not needed. Before scaling
web horizontally, configure `DOXA_KERYX_TOPOLOGY=redis` and `DOXA_KERYX_REDIS_URL`; Redis
distributes accepted events and presence state to every web replica and atomically consumes
admission tickets. Keep an unready Keryx instance out of both WebSocket and internal publish
routing. Redis loss makes Keryx unready and reconnects browser clients after the backplane recovers.

Runtime roles require prebuilt `dist/` and `.doxa/` artifacts. They do not compile application
source. The production dependency closure omits TypeScript, the compiler, Drizzle Studio, and
optional Theoria tooling unless the application explicitly installs its runtime adapter.

Production Theoria requires the public `production-diagnostics` application profile, explicit
enablement, bounded capture and retention, and protected operator access. It remains complementary
to the production OpenTelemetry, logging, metrics, alerting, and audit paths. See
[Observability, OpenTelemetry, and Theoria](../guides/observability.md).

See the normative
[container deployment specification](../../manifesto/specifications/container-deployment.md).
