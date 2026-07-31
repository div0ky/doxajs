# Realtime Broadcasting Vertical Slice

## Status

Implemented on 2026-07-11, production-topology proof completed on 2026-07-24, and authenticated
realtime-command proof completed on 2026-07-31 against the normative
[realtime broadcasting specification](../specifications/realtime-broadcasting.md).

## Proven path

- `ShouldBroadcast` and `ShouldBroadcastNow` compile into explicit event manifest facts.
- Queued broadcasts use the existing queue envelope and Unit of Work outbox path; synchronous
  broadcasts publish in the current execution.
- `doxa add keryx` enables the framework-owned singleton provider without changing the application
  plugin list, and generated production configuration wires web and worker roles.
- Keryx admits upgrade requests through Doxa authentication, creates a fresh execution for every
  subscription command, and authorizes private and presence channels with `broadcast.subscribe`.
- Protocol v3 buffers frames during asynchronous authentication, emits `connected` only after
  admission, and makes subscription acknowledgements and structured failures explicit.
- `RealtimeCommand` declarations compile into stable manifest entries with schemas, abilities,
  actor-command throttles, deadlines, dependencies, and generated registry constructors.
- Keryx admits registered commands only after authentication. Runtime creates a fresh execution,
  throttles, validates, authorizes with the admitted actor, executes without a writable Unit of
  Work, and returns a bounded safe acknowledgement. Authorization and QueryBus reads retain their
  bounded read-only sessions.
- Command execution rejects Actions, Jobs, durable events, queued listeners, and queued broadcasts;
  immediate local coordination and `ShouldBroadcastNow` remain available.
- The generated same-origin authorization route mints encrypted, origin-bound, single-use admission
  tickets for browser listeners on a separate hostname. Tickets travel in the WebSocket subprotocol
  offer, and Redis coordinates consumption across web replicas.
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
- Praxis generates and lists realtime commands; Gnosis and introspection expose the same bounded
  compiled command facts.

## Executable evidence

`tests/broadcasting.test.ts` proves compiler facts, queued and synchronous runtime paths, stable
retry IDs, fake transport assertions, private-channel authorization, delayed authentication,
observable client failures, cross-origin ticket admission and replay rejection, signed worker
publication, tamper/replay/size rejection, worker role isolation, real Redis fanout, ticket
consumption, and presence across replicas, message deduplication, readiness loss, and recovery.
`tests/realtime-command.test.ts` proves registered compilation, actor provenance without command
enumeration, validation, throttling of invalid authenticated attempts, Policy denial, authorization
audit recording, anonymous rejection, immediate broadcasting, unambiguous rolling-throttle buckets,
privacy-safe handler and Policy failure observations, complete-pipeline deadlines without concurrent
scope disposal, late-work cancellation, and durable-dispatch rejection through nested queries.
`tests/foundation.test.ts` proves commands fail compilation without Keryx and cannot use
constructors, direct role injection, or raw mutable infrastructure providers.
`tests/realtime-client-command.test.ts` proves success, safe failure, observable rejection of
malformed acknowledgements, timeout, late-acknowledgement, and disconnect behavior.
`tests/broadcasting.test.ts` proves distributed Redis throttle authority across replicas.
`tests/praxis.test.ts` proves installation, the generated authorization route, every canonical role
generator including realtime commands, and compiler-owned composition. The repository verification
gate covers package boundaries, publishable declarations, documentation links, formatting, linting,
coverage, and dependency security.

## Deliberate guarantees

Realtime socket delivery and command ingress are at-most-once and non-replayable. Commands own no
writable Unit of Work, produce no command-specific durable record, and are never automatically
retried. Transactional queued intent remains durable until the broadcast transport accepts it.
Accepted message IDs are deduplicated for a bounded interval, but Redis Pub/Sub is not a durable
subscriber log. Cross-worker and cross-replica total ordering is not promised.
