# Realtime Broadcasting Vertical Slice

## Status

Implemented on 2026-07-11 and production-topology proof completed on 2026-07-24 against the
normative [realtime broadcasting specification](../specifications/realtime-broadcasting.md).

## Proven path

- `ShouldBroadcast` and `ShouldBroadcastNow` compile into explicit event manifest facts.
- Queued broadcasts use the existing queue envelope and Unit of Work outbox path; synchronous
  broadcasts publish in the current execution.
- `doxa add keryx` enables the framework-owned singleton provider without changing the application
  plugin list, and generated production configuration wires web and worker roles.
- Keryx admits upgrade requests through Doxa authentication, creates a fresh execution for every
  subscription command, and authorizes private and presence channels with `broadcast.subscribe`.
- Protocol v2 buffers frames during asynchronous authentication, emits `connected` only after
  admission, and makes subscription acknowledgements and structured failures explicit.
- Web roles own sockets and a signed HMAC publish endpoint. Worker-only roles start no listener and
  fail boot when a broadcast-capable application lacks remote publish configuration.
- One web replica fans out locally. Redis topology provides atomic message deduplication,
  cross-replica event fanout, distributed presence leases, readiness loss, socket restart, and
  complete backplane recovery.
- `@doxajs/realtime` provides typed event maps, public/private/presence subscriptions, explicit
  connection and subscription state, structured errors, terminal authentication failure, capped
  jittered reconnect, and post-`connected` resubscription.
- Queued retries reuse the queue envelope ID and Keryx suppresses repeated accepted IDs for a
  bounded interval.
- `FakeBroadcastTransport` proves publish assertions and policy-backed subscription admission
  without an engine.
- Praxis generates queued or synchronous broadcast events and `event:list` reports delivery mode.

## Executable evidence

`tests/broadcasting.test.ts` proves compiler facts, queued and synchronous runtime paths, stable
retry IDs, fake transport assertions, private-channel authorization, delayed authentication,
observable client failures, signed worker publication, tamper/replay/size rejection, worker role
isolation, real Redis fanout and presence across replicas, message deduplication, readiness loss,
and recovery. `tests/praxis.test.ts` proves installation and compiler-owned composition. The
repository verification gate covers package boundaries, publishable declarations, documentation
links, formatting, linting, coverage, and dependency security.

## Deliberate guarantees

Realtime socket delivery is at-most-once and non-replayable. Transactional queued intent remains
durable until the broadcast transport accepts it. Accepted message IDs are deduplicated for a
bounded interval, but Redis Pub/Sub is not a durable subscriber log. Cross-worker and cross-replica
total ordering is not promised.
