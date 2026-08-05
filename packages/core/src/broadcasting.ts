import type {
  ActorRef,
  AuthenticationContext,
  DoxaValue,
  JsonValue,
  RealtimeCommandResult,
  RealtimeCommandThrottle,
  TenantRef,
} from './index.js'

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
  broadcastWith?(): DoxaValue
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
  readonly initiator?: ActorRef
  readonly delegation?: readonly import('./index.js').DelegationHop[]
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

export interface RealtimeCommandRequest {
  readonly id: string
  readonly command: string
  readonly payload: unknown
}

export interface RealtimeCommandThrottleRequest {
  readonly actorId: string
  readonly command: string
  readonly requestId: string
  readonly throttle: RealtimeCommandThrottle
}

export interface RealtimeCommandThrottleDecision {
  readonly allowed: boolean
  readonly retryAfterMs?: number
}

export interface BroadcastGateway {
  connect(connectionId: string, request: Request): Promise<BroadcastConnectionAdmission>
  validate?(admission: BroadcastConnectionAdmission): Promise<boolean>
  subscribe(
    admission: BroadcastConnectionAdmission,
    destination: BroadcastDestination,
  ): Promise<BroadcastSubscriptionAdmission>
  unsubscribe(
    admission: BroadcastConnectionAdmission,
    destination: BroadcastDestination,
  ): Promise<void>
  command(
    admission: BroadcastConnectionAdmission,
    request: RealtimeCommandRequest,
  ): Promise<RealtimeCommandResult>
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
  abstract consumeRealtimeCommandThrottle(
    request: RealtimeCommandThrottleRequest,
  ): Promise<RealtimeCommandThrottleDecision>
}

export class FakeBroadcastTransport extends BroadcastTransport {
  readonly published: BroadcastMessage[] = []
  #gateway?: BroadcastGateway
  readonly #commandAttempts = new Map<string, { attempts: number[]; expiresAt: number }>()

  bind(gateway: BroadcastGateway): void {
    if (this.#gateway) throw new Error('The Doxa broadcast gateway is already bound.')
    this.#gateway = gateway
  }

  async publish(message: BroadcastMessage): Promise<void> {
    this.published.push(structuredClone(message))
  }

  async consumeRealtimeCommandThrottle(
    request: RealtimeCommandThrottleRequest,
  ): Promise<RealtimeCommandThrottleDecision> {
    const now = Date.now()
    for (const [attemptKey, bucket] of this.#commandAttempts)
      if (bucket.expiresAt <= now) this.#commandAttempts.delete(attemptKey)
    const key = JSON.stringify([request.actorId, request.command])
    const cutoff = now - request.throttle.windowMs
    const attempts = (this.#commandAttempts.get(key)?.attempts ?? []).filter(
      (value) => value > cutoff,
    )
    if (attempts.length >= request.throttle.limit) {
      this.#commandAttempts.set(key, {
        attempts,
        expiresAt: attempts.at(-1)! + request.throttle.windowMs,
      })
      return {
        allowed: false,
        retryAfterMs: Math.max(1, attempts[0]! + request.throttle.windowMs - now),
      }
    }
    attempts.push(now)
    this.#commandAttempts.set(key, { attempts, expiresAt: now + request.throttle.windowMs })
    return { allowed: true }
  }

  connect(connectionId: string, request: Request): Promise<BroadcastConnectionAdmission> {
    return this.#requireGateway().connect(connectionId, request)
  }

  validate(admission: BroadcastConnectionAdmission): Promise<boolean> {
    return this.#requireGateway().validate?.(admission) ?? Promise.resolve(true)
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

  command(
    admission: BroadcastConnectionAdmission,
    request: RealtimeCommandRequest,
  ): Promise<RealtimeCommandResult> {
    return this.#requireGateway().command(admission, request)
  }

  reset(): void {
    this.published.length = 0
    this.#commandAttempts.clear()
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
