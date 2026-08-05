export type Class<T = object> = abstract new (...args: never[]) => T

import type { ObservationKind, ObservationPhase } from './observation.js'

export {
  BroadcastTransport,
  Channel,
  FakeBroadcastTransport,
  PresenceChannel,
  PrivateChannel,
  validateBroadcastChannelName,
  type BroadcastChannelKind,
  type BroadcastConnectionAdmission,
  type BroadcastDestination,
  type BroadcastGateway,
  type BroadcastMessage,
  type RealtimeCommandRequest,
  type RealtimeCommandThrottleDecision,
  type RealtimeCommandThrottleRequest,
  type BroadcastRuntimeRoles,
  type BroadcastSubscriptionAdmission,
  type BroadcastSubscriptionResource,
  type ShouldBroadcast,
  type ShouldBroadcastNow,
} from './broadcasting.js'

export {
  allow,
  Authorization,
  AuthorizationError,
  deny,
  PermissionSource,
  Policy,
  type PermissionSourceRequest,
  type PolicyDecision,
  type PolicyRequest,
} from './authorization.js'

export { Signal, SignalDispatchError, SignalHandler } from './signal.js'
export { Cache, MemoryCache, type CachePutOptions } from './cache.js'
export { Command } from './command.js'
export {
  RealtimeCommand,
  type RealtimeCommandClass,
  type RealtimeCommandError,
  type RealtimeCommandResult,
  type RealtimeCommandThrottle,
} from './realtime-command.js'
export {
  MemoryTelemetry,
  NoopTelemetry,
  Telemetry,
  type TelemetryRecord,
  type TelemetrySpanEnd,
  type TelemetrySpanHandle,
  type TelemetrySpanStart,
} from './telemetry.js'
export {
  AiObservability,
  type AiObservationKind,
  type AiObservedResult,
  type AiOperationMetadata,
  type AiOperationOutcome,
  type AiTokenUsage,
} from './ai-observation.js'
export {
  MemoryObservationRecorder,
  NoopObservationRecorder,
  ObservationRecorder,
  sanitizeObservationAttributes,
  sanitizeObservationError,
  type Observation,
  type ObservationContext,
  type ObservationError,
  type ObservationKind,
  type ObservationPhase,
  type ObservationResource,
} from './observation.js'
export {
  ConsoleLogSink,
  formatPrettyLog,
  Logger,
  LogSink,
  MemoryLogSink,
  NoopLogSink,
  type ConsoleLogSinkOptions,
  type LogContext,
  type LogDestination,
  type LogError,
  type LogFormat,
  type LogLevel,
  type LogRecord,
  type LoggerOptions,
} from './logging.js'
export {
  DeliveryError,
  DeliveryLedger,
  FakeMailTransport,
  FakeSmsTransport,
  MailTransport,
  Mailer,
  Sms,
  SmsTransport,
  type DeliveryAcceptance,
  type DeliveryFailureKind,
  type DeliveryState,
  type DeliveryUpdate,
  type DeliveryTransition,
  type MailMessage,
  type SmsMessage,
  type StagedDelivery,
} from './communications.js'

export {
  Auth,
  type AuthAccessToken,
  type AuthAccessTokenGrant,
  type AuthChallengeGrant,
  type AuthIdentity,
  type AuthIdentityRegistrationFactory,
  type AuthIdentityRegistrationInput,
  type AuthRequestMetadata,
  type AuthSession,
  type AuthSessionGrant,
  type AuthStorageDescription,
  AuthenticationError,
  AuthenticationRateLimitError,
  isRecentPasswordAuthentication,
  type IssueAccessTokenInput,
  type LoginInput,
  type RegistrationInput,
  type ResolvedHttpAuthentication,
} from './auth.js'

