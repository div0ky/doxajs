# `@doxajs/core`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The primary application-facing programming model for Doxa. Application Features import roles,
models, events, jobs, schedules, policies, configuration, ports, and public contracts from this
package.

```sh
pnpm add @doxajs/core
```

```ts
import { Feature, Route, type HttpRequest } from '@doxajs/core'

export class HomeRoute extends Route {
  static override readonly id = 'home'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/'
  handle(_request: HttpRequest) {
    return { application: 'shop' }
  }
}

export class AppFeature extends Feature {
  id = 'app'
  routes = [HomeRoute]
}
```

Doxa contributes mandatory infrastructure, authentication routes, and `GET /health` from
framework-owned generated declarations. Application Features do not re-declare them.

Features intentionally export cross-Feature ordinary services through `provides` without changing
their transient or execution scope. Applications with existing group or user permission data map it
to stable Doxa abilities through one `PermissionSource`; resource `Policy` classes may further
narrow those grants. Runtime-invoked permission sources and policies may query declared models
through an ambient read-only session without adding persistence machinery to their request objects.

## Models

Persistent models expose typed cloned reads and writes while keeping their raw attribute bag
protected:

```ts
const customer = await Customer.findOrFail(input.id)
const activeCustomer = await Customer.where({ active: true }).find(input.id)
const customerWithOrders = await Customer.with('orders').findOrFail(input.id)

customer.setAttribute('email', input.email)
customer.fill({ displayName: input.displayName, phone: input.phone })

if (customer.isDirty()) await customer.save()
```

Builder `find` and `findOrFail` preserve existing constraints and eager loads while appending the
exact logical identity and forcing a one-row limit. The static `Model.find()` identity fast path is
unchanged.

`setAttribute` and `fill` clone incoming values, mark ordinary dirty state, and never save
implicitly. `id` cannot be changed after construction. Use intention-revealing model methods for
changes that enforce invariants or raise domain events, journal facts, or outbox messages.

Mapped models declare their complete logical persistence projection on the model:

```ts
export class Customer extends Model<CustomerAttributes> {
  static override readonly table = 'legacy_customers'
  static override readonly managed = false
  static override readonly readOnly = true
  static override readonly columns = { displayName: 'full_name' } as const
}
```

`managed` defaults true and controls Doxa/Praxis migration management only. `readOnly` defaults
false and independently rejects create, save, and delete before observers or persistence. Doxa never
hydrates undeclared physical columns, unknown attribute access fails, and mapped updates write only
declared dirty attributes plus required timestamp/version infrastructure.

See the [Doxa repository](https://github.com/div0ky/doxajs) for documentation and support.

## Broadcasting

```ts
import { Event, PrivateChannel, type ShouldBroadcast } from '@doxajs/core'

export class OrderShipped extends Event<{ orderId: string }> implements ShouldBroadcast {
  static override readonly id = 'order-shipped'
  broadcastOn() {
    return new PrivateChannel(`orders.${this.payload.orderId}`)
  }
}
```

Queued broadcasts use the Unit of Work outbox automatically. Use `ShouldBroadcastNow` only when the
publisher must synchronously observe transport success or failure.

Enable Doxa's first-party transport with `doxa add keryx`. Keryx is a framework-owned optional core
module; application Features continue to depend only on the broadcasting contracts above.

Authenticated clients may send explicitly registered ephemeral commands without an HTTP Action:

```ts
import { RealtimeCommand } from '@doxajs/core'
import { z } from 'zod'

const TypingInput = z.object({ conversationId: z.string() })

export class SendTyping extends RealtimeCommand<z.infer<typeof TypingInput>> {
  static override readonly id = 'direct-messages.typing'
  static override readonly access = 'direct-messages.participate'
  static override readonly schema = TypingInput
  static override readonly throttle = { limit: 4, windowMs: 2_000 }

  async handle(input: z.infer<typeof TypingInput>): Promise<void> {
    // Emit transient local coordination or a ShouldBroadcastNow event.
  }
}
```

Register the role in `Feature.realtimeCommands`. Doxa validates, throttles, and Policy-authorizes it
against the socket's admitted actor. Realtime commands are non-transactional, non-retryable, and may
not dispatch Actions or durable work; durable mutation remains an HTTP Action.

## SMS

Queue provider-independent SMS inside an Action or Job so the delivery intent commits atomically
with application state:

```ts
import { Action, Sms } from '@doxajs/core'

export class NotifyContact extends Action<{ contact: Contact }> {
  static override readonly id = 'notify-contact'
  private readonly sms = this.inject(Sms)

  async handle({ contact }: { contact: Contact }): Promise<void> {
    await this.sms.send({
      id: crypto.randomUUID(),
      from: contact.stickyTwilioNumber,
      to: contact.phoneNumber,
      text: 'Your appointment is confirmed.',
    })
  }
}
```

`SmsMessage.from` is optional and provider-independent. A selected transport owns sender validation
and delivery semantics; for example, `@doxajs/twilio-sms` accepts an explicit E.164 sender or falls
back to its configured Messaging Service.
