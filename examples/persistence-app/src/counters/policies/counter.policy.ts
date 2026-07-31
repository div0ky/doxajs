import { allow, deny, Policy, type PolicyDecision, type PolicyRequest } from '@doxajs/core'

import { Counter } from '../models/counter.js'

interface OwnedCounter {
  readonly ownerId?: string
  readonly channel?: string
}

export let broadcastAuthorizationModelRead = false

export function resetBroadcastAuthorizationModelRead(): void {
  broadcastAuthorizationModelRead = false
}

export class CounterPolicy extends Policy<OwnedCounter> {
  static override readonly id = 'counter'
  static override readonly abilities = [
    'counters.write',
    'counters.update',
    'counters.realtime',
    'broadcast.subscribe',
  ]

  async decide(request: PolicyRequest<OwnedCounter>): Promise<PolicyDecision> {
    if (request.actor.kind !== 'user' || !request.actor.id) {
      return deny('counter', 'authentication_required')
    }
    if (request.ability === 'counters.write' && !request.resource) return allow('counter')
    if (request.ability === 'broadcast.subscribe' && request.resource?.channel) {
      await Counter.find(request.resource.channel.replace(/^counters\./, ''))
      broadcastAuthorizationModelRead = true
    }
    if (
      request.ability === 'broadcast.subscribe' &&
      request.resource?.channel?.startsWith('counters.')
    ) {
      return allow('counter')
    }
    if (!request.resource || request.resource.ownerId !== request.actor.id) {
      return deny('counter', 'counter_owner_required')
    }
    return allow('counter')
  }
}
