# Authentication

Doxa Auth owns identities, password credentials, opaque browser sessions, opaque bearer access
tokens, verification and recovery challenges, abuse controls, and security audit records. Feature
code depends only on `Auth` from `@doxajs/core`; PostgreSQL authentication is generated framework
infrastructure.

With no auth identity configuration, Doxa owns the email identity and Argon2id credential tables. An
application can instead select one existing table-backed Model in root `app.config.ts`:

```ts
framework = {
  auth: {
    identity: {
      mode: 'managed',
      model: User,
      identifier: {
        kind: 'email',
        attribute: 'email',
        normalize: { preset: 'email-or-domain', domain: 'example.com' },
      },
      contactEmail: 'email',
      timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
      verification: { mode: 'mapped', attribute: 'emailVerifiedAt' },
      eligibility: [{ attribute: 'active', equals: true }],
      credentials: {
        table: 'users',
        identityId: 'id',
        readers: [
          { preset: 'doxa-argon2id', hash: 'password' },
          { preset: 'bcrypt', hash: 'password' },
        ],
        upgrade: {
          mode: 'in-place',
          format: 'doxa-argon2id',
          password: 'password',
          updatedAt: 'updated_at',
        },
      },
    },
  },
} as const
```

Model fields use logical attributes; credential fields deliberately use physical columns and never
enter ordinary Model state. `login-only` may use either a selected Model or a raw table mapping and
omits registration, verification, recovery, reset, and password-change routes; the corresponding
direct mutation methods also fail closed. Use `doxa auth:storage` or Gnosis
`describe_authentication` to inspect the compiled mapping safely. When the selected identity table
is maintained outside Doxa migrations, its Model declares `static managed = false`; this is separate
from the authentication `mode` shown above.

The public credential API uses `identifier` rather than an `email` alias. Identifiers can be exact,
lowercase, validated email, or email-with-default-domain normalized. Mapped readiness fails closed
unless keys, columns, types, writability, timestamps, credential cardinality, and normalization-
compatible uniqueness are valid.

Every mapped credential reader names one authoritative external password column. Doxa reads its
current value on every password proof, so an external password change takes effect on the next login
or reauthentication attempt. Omitted `credentials.upgrade` and the explicit value `upgrade: 'never'`
both accept configured readers without changing that column. The only automatic upgrade is an
explicit `{ mode: 'in-place', format: 'doxa-argon2id', ... }` policy. It replaces the exact value
that was verified using compare-and-swap in the same transaction as the session and audit writes. A
concurrent password change or any failed write rolls back the transaction and issues no new session
evidence. Enable in-place upgrade only after every application that reads the shared password column
supports Doxa Argon2id records.

The reviewed `sha256-hex` reader is intentionally available for existing unsalted lowercase SHA-256
records. When explicitly configured, a match is accepted for login and current-password proof,
including reauthentication. `doxa auth:storage` and Gnosis report a security warning without
silently disabling the configured flow.

The `email` identifier kind requires `email` or `email-or-domain` normalization; `username` and
`custom` identifiers use `exact` or `lowercase`. Doxa-owned identities include an
`email_verified_at` column. An external identity source enables Doxa email verification only with
`verification: { mode: 'mapped', attribute: '...' }` (or the corresponding raw-table column). When
`contactEmail` or that verification mapping is absent, the compiled identity reports verification as
`unsupported` and omits verification routes. `trusted` is an explicit assertion that an external
authority has already verified the identity; it does not enable Doxa's verification ceremony.

Cookie-authenticated unsafe requests and same-host WebSocket upgrades require a configured trusted
`Origin`. A Keryx listener on another hostname uses the generated same-origin
`POST /broadcasting/authorize` route: it turns the admitted HTTP context into a short-lived,
encrypted, origin-bound, single-use ticket without widening the host-only session cookie. Bearer and
cookie credentials may not be combined. Authentication tables store session, bearer, verification,
and reset credentials as digests. Generated verification and recovery mail currently copies the raw
challenge into durable delivery payloads; that security-release blocker is tracked in the
[2026-07-16 framework security audit](../../manifesto/implementation/security-audit-2026-07-16.md).

Sensitive operations should require a recent password session:

```ts
if (!isRecentPasswordAuthentication(request.context.authentication)) {
  return deny('account', 'fresh_session_required')
}
```

The generated `POST /auth/reauthenticate` route verifies the current password, refreshes the named
live session's `authenticatedAt`, and records a security audit event. It does not create a new
identity, session, or authority model. The default freshness window is 15 minutes; applications may
pass a deliberate alternate window to `isRecentPasswordAuthentication`. A configured SHA-256 reader
is valid current-password proof. Under `upgrade: 'never'` it remains unchanged; under an in-place
policy its exact observed value is upgraded transactionally before the session timestamp is
refreshed.

Opaque bearer credentials accept at most 100 unique authority constraints. Larger grants are
rejected before persistence so credential evaluation remains bounded.

Password changes and resets revoke sessions according to the first-party Auth contract. Applications
should use generated routes and policies as the ordinary path and expose raw Auth methods only when
a transport-specific ceremony has equivalent validation, rate limiting, audit, and origin controls.

## Alpha auth-sidecar re-baseline

Removing alpha mapped-auth sidecar migrations is an explicit pre-1.0 schema re-baseline, not a
compatible forward migration. Recreate prerelease databases, or manually retire any leftover
`doxa_auth_mapped_passwords` / `doxa_auth_mapped_verifications` tables and copy verification state
into the native external column before relying on mapped verification. See
[Upgrading](../upgrading/index.md).
