# Existing-Table Model and Authentication Mapping

- **Status:** Implemented MVP common path
- **Implemented:** 2026-07-10
- **Hardened:** 2026-07-23
- **Manifest format:** 9
- **Decision:**
  [Map models and authentication to existing tables](../decisions/0023-existing-table-model-auth-mapping.md)

## Outcome

Doxa can adopt an existing PostgreSQL schema without replacing authoritative domain or user tables.
The ordinary experience stays class-first and Laravel-like: a model declares physical metadata, then
uses the same `find()`, mutation, `save()`, `refresh()`, and `delete()` APIs as any other Doxa
model.

```ts
export class Customer extends Model<CustomerAttributes> {
  static override readonly id = 'customer'
  static override readonly table = 'legacy_customers'
  static override readonly managed = false
  static override readonly primaryKey = 'customer_id'
  static override readonly versionColumn = 'lock_version'
  static override readonly timestamps = true
  static override readonly columns = {
    id: 'customer_id',
    displayName: 'full_name',
    active: 'enabled',
  } as const
}
```

`static table` opts a model into table mapping. The primary key defaults to `id`, attributes map to
same-named columns unless overridden, timestamps default off, and optimistic concurrency uses
PostgreSQL `xmin` when no explicit version column exists on a writable model. Read-only models
without a version column compile `none` and use a stable non-concurrency read version. `managed`
defaults true and controls only Doxa/Praxis migration management; `readOnly` defaults false and
independently controls persistence. Mapping metadata is compiled into the canonical manifest;
folders and runtime reflection remain irrelevant.

The PostgreSQL adapter quotes every compiler-validated identifier and retains the normal model
contract: execution identity, hydration, dirty tracking, observers, journal/outbox staging,
transactional commit, and optimistic-concurrency failures. It never copies mapped state into
`doxa_entity_states`. Readiness resolves exact quoted mixed-case and schema-qualified relation
names. `Graphite` and `Instant` attributes accept `timestamptz` or `timestamp`; all writes persist
the exact UTC instant, `timestamp` is interpreted strictly as a UTC wall value, and Graphite
hydrates in UTC without a zone sidecar. `LocalDate` accepts `date`, `Duration` accepts canonical ISO
text, and PostgreSQL-driver `Date` values remain private to the adapter.

Every mapped read now uses the explicit physical projection compiled from the full declared logical
attribute set. Adapter hydration rejects missing and unexpected fields. Runtime attribute access
rejects undeclared keys, and updates dehydrate only the declared dirty patch recalculated after
pre-save observers. Extra password, token, vendor, generated, and trigger-maintained columns are
neither model state nor write-back candidates.

## Authentication mapping

Root application configuration selects an existing identity Model and logical attributes:

```ts
framework = {
  auth: {
    identity: {
      mode: 'managed',
      model: User,
      identifier: {
        kind: 'email',
        attribute: 'email',
        normalize: { preset: 'email' },
      },
      contactEmail: 'email',
      timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
      verification: { mode: 'mapped', attribute: 'emailVerifiedAt' },
      credentials: {
        table: 'user_credentials',
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
} as const
```

Identity IDs are opaque text rather than assumed UUIDs. Identity and password data may share one
external table or use separate external tables. Browser sessions, bearer tokens, challenges, abuse
controls, and audit records remain in Doxa-owned tables, preserving secure framework semantics
without forcing an established application to replace its users table.

The configured external password column is the sole credential authority. Omitted or explicit
`never` upgrade policy verifies in place without mutation. Explicit in-place upgrade uses
compare-and-swap and shares one transaction with session and audit persistence; it never overwrites
a concurrent external password change. Doxa does not create auxiliary mapped-auth relations.
Doxa-owned identities persist verification in their native `email_verified_at` column, while
external mappings must provide their own writable verification column or compile with verification
unsupported.

The compiler resolves logical attributes to physical storage in the authentication artifact. Mapped
columns are checked during lifecycle readiness. Missing or incompatible columns, composite keys,
unsafe uniqueness, unwritable managed fields, and duplicate credential rows prevent readiness.
Credential fields remain Auth-owned mappings and never enter ordinary model state.

## Inspection and AI knowledge

`doxa model:list` reports each model's physical table, management mode, read-only mode, key, and
concurrency source. `doxa auth:storage` reports which auth records are externally mapped and which
remain Doxa-owned. The model storage contract is also emitted in `.doxa/gnosis.json`, so Gnosis can
make safe changes without inferring persistence from filenames or application code.

## Executable evidence

The PostgreSQL conformance suite proves:

1. Existing mapped rows hydrate, mutate, save, refresh, and delete.
2. Explicit version columns and implicit `xmin` both detect competing writes, while read-only
   mappings without a version column expose `none` rather than implying write concurrency.
3. Journal and outbox records commit atomically while generic entity-state rows remain absent.
4. Registration, email verification, cookie login, bearer resolution, password change, and auth
   audit work with an arbitrary external text identity ID.
5. Readiness validates only the relation and declared persistence contract, rejects unsafe writable
   views and impossible inserts, and tolerates unrelated additional columns.
6. The first-party memory transaction manager preserves strict projection, patch writes, and
   read-only behavior.
7. Praxis and Gnosis expose declared mapping, management, and read-only metadata without unrelated
   physical columns.
8. Read-only models retain find, query, aggregate, relationship, eager-load, pagination, cursor, and
   refresh behavior while rejecting create, save, and delete before observers and writes.
9. Mixed-case and schema-qualified mapped relations pass every catalog lookup, declared Doxa
   datetime values round-trip through supported PostgreSQL types in UTC, and read-only views use
   `none` without a writable version column.
10. Login-only SHA-256 verification works with omitted and explicit `never`, sees external password
    changes immediately, and denies registration, verification, recovery, and password mutation.
11. In-place bcrypt and SHA-256 upgrades replace only the exact observed authoritative value,
    atomically persist the session and audit event, and issue no session after a compare-and-swap or
    transaction failure.
12. External auth mappings without a native verification column compile with verification
    unsupported and have no runtime, compiler, manifest, or migration-selection auxiliary relation.

Multiple identity realms, separate auth databases, permission mapping, OAuth, MFA, and application-
defined hashers remain explicit future work.
