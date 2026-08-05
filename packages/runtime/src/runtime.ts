import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ActionBus,
  AiObservability,
  type AiOperationMetadata,
  type AiOperationOutcome,
  type AiObservedResult,
  Auth,
  type AuthIdentityRegistrationFactory,
  type BroadcastConnectionAdmission,
  type BroadcastDestination,
  type BroadcastMessage,
  type BroadcastSubscriptionAdmission,
  type BroadcastSubscriptionResource,
  type RealtimeCommandRequest,
  type RealtimeCommandResult,
  BroadcastTransport,
  validateBroadcastChannelName,
  Authorization,
  AuthorizationError,
  Cache,
  QueryBus,
  type Action,
  type ActionClass,
  type ActorRef,
  type DoxaApplication,
  type Command,
  CurrentExecution,
  CurrentJob,
  type Event,
  type DomainEvent,
  type ExecutionContext,
  type ExecutionContextSeed,
  HttpRequest,
  Instant,
  type Job,
  type JobConstructor,
  type JobDispatchOptions,
  type LifecycleContext,
  type Listener,
  Mailer,
  Logger,
  ConsoleLogSink,
  type ConsoleLogSinkOptions,
  type LogLevel,
  type LogSink,
  type MailMessage,
  MailTransport,
  type Model,
  type ModelAttributes,
  type ModelConstructor,
  type ModelQueryConstraint,
  type ModelQueryDiagnostic,
  type ModelQueryOperator,
  type ModelQueryOrder,
  type ModelQueryValue,
  type ModelObserverDispatcher,
  type ModelObserverPhase,
  type ModelOperationObserver,
  type Query,
  type QueryClass,
  type RealtimeCommand,
  type StandardSchema,
  type OperationMode,
  type Observer,
  type Observation,
  type ObservationContext,
  type ObservationKind,
  ObservationRecorder,
  NoopObservationRecorder,
  type Policy,
  type PolicyDecision,
  type PermissionSource,
  ReadOnlyExecutionError,
  type QueueDelivery,
  type QueueEnvelope,
  type QueueExecutionEnvelope,
  QueueManager,
  type ScheduleDefinition,
  type Route,
  type ResolvedHttpAuthentication,
  SecretString,
  Sms,
  type SmsMessage,
  SmsTransport,
  DeliveryError,
  DeliveryLedger,
  type DeliveryTransition,
  type Signal,
  type SignalHandler,
  TransactionManager,
  Telemetry,
  NoopTelemetry,
  sanitizeObservationAttributes,
  sanitizeObservationError,
  type TelemetryRecord,
  type TelemetrySpanHandle,
  type TraceContext,
  UnitOfWork,
} from '@doxajs/core'
import {
  currentModelSessionState,
  decodeDateTimeValues,
  encodeDateTimeStrings,
  encodeDateTimeValues,
  type EventDispatcher,
  type JobDispatcher,
  markPrivacySensitiveError,
  ModelSession,
  runWithEventDispatcher,
  runWithDateTimeContext,
  runWithJobDispatcher,
  runWithLogContext,
  runWithModelSession,
  runWithRoleConstruction,
  type RoleConstructionContext,
  runWithSignalDispatcher,
  safeDiagnosticError,
  type RoleInjectionToken,
  type SignalDispatcher,
} from '@doxajs/core/runtime'
import {
  MANIFEST_FORMAT_VERSION,
  assertManifest,
  canonicalJson,
  type DoxaManifest,
  type CommandManifestEntry,
  type ConfigurationDefault,
  type ConfigurationManifestEntry,
  type ConfigurationPropertyManifest,
  type EventManifestEntry,
  type ListenerManifestEntry,
  type JobManifestEntry,
  type OperationManifestEntry,
  type ObserverManifestEntry,
  type PermissionSourceManifestEntry,
  type ProviderManifestEntry,
  type PolicyManifestEntry,
  type RealtimeCommandManifestEntry,
  type RegistryModule,
  type RouteManifestEntry,
  type SignalHandlerManifestEntry,
  type SignalManifestEntry,
} from '@doxajs/manifest'

import {
  ConfigurationValidationError,
  ExecutionAdmissionError,
  ExecutionCleanupError,
  ExecutionFailureError,
  OperationDispatchError,
  RuntimeBootError,
  RuntimeIntegrityError,
  RuntimeShutdownError,
} from './errors.js'
import {
  invokeLifecycle,
  invokePhase,
  unwindStartup,
  type LifecycleDeadlines,
  type LifecycleParticipant,
} from './lifecycle.js'
import { ObservationLogSink } from './observation-log-sink.js'

export {
  ConfigurationValidationError,
  ExecutionAdmissionError,
  ExecutionCleanupError,
  ExecutionFailureError,
  OperationDispatchError,
  RuntimeBootError,
  RuntimeIntegrityError,
  RuntimeShutdownError,
} from './errors.js'

export type RuntimeState = 'booting' | 'ready' | 'draining' | 'stopping' | 'disposing' | 'stopped'
export type RuntimeProfile = 'application' | 'model-reader'

type ApplicationDeclaration = abstract new () => DoxaApplication

export interface DoxaClock {
  now(): bigint
}

const systemClock: DoxaClock = Object.freeze({
  now: () => {
    const nanoseconds = Temporal.Now.instant().epochNanoseconds
    return (nanoseconds / 1_000n) * 1_000n
  },
})

export interface BootOptions {
  readonly artifactsDirectory?: string
  readonly profile?: RuntimeProfile
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly dotenvPath?: string | false
  readonly configurationOverrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly deadlines?: Partial<LifecycleDeadlines>
  readonly roles?: Partial<{
    readonly web: boolean
    readonly worker: boolean
    readonly scheduler: boolean
  }>
  readonly providerOverrides?: Readonly<Record<string, object>>
  /** Runtime clock override used by @doxajs/testing. */
  readonly clock?: DoxaClock
  /** Used by @doxajs/testing to record and selectively fake Event delivery before boot. */
  readonly eventTestHook?: EventTestHook
  readonly logging?:
    | false
    | {
        readonly level?: LogLevel
        readonly sink?: LogSink
        readonly format?: ConsoleLogSinkOptions['format']
        readonly color?: boolean
        readonly destination?: ConsoleLogSinkOptions['destination']
      }
}

export interface EventTestHook {
  shouldFake(event: Event<unknown>): boolean
  dispatched(input: {
    readonly id: string
    readonly event: Event<unknown>
    readonly context: ExecutionContext
  }): boolean
}

export interface ModelRecordQuery {
  readonly modelId: string
  readonly fields: readonly string[]
  readonly filters?: readonly {
    readonly attribute: string
    readonly operator: ModelQueryOperator
    readonly value: ModelQueryValue
  }[]
  readonly orderBy?: readonly ModelQueryOrder[]
  readonly limit?: number
}

export interface ModelRecordQueryResult {
  readonly modelId: string
  readonly fields: readonly string[]
  readonly rows: readonly Readonly<Record<string, unknown>>[]
  readonly returned: number
  readonly truncated: boolean
  readonly executionId: string
}

const DEFAULT_DEADLINES: LifecycleDeadlines = {
  start: 10_000,
  drain: 10_000,
  stop: 10_000,
  dispose: 10_000,
}

interface RuntimeArtifacts {
  readonly manifest: DoxaManifest
  readonly registry: RegistryModule
}

interface RuntimeGraph {
  readonly participants: readonly LifecycleParticipant[]
  readonly singletonInstances: ReadonlyMap<string, object>
  readonly configurations: ReadonlyMap<string, object>
}

interface ExecutionStore {
  readonly context: ExecutionContext
  readonly scope: ExecutionScope
  readonly operationStack: ('action' | 'job' | 'query' | 'realtime-command')[]
  readonly boundary?: 'realtime-command'
  permissionAbilities?: Promise<ReadonlySet<string>>
  job?: import('@doxajs/core').CurrentJobContext
}

interface ManagedIdentityRegistrationRequest {
  readonly id: string
  readonly identifier: string
  readonly contactEmail?: string
  readonly createdAt: Instant
  readonly updatedAt: Instant
  readonly persistAuthentication: (transaction: unknown, identityId: string) => Promise<void>
}

interface FrameworkTransactionManager extends TransactionManager {
  frameworkTransaction<Output>(
    context: ExecutionContext,
    work: (unitOfWork: UnitOfWork, transaction: unknown) => Promise<Output>,
  ): Promise<Output>
}

export class DoxaRuntime {
  #state: RuntimeState = 'booting'
  #shutdownPromise?: Promise<void>
  readonly #storage = new AsyncLocalStorage<ExecutionStore>()
  readonly #traceStorage = new AsyncLocalStorage<TraceContext>()
  readonly #permissionSourceResolution = new AsyncLocalStorage<boolean>()
  readonly #activeExecutions = new Map<Promise<unknown>, AbortController>()
  readonly #operationsByConstructor = new Map<Function, OperationManifestEntry>()
  readonly #modelsByConstructor = new Map<
    Function,
    {
      readonly entityType: string
      readonly storage: import('@doxajs/core').ModelStorage
      readonly attributes?: ReadonlySet<string>
      readonly optionalAttributes?: ReadonlySet<string>
      readonly attributeNormalizers?: ReadonlyMap<string, (value: unknown) => unknown>
      readonly authOwnedAttributes?: ReadonlySet<string>
      readonly clearAttributeOnChange?: ReadonlyMap<string, string>
    }
  >()
  readonly #modelsById = new Map<
    string,
    {
      readonly Constructor: ModelConstructor<Model, ModelAttributes>
      readonly attributes: ReadonlySet<string>
    }
  >()
  readonly #observersByModel = new Map<string, readonly ObserverManifestEntry[]>()
  readonly #eventsByConstructor = new Map<Function, EventManifestEntry>()
  readonly #listenersByEvent = new Map<string, readonly ListenerManifestEntry[]>()
  readonly #routesById = new Map<string, RouteManifestEntry>()
  readonly #eventDispatcher: EventDispatcher
  readonly #signalsByConstructor = new Map<Function, DoxaManifest['signals'][number]>()
  readonly #signalHandlersBySignal = new Map<string, readonly SignalHandlerManifestEntry[]>()
  readonly #signalDispatcher: SignalDispatcher
  readonly #jobsByConstructor = new Map<Function, JobManifestEntry>()
  readonly #jobsById = new Map<string, JobManifestEntry>()
  readonly #policiesByAbility = new Map<string, PolicyManifestEntry>()
  readonly #schedulesById = new Map<string, DoxaManifest['schedules'][number]>()
  readonly #commandsByName = new Map<string, CommandManifestEntry>()
  readonly #realtimeCommandsByName = new Map<string, RealtimeCommandManifestEntry>()
  readonly #jobDispatcher: JobDispatcher
  readonly #currentJob: CurrentJob
  readonly actions: ActionBus
  readonly queries: QueryBus
  readonly mailer: Mailer
  readonly sms: Sms
  readonly deliveryLedger: DeliveryLedger
  readonly logger: Logger
  readonly authorization: Authorization
  readonly ai: AiObservability
  readonly #currentExecution: CurrentExecution

