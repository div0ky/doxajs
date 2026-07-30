---
'@doxajs/core': minor
'@doxajs/compiler': patch
'@doxajs/gnosis': patch
'@doxajs/twilio-sms': minor
---

Add an optional provider-independent SMS sender and support application-selected E.164 Twilio `From`
delivery. Explicit senders take precedence over a configured Messaging Service, survive
transactional queueing and redrive, and fail permanently before HTTP delivery when invalid or
missing.
