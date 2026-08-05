import { currentJobDispatcher } from './queue-context.js'
import { DoxaRole } from './role.js'
import type { ActorRef, JsonValue, SpanLink, TenantRef, TraceContext } from './index.js'

export interface JobDispatchOptions {
  readonly delaySeconds?: number
  readonly idempotencyKey?: string
}

export type JobConstructor<Instance extends Job<Input>, Input> = {
  new (...dependencies: never[]): Instance
  readonly id: string
}

export class JobDispatchError extends Error {
  override readonly name = 'JobDispatchError'
}

export abstract class Job<Input = unknown, Output = void> extends DoxaRole {
  static readonly id: string = ''
  static readonly access: string = ''
  static readonly retries: number = 3
  static readonly retryDelay: number = 1
  static readonly backoff: boolean = true
  static readonly timeout: number = 30

  static dispatch<Input, Instance extends Job<Input>>(
    this: JobConstructor<Instance, Input>,
    input: Input,
    options?: JobDispatchOptions,
  ): Promise<string> {
    const dispatcher = currentJobDispatcher()
    if (!dispatcher) {
      throw new JobDispatchError('Job dispatch requires an active Doxa-managed execution.')
    }
    return dispatcher.dispatch(this, input, options)
  }

  abstract handle(input: Input): Output | Promise<Output>
}

export type ScheduleOverlapPolicy = 'allow' | 'serialize'
export type ScheduleMisfirePolicy = 'skip' | 'catch-up-once'

/**
 * Compile-time schedule declaration. Doxa never constructs this class.
 * A schedule owns timing; its target Job continues to own execution.
 */
export abstract class Schedule<Input = unknown> {
  static readonly id: string = ''
  static readonly access: string = ''
  declare static readonly job: JobConstructor<Job<unknown>, unknown>
  declare static readonly cron: string | undefined
  declare static readonly everySeconds: number | undefined
  static readonly timeZone: string = 'UTC'
  static readonly overlap: ScheduleOverlapPolicy = 'serialize'
  static readonly misfire: ScheduleMisfirePolicy = 'skip'
  declare static readonly input: unknown
}

export interface ScheduleDefinition {
  readonly id: string
  readonly targetId: string
  readonly cadence:
    | { readonly kind: 'cron'; readonly expression: string }
    | { readonly kind: 'interval'; readonly seconds: number }
  readonly timeZone: string
  readonly overlap: ScheduleOverlapPolicy
  readonly misfire: ScheduleMisfirePolicy
  readonly input: JsonValue
  readonly policy: QueuePolicy
}

export interface QueuePolicy {
  readonly retries: number
  readonly retryDelay: number
  readonly backoff: boolean
  readonly timeout: number
}

export interface QueueExecutionEnvelope {
  readonly version: 1
  readonly sourceExecutionId: string
  readonly correlationId: string
  readonly causationId?: string
  readonly actor: ActorRef
  readonly initiator: ActorRef
  readonly delegation: readonly {
    readonly from: ActorRef
    readonly to: ActorRef
    readonly grantId: string
    readonly reason: string
    readonly expiresAt?: string
  }[]
  readonly tenant?: TenantRef
  readonly authentication: {
    readonly state: 'anonymous' | 'authenticated'
    readonly identityId?: string
    readonly method?: string
    readonly assurance?: 'single-factor' | 'multi-factor' | 'phishing-resistant'
    readonly authenticatedAt?: string
    readonly credentialId?: string
    readonly constraints?: readonly string[]
  }
  readonly trace: TraceContext
  readonly locale?: string
  readonly timeZone?: string
}

export interface QueueEnvelope {
  readonly id: string
  readonly kind: 'job' | 'listener' | 'broadcast' | 'mail' | 'sms'
  readonly targetId: string
  readonly scheduleId?: string
  readonly eventId?: string
  readonly eventVersion?: number
  readonly payload: JsonValue
  readonly context: QueueExecutionEnvelope
  readonly policy: QueuePolicy
  readonly availableAt?: string
  readonly idempotencyKey?: string
}

export interface QueueDelivery {
  readonly envelope: QueueEnvelope
  readonly attempt: number
  readonly cancellation: AbortSignal
}

export type QueueDeliveryHandler = (delivery: QueueDelivery) => Promise<void>

export interface QueueJobRecord {
  readonly id: string
  readonly state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed'
  readonly retryCount: number
  readonly retryLimit: number
  readonly output?: unknown
}

export abstract class QueueManager {
  selectRoles(_roles: QueueRuntimeRoles): void {}
  abstract bind(handler: QueueDeliveryHandler): void
  abstract reconcileSchedules(schedules: readonly ScheduleDefinition[]): void
  abstract enqueue(envelope: QueueEnvelope): Promise<string>
  abstract flushOutbox(): Promise<number>
  abstract findJob(id: string): Promise<QueueJobRecord | undefined>
  abstract findAttemptTrace(id: string, attempt: number): Promise<SpanLink | undefined>
  abstract recordAttemptTrace(id: string, attempt: number, trace: SpanLink): Promise<void>
  abstract clearAttemptTraces(id: string): Promise<void>
}

export interface QueueRuntimeRoles {
  readonly worker: boolean
  readonly scheduler: boolean
}

export interface CurrentJobContext {
  readonly id: string
  readonly attempt: number
  readonly maxAttempts: number
  readonly idempotencyKey?: string
}

export abstract class CurrentJob {
  abstract get context(): CurrentJobContext
}