import type { Event, Listener } from './event.js'
import type { AuthIdentityRegistrationFactory } from './auth.js'
import type { PermissionSource, Policy } from './authorization.js'
import type { Signal, SignalHandler } from './signal.js'
import type { Route } from './http.js'
import type { Job, Schedule } from './queue.js'
import type { Observer } from './observer.js'
import type { Command } from './command.js'
import type { RealtimeCommand } from './realtime-command.js'
import type { DeliveryTransition, StagedDelivery } from './communications.js'
import { DoxaRole } from './role.js'
import type { ModelQueryPlan, ModelQueryValue } from './model-query.js'

export { DoxaRole, RoleInjectionError, type RoleInjector } from './role.js'
export type { RoleInjectionToken } from './role-context.js'

export type ConfigurationClass<T extends Configuration = Configuration> = abstract new () => T

export type FeatureClass<T extends Feature = Feature> = abstract new () => T

export type DoxaPluginPackage =
  '@doxajs/opentelemetry' | '@doxajs/sendgrid' | '@doxajs/theoria' | '@doxajs/twilio-sms'

export type AuthIdentifierKind = 'email' | 'username' | 'custom'
export type AuthIdentifierNormalization =
  | { readonly preset: 'exact' | 'lowercase' | 'email' }
  | { readonly preset: 'email-or-domain'; readonly domain: string }

export interface AuthIdentifierModelMapping {
  readonly kind: AuthIdentifierKind
  readonly attribute: string
  readonly normalize: AuthIdentifierNormalization
}

export type AuthVerificationModelMapping =
  { readonly mode: 'mapped'; readonly attribute: string } | { readonly mode: 'trusted' }

export type AuthEligibilityModelPredicate =
  | { readonly attribute: string; readonly equals: string | number | boolean | null }
  | { readonly attribute: string; readonly in: readonly (string | number | boolean | null)[] }
  | { readonly attribute: string; readonly null: true }
  | { readonly attribute: string; readonly notNull: true }

export type AuthCredentialReaderPreset = 'doxa-argon2id' | 'bcrypt' | 'argon2id-phc' | 'sha256-hex'

export interface AuthCredentialReaderConfiguration {
  readonly preset: AuthCredentialReaderPreset
  readonly hash: string
}

export type AuthCredentialUpgradeConfiguration =
  | 'never'
  | {
      readonly mode: 'in-place'
      readonly format: 'doxa-argon2id'
      readonly password: string
      readonly updatedAt?: string
    }

export interface AuthCredentialConfiguration {
  readonly table: string
  readonly identityId: string
  readonly readers: readonly AuthCredentialReaderConfiguration[]
  readonly upgrade?: AuthCredentialUpgradeConfiguration
}

export interface AuthModelIdentityConfiguration {
  readonly mode: 'managed' | 'login-only'
  readonly model: Class<Model>
  readonly identifier: AuthIdentifierModelMapping
  readonly contactEmail?: string
  readonly timestamps: { readonly createdAt: string; readonly updatedAt: string }
  /** Omit to disable Doxa email-verification flows for this external identity source. */
  readonly verification?: AuthVerificationModelMapping
  readonly eligibility?: readonly AuthEligibilityModelPredicate[]
  readonly credentials: AuthCredentialConfiguration
  readonly registrationFactory?: Class<AuthIdentityRegistrationFactory>
}

export interface AuthRawIdentityConfiguration {
  readonly mode: 'login-only'
  readonly table: string
  readonly columns: {
    readonly id: string
    readonly identifier: string
    readonly contactEmail?: string
    readonly createdAt: string
    readonly updatedAt: string
    readonly verification?: string
  }
  readonly identifier: {
    readonly kind: AuthIdentifierKind
    readonly normalize: AuthIdentifierNormalization
  }
  /** Omit to disable Doxa email-verification flows for this external identity source. */
  readonly verification?: { readonly mode: 'mapped' | 'trusted' }
  readonly eligibility?: readonly (
    | { readonly column: string; readonly equals: string | number | boolean | null }
    | { readonly column: string; readonly in: readonly (string | number | boolean | null)[] }
    | { readonly column: string; readonly null: true }
    | { readonly column: string; readonly notNull: true }
  )[]
  readonly credentials: AuthCredentialConfiguration
}

