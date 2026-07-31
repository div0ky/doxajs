import { HttpError, PersistenceError } from '@doxajs/core'
import { DatabaseError } from 'pg'
import { describe, expect, it } from 'vitest'

import {
  drizzleDriverFailureForTesting,
  transactionFailure,
} from '../packages/postgres-drizzle/src/postgres-transaction-manager.js'

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
    const rollbackError = new Error('ROLLBACK failed.')

    expect(transactionFailure(rollbackError, { error: applicationError })).toBe(applicationError)
  })

  it('translates the primary database failure when transaction cleanup also fails', () => {
    const databaseError = postgresFailure('08006')
    const rollbackError = new Error('ROLLBACK failed.')

    const translated = transactionFailure(rollbackError, { error: databaseError })

    expect(translated).toBeInstanceOf(PersistenceError)
    expect((translated as Error & { cause?: unknown }).cause).toBe(databaseError)
  })

  it('translates a transaction failure that happens before application work starts', () => {
    const connectionError = Object.assign(new Error('Connection refused.'), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
    })

    const translated = transactionFailure(connectionError, undefined)

    expect(translated).toBeInstanceOf(PersistenceError)
    expect((translated as Error & { cause?: unknown }).cause).toBe(connectionError)
  })

  it('translates a Drizzle driver failure without relying on system error fields', () => {
    const driverError = drizzleDriverFailureForTesting(
      new Error('Connection terminated unexpectedly.'),
    )

    const translated = transactionFailure(new Error('ROLLBACK failed.'), {
      error: driverError,
    })

    expect(translated).toBeInstanceOf(PersistenceError)
    expect((translated as Error & { cause?: unknown }).cause).toBe(driverError)
  })
})

function postgresFailure(code: string): DatabaseError {
  const error = new DatabaseError('PostgreSQL failed.', 1, 'error')
  error.code = code
  return error
}
