# Native Impersonation

This specification defines Doxa's opt-in browser-session impersonation contract.

## Configuration and authorization

```ts
framework = {
  auth: {
    impersonation: { enabled: true, sessionSeconds: 3600 },
  },
} as const
```

Enabling capability generates `POST /auth/impersonation` and `DELETE /auth/impersonation`.
Compilation fails closed unless an application Policy or PermissionSource declares
`accounts.impersonate`. Doxa's account policy owns only `accounts.impersonation.stop`, so an active
impersonated session can always restore itself.

Start accepts `{ targetIdentityId, reason }`. It requires a live, recent password session. Reason
must contain 1-500 trimmed characters. Target must be distinct, present, and eligible under the same
compiled identity predicates used for login. Missing, ineligible, self, nested, stale, and
concurrent requests fail without issuing a cookie.

## Session state and execution context

Start atomically rotates current opaque cookie with no grace credential and records target, reason,
start, and bounded expiry on original session. Only token digest is stored. Target passwords and
credentials are never read.

Each admitted execution carries:

- `actor`: target identity;
- `initiator`: original identity;
- `authentication.identityId`: original credential owner;
- `authentication.sessionId`: original session;
- `authentication.impersonationGrantId`: unique activation grant;
- `delegation`: original-to-target hop with activation grant ID, reason, and expiry.

Queue propagation keeps actor, initiator, and delegation attribution but omits browser session ID,
following existing durable execution-context contract. Dispatch snapshots the authorized target,
impersonator, activation grant, reason, and expiry. Already queued work runs with that historical
context after impersonation stops or expires; those transitions prevent new dispatches but do not
cancel durable work.

## Stop, expiry, eligibility, and revocation

Stop atomically clears impersonation state and rotates cookie without grace. Next request is
original user. Absolute, idle, password-change, logout, individual, and all-session revocation rules
continue to apply to owning session.

At HTTP resolution Doxa rechecks original and target eligibility. An activation that expires before
its owning session, or whose target becomes ineligible, is cleared and audited before admitting the
original actor. Owning-session expiry or revocation invalidates the whole session; its activation
fields may remain as historical session metadata. Existing impersonated WebSockets close when
delegation expires, when session revalidation fails before an inbound frame, or during next Keryx
heartbeat. Generated impersonation-enabled applications default that configurable heartbeat to 10
seconds; other generated applications retain Keryx's 30-second default. Closure occurs after the
heartbeat begins and the authentication provider completes revalidation. A stopped or revoked
admission cannot authorize another subscription or realtime command.

Keryx admission tickets encrypt actor, initiator, authentication, and delegation; bind them to exact
origin and application; remain single-use; and expire no later than delegation.

## Audit

`impersonation.started`, `impersonation.stopped`, `impersonation.expired`, and `impersonation.ended`
identify original identity, session, target, and bounded non-secret metadata. Authorization audit
records effective actor, initiator, delegation grant IDs, ability, decision, execution, and
correlation. Cookies, digests, passwords, and ticket material never enter audit.