  private constructor(
    readonly manifest: DoxaManifest,
    readonly profile: RuntimeProfile,
    private readonly artifacts: RuntimeArtifacts,
    private readonly graph: RuntimeGraph,
    private readonly participants: readonly LifecycleParticipant[],
    private readonly deadlines: LifecycleDeadlines,
    private readonly transactions: TransactionManager | undefined,
    private readonly queues: QueueManager | undefined,
    private readonly authentication: Auth | undefined,
    private readonly mailTransport: MailTransport | undefined,
    private readonly smsTransport: SmsTransport | undefined,
    private readonly broadcastTransport: BroadcastTransport | undefined,
    private readonly telemetry: Telemetry,
    private readonly observations: ObservationRecorder,
    private readonly eventTestHook: EventTestHook | undefined,
    private readonly clock: DoxaClock,
    private readonly production: boolean,
    logger: Logger,
  ) {
    this.logger = logger
    this.actions = new RuntimeActionBus(this)
    this.queries = new RuntimeQueryBus(this)
    this.authorization = new RuntimeAuthorization(this)
    this.ai = new RuntimeAiObservability(this)
    this.mailer = new RuntimeMailer(this)
    this.sms = new RuntimeSms(this)
    this.deliveryLedger = new RuntimeDeliveryLedger(this)
    this.#currentExecution = new RuntimeCurrentExecution(this)
    this.#eventDispatcher = Object.freeze({
      dispatch: (event: Event<unknown>) => this.dispatchEvent(event),
    })
    this.#signalDispatcher = Object.freeze({
      dispatch: (signal: Signal<unknown>) => this.dispatchSignal(signal),
    })
    this.#jobDispatcher = Object.freeze({
      dispatch: <Input, Instance extends Job<Input>>(
        Constructor: JobConstructor<Instance, Input>,
        input: Input,
        options?: JobDispatchOptions,
      ) => this.dispatchJob(Constructor, input, options),
    })
    this.#currentJob = new RuntimeCurrentJob(this)
    for (const operation of [...manifest.actions, ...manifest.queries]) {
      const Constructor = artifacts.registry.constructors[operation.id]
      if (Constructor) this.#operationsByConstructor.set(Constructor, operation)
    }
    for (const model of manifest.models) {
      const Constructor = artifacts.registry.constructors[model.id]
      if (Constructor) {
        const auth = manifest.authentication
        const authAttributes = auth.modelId === model.id ? auth.attributes : undefined
        const attributeNormalizers = new Map<string, (value: unknown) => unknown>()
        const authOwnedAttributes = new Set<string>()
        const clearAttributeOnChange = new Map<string, string>()
        if (authAttributes) {
          attributeNormalizers.set(authAttributes.identifier, (value) =>
            normalizeAuthenticationAttribute(value, auth.identifier.normalization),
          )
          if (
            authAttributes.contactEmail &&
            authAttributes.contactEmail !== authAttributes.identifier
          ) {
            attributeNormalizers.set(authAttributes.contactEmail, (value) =>
              normalizeAuthenticationAttribute(value, { preset: 'email' }),
            )
          }
          if (auth.verification.mode === 'mapped' && authAttributes.verification) {
            authOwnedAttributes.add(authAttributes.verification)
            if (authAttributes.contactEmail) {
              clearAttributeOnChange.set(authAttributes.contactEmail, authAttributes.verification)
            }
          }
        }
        this.#modelsByConstructor.set(Constructor, {
          entityType: model.entityType,
          storage:
            model.storage.kind === 'entity-state'
              ? { ...model.storage, attributeTypes: model.attributeTypes }
              : model.storage,
          ...(model.attributes ? { attributes: new Set(model.attributes) } : {}),
          optionalAttributes: new Set(
            model.attributes.filter((attribute) => model.attributeTypes[attribute]?.optional),
          ),
          ...(attributeNormalizers.size ? { attributeNormalizers } : {}),
          ...(authOwnedAttributes.size ? { authOwnedAttributes } : {}),
          ...(clearAttributeOnChange.size ? { clearAttributeOnChange } : {}),
        })
        this.#modelsById.set(model.id, {
          Constructor: Constructor as ModelConstructor<Model, ModelAttributes>,
          attributes: new Set(model.attributes),
        })
      }
      this.#observersByModel.set(
        model.id,
        manifest.observers.filter((observer) => observer.modelId === model.id),
      )
    }
    assertModelRelationships(this.#modelsByConstructor)
    for (const event of manifest.events) {
      const Constructor = artifacts.registry.constructors[event.id]
      if (Constructor) this.#eventsByConstructor.set(Constructor, event)
      this.#listenersByEvent.set(
        event.id,
        manifest.listeners.filter((listener) => listener.eventId === event.id),
      )
    }
    for (const signal of manifest.signals) {
      const Constructor = artifacts.registry.constructors[signal.id]
      if (Constructor) this.#signalsByConstructor.set(Constructor, signal)
      this.#signalHandlersBySignal.set(
        signal.id,
        manifest.signalHandlers.filter((handler) => handler.signalId === signal.id),
      )
    }
    for (const route of manifest.routes) this.#routesById.set(route.id, route)
    for (const job of manifest.jobs) {
      const Constructor = artifacts.registry.constructors[job.id]
      if (Constructor) this.#jobsByConstructor.set(Constructor, job)
      this.#jobsById.set(job.id, job)
    }
    for (const policy of manifest.policies) {
      for (const ability of policy.abilities) this.#policiesByAbility.set(ability, policy)
    }
    for (const schedule of manifest.schedules) this.#schedulesById.set(schedule.id, schedule)
    for (const command of manifest.commands) this.#commandsByName.set(command.command, command)
    for (const command of manifest.realtimeCommands)
      this.#realtimeCommandsByName.set(command.command, command)
    broadcastTransport?.bind({
      connect: (connectionId, request) => this.connectBroadcast(connectionId, request),
      subscribe: (admission, destination) => this.subscribeBroadcast(admission, destination),
      unsubscribe: (admission, destination) => this.unsubscribeBroadcast(admission, destination),
      command: (admission, request) => this.dispatchRealtimeCommand(admission, request),
    })
    queues?.bind((delivery) => this.handleQueueDelivery(delivery))
    queues?.reconcileSchedules(
      manifest.schedules.map((schedule): ScheduleDefinition => {
        const job = manifest.jobs.find((entry) => entry.id === schedule.jobId)
        if (!job)
          throw new RuntimeIntegrityError(
            `Schedule ${schedule.id} targets missing job ${schedule.jobId}.`,
          )
        return {
          id: schedule.id,
          targetId: schedule.jobId,
          cadence: schedule.cadence,
          timeZone: schedule.timeZone,
          overlap: schedule.overlap,
          misfire: schedule.misfire,
          input: schedule.input as import('@doxajs/core').JsonValue,
          policy: {
            retries: job.retries,
            retryDelay: job.retryDelay,
            backoff: job.backoff,
            timeout: job.timeout,
          },
        }
      }),
    )
  }

  get state(): RuntimeState {
    return this.#state
  }

  get ready(): boolean {
    return this.#state === 'ready'
  }

  static async boot(
    application: ApplicationDeclaration,
    options: BootOptions,
  ): Promise<DoxaRuntime> {
    const artifactsDirectory = path.resolve(options.artifactsDirectory ?? '.doxa')
    const artifacts = await loadArtifacts(artifactsDirectory)
    const registeredApplication =
      artifacts.registry.constructors[`application:${artifacts.manifest.applicationId}`]
    if (registeredApplication !== application) {
      throw new RuntimeIntegrityError(
        `Generated artifacts belong to ${artifacts.manifest.applicationId}, not the Application passed to Doxa.boot().`,
      )
    }
    const deadlines = { ...DEFAULT_DEADLINES, ...options.deadlines }
    const profile = normalizeRuntimeProfile(options.profile)
    const includedProviderIds = providerIdsForProfile(artifacts.manifest, profile)
    const includedConfigurationIds = configurationIdsForProviders(
      artifacts.manifest,
      includedProviderIds,
    )
    const configurations = await materializeConfigurations(
      artifacts,
      options,
      includedConfigurationIds,
    )
    assertOperationInfrastructure(artifacts.manifest)
    const consoleOptions: ConsoleLogSinkOptions = {
      ...(options.logging && options.logging.format ? { format: options.logging.format } : {}),
      ...(options.logging && options.logging.color !== undefined
        ? { color: options.logging.color }
        : {}),
      ...(options.logging && options.logging.destination
        ? { destination: options.logging.destination }
        : {}),
    }
    const primarySink =
      options.logging === false || options.logging === undefined
        ? undefined
        : (options.logging?.sink ?? new ConsoleLogSink(consoleOptions))
    const sink = new ObservationLogSink(primarySink)
    const logger = new Logger({
      sink,
      ...(options.logging && options.logging.level ? { level: options.logging.level } : {}),
    })
    logger
      .channel('lifecycle')
      .debug('Booting application', { application: artifacts.manifest.applicationId })
    const graph = constructSingletonGraph(
      artifacts,
      configurations,
      options.providerOverrides ?? {},
      logger,
      includedProviderIds,
    )
    const transactionProvider = artifacts.manifest.providers.find((provider) =>
      provider.capabilities.includes('transactions'),
    )
    const transactions = transactionProvider
      ? (graph.singletonInstances.get(transactionProvider.id) as TransactionManager | undefined)
      : undefined
    const queueProvider = artifacts.manifest.providers.find((provider) =>
      provider.capabilities.includes('queues'),
    )
    const queues = queueProvider
      ? (graph.singletonInstances.get(queueProvider.id) as QueueManager | undefined)
      : undefined
    const authenticationProvider = artifacts.manifest.providers.find((provider) =>
      provider.capabilities.includes('authentication'),
    )
    const authentication = authenticationProvider
      ? (graph.singletonInstances.get(authenticationProvider.id) as Auth | undefined)
      : undefined
    const mailProvider = artifacts.manifest.providers.find((provider) =>
      provider.capabilities.includes('mail'),
    )
    const mailTransport = mailProvider
      ? (graph.singletonInstances.get(mailProvider.id) as MailTransport | undefined)
      : undefined
    const smsProvider = artifacts.manifest.providers.find((provider) =>
      provider.capabilities.includes('sms'),
    )
    const smsTransport = smsProvider
      ? (graph.singletonInstances.get(smsProvider.id) as SmsTransport | undefined)
      : undefined
    const broadcastProvider = artifacts.manifest.providers.find((provider) =>
      provider.capabilities.includes('broadcasting'),
    )
    const broadcastTransport = broadcastProvider
      ? (graph.singletonInstances.get(broadcastProvider.id) as BroadcastTransport | undefined)
      : undefined
    const telemetryProvider = artifacts.manifest.providers.find((provider) =>
      provider.capabilities.includes('telemetry'),
    )
    const telemetry = telemetryProvider
      ? (graph.singletonInstances.get(telemetryProvider.id) as Telemetry)
      : new NoopTelemetry()
    const observationProvider = artifacts.manifest.providers.find((provider) =>
      provider.capabilities.includes('observations'),
    )
    const observations = observationProvider
      ? (graph.singletonInstances.get(observationProvider.id) as ObservationRecorder)
      : new NoopObservationRecorder()
    sink.attach(observations)
    const runtime = new DoxaRuntime(
      artifacts.manifest,
      profile,
      artifacts,
      graph,
      graph.participants,
      deadlines,
      transactions,
      queues,
      authentication,
      mailTransport,
      smsTransport,
      broadcastTransport,
      telemetry,
      observations,
      options.eventTestHook,
      options.clock ?? systemClock,
      (options.environment ?? process.env).NODE_ENV === 'production',
      logger,
    )
    transactions?.bindCompiledModels(
      artifacts.manifest.models.map((model) => ({
        entityType: model.entityType,
        storage:
          model.storage.kind === 'entity-state'
            ? { ...model.storage, attributeTypes: model.attributeTypes }
            : model.storage,
      })),
    )
    const compiledAuth = authentication as
      | (Auth & {
          bindCompiledAuthentication?: (
            configuration: DoxaManifest['authentication'],
            runtime: {
              registerManagedIdentity: (
                request: ManagedIdentityRegistrationRequest,
              ) => Promise<string>
            },
          ) => void
        })
      | undefined
    compiledAuth?.bindCompiledAuthentication?.(artifacts.manifest.authentication, {
      registerManagedIdentity: (request) => runtime.registerManagedIdentity(request),
    })
    queues?.selectRoles({
      worker: options.roles?.worker ?? true,
      scheduler: options.roles?.scheduler ?? true,
    })
    broadcastTransport?.selectRoles({
      web: options.roles?.web ?? true,
      worker: options.roles?.worker ?? true,
      scheduler: options.roles?.scheduler ?? true,
      requiresRemotePublishing:
        !(options.roles?.web ?? true) &&
        (options.roles?.worker ?? true) &&
        artifacts.manifest.events.some((event) => event.broadcast !== false),
    })
    const started: LifecycleParticipant[] = []
    const bootStartedAt = performance.now()

    try {
      for (const participant of graph.participants) {
        if (participant.manifest.lifecycle.start) {
          await runtime.observeTelemetry(
            'lifecycle.phase',
            { phase: 'start', participant: participant.manifest.id },
            () => invokeLifecycle(participant, 'start', deadlines.start),
          )
        }
        started.push(participant)
      }
      runtime.#state = 'ready'
      runtime.logger.channel('lifecycle').info('Application ready', {
        application: artifacts.manifest.applicationId,
        durationMs: performance.now() - bootStartedAt,
      })
      await runtime.recordTelemetry({
        kind: 'metric',
        name: 'doxa.lifecycle.boot.duration',
        value: performance.now() - bootStartedAt,
        unit: 'milliseconds',
        attributes: { status: 'ok' },
      })
      return runtime
    } catch (primaryError) {
      const cleanupErrors = await unwindStartup(started, deadlines)
      runtime.#state = 'stopped'
      runtime.logger.channel('lifecycle').error('Application boot failed', primaryError, {
        application: artifacts.manifest.applicationId,
        durationMs: performance.now() - bootStartedAt,
      })
      await runtime.recordTelemetry({
        kind: 'metric',
        name: 'doxa.lifecycle.boot.duration',
        value: performance.now() - bootStartedAt,
        unit: 'milliseconds',
        attributes: { status: 'error' },
      })
      throw new RuntimeBootError(primaryError, cleanupErrors)
    }
  }

  async admit<Output>(
    seed: ExecutionContextSeed,
    work: (context: ExecutionContext) => Output | Promise<Output>,
  ): Promise<Output> {
    if (this.profile !== 'application') {
      throw new ExecutionAdmissionError(
        'The model-reader runtime profile admits only bounded model record queries.',
      )
    }
    return this.#admitExecution(seed, work)
  }

  async #admitExecution<Output>(
    seed: ExecutionContextSeed,
    work: (context: ExecutionContext) => Output | Promise<Output>,
    executionSpanId?: string,
  ): Promise<Output> {
    if (this.#state !== 'ready') {
      throw new ExecutionAdmissionError(
        `Doxa cannot admit work while runtime state is ${this.#state}.`,
      )
    }
    if (this.#storage.getStore()) {
      throw new ExecutionAdmissionError(
        'An admitted execution cannot create a nested execution scope.',
      )
    }

    const controller = new AbortController()
    let deadlineTimer: NodeJS.Timeout | undefined
    if (seed.deadline) {
      deadlineTimer = setTimeout(
        () => controller.abort(new Error('Doxa execution deadline exceeded.')),
        Math.max(0, Number(seed.deadline.epochMicroseconds / 1_000n) - Date.now()),
      )
      deadlineTimer.unref()
    }
    let context = createExecutionContext(
      seed,
      controller.signal,
      executionSpanId,
      this.manifest.time,
    )
    const startedAt = performance.now()
    const startedAtWall = new Date()
    const liveSpan = this.startTelemetrySpan(
      context.transport.name ?? context.transport.kind,
      context.trace,
      startedAtWall,
      telemetryAttributes(context),
    )
    if (liveSpan) context = withTraceContext(context, liveSpan.context)
    await this.recordObservation(
      {
        kind: 'execution',
        name: context.transport.name ?? context.transport.kind,
        phase: 'started',
        attributes: { transport: context.transport.kind },
      },
      context,
    )
    if (context.transport.kind === 'http') {
      await this.recordObservation(
        {
          kind: 'http',
          name: context.transport.name ?? 'http',
          phase: 'started',
          attributes: {},
        },
        context,
      )
    }
    runWithLogContext(logContext(context), () => {
      this.logger
        .channel(logChannelForTransport(context.transport.kind))
        .debug('Execution started', {
          transport: context.transport.name ?? context.transport.kind,
        })
    })
    await this.recordTelemetry({
      kind: 'log',
      level: 'info',
      event: 'execution.started',
      attributes: telemetryAttributes(context),
    })
    await this.recordTelemetry({
      kind: 'metric',
      name: 'doxa.execution.admitted',
      value: 1,
      unit: 'count',
      attributes: { transport: context.transport.kind },
    })
    const scope = new ExecutionScope(
      this.artifacts,
      this.graph,
      this.actions,
      this.queries,
      this.#currentExecution,
      this.#currentJob,
      this.authorization,
      this.ai,
      this.mailer,
      this.sms,
      this.deliveryLedger,
      this.logger,
    )
    const store: ExecutionStore = {
      context,
      scope,
      operationStack: [],
      ...(seed.transport.kind === 'websocket' &&
      seed.transport.name?.startsWith('realtime.command:')
        ? { boundary: 'realtime-command' as const }
        : {}),
    }
    const execution = Promise.resolve(
      this.#storage.run(store, () =>
        this.#traceStorage.run(context.trace, () =>
          runWithLogContext(logContext(context), () =>
            runWithRoleConstruction(scope.constructionContext, () =>
              runWithEventDispatcher(this.#eventDispatcher, () =>
                runWithSignalDispatcher(this.#signalDispatcher, () =>
                  runWithDateTimeContext(
                    {
                      now: () => this.clock.now(),
                      timeZone: context.timeZone,
                      locale: context.locale,
                    },
                    () =>
                      runWithJobDispatcher(this.#jobDispatcher, async () => {
                        let result: Output | undefined
                        let primaryError: unknown
                        let failed = false
                        try {
                          result = await work(context)
                        } catch (error) {
                          failed = true
                          primaryError = error
                        }

                        const cleanupErrors = await scope.dispose(this.deadlines.dispose)
                        if (failed && cleanupErrors.length > 0) {
                          const diagnosticError = safeDiagnosticError(primaryError)
                          const combined = new ExecutionFailureError(
                            primaryError instanceof PermissionSourceResolutionFailure
                              ? primaryError.original
                              : primaryError,
                            cleanupErrors,
                          )
                          if (diagnosticError !== primaryError) {
                            markPrivacySensitiveError(
                              combined,
                              typeof diagnosticError === 'string'
                                ? diagnosticError
                                : 'Privacy-sensitive execution failed during cleanup.',
                            )
                          }
                          throw combined
                        }
                        if (failed) throw primaryError
                        if (cleanupErrors.length > 0) throw new ExecutionCleanupError(cleanupErrors)
                        return result as Output
                      }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    )
    this.#activeExecutions.set(execution, controller)
    try {
      const result = await execution
      await this.completeTelemetry(context, startedAt, startedAtWall, 'ok', undefined, liveSpan)
      return result
    } catch (error) {
      await this.completeTelemetry(context, startedAt, startedAtWall, 'error', error, liveSpan)
      if (error instanceof PermissionSourceResolutionFailure) throw error.original
      throw error
    } finally {
      this.#activeExecutions.delete(execution)
      if (deadlineTimer) clearTimeout(deadlineTimer)
    }
  }

  private async completeTelemetry(
    context: ExecutionContext,
    startedAt: number,
    startedAtWall: Date,
    status: 'ok' | 'error',
    error?: unknown,
    liveSpan?: TelemetrySpanHandle,
  ): Promise<void> {
    const durationMilliseconds = performance.now() - startedAt
    const diagnosticError = safeDiagnosticError(error)
    const attributes = telemetryAttributes(context)
    const executionLogger = this.logger.channel(logChannelForTransport(context.transport.kind))
    const logAttributes = {
      transport: context.transport.name ?? context.transport.kind,
      durationMs: durationMilliseconds,
    }
    runWithLogContext(logContext(context), () => {
      if (status === 'ok' && context.transport.kind === 'http')
        executionLogger.debug('Execution completed', logAttributes)
      else if (status === 'ok') executionLogger.info('Execution completed', logAttributes)
      else executionLogger.error('Execution failed', diagnosticError, logAttributes)
    })
    await this.recordTelemetry({
      kind: 'log',
      level: status === 'ok' ? 'info' : 'error',
      event: `execution.${status === 'ok' ? 'completed' : 'failed'}`,
      attributes,
    })
    await this.recordTelemetry({
      kind: 'metric',
      name: 'doxa.execution.duration',
      value: durationMilliseconds,
      unit: 'milliseconds',
      attributes: { transport: context.transport.kind, status },
    })
    const endedAt = new Date().toISOString()
    if (liveSpan) {
      try {
        await liveSpan.end({ endedAt, durationMilliseconds, status, attributes })
      } catch {
        /* Observability never changes application behavior. */
      }
    } else {
      await this.recordTelemetry({
        kind: 'span',
        name: context.transport.name ?? context.transport.kind,
        traceId: context.trace.traceId!,
        spanId: context.trace.spanId!,
        ...(context.trace.parentSpanId ? { parentSpanId: context.trace.parentSpanId } : {}),
        ...(context.trace.links?.length ? { links: context.trace.links } : {}),
        startedAt: startedAtWall.toISOString(),
        endedAt,
        durationMilliseconds,
        status,
        attributes,
      })
    }
    const phase = status === 'ok' ? 'completed' : 'failed'
    await this.recordObservation(
      {
        kind: 'execution',
        name: context.transport.name ?? context.transport.kind,
        phase,
        durationMilliseconds,
        attributes: { transport: context.transport.kind },
        ...(diagnosticError === undefined ? {} : { error: diagnosticError }),
      },
      context,
    )
    if (context.transport.kind === 'http') {
      await this.recordObservation(
        {
          kind: 'http',
          name: context.transport.name ?? 'http',
          phase,
          durationMilliseconds,
          attributes: {},
          ...(error === undefined ? {} : { error }),
        },
        context,
      )
    }
    if (error !== undefined) {
      await this.recordObservation(
        {
          kind: 'exception',
          name: errorMessage(diagnosticError),
          phase: 'occurred',
          attributes: { boundary: 'execution' },
          error: diagnosticError,
        },
        context,
      )
    }
  }

  private async recordObservation(
    input: {
      readonly kind: ObservationKind
      readonly name: string
      readonly phase: Observation['phase']
      readonly roleId?: string
      readonly durationMilliseconds?: number
      readonly attributes?: Readonly<Record<string, unknown>>
      readonly error?: unknown
    },
    contextOverride?: ExecutionContext,
  ): Promise<void> {
    const context = contextOverride ?? this.currentExecutionContextOrUndefined()
    const observation: Observation = Object.freeze({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      kind: input.kind,
      name: input.name,
      phase: input.phase,
      ...(input.roleId ? { roleId: input.roleId } : {}),
      ...(input.durationMilliseconds === undefined
        ? {}
        : { durationMilliseconds: input.durationMilliseconds }),
      context: observationContext(context),
      attributes: sanitizeObservationAttributes(input.attributes ?? {}),
      ...(input.error === undefined ? {} : { error: sanitizeObservationError(input.error) }),
    })
    try {
      await this.observations.record(observation)
    } catch {
      /* Debugging must never change application behavior. */
    }
  }

  private async observeObservation<Output>(
    kind: ObservationKind,
    name: string,
    attributes: Readonly<Record<string, unknown>>,
    work: () => Output | Promise<Output>,
    roleId?: string,
    links?: readonly import('@doxajs/core').SpanLink[],
  ): Promise<Output> {
    const execution = this.currentExecutionContext()
    const proposedTrace = childTraceContext(this.#traceStorage.getStore() ?? execution.trace, links)
    const startedAt = performance.now()
    const startedAtWall = new Date()
    const liveSpan = this.startTelemetrySpan(
      name,
      proposedTrace,
      startedAtWall,
      sanitizeObservationAttributes(attributes),
    )
    const context = withTraceContext(execution, liveSpan?.context ?? proposedTrace)
    return await this.#traceStorage.run(context.trace, () =>
      runWithLogContext(logContext(context), async () => {
        await this.recordObservation(
          {
            kind,
            name,
            phase: 'started',
            attributes,
            ...(roleId ? { roleId } : {}),
          },
          context,
        )
        try {
          const output = await work()
          await this.completeInstrumentedScope(
            { kind, name, attributes, ...(roleId ? { roleId } : {}) },
            context,
            startedAt,
            startedAtWall,
            'ok',
            undefined,
            liveSpan,
          )
          return output
        } catch (error) {
          if (kind.startsWith('ai.')) markPrivacySensitiveError(error, 'AI operation failed.')
          await this.completeInstrumentedScope(
            { kind, name, attributes, ...(roleId ? { roleId } : {}) },
            context,
            startedAt,
            startedAtWall,
            'error',
            error,
            liveSpan,
          )
          throw error
        }
      }),
    )
  }

  private async completeInstrumentedScope(
    input: {
      readonly kind: ObservationKind
      readonly name: string
      readonly attributes: Readonly<Record<string, unknown>>
      readonly roleId?: string
    },
    context: ExecutionContext,
    startedAt: number,
    startedAtWall: Date,
    status: 'ok' | 'error',
    error?: unknown,
    liveSpan?: TelemetrySpanHandle,
  ): Promise<void> {
    const durationMilliseconds = performance.now() - startedAt
    const endedAt = new Date().toISOString()
    const observationError = safeDiagnosticError(error)
    await this.recordObservation(
      {
        kind: input.kind,
        name: input.name,
        phase: status === 'ok' ? 'completed' : 'failed',
        attributes: input.attributes,
        durationMilliseconds,
        ...(input.roleId ? { roleId: input.roleId } : {}),
        ...(observationError === undefined ? {} : { error: observationError }),
      },
      context,
    )
    if (error !== undefined) {
      await this.recordObservation(
        {
          kind: 'exception',
          name: errorMessage(observationError),
          phase: 'occurred',
          attributes: { boundary: input.kind },
          error: observationError,
          ...(input.roleId ? { roleId: input.roleId } : {}),
        },
        context,
      )
    }
    const spanAttributes = sanitizeObservationAttributes(input.attributes)
    if (liveSpan) {
      try {
        await liveSpan.end({ endedAt, durationMilliseconds, status, attributes: spanAttributes })
      } catch {
        /* Observability never changes application behavior. */
      }
    } else {
      await this.recordTelemetry({
        kind: 'span',
        name: input.name,
        traceId: context.trace.traceId!,
        spanId: context.trace.spanId!,
        ...(context.trace.parentSpanId ? { parentSpanId: context.trace.parentSpanId } : {}),
        ...(context.trace.links?.length ? { links: context.trace.links } : {}),
        startedAt: startedAtWall.toISOString(),
        endedAt,
        durationMilliseconds,
        status,
        attributes: spanAttributes,
      })
    }
  }

  private startTelemetrySpan(
    name: string,
    context: TraceContext,
    startedAt: Date,
    attributes: Readonly<Record<string, import('@doxajs/core').JsonValue>>,
  ): TelemetrySpanHandle | undefined {
    try {
      const handle = this.telemetry.startSpan?.({
        name,
        context,
        startedAt: startedAt.toISOString(),
        attributes,
      })
      if (!handle) return undefined
      if (
        !handle.context.traceId ||
        !/^[0-9a-f]{32}$/.test(handle.context.traceId) ||
        /^0+$/.test(handle.context.traceId) ||
        !handle.context.spanId ||
        !/^[0-9a-f]{16}$/.test(handle.context.spanId) ||
        /^0+$/.test(handle.context.spanId) ||
        (context.parentSpanId !== undefined && handle.context.traceId !== context.traceId) ||
        handle.context.parentSpanId !== context.parentSpanId
      ) {
        return undefined
      }
      return handle
    } catch {
      return undefined
    }
  }

  private async recordTelemetry(record: TelemetryRecord): Promise<void> {
    try {
      await this.telemetry.record(record)
    } catch {
      /* Observability never changes application behavior. */
    }
  }

  private async observeTelemetry<Output>(
    subsystem: string,
    attributes: Readonly<Record<string, string | number | boolean>>,
    work: () => Output | Promise<Output>,
  ): Promise<Output> {
    const startedAt = performance.now()
    const logger = this.logger.channel(logChannelForSubsystem(subsystem))
    logger.debug(`${humanizeSubsystem(subsystem)} started`, attributes)
    try {
      const output = await work()
      logger.debug(`${humanizeSubsystem(subsystem)} completed`, {
        ...attributes,
        durationMs: performance.now() - startedAt,
      })
      await this.recordTelemetry({
        kind: 'metric',
        name: `doxa.${subsystem}.total`,
        value: 1,
        unit: 'count',
        attributes: { ...attributes, status: 'ok' },
      })
      await this.recordTelemetry({
        kind: 'metric',
        name: `doxa.${subsystem}.duration`,
        value: performance.now() - startedAt,
        unit: 'milliseconds',
        attributes: { ...attributes, status: 'ok' },
      })
      return output
    } catch (error) {
      logger.error(`${humanizeSubsystem(subsystem)} failed`, error, {
        ...attributes,
        durationMs: performance.now() - startedAt,
      })
      await this.recordTelemetry({
        kind: 'metric',
        name: `doxa.${subsystem}.total`,
        value: 1,
        unit: 'count',
        attributes: { ...attributes, status: 'error' },
      })
      await this.recordTelemetry({
        kind: 'metric',
        name: `doxa.${subsystem}.duration`,
        value: performance.now() - startedAt,
        unit: 'milliseconds',
        attributes: { ...attributes, status: 'error' },
      })
      throw error
    }
  }

  async authenticateHttp(request: Request): Promise<ResolvedHttpAuthentication> {
    if (!this.authentication) {
      return {
        actor: { kind: 'anonymous' },
        authentication: { state: 'anonymous' },
      }
    }
    return await this.observeTelemetry('auth.resolve', { transport: 'http' }, () =>
      this.authentication!.resolveHttp(request),
    )
  }

  authenticationStorage(): import('@doxajs/core').AuthStorageDescription {
    return this.authentication?.storage() ?? { kind: 'custom' }
  }

  private async registerManagedIdentity(
    request: ManagedIdentityRegistrationRequest,
  ): Promise<string> {
    const authentication = this.manifest.authentication
    if (
      authentication.mode !== 'managed' ||
      authentication.source !== 'model' ||
      !authentication.modelId ||
      !authentication.attributes
    ) {
      throw new RuntimeIntegrityError('Managed authentication registration is not compiled.')
    }
    const model = this.#modelsById.get(authentication.modelId)
    if (!model) {
      throw new RuntimeIntegrityError(
        `Managed authentication model ${authentication.modelId} is unavailable.`,
      )
    }
    const transactions = this.transactions as FrameworkTransactionManager | undefined
    if (!transactions?.frameworkTransaction) {
      throw new RuntimeIntegrityError(
        'Managed authentication requires the PostgreSQL transaction-participant boundary.',
      )
    }
    const store = this.requireExecution('HTTP route')
    const factory = authentication.registrationFactoryId
      ? (store.scope.resolve(authentication.registrationFactoryId) as
          AuthIdentityRegistrationFactory | undefined)
      : undefined
    const defaults = factory
      ? await factory.defaults({
          identifier: request.identifier,
          ...(request.contactEmail ? { contactEmail: request.contactEmail } : {}),
        })
      : {}
    if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
      throw new RuntimeIntegrityError(
        'Auth registration factory must return a plain attribute object.',
      )
    }
    const reserved = new Set(
      [
        'id',
        authentication.attributes.identifier,
        authentication.attributes.contactEmail,
        authentication.attributes.createdAt,
        authentication.attributes.updatedAt,
        authentication.attributes.verification,
      ].filter((attribute): attribute is string => Boolean(attribute)),
    )
    for (const attribute of Object.keys(defaults)) {
      if (reserved.has(attribute)) {
        throw new RuntimeIntegrityError(
          `Auth registration factory cannot override reserved attribute ${attribute}.`,
        )
      }
      if (!model.attributes.has(attribute)) {
        throw new RuntimeIntegrityError(
          `Auth registration factory returned undeclared attribute ${attribute}.`,
        )
      }
    }
    const attributes: Record<string, unknown> = {
      ...defaults,
      id: request.id,
      [authentication.attributes.identifier]: request.identifier,
      [authentication.attributes.createdAt]: request.createdAt,
      [authentication.attributes.updatedAt]: request.updatedAt,
    }
    if (authentication.attributes.contactEmail) {
      attributes[authentication.attributes.contactEmail] = request.contactEmail
    }
    if (authentication.attributes.verification) {
      attributes[authentication.attributes.verification] = null
    }

    return await transactions.frameworkTransaction(
      store.context,
      async (unitOfWork, participant) => {
        const models = new ModelSession(
          unitOfWork,
          this.#modelsByConstructor,
          this.modelObserverDispatcher(store),
          true,
          this.modelQueryDiagnosticRecorder(),
          this.modelOperationObserver(),
        )
        return await store.scope.withUnitOfWork(unitOfWork, async () =>
          runWithModelSession(models, async () => {
            try {
              const identity = models.make(
                model.Constructor,
                attributes as unknown as ModelAttributes,
              )
              await identity.save()
              await request.persistAuthentication(participant, identity.id)
              return identity.id
            } finally {
              models.close()
            }
          }),
        )
      },
    )
  }

  async dispatchAction<Input, Output>(
    action: ActionClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>> {
    const store = this.requireExecution('action')
    if (store.operationStack.length > 0) {
      throw new OperationDispatchError('Nested action dispatch is prohibited in the Doxa MVP.')
    }
    const operation = this.operationFor(action, 'action')
    if (!this.transactions) {
      throw new OperationDispatchError('No transaction manager is available for action dispatch.')
    }
    store.operationStack.push('action')
    try {
      return await this.observeObservation(
        'action',
        operation.id,
        {},
        () =>
          this.observeLog('action', 'Action', { id: operation.id }, () =>
            this.observeObservation(
              'transaction',
              'action transaction',
              { operation: 'action' },
              () =>
                this.observeTelemetry(
                  'persistence.transaction',
                  { operation: 'action', id: operation.id },
                  () =>
                    this.transactions!.transaction(store.context, async (unitOfWork) => {
                      return store.scope.withUnitOfWork(unitOfWork, async () => {
                        if (operation.access !== 'public') {
                          await this.authorization.authorize(operation.access)
                        }
                        return this.runWritableModelSession(store, unitOfWork, async () => {
                          const handler = store.scope.resolve(operation.id) as Action<Input, Output>
                          return (await handler.handle(input)) as Awaited<Output>
                        })
                      })
                    }),
                ),
            ),
          ),
        operation.id,
      )
    } finally {
      store.operationStack.pop()
    }
  }

  async dispatchQuery<Input, Output>(
    query: QueryClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>> {
    const store = this.requireExecution('query')
    const operation = this.operationFor(query, 'query')
    if (!this.transactions) {
      throw new OperationDispatchError('No persistence manager is available for query dispatch.')
    }
    store.operationStack.push('query')
    try {
      return (await this.observeObservation(
        'query',
        operation.id,
        {},
        () =>
          this.observeLog('query', 'Query', { id: operation.id }, () =>
            this.transactions!.read(store.context, async (reader) => {
              const models = new ModelSession(
                reader,
                this.#modelsByConstructor,
                this.modelObserverDispatcher(store),
                false,
                this.modelQueryDiagnosticRecorder(),
                this.modelOperationObserver(),
              )
              return runWithModelSession(models, async () => {
                try {
                  if (operation.access !== 'public') {
                    await this.authorization.authorize(operation.access)
                  }
                  const handler = store.scope.resolve(operation.id) as Query<Input, Output>
                  return await handler.handle(input)
                } finally {
                  models.close()
                }
              })
            }),
          ),
        operation.id,
      )) as Awaited<Output>
    } finally {
      store.operationStack.pop()
    }
  }

  async queryModelRecords(
    input: ModelRecordQuery,
    seed: ExecutionContextSeed,
  ): Promise<ModelRecordQueryResult> {
    if (this.profile !== 'model-reader') {
      throw new OperationDispatchError(
        'Model record inspection requires the model-reader runtime profile.',
      )
    }
    if (
      seed.actor.kind !== 'system' ||
      seed.actor.id === undefined ||
      seed.transport.kind !== 'console' ||
      seed.authentication?.state !== 'authenticated' ||
      seed.authentication.identityId !== seed.actor.id ||
      seed.authentication.method !== 'console'
    ) {
      throw new ExecutionAdmissionError(
        'Model record inspection requires an authenticated system console execution.',
      )
    }
    return this.#admitExecution(seed, () => this.#queryModelRecords(input))
  }

  async #queryModelRecords(input: ModelRecordQuery): Promise<ModelRecordQueryResult> {
    const store = this.requireExecution('query')
    const definition = this.#modelsById.get(input.modelId)
    if (!definition) {
      throw new OperationDispatchError(`${input.modelId} is not a declared model.`)
    }
    const fields = [...new Set(input.fields)]
    const filters = input.filters ?? []
    const orderBy = input.orderBy ?? []
    const limit = input.limit ?? 20
    if (fields.length === 0 || fields.length > 50) {
      throw new OperationDispatchError('Model record queries require 1 through 50 fields.')
    }
    if (filters.length > 20) {
      throw new OperationDispatchError('Model record queries accept at most 20 filters.')
    }
    if (
      filters.some((filter) => typeof filter.value === 'string' && filter.value.length > 10_000)
    ) {
      throw new OperationDispatchError(
        'Model record query string comparisons accept at most 10,000 characters.',
      )
    }
    if (orderBy.length > 5) {
      throw new OperationDispatchError('Model record queries accept at most 5 ordering entries.')
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new OperationDispatchError('Model record query limit must be from 1 through 100.')
    }
    const requestedAttributes = [
      ...fields,
      ...filters.map((filter) => filter.attribute),
      ...orderBy.map((order) => order.attribute),
    ]
    const unknown = requestedAttributes.find((attribute) => !definition.attributes.has(attribute))
    if (unknown) {
      throw new OperationDispatchError(
        `${input.modelId} does not declare logical attribute ${unknown}.`,
      )
    }
    if (!this.transactions) {
      throw new OperationDispatchError('No persistence manager is available for model queries.')
    }
    const constraints: readonly ModelQueryConstraint[] = filters.map((filter) => ({
      boolean: 'and',
      predicate: {
        kind: 'comparison',
        attribute: filter.attribute,
        operator: filter.operator,
        value: filter.value,
      },
    }))
    store.operationStack.push('query')
    try {
      const rows = await this.observeObservation(
        'query',
        input.modelId,
        { operation: 'model-record-query', limit },
        () =>
          this.transactions!.read(store.context, async (reader) => {
            const models = new ModelSession(
              reader,
              this.#modelsByConstructor,
              undefined,
              false,
              this.modelQueryDiagnosticRecorder(),
              this.modelOperationObserver(),
            )
            return runWithModelSession(models, async () => {
              try {
                const records = await models.query(definition.Constructor, {
                  constraints,
                  orders: orderBy,
                  eagerLoads: [],
                  relationshipConstraints: [],
                  limit: limit + 1,
                  diagnostic: { terminal: 'get' },
                })
                return records.map((model) =>
                  Object.freeze(
                    Object.fromEntries(
                      fields.map((field) => [
                        field,
                        serializeModelRecordValue(
                          (model as unknown as { getAttribute(key: string): unknown }).getAttribute(
                            field,
                          ),
                        ),
                      ]),
                    ),
                  ),
                )
              } finally {
                models.close()
              }
            })
          }),
      )
      const truncated = rows.length > limit
      const bounded = Object.freeze(rows.slice(0, limit))
      return Object.freeze({
        modelId: input.modelId,
        fields: Object.freeze(fields),
        rows: bounded,
        returned: bounded.length,
        truncated,
        executionId: store.context.executionId,
      })
    } finally {
      store.operationStack.pop()
    }
  }

  async dispatchRoute(
    routeId: string,
    request: Request,
    params: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    const store = this.requireExecution('HTTP route')
    const route = this.#routesById.get(routeId)
    if (!route) throw new OperationDispatchError(`${routeId} is not a declared HTTP route.`)
    if (route.access !== 'public') await this.authorization.authorize(route.access)
    const handler = store.scope.resolve(route.id) as Route
    return this.observeObservation(
      'http',
      `${route.method} ${route.path}`,
      { method: route.method, path: route.path },
      () => handler.handle(new HttpRequest(request, Object.freeze({ ...params }))),
      route.id,
    )
  }

  async dispatchCommand(name: string, arguments_: readonly string[]): Promise<void> {
    const store = this.requireExecution('command')
    const manifest = this.#commandsByName.get(name)
    if (!manifest)
      throw new OperationDispatchError(`${name} is not a declared application command.`)
    if (manifest.access !== 'public') await this.authorization.authorize(manifest.access)
    const command = store.scope.resolve(manifest.id) as Command
    await this.observeObservation(
      'execution',
      manifest.command,
      { arguments: arguments_ },
      () => command.handle(arguments_),
      manifest.id,
    )
  }

  private async dispatchEvent(event: Event<unknown>): Promise<void> {
    const store = this.requireExecution('event')
    const manifest = this.#eventsByConstructor.get(event.constructor)
    if (!manifest) {
      throw new OperationDispatchError(
        `${event.constructor.name || 'Anonymous event'} is not declared by a selected Feature.`,
      )
    }
    if (store.boundary === 'realtime-command') {
      store.context.cancellation.throwIfAborted()
      const listeners = this.#listenersByEvent.get(manifest.id) ?? []
      if (
        manifest.domain ||
        manifest.dispatch === 'after-commit' ||
        manifest.broadcast === 'queued' ||
        listeners.some((listener) => listener.delivery !== 'local')
      ) {
        throw new OperationDispatchError(
          'Realtime commands may dispatch only immediate, non-durable Events and ShouldBroadcastNow broadcasts.',
        )
      }
    }
    const unitOfWork = store.scope.currentUnitOfWork
    if (manifest.domain) {
      if (!unitOfWork) {
        throw new OperationDispatchError(
          `${manifest.id} is a DomainEvent and requires an active writable Unit of Work.`,
        )
      }
      const domainEvent = event as DomainEvent<import('@doxajs/core').JsonValue>
      await unitOfWork.record({
        type: manifest.id,
        version: manifest.payloadVersion,
        entityType: manifest.domain.entityType,
        entityId: domainEvent.entityId,
        payload: serializeQueuePayload(domainEvent.payload),
      })
    }
    if (manifest.dispatch === 'after-commit' && unitOfWork) {
      if (this.eventTestHook?.shouldFake(event)) {
        unitOfWork.afterCommit(() => {
          this.eventTestHook!.dispatched({ id: manifest.id, event, context: store.context })
        })
        return
      }
      for (const listener of this.#listenersByEvent.get(manifest.id) ?? []) {
        if (listener.delivery === 'queued' || listener.delivery === 'queued-after-commit') {
          await this.enqueueListener(listener, manifest, event, store)
        }
      }
      if (manifest.broadcast === 'queued') {
        await this.enqueueBroadcast(manifest, event, store)
      }
      unitOfWork.afterCommit(() =>
        this.observeObservation(
          'event',
          manifest.id,
          { payload: event.payload },
          () =>
            this.observeTelemetry('event.dispatch', { id: manifest.id }, () =>
              this.dispatchEventNow(event, manifest, store, true),
            ),
          manifest.id,
        ),
      )
      return
    }
    await this.observeObservation(
      'event',
      manifest.id,
      { payload: event.payload },
      () =>
        this.observeTelemetry('event.dispatch', { id: manifest.id }, () =>
          this.dispatchEventNow(event, manifest, store),
        ),
      manifest.id,
    )
  }

  private async dispatchSignal(signal: Signal<unknown>): Promise<void> {
    const store = this.requireExecution('signal')
    if (store.boundary === 'realtime-command') store.context.cancellation.throwIfAborted()
    const manifest = this.#signalsByConstructor.get(signal.constructor)
    if (!manifest) {
      throw new OperationDispatchError(
        `${signal.constructor.name || 'Anonymous signal'} is not declared by a selected Feature.`,
      )
    }
    await this.observeObservation(
      'signal',
      manifest.id,
      { payload: signal.payload },
      () =>
        this.observeTelemetry('signal.dispatch', { id: manifest.id }, async () => {
          for (const handlerManifest of this.#signalHandlersBySignal.get(manifest.id) ?? []) {
            if (handlerManifest.access !== 'public') {
              await this.authorization.authorize(handlerManifest.access)
            }
            const handler = store.scope.resolve(handlerManifest.id) as SignalHandler
            await this.observeObservation(
              'reaction',
              handlerManifest.id,
              { signal: manifest.id },
              () => handler.handle(signal),
              handlerManifest.id,
            )
          }
        }),
      manifest.id,
    )
  }

  private modelObserverDispatcher(store: ExecutionStore): ModelObserverDispatcher {
    return Object.freeze({
      dispatch: async (phase: ModelObserverPhase, model: Model): Promise<void> => {
        const definition = this.#modelsByConstructor.get(model.constructor)
        if (!definition) {
          throw new RuntimeIntegrityError(`${model.constructor.name} is not a declared Model.`)
        }
        await this.recordObservation({
          kind: 'model',
          name: phase,
          phase: 'occurred',
          roleId: definition.entityType,
          attributes: { model: definition.entityType, id: model.id, phase },
        })
        for (const manifest of this.#observersByModel.get(definition.entityType) ?? []) {
          if (!manifest.phases.includes(phase)) continue
          const observer = store.scope.resolve(manifest.id) as Observer
          await this.observeObservation(
            'reaction',
            manifest.id,
            { model: definition.entityType, phase },
            () => observer[phase](model),
            manifest.id,
          )
        }
      },
    })
  }

  private modelQueryDiagnosticRecorder(): (diagnostic: ModelQueryDiagnostic) => Promise<void> {
    return (diagnostic) =>
      this.recordObservation({
        kind: 'model',
        name: 'query',
        phase: 'occurred',
        roleId: diagnostic.entityType,
        attributes: { ...diagnostic },
      })
  }

  private modelOperationObserver(): ModelOperationObserver {
    if (!this.transactions?.serializesConcurrentOperations) {
      return Object.freeze({
        observe: <Output>(
          diagnostic: import('@doxajs/core').ModelOperationDiagnostic,
          work: () => Promise<Output>,
        ) =>
          this.observeObservation(
            'model',
            `${diagnostic.entityType}.${diagnostic.operation}`,
            { operation: diagnostic.operation, storage: diagnostic.storage },
            work,
            diagnostic.entityType,
          ),
      })
    }
    const active = new Set<import('@doxajs/core').ModelOperationDiagnostic>()
    let reportedConcurrency = false
    return Object.freeze({
      observe: async <Output>(
        diagnostic: import('@doxajs/core').ModelOperationDiagnostic,
        work: () => Promise<Output>,
      ) => {
        const running = active.values().next().value
        let report = Promise.resolve<unknown>(undefined)
        if (running && !reportedConcurrency) {
          reportedConcurrency = true
          const attributes = {
            activeOperation: running.operation,
            activeEntityType: running.entityType,
            queuedOperation: diagnostic.operation,
            queuedEntityType: diagnostic.entityType,
          }
          if (!this.production) {
            this.logger
              .channel('persistence')
              .warn(
                "Concurrent model operations were serialized to preserve this execution's persistence transaction and snapshot. Promise.all does not add database parallelism here; await sequentially or reduce database round trips.",
                attributes,
              )
          }
          report = Promise.all([
            this.recordObservation({
              kind: 'model',
              name: 'transaction serialization',
              phase: 'occurred',
              roleId: diagnostic.entityType,
              attributes,
            }),
            this.recordTelemetry({
              kind: 'metric',
              name: 'doxa.persistence.transaction.serialization.total',
              value: 1,
              unit: 'count',
              attributes,
            }),
          ])
        }
        active.add(diagnostic)
        try {
          const output = await this.observeObservation(
            'model',
            `${diagnostic.entityType}.${diagnostic.operation}`,
            { operation: diagnostic.operation, storage: diagnostic.storage },
            work,
            diagnostic.entityType,
          )
          await report
          return output
        } finally {
          active.delete(diagnostic)
        }
      },
    })
  }

  private async dispatchEventNow(
    event: Event<unknown>,
    manifest: EventManifestEntry,
    store: ExecutionStore,
    skipQueued = false,
  ): Promise<void> {
    if (this.eventTestHook?.dispatched({ id: manifest.id, event, context: store.context })) return
    for (const listener of this.#listenersByEvent.get(manifest.id) ?? []) {
      if (listener.delivery === 'queued' || listener.delivery === 'queued-after-commit') {
        if (!skipQueued) await this.enqueueListener(listener, manifest, event, store)
        continue
      }
      const unitOfWork = store.scope.currentUnitOfWork
      if (listener.delivery === 'after-commit' && unitOfWork) {
        unitOfWork.afterCommit(() => this.invokeListener(listener, event, store))
        continue
      }
      await this.invokeListener(listener, event, store)
    }
    if (manifest.broadcast === 'queued') {
      if (!skipQueued) await this.enqueueBroadcast(manifest, event, store)
    } else if (manifest.broadcast === 'now') {
      await this.publishBroadcast(manifest, event)
    }
  }

  private async enqueueBroadcast(
    manifest: EventManifestEntry,
    event: Event<unknown>,
    store: ExecutionStore,
  ): Promise<void> {
    const envelope = this.createQueueEnvelope(
      {
        kind: 'broadcast',
        targetId: manifest.id,
        eventId: manifest.id,
        eventVersion: manifest.payloadVersion,
        payload: serializeEventPayload(manifest, event),
        policy: { retries: 3, retryDelay: 1, backoff: true, timeout: 30 },
      },
      store,
    )
    await this.enqueueEnvelope(envelope, store)
    await this.recordObservation({
      kind: 'broadcast',
      name: manifest.id,
      phase: 'occurred',
      roleId: manifest.id,
      attributes: { delivery: 'queued', messageId: envelope.id },
    })
  }

  private async publishBroadcast(
    manifest: EventManifestEntry,
    event: Event<unknown>,
    messageId: string = randomUUID(),
  ): Promise<void> {
    if (!this.broadcastTransport) {
      throw new OperationDispatchError('No broadcasting transport is configured.')
    }
    const candidate = event as Event<unknown> & {
      broadcastOn(): BroadcastDestination | readonly BroadcastDestination[]
      broadcastAs?(): string
      broadcastWith?(): import('@doxajs/core').JsonValue
    }
    if (typeof candidate.broadcastOn !== 'function') {
      throw new OperationDispatchError(`${manifest.id} must define broadcastOn().`)
    }
    const selected = candidate.broadcastOn()
    const channels = (Array.isArray(selected) ? selected : [selected]).map((channel) => ({
      name: channel.name,
      kind: channel.kind,
    }))
    if (channels.length === 0) {
      throw new OperationDispatchError(`${manifest.id}.broadcastOn() returned no channels.`)
    }
    for (const channel of channels) {
      if (!['public', 'private', 'presence'].includes(channel.kind)) {
        throw new OperationDispatchError(`${manifest.id} returned an invalid broadcast channel.`)
      }
      validateBroadcastDestination(channel)
    }
    const eventName = candidate.broadcastAs?.() ?? manifest.id
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(eventName)) {
      throw new OperationDispatchError(`${manifest.id}.broadcastAs() returned an invalid name.`)
    }
    const message: BroadcastMessage = Object.freeze({
      id: messageId,
      event: eventName,
      channels: Object.freeze(channels),
      data: serializeBroadcastPayload(candidate.broadcastWith?.() ?? event.payload),
      occurredAt: new Date().toISOString(),
    })
    await this.observeObservation(
      'broadcast',
      manifest.id,
      { messageId: message.id, event: eventName, channels: channels.map((entry) => entry.name) },
      () => this.broadcastTransport!.publish(message),
      manifest.id,
    )
  }

  private async connectBroadcast(
    connectionId: string,
    request: Request,
  ): Promise<BroadcastConnectionAdmission> {
    const resolved = this.authentication
      ? await this.authentication.resolveHttp(request)
      : { actor: { kind: 'anonymous' as const }, authentication: { state: 'anonymous' as const } }
    return Object.freeze({
      connectionId,
      actor: Object.freeze({ ...resolved.actor }),
      authentication: Object.freeze({ ...resolved.authentication }),
      correlationId: randomUUID(),
    })
  }

  private subscribeBroadcast(
    admission: BroadcastConnectionAdmission,
    destination: BroadcastDestination,
  ): Promise<BroadcastSubscriptionAdmission> {
    validateBroadcastDestination(destination)
    return this.admit(
      {
        actor: admission.actor,
        authentication: admission.authentication,
        ...(admission.tenant ? { tenant: admission.tenant } : {}),
        correlationId: admission.correlationId,
        causationId: admission.connectionId,
        transport: { kind: 'websocket', name: 'broadcast.subscribe' },
      },
      async () => {
        if (destination.kind !== 'public') {
          const resource: BroadcastSubscriptionResource = {
            channel: destination.name,
            kind: destination.kind,
          }
          await this.authorization.authorize('broadcast.subscribe', resource)
        }
        await this.recordObservation({
          kind: 'broadcast',
          name: 'subscription',
          phase: 'occurred',
          attributes: { channel: destination.name, kind: destination.kind },
        })
        return destination.kind === 'presence'
          ? Object.freeze({ member: Object.freeze({ ...admission.actor }) })
          : Object.freeze({})
      },
    )
  }

  private unsubscribeBroadcast(
    admission: BroadcastConnectionAdmission,
    destination: BroadcastDestination,
  ): Promise<void> {
    validateBroadcastDestination(destination)
    return this.admit(
      {
        actor: admission.actor,
        authentication: admission.authentication,
        ...(admission.tenant ? { tenant: admission.tenant } : {}),
        correlationId: admission.correlationId,
        causationId: admission.connectionId,
        transport: { kind: 'websocket', name: 'broadcast.unsubscribe' },
      },
      () =>
        this.recordObservation({
          kind: 'broadcast',
          name: 'unsubscription',
          phase: 'occurred',
          attributes: { channel: destination.name, kind: destination.kind },
        }),
    )
  }

  dispatchRealtimeCommand(
    admission: BroadcastConnectionAdmission,
    request: RealtimeCommandRequest,
  ): Promise<RealtimeCommandResult> {
    if (
      admission.actor.kind === 'anonymous' ||
      !admission.actor.id ||
      admission.authentication.state !== 'authenticated'
    ) {
      return Promise.resolve(
        commandFailure(
          request.id,
          'command_unauthenticated',
          'That command requires authentication.',
        ),
      )
    }
    const manifest = this.#realtimeCommandsByName.get(request.command)
    if (!manifest)
      return Promise.resolve(
        commandFailure(request.id, 'command_unknown', 'That command is not available.'),
      )
    const Constructor = this.artifacts.registry.constructors[manifest.id] as
      | ((new (...dependencies: unknown[]) => RealtimeCommand<unknown>) & {
          readonly schema: StandardSchema<unknown, unknown>
        })
      | undefined
    if (!Constructor) {
      return Promise.resolve(
        commandFailure(request.id, 'command_failed', 'That command could not be processed.'),
      )
    }
    const deadline = Instant.fromEpochMicroseconds(BigInt(Date.now() + manifest.timeoutMs) * 1_000n)
    const execution = this.admit(
      {
        actor: admission.actor,
        authentication: admission.authentication,
        ...(admission.tenant ? { tenant: admission.tenant } : {}),
        correlationId: admission.correlationId,
        causationId: request.id,
        deadline,
        transport: { kind: 'websocket', name: `realtime.command:${manifest.command}` },
      },
      async () => {
        const store = this.requireExecution('realtime command')
        store.operationStack.push('realtime-command')
        try {
          store.context.cancellation.throwIfAborted()
          const throttle = await this.broadcastTransport!.consumeRealtimeCommandThrottle({
            actorId: admission.actor.id!,
            command: manifest.command,
            requestId: request.id,
            throttle: manifest.throttle,
          })
          store.context.cancellation.throwIfAborted()
          if (!throttle.allowed) {
            return commandFailure(
              request.id,
              'command_throttled',
              'That command is being sent too frequently.',
              throttle.retryAfterMs,
            )
          }
          const validation = await Constructor.schema['~standard'].validate(request.payload)
          store.context.cancellation.throwIfAborted()
          if ('issues' in validation && validation.issues) {
            return commandFailure(request.id, 'command_invalid', 'The command payload is invalid.')
          }
          const input = validation.value
          await this.authorization.authorize(manifest.access, input)
          store.context.cancellation.throwIfAborted()
          const command = store.scope.resolve(manifest.id) as RealtimeCommand<unknown>
          await this.observeObservation(
            'realtime-command',
            manifest.command,
            {},
            async () => {
              try {
                await command.handle(input)
              } catch (error) {
                throwPrivacySensitiveFailure(error, 'Realtime command failed.')
              }
            },
            manifest.id,
          )
          store.context.cancellation.throwIfAborted()
          return Object.freeze({ id: request.id, ok: true as const })
        } catch (error) {
          if (error instanceof AuthorizationError) {
            return commandFailure(request.id, 'command_forbidden', 'That command is not allowed.')
          }
          if (store.context.cancellation.aborted) {
            return commandFailure(
              request.id,
              'command_timeout',
              'That command exceeded its execution deadline.',
            )
          }
          return commandFailure(
            request.id,
            'command_failed',
            'That command could not be processed.',
          )
        } finally {
          store.operationStack.pop()
        }
      },
    )
    return settleAtDeadline(
      execution,
      deadline,
      commandFailure(
        request.id,
        'command_timeout',
        'That command exceeded its execution deadline.',
      ),
    ).catch(() =>
      commandFailure(request.id, 'command_failed', 'That command could not be processed.'),
    )
  }

  private async enqueueListener(
    listener: ListenerManifestEntry,
    eventManifest: EventManifestEntry,
    event: Event<unknown>,
    store: ExecutionStore,
  ): Promise<void> {
    const envelope = this.createQueueEnvelope(
      {
        kind: 'listener',
        targetId: listener.id,
        eventId: eventManifest.id,
        eventVersion: eventManifest.payloadVersion,
        payload: serializeEventPayload(eventManifest, event),
        policy: {
          retries: 3,
          retryDelay: 1,
          backoff: true,
          timeout: 30,
        },
      },
      store,
    )
    await this.enqueueEnvelope(envelope, store)
  }

  private async dispatchJob<Input, Instance extends Job<Input>>(
    Constructor: JobConstructor<Instance, Input>,
    input: Input,
    options?: JobDispatchOptions,
  ): Promise<string> {
    const store = this.requireExecution('job')
    if (store.boundary === 'realtime-command') {
      store.context.cancellation.throwIfAborted()
      throw new OperationDispatchError('Realtime commands cannot dispatch durable Jobs.')
    }
    const manifest = this.#jobsByConstructor.get(Constructor)
    if (!manifest) {
      throw new OperationDispatchError(
        `${Constructor.name || 'Anonymous job'} is not declared by a selected Feature.`,
      )
    }
    if (
      options?.delaySeconds !== undefined &&
      (!Number.isFinite(options.delaySeconds) || options.delaySeconds < 0)
    ) {
      throw new OperationDispatchError('Job delaySeconds must be a non-negative finite number.')
    }
    const availableAt =
      options?.delaySeconds === undefined
        ? undefined
        : Instant.fromEpochMicroseconds(
            Instant.now().epochMicroseconds + BigInt(Math.round(options.delaySeconds * 1_000_000)),
          )
    const envelope = this.createQueueEnvelope(
      {
        kind: 'job',
        targetId: manifest.id,
        payload: serializeQueuePayload(input),
        policy: {
          retries: manifest.retries,
          retryDelay: manifest.retryDelay,
          backoff: manifest.backoff,
          timeout: manifest.timeout,
        },
        ...(availableAt ? { availableAt: availableAt.toString() } : {}),
        ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      },
      store,
    )
    await this.enqueueEnvelope(envelope, store, availableAt)
    await this.recordObservation({
      kind: 'job',
      name: 'queued',
      phase: 'occurred',
      roleId: manifest.id,
      attributes: {
        jobId: envelope.id,
        ...(availableAt ? { availableAt: availableAt.toString() } : {}),
      },
    })
    this.logger.channel('queue').info('Job queued', {
      id: envelope.id,
      job: manifest.id,
      ...(availableAt ? { availableAt: availableAt.toString() } : {}),
    })
    return envelope.id
  }

  async dispatchMail(message: MailMessage): Promise<string> {
    return this.dispatchCommunication('mail', message)
  }

  async dispatchSms(message: SmsMessage): Promise<string> {
    return this.dispatchCommunication('sms', message)
  }

  async recordDelivery(transition: DeliveryTransition): Promise<void> {
    const store = this.requireExecution('delivery ledger')
    const unitOfWork = store.scope.currentUnitOfWork
    if (!unitOfWork)
      throw new OperationDispatchError('Delivery reconciliation requires a mutating action or job.')
    await unitOfWork.transitionDelivery(transition)
  }

  private async dispatchCommunication(
    channel: 'mail' | 'sms',
    message: MailMessage | SmsMessage,
  ): Promise<string> {
    const store = this.requireExecution(channel)
    const unitOfWork = store.scope.currentUnitOfWork
    if (!unitOfWork)
      throw new OperationDispatchError(
        `${channel} delivery must be queued inside a mutating action or job.`,
      )
    const transport = channel === 'mail' ? this.mailTransport : this.smsTransport
    if (!transport) throw new OperationDispatchError(`No ${channel} transport is configured.`)
    await unitOfWork.stageDelivery({
      id: message.id,
      channel,
      recipients: channel === 'mail' ? (message as MailMessage).to : [(message as SmsMessage).to],
      payload: serializeQueuePayload(message),
    })
    const envelope = this.createQueueEnvelope(
      {
        kind: channel,
        targetId: `doxa:${channel}`,
        payload: serializeQueuePayload(message),
        policy: { retries: 3, retryDelay: 1, backoff: true, timeout: 30 },
      },
      store,
    )
    await this.enqueueEnvelope(envelope, store)
    await this.recordObservation({
      kind: channel,
      name: 'queued',
      phase: 'occurred',
      attributes: { messageId: message.id },
    })
    await this.recordTelemetry({
      kind: 'metric',
      name: `doxa.${channel}.queued`,
      value: 1,
      unit: 'count',
      attributes: { channel },
    })
    return message.id
  }

  private createQueueEnvelope(
    delivery: Omit<QueueEnvelope, 'id' | 'context'>,
    store: ExecutionStore,
  ): QueueEnvelope {
    return {
      id: delivery.idempotencyKey
        ? deterministicJobId(delivery.targetId, delivery.idempotencyKey)
        : randomUUID(),
      ...delivery,
      context: queueContext(this.currentExecutionContext()),
    }
  }

  private async enqueueEnvelope(
    envelope: QueueEnvelope,
    store: ExecutionStore,
    availableAt?: Instant,
  ): Promise<void> {
    if (!this.queues) throw new OperationDispatchError('No queue manager is available.')
    const unitOfWork = store.scope.currentUnitOfWork
    if (unitOfWork) {
      await unitOfWork.enqueue({
        type: 'doxa.queue',
        payload: envelope as unknown as import('@doxajs/core').JsonValue,
        ...(availableAt ? { availableAt } : {}),
      })
      return
    }
    await this.observeObservation(
      'job',
      'queue.enqueue',
      { kind: envelope.kind, targetId: envelope.targetId },
      () => this.queues!.enqueue(envelope),
    )
  }

  private async observeLog<Output>(
    channel: string,
    operation: string,
    attributes: Readonly<Record<string, unknown>>,
    work: () => Output | Promise<Output>,
  ): Promise<Output> {
    const logger = this.logger.channel(channel)
    const startedAt = performance.now()
    logger.debug(`${operation} started`, attributes)
    try {
      const output = await work()
      logger.debug(`${operation} completed`, {
        ...attributes,
        durationMs: performance.now() - startedAt,
      })
      return output
    } catch (error) {
      logger.error(`${operation} failed`, error, {
        ...attributes,
        durationMs: performance.now() - startedAt,
      })
      throw error
    }
  }

  private async handleQueueDelivery(delivery: QueueDelivery): Promise<void> {
    const { envelope, attempt } = delivery
    assertQueueDelivery(envelope, attempt)
    const priorAttemptTrace =
      attempt > 1 ? await this.findQueueAttemptTrace(envelope.id, attempt - 1) : undefined
    let succeeded = false
    try {
      await this.observeTelemetry(
        'queue.delivery',
        {
          kind: envelope.kind,
          target: envelope.targetId,
          scheduled: Boolean(envelope.scheduleId),
          attempt,
        },
        () =>
          this.#admitExecution(
            {
              ...queueSeed(envelope, attempt, priorAttemptTrace),
              cancellation: delivery.cancellation,
            },
            async (context) => {
              await this.recordQueueAttemptTrace(envelope.id, attempt, context.trace)
              const store = this.requireExecution('job')
              store.job = Object.freeze({
                id: envelope.id,
                attempt,
                maxAttempts: envelope.policy.retries + 1,
                ...(envelope.idempotencyKey ? { idempotencyKey: envelope.idempotencyKey } : {}),
              })
              if (envelope.kind === 'job') {
                const manifest = this.#jobsById.get(envelope.targetId)
                if (!manifest)
                  throw new OperationDispatchError(
                    `Queued job ${envelope.targetId} is not declared.`,
                  )
                if (envelope.scheduleId) {
                  const schedule = this.#schedulesById.get(envelope.scheduleId)
                  if (!schedule)
                    throw new OperationDispatchError(
                      `Schedule ${envelope.scheduleId} is not declared.`,
                    )
                  if (schedule.access !== 'public')
                    await this.authorization.authorize(schedule.access)
                  await this.recordObservation({
                    kind: 'schedule',
                    name: schedule.id,
                    phase: 'occurred',
                    roleId: schedule.id,
                    attributes: { jobId: envelope.id, targetId: envelope.targetId },
                  })
                }
                await this.invokeJob(
                  manifest,
                  decodeDateTimeValues(envelope.payload) as import('@doxajs/core').JsonValue,
                  store,
                )
                return
              }
              if (envelope.kind === 'mail' || envelope.kind === 'sms') {
                await this.invokeCommunication(envelope, store)
                return
              }
              if (envelope.kind === 'broadcast') {
                const eventManifest = this.manifest.events.find(
                  (entry) => entry.id === envelope.targetId,
                )
                const EventConstructor = eventManifest
                  ? this.artifacts.registry.constructors[eventManifest.id]
                  : undefined
                if (
                  !eventManifest ||
                  !EventConstructor ||
                  envelope.eventVersion !== eventManifest.payloadVersion ||
                  typeof envelope.payload !== 'object' ||
                  envelope.payload === null ||
                  Array.isArray(envelope.payload)
                ) {
                  throw new OperationDispatchError(
                    `Queued broadcast ${envelope.targetId} cannot be rehydrated.`,
                  )
                }
                const event = rehydrateEvent(eventManifest, EventConstructor, envelope.payload)
                await this.publishBroadcast(eventManifest, event, envelope.id)
                return
              }
              const listener = this.manifest.listeners.find(
                (entry) => entry.id === envelope.targetId,
              )
              const eventManifest = envelope.eventId
                ? this.manifest.events.find((entry) => entry.id === envelope.eventId)
                : undefined
              if (!listener || !eventManifest) {
                throw new OperationDispatchError(
                  `Queued listener ${envelope.targetId} is not declared correctly.`,
                )
              }
              if (envelope.eventVersion !== eventManifest.payloadVersion) {
                throw new OperationDispatchError(
                  `Queued event ${eventManifest.id} payload version ${String(envelope.eventVersion)} is unsupported; expected ${eventManifest.payloadVersion}.`,
                )
              }
              const EventConstructor = this.artifacts.registry.constructors[eventManifest.id]
              if (
                !EventConstructor ||
                typeof envelope.payload !== 'object' ||
                envelope.payload === null ||
                Array.isArray(envelope.payload)
              ) {
                throw new OperationDispatchError(
                  `Queued event ${eventManifest.id} cannot be rehydrated.`,
                )
              }
              const event = rehydrateEvent(eventManifest, EventConstructor, envelope.payload)
              await this.invokeListener(listener, event, store)
            },
            queueAttemptSpanId(envelope.id, attempt),
          ),
      )
      succeeded = true
    } finally {
      if (succeeded || attempt >= envelope.policy.retries + 1) {
        await this.clearQueueAttemptTraces(envelope.id)
      }
    }
  }

  private async findQueueAttemptTrace(
    id: string,
    attempt: number,
  ): Promise<import('@doxajs/core').SpanLink | undefined> {
    try {
      return await this.queues?.findAttemptTrace(id, attempt)
    } catch {
      return undefined
    }
  }

  private async recordQueueAttemptTrace(
    id: string,
    attempt: number,
    trace: TraceContext,
  ): Promise<void> {
    if (!trace.traceId || !trace.spanId) return
    try {
      await this.queues?.recordAttemptTrace(id, attempt, {
        traceId: trace.traceId,
        spanId: trace.spanId,
      })
    } catch {
      /* Trace bookkeeping never changes job behavior. */
    }
  }

  private async clearQueueAttemptTraces(id: string): Promise<void> {
    try {
      await this.queues?.clearAttemptTraces(id)
    } catch {
      /* Trace bookkeeping never changes job behavior. */
    }
  }

  private async invokeCommunication(envelope: QueueEnvelope, store: ExecutionStore): Promise<void> {
    if (!this.transactions)
      throw new OperationDispatchError(
        'No transaction manager is available for delivery reconciliation.',
      )
    const transport = envelope.kind === 'mail' ? this.mailTransport : this.smsTransport
    if (!transport) throw new OperationDispatchError(`No ${envelope.kind} transport is configured.`)
    try {
      const acceptance = await this.observeObservation(
        envelope.kind,
        `${envelope.kind}.send`,
        { messageId: envelope.id },
        () =>
          envelope.kind === 'mail'
            ? (transport as MailTransport).send(
                decodeDateTimeValues(envelope.payload) as MailMessage,
              )
            : (transport as SmsTransport).send(
                decodeDateTimeValues(envelope.payload) as SmsMessage,
              ),
      )
      await this.observeObservation(
        'transaction',
        'delivery transition',
        { channel: envelope.kind },
        () =>
          this.transactions!.transaction(this.currentExecutionContext(), (unitOfWork) =>
            unitOfWork.transitionDelivery(acceptance),
          ),
      )
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error
      const state =
        error.kind === 'suppressed' || error.kind === 'opt-out'
          ? 'suppressed'
          : error.kind === 'transient'
            ? 'undelivered'
            : 'failed'
      await this.observeObservation(
        'transaction',
        'delivery failure transition',
        { channel: envelope.kind, failureKind: error.kind },
        () =>
          this.transactions!.transaction(this.currentExecutionContext(), (unitOfWork) =>
            unitOfWork.transitionDelivery({
              messageId: String((envelope.payload as { id?: unknown }).id),
              state,
              failureKind: error.kind,
              code: error.code,
            }),
          ),
      )
      if (error.kind === 'transient') throw error
    }
  }

  private async invokeJob(
    manifest: JobManifestEntry,
    payload: import('@doxajs/core').JsonValue,
    store: ExecutionStore,
  ): Promise<void> {
    if (!this.transactions) {
      throw new OperationDispatchError('No transaction manager is available for job execution.')
    }
    store.operationStack.push('job')
    try {
      await this.observeObservation(
        'job',
        manifest.id,
        {
          jobId: store.job?.id ?? 'unknown',
          attempt: store.job?.attempt ?? 0,
        },
        () =>
          this.observeObservation('transaction', 'job transaction', { operation: 'job' }, () =>
            this.transactions!.transaction(store.context, async (unitOfWork) => {
              return store.scope.withUnitOfWork(unitOfWork, async () => {
                if (manifest.access !== 'public') {
                  await this.authorization.authorize(manifest.access)
                }
                return this.runWritableModelSession(store, unitOfWork, async () => {
                  const handler = store.scope.resolve(manifest.id) as Job
                  await handler.handle(payload)
                })
              })
            }),
          ),
        manifest.id,
      )
    } finally {
      store.operationStack.pop()
    }
  }

  private async invokeListener(
    manifest: ListenerManifestEntry,
    event: Event<unknown>,
    store: ExecutionStore,
  ): Promise<void> {
    if (manifest.access !== 'public') await this.authorization.authorize(manifest.access)
    const listener = store.scope.resolve(manifest.id) as Listener
    await this.observeObservation(
      'listener',
      manifest.id,
      { event: event.constructor.name },
      () => listener.handle(event),
      manifest.id,
    )
  }

  async observeAi<Output>(
    metadata: AiOperationMetadata,
    work: () => Promise<AiObservedResult<Output>>,
  ): Promise<Output> {
    validateAiMetadata(metadata)
    return await this.observeObservation(
      metadata.kind,
      metadata.operationId,
      aiMetadataAttributes(metadata),
      async () => {
        const result = await work()
        validateAiOutcome(result.outcome)
        if (result.outcome) {
          await this.recordObservation({
            kind: metadata.kind,
            name: `${metadata.operationId}.outcome`,
            phase: 'occurred',
            attributes: aiOutcomeAttributes(result.outcome),
          })
        }
        return result.value
      },
      undefined,
      metadata.links,
    )
  }

  private requireExecution(
    role:
      | 'action'
      | 'query'
      | 'event'
      | 'signal'
      | 'job'
      | 'mail'
      | 'sms'
      | 'delivery ledger'
      | 'command'
      | 'realtime command'
      | 'HTTP route'
      | 'authorization',
  ): ExecutionStore {
    const store = this.#storage.getStore()
    if (!store) {
      throw new OperationDispatchError(`${role} dispatch requires an active admitted execution.`)
    }
    if (
      role !== 'realtime command' &&
      store.boundary === 'realtime-command' &&
      store.context.cancellation.aborted
    ) {
      store.context.cancellation.throwIfAborted()
    }
    return store
  }

  currentExecutionContext(): ExecutionContext {
    const store = this.#storage.getStore()
    if (!store) {
      throw new OperationDispatchError('CurrentExecution requires an active admitted execution.')
    }
    const trace = this.#traceStorage.getStore()
    return trace ? withTraceContext(store.context, trace) : store.context
  }

  private currentExecutionContextOrUndefined(): ExecutionContext | undefined {
    const store = this.#storage.getStore()
    if (!store) return undefined
    const trace = this.#traceStorage.getStore()
    return trace ? withTraceContext(store.context, trace) : store.context
  }

  currentOperationMode(): OperationMode {
    return this.#storage.getStore()?.operationStack.at(-1)
  }

  currentJobContext(): import('@doxajs/core').CurrentJobContext {
    const job = this.#storage.getStore()?.job
    if (!job) throw new OperationDispatchError('CurrentJob requires an active queue execution.')
    return job
  }

  async decideAuthorization<Resource>(
    ability: string,
    resource?: Resource,
  ): Promise<PolicyDecision> {
    const store = this.requireExecution('authorization')
    const constraints = store.context.authentication.constraints
    if (
      constraints &&
      constraints.length > 0 &&
      !constraints.some((value) => constraintAllows(value, ability))
    ) {
      return await this.recordAuthorizationDecision(
        ability,
        Object.freeze({
          effect: 'deny',
          policy: 'doxa:credential-constraints',
          code: 'credential_constraint_denied',
        }),
        store.context,
      )
    }
    const permissionSource = this.manifest.permissionSource
    const sourceManagesAbility = permissionSource?.abilities.includes(ability) ?? false
    if (permissionSource && sourceManagesAbility && this.#permissionSourceResolution.getStore()) {
      throw new RuntimeIntegrityError(
        `Permission source ${permissionSource.id} attempted recursive authorization while resolving abilities.`,
      )
    }
    const manifest = this.#policiesByAbility.get(ability)
    if (!sourceManagesAbility && !manifest) {
      return await this.recordAuthorizationDecision(
        ability,
        Object.freeze({
          effect: 'deny',
          policy: 'doxa:default-deny',
          code: 'policy_missing',
        }),
        store.context,
      )
    }
    if (sourceManagesAbility && store.permissionAbilities && !manifest) {
      const abilities = await store.permissionAbilities
      return await this.recordAuthorizationDecision(
        ability,
        Object.freeze(
          abilities.has(ability)
            ? {
                effect: 'allow',
                policy: permissionSource!.id,
                code: 'permission_granted',
              }
            : {
                effect: 'deny',
                policy: permissionSource!.id,
                code: 'permission_required',
              },
        ),
        store.context,
      )
    }
    return await this.withAuthorizationModelSession(store, async () => {
      if (permissionSource && sourceManagesAbility) {
        const abilities = await this.resolvePermissionAbilities(store, permissionSource)
        if (!abilities.has(ability)) {
          return await this.recordAuthorizationDecision(
            ability,
            Object.freeze({
              effect: 'deny',
              policy: permissionSource.id,
              code: 'permission_required',
            }),
            store.context,
          )
        }
      }
      if (!manifest) {
        return await this.recordAuthorizationDecision(
          ability,
          Object.freeze({
            effect: 'allow',
            policy: permissionSource!.id,
            code: 'permission_granted',
          }),
          store.context,
        )
      }
      return await this.evaluatePolicy(manifest, ability, resource)
    })
  }

  private async evaluatePolicy<Resource>(
    manifest: PolicyManifestEntry,
    ability: string,
    resource?: Resource,
  ): Promise<PolicyDecision> {
    const store = this.requireExecution('authorization')
    const policy = store.scope.resolve(manifest.id) as Policy<Resource>
    const context = this.currentExecutionContext()
    const decision = await this.observeObservation(
      'authorization',
      manifest.id,
      { ability },
      async () => {
        try {
          return await policy.decide({
            actor: context.actor,
            ability,
            ...(resource === undefined ? {} : { resource }),
            ...(context.tenant ? { tenant: context.tenant } : {}),
            context,
          })
        } catch (error) {
          if (store.boundary === 'realtime-command') {
            throwPrivacySensitiveFailure(error, 'Realtime command authorization failed.')
          }
          throw error
        }
      },
      manifest.id,
    )
    if ((decision.effect !== 'allow' && decision.effect !== 'deny') || !decision.code) {
      throw new RuntimeIntegrityError(`Policy ${manifest.id} returned an invalid decision.`)
    }
    return await this.recordAuthorizationDecision(
      ability,
      Object.freeze({
        effect: decision.effect,
        policy: manifest.id,
        code: decision.code,
      }),
      context,
    )
  }

  private async withAuthorizationModelSession<Output>(
    store: ExecutionStore,
    work: () => Promise<Output>,
  ): Promise<Output> {
    const guardedWork = () => store.scope.withReadOnlyUnitOfWorkInjection(work)
    const current = currentModelSessionState()
    if (current?.active && current.readOnly) return await guardedWork()
    const unitOfWork = store.scope.currentUnitOfWork
    if (unitOfWork) return await this.runReadOnlyModelSession(store, unitOfWork, guardedWork)
    if (!this.transactions) return await guardedWork()
    return await this.observeObservation(
      'transaction',
      'authorization read',
      { operation: 'authorization' },
      () =>
        this.observeTelemetry('persistence.transaction', { operation: 'authorization' }, () =>
          this.transactions!.read(store.context, (reader) =>
            this.runReadOnlyModelSession(store, reader, guardedWork),
          ),
        ),
    )
  }

  private async runReadOnlyModelSession<Output>(
    store: ExecutionStore,
    reader: import('@doxajs/core').ModelReader,
    work: () => Promise<Output>,
  ): Promise<Output> {
    const models = new ModelSession(
      reader,
      this.#modelsByConstructor,
      this.modelObserverDispatcher(store),
      false,
      this.modelQueryDiagnosticRecorder(),
      this.modelOperationObserver(),
    )
    return await runWithModelSession(models, async () => {
      try {
        return await work()
      } finally {
        models.close()
      }
    })
  }

  private async runWritableModelSession<Output>(
    store: ExecutionStore,
    unitOfWork: UnitOfWork,
    work: () => Promise<Output>,
  ): Promise<Output> {
    if (store.operationStack.at(-1) !== 'action' && store.operationStack.at(-1) !== 'job') {
      throw new RuntimeIntegrityError(
        'A writable ModelSession requires an action or job operation.',
      )
    }
    const models = new ModelSession(
      unitOfWork,
      this.#modelsByConstructor,
      this.modelObserverDispatcher(store),
      true,
      this.modelQueryDiagnosticRecorder(),
      this.modelOperationObserver(),
    )
    return await runWithModelSession(models, async () => {
      try {
        return await work()
      } finally {
        models.close()
      }
    })
  }

  private async resolvePermissionAbilities(
    store: ExecutionStore,
    manifest: PermissionSourceManifestEntry,
  ): Promise<ReadonlySet<string>> {
    if (this.#permissionSourceResolution.getStore()) {
      throw new RuntimeIntegrityError(
        `Permission source ${manifest.id} attempted recursive authorization while resolving abilities.`,
      )
    }
    store.permissionAbilities ??= this.observeObservation(
      'authorization',
      manifest.id,
      { declaredAbilities: manifest.abilities.length },
      async () => {
        try {
          const source = store.scope.resolve(manifest.id) as PermissionSource
          const context = this.currentExecutionContext()
          const resolved: readonly string[] = await this.#permissionSourceResolution.run(true, () =>
            source.resolve({
              actor: context.actor,
              ...(context.tenant ? { tenant: context.tenant } : {}),
              context,
            }),
          )
          if (
            !Array.isArray(resolved) ||
            !resolved.every((ability) => typeof ability === 'string')
          ) {
            throw new PermissionSourceIntegrityError(
              `Permission source ${manifest.id} must return an array of ability names.`,
            )
          }
          const declared = new Set(manifest.abilities)
          for (const ability of resolved) {
            if (!declared.has(ability)) {
              throw new PermissionSourceIntegrityError(
                `Permission source ${manifest.id} returned an ability outside its declared catalog.`,
              )
            }
          }
          return new Set(resolved)
        } catch (error) {
          if (error instanceof PermissionSourceIntegrityError) throw error
          if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
            markPrivacySensitiveError(error, 'Permission source failed.')
            throw error
          }
          throw new PermissionSourceResolutionFailure(error)
        }
      },
      manifest.id,
    )
    return await store.permissionAbilities
  }

  private async recordAuthorizationDecision(
    ability: string,
    decision: PolicyDecision,
    context: ExecutionContext,
  ): Promise<PolicyDecision> {
    if (this.authentication) {
      await this.observeObservation(
        'authorization',
        'authorization.audit',
        { ability, effect: decision.effect, policy: decision.policy, code: decision.code },
        () => this.authentication!.recordAuthorization(ability, decision, context),
      )
    }
    await this.recordTelemetry({
      kind: 'metric',
      name: 'doxa.authorization.decisions',
      value: 1,
      unit: 'count',
      attributes: {
        ability,
        effect: decision.effect,
        policy: decision.policy,
        code: decision.code,
      },
    })
    await this.recordObservation(
      {
        kind: 'authorization',
        name: ability,
        phase: 'occurred',
        roleId: decision.policy,
        attributes: {
          ability,
          effect: decision.effect,
          policy: decision.policy,
          code: decision.code,
        },
      },
      context,
    )
    this.logger.channel('auth').debug('Authorization decided', {
      ability,
      effect: decision.effect,
      policy: decision.policy,
      code: decision.code,
      actorKind: context.actor.kind,
    })
    return decision
  }

  private operationFor(Constructor: Function, role: 'action' | 'query'): OperationManifestEntry {
    const operation = this.#operationsByConstructor.get(Constructor)
    if (!operation || operation.role !== role) {
      throw new OperationDispatchError(
        `${Constructor.name || 'Anonymous class'} is not a declared ${role}.`,
      )
    }
    return operation
  }

  shutdown(): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise
    if (this.#state === 'stopped') return Promise.resolve()

    this.#shutdownPromise = this.#performShutdown()
    return this.#shutdownPromise
  }

  async #performShutdown(): Promise<void> {
    const startedAt = performance.now()
    this.logger.channel('lifecycle').info('Application shutting down')
    const reverse = [...this.participants].reverse()
    const errors: unknown[] = []
    this.#state = 'draining'
    await this.observeTelemetry('lifecycle.phase', { phase: 'drain', participant: 'runtime' }, () =>
      invokePhase(reverse, 'drain', this.deadlines.drain, errors),
    )
    await this.#drainExecutions(errors)
    this.#state = 'stopping'
    await this.observeTelemetry('lifecycle.phase', { phase: 'stop', participant: 'runtime' }, () =>
      invokePhase(reverse, 'stop', this.deadlines.stop, errors),
    )
    this.#state = 'disposing'
    await this.observeTelemetry(
      'lifecycle.phase',
      { phase: 'dispose', participant: 'runtime' },
      () => invokePhase(reverse, 'dispose', this.deadlines.dispose, errors),
    )
    this.#state = 'stopped'
    if (errors.length > 0) {
      const error = new RuntimeShutdownError(errors)
      this.logger.channel('lifecycle').error('Application shutdown completed with errors', error, {
        durationMs: performance.now() - startedAt,
        errors: errors.length,
      })
      await this.logger.flush()
      throw error
    }
    this.logger
      .channel('lifecycle')
      .info('Application stopped', { durationMs: performance.now() - startedAt })
    await this.logger.flush()
  }

  async #drainExecutions(errors: unknown[]): Promise<void> {
    if (this.#activeExecutions.size === 0) return
    const executions = [...this.#activeExecutions.keys()]
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        Promise.allSettled(executions),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            for (const controller of this.#activeExecutions.values()) controller.abort()
            reject(new Error(`Doxa execution drain exceeded ${this.deadlines.drain}ms.`))
          }, this.deadlines.drain)
          timer.unref()
        }),
      ])
    } catch (error) {
      errors.push(error)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

class RuntimeActionBus extends ActionBus {
  constructor(private readonly runtime: DoxaRuntime) {
    super()
  }

  execute<Input, Output>(
    action: ActionClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>> {
    return this.runtime.dispatchAction(action, input)
  }
}

class RuntimeQueryBus extends QueryBus {
  constructor(private readonly runtime: DoxaRuntime) {
    super()
  }

  execute<Input, Output>(query: QueryClass<Input, Output>, input: Input): Promise<Awaited<Output>> {
    return this.runtime.dispatchQuery(query, input)
  }
}

class RuntimeMailer extends Mailer {
  constructor(private readonly runtime: DoxaRuntime) {
    super()
  }
  send(message: MailMessage): Promise<string> {
    return this.runtime.dispatchMail(message)
  }
}

class RuntimeSms extends Sms {
  constructor(private readonly runtime: DoxaRuntime) {
    super()
  }
  send(message: SmsMessage): Promise<string> {
    return this.runtime.dispatchSms(message)
  }
}

class RuntimeAiObservability extends AiObservability {
  constructor(private readonly runtime: DoxaRuntime) {
    super()
  }

  run<Output>(
    metadata: AiOperationMetadata,
    work: () => Promise<AiObservedResult<Output>>,
  ): Promise<Output> {
    return this.runtime.observeAi(metadata, work)
  }
}

class RuntimeDeliveryLedger extends DeliveryLedger {
  constructor(private readonly runtime: DoxaRuntime) {
    super()
  }
  record(transition: DeliveryTransition): Promise<void> {
    return this.runtime.recordDelivery(transition)
  }
}

class RuntimeAuthorization extends Authorization {
  constructor(private readonly runtime: DoxaRuntime) {
    super()
  }

  decide<Resource>(ability: string, resource?: Resource): Promise<PolicyDecision> {
    return this.runtime.decideAuthorization(ability, resource)
  }

  async authorize<Resource>(ability: string, resource?: Resource): Promise<void> {
    const decision = await this.decide(ability, resource)
    if (decision.effect === 'deny') throw new AuthorizationError(decision)
  }
}

class RuntimeCurrentExecution extends CurrentExecution {
  constructor(private readonly runtime: DoxaRuntime) {
    super()
  }

  get context(): ExecutionContext {
    return this.runtime.currentExecutionContext()
  }

  get mode(): OperationMode {
    return this.runtime.currentOperationMode()
  }

  assertWritable(): void {
    if (this.mode !== 'action' && this.mode !== 'job') {
      throw new ReadOnlyExecutionError('Mutation requires an active action or job execution.')
    }
  }
}

class RuntimeCurrentJob extends CurrentJob {
  constructor(private readonly runtime: DoxaRuntime) {
    super()
  }

  get context(): import('@doxajs/core').CurrentJobContext {
    return this.runtime.currentJobContext()
  }
}

export const Doxa = Object.freeze({
  async boot(application: ApplicationDeclaration, options: BootOptions = {}): Promise<DoxaRuntime> {
    // Runtime semantics come exclusively from generated artifacts. Constructor identity only
    // proves that the host passed the declaration linked by the matching registry.
    return DoxaRuntime.boot(application, options)
  },
})

async function loadArtifacts(artifactsDirectory: string): Promise<RuntimeArtifacts> {
  const manifestPath = path.join(artifactsDirectory, 'manifest.json')
  const registryPath = path.join(artifactsDirectory, 'registry.mjs')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new RuntimeIntegrityError(
      `Unable to load ${manifestPath}. Run doxa build before booting. ${errorMessage(error)}`,
    )
  }
  assertManifest(parsed)
  const manifest = parsed
  const { buildHash: declaredBuildHash, ...semanticManifest } = manifest
  const computedBuildHash = createHash('sha256')
    .update(canonicalJson(semanticManifest))
    .digest('hex')
  if (computedBuildHash !== declaredBuildHash) {
    throw new RuntimeIntegrityError(
      'Doxa manifest content does not match its build hash. Run doxa build.',
    )
  }

  let imported: unknown
  try {
    imported = await import(`${pathToFileURL(registryPath).href}?buildHash=${manifest.buildHash}`)
  } catch (error) {
    throw new RuntimeIntegrityError(
      `Unable to load ${registryPath}. Run doxa build before booting. ${errorMessage(error)}`,
    )
  }
  const registry = imported as RegistryModule
  if (registry.formatVersion !== MANIFEST_FORMAT_VERSION) {
    throw new RuntimeIntegrityError(
      `Registry format ${registry.formatVersion} is not supported. Run doxa build to rebuild the application artifacts.`,
    )
  }
  if (registry.buildHash !== manifest.buildHash) {
    throw new RuntimeIntegrityError(
      'Manifest and registry build hashes do not match. Run doxa build.',
    )
  }

  const expectedIds = [
    `application:${manifest.applicationId}`,
    ...manifest.configurations.map((entry) => entry.id),
    ...manifest.providers.map((entry) => entry.id),
    ...manifest.actions.map((entry) => entry.id),
    ...manifest.queries.map((entry) => entry.id),
    ...manifest.models.map((entry) => entry.id),
    ...manifest.observers.map((entry) => entry.id),
    ...manifest.routes.map((entry) => entry.id),
    ...manifest.events.map((entry) => entry.id),
    ...manifest.listeners.map((entry) => entry.id),
    ...manifest.jobs.map((entry) => entry.id),
    ...manifest.schedules.map((entry) => entry.id),
    ...manifest.policies.map((entry) => entry.id),
    ...(manifest.permissionSource ? [manifest.permissionSource.id] : []),
    ...manifest.signals.map((entry) => entry.id),
    ...manifest.signalHandlers.map((entry) => entry.id),
    ...manifest.commands.map((entry) => entry.id),
    ...manifest.realtimeCommands.map((entry) => entry.id),
  ].sort()
  const registryIds = Object.keys(registry.constructors ?? {}).sort()
  if (JSON.stringify(expectedIds) !== JSON.stringify(registryIds)) {
    throw new RuntimeIntegrityError(
      'Manifest and registry constructor IDs do not match. Run doxa build.',
    )
  }
  return { manifest, registry }
}

function providerIdsForProfile(
  manifest: DoxaManifest,
  profile: RuntimeProfile,
): ReadonlySet<string> | undefined {
  if (profile === 'application') return undefined
  const providerById = new Map(manifest.providers.map((provider) => [provider.id, provider]))
  const transactionProvider = manifest.providers.find((provider) =>
    provider.capabilities.includes('transactions'),
  )
  if (!transactionProvider) {
    throw new RuntimeIntegrityError(
      'The model-reader runtime profile requires a declared transaction provider.',
    )
  }
  const included = new Set<string>()
  const include = (id: string): void => {
    if (included.has(id)) return
    const provider = providerById.get(id)
    if (!provider) return
    included.add(id)
    for (const dependency of provider.dependencies) {
      if (dependency.targetId) include(dependency.targetId)
    }
  }
  include(transactionProvider.id)
  return included
}

function normalizeRuntimeProfile(value: unknown): RuntimeProfile {
  if (value === undefined || value === 'application') return 'application'
  if (value === 'model-reader') return value
  throw new RuntimeIntegrityError(`Unknown Doxa runtime profile ${String(value)}.`)
}

function configurationIdsForProviders(
  manifest: DoxaManifest,
  includedProviderIds: ReadonlySet<string> | undefined,
): ReadonlySet<string> | undefined {
  if (!includedProviderIds) return undefined
  const configurationIds = new Set(manifest.configurations.map((entry) => entry.id))
  const included = new Set<string>()
  for (const provider of manifest.providers) {
    if (!includedProviderIds.has(provider.id)) continue
    for (const dependency of provider.dependencies) {
      if (dependency.targetId && configurationIds.has(dependency.targetId)) {
        included.add(dependency.targetId)
      }
    }
  }
  return included
}

async function materializeConfigurations(
  artifacts: RuntimeArtifacts,
  options: BootOptions,
  includedConfigurationIds?: ReadonlySet<string>,
): Promise<Map<string, object>> {
  const dotenv =
    options.dotenvPath === false ? {} : await loadDotenv(path.resolve(options.dotenvPath ?? '.env'))
  const environment = options.environment ?? process.env
  const instances = new Map<string, object>()
  const issues: string[] = []

  for (const configuration of artifacts.manifest.configurations) {
    if (includedConfigurationIds && !includedConfigurationIds.has(configuration.id)) continue
    const Constructor = artifacts.registry.constructors[configuration.id]
    if (!Constructor) throw new RuntimeIntegrityError(`Registry is missing ${configuration.id}.`)
    const instance = Object.create(Constructor.prototype) as Record<string, unknown>
    const overrides = options.configurationOverrides?.[configuration.id] ?? {}

    for (const property of configuration.properties) {
      const source = Object.hasOwn(overrides, property.name)
        ? overrides[property.name]
        : environment[property.environmentKey] !== undefined
          ? environment[property.environmentKey]
          : dotenv[property.environmentKey] !== undefined
            ? dotenv[property.environmentKey]
            : property.defaultValue
      try {
        const value = resolveConfigurationValue(configuration, property, source)
        Object.defineProperty(instance, property.name, {
          value,
          enumerable: true,
          configurable: false,
          writable: false,
        })
      } catch (error) {
        issues.push(
          `${configuration.name}.${property.name} (${property.environmentKey}): ${errorMessage(error)}`,
        )
      }
    }

    instances.set(configuration.id, Object.freeze(instance))
  }

  if (issues.length > 0) throw new ConfigurationValidationError(issues)
  return instances
}

function resolveConfigurationValue(
  configuration: ConfigurationManifestEntry,
  property: ConfigurationPropertyManifest,
  source: unknown,
): ConfigurationDefault | SecretString | undefined {
  if (source === undefined) {
    if (property.optional) return undefined
    throw new Error(`required value is missing for ${configuration.id}`)
  }

  if (property.kind === 'literal-union') {
    const matched = property.allowedValues?.find((allowed) => String(allowed) === String(source))
    if (matched === undefined) {
      throw new Error(`expected one of ${property.allowedValues?.map(String).join(', ')}`)
    }
    return matched
  }
  if (property.kind === 'string') {
    if (typeof source !== 'string') throw new Error('expected a string')
    return source
  }
  if (property.kind === 'secret-string') {
    if (typeof source !== 'string') throw new Error('expected a secret string')
    return SecretString.from(source)
  }
  if (property.kind === 'number') {
    if (typeof source === 'number' && Number.isFinite(source)) return source
    if (typeof source === 'string' && source.trim() !== '') {
      const number = Number(source)
      if (Number.isFinite(number)) return number
    }
    throw new Error('expected a finite number')
  }
  if (typeof source === 'boolean') return source
  if (source === 'true') return true
  if (source === 'false') return false
  throw new Error('expected true or false')
}

function constructSingletonGraph(
  artifacts: RuntimeArtifacts,
  configurations: ReadonlyMap<string, object>,
  overrides: Readonly<Record<string, object>>,
  logger: Logger,
  includedProviderIds?: ReadonlySet<string>,
): RuntimeGraph {
  const providerById = new Map(
    artifacts.manifest.providers.map((provider) => [provider.id, provider]),
  )
  const singletonInstances = new Map<string, object>()
  const constructionStack = new Set<string>()
  const participantOrder: LifecycleParticipant[] = []
  for (const id of Object.keys(overrides)) {
    const provider = providerById.get(id)
    if (!provider || provider.scope !== 'singleton') {
      throw new RuntimeIntegrityError(
        `Test provider override ${id} is not a declared singleton provider.`,
      )
    }
  }

  const resolve = (id: string): object | undefined => {
    if (id === 'doxa:logger') return logger
    const configuration = configurations.get(id)
    if (configuration) return configuration
    const provider = providerById.get(id)
    if (!provider) return undefined
    if (includedProviderIds && !includedProviderIds.has(id)) return undefined
    if (provider.scope === 'singleton' && singletonInstances.has(id)) {
      return singletonInstances.get(id)
    }
    if (constructionStack.has(id)) {
      throw new RuntimeIntegrityError(`Dependency cycle reached while constructing ${id}.`)
    }
    constructionStack.add(id)
    try {
      const override = overrides[id]
      if (override) {
        for (const dependency of provider.dependencies) {
          if (dependency.targetId) resolve(dependency.targetId)
        }
        singletonInstances.set(id, override)
        participantOrder.push({
          manifest: {
            ...provider,
            lifecycle: {
              start: typeof (override as { start?: unknown }).start === 'function',
              drain: typeof (override as { drain?: unknown }).drain === 'function',
              stop: typeof (override as { stop?: unknown }).stop === 'function',
              dispose: typeof (override as { dispose?: unknown }).dispose === 'function',
            },
          },
          instance: override,
        })
        return override
      }
      const Constructor = artifacts.registry.constructors[id]
      if (!Constructor) throw new RuntimeIntegrityError(`Registry is missing constructor ${id}.`)
      const dependencies = provider.dependencies
        .filter((dependency) => dependency.kind === 'constructor')
        .map((dependency) => {
          if (!dependency.targetId) return undefined
          const resolved = resolve(dependency.targetId)
          if (resolved === undefined && !dependency.optional) {
            throw new RuntimeIntegrityError(
              `Required dependency ${dependency.targetId} for ${id} is unavailable.`,
            )
          }
          return resolved
        })
      const instance = new Constructor(...dependencies)
      if (provider.scope === 'singleton') {
        singletonInstances.set(id, instance)
        participantOrder.push({ manifest: provider, instance })
      }
      return instance
    } finally {
      constructionStack.delete(id)
    }
  }

  for (const provider of [...artifacts.manifest.providers].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (
      provider.scope === 'singleton' &&
      (!includedProviderIds || includedProviderIds.has(provider.id))
    )
      resolve(provider.id)
  }
  return {
    participants: participantOrder,
    singletonInstances,
    configurations,
  }
}

class ExecutionScope {
  readonly #providerById: ReadonlyMap<string, ProviderManifestEntry>
  readonly #executableById: ReadonlyMap<
    string,
    | OperationManifestEntry
    | RouteManifestEntry
    | ListenerManifestEntry
    | JobManifestEntry
    | PolicyManifestEntry
    | PermissionSourceManifestEntry
    | SignalHandlerManifestEntry
    | ObserverManifestEntry
    | CommandManifestEntry
    | RealtimeCommandManifestEntry
  >
  readonly #dependencyOwnerById: ReadonlyMap<
    string,
    | ProviderManifestEntry
    | OperationManifestEntry
    | RouteManifestEntry
    | EventManifestEntry
    | ListenerManifestEntry
    | JobManifestEntry
    | PolicyManifestEntry
    | PermissionSourceManifestEntry
    | SignalManifestEntry
    | SignalHandlerManifestEntry
    | ObserverManifestEntry
    | CommandManifestEntry
    | RealtimeCommandManifestEntry
  >
  readonly #instances = new Map<string, object>()
  readonly #constructionStack = new Set<string>()
  readonly #disposables: LifecycleParticipant[] = []
  readonly #idByConstructor = new Map<object, string>()
  readonly #readOnlyUnitOfWork = new ReadOnlyUnitOfWork()
  readonly #readOnlyUnitOfWorkInjection = new AsyncLocalStorage<boolean>()
  #unitOfWork: UnitOfWork | undefined
  #disposed = false

  constructor(
    private readonly artifacts: RuntimeArtifacts,
    private readonly graph: RuntimeGraph,
    private readonly actions: ActionBus,
    private readonly queries: QueryBus,
    private readonly currentExecution: CurrentExecution,
    private readonly currentJob: CurrentJob,
    private readonly authorization: Authorization,
    private readonly ai: AiObservability,
    private readonly mailer: Mailer,
    private readonly sms: Sms,
    private readonly deliveryLedger: DeliveryLedger,
    private readonly logger: Logger,
  ) {
    this.#providerById = new Map(
      artifacts.manifest.providers.map((provider) => [provider.id, provider]),
    )
    this.#executableById = new Map(
      [
        ...artifacts.manifest.actions,
        ...artifacts.manifest.queries,
        ...artifacts.manifest.routes,
        ...artifacts.manifest.listeners,
        ...artifacts.manifest.jobs,
        ...artifacts.manifest.policies,
        ...(artifacts.manifest.permissionSource ? [artifacts.manifest.permissionSource] : []),
        ...artifacts.manifest.signalHandlers,
        ...artifacts.manifest.observers,
        ...artifacts.manifest.commands,
        ...artifacts.manifest.realtimeCommands,
      ].map((executable) => [executable.id, executable]),
    )
    this.#dependencyOwnerById = new Map(
      [
        ...artifacts.manifest.providers,
        ...artifacts.manifest.actions,
        ...artifacts.manifest.queries,
        ...artifacts.manifest.routes,
        ...artifacts.manifest.events,
        ...artifacts.manifest.listeners,
        ...artifacts.manifest.jobs,
        ...artifacts.manifest.policies,
        ...(artifacts.manifest.permissionSource ? [artifacts.manifest.permissionSource] : []),
        ...artifacts.manifest.signals,
        ...artifacts.manifest.signalHandlers,
        ...artifacts.manifest.observers,
        ...artifacts.manifest.commands,
        ...artifacts.manifest.realtimeCommands,
      ].map((entry) => [entry.id, entry]),
    )
    for (const [id, Constructor] of Object.entries(artifacts.registry.constructors)) {
      this.#idByConstructor.set(Constructor, id)
    }
  }

  resolve(id: string): object | undefined {
    if (this.#disposed) {
      throw new OperationDispatchError('The current execution scope has already been disposed.')
    }
    if (id === 'doxa:action-bus') return this.actions
    if (id === 'doxa:query-bus') return this.queries
    if (id === 'doxa:current-execution') return this.currentExecution
    if (id === 'doxa:current-job') return this.currentJob
    if (id === 'doxa:authorization') return this.authorization
    if (id === 'doxa:ai-observability') return this.ai
    if (id === 'doxa:mailer') return this.mailer
    if (id === 'doxa:sms') return this.sms
    if (id === 'doxa:delivery-ledger') return this.deliveryLedger
    if (id === 'doxa:logger') return this.logger
    if (id === 'doxa:unit-of-work') {
      return this.#readOnlyUnitOfWorkInjection.getStore()
        ? this.#readOnlyUnitOfWork
        : (this.#unitOfWork ?? this.#readOnlyUnitOfWork)
    }
    const configuration = this.graph.configurations.get(id)
    if (configuration) return configuration
    const singleton = this.graph.singletonInstances.get(id)
    if (singleton) return singleton

    const manifest = this.#providerById.get(id) ?? this.#executableById.get(id)
    if (!manifest) return undefined
    if ('scope' in manifest && manifest.scope === 'execution' && this.#instances.has(id)) {
      return this.#instances.get(id)
    }
    if (this.#constructionStack.has(id)) {
      throw new RuntimeIntegrityError(`Dependency cycle reached while resolving ${id}.`)
    }

    this.#constructionStack.add(id)
    try {
      const Constructor = this.artifacts.registry.constructors[id]
      if (!Constructor) throw new RuntimeIntegrityError(`Registry is missing constructor ${id}.`)
      const dependencies = manifest.dependencies
        .filter((dependency) => dependency.kind === 'constructor')
        .map((dependency) => {
          if (!dependency.targetId) return undefined
          const resolved = this.resolve(dependency.targetId)
          if (resolved === undefined && !dependency.optional) {
            throw new RuntimeIntegrityError(
              `Required dependency ${dependency.targetId} for ${id} is unavailable.`,
            )
          }
          return resolved
        })
      const instance = runWithRoleConstruction(
        this.constructionContext,
        () => new Constructor(...dependencies),
      )
      if (manifest.scope === 'execution') this.#instances.set(id, instance)
      if (manifest.lifecycle.dispose) this.#disposables.push({ manifest, instance })
      return instance
    } finally {
      this.#constructionStack.delete(id)
    }
  }

  get constructionContext(): RoleConstructionContext {
    return {
      logger: this.logger,
      loggerFor: (owner) => {
        const manifest = this.#manifestForOwner(owner)
        return this.logger.channel(roleLogChannel(manifest?.name ?? owner.name))
      },
      resolve: <Value extends object>(
        token: RoleInjectionToken<Value>,
        optional: boolean,
        owner?: RoleInjectionToken,
      ): Value | undefined => {
        if (!owner) {
          throw new RuntimeIntegrityError('Role injection is missing its owning role class.')
        }
        const manifest = this.#manifestForOwner(owner)
        if (!manifest) {
          throw new RuntimeIntegrityError(
            `${owner.name || 'Anonymous role'} is not declared by a selected Feature.`,
          )
        }
        const targetId = this.#injectionTarget(manifest, token, optional)
        if (!targetId) return undefined
        const resolved = this.resolve(targetId)
        if (resolved === undefined) {
          throw new RuntimeIntegrityError(
            `Required role dependency ${targetId} for ${manifest.id} is unavailable.`,
          )
        }
        return resolved as Value
      },
    }
  }

  #manifestForOwner(owner: RoleInjectionToken) {
    const id = this.#idByConstructor.get(owner)
    return id ? this.#dependencyOwnerById.get(id) : undefined
  }

  #injectionTarget(
    manifest:
      | OperationManifestEntry
      | RouteManifestEntry
      | EventManifestEntry
      | ListenerManifestEntry
      | JobManifestEntry
      | PolicyManifestEntry
      | PermissionSourceManifestEntry
      | SignalManifestEntry
      | SignalHandlerManifestEntry
      | ObserverManifestEntry
      | CommandManifestEntry
      | RealtimeCommandManifestEntry
      | ProviderManifestEntry,
    token: RoleInjectionToken,
    optional: boolean,
  ): string | undefined {
    const directId = this.#idByConstructor.get(token)
    const builtinId = builtinInjectionId(token)
    const capability = injectionCapability(token)
    const capabilityId = capability
      ? [...this.#providerById.values()].find((provider) =>
          provider.capabilities.includes(capability),
        )?.id
      : undefined
    const inferredTargetId = builtinId ?? directId ?? capabilityId
    const dependency = manifest.dependencies.find(
      (entry) =>
        entry.kind === 'role' &&
        (entry.targetId === inferredTargetId ||
          (!inferredTargetId && optional && entry.optional && entry.token === token.name)),
    )
    if (!dependency || dependency.optional !== optional) {
      throw new RuntimeIntegrityError(
        `${manifest.id} attempted an undeclared this.inject(${token.name || 'anonymous'}). Run doxa build.`,
      )
    }
    return dependency.targetId
  }

  async dispose(timeout: number): Promise<readonly unknown[]> {
    if (this.#disposed) return []
    this.#disposed = true
    const errors: unknown[] = []
    await invokePhase([...this.#disposables].reverse(), 'dispose', timeout, errors)
    this.#instances.clear()
    return errors
  }

  async withUnitOfWork<Output>(
    unitOfWork: UnitOfWork,
    work: () => Promise<Output>,
  ): Promise<Output> {
    if (this.#unitOfWork) {
      throw new OperationDispatchError('Nested units of work are prohibited in the Doxa MVP.')
    }
    this.#unitOfWork = unitOfWork
    try {
      return await work()
    } finally {
      this.#unitOfWork = undefined
    }
  }

  get currentUnitOfWork(): UnitOfWork | undefined {
    return this.#unitOfWork
  }

  async withReadOnlyUnitOfWorkInjection<Output>(work: () => Promise<Output>): Promise<Output> {
    return await this.#readOnlyUnitOfWorkInjection.run(true, work)
  }
}

class ReadOnlyUnitOfWork extends UnitOfWork {
  findEntity<State extends import('@doxajs/core').JsonValue>(
    _type: string,
    _id: string,
  ): Promise<import('@doxajs/core').PersistedEntity<State> | undefined> {
    return Promise.reject(this.error())
  }

  queryEntities<State extends import('@doxajs/core').JsonValue>(
    _type: string,
    _storage: import('@doxajs/core').ModelStorage,
    _plan: import('@doxajs/core').ModelQueryPlan,
  ): Promise<readonly import('@doxajs/core').PersistedEntity<State>[]> {
    return Promise.reject(this.error())
  }

  aggregateEntities(
    _type: string,
    _storage: import('@doxajs/core').ModelStorage,
    _plan: import('@doxajs/core').ModelQueryPlan,
    _operation: 'count' | 'min' | 'max' | 'sum' | 'average',
    _attribute?: string,
  ): Promise<number | import('@doxajs/core').ModelQueryValue | undefined> {
    return Promise.reject(this.error())
  }

  saveEntity<State extends import('@doxajs/core').JsonValue>(
    _entity: import('@doxajs/core').SaveEntity<State>,
  ): Promise<number> {
    return Promise.reject(this.error())
  }

  deleteEntity(_type: string, _id: string, _expectedVersion: number): Promise<void> {
    return Promise.reject(this.error())
  }

  record<Payload extends import('@doxajs/core').JsonValue>(
    _fact: import('@doxajs/core').JournalFact<Payload>,
  ): Promise<string> {
    return Promise.reject(this.error())
  }

  enqueue<Payload extends import('@doxajs/core').JsonValue>(
    _message: import('@doxajs/core').OutboxMessage<Payload>,
  ): Promise<string> {
    return Promise.reject(this.error())
  }

  stageDelivery(_delivery: import('@doxajs/core').StagedDelivery): Promise<void> {
    return Promise.reject(this.error())
  }

  transitionDelivery(_transition: import('@doxajs/core').DeliveryTransition): Promise<void> {
    return Promise.reject(this.error())
  }

  afterCommit(_callback: () => void | Promise<void>): void {
    throw this.error()
  }

  private error(): ReadOnlyExecutionError {
    return new ReadOnlyExecutionError(
      'Writable Unit of Work access is not available in this execution.',
    )
  }
}

function assertModelRelationships(
  models: ReadonlyMap<
    Function,
    {
      readonly entityType: string
      readonly storage: import('@doxajs/core').ModelStorage
      readonly attributes?: ReadonlySet<string>
    }
  >,
): void {
  for (const Constructor of models.keys()) {
    const relationships = (
      Constructor as typeof Model & {
        readonly relationships?: Readonly<Record<string, import('@doxajs/core').ModelRelationship>>
      }
    ).relationships
    for (const [name, relationship] of Object.entries(relationships ?? {})) {
      if (!name.trim()) {
        throw new RuntimeIntegrityError(`${Constructor.name} declares an empty relationship name.`)
      }
      let Related: Function
      try {
        Related = relationship.related()
      } catch (error) {
        throw new RuntimeIntegrityError(
          `${Constructor.name}.${name} could not resolve its related model: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (!models.has(Related)) {
        throw new RuntimeIntegrityError(
          `${Constructor.name}.${name} targets ${Related.name}, which is not declared by a selected Feature.`,
        )
      }
      if (relationship.kind === 'belongsToMany') {
        let Through: Function
        try {
          Through = relationship.through()
        } catch (error) {
          throw new RuntimeIntegrityError(
            `${Constructor.name}.${name} could not resolve its pivot model: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        if (!models.has(Through)) {
          throw new RuntimeIntegrityError(
            `${Constructor.name}.${name} uses ${Through.name} as a pivot model, but it is not declared by a selected Feature.`,
          )
        }
      }
      const keys =
        relationship.kind === 'belongsTo'
          ? [relationship.foreignKey, relationship.ownerKey]
          : relationship.kind === 'belongsToMany'
            ? [
                relationship.localKey,
                relationship.relatedKey,
                relationship.foreignKey,
                relationship.relatedForeignKey,
              ]
            : [relationship.localKey, relationship.foreignKey]
      if (keys.some((key) => !key.trim())) {
        throw new RuntimeIntegrityError(
          `${Constructor.name}.${name} declares an empty relationship key.`,
        )
      }
      const source = models.get(Constructor)!
      const target = models.get(Related)!
      if (relationship.kind === 'belongsTo') {
        assertRelationshipKey(Constructor, name, source, relationship.foreignKey)
        assertRelationshipKey(Constructor, name, target, relationship.ownerKey)
      } else if (relationship.kind === 'hasOne' || relationship.kind === 'hasMany') {
        assertRelationshipKey(Constructor, name, source, relationship.localKey)
        assertRelationshipKey(Constructor, name, target, relationship.foreignKey)
      } else {
        const pivot = models.get(relationship.through())!
        assertRelationshipKey(Constructor, name, source, relationship.localKey)
        assertRelationshipKey(Constructor, name, target, relationship.relatedKey)
        assertRelationshipKey(Constructor, name, pivot, relationship.foreignKey)
        assertRelationshipKey(Constructor, name, pivot, relationship.relatedForeignKey)
      }
    }
  }
}

function assertRelationshipKey(
  Constructor: Function,
  relationship: string,
  definition: { readonly entityType: string; readonly attributes?: ReadonlySet<string> },
  key: string,
): void {
  if (definition.attributes && !definition.attributes.has(key)) {
    throw new RuntimeIntegrityError(
      `${Constructor.name}.${relationship} references unknown ${definition.entityType} attribute ${key}.`,
    )
  }
}

function assertOperationInfrastructure(manifest: DoxaManifest): void {
  const transactionProviders = manifest.providers.filter((provider) =>
    provider.capabilities.includes('transactions'),
  )
  if (
    (manifest.actions.length > 0 || (manifest.queries.length > 0 && manifest.models.length > 0)) &&
    transactionProviders.length !== 1
  ) {
    throw new RuntimeIntegrityError(
      `Applications with writable actions or model queries require exactly one transaction provider; found ${transactionProviders.length}.`,
    )
  }
  const queueProviders = manifest.providers.filter((provider) =>
    provider.capabilities.includes('queues'),
  )
  const hasQueuedListeners = manifest.listeners.some(
    (listener) => listener.delivery === 'queued' || listener.delivery === 'queued-after-commit',
  )
  const hasCommunications = manifest.providers.some(
    (provider) => provider.capabilities.includes('mail') || provider.capabilities.includes('sms'),
  )
  const hasQueuedBroadcasts = manifest.events.some((event) => event.broadcast === 'queued')
  const broadcastingProviders = manifest.providers.filter((provider) =>
    provider.capabilities.includes('broadcasting'),
  )
  if (
    manifest.events.some((event) => event.broadcast !== false) &&
    broadcastingProviders.length !== 1
  ) {
    throw new RuntimeIntegrityError(
      `Applications with broadcast events require exactly one broadcasting provider; found ${broadcastingProviders.length}.`,
    )
  }
  if (
    manifest.events.some((event) => event.broadcast !== false) &&
    !manifest.policies.some((policy) => policy.abilities.includes('broadcast.subscribe'))
  ) {
    throw new RuntimeIntegrityError(
      'Applications with broadcast events must declare a Policy for the broadcast.subscribe ability.',
    )
  }
  if (
    (manifest.jobs.length > 0 || hasQueuedListeners || hasQueuedBroadcasts || hasCommunications) &&
    queueProviders.length !== 1
  ) {
    throw new RuntimeIntegrityError(
      `Applications with jobs, queued listeners, or queued broadcasts require exactly one queue provider; found ${queueProviders.length}.`,
    )
  }
}

function createExecutionContext(
  seed: ExecutionContextSeed,
  runtimeCancellation: AbortSignal,
  executionSpanId?: string,
  defaults: { readonly timeZone: string; readonly locale: string } = {
    timeZone: 'UTC',
    locale: 'en-US',
  },
): ExecutionContext {
  validateActor(seed.actor, 'actor')
  const initiator = seed.initiator ?? seed.actor
  validateActor(initiator, 'initiator')
  const executionId = randomUUID()
  const cancellation = seed.cancellation
    ? AbortSignal.any([seed.cancellation, runtimeCancellation])
    : runtimeCancellation
  const trace = seed.trace ?? {}
  let timeZone: string
  let locale: string
  try {
    timeZone = new Intl.DateTimeFormat('en-US', {
      timeZone: seed.timeZone ?? defaults.timeZone,
    }).resolvedOptions().timeZone
    locale = Intl.getCanonicalLocales(seed.locale ?? defaults.locale)[0]!
  } catch (cause) {
    throw new ExecutionAdmissionError('Execution locale or timeZone is invalid.', { cause })
  }
  const context: ExecutionContext = {
    executionId,
    ...(seed.sourceExecutionId ? { sourceExecutionId: seed.sourceExecutionId } : {}),
    correlationId: seed.correlationId ?? executionId,
    ...(seed.causationId ? { causationId: seed.causationId } : {}),
    actor: freezeActor(seed.actor),
    initiator: freezeActor(initiator),
    delegation: Object.freeze(
      (seed.delegation ?? []).map((hop) =>
        Object.freeze({
          ...hop,
          from: freezeActor(hop.from),
          to: freezeActor(hop.to),
        }),
      ),
    ),
    ...(seed.tenant ? { tenant: Object.freeze({ ...seed.tenant }) } : {}),
    authentication: Object.freeze(
      seed.authentication
        ? {
            ...seed.authentication,
            ...(seed.authentication.constraints
              ? { constraints: Object.freeze([...seed.authentication.constraints]) }
              : {}),
          }
        : seed.actor.kind === 'anonymous'
          ? { state: 'anonymous' as const }
          : { state: 'authenticated' as const },
    ),
    transport: Object.freeze({ ...seed.transport }),
    trace: Object.freeze({
      traceId: trace.traceId ?? randomBytes(16).toString('hex'),
      spanId: executionSpanId ?? randomBytes(8).toString('hex'),
      ...(trace.spanId ? { parentSpanId: trace.spanId } : {}),
      ...(trace.spanId ? { parentIsRemote: trace.isRemote === true } : {}),
      traceFlags: trace.traceFlags ?? 1,
      ...(trace.links?.length ? { links: freezeSpanLinks(trace.links) } : {}),
    }),
    locale,
    timeZone,
    ...(seed.deadline ? { deadline: seed.deadline } : {}),
    cancellation,
  }
  return Object.freeze(context)
}

function commandFailure(
  id: string,
  code: string,
  message: string,
  retryAfterMs?: number,
): RealtimeCommandResult {
  return Object.freeze({
    id,
    ok: false as const,
    error: Object.freeze({
      code,
      message,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    }),
  })
}

async function settleAtDeadline<Output>(
  work: Promise<Output>,
  deadline: Instant,
  fallback: Output,
): Promise<Output> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<Output>((resolve) => {
    timer = setTimeout(
      () => resolve(fallback),
      Math.max(0, Number(deadline.epochMicroseconds / 1_000n) - Date.now()),
    )
    timer.unref()
  })
  try {
    return await Promise.race([work, expired])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function telemetryAttributes(
  context: ExecutionContext,
): Readonly<Record<string, import('@doxajs/core').JsonValue>> {
  return Object.freeze({
    executionId: context.executionId,
    ...(context.sourceExecutionId ? { sourceExecutionId: context.sourceExecutionId } : {}),
    correlationId: context.correlationId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
    actorKind: context.actor.kind,
    ...(context.actor.id ? { actorId: context.actor.id } : {}),
    ...(context.tenant ? { tenantId: context.tenant.id } : {}),
    ...(context.tenant ? { tenantId: context.tenant.id } : {}),
    transport: context.transport.kind,
    ...(context.transport.name ? { transportName: context.transport.name } : {}),
    traceId: context.trace.traceId!,
    spanId: context.trace.spanId!,
  })
}

function observationContext(context: ExecutionContext | undefined): ObservationContext {
  if (!context) return Object.freeze({})
  return Object.freeze({
    executionId: context.executionId,
    ...(context.sourceExecutionId ? { sourceExecutionId: context.sourceExecutionId } : {}),
    correlationId: context.correlationId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
    ...(context.trace.traceId ? { traceId: context.trace.traceId } : {}),
    ...(context.trace.spanId ? { spanId: context.trace.spanId } : {}),
    ...(context.trace.parentSpanId ? { parentSpanId: context.trace.parentSpanId } : {}),
    ...(context.trace.links?.length ? { links: context.trace.links } : {}),
    actorKind: context.actor.kind,
    ...(context.actor.id ? { actorId: context.actor.id } : {}),
    ...(context.tenant ? { tenantId: context.tenant.id } : {}),
    transport: context.transport.kind,
    ...(context.transport.name ? { transportName: context.transport.name } : {}),
  })
}

function logContext(context: ExecutionContext): import('@doxajs/core').LogContext {
  return Object.freeze({
    executionId: context.executionId,
    correlationId: context.correlationId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
    actorKind: context.actor.kind,
    ...(context.actor.id ? { actorId: context.actor.id } : {}),
    ...(context.trace.traceId ? { traceId: context.trace.traceId } : {}),
    ...(context.trace.spanId ? { spanId: context.trace.spanId } : {}),
    ...(context.trace.parentSpanId ? { parentSpanId: context.trace.parentSpanId } : {}),
    transport: context.transport.kind,
  })
}

function childTraceContext(
  parent: TraceContext,
  links?: readonly import('@doxajs/core').SpanLink[],
): TraceContext {
  return Object.freeze({
    traceId: parent.traceId ?? randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    ...(parent.spanId ? { parentSpanId: parent.spanId } : {}),
    ...(parent.spanId ? { parentIsRemote: false } : {}),
    traceFlags: parent.traceFlags ?? 1,
    ...(links?.length ? { links: freezeSpanLinks(links) } : {}),
  })
}

function withTraceContext(context: ExecutionContext, trace: TraceContext): ExecutionContext {
  if (context.trace === trace) return context
  return Object.freeze({ ...context, trace })
}

function freezeSpanLinks(links: readonly import('@doxajs/core').SpanLink[]) {
  return Object.freeze(
    links.slice(0, 32).map((link) =>
      Object.freeze({
        traceId: link.traceId,
        spanId: link.spanId,
        ...(link.attributes ? { attributes: Object.freeze(structuredClone(link.attributes)) } : {}),
      }),
    ),
  )
}

function aiMetadataAttributes(metadata: AiOperationMetadata) {
  return Object.freeze({
    operationId: metadata.operationId,
    ...(metadata.provider ? { provider: metadata.provider } : {}),
    ...(metadata.model ? { model: metadata.model } : {}),
    ...(metadata.toolId ? { toolId: metadata.toolId } : {}),
    ...(metadata.criticId ? { criticId: metadata.criticId } : {}),
    ...(metadata.attempt === undefined ? {} : { attempt: metadata.attempt }),
    ...(metadata.retryCount === undefined ? {} : { retryCount: metadata.retryCount }),
  })
}

function aiOutcomeAttributes(outcome: AiOperationOutcome) {
  return Object.freeze({
    ...(outcome.tokenUsage?.input === undefined ? {} : { inputTokens: outcome.tokenUsage.input }),
    ...(outcome.tokenUsage?.output === undefined
      ? {}
      : { outputTokens: outcome.tokenUsage.output }),
    ...(outcome.tokenUsage?.cached === undefined
      ? {}
      : { cachedTokens: outcome.tokenUsage.cached }),
    ...(outcome.tokenUsage?.reasoning === undefined
      ? {}
      : { reasoningTokens: outcome.tokenUsage.reasoning }),
    ...(outcome.finishReason ? { finishReason: outcome.finishReason } : {}),
    ...(outcome.cached === undefined ? {} : { cached: outcome.cached }),
    ...(outcome.verdict ? { verdict: outcome.verdict } : {}),
    ...(outcome.score === undefined ? {} : { score: outcome.score }),
    ...(outcome.outcome ? { outcome: outcome.outcome } : {}),
    ...(outcome.reasonCode ? { reasonCode: outcome.reasonCode } : {}),
  })
}

function validateAiMetadata(metadata: AiOperationMetadata): void {
  for (const [name, value] of [
    ['operationId', metadata.operationId],
    ['provider', metadata.provider],
    ['model', metadata.model],
    ['toolId', metadata.toolId],
    ['criticId', metadata.criticId],
  ] as const) {
    if (value !== undefined && (!value.trim() || value.length > 200)) {
      throw new OperationDispatchError(`AI ${name} must be between 1 and 200 characters.`)
    }
  }
  for (const [name, value] of [
    ['attempt', metadata.attempt],
    ['retryCount', metadata.retryCount],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new OperationDispatchError(`AI ${name} must be a non-negative integer.`)
    }
  }
}

function validateAiOutcome(outcome: AiOperationOutcome | undefined): void {
  if (!outcome) return
  for (const [name, value] of Object.entries(outcome.tokenUsage ?? {})) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new OperationDispatchError(`AI ${name} token count must be a non-negative integer.`)
    }
  }
  if (outcome.score !== undefined && !Number.isFinite(outcome.score)) {
    throw new OperationDispatchError('AI critic score must be finite.')
  }
  for (const [name, value] of [
    ['finishReason', outcome.finishReason],
    ['outcome', outcome.outcome],
    ['reasonCode', outcome.reasonCode],
  ] as const) {
    if (value !== undefined && (!value.trim() || value.length > 200)) {
      throw new OperationDispatchError(`AI ${name} must be between 1 and 200 characters.`)
    }
  }
}

function logChannelForTransport(transport: ExecutionContext['transport']['kind']): string {
  if (transport === 'job' || transport === 'schedule')
    return transport === 'job' ? 'queue' : 'schedule'
  return transport
}

function logChannelForSubsystem(subsystem: string): string {
  if (subsystem.startsWith('persistence.')) return 'db'
  if (subsystem.startsWith('queue.')) return 'queue'
  if (subsystem.startsWith('auth.')) return 'auth'
  if (subsystem.startsWith('signal.')) return 'signal'
  if (subsystem.startsWith('event.')) return 'event'
  if (subsystem.startsWith('lifecycle.')) return 'lifecycle'
  return subsystem.split('.')[0] ?? 'app'
}

function humanizeSubsystem(subsystem: string): string {
  return subsystem
    .split('.')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function queueContext(context: ExecutionContext): QueueExecutionEnvelope {
  return {
    version: 1,
    sourceExecutionId: context.executionId,
    correlationId: context.correlationId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
    actor: { ...context.actor },
    initiator: { ...context.initiator },
    delegation: context.delegation.map((hop) => ({
      from: { ...hop.from },
      to: { ...hop.to },
      grantId: hop.grantId,
      reason: hop.reason,
      ...(hop.expiresAt ? { expiresAt: hop.expiresAt.toString() } : {}),
    })),
    ...(context.tenant ? { tenant: { ...context.tenant } } : {}),
    authentication: {
      state: context.authentication.state,
      ...(context.authentication.identityId
        ? { identityId: context.authentication.identityId }
        : {}),
      ...(context.authentication.method ? { method: context.authentication.method } : {}),
      ...(context.authentication.assurance ? { assurance: context.authentication.assurance } : {}),
      ...(context.authentication.authenticatedAt
        ? { authenticatedAt: context.authentication.authenticatedAt.toString() }
        : {}),
      ...(context.authentication.credentialId
        ? { credentialId: context.authentication.credentialId }
        : {}),
      ...(context.authentication.constraints
        ? { constraints: [...context.authentication.constraints] }
        : {}),
    },
    trace: { ...context.trace },
    ...(context.locale ? { locale: context.locale } : {}),
    ...(context.timeZone ? { timeZone: context.timeZone } : {}),
  }
}

function queueSeed(
  envelope: QueueEnvelope,
  attempt: number,
  priorAttemptTrace?: import('@doxajs/core').SpanLink,
): ExecutionContextSeed {
  const context = envelope.context
  const retryLink =
    attempt > 1 && priorAttemptTrace
      ? {
          traceId: priorAttemptTrace.traceId,
          spanId: priorAttemptTrace.spanId,
          attributes: { relationship: 'retry', attempt: attempt - 1 },
        }
      : undefined
  return {
    sourceExecutionId: context.sourceExecutionId,
    correlationId: context.correlationId,
    causationId: envelope.scheduleId ?? envelope.id,
    actor: { ...context.actor },
    initiator: { ...context.initiator },
    delegation: context.delegation.map((hop) => ({
      from: { ...hop.from },
      to: { ...hop.to },
      grantId: hop.grantId,
      reason: hop.reason,
      ...(hop.expiresAt ? { expiresAt: Instant.parse(hop.expiresAt) } : {}),
    })),
    ...(context.tenant ? { tenant: { ...context.tenant } } : {}),
    authentication: {
      state: context.authentication.state,
      ...(context.authentication.identityId
        ? { identityId: context.authentication.identityId }
        : {}),
      ...(context.authentication.method ? { method: context.authentication.method } : {}),
      ...(context.authentication.assurance ? { assurance: context.authentication.assurance } : {}),
      ...(context.authentication.authenticatedAt
        ? { authenticatedAt: Instant.parse(context.authentication.authenticatedAt) }
        : {}),
      ...(context.authentication.credentialId
        ? { credentialId: context.authentication.credentialId }
        : {}),
      ...(context.authentication.constraints
        ? { constraints: [...context.authentication.constraints] }
        : {}),
    },
    transport: { kind: 'job', name: envelope.targetId },
    trace: {
      ...context.trace,
      isRemote: true,
      ...(retryLink ? { links: [...(context.trace.links ?? []), retryLink] } : {}),
    },
    ...(context.locale ? { locale: context.locale } : {}),
    ...(context.timeZone ? { timeZone: context.timeZone } : {}),
  }
}

function assertQueueDelivery(envelope: QueueEnvelope, attempt: number): void {
  const invalid = (message: string): never => {
    throw new OperationDispatchError(`Invalid queued work: ${message}`)
  }
  const record = envelope as unknown as Record<string, unknown>
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    invalid('envelope is not an object.')
  }
  if (!uuid(record.id)) invalid('id is not a UUID.')
  if (!['job', 'listener', 'broadcast', 'mail', 'sms'].includes(String(record.kind))) {
    invalid('kind is unsupported.')
  }
  if (!boundedText(record.targetId, 256)) invalid('targetId is invalid.')
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 101) {
    invalid('attempt is invalid.')
  }
  const policy = record.policy as Record<string, unknown> | undefined
  if (
    !policy ||
    !integerBetween(policy.retries, 0, 100) ||
    !finiteBetween(policy.retryDelay, 0, 86_400) ||
    typeof policy.backoff !== 'boolean' ||
    !finiteBetween(policy.timeout, 1, 86_400)
  ) {
    invalid('retry policy is invalid.')
  }
  if (record.availableAt !== undefined && !validIsoDate(record.availableAt)) {
    invalid('availableAt is invalid.')
  }
  if (record.idempotencyKey !== undefined && !boundedText(record.idempotencyKey, 512)) {
    invalid('idempotencyKey is invalid.')
  }

  const context = record.context as Record<string, unknown> | undefined
  if (!context || context.version !== 1) invalid('context version is unsupported.')
  const validContext = context as Record<string, unknown>
  if (!onlyKeys(validContext, QUEUE_CONTEXT_KEYS)) invalid('context includes unsupported fields.')
  if (!uuid(validContext.sourceExecutionId)) invalid('sourceExecutionId is invalid.')
  if (!boundedText(validContext.correlationId, 256)) invalid('correlationId is invalid.')
  if (validContext.causationId !== undefined && !boundedText(validContext.causationId, 256)) {
    invalid('causationId is invalid.')
  }
  assertQueuedActor(validContext.actor, 'actor', invalid)
  assertQueuedActor(validContext.initiator, 'initiator', invalid)
  if (!Array.isArray(validContext.delegation) || validContext.delegation.length > 16) {
    invalid('delegation is invalid.')
  }
  const delegation = validContext.delegation as unknown[]
  for (const [index, value] of delegation.entries()) {
    const hop = value as Record<string, unknown> | undefined
    if (!hop || typeof hop !== 'object') invalid(`delegation ${index} is invalid.`)
    const validHop = hop as Record<string, unknown>
    if (!onlyKeys(validHop, DELEGATION_KEYS)) {
      invalid(`delegation ${index} includes unsupported fields.`)
    }
    assertQueuedActor(validHop.from, `delegation ${index} from`, invalid)
    assertQueuedActor(validHop.to, `delegation ${index} to`, invalid)
    if (!boundedText(validHop.grantId, 256) || !boundedText(validHop.reason, 512)) {
      invalid(`delegation ${index} metadata is invalid.`)
    }
    if (validHop.expiresAt !== undefined && !validIsoDate(validHop.expiresAt)) {
      invalid(`delegation ${index} expiry is invalid.`)
    }
  }
  const tenant = validContext.tenant as Record<string, unknown> | undefined
  if (
    tenant !== undefined &&
    (!tenant || !onlyKeys(tenant, TENANT_KEYS) || !boundedText(tenant.id, 256))
  ) {
    invalid('tenant context is invalid.')
  }
  if (validContext.locale !== undefined && !boundedText(validContext.locale, 128)) {
    invalid('locale is invalid.')
  }
  if (validContext.timeZone !== undefined && !boundedText(validContext.timeZone, 128)) {
    invalid('timeZone is invalid.')
  }
  const authentication = validContext.authentication as Record<string, unknown> | undefined
  if (
    !authentication ||
    !onlyKeys(authentication, AUTHENTICATION_KEYS) ||
    !['anonymous', 'authenticated'].includes(String(authentication.state)) ||
    (authentication.identityId !== undefined && !boundedText(authentication.identityId, 256)) ||
    (authentication.method !== undefined && !boundedText(authentication.method, 128)) ||
    (authentication.assurance !== undefined &&
      !['single-factor', 'multi-factor', 'phishing-resistant'].includes(
        String(authentication.assurance),
      )) ||
    (authentication.credentialId !== undefined && !boundedText(authentication.credentialId, 256)) ||
    (authentication.authenticatedAt !== undefined &&
      !validIsoDate(authentication.authenticatedAt)) ||
    (authentication.constraints !== undefined &&
      (!Array.isArray(authentication.constraints) ||
        authentication.constraints.length > 100 ||
        !authentication.constraints.every((value) => boundedText(value, 128))))
  ) {
    invalid('authentication context is invalid.')
  }
  const validAuthentication = authentication as Record<string, unknown>
  if (validAuthentication.state === 'anonymous' && validAuthentication.identityId !== undefined) {
    invalid('anonymous authentication includes an identity.')
  }
  const trace = validContext.trace as Record<string, unknown> | undefined
  if (!trace || !validTrace(trace)) invalid('trace context is invalid.')
}

function assertQueuedActor(
  value: unknown,
  label: string,
  invalid: (message: string) => never,
): void {
  const actor = value as Record<string, unknown> | undefined
  if (!actor || !['anonymous', 'user', 'service', 'system'].includes(String(actor.kind))) {
    invalid(`${label} is invalid.`)
  }
  if (!onlyKeys(actor, ACTOR_KEYS)) invalid(`${label} includes unsupported fields.`)
  if (actor.kind === 'anonymous' ? actor.id !== undefined : !boundedText(actor.id, 256)) {
    invalid(`${label} identity is invalid.`)
  }
}

function validTrace(trace: Record<string, unknown>): boolean {
  return (
    onlyKeys(trace, TRACE_KEYS) &&
    (trace.traceId === undefined || validTraceId(trace.traceId)) &&
    (trace.spanId === undefined || validSpanId(trace.spanId)) &&
    (trace.parentSpanId === undefined || validSpanId(trace.parentSpanId)) &&
    (trace.isRemote === undefined || typeof trace.isRemote === 'boolean') &&
    (trace.parentIsRemote === undefined || typeof trace.parentIsRemote === 'boolean') &&
    (trace.traceFlags === undefined || integerBetween(trace.traceFlags, 0, 255)) &&
    (trace.links === undefined ||
      (Array.isArray(trace.links) &&
        trace.links.length <= 32 &&
        trace.links.every((link) => validSpanLink(link))))
  )
}

function validSpanLink(value: unknown): boolean {
  const link = value as Record<string, unknown> | undefined
  return Boolean(
    link &&
    onlyKeys(link, SPAN_LINK_KEYS) &&
    validTraceId(link.traceId) &&
    validSpanId(link.spanId) &&
    (link.attributes === undefined || validJsonObject(link.attributes)),
  )
}

function validJsonObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    return JSON.stringify(value).length <= 16_384
  } catch {
    return false
  }
}

