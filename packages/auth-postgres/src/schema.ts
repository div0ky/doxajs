import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export interface PasswordParameters {
  readonly algorithm: 'argon2id'
  readonly memory: number
  readonly passes: number
  readonly parallelism: number
  readonly tagLength: number
}

export const authIdentities = pgTable(
  'doxa_auth_identities',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [uniqueIndex('doxa_auth_identity_email_idx').on(table.email)],
)

export const authPasswords = pgTable('doxa_auth_passwords', {
  identityId: text('identity_id')
    .primaryKey()
    .references(() => authIdentities.id, {
      onDelete: 'cascade',
    }),
  version: integer('version').notNull(),
  salt: text('salt').notNull(),
  hash: text('hash').notNull(),
  parameters: jsonb('parameters').$type<PasswordParameters>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const authSessions = pgTable(
  'doxa_auth_sessions',
  {
    id: uuid('id').primaryKey(),
    identityId: text('identity_id').notNull(),
    tokenDigest: text('token_digest').notNull(),
    previousTokenDigest: text('previous_token_digest'),
    previousTokenExpiresAt: timestamp('previous_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    impersonationGrantId: uuid('impersonation_grant_id'),
    impersonatedIdentityId: text('impersonated_identity_id'),
    impersonationReason: text('impersonation_reason'),
    impersonationStartedAt: timestamp('impersonation_started_at', {
      withTimezone: true,
      mode: 'date',
    }),
    impersonationExpiresAt: timestamp('impersonation_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    uniqueIndex('doxa_auth_session_token_idx').on(table.tokenDigest),
    index('doxa_auth_session_identity_idx').on(table.identityId, table.revokedAt),
    index('doxa_auth_session_expiry_idx').on(table.expiresAt, table.idleExpiresAt),
    uniqueIndex('doxa_auth_session_impersonation_grant_idx').on(table.impersonationGrantId),
  ],
)

export const authAccessTokens = pgTable(
  'doxa_auth_access_tokens',
  {
    id: text('id').primaryKey(),
    identityId: text('identity_id').notNull(),
    name: text('name').notNull(),
    displayPrefix: text('display_prefix').notNull(),
    tokenDigest: text('token_digest').notNull(),
    constraints: jsonb('constraints').$type<readonly string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('doxa_auth_access_token_digest_idx').on(table.tokenDigest),
    index('doxa_auth_access_token_identity_idx').on(table.identityId, table.revokedAt),
    index('doxa_auth_access_token_expiry_idx').on(table.expiresAt),
  ],
)

export const authAuditEvents = pgTable(
  'doxa_auth_audit_events',
  {
    id: uuid('id').primaryKey(),
    eventType: text('event_type').notNull(),
    identityId: text('identity_id'),
    sessionId: uuid('session_id'),
    metadata: jsonb('metadata').$type<Record<string, string | number | boolean | null>>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [index('doxa_auth_audit_identity_idx').on(table.identityId, table.occurredAt)],
)

export const authChallenges = pgTable(
  'doxa_auth_challenges',
  {
    id: uuid('id').primaryKey(),
    identityId: text('identity_id').notNull(),
    purpose: text('purpose').notNull(),
    tokenDigest: text('token_digest').notNull(),
    recipientDigest: text('recipient_digest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('doxa_auth_challenge_token_idx').on(table.tokenDigest),
    index('doxa_auth_challenge_identity_idx').on(table.identityId, table.purpose, table.consumedAt),
  ],
)

export const authRateLimits = pgTable(
  'doxa_auth_rate_limits',
  {
    action: text('action').notNull(),
    bucketKey: text('bucket_key').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull(),
    attempts: integer('attempts').notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true, mode: 'date' }),
  },
  (table) => [primaryKey({ columns: [table.action, table.bucketKey] })],
)

export const authSchema = {
  authIdentities,
  authPasswords,
  authSessions,
  authAccessTokens,
  authAuditEvents,
  authChallenges,
  authRateLimits,
}
