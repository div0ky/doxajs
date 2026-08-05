import { readFile } from 'node:fs/promises'

import { Pool } from 'pg'

export const DOXA_AUTH_MIGRATION_URL = new URL('../migrations/0001_doxa_auth.sql', import.meta.url)
export const DOXA_AUTH_INFRASTRUCTURE_MIGRATION_URL = new URL(
  '../migrations/0000_auth_infrastructure.sql',
  import.meta.url,
)
export const DOXA_AUTH_CHALLENGE_BINDING_MIGRATION_URL = new URL(
  '../migrations/0003_challenge_recipient_binding.sql',
  import.meta.url,
)
export const DOXA_AUTH_IMPERSONATION_MIGRATION_URL = new URL(
  '../migrations/0004_native_impersonation.sql',
  import.meta.url,
)

/** Explicit migration helper for tests and tooling. Runtime boot never mutates schema. */
export async function installAuthSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString })
  try {
    for (const migration of [
      DOXA_AUTH_MIGRATION_URL,
      DOXA_AUTH_CHALLENGE_BINDING_MIGRATION_URL,
      DOXA_AUTH_IMPERSONATION_MIGRATION_URL,
    ]) {
      await pool.query(await readFile(migration, 'utf8'))
    }
  } finally {
    await pool.end()
  }
}