function validTraceId(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value) && !/^0+$/.test(value)
}

function validSpanId(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{16}$/i.test(value) && !/^0+$/.test(value)
}

function onlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key))
}

const QUEUE_CONTEXT_KEYS = new Set([
  'version',
  'sourceExecutionId',
  'correlationId',
  'causationId',
  'actor',
  'initiator',
  'delegation',
  'tenant',
  'authentication',
  'trace',
  'locale',
  'timeZone',
])
const ACTOR_KEYS = new Set(['kind', 'id'])
const DELEGATION_KEYS = new Set(['from', 'to', 'grantId', 'reason', 'expiresAt'])
const TENANT_KEYS = new Set(['id'])
const AUTHENTICATION_KEYS = new Set([
  'state',
  'identityId',
  'method',
  'assurance',
  'authenticatedAt',
  'credentialId',
  'constraints',
])
const TRACE_KEYS = new Set([
  'traceId',
  'spanId',
  'parentSpanId',
  'isRemote',
  'parentIsRemote',
  'traceFlags',
  'links',
])
const SPAN_LINK_KEYS = new Set(['traceId', 'spanId', 'attributes'])

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function integerBetween(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function finiteBetween(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function validIsoDate(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    Instant.parse(value)
    return true
  } catch {
    return false
  }
}

class PermissionSourceIntegrityError extends RuntimeIntegrityError {}

class PermissionSourceResolutionFailure extends Error {
  constructor(readonly original: unknown) {
    super('Permission source failed.')
    markPrivacySensitiveError(this, 'Permission source failed.')
  }
}

class PrivacySensitiveFailure extends Error {
  constructor(message: string) {
    super(message)
    markPrivacySensitiveError(this, message)
  }
}

function throwPrivacySensitiveFailure(error: unknown, diagnosticMessage: string): never {
  if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
    markPrivacySensitiveError(error, diagnosticMessage)
    throw error
  }
  throw new PrivacySensitiveFailure(diagnosticMessage)
}

