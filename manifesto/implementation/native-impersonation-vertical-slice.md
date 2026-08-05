# Native Impersonation Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-08-05
- **Depends on:** Authentication completion, actor execution context, Keryx realtime

## Outcome

Doxa now provides opt-in, policy-authorized native browser-session impersonation without target
credentials. PostgreSQL retains original session authority, records target delegation and audit
evidence, rotates on start/stop, restores automatically, and resolves identical actor attribution
for HTTP, WebSocket cookie admission, and queued delivery. Each activation uses a unique persisted
grant, preventing stopped live authority from reviving after another impersonation starts. Queued
work keeps the actor and attribution accepted at dispatch.

## Evidence

Focused tests cover explicit compiler opt-in, duration validation, permission denial, missing-target
eligibility denial, start and stop rotation, stale-cookie rejection, actor/initiator/delegation
resolution, Keryx admission, live-session revalidation, automatic expiry, restoration, and durable
start/stop/activation-expiry audit rows. Owning-session expiry or revocation invalidates the entire
session and may retain activation fields as historical metadata. Ticket tests cover encrypted
delegation round-trip, delegation-bounded expiry, exact-grant revocation, and rejection of already
expired delegation. Queue tests prove accepted work still runs as the impersonated target after stop
and restart.

Complete repository gate: `pnpm verify`.
