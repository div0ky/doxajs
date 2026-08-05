# Authentication Completion Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-10
- **Security qualification:** Blocked by the 2026-07-16 delivery-at-rest finding

Doxa's first-party email/password method now includes registration, login, verification,
verification resend, password recovery, password change, browser-session listing/revocation, and
opaque bearer-token management.

Verification and reset challenges use 256-bit opaque tokens. The authentication challenge table
stores only SHA-256 digests, purpose, identity, expiry, and consumption time. Issuing a replacement
consumes earlier active challenges; successful use is transactional and single-use. HTTP never
returns challenge material. Doxa queues it through the first-party `Mailer` action and transactional
outbox. The current communication implementation also persists the raw mail payload, including the
challenge, in the delivery ledger and queue envelope. That violates the framework's
credential-at-rest invariant and is a critical open finding in the
[2026-07-16 framework security audit](security-audit-2026-07-16.md). Challenge grants expose expiry
as a Doxa `Instant`; PostgreSQL stores the corresponding UTC instant.

Recovery requests return the same empty `202` response for known and unknown addresses. Login,
registration, and recovery use durable hashed abuse buckets with fixed windows, temporary blocks,
stable `429` responses, `Retry-After`, and security audit events. Unknown-login password derivation
still uses the shared Argon2id dummy record. A production application may provide a breached-
password callback; compromised values fail with a stable provider-independent error.

Password reset and password change replace the Argon2id record and revoke active browser sessions.
Account routes can list and revoke only the current identity's sessions. Sensitive account/session
operations require a fresh password-authenticated session through the default-deny account policy.

Active browser sessions rotate their 256-bit opaque token after the renewal interval. The database
atomically moves the former digest into a bounded previous-token slot and returns the replacement
cookie through Doxa's authentication result. Concurrent in-flight requests may use the former digest
during grace; it is rejected afterward. Raw current and previous tokens are never stored.

Praxis lists identities, sessions, and bearer tokens without hashes or raw material, revokes
sessions/tokens with audit records, and prunes expired challenges, rate buckets, and old sessions.

The PostgreSQL/HTTP proof covers token secrecy, expiry/replay behavior, queued delivery, recovery
privacy, old/new password behavior, session revocation, and rate limiting. Session renewal-grace
concurrency, replay, and operator behavior are covered by the executable proof.
