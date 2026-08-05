# 0003: Build Authentication as a First-Party Doxa Subsystem

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Doxa maintainers

## Decision

Doxa will own authentication as a first-party framework subsystem. Applications will not depend on
Better Auth, Auth.js, Clerk, Auth0, WorkOS, or another authentication product for Doxa's ordinary
identity, credential, and session behavior.

First-party ownership includes the public API, data model, lifecycle, security policy, HTTP flows,
session behavior, errors, audit trail, diagnostics, testing support, migrations, documentation, and
compatibility contract.

Core authentication routes are framework-owned declarations compiled from gitignored `.doxa/`
source. Praxis must never scaffold registration, login, session, token, verification, or recovery
handlers into editable application Features. Applications extend auth through documented events,
policies, templates, mappings, and optional credential plugins rather than forking security flows.

First-party does not mean inventing cryptographic algorithms or casually implementing security
protocols. Doxa will use standards and narrowly scoped, audited primitives behind Doxa-owned
contracts.

## Context

Authentication is both security-critical and deeply connected to the application model. It
establishes the actor and tenant carried through requests, actions, journal entries, jobs, audit
records, and authorization decisions. A third-party authentication framework could introduce
behavior, schema, lifecycle, or upgrade changes on a boundary Doxa promises to keep coherent.

Wrapping a full authentication framework would also reproduce the architectural problem that led
Doxa away from NestJS: the dependency would own important application semantics beneath a
Doxa-branded facade.

Doxa therefore accepts responsibility for the complete authentication contract and for safely
evolving it through framework releases.

## Ownership boundary

Doxa owns:

- Identity, credential, actor, session, and authentication-attempt semantics.
- Registration, login, logout, session rotation, and session revocation.
- Password reset and email-verification flows.
- Authentication requirements for HTTP, actions, jobs, and console operations.
- Authentication event and security-audit records.
- Rate-limit and account-abuse integration points.
- Cookie names, attributes, rotation, expiry, and invalidation policy.
- Default database tables, constraints, indexes, and migrations, plus the semantic contract used
  when an application explicitly maps auth onto existing tables.
- Stable errors that do not disclose whether an account exists.
- Test fakes and assertions such as `actingAs`, `assertAuthenticated`, and `assertSessionRevoked`.
- Diagnostics for configuration, key rotation, session state, and authentication health.

Doxa delegates:

- Password hashing to a standards-compliant Argon2id primitive.
- Randomness, hashing, authenticated encryption, and signature operations to platform cryptography.
- Email transport to the Doxa mail subsystem.
- OAuth, OpenID Connect, and WebAuthn wire-level primitives only where a focused implementation can
  be contained inside an optional Doxa auth plugin with a conformance suite.

Delegated code must not define Doxa's database schema, public types, routes, session model, actor
model, or lifecycle.

First-party ownership does not require duplicating an established application's identity and
credential records. Doxa Auth may explicitly map its identity and credential semantics to existing
tables while continuing to own validation, hashing policy, sessions, bearer tokens, challenges,
abuse controls, audit, and lifecycle. Field mappings are explicit and fail closed;
security-sensitive columns are never inferred. See
[Decision 0023](0023-existing-table-model-auth-mapping.md).

## Initial authentication model

The first implementation will support a deliberately complete core before adding more credential
types:

1. Email and password registration.
2. Email verification.
3. Login with enumeration-resistant failures.
4. Opaque, database-backed browser sessions.
5. Opaque, database-backed bearer access tokens for APIs, CLIs, and automation.
6. Session and token rotation after authentication and privilege changes.
7. Logout, individual credential revocation, and revocation of all sessions and tokens.
8. Password reset using single-use, expiring challenges.
9. Reauthentication requirements for sensitive operations.
10. Security audit events for authentication and credential changes.
11. Doxa-owned test helpers and diagnostics.

OAuth/OIDC, passkeys, multifactor authentication, magic links, API keys, and machine identities are
not part of the core authentication implementation. They may be installed as optional Doxa auth
plugins after the core email/password and session contract is stable.

## Auth plugin contract