export type AuthIdentityConfiguration =
  AuthModelIdentityConfiguration | AuthRawIdentityConfiguration

export interface DoxaTheoriaConfiguration {
  readonly profile?: 'development' | 'production-diagnostics'
  readonly productionEnabled?: boolean
  readonly sampleRate?: number
  readonly includeKinds?: readonly ObservationKind[]
  readonly includePhases?: readonly ObservationPhase[]
  readonly includeNames?: readonly string[]
  readonly minimumDurationMilliseconds?: number
  readonly maximumPending?: number
  readonly overflowPolicy?: 'drop-oldest' | 'drop-newest'
  readonly batchSize?: number
  readonly flushIntervalMilliseconds?: number
  readonly hotRetentionDays?: number
  readonly warmRetentionDays?: number
  readonly maximumObservations?: number
  readonly poolMaximum?: number
  readonly serviceName?: string
  readonly environment?: string
  readonly release?: string
  readonly instanceId?: string
}

export interface DoxaFrameworkConfiguration {
  readonly database?: {
    readonly applicationName?: string
  }
  readonly auth?: {
    readonly secureCookies?: boolean
    readonly trustedOrigins?: readonly string[]
    readonly identity?: AuthIdentityConfiguration
  }
  readonly queue?: {
    readonly localConcurrency?: number
    readonly outboxPollingMilliseconds?: number
  }
  readonly broadcasting?: {
    readonly enabled?: boolean
  }
  readonly theoria?: DoxaTheoriaConfiguration
}

/**
 * Compile-time application declaration. Doxa never constructs this class.
 */
export abstract class DoxaApplication {
  declare readonly id: string
  declare readonly features: readonly FeatureClass[]
  declare readonly configs?: readonly ConfigurationClass[]
  declare readonly plugins?: readonly DoxaPluginPackage[]
  declare readonly framework?: DoxaFrameworkConfiguration
}

/**
 * Compile-time feature declaration. Doxa never constructs this class.
 */
export abstract class Feature {
  declare readonly id: string
  declare readonly configs?: readonly ConfigurationClass[]
  /** Intentionally exported ordinary services. Their declared service scope is preserved. */
  declare readonly provides?: readonly Class[]
  declare readonly providers?: readonly Class[]
  declare readonly actions?: readonly ActionClass[]
  declare readonly queries?: readonly QueryClass[]
  declare readonly models?: readonly Class<Model>[]
  declare readonly observers?: readonly Class<Observer>[]
  declare readonly routes?: readonly Class<Route>[]
  declare readonly events?: readonly Class<Event<unknown>>[]
  declare readonly listeners?: readonly Class<Listener<any>>[]
  declare readonly jobs?: readonly Class<Job>[]
  declare readonly schedules?: readonly Class<Schedule>[]
  declare readonly policies?: readonly Class<Policy>[]
  /** At most one permission source may be selected across the application. */
  declare readonly permissionSources?: readonly Class<PermissionSource>[]
  declare readonly signals?: readonly Class<Signal<unknown>>[]
  declare readonly signalHandlers?: readonly Class<SignalHandler<any>>[]
  declare readonly commands?: readonly Class<Command>[]
  declare readonly realtimeCommands?: readonly Class<RealtimeCommand<unknown>>[]
}

export {
  CurrentJob,
  type CurrentJobContext,
  Job,
  type JobConstructor,
  type JobDispatchOptions,
  JobDispatchError,
  type QueueDelivery,
  type QueueDeliveryHandler,
  type QueueEnvelope,
  type QueueExecutionEnvelope,
  type QueueJobRecord,
  QueueManager,
  type QueuePolicy,
  type QueueRuntimeRoles,
  Schedule,
  type ScheduleDefinition,
  type ScheduleMisfirePolicy,
  type ScheduleOverlapPolicy,
} from './queue.js'

export {
  DomainEvent,
  Event,
  EventDispatchError,
  Listener,
  type ShouldDispatchAfterCommit,
  type ShouldHandleEventsAfterCommit,
  type ShouldQueue,
  type ShouldQueueAfterCommit,
} from './event.js'

