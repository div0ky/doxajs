# Doxa Security Model and Threat Assessment

- **Scope:** Doxa MVP server runtime and first-party adapters
- **Reviewed:** 2026-07-16
- **Rule:** Framework convenience may remove ceremony, never an authorization or durability
  boundary.

## Protected assets

Doxa protects password verifiers, session and bearer credentials, verification and recovery
challenges, application secrets, identity and authorization records, tenant boundaries, entity
state, journal facts, queued work, communications content, provider credentials, and causal
telemetry. Raw credentials are more sensitive than identifiers and must never enter storage, logs,
manifests, diagnostics, or error responses.

## Trust boundaries

Untrusted HTTP input crosses the Hono adapter into a Doxa-admitted execution. Browser cookies,
bearer headers, signed provider callbacks, queue envelopes, environment configuration, and compiled
artifacts are separate boundaries. PostgreSQL is trusted for durability but its contents are not
assumed secret from operators; this is why opaque credentials are stored as digests. SendGrid and
Twilio are external delivery systems and receive only provider-required message data.

The generated JSON manifest is inert and readable without code execution. The constructor registry
is executable and must match its manifest build hash and supported format versions before boot.

## Threats and controls

| Threat                                      | First-party control                                                                                                                                                                       | Executable evidence                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Credential database disclosure              | Argon2id password records; SHA-256 digest-only opaque session, bearer, verification, and reset records                                                                                    | Challenge-table assertions require digests; the current audit records an open delivery-ledger violation |
| Account enumeration                         | Equivalent login failure and recovery responses; dummy Argon2id verification                                                                                                              | Known/unknown negative HTTP tests                                                                       |
| Brute force and recovery abuse              | Durable hashed identifier buckets, bounded windows, temporary blocks, `429` and `Retry-After`                                                                                             | PostgreSQL abuse-control tests; the current audit records the missing trusted client-IP input           |
| Session fixation or replay                  | Cryptographic tokens, rotation, bounded previous-token grace, revocation on password change/reset                                                                                         | Rotation, concurrent grace, old-token, logout, and revocation tests                                     |
| Impersonation abuse or lost attribution     | Explicit application grant, recent password session, eligible target, rotated credential, actor/initiator/delegation audit, bounded expiry, and restoration                               | HTTP, Keryx, audit, denial, expiry, and restoration tests                                               |
| Stale authority for sensitive operations    | Password reauthentication refreshes one live session; policies enforce a bounded freshness window                                                                                         | Stale denial, password verification, refresh, and security-audit tests                                  |
| CSRF or cross-site WebSocket credential use | Trusted-origin checks plus encrypted, origin-bound, single-use admission tickets for separately addressed Keryx listeners                                                                 | Hostile-origin, ticket replay, HTTP, and WebSocket admission tests                                      |
| Confused credential authority               | Cookie plus bearer is rejected; bearer constraints only narrow authority                                                                                                                  | Ambiguity and constraint-denial tests                                                                   |
| Missing or bypassed authorization           | Every entry role declares `public` or an ability; permission sources and policies compile; missing owners deny                                                                            | Compiler diagnostics and default-deny tests                                                             |
| Stale or over-broad application permissions | Permission-source grants are catalog-bounded, cached only within one execution, and never serialized                                                                                      | Source integrity, execution-boundary, credential-precedence, and denial tests                           |
| Cross-resource access                       | Explicit resource policy authorization narrows source grants with the current actor, tenant, and credential constraints                                                                   | Owner/non-owner policy tests and durable decisions                                                      |
| Stale asynchronous authority                | Dispatch snapshots actor and attribution without credentials or permission results, rechecks application permissions per attempt, and treats stop or expiry as a future-dispatch boundary | Queue stop/restart durable-context regression                                                           |
| Ghost jobs or notifications                 | Queue, journal, entity, and delivery handoffs share the action transaction                                                                                                                | Rollback and visibility tests                                                                           |
| Forged provider delivery updates            | Exact-body SendGrid ECDSA verification and timestamp window; canonical Twilio HMAC verification                                                                                           | Valid, malformed, stale, and duplicate webhook fixtures                                                 |
| Artifact substitution                       | Application identity, manifest version, build hash, and constructor registry compatibility fail closed                                                                                    | Compiler/runtime compatibility tests                                                                    |
| Secret leakage through framework telemetry  | Structured allowlisted attributes, `SecretString`, provider-independent errors, safe operator views                                                                                       | Redaction assertions and boundary audit                                                                 |
| Prompt, message, or customer PII capture    | AI observation types omit content fields; sanitization remains defense in depth                                                                                                           | AI observation contract and absence assertions                                                          |
| Unauthorized production debugger access     | Explicit production profile, protected operator identity, authorization, proxy trust, and access audit                                                                                    | Non-loopback authentication and audit integration tests                                                 |
| Denial during shutdown                      | Admission closes before drain; bounded lifecycle deadlines; cancellation and full cleanup aggregation                                                                                     | Lifecycle and active-worker drain tests                                                                 |

## Security invariants

- Authentication proves identity; authorization independently decides authority.
- Impersonation never changes credential ownership: target is actor; original user remains initiator
  and authenticated identity.
- Bearer credentials are opaque, one-time visible grants. They are not JWTs and carry no trusted
  client-readable claims.
- Optional dependencies never silently weaken a required security control.
- Constructors perform no I/O. Security-sensitive startup and teardown participate in bounded
  lifecycle phases.
- Queue and schedule executions receive fresh scopes. Serialized authentication is bounded
  attribution, not a credential or cached permission result. Explicit delegated authority is fixed
  at accepted dispatch; each attempt re-evaluates current application permissions without
  revalidating the originating browser activation.
- Diagnostics expose identity and record identifiers, states, and timestamps, not credentials,
  digests, secrets, message bodies, or cache values.
- Theoria binds to loopback by default. Non-loopback access fails closed without an explicit
  production diagnostics profile, authenticated operator boundary, and access audit sink.
- AI observations exclude prompts, completions, tool payloads, SMS bodies, phone numbers, and
  customer PII by construction.

## Supply-chain and provenance posture

The MVP uses a frozen pnpm lockfile and exact root toolchain versions. Application-facing packages
own their contracts; Hono, Drizzle, pg-boss, Argon2 primitives, SendGrid, and Twilio remain behind
adapter packages. `pnpm audit:boundaries` fails when reference application code imports a vendor
runtime directly. `pnpm audit:docs` verifies local knowledge-base links. Release artifacts must be
built from the reviewed lockfile and publish only declared package output and migrations. Ordinary
feature pull requests own comprehensive behavioral verification. A generated version commit records
one coordinated release candidate; trusted publication checks out that immutable commit, rebuilds
and inspects its package artifacts, and refuses mismatched versions, package sets, internal
dependencies, provenance configuration, or alpha tags.

## Release gate

The current internal status is recorded in the
[2026-07-16 framework security audit](implementation/security-audit-2026-07-16.md). Its critical and
high findings block a public security-stability claim until the governing decisions and
implementations are reconciled.

This assessment and the automated negative suite are the MVP internal review. Before a public
security-stability claim or 1.0 release, maintainers must obtain an independent review of auth,
authorization, webhook verification, queue recovery, package provenance, and denial-of-service
limits. Findings are release blockers according to severity; the existence of that external gate
does not transfer first-party ownership of these controls to another package.
