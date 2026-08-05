import { currentModelSession } from './model-session-context.js'
import { Duration, Graphite, Instant, LocalDate } from './graphite.js'
import {
  ModelNotFoundError,
  StaleModelError,
  type Model,
  type ModelAttributes,
  type ModelConstructor,
  type ModelRelations,
} from './model.js'

export type ModelQueryOperator = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like' | 'ilike'
export type ModelQueryDirection = 'asc' | 'desc'
export type ModelQueryValue =
  string | number | boolean | Graphite | Instant | LocalDate | Duration | null
export const MODEL_QUERY_MAX_PAGE_SIZE = 1_000

export type ModelQueryPredicate =
  | {
      readonly kind: 'comparison'
      readonly attribute: string
      readonly operator: ModelQueryOperator
      readonly value: ModelQueryValue
    }
  | {
      readonly kind: 'membership'
      readonly attribute: string
      readonly values: readonly ModelQueryValue[]
      readonly negate: boolean
    }
  | { readonly kind: 'null'; readonly attribute: string; readonly negate: boolean }
  | {
      readonly kind: 'between'
      readonly attribute: string
      readonly values: readonly [ModelQueryValue, ModelQueryValue]
      readonly negate: boolean
    }
  | {
      readonly kind: 'column'
      readonly attribute: string
      readonly operator: ModelQueryOperator
      readonly comparedAttribute: string
    }
  | {
      readonly kind: 'group'
      readonly predicates: readonly ModelQueryConstraint[]
    }

export interface ModelQueryConstraint {
  readonly boolean: 'and' | 'or'
  readonly predicate: ModelQueryPredicate
}

export interface ModelQueryOrder {
  readonly attribute: string
  readonly direction: ModelQueryDirection
}

export interface ModelEagerLoad {
  readonly path: string
  readonly constrain?: (query: ModelQuery<any, any, any>) => ModelQuery<any, any, any>
}

export interface ModelRelationshipConstraint {
  readonly path: string
  readonly operator: '=' | '!=' | '<' | '<=' | '>' | '>='
  readonly count: number
  readonly constrain?: (query: ModelQuery<any, any, any>) => ModelQuery<any, any, any>
}

export interface ModelQueryPlan {
  readonly constraints: readonly ModelQueryConstraint[]
  readonly orders: readonly ModelQueryOrder[]
  readonly eagerLoads: readonly ModelEagerLoad[]
  readonly relationshipConstraints: readonly ModelRelationshipConstraint[]
  readonly limit?: number
  readonly offset?: number
  readonly diagnostic?: {
    readonly terminal:
      | 'get'
      | 'find'
      | 'findOrFail'
      | 'first'
      | 'firstOrFail'
      | 'exists'
      | 'count'
      | 'value'
      | 'pluck'
      | 'min'
      | 'max'
      | 'sum'
      | 'average'
      | 'paginate'
      | 'cursorPaginate'
  }
}

export interface ModelPage<Instance extends Model> {
  readonly items: readonly Instance[]
  readonly page: number
  readonly perPage: number
  readonly total: number
  readonly lastPage: number
}

export interface ModelCursorPage<Instance extends Model> {
  readonly items: readonly Instance[]
  readonly nextCursor?: string
  readonly previousCursor?: string
}

export class ModelQueryError extends Error {
  override readonly name: string = 'ModelQueryError'
}

export class InvalidModelCursorError extends ModelQueryError {
  override readonly name = 'InvalidModelCursorError'
}

export interface ModelQuerySession {
  readonly active: boolean
  query<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
  ): Promise<readonly Instance[]>
  queryValues<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    attribute: keyof Attributes & string,
  ): Promise<readonly Attributes[keyof Attributes][]>
  queryAggregate<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    operation: 'count' | 'min' | 'max' | 'sum' | 'average',
    attribute?: keyof Attributes & string,
  ): Promise<number | ModelQueryValue | undefined>
  paginate<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    page: number,
    perPage: number,
  ): Promise<ModelPage<Instance>>
  cursorPaginate<
    Attributes extends ModelAttributes,
    Relations extends ModelRelations,
    Instance extends Model<Attributes, Relations>,
  >(
    Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan,
    input: { readonly first: number; readonly after?: string; readonly before?: string },
  ): Promise<ModelCursorPage<Instance>>
}