An auth plugin adds a credential or authentication ceremony. It does not add a competing identity,
actor, session, or authorization system.

Every plugin must integrate through Doxa-owned extension points for:

- Credential registration and verification.
- Authentication evidence and normalized identity output.
- Schema contributions and reviewed migrations.
- HTTP or console entry points expressed through Doxa manifests.
- Configuration, secret handling, and diagnostics.
- Security events and audit metadata.
- Test fakes and conformance scenarios.

A plugin may return a verified Doxa identity. It must never construct the application `Actor`
directly. The core actor resolver maps that identity, tenant, delegation, and impersonation context
into the same actor representation used by HTTP requests, jobs, console commands, WebSockets, and
other future transports.

Initially, Doxa will ship and support first-party auth plugins only. A third-party plugin API can be
opened later if provenance, compatibility, permissions, migrations, and security review can be made
trustworthy.

Expected optional plugins include:

```text
doxa add auth:oauth
doxa add auth:passkeys
doxa add auth:mfa
doxa add auth:api-keys
doxa add auth:machine
```

Installing a plugin extends the accepted authentication model; it does not replace core Doxa Auth.

## Identities and actors

An authenticated identity is evidence about who presented a credential. An actor is the principal
under which the application executes work. They are related but not interchangeable.

The separation must accommodate:

- A person with multiple credentials.
- A person acting within a tenant or organization.
- A service account or machine identity.
- An administrator impersonating another actor with an auditable reason.
- An anonymous request.
- A queued job continuing work caused by an earlier actor.

Authentication resolves evidence into an identity. A Doxa actor resolver establishes the actor and
tenant placed in the execution context. Authorization evaluates that actor against an action and
resource.

## Session model

The initial browser session will use a high-entropy opaque token in a secure cookie. The database
stores a non-reversible digest of the presented token, not the bearer token itself.

The session contract must define:

- Absolute and idle expiration.
- Rotation and grace behavior.
- Revocation and concurrent-device management.
- Fresh-authentication requirements.
- Session fixation prevention.
- CSRF protection for cookie-authenticated state changes.
- Cookie security attributes and trusted-origin rules.
- Key and secret rotation.
- Actor, tenant, impersonation, IP, user-agent, and audit metadata.

Stateless JWTs are not the default browser session or API credential.

## Bearer access tokens

First-party opaque bearer access tokens are required for the MVP. Browser cookies are not a usable
authentication mechanism for API clients, CLIs, mobile clients, deployment tooling, or ordinary
automation.

The bearer-token contract must define:

- A high-entropy opaque token shown only at issuance.
- Digest-only database storage with stable token identity and a non-secret display prefix.
- Identity ownership, name, creation, expiration, last-used, rotation, and revocation metadata.
- Optional constraints that may narrow authorization but can never independently grant authority.
- The same identity-to-actor resolution used by browser sessions.
- Audit events and safe diagnostics that never reveal token material.
- Explicit rejection of malformed credentials and ambiguous simultaneous authentication methods.

Bearer access tokens represent an existing Doxa identity. API keys and machine credentials that
introduce a service or machine identity remain optional auth plugins. JWTs or externally issued
access tokens may later be supported by a federation plugin, but they do not replace the opaque
first-party token contract.

## Password storage

Doxa will use Argon2id with versioned parameters and per-password random salts. Hash records must
carry enough metadata to verify old parameters and upgrade them after successful authentication.

Password policy accepts 8–64 Unicode characters and favors breached-password defenses, rate
limiting, and secure recovery over arbitrary composition rules. Raw passwords must never enter logs,
events, traces, or durable diagnostics.

The preferred implementation is the Argon2id primitive supplied by Node.js 26.6 and newer. Any
fallback library must be isolated behind the same `PasswordHasher` contract, exactly pinned,
reviewed, and covered by known-answer and upgrade tests.

## Authorization boundary

Authentication establishes an actor. It does not grant domain permission merely because a user,
role, or claim exists.

Doxa authorization policies own decisions such as:

```ts
await policies.authorize(actor, 'orders.update', order)
```

