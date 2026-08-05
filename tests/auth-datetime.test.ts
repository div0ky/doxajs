import { type AuthenticationContext, Instant, isRecentPasswordAuthentication } from '@doxajs/core'
import { describe, expect, it } from 'vitest'

const authenticatedAt = Instant.parse('2026-08-05T12:00:00.000000Z')
const authentication: AuthenticationContext = {
  state: 'authenticated',
  identityId: 'identity-1',
  method: 'password',
  authenticatedAt,
  sessionId: 'session-1',
}

describe('authentication datetime boundary', () => {
  it('evaluates password freshness with explicit Instant values', () => {
    expect(
      isRecentPasswordAuthentication(
        authentication,
        15 * 60,
        Instant.parse('2026-08-05T12:15:00.000000Z'),
      ),
    ).toBe(true)
    expect(
      isRecentPasswordAuthentication(
        authentication,
        15 * 60,
        Instant.parse('2026-08-05T12:15:00.000001Z'),
      ),
    ).toBe(false)
    expect(
      isRecentPasswordAuthentication(
        authentication,
        15 * 60,
        Instant.parse('2026-08-05T11:59:59.999999Z'),
      ),
    ).toBe(false)
  })

  it('requires an admitted clock when no reference Instant is supplied', () => {
    expect(() => isRecentPasswordAuthentication(authentication)).toThrow(
      'Clock-relative datetime operations require an active Doxa execution.',
    )
  })
})