type AttributeName<Attributes> = Extract<keyof Attributes, string>
type AttributeNameMatching<Attributes, Value> = {
  [Key in AttributeName<Attributes>]: NonNullable<Attributes[Key]> extends Value ? Key : never
}[AttributeName<Attributes>]
type ScalarAttributeName<Attributes> = AttributeNameMatching<
  Attributes,
  string | number | boolean | Graphite | Instant | LocalDate | Duration
>
type OrderedAttributeName<Attributes> = AttributeNameMatching<
  Attributes,
  string | number | Graphite | Instant | LocalDate
>
type NumericAttributeName<Attributes> = AttributeNameMatching<Attributes, number>
type AttributeValue<Value> =
  Extract<Value, ModelQueryValue> | (undefined extends Value ? null : never)
type EqualityOperator = '=' | '!='
type OrderedOperator = EqualityOperator | '<' | '<=' | '>' | '>='
type OperatorFor<Value> =
  NonNullable<Value> extends string
    ? ModelQueryOperator
    : NonNullable<Value> extends number | Graphite | Instant | LocalDate
      ? OrderedOperator
      : EqualityOperator
type RelationName<Relations> = Extract<keyof Relations, string>
type RelatedModel<Value> =
  NonNullable<Value> extends readonly (infer Item)[] ? Item : NonNullable<Value>
type RelationsOfModel<Value> =
  RelatedModel<Value> extends Model<any, infer Relations> ? Relations : never
type RelationPathAtDepth<Relations, Depth extends readonly unknown[]> = Depth['length'] extends 5
  ? RelationName<Relations>
  : {
      [Key in RelationName<Relations>]:
        | Key
        | (RelationName<RelationsOfModel<Relations[Key]>> extends never
            ? never
            : `${Key}.${RelationPathAtDepth<RelationsOfModel<Relations[Key]>, [...Depth, unknown]>}`)
    }[RelationName<Relations>]
export type ModelRelationPath<Relations extends ModelRelations> = RelationPathAtDepth<Relations, []>
type RelatedValueAtPath<Relations, Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof Relations
    ? RelatedValueAtPath<RelationsOfModel<Relations[Head]>, Tail>
    : never
  : Path extends keyof Relations
    ? Relations[Path]
    : never
type RelatedQuery<Value> =
  RelatedModel<Value> extends Model<infer Attributes, infer Relations>
    ? ModelQuery<RelatedModel<Value>, Attributes, Relations>
    : never
export type ModelEagerLoadConstraints<Relations extends ModelRelations> = Readonly<{
  [Key in keyof Relations]?: (query: RelatedQuery<Relations[Key]>) => RelatedQuery<Relations[Key]>
}>
type QueryInput<Attributes extends ModelAttributes> = Partial<{
  [Key in keyof Attributes]: AttributeValue<Attributes[Key]>
}>

const EMPTY_PLAN: ModelQueryPlan = Object.freeze({
  constraints: Object.freeze([]),
  orders: Object.freeze([]),
  eagerLoads: Object.freeze([]),
  relationshipConstraints: Object.freeze([]),
})

export class ModelQuery<
  Instance extends Model<Attributes, Relations>,
  Attributes extends ModelAttributes,
  Relations extends ModelRelations = ModelRelations,
