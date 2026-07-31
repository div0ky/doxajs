# Realtime Broadcasting and Commands

This specification defines Doxa's application-facing broadcasting contract, the Keryx server
adapter, and the `@doxajs/realtime` client. It is normative for implementations of the accepted
[Keryx decision](../decisions/0028-keryx-realtime-broadcasting.md).

## Installation and composition

Broadcasting is an optional core module. `doxa add keryx` must:

- install compatible `@doxajs/keryx` and `@doxajs/realtime` packages;
- enable `framework.broadcasting`;
- scaffold the publish secret, listener, topology, and deployment environment;
- add Keryx readiness to generated production health checks; and
- leave `Application.plugins` unchanged.

When broadcasting is enabled, the compiler owns the singleton Keryx provider and its configuration.
Application Features do not declare an `ApplicationBroadcasting` provider and applications do not
select Keryx through the plugin array. The compiled manifest still exposes the ordinary
`broadcasting` provider capability for deterministic inspection and test replacement.

## Event contract

An event opts into queued broadcasting by implementing `ShouldBroadcast`, or synchronous
broadcasting by implementing `ShouldBroadcastNow`. Both capabilities require `broadcastOn()` and may
customize the stable event name and JSON payload with `broadcastAs()` and `broadcastWith()`. The
default event name is the manifest event ID and the default payload is `event.payload`.

`broadcastOn()` returns one or more `Channel`, `PrivateChannel`, or `PresenceChannel` values. Empty,
invalid, or non-JSON results fail the dispatch. Provider types never appear in application events.

`ShouldBroadcast` creates `doxa.queue` work. Inside a Unit of Work that work is written to the
transactional outbox and is not eligible before commit. A rollback discards it. Outside a Unit of
Work it is submitted directly to the selected queue. `ShouldBroadcastNow` calls the selected
broadcast transport in the current execution and propagates transport failures to the dispatcher.
`ShouldDispatchAfterCommit` still controls the event as a whole; Doxa stages queued broadcast work
once and does not duplicate it when after-commit listeners run.

The durable queue envelope ID is the broadcast message ID. Every retry reuses that ID. Keryx
deduplicates accepted IDs for a bounded interval so a lost publish response cannot fan out the same
queue delivery twice.

## Runtime roles and publication topology

`doxa serve` selects the web role. It starts Keryx's WebSocket listener and authenticated internal
publish endpoint in that web process. Keryx may use a separate port, but it is not a third service.

`doxa work` selects a worker-only role. It never starts a public Keryx listener. If the manifest can
broadcast, boot fails closed unless the worker has a publish URL and a shared secret. The worker
sends the exact broadcast envelope to `POST /apps/{applicationId}/events` on a ready web role.
Requests use a timestamped, nonced HMAC-SHA256 signature over the method, exact path, and body
digest. Missing, stale, replayed, or invalid credentials fail before publication. Payload limits
apply before JSON decoding.

The publish URL identifies an internal Keryx origin, not a per-event callback. Generated Compose
wires it to the `web` service automatically. Other platforms provide the equivalent private service
discovery URL once as deployment configuration.

Keryx supports two topologies:

- `single` is valid only when one web replica owns all live sockets. Accepted messages fan out
  directly in that process.
- `redis` is required when web roles are horizontally replicated. Any web replica may accept a
  signed worker publish. An atomic Redis operation deduplicates and publishes it once; every web
  replica consumes the frame and fans out to its local sockets.

Redis also owns distributed presence membership and expiring connection leases. A member joins
globally on its first connection and leaves globally after its last connection or expired lease.
Backplane loss makes Keryx unready, closes live sockets with a retryable service-restart code, and
recreates the complete publisher/subscriber/command connection set. Keryx becomes ready only after
the replacement backplane is subscribed and usable. Web readiness must include `GET /ready`.

## Channels and authorization

Public `Channel` subscriptions require no authorization. `PrivateChannel` and `PresenceChannel`
subscriptions require the `broadcast.subscribe` ability. The policy receives a
`BroadcastSubscriptionResource` containing the exact channel name and kind. Missing policies,
denials, invalid channel names, and kind mismatches fail closed.

Because channel selection may depend on event data, every application containing broadcast events
must declare a policy for `broadcast.subscribe`, even when its current events only use public
channels. This keeps later private-channel edits fail-closed at compilation rather than silently
creating an unprotected subscription path.

