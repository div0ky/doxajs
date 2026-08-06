# 0008: Provide SendGrid Email and Twilio SMS Plugins in the MVP

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Amended:** 2026-07-30 — Support application-selected per-message Twilio SMS senders.
- **Amended:** 2026-08-06 — Make delivery reconciliation monotonic and classify provider failures.
- **Decision owners:** Doxa maintainers

## Decision

Doxa will own first-party mail and SMS contracts. The MVP will ship a SendGrid email plugin and a
Twilio Programmable Messaging SMS plugin.

Applications install them with `doxa add sendgrid` and `doxa add twilio-sms`. Installation updates
the dependency set and the literal `plugins` array in `app.config.ts`; it does not generate provider
subclasses or an application-owned infrastructure Feature.

Applications will compose Doxa-owned messages, templates, addresses, delivery options, and
assertions. Provider SDKs remain private implementation engines inside their plugins.

## Delivery model

Email and SMS delivery must flow through the transactional outbox and Doxa jobs. A provider API
response records provider acceptance, not final delivery.

The communications contract will normalize at least:

- `pending`
- `accepted`
- `sent`
- `delivered`
- `undelivered`
- `failed`
- `suppressed`
- `cancelled`

Delivery reconciliation is monotonic. `delivered`, `failed`, `cancelled`, and `suppressed` are
terminal except for an idempotent same-state event or a later suppression. A transient `undelivered`
outcome may recover to `delivered`, and suppression may replace any state. Verified, unique provider
events are recorded even when this rule ignores their state transition. Successful transitions clear
stale failure metadata.

Provider message IDs must correlate back to the Doxa message, job, actor, initiator, tenant,
causation, correlation, and trace context. Webhook ingestion verifies provider signatures before
updating delivery state or emitting Doxa events.

## SendGrid plugin

The SendGrid plugin will:

- Use the SendGrid v3 Mail Send API.
- Treat HTTP `202 Accepted` as queued by SendGrid, not delivered.
- Support verified senders, content, first-party template references, and provider-template escape
  hatches.
- Correlate delivery, bounce, block, spam-report, and engagement events through the SendGrid Event
  Webhook.
- Treat `open` and `click` as delivered engagement. Ignore unknown and resubscribe-only events
  rather than inferring a delivery state.
- Keep API keys, SendGrid request objects, template IDs, categories, and custom arguments out of
  feature contracts unless exposed through an explicit provider escape hatch.

## Twilio SMS plugin

The Twilio plugin will:

- Use Twilio Programmable Messaging through either a configured Messaging Service or an explicit
  application-selected E.164 sender on an individual provider-independent SMS message.
- Prefer an explicit per-message sender when both delivery modes are available and never send both
  `From` and `MessagingServiceSid` in one Twilio request.
- Normalize destination phone numbers to the Doxa phone-number contract and transmit E.164 to
  Twilio.
- Track queued, sent, delivered, undelivered, and failed outcomes through status callbacks.
- Classify `21610` as non-retryable opt-out and `30007` as suppression. Only `30001`, `30003`,
  `30008`, and `30017` are transient provider outcomes; other failed or undelivered provider codes
  are permanent. Network failures, HTTP `429`, and HTTP `5xx` remain transient.
- Keep account credentials, messaging-service identifiers, Twilio message objects, and error
  payloads behind the plugin boundary.

Compliance onboarding, sender registration, consent, quiet hours, and opt-out behavior are
configuration and operational requirements of the plugin, not details applications may bypass.
Applications may select a sender to preserve product-level routing invariants such as a durable
contact-specific number, but may not bypass E.164 validation or Twilio compliance requirements.

## Testing

Doxa's mail and SMS fakes must support assertions for queued messages, recipients, templates,
content, causal metadata, provider-independent delivery transitions, retry classification, and
verified webhook handling.

Provider sandbox or test modes supplement these fakes but do not replace framework-level tests.

## References

- [SendGrid Mail Send API](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)
- [SendGrid Event Webhook](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event)
- [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource)
- [Twilio Messaging Services](https://www.twilio.com/docs/messaging/services)
- [Twilio error 21610](https://www.twilio.com/docs/api/errors/21610)
- [Twilio error 30007](https://www.twilio.com/docs/api/errors/30007)
- [Twilio retry guidance](https://www.twilio.com/docs/messaging/guides/best-practices-at-scale)