> implements AsyncIterable<Instance> {
  readonly plan: ModelQueryPlan

  constructor(
    readonly Constructor: ModelConstructor<Instance, Attributes>,
    plan: ModelQueryPlan = EMPTY_PLAN,
    private readonly boundSession = currentModelSession<ModelQuerySession>(),
  ) {
    this.plan = freezePlan(plan)
  }

  where(input: QueryInput<Attributes>): ModelQuery<Instance, Attributes, Relations>
  where<Key extends AttributeName<Attributes>>(
    attribute: Key,
    value: AttributeValue<Attributes[Key]>,
  ): ModelQuery<Instance, Attributes, Relations>
  where<Key extends AttributeName<Attributes>>(
    attribute: Key,
    operator: OperatorFor<Attributes[Key]>,
    value: AttributeValue<Attributes[Key]>,
  ): ModelQuery<Instance, Attributes, Relations>
  where(
    group: (
      query: ModelQuery<Instance, Attributes, Relations>,
    ) => ModelQuery<Instance, Attributes, Relations>,
  ): ModelQuery<Instance, Attributes, Relations>
  where(
    input:
      | QueryInput<Attributes>
      | AttributeName<Attributes>
      | ((
          query: ModelQuery<Instance, Attributes, Relations>,
        ) => ModelQuery<Instance, Attributes, Relations>),
    operatorOrValue?: unknown,
    possibleValue?: unknown,
  ): ModelQuery<Instance, Attributes, Relations> {
    return this.addWhere('and', input, operatorOrValue, possibleValue)
  }

  orWhere(input: QueryInput<Attributes>): ModelQuery<Instance, Attributes, Relations>
  orWhere<Key extends AttributeName<Attributes>>(
    attribute: Key,
    value: AttributeValue<Attributes[Key]>,
  ): ModelQuery<Instance, Attributes, Relations>
  orWhere<Key extends AttributeName<Attributes>>(
    attribute: Key,
    operator: OperatorFor<Attributes[Key]>,
    value: AttributeValue<Attributes[Key]>,
  ): ModelQuery<Instance, Attributes, Relations>
  orWhere(
    group: (
      query: ModelQuery<Instance, Attributes, Relations>,
    ) => ModelQuery<Instance, Attributes, Relations>,
  ): ModelQuery<Instance, Attributes, Relations>
  orWhere(
    input:
      | QueryInput<Attributes>
      | AttributeName<Attributes>
      | ((
          query: ModelQuery<Instance, Attributes, Relations>,
        ) => ModelQuery<Instance, Attributes, Relations>),
    operatorOrValue?: unknown,
    possibleValue?: unknown,
  ): ModelQuery<Instance, Attributes, Relations> {
    return this.addWhere('or', input, operatorOrValue, possibleValue)
  }

  whereIn<Key extends AttributeName<Attributes>>(
    attribute: Key,
    values: readonly AttributeValue<Attributes[Key]>[],
  ): ModelQuery<Instance, Attributes, Relations> {
    return this.constraint('and', {
      kind: 'membership',
      attribute,
      values: values.map(queryValue),
      negate: false,
    })
  }

  whereNotIn<Key extends AttributeName<Attributes>>(
    attribute: Key,
    values: readonly AttributeValue<Attributes[Key]>[],
  ): ModelQuery<Instance, Attributes, Relations> {
    return this.constraint('and', {
      kind: 'membership',
      attribute,
      values: values.map(queryValue),
      negate: true,
    })
  }

  whereNull(attribute: AttributeName<Attributes>): ModelQuery<Instance, Attributes, Relations> {
    return this.constraint('and', { kind: 'null', attribute, negate: false })
  }

  whereNotNull(attribute: AttributeName<Attributes>): ModelQuery<Instance, Attributes, Relations> {
    return this.constraint('and', { kind: 'null', attribute, negate: true })
  }

  whereBetween<Key extends OrderedAttributeName<Attributes>>(
    attribute: Key,
    values: readonly [AttributeValue<Attributes[Key]>, AttributeValue<Attributes[Key]>],
  ): ModelQuery<Instance, Attributes, Relations> {
    return this.constraint('and', {
      kind: 'between',
      attribute,
      values: [queryValue(values[0]), queryValue(values[1])],
      negate: false,
    })
  }

  whereNotBetween<Key extends OrderedAttributeName<Attributes>>(
    attribute: Key,
    values: readonly [AttributeValue<Attributes[Key]>, AttributeValue<Attributes[Key]>],
  ): ModelQuery<Instance, Attributes, Relations> {
    return this.constraint('and', {
      kind: 'between',
      attribute,
      values: [queryValue(values[0]), queryValue(values[1])],
      negate: true,
    })
  }

  whereColumn<Key extends ScalarAttributeName<Attributes>>(
    attribute: Key,
    operator: OperatorFor<Attributes[Key]>,
    comparedAttribute: ScalarAttributeName<Attributes>,
  ): ModelQuery<Instance, Attributes, Relations> {
    validOperator(operator)
    return this.constraint('and', { kind: 'column', attribute, operator, comparedAttribute })
  }

  orderBy(
    attribute: OrderedAttributeName<Attributes>,
    direction: ModelQueryDirection = 'asc',
  ): ModelQuery<Instance, Attributes, Relations> {
    if (direction !== 'asc' && direction !== 'desc') {
      throw new ModelQueryError(`Unsupported model query direction ${String(direction)}.`)
    }
    return this.copy({ orders: [...this.plan.orders, { attribute, direction }] })
  }

  orderByDesc(
    attribute: OrderedAttributeName<Attributes>,
  ): ModelQuery<Instance, Attributes, Relations> {
    return this.orderBy(attribute, 'desc')
  }

  latest(
    attribute: OrderedAttributeName<Attributes> = 'createdAt' as OrderedAttributeName<Attributes>,
  ) {
    return this.orderBy(attribute, 'desc')
  }

  oldest(
    attribute: OrderedAttributeName<Attributes> = 'createdAt' as OrderedAttributeName<Attributes>,
  ) {
    return this.orderBy(attribute, 'asc')
  }

  limit(limit: number): ModelQuery<Instance, Attributes, Relations> {
    positiveInteger(limit, 'Query limit')
    return this.copy({ limit })
  }

  offset(offset: number): ModelQuery<Instance, Attributes, Relations> {
    nonNegativeInteger(offset, 'Query offset')
    return this.copy({ offset })
  }

  with(
    relations: ModelRelationPath<Relations> | readonly ModelRelationPath<Relations>[],
  ): ModelQuery<Instance, Attributes, Relations>
  with(relations: ModelEagerLoadConstraints<Relations>): ModelQuery<Instance, Attributes, Relations>
  with(
    relations:
      | ModelRelationPath<Relations>
      | readonly ModelRelationPath<Relations>[]
      | ModelEagerLoadConstraints<Relations>,
  ): ModelQuery<Instance, Attributes, Relations> {
    const additions: ModelEagerLoad[] =
      typeof relations === 'string'
        ? [{ path: relations }]
        : Array.isArray(relations)
          ? relations.map((path) => ({ path: String(path) }))
          : Object.entries(relations).map(([path, constrain]) => ({
              path,
              constrain: constrain as ModelEagerLoad['constrain'],
            }))
    return this.copy({ eagerLoads: [...this.plan.eagerLoads, ...additions] })
  }

  has(
    relationship: RelationName<Relations>,
    operator: ModelRelationshipConstraint['operator'] = '>=',
    count = 1,
  ): ModelQuery<Instance, Attributes, Relations> {
    nonNegativeInteger(count, 'Relationship count')
    validRelationshipOperator(operator)
    return this.copy({
      relationshipConstraints: [
        ...this.plan.relationshipConstraints,
        { path: String(relationship), operator, count },
      ],
    })
  }

  whereHas<Path extends ModelRelationPath<Relations>>(
    relationship: Path,
    constrain?: (
      query: RelatedQuery<RelatedValueAtPath<Relations, Path>>,
    ) => RelatedQuery<RelatedValueAtPath<Relations, Path>>,
    operator: ModelRelationshipConstraint['operator'] = '>=',
    count = 1,
  ): ModelQuery<Instance, Attributes, Relations> {
    nonNegativeInteger(count, 'Relationship count')
    validRelationshipOperator(operator)
    return this.copy({
      relationshipConstraints: [
        ...this.plan.relationshipConstraints,
        {
          path: String(relationship),
          operator,
          count,
          ...(constrain
            ? {
                constrain: constrain as unknown as NonNullable<
                  ModelRelationshipConstraint['constrain']
                >,
              }
            : {}),
        },
      ],
    })
  }

  whereBelongsTo(
    related: Model,
    relationship?: RelationName<Relations>,
  ): ModelQuery<Instance, Attributes, Relations> {
    const candidates = Object.entries(this.Constructor.relationships ?? {}).filter(
      ([name, definition]) =>
        definition.kind === 'belongsTo' &&
        (!relationship || name === relationship) &&
        related instanceof definition.related(),
    )
    if (candidates.length !== 1) {
      throw new ModelQueryError(
        relationship
          ? `${this.Constructor.name}.${String(relationship)} is not a unique belongsTo relationship for ${related.constructor.name}.`
          : `${this.Constructor.name} must have exactly one belongsTo relationship for ${related.constructor.name}; pass its name when ambiguous.`,
      )
    }
    const [, definition] = candidates[0]!
    if (definition.kind !== 'belongsTo')
      throw new ModelQueryError('Invalid belongsTo relationship.')
    return this.where(
      definition.foreignKey as AttributeName<Attributes>,
      (related as unknown as { getAttribute(key: string): unknown }).getAttribute(
        definition.ownerKey,
      ) as AttributeValue<Attributes[AttributeName<Attributes>]>,
    )
  }

  get(): Promise<readonly Instance[]> {
    return this.session().query(this.Constructor, diagnosed(this.plan, 'get'))
  }

  async find(id: string): Promise<Instance | undefined> {
    const query = this.where(
      'id' as AttributeName<Attributes>,
      id as AttributeValue<Attributes[AttributeName<Attributes>]>,
    )
    return (
      await query.session().query(this.Constructor, {
        ...diagnosed(query.plan, 'find'),
        limit: 1,
      })
    )[0]
  }

  async findOrFail(id: string): Promise<Instance> {
    const query = this.where(
      'id' as AttributeName<Attributes>,
      id as AttributeValue<Attributes[AttributeName<Attributes>]>,
    )
    const value = (
      await query.session().query(this.Constructor, {
        ...diagnosed(query.plan, 'findOrFail'),
        limit: 1,
      })
    )[0]
    if (!value) throw new ModelNotFoundError(this.Constructor.name, id)
    return value
  }

  async first(): Promise<Instance | undefined> {
    return (
      await this.session().query(this.Constructor, {
        ...diagnosed(this.plan, 'first'),
        limit: 1,
      })
    )[0]
  }

  async firstOrFail(): Promise<Instance> {
    const value = (
      await this.session().query(this.Constructor, {
        ...diagnosed(this.plan, 'firstOrFail'),
        limit: 1,
      })
    )[0]
    if (!value) throw new ModelNotFoundError(this.Constructor.name, 'matching query')
    return value
  }

  async exists(): Promise<boolean> {
    return (
      (
        await this.session().queryValues(
          this.Constructor,
          { ...diagnosed(this.plan, 'exists'), limit: 1 },
          'id',
        )
      ).length > 0
    )
  }

  async count(): Promise<number> {
    return Number(
      await this.session().queryAggregate(this.Constructor, diagnosed(this.plan, 'count'), 'count'),
    )
  }

  value<Key extends ScalarAttributeName<Attributes>>(
    attribute: Key,
  ): Promise<Attributes[Key] | undefined> {
    return this.session()
      .queryValues(this.Constructor, { ...diagnosed(this.plan, 'value'), limit: 1 }, attribute)
      .then((values) => values[0] as Attributes[Key] | undefined)
  }

  pluck<Key extends ScalarAttributeName<Attributes>>(
    attribute: Key,
  ): Promise<readonly Attributes[Key][]> {
    return this.session()
      .queryValues(this.Constructor, diagnosed(this.plan, 'pluck'), attribute)
      .then((values) => values as readonly Attributes[Key][])
  }

  min<Key extends OrderedAttributeName<Attributes>>(attribute: Key) {
    return this.session().queryAggregate(
      this.Constructor,
      diagnosed(this.plan, 'min'),
      'min',
      attribute,
    )
  }
  max<Key extends OrderedAttributeName<Attributes>>(attribute: Key) {
    return this.session().queryAggregate(
      this.Constructor,
      diagnosed(this.plan, 'max'),
      'max',
      attribute,
    )
  }
  sum<Key extends NumericAttributeName<Attributes>>(attribute: Key): Promise<number> {
    return this.session()
      .queryAggregate(this.Constructor, diagnosed(this.plan, 'sum'), 'sum', attribute)
      .then((value) => (value === undefined ? 0 : Number(value)))
  }
  average<Key extends NumericAttributeName<Attributes>>(
    attribute: Key,
  ): Promise<number | undefined> {
    return this.session()
      .queryAggregate(this.Constructor, diagnosed(this.plan, 'average'), 'average', attribute)
      .then((value) => (value === undefined ? undefined : Number(value)))
  }

  paginate(input: {
    readonly page: number
    readonly perPage: number
  }): Promise<ModelPage<Instance>> {
    return this.session().paginate(
      this.Constructor,
      diagnosed(this.plan, 'paginate'),
      input.page,
      input.perPage,
    )
  }

  cursorPaginate(input: {
    readonly first: number
    readonly after?: string
    readonly before?: string
  }): Promise<ModelCursorPage<Instance>> {
    return this.session().cursorPaginate(
      this.Constructor,
      diagnosed(this.plan, 'cursorPaginate'),
      input,
    )
  }

  cursor(input: { readonly batchSize?: number } = {}): AsyncIterable<Instance> {
    const Constructor = this.Constructor
    const plan = this.plan
    const batchSize = input.batchSize ?? 100
    boundedPositiveInteger(batchSize, 'Cursor batch size', MODEL_QUERY_MAX_PAGE_SIZE)
    const activeSession = this.session()
    return {
      async *[Symbol.asyncIterator]() {
        let after: string | undefined
        do {
          assertSession(activeSession)
          const page = await activeSession.cursorPaginate(Constructor, plan, {
            first: batchSize,
            ...(after ? { after } : {}),
          })
          for (const model of page.items) yield model
          after = page.nextCursor
        } while (after)
      },
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<Instance> {
    return this.cursor()[Symbol.asyncIterator]()
  }

  private addWhere(
    boolean: 'and' | 'or',
    input:
      | QueryInput<Attributes>
      | AttributeName<Attributes>
      | ((
          query: ModelQuery<Instance, Attributes, Relations>,
        ) => ModelQuery<Instance, Attributes, Relations>),
    operatorOrValue?: unknown,
    possibleValue?: unknown,
  ): ModelQuery<Instance, Attributes, Relations> {
    if (typeof input === 'function') {
      const grouped = input(new ModelQuery(this.Constructor, EMPTY_PLAN, this.boundSession))
      if (!(grouped instanceof ModelQuery) || grouped.Constructor !== this.Constructor) {
        throw new ModelQueryError('Grouped model constraints must return the same model query.')
      }
      return this.constraint(boolean, { kind: 'group', predicates: grouped.plan.constraints })
    }
    if (typeof input === 'object' && input !== null) {
      return this.copy({
        constraints: [
          ...this.plan.constraints,
          ...Object.entries(input).map(([attribute, value]) => ({
            boolean,
            predicate: {
              kind: 'comparison' as const,
              attribute,
              operator: '=' as const,
              value: queryValue(value),
            },
          })),
        ],
      })
    }
    const operator = possibleValue === undefined ? '=' : (operatorOrValue as ModelQueryOperator)
    const value = possibleValue === undefined ? operatorOrValue : possibleValue
    validOperator(operator)
    return this.constraint(boolean, {
      kind: 'comparison',
      attribute: input,
      operator,
      value: queryValue(value),
    })
  }

  private constraint(boolean: 'and' | 'or', predicate: ModelQueryPredicate) {
    return this.copy({ constraints: [...this.plan.constraints, { boolean, predicate }] })
  }

  private copy(changes: Partial<ModelQueryPlan>): ModelQuery<Instance, Attributes, Relations> {
    return new ModelQuery(this.Constructor, { ...this.plan, ...changes }, this.boundSession)
  }

  private session(): ModelQuerySession {
    return session(this.boundSession)
  }
}

function session(bound?: ModelQuerySession): ModelQuerySession {
  const current = currentModelSession<ModelQuerySession>()
  if (bound) {
    if (!bound.active || current !== bound) {
      throw new StaleModelError('Model query belongs to an execution that is no longer active.')
    }
    return bound
  }
  if (!current?.active)
    throw new ModelQueryError('A model query requires an active Doxa ModelSession.')
  return current
}

function assertSession(bound: ModelQuerySession): void {
  if (!bound.active || currentModelSession<ModelQuerySession>() !== bound) {
    throw new StaleModelError('Model cursor belongs to an execution that is no longer active.')
  }
}

function diagnosed(
  plan: ModelQueryPlan,
  terminal: NonNullable<ModelQueryPlan['diagnostic']>['terminal'],
): ModelQueryPlan {
  return { ...plan, diagnostic: { terminal } }
}

function queryValue(value: unknown): ModelQueryValue {
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
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new ModelQueryError('Model query numbers must be finite.')
    }
    return value
  }
  throw new ModelQueryError(
    'Model query values must be strings, numbers, booleans, Doxa datetime values, or null.',
  )
}

