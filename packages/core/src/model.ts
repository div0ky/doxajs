import { isDeepStrictEqual } from 'node:util'

import { currentModelSession, registerModelSessionState } from './model-session-context.js'
import {
  decodeDateTimeValues,
  encodeDateTimeValues,
  type EncodedDateTimeValue,
} from './datetime-codec.js'
import { Duration, Graphite, Instant, LocalDate } from './graphite.js'
import {
  PersistenceError,
  ReadOnlyExecutionError,
  type DoxaValue,
  type JsonValue,
  type ModelReader,
  type ModelStorage,
  type PersistedEntity,
  type UnitOfWork,
} from './index.js'
import type { ModelObserverDispatcher } from './observer.js'
import {
  InvalidModelCursorError,
  MODEL_QUERY_MAX_PAGE_SIZE,
  ModelQuery,
  ModelQueryError,
  type ModelCursorPage,
  type ModelEagerLoadConstraints,
  type ModelPage,
  type ModelQueryPlan,
  type ModelQueryValue,
  type ModelRelationPath,
  validateModelQueryPlan,
} from './model-query.js'
import type { ModelRelationship } from './model-relation.js'

export interface ModelAttributes {
  id: string
}

/** A model-specific object whose keys name declared relationships. */
export type ModelRelations = object

export type ModelConstructor<
  Instance extends Model<Attributes, any>,
  Attributes extends ModelAttributes,
> = {
  new (attributes: Attributes): Instance
  readonly id: string
  readonly table?: string
  readonly primaryKey?: string
  readonly versionColumn?: string
  readonly columns?: Readonly<Record<string, string>>
  readonly timestamps?: boolean | { readonly createdAt: string; readonly updatedAt: string }
  readonly managed?: boolean
  readonly readOnly?: boolean
  readonly relationships?: Readonly<Record<string, ModelRelationship>>
}

type RelationsOf<Instance extends Model<any, any>> =
  Instance extends Model<any, infer Relations> ? Relations : never
type ModelQueryInput<Attributes extends ModelAttributes> = Partial<{
  [Key in keyof Attributes]:
    Extract<Attributes[Key], ModelQueryValue> | (undefined extends Attributes[Key] ? null : never)
}>
type ModelQueryAttributeValue<Value> =
  Extract<Value, ModelQueryValue> | (undefined extends Value ? null : never)

export type ModelChanges<Attributes extends ModelAttributes> = {
  [Key in keyof Attributes]?: Attributes[Key] | undefined
}

type MutableModelAttributeKey<Attributes extends ModelAttributes> = Exclude<
  Extract<keyof Attributes, string>,
  'id'
>

type OptionalModelAttributeKey<Attributes extends ModelAttributes> = {
  [Key in MutableModelAttributeKey<Attributes>]-?: {} extends Pick<Attributes, Key> ? Key : never
}[MutableModelAttributeKey<Attributes>]

type ModelAttributeState<Attributes extends ModelAttributes> = Omit<Attributes, 'id'> & {
  readonly id: Attributes['id']
}

type ModelAttributeValue<
  Attributes extends ModelAttributes,
  Key extends MutableModelAttributeKey<Attributes>,
> =
  Key extends OptionalModelAttributeKey<Attributes>
    ? Attributes[Key] | undefined
    : Exclude<Attributes[Key], undefined>

export type ModelAttributePatch<Attributes extends ModelAttributes> = {
  [
    Key in Exclude<MutableModelAttributeKey<Attributes>, OptionalModelAttributeKey<Attributes>>
  ]?: Exclude<Attributes[Key], undefined>
} & {
  [Key in OptionalModelAttributeKey<Attributes>]?: Attributes[Key] | undefined
}

export interface ModelJournalFact<Payload extends DoxaValue = DoxaValue> {
  readonly type: string
  readonly payload: Payload
}

export interface ModelOutboxMessage<Payload extends DoxaValue = DoxaValue> {
  readonly type: string
  readonly payload: Payload
  readonly availableAt?: Instant
}

export interface ModelQueryDiagnostic {
  readonly model: string
  readonly entityType: string
  readonly terminal: NonNullable<ModelQueryPlan['diagnostic']>['terminal']
  readonly constraintCount: number
  readonly relationshipConstraintCount: number
  readonly ordering: readonly string[]
  readonly eagerLoads: readonly string[]
  readonly limit?: number
  readonly offset?: number
  readonly pageSize?: number
  readonly storage:
    | { readonly kind: 'entity-state' }
    | {
        readonly kind: 'table'
        readonly table: string
        readonly columns: Readonly<Record<string, string>>
      }
}

export interface ModelOperationDiagnostic {
  readonly operation: 'find' | 'save' | 'delete' | 'refresh' | 'query' | 'aggregate'
  readonly entityType: string
  readonly storage: ModelStorage['kind']
}

export interface ModelOperationObserver {
  observe<Output>(
    diagnostic: ModelOperationDiagnostic,
    work: () => Promise<Output>,
  ): Promise<Output>
}

export class ModelNotFoundError extends Error {
  override readonly name = 'ModelNotFoundError'

  constructor(
    readonly model: string,
    readonly id: string,
  ) {
    super(`${model} ${id} was not found.`)
  }
}

export class ModelNotRegisteredError extends Error {
  override readonly name = 'ModelNotRegisteredError'
}

export class DetachedModelError extends Error {
  override readonly name = 'DetachedModelError'
}

export class StaleModelError extends Error {
  override readonly name = 'StaleModelError'
}

export class ModelIdentityMutationError extends Error {
  override readonly name = 'ModelIdentityMutationError'

  constructor() {
    super('Model identity attribute id cannot be changed after construction.')
  }
}

export class AuthOwnedModelAttributeError extends Error {
  override readonly name = 'AuthOwnedModelAttributeError'

  constructor(readonly attribute: string) {
    super(`Model attribute ${attribute} is owned by Doxa Auth and cannot be written directly.`)
  }
}

export class UnknownModelAttributeError extends Error {
  override readonly name = 'UnknownModelAttributeError'

  constructor(readonly attribute: string) {
    super(`Model attribute ${attribute} is not declared.`)
  }
}

export class ReadOnlyModelError extends Error {
  override readonly name = 'ReadOnlyModelError'

  constructor(readonly model: string) {
    super(`${model} is read-only and cannot be persisted.`)
  }
}

const MODEL_INTERNALS = Symbol('doxa.model.internals')

interface PendingJournalFact {
  readonly type: string
  readonly payload: JsonValue
}

