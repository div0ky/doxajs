import { createHmac, timingSafeEqual } from 'node:crypto'

import {
  DeliveryError,
  SmsTransport,
  type DeliveryAcceptance,
  type DeliveryUpdate,
  type SmsMessage,
} from '@doxajs/core'

export interface TwilioSmsOptions {
  readonly accountSid: string
  readonly authToken: string
  readonly messagingServiceSid?: string
  readonly statusCallback: string
  readonly endpoint?: string
  readonly fetch?: typeof globalThis.fetch
}

const E164 = /^\+[1-9]\d{7,14}$/

export class TwilioSmsTransport extends SmsTransport {
  constructor(private readonly options: TwilioSmsOptions) {
    super()
  }
  async send(message: SmsMessage): Promise<DeliveryAcceptance> {
    if (!E164.test(message.to))
      throw new DeliveryError('SMS destination must be E.164.', 'permanent', 'invalid_destination')
    if (!message.id || !message.text || message.text.length > 1_600)
      throw new DeliveryError(
        'SMS requires id and 1-1600 characters.',
        'permanent',
        'invalid_message',
      )
    if (message.from !== undefined && !E164.test(message.from))
      throw new DeliveryError('SMS sender must be E.164.', 'permanent', 'invalid_sender')
    const selectedSender = message.from ?? this.options.messagingServiceSid
    if (!selectedSender)
      throw new DeliveryError(
        'SMS requires an explicit sender or Messaging Service SID.',
        'permanent',
        'missing_sender',
      )
    const callback = new URL(this.options.statusCallback)
    callback.searchParams.set('doxa_message_id', message.id)
    const body = new URLSearchParams({
      To: message.to,
      Body: message.text,
      StatusCallback: callback.toString(),
    })
    if (message.from !== undefined) body.set('From', message.from)
    else body.set('MessagingServiceSid', selectedSender)
    const endpoint =
      this.options.endpoint ??
      `https://api.twilio.com/2010-04-01/Accounts/${this.options.accountSid}/Messages.json`
    const response = await (this.options.fetch ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.options.accountSid}:${this.options.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    }).catch((cause) => {
      throw new DeliveryError('Twilio request failed.', 'transient', 'network_error', { cause })
    })
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok || typeof payload.sid !== 'string') {
      const code =
        typeof payload.code === 'number' ? String(payload.code) : `http_${response.status}`
      const kind =
        code === '21610'
          ? 'opt-out'
          : response.status === 429 || response.status >= 500
            ? 'transient'
            : 'permanent'
      throw new DeliveryError(`Twilio rejected SMS (${code}).`, kind, code)
    }
    return {
      messageId: message.id,
      providerMessageId: payload.sid,
      state: normalizeState(payload.status),
    }
  }
}

export function verifyTwilioWebhook(
  url: string,
  parameters: Readonly<Record<string, string>>,
  signature: string,
  authToken: string,
): boolean {
  const content =
    url +
    Object.keys(parameters)
      .sort()
      .map((key) => key + parameters[key])
      .join('')
  const expected = createHmac('sha1', authToken).update(content).digest('base64')
  const left = Buffer.from(expected)
  const right = Buffer.from(signature)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function normalizeTwilioStatus(
  parameters: Readonly<Record<string, string>>,
): DeliveryUpdate {
  const providerMessageId = parameters.MessageSid
  const messageId = parameters.DoxaMessageId
  const status = parameters.MessageStatus
  if (!providerMessageId || !messageId || !status)
    throw new DeliveryError(
      'Twilio callback is missing correlation fields.',
      'permanent',
      'invalid_webhook',
    )
  const code = parameters.ErrorCode
  const kind =
    code === '21610'
      ? 'opt-out'
      : status === 'failed'
        ? 'permanent'
        : status === 'undelivered'
          ? 'transient'
          : undefined
  return {
    messageId,
    providerMessageId,
    eventId: `${providerMessageId}:${status}`,
    state: normalizeState(status),
    ...(kind ? { failureKind: kind } : {}),
    ...(code ? { code } : {}),
  }
}

function normalizeState(value: unknown): DeliveryUpdate['state'] {
  if (value === 'queued' || value === 'accepted') return 'accepted'
  if (value === 'sending' || value === 'sent') return 'sent'
  if (value === 'delivered') return 'delivered'
  if (value === 'undelivered') return 'undelivered'
  if (value === 'failed') return 'failed'
  if (value === 'canceled') return 'cancelled'
  return 'pending'
}