function validOperator(operator: string): void {
  if (!['=', '!=', '<', '<=', '>', '>=', 'like', 'ilike'].includes(operator)) {
    throw new ModelQueryError(`Unsupported model query operator ${operator}.`)
  }
}

function validRelationshipOperator(operator: string): void {
  if (!['=', '!=', '<', '<=', '>', '>='].includes(operator)) {
    throw new ModelQueryError(`Unsupported relationship count operator ${operator}.`)
  }
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new ModelQueryError(`${name} must be a positive integer.`)
}

function boundedPositiveInteger(value: number, name: string, maximum: number): void {
  positiveInteger(value, name)
  if (value > maximum) throw new ModelQueryError(`${name} must be at most ${maximum}.`)
}

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new ModelQueryError(`${name} must be a non-negative integer.`)
}

/** Adapter conformance helper for in-memory persistence; production SQL adapters compile the plan. */
export function applyModelQueryPlan<State extends Record<string, unknown>>(
  values: readonly State[],
  plan: ModelQueryPlan,
): readonly State[] {
  let result = values.filter((value) => matchesConstraints(value, plan.constraints))
  if (plan.orders.length > 0) {
    result = [...result].sort((left, right) => {
      for (const order of plan.orders) {
        const comparison = compare(left[order.attribute], right[order.attribute])
        if (comparison !== 0) return order.direction === 'asc' ? comparison : -comparison
      }
      return 0
    })
  }
  const start = plan.offset ?? 0
  const end = plan.limit === undefined ? undefined : start + plan.limit
  return result.slice(start, end)
}

