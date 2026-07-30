import type { JsonValue } from './index.js'

export type DeliveryState =
  | 'pending'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'suppressed'
  | 'cancelled'

export type DeliveryFailureKind = 'transient' | 'permanent' | 'suppressed' | 'opt-out'

export interface DeliveryAcceptance {
  readonly messageId: string
  readonly providerMessageId?: string
  readonly state: DeliveryState
}

export interface DeliveryUpdate extends DeliveryAcceptance {
  readonly eventId: string
  readonly failureKind?: DeliveryFailureKind
  readonly code?: string
}

export interface MailMessage {
  readonly id: string
  readonly from: string
  readonly to: readonly string[]
  readonly subject?: string
  readonly text?: string
  readonly html?: string
  readonly template?: string
  readonly data?: Readonly<Record<string, JsonValue>>
}

export interface SmsMessage {
  readonly id: string
  readonly from?: string
  readonly to: string
  readonly text: string
}

export interface StagedDelivery {
  readonly id: string
  readonly channel: 'mail' | 'sms'
  readonly recipients: readonly string[]
  readonly payload: JsonValue
}

export interface DeliveryTransition {
  readonly messageId: string
  readonly state: DeliveryState
  readonly providerMessageId?: string
  readonly eventId?: string
  readonly failureKind?: DeliveryFailureKind
  readonly code?: string
}

export class DeliveryError extends Error {
  override readonly name = 'DeliveryError'
  constructor(
    message: string,
    readonly kind: DeliveryFailureKind,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export abstract class MailTransport {
  abstract send(message: MailMessage): Promise<DeliveryAcceptance>
}

export abstract class SmsTransport {
  abstract send(message: SmsMessage): Promise<DeliveryAcceptance>
}

/** Transactional application-facing mail queue. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<string>
}

/** Transactional application-facing SMS queue. */
export abstract class Sms {
  abstract send(message: SmsMessage): Promise<string>
}

/** Transaction-bound delivery status reconciliation used by signed provider webhooks. */
export abstract class DeliveryLedger {
  abstract record(transition: DeliveryTransition): Promise<void>
}

export class FakeMailTransport extends MailTransport {
  readonly sent: MailMessage[] = []
  async send(message: MailMessage): Promise<DeliveryAcceptance> {
    this.sent.push(structuredClone(message))
    return {
      messageId: message.id,
      providerMessageId: `fake-mail:${message.id}`,
      state: 'accepted',
    }
  }
}

export class FakeSmsTransport extends SmsTransport {
  readonly sent: SmsMessage[] = []
  async send(message: SmsMessage): Promise<DeliveryAcceptance> {
    this.sent.push(structuredClone(message))
    return { messageId: message.id, providerMessageId: `fake-sms:${message.id}`, state: 'accepted' }
  }
}