Authentication attributes may inform a policy, but roles embedded in credentials or sessions do not
bypass the policy system. Authentication and authorization will have separate specifications and
test vocabularies.

## Dependency policy

Security-sensitive dependencies are not treated like ordinary conveniences. When a focused
dependency is unavoidable, Doxa will:

- Keep it behind a narrow Doxa-owned contract.
- Pin the exact version in a Doxa release.
- Review upstream changes before upgrading.
- Run protocol, negative-path, and interoperability tests.
- Record security provenance and supported versions.
- Provide a replacement path that does not alter application code or stored semantics.

Owning more code does not automatically make authentication safer. The purpose of first-party
ownership is control over behavior and change, paired with stricter review and conformance—not
avoidance of all external expertise.

## Rejected alternative: Better Auth as the engine

Better Auth integrates well with Hono, Drizzle, and PostgreSQL and provides a broad authentication
feature set. It is rejected as Doxa's foundational authentication engine because its schema,
sessions, endpoints, plugins, and upgrade path would define too much of Doxa's security-critical
application behavior.

Better Auth remains useful comparative evidence when designing flows and conformance cases, but Doxa
will not wrap it as the default implementation.

## Consequences

- Doxa controls authentication behavior, schema evolution, and release compatibility.
- Applications receive one authentication vocabulary aligned with actors, context, policies,
  testing, events, and diagnostics.
- The framework team accepts a permanent security maintenance and incident-response obligation.
- Authentication changes require threat modeling, adversarial tests, migration planning, and
  security review.
- The initial feature set must stay narrow enough to implement and verify rigorously.
- Hosted enterprise identity providers may later integrate through optional federation plugins
  without replacing Doxa identities, sessions, actors, or policies.

## Required implementation proof

Before the authentication subsystem is production-ready, it must demonstrate:

1. Registration, verification, login, logout, reset, rotation, and revocation behavior.
2. Enumeration resistance and uniform external error semantics.
3. Correct Argon2id parameter versioning and transparent rehashing.
4. Session fixation, replay, CSRF, token-theft, and expired-challenge defenses.
5. Atomic consumption of single-use challenges.
6. Rate-limit and abuse-control integration.
7. Key and secret rotation without mass account loss.
8. Security audit coverage without credential leakage.
9. Cross-process correctness under concurrent requests.
10. Doxa-owned fakes that do not weaken production semantics accidentally.
11. Dependency and protocol conformance tests for every delegated primitive.
12. An external security review before a production stability declaration.

## Revisit when

- Doxa cannot sustain the security maintenance and response obligations this decision creates.
- A standards or platform change makes the selected credential or session model unsafe.
- A delegated primitive begins determining Doxa's public behavior or stored semantics.
- A hosted identity requirement cannot be integrated through a plugin without replacing the Doxa
  identity, actor, or session model.

## Implementation evidence

The
[email and password authentication vertical slice](../implementation/email-password-auth-vertical-slice.md)
proves first-party identity and credential tables, Node Argon2id with versioned parameters,
enumeration-equivalent login errors, opaque digest-backed sessions, runtime HTTP actor resolution,
session rotation, explicit-origin CSRF enforcement, revocation, and security audit records. The
[opaque bearer authentication vertical slice](../implementation/opaque-bearer-auth-vertical-slice.md)
adds digest-backed API credentials, constraint propagation, ambiguity rejection, rotation,
revocation, and the same identity-to-actor resolution.

Later authentication-completion, testing, and operational-control slices prove email verification,
password reset, breached-password hooks, durable abuse controls, automatic renewal, bounded
concurrent grace, sensitive-operation reauthentication, testing helpers, pruning, and operator
diagnostics. Crash-process conformance and the mandatory independent pre-1.0 security review remain
release gates rather than application-facing API gaps.

## References

- [Doxa Manifesto: framework boundary](../index.md#the-framework-boundary)
- [Doxa Architecture: execution context](../architecture.md#execution-context)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Web Authentication specification](https://www.w3.org/TR/webauthn-3/)
- [Node.js cryptography documentation](https://nodejs.org/api/crypto.html)
