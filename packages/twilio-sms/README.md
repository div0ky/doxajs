# `@doxajs/twilio-sms`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The first-party Twilio implementation of Doxa's provider-independent SMS contracts, including
Messaging Service and explicit-sender delivery, callback verification, state normalization, and
opt-out classification.

```sh
pnpm add @doxajs/twilio-sms
```

Configure a Messaging Service for the existing default delivery mode:

```ts
const sms = new TwilioSmsTransport({
  accountSid,
  authToken,
  messagingServiceSid: 'MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  statusCallback: 'https://example.com/webhooks/twilio/sms',
})

await sms.send({ id: messageId, to: '+13125551212', text: 'Hello' })
```

Applications that own sender selection may instead set `from` on each provider-independent
`SmsMessage`:

```ts
await sms.send({
  id: messageId,
  from: contact.stickyTwilioNumber,
  to: contact.phoneNumber,
  text: 'Hello',
})
```

An explicit `from` wins when `messagingServiceSid` is also configured. Doxa sends Twilio `From` and
omits `MessagingServiceSid`; without `from`, it sends `MessagingServiceSid` and omits `From`. This
supports sticky-number applications where every message to a contact must use that contact's durable
Twilio number.

Both `from` and `to` must be E.164 strings. An invalid explicit sender fails permanently with
`invalid_sender` before any HTTP request. If neither an explicit sender nor a configured Messaging
Service SID is available, delivery fails permanently with `missing_sender`. Callback correlation,
webhook verification, delivery status normalization, and Twilio `21610` opt-out handling are the
same in both delivery modes.

Failure classification is conservative: `21610` is opt-out, `30007` is suppression, and only
`30001`, `30003`, `30008`, and `30017` are transient provider outcomes. Other failed or undelivered
provider codes are permanent. Network failures, HTTP `429`, and HTTP `5xx` remain transient.