interface PendingOutboxMessage {
  readonly type: string
  readonly payload: JsonValue
  readonly availableAt?: Instant
}

interface ModelInternals<Attributes extends ModelAttributes> {
  readonly attributes: Attributes
  readonly original: Partial<Attributes>
  readonly lastChanges: ModelChanges<Attributes>
  readonly pendingJournal: readonly PendingJournalFact[]
  readonly pendingOutbox: readonly PendingOutboxMessage[]
  readonly exists: boolean
  readonly version: number | undefined
  readonly recentlyCreated: boolean
  readonly session: ModelSession | undefined
  readonly relations: ReadonlyMap<string, Model | readonly Model[] | undefined>
  readonly declaredAttributes: ReadonlySet<string> | undefined
  changes(): ModelChanges<Attributes>
  generatedIdentity(id: string): void
  replace(attributes: Attributes, version: number, exists: boolean): void
  attached(session: ModelSession, original: Partial<Attributes>, version?: number): void
  saved(version: number, changes: ModelChanges<Attributes>, created: boolean): void
  deleted(): void
  clearPending(): void
  setRelation(name: string, value: Model | readonly Model[] | undefined): void
}

export abstract class Model<
  Attributes extends ModelAttributes = ModelAttributes,
  Relations extends ModelRelations = ModelRelations,
