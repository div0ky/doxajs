# 0037: Provide Native Session Impersonation

- **Status:** Accepted
- **Accepted:** 2026-08-05
- **Decision owners:** Doxa maintainers

## Decision

Doxa owns administrator impersonation as an opt-in extension of its opaque browser-session model.
Applications authorize `accounts.impersonate`; Doxa validates the authenticated session and target,
rotates the session credential, records the delegation, admits the target actor, and restores the
original actor when impersonation stops or expires.

## Contract

- Start requires a recent password-authenticated browser session and an application authorization
  grant for `accounts.impersonate`.
- Target identity must exist, differ from the impersonator, and satisfy configured auth eligibility.
  Nested impersonation is rejected.
- PostgreSQL retains the original session owner and stores target, reason, start, and expiry on that
  session. Start and stop rotate the opaque cookie immediately without target credentials.
- Execution uses target as `actor`, original user as `initiator`, original identity as
  authentication evidence, and one auditable delegation hop between them.
- Start, stop, automatic expiry, target-ineligibility termination, authorization decisions, and
  session revocation remain durable audit evidence.
- HTTP and Keryx use the same resolved context. Keryx tickets preserve delegation, never outlive it,
  and live sockets revalidate before frames and during bounded heartbeats.
- Stop restores original actor. Expiry or target ineligibility clears impersonation without
  restoring target authority. Ordinary session revocation invalidates the whole session.

## Boundary

Impersonation is disabled unless `framework.auth.impersonation` is configured. Doxa supplies no
default grant and no first-party administrator-role table. Application permission sources or
policies decide who may start it. Bearer tokens cannot start impersonation, and impersonation never
issues credentials owned by target.

## Rejected alternatives

- Asking for target password destroys audit attribution and credential separation.
- Copying target claims into a JWT prevents authoritative expiry and revocation.
- Replacing original session loses safe restoration authority.
- Application-specific middleware creates divergent HTTP and WebSocket identities.

## Consequences

Doxa gains one coherent actor/delegation model across transports and durable work. Applications must
choose a strict `accounts.impersonate` grant and operational reason policy. Live WebSocket
revocation is bounded by next client frame or configured Keryx heartbeat when no frame is flowing.

See [Native impersonation](../specifications/native-impersonation.md).