Connection admission resolves Doxa authentication once from the WebSocket upgrade request. Every
subscribe and unsubscribe command is then admitted as a fresh Doxa execution using that actor,
authentication, tenant, and connection correlation context. Connection identity is never treated as
an execution scope.

Cookie-authenticated upgrade requests require the same trusted `Origin` validation as unsafe HTTP
requests even though the WebSocket handshake uses `GET`. Upgrade admission must not rotate a browser
session unless the replacement cookie can be returned as part of the handshake; the first-party
adapter authenticates upgrades without rotation and refreshes ordinary session activity instead.
Bearer-authenticated upgrades do not acquire cookie authority from the browser.

A browser-facing Keryx hostname cannot receive a host-only session cookie issued through another
hostname. For that topology, the generated web application exposes `POST /broadcasting/authorize`.
The route uses the already admitted HTTP execution to mint an encrypted admission ticket containing
only the connection admission context. Tickets expire after a short bounded interval, are bound to
the exact browser `Origin` and application ID, and are single-use. They must not appear in a URL.
`@doxajs/realtime` requests the ticket with same-origin credentials and carries it in a
`doxa.ticket.*` WebSocket subprotocol offer alongside the stable `doxa.realtime.v3` protocol. Keryx
echoes only the stable protocol. Single topology records ticket consumption in its web process;
Redis topology consumes the ticket atomically across replicas.

Presence membership exposes only the admitted `ActorRef`. Applications that need public profile data
broadcast a separate, explicitly shaped event; Keryx does not serialize identities, sessions,
credentials, policy decisions, or execution context to clients.

## Realtime command contract

An authenticated client may invoke only a compiled `RealtimeCommand`. The role declares a stable
`id`, non-public `access` ability, Standard Schema `schema`, required `{ limit, windowMs }`
throttle, and an optional `timeoutMs` which defaults to 2 seconds and may not exceed 10 seconds. It
implements `handle(validatedInput)`. Features register commands explicitly in `realtimeCommands`;
folder names carry no meaning. Declaring a realtime command requires Keryx to be enabled so every
compiled command has an authenticated WebSocket ingress and throttle authority.

The compiler rejects duplicate or invalid IDs, public access, missing schemas or throttles,
non-positive throttle values, invalid timeouts, lifecycle capabilities, reachable `ActionBus`
dependencies, and dependency paths to raw transaction, queue, communication, authentication, or
broadcasting providers. Queries carry the same raw mutable-provider restriction, so reading through
`QueryBus` cannot bypass the command boundary. The manifest records the command, access, throttle,
timeout, dependencies, scope, and source. Runtime boot uses only that artifact and its constructor
registry.

Keryx accepts a command only after authenticated `connected` admission. Each frame creates a fresh
execution containing the admitted actor, authentication, tenant, connection correlation, frame
causation, and deadline. Client payloads can never supply actor or authentication facts. Runtime
ordering is schema validation, actor-and-command rolling throttle, application Policy authorization
with the complete validated input as resource, then handler execution. Missing policy coverage and
all denials fail closed. The command deadline bounds that complete pipeline, not only the handler.

Command handlers are transient execution-scoped roles. They are non-transactional and may dispatch
only immediate Signals, local immediate events whose listeners remain local, and
`ShouldBroadcastNow` events. Action, Job, queued listener, queued broadcast, domain-event, journal,
outbox, audit, retry, and replay paths are prohibited. A disconnect prevents acknowledgement
delivery but does not cancel or roll back a handler that already started; its declared deadline
remains authoritative. The acknowledgement may settle at that deadline, but Doxa retains and later
disposes the execution scope only after non-cooperative handler work settles. Cancellation prevents
that late work from entering another Doxa operation. Applications must keep handlers ephemeral and
safe to abandon.

The throttle key is the admitted actor ID plus registered command ID. Single-process Keryx keeps
expiring, bounded buckets; Redis topology consumes the rolling-window decision atomically across
replicas. Rejected attempts do not invoke authorization or the handler. Command observations and
errors must not record payloads, credentials, or Policy resources.

## Wire protocol

