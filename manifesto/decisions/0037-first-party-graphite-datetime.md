# 0037: Provide First-Party Graphite Datetimes

- **Status:** Accepted
- **Accepted:** 2026-08-05
- **Decision owners:** Doxa maintainers

## Decision

Doxa application code uses immutable `Graphite`, `Instant`, `LocalDate`, and `Duration` values from
`@doxajs/core`. Node.js 26's native Temporal implementation performs calendar, time-zone, and
duration arithmetic behind that Doxa vocabulary. Doxa ships no Temporal polyfill or third-party date
engine.

`Graphite` represents an exact instant viewed through an IANA time zone. `Instant` represents only
the exact UTC timeline point. `LocalDate` represents an ISO calendar date without a time or zone.
`Duration` represents an ISO duration. JavaScript `Date` is not a supported application model or
framework-boundary type; explicitly named legacy conversion remains an escape hatch.

## Clock and context

Clock-relative operations use the active admitted Doxa execution. The execution supplies a clock,
IANA time zone, and locale; application defaults are `UTC` and `en-US`. Calling `Graphite.now()`,
`Instant.now()`, `LocalDate.today()`, or a relative predicate without an active execution fails
clearly. Parsing, conversion, formatting with explicit inputs, and comparison remain usable outside
an execution.

`@doxajs/testing` owns clock mutation. Its harness can freeze, travel, and restore time without
putting test-only controls on the production programming surface.

## Persistence

Database persistence stores exact instants in UTC. A `Graphite` value's time zone is application
view context and does not create a hidden zone column. Hydration returns the same instant viewed in
UTC; application code deliberately applies a user, branch, tenant, or other domain zone with
`inTimeZone()`.

Managed PostgreSQL schemas use `timestamptz`. Existing `timestamptz` and
`timestamp without time zone` columns are supported without a new column; the latter is read and
written strictly as a UTC wall value. Doxa PostgreSQL connections use a UTC session time zone.
Domain time-zone identifiers remain explicit application-owned fields when they need durability.

`LocalDate` maps to `date`. `Duration` maps to canonical ISO text. Doxa timestamps such as
`createdAt` and `updatedAt` use `Instant`.

## Serialization

- `Graphite` uses RFC 9557 text containing its offset and bracketed IANA zone.
- `Instant` uses RFC 3339 UTC text.
- `LocalDate` uses `YYYY-MM-DD`.
- `Duration` uses ISO 8601 duration text.
- HTTP input becomes a Doxa datetime only through an explicit validation schema.
- Doxa-owned durable payloads use versioned type tags so queues, events, outbox messages, cursors,
  and entity state rehydrate values without guessing arbitrary JSON.

All values accept at most microsecond precision. Finer input fails rather than silently truncating
beyond PostgreSQL's precision.

## Deliberate surface

The first release includes strict construction and parsing, immutable arithmetic, boundaries and
rounding, comparison, common calendar predicates, differences and humanization, IANA-zone
conversion, Intl-based formatting, and explicit conversions.

It does not include mutable variants, Carbon-style aliases, natural-language parsing, a custom
format-token language, macros, recurrence, holiday calendars, business calendars, or non-ISO
calendar support. Those require demonstrated application need.

## Required proof

1. Offset/zone mismatch, DST gap, and ambiguous-fold inputs fail closed unless disambiguation is
   explicit.
2. Concurrent executions isolate clocks, locales, and time zones.
3. PostgreSQL `timestamptz` and UTC `timestamp` round trips preserve the exact instant without a
   zone sidecar.
4. HTTP and Doxa-owned durable messages use their declared canonical representations.
5. The compiler rejects JavaScript `Date` model attributes.
6. Test time travel affects admitted test work only.

## References

- [Node.js 26 release](https://nodejs.org/en/blog/release/v26.0.0/)
- [Public package surface](0018-public-package-surface.md)
- [Existing-table mapping](0023-existing-table-model-auth-mapping.md)
- [Actor and execution context](../specifications/actor-execution-context-authorization.md)