/** Fails closed before an adapter sees a malformed or JavaScript-authored query plan. */
export function validateModelQueryPlan(
  plan: ModelQueryPlan,
  allowedAttributes?: ReadonlySet<string>,
  attributeTypes?: Readonly<Record<string, { readonly kind: string }>>,
): void {
  if (plan.limit !== undefined) positiveInteger(plan.limit, 'Query limit')
  if (plan.offset !== undefined) nonNegativeInteger(plan.offset, 'Query offset')
  for (const order of plan.orders) {
    validateAttribute(order.attribute, allowedAttributes)
    rejectDurationOperation(attributeTypes?.[order.attribute]?.kind, 'ordering')
    if (order.direction !== 'asc' && order.direction !== 'desc') {
      throw new ModelQueryError(`Unsupported model query direction ${String(order.direction)}.`)
    }
  }
  validateConstraints(plan.constraints, allowedAttributes, attributeTypes)
  for (const eagerLoad of plan.eagerLoads) {
    if (!eagerLoad.path.trim()) throw new ModelQueryError('Relationship paths cannot be empty.')
  }
  for (const constraint of plan.relationshipConstraints) {
    if (!constraint.path.trim()) throw new ModelQueryError('Relationship paths cannot be empty.')
    validRelationshipOperator(constraint.operator)
    nonNegativeInteger(constraint.count, 'Relationship count')
  }
}