> {
  static readonly id: string = ''
  static readonly table?: string
  static readonly primaryKey?: string
  static readonly versionColumn?: string
  static readonly columns?: Readonly<Record<string, string>>
  static readonly timestamps?: boolean | { readonly createdAt: string; readonly updatedAt: string }
  static readonly managed?: boolean
  static readonly readOnly?: boolean
  static readonly relationships?: Readonly<Record<string, ModelRelationship>>

  #attributes: ModelAttributeState<Attributes>
  #original: Partial<Attributes> = {}
  #lastChanges: ModelChanges<Attributes> = {}
  #pendingJournal: PendingJournalFact[] = []
  #pendingOutbox: PendingOutboxMessage[] = []
  #exists = false
  #version: number | undefined
  #recentlyCreated = false
  #session: ModelSession | undefined
  readonly #constructedAttributes: ReadonlySet<string>
  readonly #relations = new Map<string, Model | readonly Model[] | undefined>()
  declare protected readonly __doxaRelations: Relations

  constructor(attributes: Attributes) {
    this.#attributes = modelAttributeState(attributes)
    this.#constructedAttributes = new Set(Object.keys(attributes))
  }

  protected get attributes(): ModelAttributeState<Attributes> {
    return this.#attributes
  }

  static find<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    this: ModelConstructor<Instance, Attributes>,
    id: string,
  ): Promise<Instance | undefined> {
    return requireCurrentSession().find(this, id)
  }

  static findOrFail<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    this: ModelConstructor<Instance, Attributes>,
    id: string,
  ): Promise<Instance> {
    return requireCurrentSession().findOrFail(this, id)
  }

  static make<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    this: ModelConstructor<Instance, Attributes>,
    attributes: NoInfer<Attributes>,
  ): Instance {
    return requireCurrentSession().make(this, attributes)
  }

  static async create<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    this: ModelConstructor<Instance, Attributes>,
    attributes: NoInfer<Attributes>,
  ): Promise<Instance> {
    if (this.readOnly) throw new ReadOnlyModelError(this.name)
    const model = requireCurrentSession().make(this, attributes)
    await model.save()
    return model
  }

  static query<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>> {
    return new ModelQuery(this)
  }

  static where<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
    input: ModelQueryInput<Attributes>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>>
  static where<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
    Key extends Extract<keyof Attributes, string>,
  >(
    this: ModelConstructor<Instance, Attributes>,
    attribute: Key,
    value: ModelQueryAttributeValue<Attributes[Key]>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>>
  static where<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
    Key extends Extract<keyof Attributes, string>,
  >(
    this: ModelConstructor<Instance, Attributes>,
    attribute: Key,
    operator: NonNullable<Attributes[Key]> extends string
      ? import('./model-query.js').ModelQueryOperator
      : NonNullable<Attributes[Key]> extends number | Graphite | Instant | LocalDate
        ? '=' | '!=' | '<' | '<=' | '>' | '>='
        : '=' | '!=',
    value: ModelQueryAttributeValue<Attributes[Key]>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>>
  static where<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
    input: ModelQueryInput<Attributes> | Extract<keyof Attributes, string>,
    operatorOrValue?:
      | import('./model-query.js').ModelQueryOperator
      | ModelQueryAttributeValue<Attributes[Extract<keyof Attributes, string>]>,
    value?: ModelQueryAttributeValue<Attributes[Extract<keyof Attributes, string>]>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>> {
    const query = new ModelQuery<Instance, Attributes, RelationsOf<Instance>>(this)
    if (typeof input === 'object') return query.where(input)
    return value === undefined
      ? query.where(input, operatorOrValue as never)
      : query.where(input, operatorOrValue as never, value as never)
  }

  static with<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
    relations:
      | ModelRelationPath<RelationsOf<Instance>>
      | readonly ModelRelationPath<RelationsOf<Instance>>[],
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>>
  static with<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
    relations: ModelEagerLoadConstraints<RelationsOf<Instance>>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>>
  static with<Attributes extends ModelAttributes, Instance extends Model<Attributes, any>>(
    this: ModelConstructor<Instance, Attributes>,
    relations:
      | ModelRelationPath<RelationsOf<Instance>>
      | readonly ModelRelationPath<RelationsOf<Instance>>[]
      | ModelEagerLoadConstraints<RelationsOf<Instance>>,
  ): ModelQuery<Instance, Attributes, RelationsOf<Instance>> {
    const query = new ModelQuery<Instance, Attributes, RelationsOf<Instance>>(this)
    return typeof relations === 'string' || Array.isArray(relations)
      ? query.with(
          relations as
            | ModelRelationPath<RelationsOf<Instance>>
            | readonly ModelRelationPath<RelationsOf<Instance>>[],
        )
      : query.with(relations as ModelEagerLoadConstraints<RelationsOf<Instance>>)
  }

  get id(): string {
    return this.attributes.id
  }

  get exists(): boolean {
    return this.#exists
  }

  get version(): number | undefined {
    return this.#version
  }

  get wasRecentlyCreated(): boolean {
    return this.#recentlyCreated
  }

  getAttribute<Key extends keyof Attributes>(key: Key): Attributes[Key] {
    this.assertDeclaredAttribute(String(key))
    return clone((this.attributes as Record<string, unknown>)[String(key)]) as Attributes[Key]
  }

  setAttribute<Key extends MutableModelAttributeKey<Attributes>>(
    key: Key,
    value: ModelAttributeValue<Attributes, Key>,
  ): this {
    this.assertDeclaredAttribute(String(key))
    if (key === ('id' as Key)) throw new ModelIdentityMutationError()
    const attributes = this.attributes as Record<string, unknown>
    if (value === undefined) delete attributes[key]
    else attributes[key] = clone(value)
    return this
  }

  fill(attributes: ModelAttributePatch<Attributes>): this {
    if (Object.hasOwn(attributes, 'id')) throw new ModelIdentityMutationError()
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(key as MutableModelAttributeKey<Attributes>, value as never)
    }
    return this
  }

  isDirty(key?: keyof Attributes): boolean {
    if (key) return !sameValue((this.attributes as Attributes)[key], this.#original[key])
    return Object.keys(this.currentChanges()).length > 0
  }

  isClean(key?: keyof Attributes): boolean {
    return !this.isDirty(key)
  }

  wasChanged(key?: keyof Attributes): boolean {
    return key ? Object.hasOwn(this.#lastChanges, key) : Object.keys(this.#lastChanges).length > 0
  }

  getChanges(): ModelChanges<Attributes> {
    return clone(this.#lastChanges)
  }

  getOriginal(): Partial<Attributes>
  getOriginal<Key extends keyof Attributes>(key: Key): Attributes[Key] | undefined
  getOriginal<Key extends keyof Attributes>(
    key?: Key,
  ): Partial<Attributes> | Attributes[Key] | undefined {
    return key ? clone(this.#original[key]) : clone(this.#original)
  }

  save(): Promise<boolean> {
    return this.attachedSession().save(this)
  }

  delete(): Promise<void> {
    return this.attachedSession().delete(this)
  }

  refresh(): Promise<this> {
    return this.attachedSession().refresh<Attributes, this>(this)
  }

  protected related<Key extends keyof Relations>(key: Key): Relations[Key] {
    if (!this.#relations.has(String(key))) {
      throw new ModelQueryError(
        `${this.constructor.name}.${String(key)} is not loaded; include it with with('${String(key)}').`,
      )
    }
    return this.#relations.get(String(key)) as Relations[Key]
  }

  protected journal<Payload extends DoxaValue>(type: string, payload: Payload): void {
    this.#pendingJournal.push({ type, payload: encodeDateTimeValues(payload) as JsonValue })
  }

  protected outbox<Payload extends DoxaValue>(
    type: string,
    payload: Payload,
    availableAt?: Instant,
  ): void {
    this.#pendingOutbox.push({
      type,
      payload: encodeDateTimeValues(payload) as JsonValue,
      ...(availableAt ? { availableAt } : {}),
    })
  }

  [MODEL_INTERNALS](): ModelInternals<Attributes> {
    return {
      attributes: this.attributes as Attributes,
      original: this.#original,
      lastChanges: this.#lastChanges,
      pendingJournal: this.#pendingJournal,
      pendingOutbox: this.#pendingOutbox,
      exists: this.#exists,
      version: this.#version,
      recentlyCreated: this.#recentlyCreated,
      session: this.#session,
      relations: this.#relations,
      declaredAttributes: this.#session?.declaredAttributesFor(this),
      changes: () => this.currentChanges(),
      generatedIdentity: (id) => {
        this.#attributes = modelAttributeState({ ...this.attributes, id } as Attributes)
      },
      replace: (attributes, version, exists) => {
        this.#attributes = modelAttributeState(attributes)
        this.#original = clone(attributes)
        this.#lastChanges = {}
        this.#version = version
        this.#exists = exists
        this.#recentlyCreated = false
        this.#pendingJournal = []
        this.#pendingOutbox = []
      },
      attached: (session, original, version) => {
        this.#session = session
        this.#original = clone(original)
        this.#version = version
        this.#exists = version !== undefined
      },
      saved: (version, changes, created) => {
        this.#version = version
        this.#exists = true
        this.#recentlyCreated = created
        this.#lastChanges = clone(changes)
        this.#original = clone(this.attributes as Attributes)
      },
      deleted: () => {
        this.#exists = false
        this.#recentlyCreated = false
      },
      clearPending: () => {
        this.#pendingJournal = []
        this.#pendingOutbox = []
      },
      setRelation: (name, value) => {
        this.#relations.set(name, value)
      },
    }
  }

  private currentChanges(): ModelChanges<Attributes> {
    const changes: ModelChanges<Attributes> = {}
    const keys = new Set([...Object.keys(this.#original), ...Object.keys(this.attributes)]) as Set<
      keyof Attributes
    >
    const attributes = this.attributes as Attributes
    for (const key of keys) {
      if (!sameValue(attributes[key], this.#original[key])) {
        changes[key] = clone(attributes[key])
      }
    }
    return changes
  }

  private assertDeclaredAttribute(attribute: string): void {
    const declared = this.#session?.declaredAttributesFor(this) ?? this.#constructedAttributes
    if (!declared.has(attribute)) throw new UnknownModelAttributeError(attribute)
  }

  private attachedSession(): ModelSession {
    const current = currentModelSession<ModelSession>()
    if (!this.#session)
      throw new DetachedModelError('Model is not attached to a Doxa ModelSession.')
    if (!current || current !== this.#session || !current.active) {
      throw new StaleModelError('Model belongs to an execution that is no longer active.')
    }
    return current
  }
}

export class ModelSession {
  #active = true
  readonly #hydrations = new Map<string, Promise<Model>>()
  readonly #identityMap = new Map<string, Model>()

  constructor(
    private readonly reader: ModelReader,
    private readonly models: ReadonlyMap<
      Function,
      {
        readonly entityType: string
        readonly storage: ModelStorage
        readonly attributes?: ReadonlySet<string>
        readonly optionalAttributes?: ReadonlySet<string>
        readonly attributeNormalizers?: ReadonlyMap<string, (value: unknown) => unknown>
        readonly authOwnedAttributes?: ReadonlySet<string>
        readonly clearAttributeOnChange?: ReadonlyMap<string, string>
      }
    >,
    private readonly observers?: ModelObserverDispatcher,
    private readonly writable = true,
    private readonly queryDiagnostics?: (diagnostic: ModelQueryDiagnostic) => void | Promise<void>,
    private readonly operations?: ModelOperationObserver,
  ) {
    registerModelSessionState(this, () =>
      Object.freeze({ active: this.#active, readOnly: !this.writable }),
    )
  }

  get active(): boolean {
    return this.#active
  }

  declaredAttributesFor(model: Model): ReadonlySet<string> | undefined {
    return this.definitionFor(model.constructor as Function).attributes
  }

  async find<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    Constructor: ModelConstructor<Instance, Attributes>,
    id: string,
  ): Promise<Instance | undefined> {
    this.assertActive()
    const definition = this.definitionFor(Constructor)
    const type = definition.entityType
    const identity = `${type}/${id}`
    const existing = this.#identityMap.get(identity)
    if (existing) return existing as Instance
    const persisted = await this.observeOperation(definition, 'find', () =>
      this.reader.findEntity(type, id, definition.storage),
    )
    if (!persisted) return undefined
    return await this.hydrate(Constructor, type, persisted)
  }

  async findOrFail<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    Constructor: ModelConstructor<Instance, Attributes>,
    id: string,
  ): Promise<Instance> {
    const model = await this.find(Constructor, id)
    if (!model) throw new ModelNotFoundError(Constructor.name, id)
    return model
  }

  make<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    Constructor: ModelConstructor<Instance, Attributes>,
    attributes: Attributes,
  ): Instance {
    this.assertActive()
    const definition = this.definitionFor(Constructor)
    this.assertWritable()
    const validated = this.validatedAttributes<Attributes>(
      definition,
      attributes as unknown as JsonValue,
    )
    const identity = `${definition.entityType}/${validated.id}`
    if (this.#identityMap.has(identity)) {
      throw new Error(`${Constructor.name} ${validated.id} is already attached to this execution.`)
    }
    const model = new Constructor(validated)
    model[MODEL_INTERNALS]().attached(this, {})
    this.#identityMap.set(identity, model)
    return model
  }

  async save<Attributes extends ModelAttributes>(model: Model<Attributes>): Promise<boolean> {
    this.assertAttached(model)
    const internals = model[MODEL_INTERNALS]()
    const definition = this.definitionFor(model.constructor as Function)
    if (definition.storage.kind === 'table' && definition.storage.readOnly) {
      throw new ReadOnlyModelError(model.constructor.name)
    }
    this.assertWritable()
    this.validatedAttributes<Attributes>(definition, internals.attributes as unknown as JsonValue)
    let changes = model.isDirty() ? internals.changes() : {}
    const hasDurableWork = internals.pendingJournal.length > 0 || internals.pendingOutbox.length > 0
    if (Object.keys(changes).length === 0 && !hasDurableWork) return false
    const created = !internals.exists
    await this.observers?.dispatch('saving', model)
    await this.observers?.dispatch(created ? 'creating' : 'updating', model)
    changes = model.isDirty() ? internals.changes() : {}
    for (const attribute of definition.authOwnedAttributes ?? []) {
      if (
        Object.hasOwn(changes, attribute) &&
        (!created || (internals.attributes as Record<string, unknown>)[attribute] !== null)
      ) {
        throw new AuthOwnedModelAttributeError(attribute)
      }
    }
    const attributes = internals.attributes as Record<string, unknown>
    for (const [attribute, normalize] of definition.attributeNormalizers ?? []) {
      if (!Object.hasOwn(changes, attribute)) continue
      const normalized = normalize(attributes[attribute])
      if (!Object.is(normalized, attributes[attribute])) attributes[attribute] = normalized
    }
    for (const [changed, cleared] of definition.clearAttributeOnChange ?? []) {
      if (Object.hasOwn(changes, changed)) attributes[cleared] = null
    }
    this.validatedAttributes<Attributes>(definition, internals.attributes as unknown as JsonValue)
    changes = model.isDirty() ? internals.changes() : {}
    const type = definition.entityType
    const removedAttributes = Object.keys(changes).filter(
      (attribute) => !Object.hasOwn(internals.attributes, attribute),
    )
    const pendingIdentity = model.id
    const patch = Object.fromEntries(
      Object.keys(changes)
        .filter((attribute) => Object.hasOwn(internals.attributes, attribute))
        .map((attribute) => [
          attribute,
          clone((internals.attributes as unknown as Record<string, JsonValue>)[attribute]!),
        ]),
    ) as Record<string, JsonValue>
    const hasStateChanges = Object.keys(changes).length > 0
    const saved =
      !created && !hasStateChanges
        ? internals.version!
        : await this.observeOperation(definition, 'save', () =>
            this.writer().saveEntity({
              type,
              id: model.id,
              ...(internals.version !== undefined ? { expectedVersion: internals.version } : {}),
              state: persistedState(definition.storage, internals.attributes),
              ...(internals.version !== undefined
                ? { patch: persistedState(definition.storage, patch) as Record<string, JsonValue> }
                : {}),
              ...(removedAttributes.length > 0 ? { removedAttributes } : {}),
              storage: definition.storage,
            }),
          )
    const version = typeof saved === 'number' ? saved : saved.version
    if (typeof saved !== 'number' && saved.id && saved.id !== pendingIdentity) {
      internals.generatedIdentity(saved.id)
      ;(changes as Record<string, unknown>).id = saved.id
      this.#identityMap.delete(`${type}/${pendingIdentity}`)
      this.#identityMap.set(`${type}/${saved.id}`, model)
    }
    for (const fact of internals.pendingJournal) {
      await this.writer().record({
        type: fact.type,
        entityType: type,
        entityId: model.id,
        payload: fact.payload,
      })
    }
    for (const message of internals.pendingOutbox) {
      await this.writer().enqueue({
        type: message.type,
        payload: message.payload,
        ...(message.availableAt ? { availableAt: message.availableAt } : {}),
      })
    }
    internals.saved(version, changes, created)
    internals.clearPending()
    await this.observers?.dispatch(created ? 'created' : 'updated', model)
    await this.observers?.dispatch('saved', model)
    this.writer().afterCommit(() => this.observers?.dispatch('committed', model))
    return true
  }

  async delete<Attributes extends ModelAttributes>(model: Model<Attributes>): Promise<void> {
    this.assertAttached(model)
    const internals = model[MODEL_INTERNALS]()
    const definition = this.definitionFor(model.constructor as Function)
    if (definition.storage.kind === 'table' && definition.storage.readOnly) {
      throw new ReadOnlyModelError(model.constructor.name)
    }
    this.assertWritable()
    if (!internals.exists || internals.version === undefined) {
      throw new DetachedModelError('Cannot delete a model that has not been persisted.')
    }
    const type = definition.entityType
    await this.observeOperation(definition, 'delete', () =>
      this.writer().deleteEntity(type, model.id, internals.version!, definition.storage),
    )
    for (const fact of internals.pendingJournal) {
      await this.writer().record({
        type: fact.type,
        entityType: type,
        entityId: model.id,
        payload: fact.payload,
      })
    }
    for (const message of internals.pendingOutbox) {
      await this.writer().enqueue({
        type: message.type,
        payload: message.payload,
        ...(message.availableAt ? { availableAt: message.availableAt } : {}),
      })
    }
    internals.deleted()
    internals.clearPending()
    this.#identityMap.delete(`${type}/${model.id}`)
  }

  async refresh<Attributes extends ModelAttributes, Instance extends Model<Attributes>>(
    model: Instance,
  ): Promise<Instance> {
    this.assertAttached(model)
    const definition = this.definitionFor(model.constructor as Function)
    const type = definition.entityType
    const persisted = await this.observeOperation(definition, 'refresh', () =>
      this.reader.findEntity(type, model.id, definition.storage),
    )
    if (!persisted) throw new ModelNotFoundError(model.constructor.name, model.id)
    model[MODEL_INTERNALS]().replace(
      this.validatedAttributes<Attributes>(
        definition,
        hydratedState(definition.storage, persisted.state),
      ),
      persisted.version,
      true,
    )
    return model
  }

  async query<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
  ): Promise<readonly Instance[]> {
    this.assertActive()
    const definition = this.definitionFor(Constructor)
    await this.diagnose(Constructor, definition, plan)
    const resolvedPlan = await this.resolveRelationshipConstraints(Constructor, plan)
    const persisted = await this.observeOperation(definition, 'query', () =>
      this.reader.queryEntities<Attributes & JsonValue>(
        definition.entityType,
        definition.storage,
        resolvedPlan,
      ),
    )
    const models: Instance[] = []
    for (const entity of persisted)
      models.push(await this.hydrate(Constructor, definition.entityType, entity))
    if (resolvedPlan.eagerLoads.length > 0) {
      await this.eagerLoad(models, Constructor, resolvedPlan.eagerLoads)
    }
    return models
  }

  async queryValues<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    attribute: keyof Attributes & string,
  ): Promise<readonly Attributes[keyof Attributes][]> {
    this.assertActive()
    const definition = this.definitionFor(Constructor)
    await this.diagnose(Constructor, definition, plan)
    const resolvedPlan = await this.resolveRelationshipConstraints(Constructor, plan)
    const persisted = await this.observeOperation(definition, 'query', () =>
      this.reader.queryEntities<Attributes & JsonValue>(definition.entityType, definition.storage, {
        ...resolvedPlan,
        eagerLoads: [],
      }),
    )
    return persisted.map(
      (entity) =>
        (hydratedState(definition.storage, entity.state) as unknown as Attributes)[attribute],
    )
  }

  async queryAggregate<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    operation: 'count' | 'min' | 'max' | 'sum' | 'average',
    attribute?: keyof Attributes & string,
  ): Promise<number | ModelQueryValue | undefined> {
    this.assertActive()
    const definition = this.definitionFor(Constructor)
    await this.diagnose(Constructor, definition, plan)
    const resolvedPlan = await this.resolveRelationshipConstraints(Constructor, plan)
    return this.observeOperation(definition, 'aggregate', () =>
      this.reader.aggregateEntities(
        definition.entityType,
        definition.storage,
        { ...resolvedPlan, eagerLoads: [] },
        operation,
        attribute,
      ),
    )
  }

  async paginate<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    page: number,
    perPage: number,
  ): Promise<ModelPage<Instance>> {
    positiveInteger(page, 'Page')
    boundedPositiveInteger(perPage, 'Per-page value', MODEL_QUERY_MAX_PAGE_SIZE)
    const offset = (page - 1) * perPage
    if (!Number.isSafeInteger(offset)) {
      throw new ModelQueryError('Pagination offset exceeds the supported integer range.')
    }
    const definition = this.definitionFor(Constructor)
    const orders = deterministicOrders(plan.orders)
    await this.diagnose(Constructor, definition, { ...plan, orders }, perPage)
    const { diagnostic: _diagnostic, ...silentPlan } = plan
    const total = Number(await this.queryAggregate(Constructor, silentPlan, 'count'))
    const items = await this.query(Constructor, {
      ...silentPlan,
      orders,
      limit: perPage,
      offset,
    })
    return Object.freeze({
      items,
      page,
      perPage,
      total,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
    })
  }

  async cursorPaginate<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    input: { readonly first: number; readonly after?: string; readonly before?: string },
  ): Promise<ModelCursorPage<Instance>> {
    boundedPositiveInteger(input.first, 'Cursor page size', MODEL_QUERY_MAX_PAGE_SIZE)
    if (input.after && input.before) {
      throw new InvalidModelCursorError(
        'Cursor pagination accepts either after or before, not both.',
      )
    }
    const definition = this.definitionFor(Constructor)
    const { diagnostic: _diagnostic, ...silentPlan } = plan
    const orders = deterministicOrders(silentPlan.orders)
    await this.diagnose(Constructor, definition, { ...plan, orders }, input.first)
    const cursor = input.after ?? input.before
    const reverse = input.before !== undefined
    const positioned = cursor
      ? addCursorConstraint(
          silentPlan,
          orders,
          decodeCursor(cursor, Constructor, orders),
          reverse ? 'before' : 'after',
        )
      : silentPlan
    const executionOrders = reverse
      ? orders.map((order) => ({
          ...order,
          direction: order.direction === 'asc' ? ('desc' as const) : ('asc' as const),
        }))
      : orders
    const { offset: _offset, ...withoutOffset } = positioned
    let items = await this.query(Constructor, {
      ...withoutOffset,
      orders: executionOrders,
      limit: input.first + 1,
    })
    const hasMore = items.length > input.first
    if (hasMore) items = items.slice(0, input.first)
    if (reverse) items = [...items].reverse()
    const first = items[0]
    const last = items.at(-1)
    return Object.freeze({
      items,
      ...(last && ((!reverse && hasMore) || input.before)
        ? { nextCursor: encodeCursor(last, orders) }
        : {}),
      ...(first && ((reverse && hasMore) || input.after)
        ? { previousCursor: encodeCursor(first, orders) }
        : {}),
    })
  }

  close(): void {
    this.#active = false
    this.#hydrations.clear()
    this.#identityMap.clear()
  }

  private definitionFor(Constructor: Function): {
    readonly entityType: string
    readonly storage: ModelStorage
    readonly attributes?: ReadonlySet<string>
    readonly optionalAttributes?: ReadonlySet<string>
    readonly attributeNormalizers?: ReadonlyMap<string, (value: unknown) => unknown>
    readonly authOwnedAttributes?: ReadonlySet<string>
    readonly clearAttributeOnChange?: ReadonlyMap<string, string>
  } {
    const definition = this.models.get(Constructor)
    if (!definition)
      throw new ModelNotRegisteredError(
        `${Constructor.name} is not declared by a selected Feature.`,
      )
    return definition
  }

  private async hydrate<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    type: string,
    persisted: PersistedEntity,
  ): Promise<Instance> {
    const identity = `${type}/${persisted.id}`
    const pending = this.#hydrations.get(identity)
    if (pending) return (await pending) as Instance
    const existing = this.#identityMap.get(identity)
    if (existing) return existing as Instance
    const hydration = (async () => {
      const definition = this.definitionFor(Constructor)
      const attributes = this.validatedAttributes<Attributes>(
        definition,
        hydratedState(definition.storage, persisted.state),
      )
      const model = new Constructor(attributes)
      model[MODEL_INTERNALS]().attached(this, attributes, persisted.version)
      await this.observers?.dispatch('retrieved', model)
      this.assertActive()
      this.#identityMap.set(identity, model)
      return model
    })()
    this.#hydrations.set(identity, hydration)
    try {
      return await hydration
    } finally {
      if (this.#hydrations.get(identity) === hydration) this.#hydrations.delete(identity)
    }
  }

  private validatedAttributes<Attributes extends ModelAttributes>(
    definition: {
      readonly entityType: string
      readonly storage: ModelStorage
      readonly attributes?: ReadonlySet<string>
      readonly optionalAttributes?: ReadonlySet<string>
    },
    state: JsonValue,
  ): Attributes {
    if (typeof state !== 'object' || state === null || Array.isArray(state)) {
      throw new PersistenceError(
        `Model ${definition.entityType} persistence state must be an object.`,
      )
    }
    const attributes = definition.attributes
    if (attributes) {
      const keys = Object.keys(state)
      const unexpected = keys.find((key) => !attributes.has(key))
      const missing = [...attributes].find(
        (key) => !Object.hasOwn(state, key) && !definition.optionalAttributes?.has(key),
      )
      if (unexpected) throw new UnknownModelAttributeError(unexpected)
      if (missing) {
        throw new PersistenceError(`Model attribute ${missing} is missing from persistence state.`)
      }
    }
    return clone(state) as unknown as Attributes
  }

  private async eagerLoad<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
  >(
    parents: readonly Instance[],
    Constructor: ModelConstructor<Instance, Attributes>,
    eagerLoads: ModelQueryPlan['eagerLoads'],
  ): Promise<void> {
    if (parents.length === 0) return
    const grouped = new Map<
      string,
      { constrain?: ModelQueryPlan['eagerLoads'][number]['constrain']; nested: string[] }
    >()
    for (const load of eagerLoads) {
      const [name, ...rest] = load.path.split('.')
      if (!name) throw new ModelQueryError('Relationship paths cannot be empty.')
      const current = grouped.get(name) ?? { nested: [] }
      if (load.constrain) current.constrain = load.constrain
      if (rest.length > 0) current.nested.push(rest.join('.'))
      grouped.set(name, current)
    }
    for (const [name, load] of grouped) {
      const relationship = Constructor.relationships?.[name]
      if (!relationship)
        throw new ModelQueryError(`${Constructor.name}.${name} is not a declared relationship.`)
      const related = relationship.related()
      let relatedQuery: ModelQuery<
        any,
        any,
        Record<string, Model | readonly Model[] | undefined>
      > = new ModelQuery(related)
      if (load.constrain) {
        const constrained = load.constrain(relatedQuery)
        if (!(constrained instanceof ModelQuery) || constrained.Constructor !== related) {
          throw new ModelQueryError(
            `${Constructor.name}.${name} eager-load constraints must return its related model query.`,
          )
        }
        relatedQuery = constrained
      }
      if (load.nested.length > 0) relatedQuery = relatedQuery.with(load.nested)
      if (relationship.kind === 'belongsTo') {
        const keys = uniqueValues(
          parents.map((parent) => attribute(parent, relationship.foreignKey)),
        )
        const relatedModels = await relatedQuery
          .whereIn(relationship.ownerKey as 'id', keys as string[])
          .get()
        const byKey = new Map(
          relatedModels.map((model) => [attribute(model, relationship.ownerKey), model]),
        )
        for (const parent of parents) {
          parent[MODEL_INTERNALS]().setRelation(
            name,
            byKey.get(attribute(parent, relationship.foreignKey)),
          )
        }
        continue
      }
      if (relationship.kind === 'hasOne' || relationship.kind === 'hasMany') {
        const keys = uniqueValues(parents.map((parent) => attribute(parent, relationship.localKey)))
        const relatedModels = await relatedQuery
          .whereIn(relationship.foreignKey as 'id', keys as string[])
          .get()
        for (const parent of parents) {
          const key = attribute(parent, relationship.localKey)
          const matches = relatedModels.filter((model) =>
            sameValue(attribute(model, relationship.foreignKey), key),
          )
          parent[MODEL_INTERNALS]().setRelation(
            name,
            relationship.kind === 'hasOne' ? matches[0] : matches,
          )
        }
        continue
      }
      const through = relationship.through()
      const parentKeys = uniqueValues(
        parents.map((parent) => attribute(parent, relationship.localKey)),
      )
      const pivots = await new ModelQuery(through)
        .whereIn(relationship.foreignKey as 'id', parentKeys as string[])
        .get()
      const relatedKeys = uniqueValues(
        pivots.map((pivot) => attribute(pivot, relationship.relatedForeignKey)),
      )
      const relatedModels = await relatedQuery
        .whereIn(relationship.relatedKey as 'id', relatedKeys as string[])
        .get()
      for (const parent of parents) {
        const parentKey = attribute(parent, relationship.localKey)
        const ids = pivots
          .filter((pivot) => sameValue(attribute(pivot, relationship.foreignKey), parentKey))
          .map((pivot) => attribute(pivot, relationship.relatedForeignKey))
        parent[MODEL_INTERNALS]().setRelation(
          name,
          relatedModels.filter((model) =>
            ids.some((id) => sameValue(attribute(model, relationship.relatedKey), id)),
          ),
        )
      }
    }
  }

  private async resolveRelationshipConstraints<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
  ): Promise<ModelQueryPlan> {
    const definition = this.definitionFor(Constructor)
    const attributes = definition.attributes
    validateModelQueryPlan(plan, attributes, definition.storage.attributeTypes)
    if (plan.relationshipConstraints.length === 0) return plan
    const constraints = [...plan.constraints]
    for (const constraint of plan.relationshipConstraints) {
      const [name, ...nested] = constraint.path.split('.')
      if (!name) throw new ModelQueryError('Relationship paths cannot be empty.')
      const relationship = Constructor.relationships?.[name]
      if (!relationship) {
        throw new ModelQueryError(`${Constructor.name}.${name} is not a declared relationship.`)
      }
      const Related = relationship.related()
      let relatedQuery: ModelQuery<
        any,
        any,
        Record<string, Model | readonly Model[] | undefined>
      > = new ModelQuery(Related)
      if (nested.length > 0) relatedQuery = relatedQuery.whereHas(nested.join('.'))
      if (constraint.constrain) {
        const constrained = constraint.constrain(relatedQuery)
        if (!(constrained instanceof ModelQuery) || constrained.Constructor !== Related) {
          throw new ModelQueryError(
            `${Constructor.name}.${name} relationship constraints must return its related model query.`,
          )
        }
        relatedQuery = constrained
      }

      let attributeName: string
      let matchingValues: readonly unknown[]
      let observedCounts: ReadonlyMap<unknown, number> | undefined
      if (relationship.kind === 'belongsTo') {
        attributeName = relationship.foreignKey
        matchingValues = await relatedQuery.pluck(relationship.ownerKey as 'id')
      } else if (relationship.kind === 'hasOne' || relationship.kind === 'hasMany') {
        attributeName = relationship.localKey
        const foreignKeys = await relatedQuery.pluck(relationship.foreignKey as 'id')
        observedCounts = countValues(foreignKeys)
        matchingValues = relationshipKeysForCount(observedCounts, constraint)
      } else {
        attributeName = relationship.localKey
        const relatedKeys = await relatedQuery.pluck(relationship.relatedKey as 'id')
        const pivots = await new ModelQuery(relationship.through())
          .whereIn(relationship.relatedForeignKey as 'id', relatedKeys as string[])
          .pluck(relationship.foreignKey as 'id')
        observedCounts = countValues(pivots)
        matchingValues = relationshipKeysForCount(observedCounts, constraint)
      }

      const zeroMatches = countComparison(0, constraint.operator, constraint.count)
      const oneMatches = countComparison(1, constraint.operator, constraint.count)
      const negate = relationship.kind === 'belongsTo' ? zeroMatches && !oneMatches : zeroMatches
      const values =
        relationship.kind === 'belongsTo'
          ? matchingValues
          : negate
            ? [...(observedCounts ?? new Map()).entries()]
                .filter(
                  ([, count]) => !countComparison(count, constraint.operator, constraint.count),
                )
                .map(([key]) => key)
            : matchingValues
      if (relationship.kind === 'belongsTo' && zeroMatches === oneMatches) {
        if (zeroMatches) continue
        constraints.push({
          boolean: 'and',
          predicate: { kind: 'membership', attribute: attributeName, values: [], negate: false },
        })
        continue
      }
      constraints.push({
        boolean: 'and',
        predicate: {
          kind: 'membership',
          attribute: attributeName,
          values: values as readonly ModelQueryValue[],
          negate,
        },
      })
    }
    const resolved = { ...plan, constraints, relationshipConstraints: [] }
    validateModelQueryPlan(resolved, attributes, definition.storage.attributeTypes)
    return resolved
  }

  private async diagnose<
    Attributes extends ModelAttributes,
    Instance extends Model<Attributes, any>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    definition: { readonly entityType: string; readonly storage: ModelStorage },
    plan: ModelQueryPlan,
    pageSize?: number,
  ): Promise<void> {
    if (!plan.diagnostic || !this.queryDiagnostics) return
    const storage =
      definition.storage.kind === 'entity-state'
        ? { kind: 'entity-state' as const }
        : {
            kind: 'table' as const,
            table: definition.storage.table,
            columns: definition.storage.columns,
          }
    await this.queryDiagnostics({
      model: Constructor.name,
      entityType: definition.entityType,
      terminal: plan.diagnostic.terminal,
      constraintCount: countConstraints(plan.constraints),
      relationshipConstraintCount: plan.relationshipConstraints.length,
      ordering: plan.orders.map((order) => `${order.attribute}:${order.direction}`),
      eagerLoads: plan.eagerLoads.map((load) => load.path),
      ...(plan.limit === undefined ? {} : { limit: plan.limit }),
      ...(plan.offset === undefined ? {} : { offset: plan.offset }),
      ...(pageSize === undefined ? {} : { pageSize }),
      storage,
    })
  }

  private async observeOperation<Output>(
    definition: { readonly entityType: string; readonly storage: ModelStorage },
    operation: ModelOperationDiagnostic['operation'],
    work: () => Promise<Output>,
  ): Promise<Output> {
    if (!this.operations) return await work()
    return await this.operations.observe(
      {
        operation,
        entityType: definition.entityType,
        storage: definition.storage.kind,
      },
      work,
    )
  }

  private assertAttached(model: Model): void {
    this.assertActive()
    if (model[MODEL_INTERNALS]().session !== this) {
      throw new DetachedModelError('Model is not attached to the current ModelSession.')
    }
  }

  private assertActive(): void {
    if (!this.#active) throw new StaleModelError('ModelSession is no longer active.')
  }

  private assertWritable(): void {
    if (!this.writable)
      throw new ReadOnlyExecutionError('Model mutation is not allowed in a read-only execution.')
  }

  private writer(): UnitOfWork {
    this.assertWritable()
    return this.reader as UnitOfWork
  }
}

