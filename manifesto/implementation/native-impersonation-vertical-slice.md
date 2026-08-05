# Native Impersonation Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-08-05
- **Depends on:** Authentication completion, actor execution context, Keryx realtime

## Outcome

Doxa now provides opt-in, policy-authorized native browser-session impersonation without target
credentials. PostgreSQL retains original session authority, records target delegation and audit
evidence, rotates on start/stop, restores automatically, and resolves identical actor attribution
for HTTP and WebSocket cookie admission.

## Evidence

Focused tests cover explicit compiler opt-in, duration validation, permission denial, missing-target
eligibility denial, start and stop rotation, stale-cookie rejection, actor/initiator/delegation
resolution, Keryx admission, live-session revalidation, automatic expiry, restoration, and durable
start/stop/expiry audit rows. Ticket tests cover encrypted delegation round-trip, delegation-bounded
expiry, and rejection of already expired delegation.

Complete repository gate: `pnpm verify`.