export {
  Http,
  HttpError,
  httpFailure,
  httpSuccess,
  type HttpEnvelope,
  type HttpEngine,
  type HttpFailure,
  type HttpMethod,
  HttpRequest,
  type HttpSuccess,
  type HttpValidationIssue,
  HttpValidationError,
  Route,
  type StandardSchema,
  type StandardSchemaIssue,
} from './http.js'

export {
  DetachedModelError,
  Model,
  ModelIdentityMutationError,
  ReadOnlyModelError,
  AuthOwnedModelAttributeError,
  ModelNotFoundError,
  ModelNotRegisteredError,
  StaleModelError,
  UnknownModelAttributeError,
  type ModelAttributes,
  type ModelAttributePatch,
  type ModelChanges,
  type ModelConstructor,
  type ModelJournalFact,
  type ModelOutboxMessage,
  type ModelQueryDiagnostic,
  type ModelOperationDiagnostic,
  type ModelOperationObserver,
  type ModelRelations,
} from './model.js'
export {
  applyModelQueryPlan,
  InvalidModelCursorError,
  MODEL_QUERY_MAX_PAGE_SIZE,
  ModelQuery,
  ModelQueryError,
  validateModelQueryPlan,
  type ModelCursorPage,
  type ModelEagerLoadConstraints,
  type ModelPage,
  type ModelQueryConstraint,
  type ModelQueryDirection,
  type ModelQueryOperator,
  type ModelQueryOrder,
  type ModelQueryPlan,
  type ModelQueryPredicate,
  type ModelQueryValue,
  type ModelRelationPath,
} from './model-query.js'
export {
  belongsTo,
  belongsToMany,
  hasMany,
  hasOne,
  type ModelRelationship,
} from './model-relation.js'
export { Observer, type ModelObserverDispatcher, type ModelObserverPhase } from './observer.js'
import type { Model, ModelAttributes, ModelConstructor } from './model.js'

/**
 * Typed configuration declaration. Doxa materializes instances without invoking constructors
 * or property initializers.
 */
export abstract class Configuration {}

export class SecretString {
  #value: string

  private constructor(value: string) {
    this.#value = value
    Object.freeze(this)
  }

  static from(value: string): SecretString {
    return new SecretString(value)
  }

  reveal(): string {
    return this.#value
  }

  toString(): string {
    return '[REDACTED]'
  }

  toJSON(): string {
    return '[REDACTED]'
  }

  [Symbol.toPrimitive](): string {
    return '[REDACTED]'
  }
}

export abstract class Action<Input = void, Output = void> extends DoxaRole {
  static readonly access: string = ''
  abstract handle(input: Input): Output | Promise<Output>
}

export abstract class Query<Input = void, Output = void> extends DoxaRole {
  static readonly access: string = ''
  abstract handle(input: Input): Output | Promise<Output>
}

export type ActionClass<Input = unknown, Output = unknown> = abstract new (
  ...dependencies: never[]
) => Action<Input, Output>

export type QueryClass<Input = unknown, Output = unknown> = abstract new (
  ...dependencies: never[]
) => Query<Input, Output>

