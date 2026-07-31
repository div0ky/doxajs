import { HttpError, PersistenceError } from '@doxajs/core'
import { DatabaseError } from 'pg'
import { describe, expect, it } from 'vitest'

import { transactionFailure } from '../packages/postgres-drizzle/src/postgres-transaction-manager.js'

describe('PostgreSQL transaction error boundary', () => {
  it('preserves the primary application error when transaction cleanup fails', () => {
    const applicationError = new HttpError(
      409,
      'attachment_not_ready',
      'The attachment is not ready.',
    )
    const rollbackError = new Error('ROLLBACK failed.')

    expect(transactionFailure(rollbackError, { error: applicationError })).toBe(applicationError)
  })

  it('preserves a custom application error even when it records a PostgreSQL cause', () => {
    const databaseError = postgresFailure('23505')
    const applicationError = Object.assign(
      new Error('The application mapped the database failure.', { cause: databaseError }),
      { code: 'mapped_database_conflict' },
    )

    expect(transactionFailure(databaseError, { error: applicationError })).toBe(applicationError)
  })

  it('translates an unmapped PostgreSQL database failure into PersistenceError', () => {
    const databaseError = postgresFailure('08006')

    const translated = transactionFailure(databaseError, { error: databaseError })

    expect(translated).toBeInstanceOf(PersistenceError)
    expect((translated as Error & { cause?: unknown }).cause).toBe(databaseError)
  })
})

function postgresFailure(code: string): DatabaseError {
  const error = new DatabaseError('PostgreSQL failed.', 1, 'error')
  error.code = code
  return error
}
