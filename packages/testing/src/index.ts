import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  Auth,
  type AuthAccessToken,
  type AuthAccessTokenGrant,
  type AuthChallengeGrant,
  type AuthIdentity,
  type AuthImpersonationGrant,
  type AuthRequestMetadata,
  type AuthSessionGrant,
  type AuthSession,
  type ActorRef,
  type AuthenticationContext,
  type ActionClass,
  type DoxaApplication,
  type DeliveryTransition,
  type ExecutionContext,
  Event,
  FakeBroadcastTransport,
  FakeMailTransport,
  FakeSmsTransport,
  type IssueAccessTokenInput,
  type JournalFact,
  Job,
  type JobConstructor,
  type JobDispatchOptions,
  type JsonValue,
  type LoginInput,
  MemoryCache,
  MemoryLogSink,
  MemoryObservationRecorder,
  MemoryTelemetry,
  applyModelQueryPlan,
  type ModelQueryPlan,
  type ModelQueryValue,
  type OutboxMessage,
  type PersistedEntity,
  type PolicyDecision,
  type QueryClass,
  type RealtimeCommandResult,
  type QueueDeliveryHandler,
  type QueueEnvelope,
  type QueueJobRecord,
  QueueManager,
  type RegistrationInput,
  type ResolvedHttpAuthentication,
  type ScheduleDefinition,
  type SaveEntity,
  SecretString,
  Signal,
  type SpanLink,
  type StagedDelivery,
  TransactionManager,
  UnitOfWork,
} from '@doxajs/core'
import { HonoHttpEngine } from '@doxajs/http-hono'
import { Doxa, type BootOptions, type DoxaRuntime, type EventTestHook } from '@doxajs/runtime'

export {
  FakeBroadcastTransport,
  FakeMailTransport,
  FakeSmsTransport,
  MemoryCache,
  MemoryLogSink,
  MemoryObservationRecorder,
  MemoryTelemetry,
}

export class TestObservationRecorder extends MemoryObservationRecorder {
  start(): void {}
  drain(): void {}
  dispose(): void {}
}

export interface TestEventRecord {
  readonly id: string
  readonly event: Event<unknown>
  readonly context: ExecutionContext
}

export class TestEvents implements EventTestHook {
  readonly records: TestEventRecord[] = []
  #runtime?: DoxaRuntime
  #fakeAll = false
  #faked = new Set<Function>()

  attach(runtime: DoxaRuntime): void {
    this.#runtime = runtime
  }

  shouldFake(event: Event<unknown>): boolean {
    return this.#fakeAll ? !this.#faked.has(event.constructor) : this.#faked.has(event.constructor)
  }

  dispatched(record: TestEventRecord): boolean {
    this.records.push(Object.freeze({ ...record }))
    return this.shouldFake(record.event)
  }

  fake(events?: readonly Function[]): this {
    this.#fakeAll = events === undefined
    this.#faked = new Set(events ?? [])
    return this
  }

  fakeExcept(events: readonly Function[]): this {
    this.#fakeAll = true
    this.#faked = new Set(events)
    return this
  }

  async fakeFor<Output>(
    events: readonly Function[] | undefined,
    work: () => Output | Promise<Output>,
  ) {
    const fakeAll = this.#fakeAll
    const faked = this.#faked
    this.fake(events)
    try {
      return await work()
    } finally {
      this.#fakeAll = fakeAll
      this.#faked = faked
    }
  }

  restore(): this {
    this.#fakeAll = false
    this.#faked.clear()
    return this
  }

  clear(): this {
    this.records.length = 0
    return this
  }

  assertDispatched<Instance extends Event<unknown>>(
    EventClass: abstract new (...arguments_: never[]) => Instance,
    predicate?: (event: Instance) => boolean,
  ): void {
    const found = this.records.some(
      (record) =>
        record.event instanceof EventClass && (!predicate || predicate(record.event as Instance)),
    )
    if (!found) throw new Error(`${EventClass.name} was not dispatched with the expected payload.`)
  }

  assertNotDispatched(EventClass: abstract new (...arguments_: never[]) => Event<unknown>): void {
    if (this.records.some((record) => record.event instanceof EventClass)) {
      throw new Error(`${EventClass.name} was dispatched unexpectedly.`)
    }
  }

