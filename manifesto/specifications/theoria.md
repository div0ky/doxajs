# Theoria

Theoria is Doxa's optional first-party execution debugger. Its base product contract is defined by
[decision 0025](../decisions/0025-first-party-theoria-debugger.md), with supported production
diagnostics defined by [decision 0031](../decisions/0031-production-theoria.md).

## Initial observation vocabulary

Each immutable observation contains:

- A unique observation ID and occurrence timestamp.
- `kind`, semantic `name`, status, duration when applicable, and stable role ID when applicable.
- Execution, source-execution, correlation, causation, trace, span, parent-span, and span-link
  identifiers.
- Actor kind and opaque ID, tenant ID, and transport.
- Sanitized JSON attributes and a normalized sanitized error.

The initial kinds are `execution`, `http`, `action`, `query`, `transaction`, `model`, `event`,
`broadcast`, `listener`, `reaction`, `signal`, `job`, `schedule`, `authorization`, `cache`, `mail`,
`sms`, `log`, and `exception`, plus the AI kinds defined by the
[AI observation specification](ai-observations.md). Adding a kind is backward-compatible; changing
the meaning of an existing kind is not.

Correlation and causation identifiers are opaque bounded text. Trace and span identifiers use the
W3C hexadecimal representation. Theoria never assumes an externally supplied correlation ID is a
UUID.

## Default retention

The development defaults retain seven days and at most 50,000 observations. Both are configurable.
Manual pruning is deterministic. Automatic pruning is best-effort and never participates in an
application transaction. The PostgreSQL recorder checks the bound after every 500 writes and
`doxa theoria:prune` enforces it on demand.

The `production-diagnostics` profile uses explicit hot and optional warm retention tiers, time
partitioning, batched bounded capture, and an operator-selected maximum. Overflow never delays
application work and is reported through recorder-health telemetry.

## UI contract

The dedicated host defaults to `127.0.0.1:4400`. It provides:

- A newest-first execution list.
- Filters for status, transport, actor, kind, and text.
- One ordered causal timeline per execution and correlation chain.
- A hierarchical span waterfall grouped by execution and asynchronous transition.
- Links between producer and worker executions.
- Sanitized JSON detail for each entry.
- Stable role IDs and source provenance when the application manifest provides them.

Automatic refresh preserves the selected execution and observation plus each pane's scroll position.
Only explicit filter, search, or navigation changes replace the operator's current context.

The browser UI is read-only in the initial implementation. Queue retries, token revocation, and
other mutations remain explicit Praxis operator commands.

The timeline and waterfall are complementary. The waterfall explains nested latency; the timeline
retains instantaneous semantic facts and business causality that are not spans.

## Production access

Loopback remains the default. Non-loopback binding is available only in an explicitly enabled
`production-diagnostics` profile with authenticated operator identity, authorization, access
logging, and explicit proxy trust. Theoria does not silently reuse application business middleware.

Production configuration controls capture sampling and filters, pending-buffer capacity, overflow
policy, batch size and interval, storage pool, partitions, retention tiers, and protected access.
Trusted-proxy access requires explicit proxy-address and operator allowlists; a forwarded identity
header from any other peer is denied.

The dedicated host returns safe, stable JSON errors and never serializes internal exception
messages. Invalid query pagination receives `400 invalid_query`; unexpected failures use the generic
`500 theoria_error`. JSON responses disable sniffing, referrer disclosure, and caching.

The primary rail is an activity feed, not merely a list of parent executions. `All` exposes each
terminal or instantaneous observation as its own entry, so an event dispatched during HTTP work is
visible as an event rather than hidden behind the HTTP execution. Category filters select literal
observation kinds: `Events` selects `event`, `Queue` selects `job`, and `Schedules` selects
`schedule`. A schedule causes an ordinary queue job; it never changes that job's transport from
`job` to `schedule`.

## Developer workflow

`doxa add theoria` adds the package, generates the application provider, and registers it in the
Infrastructure Feature. `doxa migrate` applies the namespaced table, `doxa theoria` opens the
dedicated explorer, and `doxa theoria:prune` enforces retention. Gnosis reports whether the
observation capability is installed, the stable vocabulary, and its safety posture.