function requireCurrentSession(): ModelSession {
  const session = currentModelSession<ModelSession>()
  if (!session || !session.active) {
    throw new StaleModelError('A model operation requires an active Doxa action ModelSession.')
  }
  return session
}

function clone<Value>(value: Value): Value {
  if (
    value instanceof Graphite ||
    value instanceof Instant ||
    value instanceof LocalDate ||
    value instanceof Duration
  ) {
    return value
  }
  if (Array.isArray(value)) return value.map((item) => clone(item)) as Value
  if (value instanceof Date) {
    throw new PersistenceError('JavaScript Date model values are unsupported; use a Doxa datetime.')
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)]),
    ) as Value
  }
  return value
}

function modelAttributeState<Attributes extends ModelAttributes>(
  attributes: Attributes,
): ModelAttributeState<Attributes> {
  const state = clone(attributes) as ModelAttributeState<Attributes>
  Object.defineProperty(state, 'id', {
    value: state.id,
    enumerable: true,
    writable: false,
    configurable: false,
  })
  return state
}

function attribute(model: Model, name: string): unknown {
  return (model[MODEL_INTERNALS]().attributes as unknown as Record<string, unknown>)[name]
}

function uniqueValues(values: readonly unknown[]): unknown[] {
  return values.filter(
    (value, index) =>
      value !== undefined && values.findIndex((candidate) => sameValue(candidate, value)) === index,
  )
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Graphite && right instanceof Graphite) {
    return left.epochMicroseconds === right.epochMicroseconds
  }
  if (left instanceof Instant && right instanceof Instant) {
    return left.epochMicroseconds === right.epochMicroseconds
  }
  if (left instanceof LocalDate && right instanceof LocalDate) {
    return left.toString() === right.toString()
  }
  if (left instanceof Duration && right instanceof Duration) {
    return left.toString() === right.toString()
  }
  return isDeepStrictEqual(left, right)
}