function uuid(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function queueAttemptSpanId(envelopeId: string, attempt: number): string {
  return createHash('sha256')
    .update(`doxa:queue-attempt:${envelopeId}:${attempt}`)
    .digest('hex')
    .slice(0, 16)
}

function serializeQueuePayload(value: unknown): import('@doxajs/core').JsonValue {
  try {
    return encodeDateTimeValues(value) as import('@doxajs/core').JsonValue
  } catch (cause) {
    throw new OperationDispatchError('Queued payloads must be JSON serializable.', { cause })
  }
}

function serializeBroadcastPayload(value: unknown): import('@doxajs/core').JsonValue {
  try {
    return encodeDateTimeStrings(value) as import('@doxajs/core').JsonValue
  } catch (cause) {
    throw new OperationDispatchError('Broadcast payloads must be JSON serializable.', { cause })
  }
}

function serializeModelRecordValue(value: unknown): unknown {
  if (value === undefined) return null
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return null
  return JSON.parse(serialized) as unknown
}

function serializeEventPayload(
  manifest: EventManifestEntry,
  event: Event<unknown>,
): import('@doxajs/core').JsonValue {
  const payload = serializeQueuePayload(event.payload)
  return manifest.domain
    ? {
        entityId: (event as DomainEvent<unknown>).entityId,
        payload,
      }
    : payload
}

function rehydrateEvent(
  manifest: EventManifestEntry,
  Constructor: new (...dependencies: unknown[]) => object,
  serialized: import('@doxajs/core').JsonValue,
): Event<unknown> {
  const decoded = decodeDateTimeValues(serialized)
  if (!manifest.domain) return new Constructor(decoded) as Event<unknown>
  const record = decoded as Readonly<Record<string, import('@doxajs/core').JsonValue>>
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    Array.isArray(decoded) ||
    typeof record.entityId !== 'string' ||
    !('payload' in record)
  ) {
    throw new OperationDispatchError(`Queued DomainEvent ${manifest.id} is invalid.`)
  }
  return new Constructor(record.entityId, record.payload) as Event<unknown>
}

