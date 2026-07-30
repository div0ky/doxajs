# Events, Jobs, and Schedules

## Events

Declare an Event in a Feature, import its class anywhere inside the allowed application boundary,
and dispatch it statically:

```ts
await UserRegistered.dispatch({ userId: user.id })
```

Listeners declare their event through their generic type. Marker interfaces select local,
after-commit, queued, or queued-after-commit delivery without runtime decorators.

Use `DomainEvent` for an accepted fact that must be journaled with the model mutation:

```ts
export class OrderPlaced extends DomainEvent<{ total: number }> {
  static id = 'order-placed'
  static model = Order
  static version = 1
}

await OrderPlaced.dispatch(order.id, { total: order.total })
```

A Domain Event requires an active writable Unit of Work. Doxa derives its canonical entity type from
the declared Model, records the fact atomically, and then applies ordinary listener semantics.
Queued event envelopes contain only the declared payload plus the manifest payload version; role
dependencies are reconstructed in the worker's fresh execution scope.

Tests can selectively prevent listeners while retaining application-scoped dispatch evidence:

```ts
harness.events.fake([OrderPlaced])
await placeOrder()
harness.events.assertDispatched(OrderPlaced, (event) => event.payload.total > 0)
harness.events.assertListening(OrderPlaced, SendReceipt)
```

Use `restore()`, `fakeExcept()`, or callback-scoped `fakeFor()` without affecting another test
application.

## Jobs

Jobs use the same class-first dispatch experience:

```ts
const jobId = await SendWelcomeEmail.dispatch(
  { userId: user.id },
  { idempotencyKey: `welcome:${user.id}` },
)
```

Doxa guarantees at-least-once execution. Jobs should be idempotent and may declare retries, backoff,
delay, timeout, and overlap behavior. Actor, tenant, authentication, correlation, causation, and
trace context cross the durable boundary.

Every Job attempt is already a top-level writable execution. A Job must not dispatch an Action to
reuse mutation behavior. Extract the behavior into an ordinary service and call it from both the
Action and Job; each boundary supplies its own transaction. Use a queued Listener only when the
reaction is independently retryable and eventually consistent, not when its mutations must commit
atomically with the Job. A queued Listener receives a fresh execution but no automatic writable
transaction; it may dispatch an Action as a new top-level operation, or the producer may queue a Job
whose attempt owns the transaction.

## Schedules

Schedules target Jobs rather than inventing a second execution model. They may use cron or fixed
interval declarations and define overlap and misfire policy.

The default `misfire = 'skip'` does not recreate occurrences that were never admitted while the
scheduler was offline. Set `misfire = 'catch-up-once'` to admit one deterministic recovery firing
after downtime, regardless of how many occurrences were missed. Doxa never creates an unbounded
catch-up storm.

`doxa work` consumes queues and admits distributed-safe schedules by default. Advanced deployments
may run `doxa work --without-scheduler` beside a dedicated `doxa schedule` process.
