# 0023: Map Models and Authentication to Existing Tables

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Amended:** 2026-07-23
- **Implementation:** Config-driven identity contract and direct table mapping are implemented and
  proven
- **Decision owners:** Doxa maintainers

## Decision

Doxa models and first-party authentication must be able to use existing PostgreSQL tables. Ordinary
single-table models receive Laravel-like static metadata overrides. Authentication uses explicit
table and field configuration because security-sensitive semantics must never be guessed.

This capability is required for adoption in established applications. Running Doxa beside an
existing database is insufficient if teams must copy authoritative users and domain records into
parallel `doxa_*` tables to receive the normal model and auth experience.

## Model experience

The common path should remain on the model and contain no Drizzle objects or SQL:

```ts
export class Customer extends Model<CustomerAttributes> {
  static table = 'legacy_customers'
  static managed = false
  static primaryKey = 'customer_id'
  static versionColumn = 'lock_version'
  static timestamps = false

  static columns = {
    id: 'customer_id',
    displayName: 'display_name',
    active: 'is_active',
  } as const
}
```

Defaults should make mapped declarations smaller:

- Models use Doxa's entity-state storage until `static table` opts into a mapped table.
- Mapped tables are migration-managed by Doxa by default. `static managed = false` opts the table
  out of Doxa/Praxis create, alter, and drop migrations without changing runtime write access.
- `static readOnly = true` independently permits retrieval while rejecting `create()`, `save()`, and
  `delete()` before observers or persistence.
- Primary key defaults to `id`.
- Attribute names map directly unless `columns` overrides them.
- Timestamps default off; `static timestamps = true` maps `createdAt` and `updatedAt` to
  `created_at` and `updated_at`, while an object may override either column.
- Writable mapped models use the declared version column, or PostgreSQL's `xmin` when no version
  column is available. Read-only mappings without a version column compile an explicit `none`
  concurrency source because they never participate in optimistic writes.
- `static table` alone is sufficient when only the table name differs.
- TypeScript-optional logical attributes map an absent value to SQL `NULL` and hydrate SQL `NULL`
  back to an absent attribute. Required attributes whose type explicitly includes `null` retain
  `null`; the compiler records that distinction in the table-storage artifact.

The compiler records and validates the mapping. The runtime still owns hydration, identity maps,
dirty tracking, observers, `save()`, transactions, optimistic concurrency, journal, and outbox.
Changing the table must not downgrade those guarantees.

The compiled model contract is the complete logical attribute set, its physical column projection,
TypeScript type and nullability, primary key, timestamps, version source, relationships, `managed`,
and `readOnly`. It is deliberately not a catalog of the physical database. Every mapped-model read
selects only those declared physical columns. Hydration rejects missing or unexpected fields, and
runtime attribute APIs reject undeclared keys with `UnknownModelAttributeError`. Updates write only
the declared dirty patch recalculated after pre-save observers, plus adapter-owned timestamp and
version columns; they never dehydrate and write back an entire database row.

Read-only models may be queried, eager loaded, paginated, cursor-iterated, aggregated, and
refreshed. In-memory changes are permitted, but `create()`, `save()`, and `delete()` throw
`ReadOnlyModelError` before lifecycle observers or SQL. Views and materialized views must use this
mode until writable-view semantics receive a separate decision.

Composite keys, joined persistence, transformed values, multiple records, and unusual write
procedures use an explicit infrastructure mapper. That mapper is an advanced escape hatch, not
ceremony imposed on every model.

## Authentication experience

Auth mapping belongs in the declaration-only `framework.auth.identity` configuration rather than an
application `User` model appointing itself globally. When the key is absent, Doxa uses its owned
email/password identity tables. When present, the compiler resolves one model-backed or raw-table
identity source into the canonical manifest and the generated PostgreSQL provider consumes only that
artifact. Application Features continue to depend on `Auth`; `PostgresAuth` remains framework
infrastructure.