  assertListening(
    EventClass: abstract new (...arguments_: never[]) => Event<unknown>,
    ListenerClass: abstract new (...arguments_: never[]) => object,
  ): void {
    const runtime = this.#runtime
    if (!runtime) throw new Error('TestEvents is not attached to a Doxa runtime.')
    const event = runtime.manifest.events.find((entry) => entry.name === EventClass.name)
    const listener = runtime.manifest.listeners.find((entry) => entry.name === ListenerClass.name)
    if (!event || !listener || listener.eventId !== event.id) {
      throw new Error(`${ListenerClass.name} is not declared as a listener for ${EventClass.name}.`)
    }
  }
}

export class DoxaTestHarness {
  readonly http: HonoHttpEngine
  readonly logs: MemoryLogSink
  #actor: ActorRef = { kind: 'anonymous' }
  #authentication: AuthenticationContext = { state: 'anonymous' }

  private constructor(
    readonly runtime: DoxaRuntime,
    logs: MemoryLogSink,
    readonly auth?: TestAuth,
    readonly observations?: TestObservationRecorder,
    readonly events: TestEvents = new TestEvents(),
  ) {
    this.http = new HonoHttpEngine(runtime)
    this.logs = logs
  }

  static async boot(
    application: abstract new () => DoxaApplication,
    options: BootOptions & { readonly authProviderId?: string } = {},
  ): Promise<DoxaTestHarness> {
    const auth = options.authProviderId ? new TestAuth() : undefined
    const observation = await testObservationOverride(options.artifactsDirectory)
    const overrides = {
      ...(observation && !(observation.providerId in (options.providerOverrides ?? {}))
        ? { [observation.providerId]: observation.recorder }
        : {}),
      ...options.providerOverrides,
      ...(auth && options.authProviderId ? { [options.authProviderId]: auth } : {}),
    }
    const logs = new MemoryLogSink()
    const events = new TestEvents()
    const logging =
      options.logging === false
        ? (false as const)
        : { level: 'debug' as const, ...options.logging, sink: logs }
    const runtime = await Doxa.boot(application, {
      ...options,
      roles: options.roles ?? { web: false, worker: false, scheduler: false },
      providerOverrides: overrides,
      eventTestHook: events,
      logging,
    })
    events.attach(runtime)
    return new DoxaTestHarness(runtime, logs, auth, observation?.recorder, events)
  }

  actingAs(actor: ActorRef, authentication?: AuthenticationContext): this {
    this.#actor = Object.freeze({ ...actor })
    this.#authentication = Object.freeze(authentication ?? authenticationFor(actor))
    this.auth?.actingAs(this.#actor, this.#authentication)
    return this
  }

  actingAsUser(id: string = randomUUID()): this {
    return this.actingAs({ kind: 'user', id })
  }
  actingAsSystem(id: string = 'doxa:test'): this {
    return this.actingAs({ kind: 'system', id })
  }
  asAnonymous(): this {
    return this.actingAs({ kind: 'anonymous' })
  }

  action<Input, Output>(
    action: ActionClass<Input, Output>,
    input: Input,
  ): Promise<Awaited<Output>> {
    return this.admit(() => this.runtime.actions.execute(action, input), 'test:action')
  }

  query<Input, Output>(query: QueryClass<Input, Output>, input: Input): Promise<Awaited<Output>> {
    return this.admit(() => this.runtime.queries.execute(query, input), 'test:query')
  }

  event<Arguments extends readonly unknown[], Instance extends Event<unknown>>(
    event: (new (...arguments_: Arguments) => Instance) & {
      readonly id: string
      dispatch(...arguments_: Arguments): Promise<void>
    },
    ...arguments_: Arguments
  ): Promise<void> {
    return this.admit(() => event.dispatch(...arguments_), `test:event:${event.id}`)
  }

  signal<Arguments extends readonly unknown[], Instance extends Signal<unknown>>(
    signal: (new (...arguments_: Arguments) => Instance) & {
      readonly id: string
      dispatch(...arguments_: Arguments): Promise<void>
    },
    ...arguments_: Arguments
  ): Promise<void> {
    return this.admit(() => signal.dispatch(...arguments_), `test:signal:${signal.id}`)
  }

  job<Input, Instance extends Job<Input>>(
    job: JobConstructor<Instance, Input> & {
      dispatch(input: Input, options?: JobDispatchOptions): Promise<string>
    },
    input: Input,
    options?: JobDispatchOptions,
  ): Promise<string> {
    return this.admit(() => job.dispatch(input, options), `test:job:${job.id}`)
  }

  command(name: string, arguments_: readonly string[] = []): Promise<void> {
    return this.admit(() => this.runtime.dispatchCommand(name, arguments_), `test:command:${name}`)
  }

  realtimeCommand(
    command: string,
    payload: unknown,
    id: string = randomUUID(),
  ): Promise<RealtimeCommandResult> {
    return this.runtime.dispatchRealtimeCommand(
      {
        connectionId: `test-connection:${id}`,
        actor: this.#actor,
        authentication: this.#authentication,
        correlationId: `test-realtime:${id}`,
      },
      { id, command, payload },
    )
  }

  request(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init)
    return this.http.fetch(request)
  }