function countValues(values: readonly unknown[]): ReadonlyMap<unknown, number> {
  const counts = new Map<unknown, number>()
  for (const value of values) {
    if (value === undefined) continue
    const existing = [...counts.keys()].find((key) => sameValue(key, value))
    counts.set(existing ?? value, (existing === undefined ? 0 : (counts.get(existing) ?? 0)) + 1)
  }
  return counts
}

function relationshipKeysForCount(
  counts: ReadonlyMap<unknown, number>,
  constraint: ModelQueryPlan['relationshipConstraints'][number],
): readonly unknown[] {
  return [...counts.entries()]
    .filter(([, count]) => countComparison(count, constraint.operator, constraint.count))
    .map(([key]) => key)
}

function countComparison(
  actual: number,
  operator: ModelQueryPlan['relationshipConstraints'][number]['operator'],
  expected: number,
): boolean {
  if (operator === '=') return actual === expected
  if (operator === '!=') return actual !== expected
  if (operator === '<') return actual < expected
  if (operator === '<=') return actual <= expected
  if (operator === '>') return actual > expected
  return actual >= expected
}

function countConstraints(constraints: ModelQueryPlan['constraints']): number {
  return constraints.reduce(
    (count, constraint) =>
      count +
      1 +
      (constraint.predicate.kind === 'group'
        ? countConstraints(constraint.predicate.predicates)
        : 0),
    0,
  )
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new ModelQueryError(`${name} must be a positive integer.`)
}

