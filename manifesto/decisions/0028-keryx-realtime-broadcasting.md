# 0028: Name Doxa's Realtime Transport Implementation Keryx

- **Status:** Accepted
- **Accepted:** 2026-07-11
- **Amended:** 2026-07-16 — Publication alone does not imply external stability during controlled
  adoption
- **Amended:** 2026-07-24 — Framework-owned composition, authenticated worker publishing, protocol
  v2 readiness, and Redis replication
- **Amended:** 2026-07-25 — Origin-bound admission tickets for separately addressed browser
  listeners
- **Amended:** 2026-07-31 — Authenticated, application-declared ephemeral realtime commands and
  protocol v3
- **Scope:** Optional post-MVP core WebSocket broadcasting and ephemeral-command capability
- **Decision owners:** Doxa maintainers

## Decision

Doxa's first-party WebSocket and broadcasting server implementation will be named **Keryx**. The
server package will be `@doxajs/keryx`. The browser and other subscriber-facing API will be
published as `@doxajs/realtime`; it will not receive a second product name.

Application code uses the Doxa concept **broadcasting**. It does not depend on Keryx types or names.
`ShouldBroadcast` and `ShouldBroadcastNow` retain their already accepted event semantics; Keryx is
the transport implementation that delivers those broadcasts. Realtime clients express subscriptions
and received events through the same Doxa broadcasting contract.

Keryx is an opt-in core module, not an application plugin. `doxa add keryx` enables
`framework.broadcasting`, installs the server and client packages, and lets the compiler generate
the singleton broadcasting provider. Applications do not declare an `ApplicationBroadcasting`
subclass or add Keryx to `Application.plugins`.

The web role owns Keryx's public WebSocket listener and authenticated internal publish endpoint in
the existing web process. A worker-only role never starts a public listener. It sends broadcasts to
the web role through the signed internal endpoint; generated Compose wiring supplies that internal
URL, so the default deployment does not require a third service or a manually copied endpoint.

One web replica can fan out directly. Horizontally replicated web roles require Keryx's Redis
topology: workers publish once to any ready web replica, Redis replicates accepted events and
presence state, and every web replica fans out to its local sockets. Redis is therefore conditional
infrastructure for Keryx replication, not a requirement for the standard one-web-replica topology.

Protocol v2 makes authentication readiness explicit. A WebSocket transport opening is not
subscription permission. Keryx installs its frame buffer before asynchronous authentication, sends
`connected` only after admission succeeds, and only then may `@doxajs/realtime` subscribe.

Protocol v3 adds one deliberately bounded client-originated direction. Applications may declare a
`RealtimeCommand` with a stable command ID, Standard Schema payload, non-public ability, required
rolling throttle, and bounded execution timeout. The compiler records those facts in the manifest;
Keryx rejects every unregistered command. Each accepted command creates a fresh Doxa execution from
the socket's admitted actor, consumes an actor-and-command throttle, validates its payload, resolves
the declared ability through Doxa authorization composition, and only then calls `handle()`. When a
resource Policy is selected, the complete validated input is its resource. The client receives one
bounded `command_ack` success or safe failure envelope.

Realtime commands are authenticated and ephemeral. They create no command-specific durable, journal,
outbox, retry, or replay record; Doxa still records the mandatory authorization decision through its
normal authorization audit and telemetry path. They own no writable transaction or Unit of Work;
authorization and QueryBus reads may open bounded read-only sessions. They may synchronously emit
existing immediate broadcasts, but cannot dispatch Actions, Jobs, durable events, queued listeners,
or queued broadcasts. Durable business mutation remains an Action admitted over HTTP. The compiler
also prevents commands from reaching raw transaction, queue, communication, authentication, or
broadcasting providers through their dependency graph. Queries carry the same raw mutable-provider
restriction so QueryBus cannot be used to escape the command boundary. Disconnection and missing
acknowledgement are ordinary loss; the client never queues or automatically retries a command.

When the browser-facing Keryx listener has a different hostname from the application's authenticated
HTTP origin, the generated web role exposes `POST /broadcasting/authorize`. The already
authenticated HTTP execution mints a short-lived, encrypted, origin-bound, single-use admission
ticket. `@doxajs/realtime` presents it in the WebSocket subprotocol offer; Keryx selects only the
stable protocol name and never echoes the credential. A single web replica consumes tickets locally.
Redis topology consumes them atomically across replicas.

_Keryx_ is the Greek word for a herald: an exact role name for a component that announces
application events without becoming the application's event model.

## Context

Laravel separates Reverb, its WebSocket server, from Echo, its JavaScript subscription client. Doxa
needs the same separation between the application-level broadcasting vocabulary and the replaceable
transport beneath it, but does not need two branded concepts for a single capability.

The manifesto reserves Laravel-aligned broadcast capabilities while deferring WebSocket and
broadcasting support from the MVP. It also requires one dominant vocabulary and delegates WebSocket
protocols and server mechanics to adapters. A name must therefore identify the first-party server
without leaking its native API into actions, events, listeners, or browser code.

## Boundary

