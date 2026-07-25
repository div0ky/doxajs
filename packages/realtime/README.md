# `@doxajs/realtime`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Typed, reconnecting protocol v2 subscriptions for Doxa broadcasts.

```ts
import { Realtime } from '@doxajs/realtime'

const realtime = new Realtime({ url: 'ws://127.0.0.1:6001/app' })
realtime.onConnectionState((state) => console.log('connection', state))
realtime.onError((error) => console.error(error.code, error.message))

const orders = realtime.private<{ 'order.shipped': { orderId: string } }>('orders.42')
orders.onStateChange((state) => console.log('orders', state))
orders.onError((error) => console.error(error.code, error.message))
orders.listen('order.shipped', ({ orderId }) => console.log(orderId))
```

A browser WebSocket `open` event means only that the transport opened. Realtime waits for Keryx's
authenticated `connected` frame before sending subscriptions. Connection and subscription state,
structured errors, acknowledgement timeouts, terminal authentication failures, reconnect, and
resubscription are observable through the public API.

Active subscriptions reconnect with capped exponential backoff and jitter. Explicit
`realtime.disconnect()` disables reconnect; `subscription.leave()` removes that channel.
