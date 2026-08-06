# Framework Security Audit — 2026-07-16

- **Scope:** Compiler, runtime, Hono admission, PostgreSQL authentication and persistence, queue and
  schedule execution, communications, realtime, Theoria, Praxis, Gnosis, telemetry, and first-party
  provider adapters
- **Method:** Contract-to-implementation tracing, hostile-input and trust-boundary review, focused
  regression tests, production dependency audit, and repository verification
- **Result:** Not security-release-ready

This is an internal adversarial audit, not the independent review required by the
[security release gate](../security.md#release-gate). The review traced untrusted input through
admission, authorization, persistence, asynchronous resumption, external delivery, diagnostics, and
failure responses. It also reviewed authentication timing and rate controls, CSRF and WebSocket
origin enforcement, webhook verification, SQL construction, secret redaction, artifact integrity,
and dependency provenance.

## Open release blockers

### Critical — raw verification and reset secrets are persisted in delivery records

The authentication challenge table correctly stores only a SHA-256 digest. The generated auth action
then reveals the token into a `MailMessage`; `dispatchCommunication` serializes that complete
message into both `doxa_delivery_messages.payload` and the durable queue envelope. A database or
queue disclosure can therefore recover any live verification or password-reset token directly. The
persistence suite currently demonstrates the exposure by reading the token back from the delivery
table to complete verification and reset.

This violates the framework invariant that raw credentials never enter storage. The correct repair
needs a settled durable-delivery contract: either envelope encryption with key identity, rotation,
and operational recovery, or a deliberately non-durable/specially protected challenge delivery path.
Ordinary redaction or hashing cannot work because the provider eventually needs the plaintext
message. No local implementation change is made until that public durability and key-management
decision is accepted.

## Open hardening risk

### Medium — generated auth routes do not provide a trustworthy client-IP bucket

The PostgreSQL auth service supports combined identifier and IP metadata for login, recovery, and
reauthentication abuse buckets. Generated routes supply only the user agent. Per-identifier limits
still work, but an attacker can vary unknown identifiers and repeatedly trigger the dummy Argon2id
path without a cross-identifier client bucket. Correct handling requires a trusted-proxy and remote
address contract at the HTTP boundary; accepting `X-Forwarded-For` directly would create a spoofing
bypass.

## Remediated findings

- **Queue admission:** Added a required context version and strict validation of actors, delegation,
  tenant, authentication metadata, constraints, dates, locale, trace identifiers, and bounded span
  links before tracing or application execution.
- **Queued delegated authority (resolved 2026-08-06):** The accepted actor and queue contracts now
  make dispatch-time authority snapshots explicit. Each attempt re-evaluates current application
  permissions, while stop or expiry blocks future dispatch without rewriting already-accepted work.
  The existing runtime and durable-context regression match that contract.
- **HTTP denial of service:** Added byte-counted request-body admission with a 1 MiB default,
  configurable maximum, and canonical `400`/`413` failures for malformed lengths and over-limit
  streams.
- **Sensitive reauthentication (superseded 2026-07-23):** The earlier blanket denial of login-only
  SHA-256 current-password proof was removed by the authoritative external credential contract. An
  explicitly configured SHA-256 reader now verifies login and reauthentication. Omitted or explicit
  `never` leaves the external value unchanged; in-place Argon2id upgrade is compare-and-swap
  protected and transactional with session and audit persistence.
- **Bearer policy cost:** Access-token grants reject more than 100 authority constraints.
- **Theoria disclosure:** Invalid queries receive a safe `400`; unexpected failures no longer expose
  exception text. JSON responses add no-sniff, no-referrer, and no-store protections.

## Verification evidence

- `pnpm audit --prod --audit-level=moderate` — no known production dependency vulnerabilities.
- Focused Hono and queue negative tests cover declared and streamed body limits plus unsupported
  queue-context versions.
- Focused PostgreSQL tests cover bounded bearer constraints and the superseding weak-hash
  reauthentication and upgrade policy.
- `pnpm verify` passed in full: formatting, lint, type checks, Field Guide and website production
  builds, 183 coverage tests, architecture boundaries, documentation links, Changesets status,
  package archives, and the production dependency security audit.

The remaining critical release blocker stays intentionally visible. Passing automated verification
confirms the implemented hardening and documentation consistency; it does not convert those
architectural findings into an acceptable security posture.
