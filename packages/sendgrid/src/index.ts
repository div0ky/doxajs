import { createPublicKey, verify } from 'node:crypto'

import {
  DeliveryError,
  MailTransport,
  type DeliveryAcceptance,
  type DeliveryUpdate,
  type MailMessage,
} from '@doxajs/core'

export interface SendGridOptions {
  readonly apiKey: string
  readonly endpoint?: string
  readonly fetch?: typeof globalThis.fetch
}

export class SendGridMailTransport extends MailTransport {
  constructor(private readonly options: SendGridOptions) {
    super()
  }

  async send(message: MailMessage): Promise<DeliveryAcceptance> {
    validate(message)
    const response = await (this.options.fetch ?? fetch)(
      this.options.endpoint ?? 'https://api.sendgrid.com/v3/mail/send',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(toRequest(message)),
      },
    ).catch((cause) => {
      throw new DeliveryError('SendGrid request failed.', 'transient', 'network_error', { cause })
    })
    if (response.status !== 202) {
      const transient = response.status === 429 || response.status >= 500
      throw new DeliveryError(
        `SendGrid rejected mail with HTTP ${response.status}.`,
        transient ? 'transient' : 'permanent',
        `http_${response.status}`,
      )
    }
    return { messageId: message.id, state: 'accepted' }
  }
}

export function verifySendGridWebhook(
  rawBody: string,
  timestamp: string,
  signature: string,
  publicKey: string,
): boolean {
  if (!/^\d{1,20}$/.test(timestamp)) return false
  try {
    return verify(
      'sha256',
      Buffer.from(timestamp + rawBody),
      createPublicKey(publicKey),
      Buffer.from(signature, 'base64'),
    )
  } catch {
    return false
  }
}

export function normalizeSendGridEvents(rawBody: string): readonly DeliveryUpdate[] {
  const parsed: unknown = JSON.parse(rawBody)
  if (!Array.isArray(parsed))
    throw new DeliveryError(
      'SendGrid webhook must be a batched array.',
      'permanent',
      'invalid_webhook',
    )
  return parsed.flatMap((value): readonly DeliveryUpdate[] => {
    if (
      !record(value) ||
      typeof value.event !== 'string' ||
      typeof value.sg_event_id !== 'string' ||
      typeof value.doxa_message_id !== 'string'
    ) {
      throw new DeliveryError(
        'SendGrid webhook event is missing correlation fields.',
        'permanent',
        'invalid_webhook',
      )
    }
    const mapped = sendGridState(value.event)
    if (!mapped) return []
    return [
      {
        messageId: value.doxa_message_id,
        eventId: value.sg_event_id,
        ...(typeof value.sg_message_id === 'string'
          ? { providerMessageId: value.sg_message_id }
          : {}),
        ...mapped,
      } satisfies DeliveryUpdate,
    ]
  })
}

function toRequest(message: MailMessage): Record<string, unknown> {
  const request: Record<string, unknown> = {
    from: { email: message.from },
    personalizations: message.to.map((email) => ({
      to: [{ email }],
      custom_args: { doxa_message_id: message.id },
    })),
  }
  if (message.template) {
    request.template_id = message.template
    request.personalizations = message.to.map((email) => ({
      to: [{ email }],
      dynamic_template_data: message.data ?? {},
      custom_args: { doxa_message_id: message.id },
    }))
  } else {
    request.subject = message.subject
    request.content = [
      ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
      ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
    ]
  }
  return request
}

function validate(message: MailMessage): void {
  if (!message.id || !message.from || message.to.length === 0)
    throw new DeliveryError(
      'Mail requires id, sender, and recipients.',
      'permanent',
      'invalid_message',
    )
  if (message.to.length > 1_000)
    throw new DeliveryError(
      'SendGrid accepts at most 1,000 recipients.',
      'permanent',
      'recipient_limit',
    )
  if (!message.template && (!message.subject || (!message.text && !message.html)))
    throw new DeliveryError(
      'Mail requires a template or subject and content.',
      'permanent',
      'invalid_message',
    )
}

function sendGridState(
  event: string,
): Pick<DeliveryUpdate, 'state' | 'failureKind' | 'code'> | undefined {
  if (event === 'processed') return { state: 'accepted' }
  if (event === 'delivered' || event === 'open' || event === 'click') {
    return { state: 'delivered' }
  }
  if (event === 'deferred')
    return { state: 'undelivered', failureKind: 'transient', code: 'deferred' }
  if (event === 'bounce') return { state: 'failed', failureKind: 'permanent', code: 'bounce' }
  if (
    event === 'dropped' ||
    event === 'spamreport' ||
    event === 'unsubscribe' ||
    event === 'group_unsubscribe'
  )
    return { state: 'suppressed', failureKind: 'suppressed', code: event }
  return undefined
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