export abstract class ActionBus {
  abstract execute<Input, Output>(
    action: ActionClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>>
}

export abstract class QueryBus {
  abstract execute<Input, Output>(
    query: QueryClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>>
}

/** Compiler-recognized capability for a service cached once per admitted execution. */
export interface ExecutionScoped {}

export type ActorKind = 'anonymous' | 'user' | 'service' | 'system'

export interface ActorRef {
  readonly kind: ActorKind
  readonly id?: string
}

export interface DelegationHop {
  readonly from: ActorRef
  readonly to: ActorRef
  readonly grantId: string
  readonly reason: string
  readonly expiresAt?: Date
}

export interface TenantRef {
  readonly id: string
}

export interface AuthenticationContext {
  readonly state: 'anonymous' | 'authenticated'
  readonly identityId?: string
  readonly method?: string
  readonly assurance?: 'single-factor' | 'multi-factor' | 'phishing-resistant'
  readonly authenticatedAt?: Date
  readonly sessionId?: string
  readonly credentialId?: string
  readonly constraints?: readonly string[]
}

export interface TransportContext {
  readonly kind: 'http' | 'job' | 'schedule' | 'console' | 'websocket' | 'test' | 'internal'
  readonly name?: string
}

export interface SpanLink {
  readonly traceId: string
  readonly spanId: string
  readonly attributes?: Readonly<Record<string, JsonValue>>
}

export interface TraceContext {
  readonly traceId?: string
  readonly spanId?: string
  readonly parentSpanId?: string
  readonly isRemote?: boolean
  readonly parentIsRemote?: boolean
  readonly traceFlags?: number
  readonly links?: readonly SpanLink[]
}

export interface ExecutionContext {
  readonly executionId: string
  readonly sourceExecutionId?: string
  readonly correlationId: string
  readonly causationId?: string
  readonly actor: ActorRef
  readonly initiator: ActorRef
  readonly delegation: readonly DelegationHop[]
  readonly tenant?: TenantRef
  readonly authentication: AuthenticationContext
  readonly transport: TransportContext
  readonly trace: TraceContext
  readonly locale?: string
  readonly timeZone?: string
  readonly deadline?: Date
  readonly cancellation: AbortSignal
}

export interface ExecutionContextSeed {
  readonly sourceExecutionId?: string
  readonly correlationId?: string
  readonly causationId?: string
  readonly actor: ActorRef
  readonly initiator?: ActorRef
  readonly delegation?: readonly DelegationHop[]
  readonly tenant?: TenantRef
  readonly authentication?: AuthenticationContext
  readonly transport: TransportContext
  readonly trace?: TraceContext
  readonly locale?: string
  readonly timeZone?: string
  readonly deadline?: Date
  readonly cancellation?: AbortSignal
}

export type OperationMode = 'action' | 'job' | 'query' | 'realtime-command' | undefined

/** The immutable context and mutation guard for the currently admitted execution. */
export abstract class CurrentExecution {
  abstract get context(): ExecutionContext
  abstract get mode(): OperationMode
  abstract assertWritable(): void
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface PersistedEntity<State extends JsonValue = JsonValue> {
  readonly type: string
  readonly id: string
  readonly version: number
  readonly state: State
}

export interface TableModelTimestamps {
  readonly createdAt: string
  readonly updatedAt: string
}

export type ModelStorage =
  | { readonly kind: 'entity-state' }
  | {
      readonly kind: 'table'
      readonly table: string
      readonly primaryKey: string
      readonly columns: Readonly<Record<string, string>>
      readonly attributeTypes?: Readonly<
        Record<
          string,
          {
            readonly kind: 'string' | 'number' | 'boolean' | 'date' | 'json'
            readonly nullable: boolean
            readonly optional: boolean
          }
        >
      >
      readonly optionalAttributes?: readonly string[]
      readonly versionColumn?: string
      readonly versionSource?:
        | { readonly kind: 'column'; readonly column: string }
        | { readonly kind: 'xmin' }
        | { readonly kind: 'none' }
      readonly timestamps: false | TableModelTimestamps
      readonly managed?: boolean
      readonly readOnly?: boolean
    }

export interface CompiledModelStorage {
  readonly entityType: string
  readonly storage: ModelStorage
}

export interface SaveEntity<State extends JsonValue = JsonValue> {
  readonly type: string
  readonly id: string
  readonly expectedVersion?: number
  readonly state: State
  /** Declared dirty state used for updates; inserts continue to use the complete declared state. */
  readonly patch?: Readonly<Record<string, JsonValue>>
  /** Logical attributes removed from a previously persisted state; column adapters clear them. */
  readonly removedAttributes?: readonly string[]
  readonly storage?: ModelStorage
}

export interface SavedEntity {
  readonly version: number
  readonly id?: string
}

export interface JournalFact<Payload extends JsonValue = JsonValue> {
  readonly type: string
  readonly version?: number
  readonly entityType: string
  readonly entityId: string
  readonly payload: Payload
}

export interface OutboxMessage<Payload extends JsonValue = JsonValue> {
  readonly type: string
  readonly payload: Payload
  readonly availableAt?: Date
}

/** Read-only persistence boundary used by model queries in every execution mode. */
export abstract class ModelReader {
  abstract findEntity<State extends JsonValue = JsonValue>(
    type: string,
    id: string,
    storage?: ModelStorage,
  ): Promise<PersistedEntity<State> | undefined>

