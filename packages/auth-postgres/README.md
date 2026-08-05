# `@doxajs/auth-postgres`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Framework-owned PostgreSQL authentication for Doxa: existing identity models, Argon2id credentials,
opaque browser sessions, opaque bearer tokens, verification and recovery challenges, durable abuse
controls, opt-in native impersonation, audit evidence, and existing-table mapping.

```sh
pnpm add @doxajs/auth-postgres
```

The package includes forward-only authentication migrations. Review the repository security policy
before production use; Doxa is currently pre-1.0.

Mapped authentication treats the configured external password column as the only credential
authority. `credentials.upgrade` defaults to `never`; the only writable policy is an explicit
in-place Doxa Argon2id replacement using compare-and-swap in the session/audit transaction. Password
and verification state never use auxiliary mapped-auth tables. External identity mappings enable
Doxa email verification only by explicitly mapping a native verification timestamp column; otherwise
that flow is disabled. Dropping the alpha sidecar migrations is a pre-1.0 re-baseline: recreate
prerelease databases or manually retire leftover mapped-auth sidecar tables.

Applications configure authentication through `framework.auth.identity` in root `app.config.ts` and
import only `Auth` from `@doxajs/core`. The concrete adapter is intentionally available from
`@doxajs/auth-postgres/framework` for generated framework code and migration from older alpha
applications. Direct `PostgresAuth` imports from the package root must move to that framework
subpath; direct table mappings should move into the compiled application configuration.

Native impersonation uses `framework.auth.impersonation`. It rotates the owning opaque session on
start and stop, records target/reason/expiry, preserves original identity as initiator and
authentication evidence, and reuses compiled target-eligibility predicates. Applications must
declare and grant `accounts.impersonate`; Doxa provides no default administrator grant.