function validateBroadcastDestination(destination: BroadcastDestination): void {
  try {
    validateBroadcastChannelName(destination.name)
  } catch (cause) {
    throw new OperationDispatchError('Broadcast channel is invalid.', { cause })
  }
}

function deterministicJobId(targetId: string, idempotencyKey: string): string {
  const hex = createHash('sha256')
    .update(targetId)
    .update('\0')
    .update(idempotencyKey)
    .digest('hex')
    .slice(0, 32)
    .split('')
  hex[12] = '5'
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const value = hex.join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function freezeActor(actor: ActorRef): ActorRef {
  return Object.freeze({ ...actor })
}

function validateActor(actor: ActorRef, label: string): void {
  if (actor.kind === 'anonymous' && actor.id !== undefined) {
    throw new ExecutionAdmissionError(`Anonymous ${label} must not have an ID.`)
  }
  if (actor.kind !== 'anonymous' && !actor.id) {
    throw new ExecutionAdmissionError(`${label} kind ${actor.kind} requires an opaque ID.`)
  }
}

function normalizeAuthenticationAttribute(
  value: unknown,
  normalization: DoxaManifest['authentication']['identifier']['normalization'],
): string {
  if (typeof value !== 'string') {
    throw new RuntimeIntegrityError('Authentication identity attributes must be strings.')
  }
  if (normalization.preset === 'exact') return value.normalize('NFC')
  let normalized = value.trim().normalize('NFC').toLowerCase()
  if (normalization.preset === 'email-or-domain' && !normalized.includes('@')) {
    normalized = `${normalized}@${normalization.domain}`
  }
  if (
    (normalization.preset === 'email' || normalization.preset === 'email-or-domain') &&
    (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
  ) {
    throw new RuntimeIntegrityError('Authentication identity email is invalid.')
  }
  return normalized
}

async function loadDotenv(dotenvPath: string): Promise<Readonly<Record<string, string>>> {
  let contents: string
  try {
    contents = await readFile(dotenvPath, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return {}
    throw error
  }
  const values: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

const BUILTIN_INJECTION_IDS = new Map<object, string>([
  [ActionBus, 'doxa:action-bus'],
  [QueryBus, 'doxa:query-bus'],
  [CurrentExecution, 'doxa:current-execution'],
  [CurrentJob, 'doxa:current-job'],
  [Authorization, 'doxa:authorization'],
  [AiObservability, 'doxa:ai-observability'],
  [Mailer, 'doxa:mailer'],
  [Sms, 'doxa:sms'],
  [DeliveryLedger, 'doxa:delivery-ledger'],
  [Logger, 'doxa:logger'],
  [UnitOfWork, 'doxa:unit-of-work'],
])

const INJECTION_CAPABILITIES = new Map<object, ProviderManifestEntry['capabilities'][number]>([
  [Auth, 'authentication'],
  [TransactionManager, 'transactions'],
  [QueueManager, 'queues'],
  [Cache, 'cache'],
  [MailTransport, 'mail'],
  [SmsTransport, 'sms'],
  [BroadcastTransport, 'broadcasting'],
  [Telemetry, 'telemetry'],
])

function builtinInjectionId(token: RoleInjectionToken): string | undefined {
  return BUILTIN_INJECTION_IDS.get(token)
}

function injectionCapability(
  token: RoleInjectionToken,
): ProviderManifestEntry['capabilities'][number] | undefined {
  return INJECTION_CAPABILITIES.get(token)
}

function roleLogChannel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function constraintAllows(constraint: string, ability: string): boolean {
  if (constraint === '*' || constraint === ability) return true
  return constraint.endsWith('.*') && ability.startsWith(constraint.slice(0, -1))
}