  abstract queryEntities<State extends JsonValue = JsonValue>(
    type: string,
    storage: ModelStorage,
    plan: ModelQueryPlan,
  ): Promise<readonly PersistedEntity<State>[]>

  abstract aggregateEntities(
    type: string,
    storage: ModelStorage,
    plan: ModelQueryPlan,
    operation: 'count' | 'min' | 'max' | 'sum' | 'average',
    attribute?: string,
  ): Promise<number | ModelQueryValue | undefined>
}

/** Writable transaction boundary; actions and jobs also use it as their model reader. */
export abstract class UnitOfWork extends ModelReader {
  abstract saveEntity<State extends JsonValue>(
    entity: SaveEntity<State>,
  ): Promise<number | SavedEntity>
  abstract deleteEntity(
    type: string,
    id: string,
    expectedVersion: number,
    storage?: ModelStorage,
  ): Promise<void>
  abstract record<Payload extends JsonValue>(fact: JournalFact<Payload>): Promise<string>
  abstract enqueue<Payload extends JsonValue>(message: OutboxMessage<Payload>): Promise<string>
  abstract stageDelivery(delivery: StagedDelivery): Promise<void>
  abstract transitionDelivery(transition: DeliveryTransition): Promise<void>
  abstract afterCommit(callback: () => void | Promise<void>): void
}

export class PersistenceError extends Error {
  override readonly name: string = 'PersistenceError'
}

export class OptimisticConcurrencyError extends PersistenceError {
  override readonly name = 'OptimisticConcurrencyError'

  constructor(
    readonly entityType: string,
    readonly entityId: string,
    readonly expectedVersion: number | undefined,
  ) {
    super(
      `Entity ${entityType}/${entityId} does not match expected version ${String(expectedVersion)}.`,
    )
  }
}

export class ReadOnlyExecutionError extends PersistenceError {
  override readonly name = 'ReadOnlyExecutionError'
}

export class StaleUnitOfWorkError extends PersistenceError {
  override readonly name = 'StaleUnitOfWorkError'
}

export class AfterCommitError extends PersistenceError {
  override readonly name = 'AfterCommitError'

  constructor(readonly errors: readonly unknown[]) {
    super(
      `After-commit processing failed ${errors.length} time(s) after durability was established.`,
    )
  }
}

/** Infrastructure boundary used by the runtime for every action transaction. */
export abstract class TransactionManager {
  /** Whether one transaction serializes overlapping model operations on shared transport. */
  readonly serializesConcurrentOperations: boolean = false

  bindCompiledModels(_models: readonly CompiledModelStorage[]): void {}

  abstract read<Output>(
    context: ExecutionContext,
    work: (reader: ModelReader) => Promise<Output>,
  ): Promise<Output>

  abstract transaction<Output>(
    context: ExecutionContext,
    work: (unitOfWork: UnitOfWork) => Promise<Output>,
  ): Promise<Output>
}

export interface LifecycleContext {
  readonly signal: AbortSignal
  readonly deadline: Date
}

export interface Starts {
  start(context: LifecycleContext): void | Promise<void>
}

export interface Drains {
  drain(context: LifecycleContext): void | Promise<void>
}

export interface Stops {
  stop(context: LifecycleContext): void | Promise<void>
}

export interface Disposes {
  dispose(context: LifecycleContext): void | Promise<void>
}
