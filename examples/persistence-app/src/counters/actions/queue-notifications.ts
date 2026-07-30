import { randomUUID } from 'node:crypto'

import { Action, Mailer, Sms } from '@doxajs/core'

export class QueueNotifications extends Action<
  { failAfterQueue?: boolean; smsFrom?: string } | undefined,
  { mailId: string; smsId: string }
> {
  static id = 'queue-notifications'
  static override readonly access = 'public'

  private readonly mailer = this.inject(Mailer)
  private readonly sms = this.inject(Sms)

  async handle(input?: {
    failAfterQueue?: boolean
    smsFrom?: string
  }): Promise<{ mailId: string; smsId: string }> {
    const mailId = randomUUID()
    const smsId = randomUUID()
    await this.mailer.send({
      id: mailId,
      from: 'doxa@example.test',
      to: ['developer@example.test'],
      subject: 'Doxa',
      text: 'Mail delivery proof',
    })
    await this.sms.send({
      id: smsId,
      ...(input?.smsFrom !== undefined ? { from: input.smsFrom } : {}),
      to: '+13125551212',
      text: 'SMS delivery proof',
    })
    if (input?.failAfterQueue) throw new Error('failed after queuing communications')
    return { mailId, smsId }
  }
}
