import type { ActorRef, AuthenticationContext, JsonValue, TenantRef } from './index.js'

export type BroadcastChannelKind = 'public' | 'private' | 'presence'

export interface BroadcastDestination {
  readonly name: string
  readonly kind: BroadcastChannelKind
}

export class Channel implements BroadcastDestination {
  readonly kind: BroadcastChannelKind = 'public'
  readonly name: string

  constructor(name: string) {
    this.name = validateBroadcastChannelName(name)
    if (new.target === Channel) Object.freeze(this)
  }
}

export class PrivateChannel extends Channel {
  override readonly kind: BroadcastChannelKind = 'private'
  constructor(name: string) {
    super(name)
    Object.freeze(this)
  }
}

export class PresenceChannel extends Channel {
  override readonly kind: BroadcastChannelKind = 'presence'
  constructor(name: string) {
    super(name)
    Object.freeze(this)
  }
}

export interface ShouldBroadcast {
  broadcastOn(): BroadcastDestination | readonly BroadcastDestination[]
  broadcastAs?(): string
  broadcastWith?(): JsonValue
}

export interface ShouldBroadcastNow extends ShouldBroadcast {}

export interface BroadcastMessage {
  readonly id: string
  readonly event: string
  readonly channels: readonly BroadcastDestination[]
  readonly data: JsonValue
  readonly occurredAt: string
}

export interface BroadcastConnectionAdmission {
  readonly connectionId: string
  readonly actor: ActorRef
  readonly authentication: AuthenticationContext
  readonly tenant?: TenantRef
  readonly correlationId: string
}

export interface BroadcastSubscriptionResource {
  readonly channel: string
  readonly kind: Exclude<BroadcastChannelKind, 'public'>
}

export interface BroadcastSubscriptionAdmission {
  readonly member?: ActorRef
}

export interface BroadcastGateway {
  connect(connectionId: string, request: Request): Promise<BroadcastConnectionAdmission>
  subscribe(
    admission: BroadcastConnectionAdmission,
    destination: BroadcastDestination,
  ): Promise<BroadcastSubscriptionAdmission>
  unsubscribe(
    admission: BroadcastConnectionAdmission,
    destination: BroadcastDestination,
  ): Promise<void>
}

export interface BroadcastRuntimeRoles {
  readonly web: boolean
  readonly worker: boolean
  readonly scheduler: boolean
  readonly requiresRemotePublishing: boolean
}

export abstract class BroadcastTransport {
  selectRoles(_roles: BroadcastRuntimeRoles): void {}
  abstract bind(gateway: BroadcastGateway): void
  abstract publish(message: BroadcastMessage): Promise<void>
}

export class FakeBroadcastTransport extends BroadcastTransport {
  readonly published: BroadcastMessage[] = []
  #gateway?: BroadcastGateway

  bind(gateway: BroadcastGateway): void {
    if (this.#gateway) throw new Error('The Doxa broadcast gateway is already bound.')
    this.#gateway = gateway
  }

  async publish(message: BroadcastMessage): Promise<void> {
    this.published.push(structuredClone(message))
  }

  connect(connectionId: string, request: Request): Promise<BroadcastConnectionAdmission> {
    return this.#requireGateway().connect(connectionId, request)
  }

  subscribe(
    admission: BroadcastConnectionAdmission,
    destination: BroadcastDestination,
  ): Promise<BroadcastSubscriptionAdmission> {
    return this.#requireGateway().subscribe(admission, destination)
  }

  unsubscribe(
    admission: BroadcastConnectionAdmission,
    destination: BroadcastDestination,
  ): Promise<void> {
    return this.#requireGateway().unsubscribe(admission, destination)
  }

  reset(): void {
    this.published.length = 0
  }

  #requireGateway(): BroadcastGateway {
    if (!this.#gateway) throw new Error('The Doxa runtime has not bound the broadcast gateway.')
    return this.#gateway
  }
}

export function validateBroadcastChannelName(name: string): string {
  const normalized = name.trim()
  if (
    normalized.length === 0 ||
    normalized.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(normalized)
  ) {
    throw new TypeError(
      'Broadcast channel names must be 1-200 characters using letters, numbers, dot, underscore, colon, or hyphen.',
    )
  }
  return normalized
}