function boundedPositiveInteger(value: number, name: string, maximum: number): void {
  positiveInteger(value, name)
  if (value > maximum) throw new ModelQueryError(`${name} must be at most ${maximum}.`)
}

function deterministicOrders(orders: ModelQueryPlan['orders']): ModelQueryPlan['orders'] {
  return orders.some((order) => order.attribute === 'id')
    ? orders
    : [...orders, { attribute: 'id', direction: 'asc' }]
}

function persistedState(storage: ModelStorage, value: unknown): JsonValue {
  return (storage.kind === 'entity-state' ? encodeDateTimeValues(value) : clone(value)) as JsonValue
}

function hydratedState(storage: ModelStorage, value: JsonValue): JsonValue {
  return (
    storage.kind === 'entity-state' ? decodeDateTimeValues(value as EncodedDateTimeValue) : value
  ) as JsonValue
}

function encodeCursor(model: Model, orders: ModelQueryPlan['orders']): string {
  const Constructor = model.constructor as typeof Model
  return Buffer.from(
    JSON.stringify({
      version: 2,
      model: Constructor.id,
      ordering: orders.map((order) => [order.attribute, order.direction]),
      values: encodeDateTimeValues(orders.map((order) => attribute(model, order.attribute))),
    }),
  ).toString('base64url')
}