function validateConstraints(
  constraints: readonly ModelQueryConstraint[],
  allowedAttributes?: ReadonlySet<string>,
  attributeTypes?: Readonly<Record<string, { readonly kind: string }>>,
): void {
  for (const constraint of constraints) {
    if (constraint.boolean !== 'and' && constraint.boolean !== 'or') {
      throw new ModelQueryError(`Unsupported model query boolean ${String(constraint.boolean)}.`)
    }
    const predicate = constraint.predicate
    if (predicate.kind === 'group') {
      validateConstraints(predicate.predicates, allowedAttributes, attributeTypes)
      continue
    }
    validateAttribute(predicate.attribute, allowedAttributes)
    const kind = attributeTypes?.[predicate.attribute]?.kind
    if (predicate.kind === 'comparison') {
      validOperator(predicate.operator)
      if (predicate.operator !== '=' && predicate.operator !== '!=') {
        rejectDurationOperation(kind, 'comparison')
      }
      queryValue(predicate.value)
    } else if (predicate.kind === 'column') {
      validOperator(predicate.operator)
      validateAttribute(predicate.comparedAttribute, allowedAttributes)
      if (predicate.operator !== '=' && predicate.operator !== '!=') {
        rejectDurationOperation(kind, 'comparison')
        rejectDurationOperation(attributeTypes?.[predicate.comparedAttribute]?.kind, 'comparison')
      }
    } else if (predicate.kind === 'membership') {
      for (const value of predicate.values) queryValue(value)
    } else if (predicate.kind === 'between') {
      rejectDurationOperation(kind, 'range queries')
      queryValue(predicate.values[0])
      queryValue(predicate.values[1])
    }
  }
}