- `@doxajs/keryx` owns the first-party server adapter, connection lifecycle, protocol integration,
  signed publish ingress, optional Redis replication, presence leases, and delivery implementation,
  as defined by the
  [realtime broadcasting specification](../specifications/realtime-broadcasting.md).
- `@doxajs/realtime` owns the client API for Doxa subscriptions and ephemeral commands.
- Doxa core owns event capabilities, authorization integration, execution-context creation, typed
  broadcast contracts, fakes, and diagnostics.
- Application code speaks in terms of events, channels, subscriptions, broadcasting, and registered
  realtime commands; it never imports Keryx engine types or invents frames.
- Framework composition may import Keryx, but application Features and plugin declarations may not
  own or replace the generated first-party provider.
- A Keryx connection authenticates at connection admission, but each admitted message creates a
  fresh Doxa execution as required by the actor and execution-context specification.
- The package names do not select a protocol engine or make broadcasting necessary for the MVP
  reference flow. The normative runtime specification defines protocol, authorization, presence,
  reconnect, ordering, delivery, and failure behavior.

## Alternatives considered

- **Keryx plus a separately branded client:** rejected. It duplicates product vocabulary where
  `realtime` clearly describes the client capability.
- **A generic server package such as `@doxajs/realtime-server`:** rejected. It lacks a distinct,
  memorable implementation identity alongside Praxis, Theoria, and Gnosis.
- **A borrowed Laravel name such as Echo or Reverb:** rejected. Doxa should have its own public
  identity and must not imply Laravel compatibility or shared implementation.
- **Expose Keryx as the application programming model:** rejected. This would let transport
  machinery define application semantics, contrary to the adapter boundary.
- **Start Keryx in every runtime role:** rejected. A worker listener has no browser connections and
  creates the original process-local delivery contradiction.
- **Always require Redis:** rejected. A single web replica already owns every live socket and needs
  only the signed worker-to-web publish path.
- **Run an extra Keryx-only service by default:** rejected. The opt-in core module can safely own a
  second listener in each web process, while retaining explicit role and health boundaries.
- **Share the host-only session cookie across deployment subdomains:** rejected. Widening cookie
  scope weakens sibling-host isolation and conflicts with `__Host-` cookie guarantees.
- **Put an admission credential in the WebSocket URL:** rejected. Query strings are routinely
  retained by browser history, reverse-proxy access logs, and observability systems.
- **Application-defined Keryx frames or unrestricted socket RPC:** rejected. Both bypass compiled
  identity, schema validation, authorization, throttling, safe failures, and inspection.
- **Reuse Actions for socket ingress:** rejected. It would disguise an unreliable, non-transactional
  transport as a durable mutation boundary.

## Consequences

- Documentation has one application-facing term: broadcasting.
- Application features remain provider-independent, while the opt-in first-party composition is
  framework-owned and intentionally opinionated.
- Realtime clients remain discoverable by purpose and avoid a second term developers must learn.
- Production deployments with one web replica need a shared secret and internal service URL but no
  Redis. Generated Compose supplies the URL; other platforms configure their private service
  discovery value.
- Production deployments with multiple web replicas require Redis and must include Keryx `/ready` in
  readiness routing.
- A separately addressed browser listener uses the generated same-origin authorization route; it
  does not require a shared cookie domain or an application-authored authorization endpoint.
- Protocol v2 browser clients and signed worker publishers are deliberately incompatible with
  protocol v3. Adoption is a coordinated cutover across web replicas, worker roles, and browser
  clients; mixed v2/v3 fleets are unsupported.
- Keryx is a public package name, but alpha publication alone does not create external compatibility
  or support commitments.
- Broadcasting remains optional for applications and outside the MVP viability bar, while its
  implemented runtime behavior is a conformance-tested contract within each coordinated Doxa
  release. It earns production compatibility obligations when a supported application relies on it.

## Required implementation proof

Keryx's specification and implementation proof must show:

1. Authenticated connection admission and channel authorization use Doxa's actor and policy model.
2. Every admitted inbound message receives a fresh execution scope with correct causal context.
3. Broadcasts preserve the accepted queued, synchronous, transaction, journal, and outbox semantics.
4. Browser clients receive typed Doxa broadcast contracts without Keryx engine-type leakage.
5. Doxa-owned fakes and diagnostics can inspect and assert subscriptions, authorization, broadcasts,
   delivery failures, and reconnect behavior.
6. Protocol and server engines are replaceable behind conformance tests.
7. Registered commands prove actor provenance, validation, authorization, throttling, deadlines,
   safe acknowledgements, and rejection of durable dispatch.

The
[realtime broadcasting vertical slice](../implementation/realtime-broadcasting-vertical-slice.md)
provides this executable proof.

## References

- [Doxa principles](../principles.md)
- [MVP scope](../mvp.md#deferred-from-the-mvp)
- [OOP and container](0011-class-first-oop-container.md#role-classes-and-capability-traits)
- [Actor and execution context](../specifications/actor-execution-context-authorization.md)
- [Framework name](0027-doxajs-framework-name.md)
