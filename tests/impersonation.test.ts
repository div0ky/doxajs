import { Auth, Instant } from '@doxajs/core'
import { KeryxAdmissionTickets } from '@doxajs/keryx'
import { describe, expect, it } from 'vitest'

describe('native impersonation transport context', () => {
  it('fails closed when a custom Auth provider does not implement live credential validation', async () => {
    await expect(
      Auth.prototype.validateAuthentication(
        { kind: 'user', id: 'admin' },
        {
          state: 'authenticated',
          identityId: 'admin',
          method: 'password',
          sessionId: 'session-1',
        },
      ),
    ).resolves.toBe(false)
  })

  it('preserves impersonator, target, audit delegation, and bounded expiry in Keryx tickets', () => {
    const now = Date.parse('2026-08-05T15:00:00.000Z')
    const expiresAt = Instant.fromEpochMicroseconds(BigInt(now + 10_000) * 1_000n)
    const tickets = new KeryxAdmissionTickets(
      'impersonation-test',
      'impersonation-ticket-secret-at-least-thirty-two-characters',
      30_000,
      () => now,
    )
    const grant = tickets.issue({
      actor: { kind: 'user', id: 'target' },
      initiator: { kind: 'user', id: 'admin' },
      delegation: [
        {
          from: { kind: 'user', id: 'admin' },
          to: { kind: 'user', id: 'target' },
          grantId: 'grant-1',
          reason: 'Support ticket 42',
          expiresAt,
        },
      ],
      authentication: {
        state: 'authenticated',
        identityId: 'admin',
        method: 'password',
        sessionId: 'session-1',
        impersonationGrantId: 'grant-1',
      },
      correlationId: 'correlation-1',
      origin: 'https://app.example.test',
    })

    expect(grant.expiresAt).toEqual(expiresAt)
    expect(tickets.open(grant.ticket, 'https://app.example.test')).toEqual(
      expect.objectContaining({
        actor: { kind: 'user', id: 'target' },
        initiator: { kind: 'user', id: 'admin' },
        delegation: [
          {
            from: { kind: 'user', id: 'admin' },
            to: { kind: 'user', id: 'target' },
            grantId: 'grant-1',
            reason: 'Support ticket 42',
            expiresAt,
          },
        ],
        authentication: expect.objectContaining({
          identityId: 'admin',
          sessionId: 'session-1',
          impersonationGrantId: 'grant-1',
        }),
      }),
    )

    expect(() =>
      tickets.issue({
        actor: { kind: 'user', id: 'target' },
        delegation: [
          {
            from: { kind: 'user', id: 'admin' },
            to: { kind: 'user', id: 'target' },
            grantId: 'grant-1',
            reason: 'Expired grant',
            expiresAt: Instant.fromEpochMicroseconds(BigInt(now) * 1_000n),
          },
        ],
        authentication: { state: 'authenticated', identityId: 'admin' },
        correlationId: 'correlation-2',
        origin: 'https://app.example.test',
      }),
    ).toThrow('expired delegation')
  })
})
