# `@doxajs/sendgrid`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The first-party SendGrid implementation of Doxa's provider-independent mail contracts, including
request translation, delivery normalization, and signed webhook verification.

`open` and `click` engagement confirms delivered state. Unknown and resubscribe-only webhook events
are ignored. The shared delivery ledger prevents late provider events from regressing a terminal
state while still deduplicating every recognized provider event.

```sh
pnpm add @doxajs/sendgrid
```
