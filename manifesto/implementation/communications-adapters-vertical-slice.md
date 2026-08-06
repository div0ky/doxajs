# Communications Adapter Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-10

Doxa now owns provider-independent mail, SMS, delivery-state, failure-classification, and testing
contracts. Feature-facing types contain no SendGrid or Twilio request, response, template, or error
objects.

The SendGrid adapter uses `POST /v3/mail/send`, isolates recipients into separate personalizations,
correlates `doxa_message_id` through custom arguments, treats `202` as accepted rather than
delivered, classifies HTTP retry behavior, verifies ECDSA P-256 signed event webhooks, requires
batched arrays and stable event IDs, maps `open` and `click` engagement to delivered, ignores
unknown and resubscribe-only events, and normalizes bounce, deferral, suppression, spam, and
unsubscribe outcomes.

The Twilio SMS adapter uses either a configured Messaging Service or an explicit per-message E.164
sender, E.164 destinations, Basic authentication, status callbacks, and normalized
acceptance/delivery outcomes. Explicit senders take precedence, the adapter never sends both `From`
and `MessagingServiceSid`, and missing or invalid senders fail permanently before an HTTP request.
It validates `X-Twilio-Signature` using the canonical URL-plus-sorted-parameters HMAC. Error `21610`
is opt-out, `30007` is suppression, `30001`, `30003`, `30008`, and `30017` are transient, and other
failed or undelivered provider codes are permanent. Network failures, HTTP `429`, and HTTP `5xx`
remain transient.

First-party fakes capture Doxa messages and return provider-independent acceptances. Adapter tests
use injected fetch implementations and generated signatures; they never contact providers.

Application code now injects `Mailer` and `Sms`. Their `send()` methods require a mutating
execution, stage a `doxa_delivery_messages` row and `doxa.queue` outbox envelope atomically, and
return the application message ID. A failed action rolls back both records. The pg-boss worker
invokes the selected transport with preserved execution context and records provider acceptance in a
separate transaction. Transient `DeliveryError` failures remain retryable; permanent, suppression,
and opt-out outcomes are recorded and complete without pointless retries.

The complete provider-independent SMS payload, including an optional `from`, is stored in both the
delivery ledger and queue envelope. Praxis redrive reconstructs delivery from the ledger payload, so
an explicit sender survives initial delivery attempts and later retries.

The reference application exposes signed SendGrid and Twilio routes. SendGrid signatures are checked
against the untouched body and bounded to a five-minute timestamp window. Twilio signatures cover
the exact callback URL and sorted form fields. Both normalize into a transactional `DeliveryLedger`
action. Provider event IDs are unique and duplicate callbacks are harmless.

The PostgreSQL and memory ledgers share one monotonic transition rule. Delivered, failed, cancelled,
and suppressed outcomes cannot regress, except that any state may become suppressed; transient
undelivered outcomes may recover to delivered. Unique known provider events remain recorded when
their transition is ignored, and successful transitions clear stale failure metadata.

Praxis provides `delivery:list` and `delivery:retry`. Redrive is limited to failed or undelivered
messages, rebuilds a version-1 queue envelope with the original actor, authentication, correlation,
and trace context, and atomically resets delivery state with its outbox handoff. That explicit
delegated authority remains the dispatch-time snapshot already accepted for the durable delivery;
each attempt rechecks current application permissions without revalidating the originating browser
activation. Configuration is read from an explicit option, the environment, or the repository `.env`
file.

The required communications behavior is proven. Queue and channel telemetry is emitted through the
Doxa telemetry port. Retention policy and live provider sandbox checks are release gates rather than
application-facing framework gaps.