function rejectDurationOperation(kind: string | undefined, operation: string): void {
  if (kind === 'duration') {
    throw new ModelQueryError(`Duration model attributes do not support ${operation}.`)
  }
}

function validateAttribute(attribute: string, allowedAttributes?: ReadonlySet<string>): void {
  if (!attribute.trim()) throw new ModelQueryError('Model query attributes cannot be empty.')
  if (allowedAttributes && !allowedAttributes.has(attribute)) {
    throw new ModelQueryError(`Unknown model query attribute ${attribute}.`)
  }
}

function matchesConstraints(
  value: Record<string, unknown>,
  constraints: readonly ModelQueryConstraint[],
): boolean {
  let result = true
  for (const constraint of constraints) {
    const matched = matchesPredicate(value, constraint.predicate)
    result = constraint.boolean === 'and' ? result && matched : result || matched
  }
  return result
}

function matchesPredicate(value: Record<string, unknown>, predicate: ModelQueryPredicate): boolean {
  if (predicate.kind === 'group') return matchesConstraints(value, predicate.predicates)
  const actual = value[predicate.attribute]
  if (predicate.kind === 'null')
    return predicate.negate
      ? actual !== null && actual !== undefined
      : actual === null || actual === undefined
  if (predicate.kind === 'membership') {
    const included = predicate.values.some((candidate) => compare(actual, candidate) === 0)
    return predicate.negate ? !included : included
  }
  if (predicate.kind === 'between') {
    const included =
      compare(actual, predicate.values[0]) >= 0 && compare(actual, predicate.values[1]) <= 0
    return predicate.negate ? !included : included
  }
  if (predicate.kind === 'column') {
    return comparisonMatches(actual, predicate.operator, value[predicate.comparedAttribute])
  }
  return comparisonMatches(actual, predicate.operator, predicate.value)
}

