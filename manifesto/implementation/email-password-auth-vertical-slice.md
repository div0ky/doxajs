# Email and Password Authentication Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Incomplete
- **Depends on:** [Hono HTTP vertical slice](hono-http-vertical-slice.md),
  [PostgreSQL durability vertical slice](postgresql-durability-vertical-slice.md), and
  [Actor, Execution Context, and Authorization](../specifications/actor-execution-context-authorization.md)

## Outcome

The ninth Doxa implementation proves the first first-party authentication path end to end:

```text
email + password registration
  → Doxa-owned identity and versioned Argon2id credential
  → opaque browser session issuance
  → digest-only PostgreSQL session storage
  → Hono asks the Doxa runtime to authenticate the Request
  → user Actor + authentication context admitted before route execution
  → session rotation, CSRF origin enforcement, and server-side logout
```

No authentication framework owns Doxa's schema, session semantics, HTTP context, actor, errors, or
upgrade path. Node supplies the Argon2id and random primitives; PostgreSQL and Drizzle remain
private storage mechanics.

## Provider boundary

`Auth` is a Doxa-owned abstract-class port. A selected concrete provider is compiled with the
`authentication` capability, and the compiler permits at most one. Routes inject `Auth` directly;
the Hono adapter knows only that the runtime can resolve a Request into an actor and authentication
context.

The compiler generates the concrete PostgreSQL provider as hidden framework infrastructure.
Application Features inject only `Auth`; root configuration supplies cookie and origin policy:

```ts
framework = {
  auth: {
    secureCookies: false,
    trustedOrigins: ['http://127.0.0.1:3000'],
  },
} as const
```

Production configuration must use secure cookies and explicit HTTPS origins. The insecure cookie
setting exists only for the local HTTP fixture.

## Passwords

Doxa uses Node 26's asynchronous Argon2id primitive with:

- A unique 16-byte random salt per password.
- 19 MiB of memory, two passes, two lanes, and a 32-byte result.
- Versioned parameters stored beside the salt and hash.
- Constant-time hash comparison.
- Transparent rehash after successful verification when the stored version or parameters differ.
- A minimum length of 8 characters and a maximum of 64, without arbitrary composition rules.

Node's current primitive requires parallelism greater than one, so this proof uses two lanes while
retaining OWASP's 19 MiB and two-pass baseline. Raw passwords never enter tables, audit metadata,
events, errors, cookies, or generated artifacts.

Unknown identities perform the same Argon2id derivation against a shared dummy record. Wrong-email
and wrong-password attempts return the same status, code, message, and response shape.

## Identity and sessions

The first schema owns four tables:

- `doxa_auth_identities`
- `doxa_auth_passwords`
- `doxa_auth_sessions`
- `doxa_auth_audit_events`

Registration normalizes email, atomically creates identity and credential records, and appends a
security audit event. Email uniqueness is enforced by PostgreSQL.

Login always creates a new 256-bit opaque token. Only its SHA-256 digest is stored; the bearer token
exists only in the one `Set-Cookie` response. The database session carries absolute and sliding idle
expiry, authentication time, optional client metadata, and revocation state. Application-facing
identity, session, and authentication timestamps are Doxa `Instant` values; PostgreSQL stores UTC
instants and driver-level JavaScript `Date` values remain adapter-private.

The production cookie is host-only and named `__Host-doxa_session`, with `Secure`, `HttpOnly`,
`SameSite=Lax`, and `Path=/`. It is non-persistent in the browser; server-side absolute and idle
expiry remain authoritative. Local plain-HTTP development uses `doxa_session` without `Secure`.

A login performed from an existing authenticated session creates a new session and revokes the old
one. Logout revokes the database session and expires the cookie. `revokeAllSessions(identityId)` is
also part of the first-party service contract.

## HTTP admission and CSRF

Hono authenticates before creating the execution scope. A valid session produces:

- `actor = { kind: 'user', id: identityId }`
- `authentication.state = 'authenticated'`
- identity and session IDs
- password method and single-factor assurance
- the original authentication timestamp

Anonymous and invalid or expired sessions produce the existing anonymous context; request headers
can never claim an identity.

Unsafe cookie-authenticated requests fail closed when `Sec-Fetch-Site` is cross-site. They also
require an exact `Origin` match from the provider's explicit trusted-origin set. SameSite remains
defense in depth rather than the only CSRF control.

## Application experience

The reference feature declares four normal class routes:

```text
POST /auth/register
POST /auth/login
GET  /auth/me
POST /auth/logout
```

Registration and login dispatch password-free application events. `/auth/me` demonstrates that the
framework-wide execution context—not a Hono-local variable—contains the user actor and session
evidence.

## Lifecycle and migrations

Auth constructors remain free of I/O. Explicit `installAuthSchema()` tooling installs the first
migration. Runtime start verifies PostgreSQL and prepares the dummy password record; dispose closes
the pool. Boot never mutates schema.

Manifest format v5 added the authentication provider capability. Authorization later advanced the
required artifact contract to v6; compatibility remains fail-closed.

## Executable evidence

The suite contains forty passing tests. Authentication-specific integration proves:

1. Authentication provider capability and Auth injection in the generated graph.
2. Normalized registration and PostgreSQL-enforced uniqueness.
3. Versioned Argon2id storage without raw-password residue.
4. Enumeration-equivalent invalid credential responses.
5. A 256-bit opaque token with only its digest stored.
6. HttpOnly, SameSite, host-only cookie behavior.
7. Authenticated Request resolution into the Doxa user actor and session context.
8. Session fixation prevention through login rotation.
9. Rejection of an attacker Origin before a cookie-authenticated logout.
10. Trusted-origin logout, server revocation, cookie expiry, and later anonymous resolution.
11. Password-free application events and first-party security audit events.
12. All previous scheduling, queue, HTTP, event, model, and persistence tests remaining green.

## Deliberate boundary

This proof is not production-complete authentication. Still required:

- Opaque bearer access-token issuance, resolution, rotation, and revocation for APIs, CLIs, and
  automation. Completed in the
  [opaque bearer authentication slice](opaque-bearer-auth-vertical-slice.md).
- Email verification and adapter-driven delivery.
- Single-use password-reset challenges and password-change session policy.
- Breached-password checks.
- Rate limiting, lockout/abuse controls, and operational alerting.
- Automatic renewal with a bounded grace window during ordinary long-lived sessions.
- Reauthentication for sensitive operations.
- Synchronizer-token support for server-rendered form workflows.
- Trusted proxy and client-IP policy.
- Auth testing helpers such as `actingAs` and session assertions.
- Diagnostics, metrics, traces, retention, pruning, and operator session management.
- Concurrency, replay, crash-process, migration-upgrade, and parameter-upgrade suites.
- A dedicated threat model, dependency provenance review, and external security review.

Until those are complete, this is evidence for the architecture—not a claim that Doxa Auth is ready
to protect a production system.

## Next slice

Completed next: [opaque bearer authentication](opaque-bearer-auth-vertical-slice.md). Then build
default-deny authorization policies over the shared actor and authentication context.

## References

- [Node.js 26 crypto documentation](https://nodejs.org/docs/latest-v26.x/api/crypto.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
