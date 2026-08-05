import { KeryxAdmissionTickets } from '@doxajs/keryx'
import { describe, expect, it } from 'vitest'

describe('native impersonation transport context', () => {
  it('preserves impersonator, target, audit delegation, and bounded expiry in Keryx tickets', () => {
    const now = Date.parse('2026-08-05T15:00:00.000Z')
    const expiresAt = new Date(now + 10_000)
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
          grantId: 'session-1',
          reason: 'Support ticket 42',
          expiresAt,
        },
      ],
      authentication: {
        state: 'authenticated',
        identityId: 'admin',
        method: 'password',
        sessionId: 'session-1',
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
            grantId: 'session-1',
            reason: 'Support ticket 42',
            expiresAt,
          },
        ],
        authentication: expect.objectContaining({
          identityId: 'admin',
          sessionId: 'session-1',
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
            grantId: 'session-1',
            reason: 'Expired grant',
            expiresAt: new Date(now),
          },
        ],
        authentication: { state: 'authenticated', identityId: 'admin' },
        correlationId: 'correlation-2',
        origin: 'https://app.example.test',
      }),
    ).toThrow('expired delegation')
  })
})