function decodeCursor(
  cursor: string,
  Constructor: { readonly id: string },
  orders: ModelQueryPlan['orders'],
): readonly ModelQueryValue[] {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      version?: unknown
      model?: unknown
      ordering?: unknown
      values?: unknown
    }
    const expectedOrdering = orders.map((order) => [order.attribute, order.direction])
    if (
      decoded.version !== 2 ||
      decoded.model !== Constructor.id ||
      !isDeepStrictEqual(decoded.ordering, expectedOrdering) ||
      !Array.isArray(decoded.values)
    ) {
      throw new Error('invalid')
    }
    const values = decodeDateTimeValues(decoded.values as EncodedDateTimeValue)
    if (!Array.isArray(values)) throw new Error('invalid')
    return values.map((value) => queryCursorValue(value))
  } catch {
    throw new InvalidModelCursorError('Model cursor is invalid or unsupported.')
  }
}

function queryCursorValue(value: unknown): ModelQueryValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Graphite ||
    value instanceof Instant ||
    value instanceof LocalDate ||
    value instanceof Duration
  ) {
    return value
  }
  throw new Error('invalid')
}

function addCursorConstraint(
  plan: ModelQueryPlan,
  orders: ModelQueryPlan['orders'],
  values: readonly ModelQueryValue[],
  position: 'after' | 'before',
): ModelQueryPlan {
  if (values.length !== orders.length)
    throw new InvalidModelCursorError('Model cursor does not match query ordering.')
  const alternatives = orders.map((order, index) => {
    const equals = orders.slice(0, index).map((previous, previousIndex) => ({
      boolean: 'and' as const,
      predicate: {
        kind: 'comparison' as const,
        attribute: previous.attribute,
        operator: '=' as const,
        value: values[previousIndex]!,
      },
    }))
    const forward = order.direction === 'asc' ? '>' : '<'
    const operator: import('./model-query.js').ModelQueryOperator =
      position === 'after' ? forward : forward === '>' ? '<' : '>'
    return {
      boolean: index === 0 ? ('and' as const) : ('or' as const),
      predicate: {
        kind: 'group' as const,
        predicates: [
          ...equals,
          {
            boolean: 'and' as const,
            predicate: {
              kind: 'comparison' as const,
              attribute: order.attribute,
              operator,
              value: values[index]!,
            },
          },
        ],
      },
    }
  })
  return {
    ...plan,
    constraints: [
      ...plan.constraints,
      { boolean: 'and', predicate: { kind: 'group', predicates: alternatives } },
    ],
  }
}
