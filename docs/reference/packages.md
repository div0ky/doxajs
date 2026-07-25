# Package Reference

## Application-facing

- `@doxajs/core` — stable programming model and framework-owned contracts.
- `@doxajs/testing` — test harnesses, fakes, and assertions.
- `@doxajs/praxis` — generator and command suite.
- `@doxajs/keryx` — opt-in, framework-owned WebSocket broadcasting core module.

## Composition adapters

- `@doxajs/http-hono`
- `@doxajs/postgres-drizzle`
- `@doxajs/auth-postgres`
- `@doxajs/queue-pg-boss`
- `@doxajs/opentelemetry` — first-party OpenTelemetry tracing and metrics adapter.
- `@doxajs/sendgrid`
- `@doxajs/twilio-sms`
- `@doxajs/theoria`

## Realtime clients

- `@doxajs/realtime` — subscriber-facing WebSocket client with reconnect and resubscription.

Application events continue to use broadcasting contracts from `@doxajs/core`; Keryx and the
realtime client do not become the domain event vocabulary. Install Keryx with `doxa add keryx`; do
not add it to `Application.plugins` or author a broadcasting provider subclass. Separately addressed
browser listeners use the compiler-generated same-origin authorization route and Realtime's
short-lived admission-ticket flow.

Application and infrastructure composition may import these packages. Domain Features should rely on
Doxa-owned ports and types from `@doxajs/core`.

## Framework infrastructure

- `@doxajs/manifest`
- `@doxajs/compiler`
- `@doxajs/runtime`

These packages are published so first-party tooling and adapters can compose, but they are not the
ordinary application programming surface. Their direct use creates a deliberate compatibility
commitment and should be discussed before adoption.
