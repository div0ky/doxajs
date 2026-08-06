import { decodeDateTimeValues, encodeDateTimeValues } from './datetime-codec.js'
import type { DoxaValue, JsonValue } from './index.js'

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

const DELIVERY_STATES: readonly DeliveryState[] = [
  'pending',
  'accepted',
  'sent',
  'delivered',
  'undelivered',
  'failed',
  'suppressed',
  'cancelled',
]

/** @internal Shared monotonic delivery-state rule for first-party persistence adapters. */
export function allowedDeliveryPreviousStates(next: DeliveryState): readonly DeliveryState[] {
  return DELIVERY_STATES.filter((current) => canApplyDeliveryTransition(current, next))
}

/** @internal Shared monotonic delivery-state rule for first-party persistence adapters. */
export function canApplyDeliveryTransition(current: DeliveryState, next: DeliveryState): boolean {
  if (current === next || next === 'suppressed') return true
  if (['delivered', 'failed', 'suppressed', 'cancelled'].includes(current)) return false
  if (next === 'accepted') return current === 'pending'
  if (next === 'sent') return current === 'pending' || current === 'accepted'
  if (next === 'undelivered') {
    return current === 'pending' || current === 'accepted' || current === 'sent'
  }
  if (next === 'delivered' || next === 'failed' || next === 'cancelled') return true
  return false
}

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
  readonly data?: Readonly<Record<string, DoxaValue>>
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
    this.sent.push(decodeDateTimeValues(encodeDateTimeValues(message)) as MailMessage)
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