function comparisonMatches(left: unknown, operator: ModelQueryOperator, right: unknown): boolean {
  if (operator === 'like' || operator === 'ilike') {
    if (typeof left !== 'string' || typeof right !== 'string') return false
    const source = operator === 'ilike' ? left.toLocaleLowerCase() : left
    const pattern = operator === 'ilike' ? right.toLocaleLowerCase() : right
    const expression = new RegExp(
      `^${pattern
        .split(/([%_])/)
        .map((part) =>
          part === '%' ? '.*' : part === '_' ? '.' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        )
        .join('')}$`,
      'u',
    )
    return expression.test(source)
  }
  if (operator === '=') return isDeepEqual(left, right)
  if (operator === '!=') return !isDeepEqual(left, right)
  if (left === null || left === undefined || right === null || right === undefined) return false
  const compared = compare(left, right)
  if (operator === '<') return compared < 0
  if (operator === '<=') return compared <= 0
  if (operator === '>') return compared > 0
  return compared >= 0
}

function compare(left: unknown, right: unknown): number {
  const normalizedLeft = comparableValue(left)
  const normalizedRight = comparableValue(right)
  if (isDeepEqual(normalizedLeft, normalizedRight)) return 0
  if (normalizedLeft === null || normalizedLeft === undefined) return -1
  if (normalizedRight === null || normalizedRight === undefined) return 1
  return normalizedLeft < normalizedRight ? -1 : 1
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if ((left === null || left === undefined) && (right === null || right === undefined)) return true
  return Object.is(comparableValue(left), comparableValue(right))
}

function comparableValue(value: unknown): unknown {
  if (value instanceof Graphite) return value.epochMicroseconds
  if (value instanceof Instant) return value.epochMicroseconds
  if (value instanceof LocalDate || value instanceof Duration) return value.toString()
  return value
}

function freezePlan(plan: ModelQueryPlan): ModelQueryPlan {
  const freezePredicate = (predicate: ModelQueryPredicate): ModelQueryPredicate => {
    if (predicate.kind === 'group') {
      return Object.freeze({
        ...predicate,
        predicates: Object.freeze(
          predicate.predicates.map((constraint) =>
            Object.freeze({ ...constraint, predicate: freezePredicate(constraint.predicate) }),
          ),
        ),
      })
    }
    if (predicate.kind === 'membership') {
      return Object.freeze({ ...predicate, values: Object.freeze([...predicate.values]) })
    }
    if (predicate.kind === 'between') {
      return Object.freeze({
        ...predicate,
        values: Object.freeze([...predicate.values]) as readonly [ModelQueryValue, ModelQueryValue],
      })
    }
    return Object.freeze({ ...predicate })
  }
  return Object.freeze({
    ...plan,
    constraints: Object.freeze(
      plan.constraints.map((constraint) =>
        Object.freeze({ ...constraint, predicate: freezePredicate(constraint.predicate) }),
      ),
    ),
    orders: Object.freeze(plan.orders.map((order) => Object.freeze({ ...order }))),
    eagerLoads: Object.freeze(plan.eagerLoads.map((load) => Object.freeze({ ...load }))),
    relationshipConstraints: Object.freeze(
      plan.relationshipConstraints.map((constraint) => Object.freeze({ ...constraint })),
    ),
    ...(plan.diagnostic ? { diagnostic: Object.freeze({ ...plan.diagnostic }) } : {}),
  })
}