  shutdown(): Promise<void> {
    return this.runtime.shutdown()
  }

  private admit<Output>(work: () => Promise<Output>, name: string): Promise<Output> {
    return this.runtime.admit(
      {
        actor: this.#actor,
        authentication: this.#authentication,
        transport: { kind: 'test', name },
      },
      work,
    )
  }
}

async function testObservationOverride(
  artifactsDirectory: string | undefined,
): Promise<
  { readonly providerId: string; readonly recorder: TestObservationRecorder } | undefined
> {
  const manifestPath = path.join(path.resolve(artifactsDirectory ?? '.doxa'), 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      providers?: Array<{ id: string; capabilities?: readonly string[] }>
    }
    const provider = manifest.providers?.find((entry) =>
      entry.capabilities?.includes('observations'),
    )
    return provider
      ? { providerId: provider.id, recorder: new TestObservationRecorder() }
      : undefined
  } catch {
    return undefined
  }
}

export class TestAuth extends Auth {
  readonly authorizationDecisions: Array<{ ability: string; decision: PolicyDecision }> = []
  readonly #identities = new Map<string, AuthIdentity>()
  readonly #sessions = new Map<string, AuthSession>()
  readonly #accessTokens = new Map<string, AuthAccessToken>()
  #resolved: ResolvedHttpAuthentication = {
    actor: { kind: 'anonymous' },
    authentication: { state: 'anonymous' },
  }

  actingAs(actor: ActorRef, authentication?: AuthenticationContext): void {
    if (actor.kind === 'user' && actor.id && !this.#identities.has(actor.id)) {
      this.#identities.set(actor.id, {
        id: actor.id,
        identifier: `${actor.id}@doxajs.test`,
        identifierKind: 'email',
        contactEmail: `${actor.id}@doxajs.test`,
        verification: 'verified',
        createdAt: new Date(),
      })
    }
    this.#resolved = {
      actor: { ...actor },
      authentication: authentication ?? authenticationFor(actor),
    }
  }
  async register(input: RegistrationInput): Promise<AuthIdentity> {
    const identity = {
      id: randomUUID(),
      identifier: input.identifier.toLowerCase(),
      identifierKind: 'email' as const,
      contactEmail: input.contactEmail?.toLowerCase() ?? input.identifier.toLowerCase(),
      verification: 'verified' as const,
      createdAt: new Date(),
    }
    this.#identities.set(identity.id, identity)
    return identity
  }
  async findIdentity(id: string): Promise<AuthIdentity | undefined> {
    return this.#identities.get(id)
  }
  async login(input: LoginInput, _metadata?: AuthRequestMetadata): Promise<AuthSessionGrant> {
    const identity =
      [...this.#identities.values()].find(
        (value) => value.identifier === input.identifier.toLowerCase(),
      ) ?? (await this.register({ ...input }))
    const now = new Date()
    const session = {
      id: randomUUID(),
      identityId: identity.id,
      createdAt: now,
      authenticatedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
    }
    this.#sessions.set(session.id, session)
    return { identity, session, token: SecretString.from(`test-session-${session.id}`) }
  }
  async issueEmailVerification(identityId: string): Promise<AuthChallengeGrant> {
    return {
      identityId,
      token: SecretString.from(`test-verify-${identityId}`),
      expiresAt: new Date(Date.now() + 3_600_000),
    }
  }
  async verifyEmail(token: string): Promise<AuthIdentity> {
    const id = token.replace(/^test-verify-/, '')
    const identity = this.#identities.get(id)
    if (!identity) throw new Error('Invalid test verification token.')
    const verified = { ...identity, verification: 'verified' as const }
    this.#identities.set(id, verified)
    return verified
  }
  async issuePasswordReset(identifier: string): Promise<AuthChallengeGrant | undefined> {
    const identity = [...this.#identities.values()].find(
      (value) => value.identifier === identifier.toLowerCase(),
    )
    return identity
      ? {
          identityId: identity.id,
          token: SecretString.from(`test-reset-${identity.id}`),
          expiresAt: new Date(Date.now() + 3_600_000),
        }
      : undefined
  }
  async resetPassword(_token: string, _newPassword: string): Promise<void> {}
  async changePassword(
    _identityId: string,
    _currentPassword: string,
    _newPassword: string,
  ): Promise<void> {}
  async reauthenticate(_identityId: string, sessionId: string, _password: string): Promise<Date> {
    const authenticatedAt = new Date()
    const session = this.#sessions.get(sessionId)
    if (session) this.#sessions.set(sessionId, { ...session, authenticatedAt })
    return authenticatedAt
  }
  async startImpersonation(
    identityId: string,
    sessionId: string,
    targetIdentityId: string,
    reason: string,
  ): Promise<AuthImpersonationGrant> {
    const identity = this.#identities.get(identityId)
    const target = this.#identities.get(targetIdentityId)
    const session = this.#sessions.get(sessionId)
    if (!identity || !target || !session || session.identityId !== identityId) {
      throw new Error('Test impersonation is not allowed.')
    }
    const impersonating = {
      ...session,
      impersonation: {
        grantId: randomUUID(),
        targetIdentityId,
        reason,
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    }
    this.#sessions.set(sessionId, impersonating)
    return {
      identity,
      target,
      session: impersonating,
      token: SecretString.from(`test-impersonation-${sessionId}`),
    }
  }
  async stopImpersonation(identityId: string, sessionId: string): Promise<AuthSessionGrant> {
    const identity = this.#identities.get(identityId)
    const session = this.#sessions.get(sessionId)
    if (!identity || !session?.impersonation) throw new Error('Test impersonation is not active.')
    const { impersonation: _impersonation, ...restored } = session
    this.#sessions.set(sessionId, restored)
    return {
      identity,
      session: restored,
      token: SecretString.from(`test-restored-${sessionId}`),
    }
  }
  async validateAuthentication(
    actor: ActorRef,
    authentication: AuthenticationContext,
  ): Promise<boolean> {
    if (authentication.state === 'anonymous') return actor.kind === 'anonymous'
    if (!authentication.sessionId && !authentication.impersonationGrantId)
      return actor.id === authentication.identityId
    const session = authentication.sessionId
      ? this.#sessions.get(authentication.sessionId)
      : [...this.#sessions.values()].find(
          (candidate) => candidate.impersonation?.grantId === authentication.impersonationGrantId,
        )
    return Boolean(
      session &&
      !session.revokedAt &&
      actor.id === (session.impersonation?.targetIdentityId ?? session.identityId) &&
      (authentication.impersonationGrantId === undefined ||
        authentication.impersonationGrantId === session.impersonation?.grantId),
    )
  }
  async revokeSession(id: string): Promise<void> {
    const value = this.#sessions.get(id)
    if (value) this.#sessions.set(id, { ...value, revokedAt: new Date() })
  }
  async listSessions(id: string): Promise<readonly AuthSession[]> {
    return [...this.#sessions.values()].filter((value) => value.identityId === id)
  }
  async revokeAllSessions(id: string): Promise<number> {
    const active = [...this.#sessions.values()].filter(
      (value) => value.identityId === id && !value.revokedAt,
    )
    for (const value of active) this.#sessions.set(value.id, { ...value, revokedAt: new Date() })
    return active.length
  }
  async issueAccessToken(
    identityId: string,
    input: IssueAccessTokenInput,
  ): Promise<AuthAccessTokenGrant> {
    const now = new Date()
    const id = randomUUID()
    const accessToken = {
      id,
      identityId,
      name: input.name,
      displayPrefix: 'test',
      constraints: input.constraints ?? [],
      createdAt: now,
      expiresAt: input.expiresAt ?? new Date(now.getTime() + 3_600_000),
    }
    this.#accessTokens.set(id, accessToken)
    return { accessToken, token: SecretString.from(`test-token-${id}`) }
  }
  async listAccessTokens(id: string): Promise<readonly AuthAccessToken[]> {
    return [...this.#accessTokens.values()].filter((value) => value.identityId === id)
  }
  rotateAccessToken(identityId: string, id: string): Promise<AuthAccessTokenGrant> {
    return this.issueAccessToken(identityId, { name: id })
  }
  async revokeAccessToken(identityId: string, tokenId: string): Promise<void> {
    const value = this.#accessTokens.get(tokenId)
    if (value?.identityId === identityId)
      this.#accessTokens.set(tokenId, { ...value, revokedAt: new Date() })
  }
  isSessionRevoked(id: string): boolean {
    return Boolean(this.#sessions.get(id)?.revokedAt)
  }
  isAccessTokenRevoked(id: string): boolean {
    return Boolean(this.#accessTokens.get(id)?.revokedAt)
  }
  async recordAuthorization(
    ability: string,
    decision: PolicyDecision,
    _context: ExecutionContext,
  ): Promise<void> {
    this.authorizationDecisions.push({ ability, decision })
  }
  async resolveHttp(_request: Request): Promise<ResolvedHttpAuthentication> {
    return this.#resolved
  }
  sessionCookie(grant: AuthSessionGrant): string {
    return `doxa_session=${grant.token.reveal()}; HttpOnly; SameSite=Lax; Path=/`
  }
  expiredSessionCookie(): string {
    return 'doxa_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/'
  }
}

export class FakeQueueManager extends QueueManager {
  readonly queued: QueueEnvelope[] = []
  readonly schedules = new Map<string, ScheduleDefinition>()
  readonly #attemptTraces = new Map<string, SpanLink>()
  #handler?: QueueDeliveryHandler
  bind(handler: QueueDeliveryHandler): void {
    this.#handler = handler
  }
  reconcileSchedules(schedules: readonly ScheduleDefinition[]): void {
    this.schedules.clear()
    for (const schedule of schedules) this.schedules.set(schedule.id, structuredClone(schedule))
  }
  async enqueue(envelope: QueueEnvelope): Promise<string> {
    this.queued.push(structuredClone(envelope))
    return envelope.id
  }
  async flushOutbox(): Promise<number> {
    return 0
  }
  async findJob(id: string): Promise<QueueJobRecord | undefined> {
    return this.queued.some((job) => job.id === id)
      ? { id, state: 'created', retryCount: 0, retryLimit: 0 }
      : undefined
  }
  async findAttemptTrace(id: string, attempt: number): Promise<SpanLink | undefined> {
    const trace = this.#attemptTraces.get(`${id}:${attempt}`)
    return trace ? structuredClone(trace) : undefined
  }
  async recordAttemptTrace(id: string, attempt: number, trace: SpanLink): Promise<void> {
    this.#attemptTraces.set(`${id}:${attempt}`, structuredClone(trace))
  }
  async clearAttemptTraces(id: string): Promise<void> {
    for (const key of this.#attemptTraces.keys()) {
      if (key.startsWith(`${id}:`)) this.#attemptTraces.delete(key)
    }
  }
  async runNext(attempt = 1): Promise<void> {
    const envelope = this.queued.shift()
    if (!envelope) throw new Error('No fake queue delivery is pending.')
    if (!this.#handler) throw new Error('Fake queue is not bound to a Doxa runtime.')
    await this.#handler({ envelope, attempt, cancellation: new AbortController().signal })
  }
  async runSchedule(id: string, attempt = 1): Promise<void> {
    const schedule = this.schedules.get(id)
    if (!schedule) throw new Error(`No fake schedule is declared with ID ${id}.`)
    if (!this.#handler) throw new Error('Fake queue is not bound to a Doxa runtime.')
    const envelopeId = randomUUID()
    await this.#handler({
      envelope: {
        id: envelopeId,
        kind: 'job',
        targetId: schedule.targetId,
        scheduleId: schedule.id,
        payload: schedule.input,
        policy: schedule.policy,
        context: {
          version: 1,
          sourceExecutionId: envelopeId,
          correlationId: envelopeId,
          causationId: schedule.id,
          actor: { kind: 'system', id: 'doxa:test-scheduler' },
          initiator: { kind: 'system', id: 'doxa:test-scheduler' },
          delegation: [],
          authentication: {
            state: 'authenticated',
            identityId: 'doxa:test-scheduler',
            method: 'schedule',
          },
          trace: {},
          timeZone: schedule.timeZone,
        },
      },
      attempt,
      cancellation: new AbortController().signal,
    })
  }
  hasQueued(target: string | { readonly id: string }): boolean {
    const id = typeof target === 'string' ? target : target.id
    return this.queued.some(
      (envelope) => envelope.targetId === id || envelope.targetId.endsWith(`/${id}`),
    )
  }
}

interface MemoryState {
  readonly entities: Map<string, PersistedEntity>
  readonly journal: JournalFact[]
  readonly outbox: OutboxMessage[]
  readonly deliveries: Map<string, StagedDelivery & { state: string }>
}

export class MemoryTransactionManager extends TransactionManager {
  readonly state: MemoryState = {
    entities: new Map(),
    journal: [],
    outbox: [],
    deliveries: new Map(),
  }
  constructor(private readonly queue?: QueueManager) {
    super()
  }
  async read<Output>(
    _context: ExecutionContext,
    work: (reader: import('@doxajs/core').ModelReader) => Promise<Output>,
  ): Promise<Output> {
    return work(new MemoryUnitOfWork(cloneState(this.state)))
  }
  async transaction<Output>(
    _context: ExecutionContext,
    work: (unitOfWork: UnitOfWork) => Promise<Output>,
  ): Promise<Output> {
    const draft = cloneState(this.state)
    const outboxStart = draft.outbox.length
    const unit = new MemoryUnitOfWork(draft)
    const output = await work(unit)
    replaceState(this.state, draft)
    await unit.commit()
    if (this.queue) {
      for (const message of draft.outbox.slice(outboxStart)) {
        if (message.type === 'doxa.queue')
          await this.queue.enqueue(message.payload as unknown as QueueEnvelope)
      }
    }
    return output
  }
}

class MemoryUnitOfWork extends UnitOfWork {
  readonly #afterCommit: Array<() => void | Promise<void>> = []
  constructor(private readonly state: MemoryState) {
    super()
  }
  async findEntity<State extends JsonValue>(
    type: string,
    id: string,
    storage: import('@doxajs/core').ModelStorage = { kind: 'entity-state' },
  ): Promise<PersistedEntity<State> | undefined> {
    const entity = this.state.entities.get(`${type}/${id}`)
    return entity ? (projectMemoryEntity(entity, storage) as PersistedEntity<State>) : undefined
  }
  async queryEntities<State extends JsonValue>(
    type: string,
    _storage: import('@doxajs/core').ModelStorage,
    plan: ModelQueryPlan,
  ): Promise<readonly PersistedEntity<State>[]> {
    const matches = [...this.state.entities.values()].filter((entity) => entity.type === type)
    const states = applyModelQueryPlan(
      matches.map((entity) => ({ ...(entity.state as Record<string, unknown>), __entity: entity })),
      plan,
    )
    return states.map(
      (state) =>
        projectMemoryEntity(state.__entity as PersistedEntity, _storage) as PersistedEntity<State>,
    )
  }
  async aggregateEntities(
    type: string,
    storage: import('@doxajs/core').ModelStorage,
    plan: ModelQueryPlan,
    operation: 'count' | 'min' | 'max' | 'sum' | 'average',
    attribute?: string,
  ): Promise<number | ModelQueryValue | undefined> {
    const { limit: _limit, offset: _offset, ...unbounded } = plan
    const entities = await this.queryEntities(type, storage, unbounded)
    if (operation === 'count') return entities.length
    const values = entities
      .map((entity) => (entity.state as Record<string, unknown>)[attribute!])
      .filter(
        (value): value is Exclude<ModelQueryValue, null> => value !== undefined && value !== null,
      )
    if (values.length === 0) return undefined
    if (operation === 'sum' || operation === 'average') {
      const total = values.reduce<number>((sum, value) => sum + Number(value), 0)
      return operation === 'sum' ? total : total / values.length
    }
    return values.reduce((selected, value) =>
      operation === 'min'
        ? value < selected
          ? value
          : selected
        : value > selected
          ? value
          : selected,
    )
  }
  async saveEntity<State extends JsonValue>(entity: SaveEntity<State>): Promise<number> {
    if (entity.storage?.kind === 'table' && entity.storage.readOnly) {
      throw new Error(`Mapped model ${entity.type} is read-only.`)
    }
    if (entity.storage?.kind === 'table') {
      const declared = new Set(Object.keys(entity.storage.columns))
      const written = entity.expectedVersion === undefined ? entity.state : (entity.patch ?? {})
      if (typeof written !== 'object' || written === null || Array.isArray(written)) {
        throw new Error(`Mapped model ${entity.type} state must be an object.`)
      }
      for (const attribute of Object.keys(written)) {
        if (!declared.has(attribute))
          throw new Error(`Mapped model write contains undeclared attribute ${attribute}.`)
      }
      for (const attribute of entity.removedAttributes ?? []) {
        if (!declared.has(attribute))
          throw new Error(`Mapped model write contains undeclared attribute ${attribute}.`)
      }
    }
    const key = `${entity.type}/${entity.id}`
    const current = this.state.entities.get(key)
    if (current?.version !== entity.expectedVersion)
      throw new Error(`Optimistic concurrency conflict for ${key}.`)
    const version = (current?.version ?? 0) + 1
    const state: Record<string, JsonValue> =
      current && entity.storage?.kind === 'table'
        ? {
            ...(current.state as Record<string, JsonValue>),
            ...(entity.patch ?? {}),
          }
        : (structuredClone(entity.state) as Record<string, JsonValue>)
    for (const attribute of entity.removedAttributes ?? []) delete state[attribute]
    this.state.entities.set(key, {
      type: entity.type,
      id: entity.id,
      version,
      state,
    })
    return version
  }
  async deleteEntity(
    type: string,
    id: string,
    expectedVersion: number,
    storage: import('@doxajs/core').ModelStorage = { kind: 'entity-state' },
  ): Promise<void> {
    if (storage.kind === 'table' && storage.readOnly) {
      throw new Error(`Mapped model ${type} is read-only.`)
    }
    const key = `${type}/${id}`
    if (this.state.entities.get(key)?.version !== expectedVersion)
      throw new Error(`Optimistic concurrency conflict for ${key}.`)
    this.state.entities.delete(key)
  }
  async record<Payload extends JsonValue>(fact: JournalFact<Payload>): Promise<string> {
    this.state.journal.push(structuredClone(fact))
    return randomUUID()
  }
  async enqueue<Payload extends JsonValue>(message: OutboxMessage<Payload>): Promise<string> {
    this.state.outbox.push(structuredClone(message))
    return randomUUID()
  }
  async stageDelivery(delivery: StagedDelivery): Promise<void> {
    this.state.deliveries.set(delivery.id, { ...structuredClone(delivery), state: 'pending' })
  }
  async transitionDelivery(transition: DeliveryTransition): Promise<void> {
    const value = this.state.deliveries.get(transition.messageId)
    if (value)
      this.state.deliveries.set(transition.messageId, { ...value, state: transition.state })
  }
  afterCommit(callback: () => void | Promise<void>): void {
    this.#afterCommit.push(callback)
  }
  async commit(): Promise<void> {
    for (const callback of this.#afterCommit) await callback()
  }
}

function projectMemoryEntity(
  entity: PersistedEntity,
  storage: import('@doxajs/core').ModelStorage,
): PersistedEntity {
  if (storage.kind !== 'table') return entity
  const state = entity.state as Record<string, JsonValue>
  return {
    ...entity,
    state: Object.fromEntries(
      Object.keys(storage.columns)
        .filter((attribute) => Object.hasOwn(state, attribute))
        .map((attribute) => [attribute, structuredClone(state[attribute]!)]),
    ) as Record<string, JsonValue>,
  }
}

function cloneState(state: MemoryState): MemoryState {
  return {
    entities: new Map(structuredClone([...state.entities])),
    journal: structuredClone(state.journal),
    outbox: structuredClone(state.outbox),
    deliveries: new Map(structuredClone([...state.deliveries])),
  }
}
function replaceState(target: MemoryState, source: MemoryState): void {
  target.entities.clear()
  for (const [key, value] of source.entities) target.entities.set(key, value)
  target.journal.splice(0, target.journal.length, ...source.journal)
  target.outbox.splice(0, target.outbox.length, ...source.outbox)
  target.deliveries.clear()
  for (const [key, value] of source.deliveries) target.deliveries.set(key, value)
}

function authenticationFor(actor: ActorRef): AuthenticationContext {
  return actor.kind === 'anonymous'
    ? { state: 'anonymous' }
    : { state: 'authenticated', ...(actor.id ? { identityId: actor.id } : {}), method: 'test' }
}
