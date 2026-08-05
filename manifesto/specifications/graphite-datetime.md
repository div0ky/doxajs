# Graphite Datetime Contract

- **Status:** Implemented
- **Accepted:** 2026-08-05
- **Depends on:** Node.js 26 runtime, execution context, model persistence, Standard Schema

## Values

Application code imports `Graphite`, `Instant`, `LocalDate`, and `Duration` from `@doxajs/core`.
They are immutable, use the ISO calendar, reject precision finer than microseconds, and serialize
canonically. Graphite couples an exact instant with an IANA zone; changing its zone preserves its
instant. Instant has no presentation zone, LocalDate has no time or zone, and Duration has no
anchor.

Strict parsing must reject invalid fields, invalid zones, non-canonical values, offset/zone
mismatches, DST gaps, and ambiguous local times. Local construction may select `earlier`, `later`,
or `compatible` disambiguation explicitly; rejection is the default.

## Context and clock

Every admitted execution resolves `timeZone` and `locale`, defaulting to `UTC` and `en-US`, and
receives the runtime clock. Clock-relative APIs must fail outside that scope. Explicit values and
comparisons do not require ambient state. Durable context propagation carries locale and time zone,
not clock state.

## Boundaries

HTTP responses use canonical strings through `toJSON`. HTTP requests use explicit Standard Schema
validation; `@doxajs/core/zod` supplies the first-party Zod codecs. Doxa-owned durable JSON uses
versioned tagged values and decodes tags only at trusted framework boundaries.

Database persistence canonicalizes Graphite and Instant to UTC. Managed columns use `timestamptz`;
existing `timestamp without time zone` columns are treated as UTC. Hydrated Graphite values are in
UTC, so an application's durable user or branch zone remains a separate explicit domain value.

Model equality filters, ordering, ranges, and aggregates compare Graphite by its instant. A
zone-only change does not dirty persisted state. LocalDate is calendar-orderable. Duration supports
equality but not ordering in the initial contract.

## Failure behavior

Invalid parsing, unsupported precision, absent clock scope, unsupported model types, incompatible
database columns, and malformed tagged payloads fail with Doxa-owned errors before application work
continues. No boundary silently guesses a time zone or revives an arbitrary string.

## Testing and diagnostics

`DoxaTestHarness` supplies `freezeTime`, `travel`, and `restoreTime`. Conformance covers DST gaps
and folds, historical offsets, leap years, arithmetic across offset transitions, precision,
concurrent execution isolation, HTTP and durable serialization, and PostgreSQL round trips through
both supported timestamp column kinds.

The manifest and Gnosis inspection expose each model attribute's datetime kind and the resolved
application time defaults.

## Non-goals

Graphite does not provide mutable APIs, alias families, natural-language parsing, a format-token
DSL, recurrence, holidays, business calendars, macros, or non-ISO calendars.