Keryx uses strict JSON WebSocket protocol v3. Client frames are `subscribe`, `unsubscribe`, `ping`,
and `command`. Server frames are `connected`, `subscribed`, `unsubscribed`, `event`,
`presence_joined`, `presence_left`, `pong`, `command_ack`, and `error`. Every frame has
`protocol: 3`; earlier protocol versions are not accepted.

A command frame contains a client-generated bounded `id`, registered `command` name, and JSON
`payload`. Exactly one acknowledgement for a handled frame repeats `id` and contains either
`{ ok: true }` or `{ ok: false, error: { code, message, retryAfterMs? } }`. Stable command failure
codes distinguish unknown, unauthenticated, invalid, forbidden, throttled, timed out, unavailable,
and failed commands without exposing internal exceptions. Invalid protocol shape is a connection
error; application command rejection is a nonfatal acknowledgement.

The network transport's `open` event does not mean the Doxa connection is authenticated. Keryx must
install a bounded pending-frame handler before starting asynchronous admission. After authentication
succeeds it sends `connected`, replaces the pending handler with the normal ordered handler, and
drains buffered frames. `@doxajs/realtime` must not send subscription commands until it receives
that valid `connected` frame.

`subscribed` and `unsubscribed` acknowledge channel state. Error frames contain a stable code,
message, retryable flag, fatal flag, operation, and optional channel. Unknown protocol versions,
commands, invalid fields, malformed JSON, oversized frames, pending-buffer overflow, and unsupported
binary data receive an error and close when continuing would be unsafe.

An event frame contains a unique message ID, stable event name, channel, JSON data, and ISO-8601
occurrence time. It contains no transport-native object and no Doxa execution or credential data.

## Client state and reconnect

`@doxajs/realtime` exposes connection state as `idle`, `connecting`, `transport-open`,
`authenticated`, `reconnecting`, or `disconnected`. It exposes each subscription as `pending`,
`subscribing`, `subscribed`, `failed`, `leaving`, or `left`. Current state, the last structured
error, state listeners, and error listeners are public.

The client reconnects non-terminal failures with capped exponential backoff and jitter. It waits for
the new `connected` frame before resubscribing all locally active channels. Authentication rejection
and fatal protocol errors are terminal and do not create an automatic reconnect loop. Connection and
subscription acknowledgement deadlines produce observable errors. Explicitly leaving the final
listener sends `unsubscribe`; explicitly disconnecting disables reconnect.

When `authorizationEndpoint` is configured, each initial connection and reconnect obtains a fresh
ticket before opening the socket. HTTP denial, malformed authorization responses, timeouts, and
transport failures update the same observable connection error and state APIs. Authorization
credentials are requested with `credentials: 'include'`.

`Realtime.command(name, payload)` is available only in authenticated state, never queues or retries,
and resolves to a discriminated success or safe failure result. It uses a unique frame ID and a
bounded acknowledgement timer. The default client timer is 15 seconds so it exceeds the maximum
10-second server execution deadline. Disconnect and timeout settle the local result; a late
acknowledgement is ignored. Clients may abandon ephemeral commands rather than retrying them.

## Delivery, ordering, and failures

Broadcasting is at-most-once from Keryx to each currently connected subscriber. It is not durable
for disconnected clients. Queued broadcast intent is durable until Keryx accepts the publish call;
queue retry and terminal-failure rules apply to transport failures. Applications requiring replay
use a durable query or domain journal and treat realtime delivery as an invalidation or
notification.

Keryx preserves each accepted message ID and makes no global event-order promise across queue
workers or server replicas. Redis publication preserves one accepted fanout for the configured
deduplication interval, not a durable subscriber log. Slow or failed sockets are closed without
failing delivery to healthy subscribers. A server-level publish failure rejects the transport call.
Heartbeats remove dead connections. Shutdown stops readiness, drains active publish calls, closes
sockets, and releases listener and backplane resources.

## Inspection and testing

The manifest records `broadcast: false | queued | now` for every event and complete declared facts
for every realtime command. Observations cover queued, published, subscription, command,
authorization, and failure phases without payload or credential leakage. `FakeBroadcastTransport`
records immutable messages and exposes connection, subscription, command, and throttle helpers so
tests can assert admission and authorization without a WebSocket engine. The first-party harness
admits commands through the runtime rather than calling handlers directly.
