# Opaque Bearer Authentication Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Incomplete
- **Depends on:** [Email and password authentication](email-password-auth-vertical-slice.md)

## Outcome

Doxa now authenticates APIs, CLIs, and automation without misusing browser cookies or adopting JWTs
as a framework default:

```text
password-authenticated session issues token once
  → doxa_pat_<public-id>_<256-bit-secret>
  → PostgreSQL stores only SHA-256 digest and safe metadata
  → Authorization: Bearer resolves the existing Doxa identity
  → the same user Actor enters the execution context
  → token constraints follow queued causal work
  → rotation or revocation invalidates the old credential
```

## Contract

Each token owns a stable non-secret ID, name, display prefix, identity owner, sorted constraints,
creation, absolute expiration, last-used time, revocation time, and a digest. The plaintext is
returned exactly once as a `SecretString` and never appears in listing APIs, events, audit metadata,
or database state. Public token timestamps are Doxa `Instant` values and persist as UTC instants;
PostgreSQL-driver `Date` values do not cross the adapter boundary.

Constraints can only narrow later authorization. They do not grant a permission, role, tenant, or
actor. Bearer evidence resolves through the same identity-to-actor boundary as browser sessions.

Token management requires a password-authenticated browser session. The reference feature exposes:

```text
POST   /auth/tokens
GET    /auth/tokens
POST   /auth/tokens/:id/rotate
DELETE /auth/tokens/:id
```

Supplying a cookie and Authorization header together fails with `ambiguous_credentials`; Doxa never
silently chooses which authority applies. Malformed, expired, rotated, and revoked tokens share one
stable invalid-credential response.

## Durable authority propagation

Bearer `credentialId` and constraints are part of the immutable authentication context. Queue
envelopes preserve them with actor, initiator, tenant, and causation so asynchronous work cannot
silently gain authority after leaving HTTP.

## Evidence

The suite contains forty-one passing tests. The bearer test proves issuance, format and entropy,
digest-only storage, actor resolution, constraint visibility, ambiguity rejection, management
reauthentication, atomic rotation, revocation, last-use update, and audit coverage against real
PostgreSQL and Hono execution.

## Remaining authentication work

- Email verification and password recovery.
- Breached-password and abuse-control integrations.
- Session renewal grace and sensitive-operation reauthentication policy.
- Auth fakes, concurrency/replay/crash suites, diagnostics, and external review.

## Next slice

Build default-deny authorization using the shared actor and credential constraints across every
execution entry point.