The model-backed common path names logical attributes while credentials remain a separate,
security-owned mapping and never become ordinary model attributes:

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
        identityId: 'user_id',
        readers: [
          { preset: 'doxa-argon2id', hash: 'password_hash' },
          { preset: 'bcrypt', hash: 'password_hash' },
        ],
        upgrade: {
          mode: 'in-place',
          format: 'doxa-argon2id',
          password: 'password_hash',
          updatedAt: 'updated_at',
        },
      },
    },
  },
}
```

A raw `{ table, columns }` source remains a login-only escape hatch. Managed identity creation
requires a selected Doxa model, uses its normal persistence lifecycle, and may name a registration
factory for extra non-auth attributes. Identity IDs reuse the mapped single-column primary key.

`login-only` has a narrow meaning: Doxa reads an existing identity and its externally authoritative
credential, verifies a configured format, and may issue Doxa-owned sessions or access tokens. It
does not register identities, issue or consume recovery challenges, change or reset passwords, or
mutate verification state. The compiler omits those routes, and the PostgreSQL provider rejects
equivalent direct mutation calls. Eligibility and verification mappings continue to fail closed.

The public credential input is `identifier`, not `email`. One configured identifier kind and
normalization preset governs login, registration, recovery, rate-limit buckets, and uniqueness.
Contact email is separately mapped and may be absent; email verification and recovery routes are
then omitted. Verification is a three-state contract (`verified`, `unverified`, `unsupported`).
Doxa-owned identities persist verification in `doxa_auth_identities.email_verified_at`; external
identity mappings must explicitly name a native verification attribute to enable Doxa's verification
ceremony. When that mapping is absent, verification is `unsupported`. An explicitly trusted external
state remains available for identity sources whose own verification is authoritative, but it does
not enable Doxa's ceremony.

Session, bearer-token, challenge, abuse, and audit tables continue using Doxa defaults unless they
are explicitly mapped. An application may therefore reuse its existing user and password records
without also adopting a legacy session design.

Auth configuration must validate required columns, uniqueness, nullability, hash format, identifier
compatibility, and writable operations before readiness. It must never infer password, verification,
revocation, or authority fields merely because a column has a familiar name.

Credential readers are reviewed first-party presets. Doxa supports its versioned Argon2id record,
bcrypt variants used by Laravel, Argon2id PHC records, and an explicitly weak lowercase SHA-256
legacy reader. Configuring `sha256-hex` explicitly accepts a matching credential anywhere the
mapping permits current-password proof, including login-only login and reauthentication. Diagnostics
must warn that unsalted SHA-256 is weak without silently making the configured flow unusable. Mapped
login retains the dummy Argon2id work factor alongside format-specific verification so weak readers
do not make known-account failures observably cheap.

External credential mappings have exactly one authoritative password column. Every configured reader
names that same column, Doxa reads its current value on every password proof, and an external
password change takes effect on the next attempt. Doxa never copies an external credential into
auxiliary mapped-auth storage or prefers historical Doxa state over the current external value.

Credential upgrade policy is explicit in the compiled artifact. Omission resolves to
`{ mode: 'never' }`, which is the ordinary compatibility default and never mutates the external
credential. The only automatic upgrade policy is an explicitly configured in-place Doxa Argon2id
replacement of the same authoritative column. It requires a `doxa-argon2id` reader for that column
and validates the relation, identity key, password column, type, nullability, writability, storage
capacity, and optional timestamp column before readiness. Applications sharing that column must all
understand Doxa Argon2id before enabling the policy.

After a legacy credential verifies under an in-place policy, Doxa replaces the exact observed value
with Argon2id using compare-and-swap semantics in the transaction that creates or refreshes the
session and records the audit event. A concurrent external password change, failed upgrade, failed
session write, or failed audit write rolls the transaction back and issues no new authentication
evidence. Managed external authentication requires this writable in-place policy because managed
registration, password change, and recovery necessarily mutate the authoritative credential.

Mapped verification attributes are Auth-owned. Ordinary model code may read but not write them.
Identifier and contact-email changes are normalized through the compiled contract, and contact-email
changes invalidate verification and outstanding challenges. Eligibility predicates are checked for
every cookie, bearer, password, and sensitive credential resolution; an ineligible identity fails
closed and revokes all Doxa sessions and tokens.

## Migration management rules

- Praxis migrations create only Doxa-owned session, token, challenge, abuse, and audit tables for an
  external identity mapping. Doxa never creates a mapped identity, credential, or verification
  relation. Removal of alpha mapped-auth sidecar migrations is an explicit pre-1.0 re-baseline that
  requires recreating prerelease databases or operator-owned cleanup of leftover sidecar relations.
- A mapped model is `managed = true` by default. `managed = false` excludes its relation from
  Doxa/Praxis migration management. Management does not imply write access; `readOnly` is the
  independent persistence setting.
- The existing reviewed SQL migration workflow remains authoritative. Model declarations do not
  generate DDL automatically.
- PostgreSQL readiness inspection is read-only. It validates relation existence, declared columns,
  type/nullability compatibility, the single-column primary key, timestamp/version sources,
  generated-column safety, view mode, and whether a writable model can insert without supplying
  undeclared required columns. Catalog lookups preserve exact quoted mixed-case and schema-qualified
  relation names. `Graphite` and `Instant` attributes are compatible with PostgreSQL `timestamptz`
  and `timestamp` columns; the latter is always read and written as a UTC wall value. `LocalDate`
  requires `date`, while `Duration` uses canonical ISO text. PostgreSQL-driver `Date` values remain
  adapter-private and hydrate to the declared Doxa value. Because PostgreSQL does not preserve
  reliable `NOT NULL` metadata on views, strict hydration rejects actual null values for required
  declared view attributes.
- Additional columns, indexes, checks, and foreign keys outside the declared model projection are
  not imported into the manifest or Gnosis and do not fail readiness unless an undeclared required
  column makes inserts impossible.
- Destructive or lossy conversion requires an explicit reviewed migration or import command.
- Existing rows receive the same auth audit and application execution semantics as Doxa-owned rows.

## Required proof

1. A model with only `static table` hydrates, mutates, saves, refreshes, and deletes existing rows.
2. Key, column, timestamp, version, and optional-attribute overrides retain observer, dirty-state,
   and concurrency semantics.
3. Advanced multi-record mappers remain an explicit post-MVP extension point.
4. Auth can register through a mapped model and authenticate against mapped identity and credential
   tables without exposing credential columns as model attributes.
5. Auth can map identities while retaining default Doxa session, token, challenge, and audit tables.
6. Unknown password formats fail closed; bcrypt, Argon2id PHC, explicitly enabled SHA-256, and Doxa
   Argon2id readers have known-answer and negative-path proof.
7. Missing mapped columns, invalid identifiers, incompatible types/nullability, non-unique
   normalized identifiers, and non-writable managed mappings fail before readiness.
8. Praxis reports `managed` and `readOnly` independently.
9. PostgreSQL and first-party memory adapters select, hydrate, expose, dirty, and update only
   declared attributes; unrelated password, token, vendor, and trigger-maintained columns remain
   untouched.
10. Login-only route generation omits unsupported identity and credential mutation flows.
11. Praxis and Gnosis expose safe mapping metadata but never credential values.
12. Read-only models support every model read path and reject create, save, and delete before
    observers and persistence.
13. External password changes immediately control the next login and reauthentication attempt; no
    auxiliary credential record is read or written.
14. Omitted and explicit `never` policies accept configured SHA-256 without mutation, while an
    in-place policy upgrades the observed value atomically and never overwrites a concurrent change.
15. Login-only direct mutation methods fail closed, while managed and Doxa-owned authentication
    retain their supported registration, recovery, and password-mutation behavior.
16. An external mapping without a native verification column compiles as `unsupported`, omits Doxa
    verification routes, and creates no auxiliary verification relation.

## Relationship to permissions

First-party roles and permission storage are deferred in
[Decision 0022](0022-defer-first-party-permissions.md). Existing-table mapping landed first; the
application permission source accepted by [Decision 0034](0034-application-permission-sources.md)
now integrates established role and membership schemas without making them Doxa-owned storage.
