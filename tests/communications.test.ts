import { generateKeyPairSync, sign, createHmac } from 'node:crypto'

import { FakeMailTransport, FakeSmsTransport, type SmsMessage } from '@doxajs/core'
import {
  normalizeSendGridEvents,
  SendGridMailTransport,
  verifySendGridWebhook,
} from '@doxajs/sendgrid'
import { normalizeTwilioStatus, TwilioSmsTransport, verifyTwilioWebhook } from '@doxajs/twilio-sms'
import { describe, expect, it, vi } from 'vitest'

describe('communications adapters', () => {
  const messageWithoutSender = {
    id: 'sms-compatible',
    to: '+13125551212',
    text: 'Existing consumer',
  } satisfies SmsMessage

  it('provides provider-independent mail and SMS fakes', async () => {
    const mail = new FakeMailTransport()
    const sms = new FakeSmsTransport()
    await mail.send({
      id: 'mail-1',
      from: 'from@example.com',
      to: ['to@example.com'],
      subject: 'Hi',
      text: 'Hello',
    })
    await sms.send({ id: 'sms-1', to: '+13125551212', text: 'Hello' })
    expect(mail.sent[0]?.id).toBe('mail-1')
    expect(sms.sent[0]?.id).toBe('sms-1')
  })

  it('translates Doxa mail into private-recipient SendGrid requests and treats 202 as accepted', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }))
    const transport = new SendGridMailTransport({ apiKey: 'SG.test', fetch: request })
    expect(
      await transport.send({
        id: 'mail-2',
        from: 'from@example.com',
        to: ['a@example.com', 'b@example.com'],
        subject: 'Hi',
        html: '<p>Hello</p>',
      }),
    ).toEqual({ messageId: 'mail-2', state: 'accepted' })
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body.personalizations).toHaveLength(2)
    expect(JSON.stringify(body)).toContain('doxa_message_id')
  })

  it('classifies SendGrid failures and verifies signed batched delivery webhooks', async () => {
    const transport = new SendGridMailTransport({
      apiKey: 'SG.test',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 })),
    })
    await expect(
      transport.send({
        id: 'mail-3',
        from: 'from@example.com',
        to: ['a@example.com'],
        subject: 'Hi',
        text: 'Hello',
      }),
    ).rejects.toMatchObject({ kind: 'transient', code: 'http_429' })

    const body = JSON.stringify([
      {
        event: 'delivered',
        sg_event_id: 'event-1',
        sg_message_id: 'provider-1',
        doxa_message_id: 'mail-3',
      },
    ])
    const timestamp = '1783733000'
    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const signature = sign('sha256', Buffer.from(timestamp + body), keys.privateKey).toString(
      'base64',
    )
    expect(
      verifySendGridWebhook(
        body,
        timestamp,
        signature,
        keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ),
    ).toBe(true)
    expect(normalizeSendGridEvents(body)).toEqual([
      {
        messageId: 'mail-3',
        eventId: 'event-1',
        providerMessageId: 'provider-1',
        state: 'delivered',
      },
    ])
  })

  it('uses Twilio Messaging Services without sending From', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ sid: 'SM123', status: 'queued' }))
    const transport = new TwilioSmsTransport({
      accountSid: 'AC123',
      authToken: 'secret',
      messagingServiceSid: 'MG123',
      statusCallback: 'https://example.test/status',
      fetch: request,
    })
    expect(await transport.send(messageWithoutSender)).toEqual({
      messageId: 'sms-compatible',
      providerMessageId: 'SM123',
      state: 'accepted',
    })
    const body = new URLSearchParams(String(request.mock.calls[0]?.[1]?.body))
    expect(body.get('To')).toBe(messageWithoutSender.to)
    expect(body.get('Body')).toBe(messageWithoutSender.text)
    expect(body.get('MessagingServiceSid')).toBe('MG123')
    expect(body.has('From')).toBe(false)
    expect(body.get('StatusCallback')).toBe(
      'https://example.test/status?doxa_message_id=sms-compatible',
    )
  })

  it('uses an explicit E.164 sender and gives it precedence over a Messaging Service', async () => {
    for (const messagingServiceSid of [undefined, 'MG123']) {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ sid: 'SM123', status: 'queued' }))
      const transport = new TwilioSmsTransport({
        accountSid: 'AC123',
        authToken: 'secret',
        ...(messagingServiceSid ? { messagingServiceSid } : {}),
        statusCallback: 'https://example.test/status',
        fetch: request,
      })
      expect(
        await transport.send({
          id: 'sms-explicit',
          from: '+13125550000',
          to: '+13125551212',
          text: 'Hello',
        }),
      ).toEqual({
        messageId: 'sms-explicit',
        providerMessageId: 'SM123',
        state: 'accepted',
      })
      const body = new URLSearchParams(String(request.mock.calls[0]?.[1]?.body))
      expect(body.get('To')).toBe('+13125551212')
      expect(body.get('Body')).toBe('Hello')
      expect(body.get('From')).toBe('+13125550000')
      expect(body.has('MessagingServiceSid')).toBe(false)
      expect(body.get('StatusCallback')).toBe(
        'https://example.test/status?doxa_message_id=sms-explicit',
      )
    }
  })

  it('rejects invalid and missing senders permanently without making an HTTP request', async () => {
    const request = vi.fn<typeof fetch>()
    const transport = new TwilioSmsTransport({
      accountSid: 'AC123',
      authToken: 'secret',
      statusCallback: 'https://example.test/status',
      fetch: request,
    })
    await expect(
      transport.send({
        id: 'sms-invalid-sender',
        from: '312-555-0000',
        to: '+13125551212',
        text: 'Hello',
      }),
    ).rejects.toMatchObject({ kind: 'permanent', code: 'invalid_sender' })
    await expect(
      transport.send({ id: 'sms-missing-sender', to: '+13125551212', text: 'Hello' }),
    ).rejects.toMatchObject({ kind: 'permanent', code: 'missing_sender' })
    expect(request).not.toHaveBeenCalled()
  })

  it('preserves callback correlation, status normalization, and webhook signatures', () => {
    const url = 'https://example.test/status'
    const parameters = { DoxaMessageId: 'sms-2', MessageSid: 'SM123', MessageStatus: 'delivered' }
    const content =
      url +
      Object.keys(parameters)
        .sort()
        .map((key) => key + parameters[key as keyof typeof parameters])
        .join('')
    const signature = createHmac('sha1', 'secret').update(content).digest('base64')
    expect(verifyTwilioWebhook(url, parameters, signature, 'secret')).toBe(true)
    expect(normalizeTwilioStatus(parameters)).toEqual({
      messageId: 'sms-2',
      providerMessageId: 'SM123',
      eventId: 'SM123:delivered',
      state: 'delivered',
    })
    expect(
      normalizeTwilioStatus({
        DoxaMessageId: 'sms-opt-out',
        MessageSid: 'SM21610',
        MessageStatus: 'failed',
        ErrorCode: '21610',
      }),
    ).toEqual({
      messageId: 'sms-opt-out',
      providerMessageId: 'SM21610',
      eventId: 'SM21610:failed',
      state: 'failed',
      failureKind: 'opt-out',
      code: '21610',
    })
  })

  it('classifies Twilio opt-out as permanent opt-out behavior', async () => {
    const transport = new TwilioSmsTransport({
      accountSid: 'AC123',
      authToken: 'secret',
      messagingServiceSid: 'MG123',
      statusCallback: 'https://example.test/status',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ code: 21610 }, { status: 400 })),
    })
    await expect(
      transport.send({ id: 'sms-3', to: '+13125551212', text: 'Hello' }),
    ).rejects.toMatchObject({ kind: 'opt-out', code: '21610' })
  })
})
