---
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/http-hono': patch
'@doxajs/manifest': patch
'@doxajs/postgres-drizzle': patch
'@doxajs/praxis': patch
'@doxajs/runtime': patch
'@doxajs/sendgrid': patch
'@doxajs/testing': patch
'@doxajs/twilio-sms': patch
---

Reject invalid datetime, manifest, permission, HTTP, and schedule inputs; make cursor, memory
transaction/cache, lifecycle cleanup, cookie renewal, delivery reconciliation, provider failure, and
expired-job transaction behavior deterministic and safe.
