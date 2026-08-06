import { randomUUID } from 'node:crypto'

import {
  AfterCommitError,
  Duration,
  Graphite,
  Instant,
  LocalDate,
  type CompiledModelStorage,
  type Disposes,
  type ExecutionContext,
  type JournalFact,
  type JsonValue,
  type LifecycleContext,
  type ModelStorage,
  type ModelReader,
  type ModelQueryConstraint,
  type ModelQueryOperator,
  type ModelQueryPlan,
  type ModelQueryPredicate,
  type ModelQueryValue,
  OptimisticConcurrencyError,
  type OutboxMessage,
  PersistenceError,
  type PersistedEntity,
  type SaveEntity,
  type SavedEntity,
  type StagedDelivery,
  type DeliveryTransition,
  StaleUnitOfWorkError,
  type Starts,
  TransactionManager,
  UnitOfWork,
} from '@doxajs/core'
import { allowedDeliveryPreviousStates } from '@doxajs/core/runtime'
import { and, DrizzleQueryError, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Client, DatabaseError, Pool, types as postgresTypes, type PoolClient } from 'pg'

import {
  entityStates,
  journalEntries,
  outboxMessages,
  deliveryMessages,
  deliveryEvents,
  persistenceSchema,
  type DurableExecutionEnvelope,
} from './schema.js'

export interface PostgresTransactionOptions {
  readonly connectionString: string
  readonly maximumConnections?: number
  readonly applicationName?: string
}

interface FrameworkPostgresTransaction {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: Row[]; readonly rowCount: number | null }>
}

type Database = NodePgDatabase<typeof persistenceSchema>
type DatabaseSession = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

async function cancelActivePostgresQuery(
  connectionString: string,
  processId: number,
): Promise<void> {
  const canceller = new Client({ connectionString, connectionTimeoutMillis: 1_000 })
  const timeout = setTimeout(
    () =>
      (
        canceller as Client & { readonly connection: { readonly stream: { destroy(): void } } }
      ).connection.stream.destroy(),
    1_000,
  )
  timeout.unref()
  try {
    await canceller.connect()
    await canceller.query('SELECT pg_cancel_backend($1)', [processId])
  } catch {
    /* The owned target connection is discarded if cancellation cannot be confirmed. */
  } finally {
    clearTimeout(timeout)
    await canceller.end().catch(() => undefined)
  }
}

export class PostgresTransactionManager extends TransactionManager implements Starts, Disposes {
  override readonly serializesConcurrentOperations = true

  #pool: Pool | undefined
  #database: Database | undefined
  #connectionString: string
  #maximumConnections: number | undefined
  #applicationName: string | undefined
  #compiledModels: readonly CompiledModelStorage[] = []

  constructor(options: PostgresTransactionOptions) {
    super()
    this.#connectionString = options.connectionString
    this.#maximumConnections = options.maximumConnections
    this.#applicationName = options.applicationName
  }

  override bindCompiledModels(models: readonly CompiledModelStorage[]): void {
    if (this.#pool) {
      throw new PersistenceError('Compiled model storage must be bound before PostgreSQL starts.')
    }
    this.#compiledModels = models
  }

  async start(context: LifecycleContext): Promise<void> {
    if (context.signal.aborted) throw context.signal.reason
    const pool = new Pool({
      connectionString: this.#connectionString,
      options: '-c timezone=UTC',
      types: {
        getTypeParser: (id, format) =>
          format === 'text' && [1082, 1114, 1184].includes(id)
            ? (value: string) => value
            : postgresTypes.getTypeParser(id, format),
      },
      ...(this.#maximumConnections ? { max: this.#maximumConnections } : {}),
      ...(this.#applicationName ? { application_name: this.#applicationName } : {}),
    })
    try {
      await pool.query('select 1')
      await validateCompiledModelStorage(pool, this.#compiledModels)
      this.#pool = pool
      this.#database = drizzle(pool, { schema: persistenceSchema })
    } catch (error) {
      await pool.end().catch(() => undefined)
      throw translatePostgresOperationError(error)
    }
  }

  async transaction<Output>(
    context: ExecutionContext,
    work: (unitOfWork: UnitOfWork) => Promise<Output>,
  ): Promise<Output> {
    const pool = this.#pool
    if (!pool) throw new PersistenceError('PostgreSQL transaction manager is not started.')
    const transactionClient = await pool.connect().catch((error: unknown) => {
      throw translatePostgresOperationError(error)
    })
    const database = drizzle(transactionClient, { schema: persistenceSchema })
    let unitOfWork: PostgresUnitOfWork | undefined
    let workFailure: { readonly error: unknown } | undefined
    let cancellationWork: Promise<void> | undefined
    const abortTransaction = () => {
      unitOfWork?.close()
      try {
        context.cancellation.throwIfAborted()
      } catch (error) {
        workFailure ??= { error }
      }
      try {
        const processId = (transactionClient as PoolClient & { readonly processID?: number })
          .processID
        if (processId !== undefined) {
          cancellationWork ??= cancelActivePostgresQuery(this.#connectionString, processId).finally(
            () => transactionClient.release(true),
          )
        }
      } catch {
        /* The owned connection is discarded below if cancellation setup fails. */
      }
    }
    let result: Output
    try {
      result = await database.transaction(async (transaction) => {
        unitOfWork = new PostgresUnitOfWork(transaction, context)
        context.cancellation.addEventListener('abort', abortTransaction, { once: true })
        if (context.cancellation.aborted) abortTransaction()
        return await runTransactionWork(
          unitOfWork,
          () => work(unitOfWork!),
          (error) => {
            workFailure = { error }
          },
          context.cancellation,
        )
      })
    } catch (error) {
      throw transactionFailure(error, workFailure)
    } finally {
      context.cancellation.removeEventListener('abort', abortTransaction)
      await cancellationWork
      if (!cancellationWork) transactionClient.release()
    }
    await unitOfWork?.releaseAfterCommit()
    return result
  }

  /** @internal Framework participants sharing the Model Unit of Work transaction. */
  async frameworkTransaction<Output>(
    context: ExecutionContext,
    work: (unitOfWork: UnitOfWork, transaction: FrameworkPostgresTransaction) => Promise<Output>,
  ): Promise<Output> {
    const database = this.#database
    if (!database) throw new PersistenceError('PostgreSQL transaction manager is not started.')
    let unitOfWork: PostgresUnitOfWork | undefined
    let workFailure: { readonly error: unknown } | undefined
    let result: Output
    try {
      result = await database.transaction(async (transaction) => {
        unitOfWork = new PostgresUnitOfWork(transaction, context)
        const client = (
          transaction as unknown as { readonly session: { readonly client: PoolClient } }
        ).session.client
        if (!client?.query) {
          throw new PersistenceError('PostgreSQL transaction participant is unavailable.')
        }
        return await runTransactionWork(
          unitOfWork,
          () =>
            work(unitOfWork!, {
              query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
                text: string,
                values?: readonly unknown[],
              ) => {
                const result = await unitOfWork!.runOperation(async () => {
                  try {
                    return await client.query<Row>(text, values as unknown[] | undefined)
                  } catch (error) {
                    throw translatePostgresOperationError(error)
                  }
                })
                return { rows: result.rows, rowCount: result.rowCount }
              },
            }),
          (error) => {
            workFailure = { error }
          },
        )
      })
    } catch (error) {
      throw transactionFailure(error, workFailure)
    }
    await unitOfWork?.releaseAfterCommit()
    return result
  }

  async read<Output>(
    context: ExecutionContext,
    work: (reader: ModelReader) => Promise<Output>,
  ): Promise<Output> {
    const database = this.#database
    if (!database) throw new PersistenceError('PostgreSQL transaction manager is not started.')
    let workFailure: { readonly error: unknown } | undefined
    try {
      return await database.transaction(
        async (transaction) => {
          const reader = new PostgresUnitOfWork(transaction, context)
          return await runTransactionWork(
            reader,
            () => work(reader),
            (error) => {
              workFailure = { error }
            },
          )
        },
        { accessMode: 'read only', isolationLevel: 'repeatable read' },
      )
    } catch (error) {
      throw transactionFailure(error, workFailure)
    }
  }

  async dispose(_context: LifecycleContext): Promise<void> {
    const pool = this.#pool
    this.#database = undefined
    this.#pool = undefined
    if (pool) await pool.end()
  }
}

class PostgresOperationQueue {
  #tail: Promise<void> = Promise.resolve()
  #failure: { readonly error: unknown } | undefined

  run<Output>(work: () => Promise<Output>): Promise<Output> {
    const result = this.#tail.then(async () => {
      if (this.#failure) throw this.#failure.error
      try {
        return await work()
      } catch (error) {
        this.#failure = { error }
        throw error
      }
    })
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async drain(): Promise<void> {
    let drained: Promise<void>
    do {
      drained = this.#tail
      await drained
    } while (drained !== this.#tail)
    if (this.#failure) throw this.#failure.error
  }
}

async function runTransactionWork<Output>(
  unitOfWork: PostgresUnitOfWork,
  work: () => Promise<Output>,
  failed: (error: unknown) => void,
  cancellation?: AbortSignal,
): Promise<Output> {
  let result: Output | undefined
  let workFailure: { readonly error: unknown } | undefined
  let drainFailure: { readonly error: unknown } | undefined
  let cancellationFailure: { readonly error: unknown } | undefined
  let rejectCancellation: ((error: unknown) => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject
  })
  const abort = () => {
    if (cancellationFailure) return
    try {
      cancellation?.throwIfAborted()
    } catch (error) {
      cancellationFailure = { error }
      unitOfWork.close()
      rejectCancellation?.(error)
    }
  }
  cancellation?.addEventListener('abort', abort, { once: true })
  if (cancellation?.aborted) abort()
  try {
    result = await (cancellation ? Promise.race([Promise.resolve().then(work), cancelled]) : work())
  } catch (error) {
    workFailure = { error }
    failed(error)
  }
  try {
    await unitOfWork.drain()
  } catch (error) {
    drainFailure = { error }
  }
  unitOfWork.close()
  cancellation?.removeEventListener('abort', abort)
  if (!workFailure && cancellationFailure) {
    workFailure = cancellationFailure
    failed(cancellationFailure.error)
  }
  if (workFailure) throw workFailure.error
  if (drainFailure) throw drainFailure.error
  return result as Output
}

class PostgresUnitOfWork extends UnitOfWork {
  readonly #afterCommit: Array<() => void | Promise<void>> = []
  readonly #operations = new PostgresOperationQueue()
  #active = true

  constructor(
    private readonly session: DatabaseSession,
    private readonly context: ExecutionContext,
  ) {
    super()
  }

  runOperation<Output>(work: () => Promise<Output>): Promise<Output> {
    try {
      this.assertActive()
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#operations.run(work)
  }

  async drain(): Promise<void> {
    await this.#operations.drain()
  }

  findEntity<State extends JsonValue>(
    type: string,
    id: string,
    storage: ModelStorage = { kind: 'entity-state' },
  ): Promise<PersistedEntity<State> | undefined> {
    return this.runOperation(() => this.findEntityNow<State>(type, id, storage))
  }

  private async findEntityNow<State extends JsonValue>(
    type: string,
    id: string,
    storage: ModelStorage,
  ): Promise<PersistedEntity<State> | undefined> {
    if (storage.kind === 'table') return await this.findMappedEntity(type, id, storage)
    const [row] = await this.session
      .select()
      .from(entityStates)
      .where(and(eq(entityStates.entityType, type), eq(entityStates.entityId, id)))
      .limit(1)
    if (!row) return undefined
    return {
      type: row.entityType,
      id: row.entityId,
      version: row.version,
      state: row.state as State,
    }
  }

  queryEntities<State extends JsonValue>(
    type: string,
    storage: ModelStorage,
    plan: ModelQueryPlan,
  ): Promise<readonly PersistedEntity<State>[]> {
    return this.runOperation(() => this.queryEntitiesNow<State>(type, storage, plan))
  }

  private async queryEntitiesNow<State extends JsonValue>(
    type: string,
    storage: ModelStorage,
    plan: ModelQueryPlan,
  ): Promise<readonly PersistedEntity<State>[]> {
    const where = queryWhere(type, storage, plan.constraints)
    const order = queryOrder(storage, plan.orders)
    const bounds = queryBounds(plan)
    if (storage.kind === 'entity-state') {
      const result = await this.session.execute(sql`
        SELECT entity_type, entity_id, version, state
        FROM ${entityStates}
        ${where}
        ${order}
        ${bounds}
      `)
      return result.rows.map((row) => {
        const value = row as Record<string, unknown>
        return {
          type: String(value.entity_type),
          id: String(value.entity_id),
          version: numberVersion(value.version, type, String(value.entity_id)),
          state: value.state as State,
        }
      })
    }
    const version = versionExpression(storage)
    const projection = mappedProjection(storage)
    const result = await this.session.execute(sql`
      SELECT ${projection}, ${version} AS ${sql.identifier('__doxa_version')}
      FROM ${qualifiedIdentifier(storage.table)}
      ${where}
      ${order}
      ${bounds}
    `)
    return result.rows.map((row) => {
      const value = row as Record<string, unknown>
      const state = hydrateMappedState(value, storage)
      const id = String(state.id)
      return {
        type,
        id,
        version: numberVersion(value.__doxa_version, type, id),
        state: state as State,
      }
    })
  }

  aggregateEntities(
    type: string,
    storage: ModelStorage,
    plan: ModelQueryPlan,
    operation: 'count' | 'min' | 'max' | 'sum' | 'average',
    attribute?: string,
  ): Promise<number | ModelQueryValue | undefined> {
    return this.runOperation(() =>
      this.aggregateEntitiesNow(type, storage, plan, operation, attribute),
    )
  }

  private async aggregateEntitiesNow(
    type: string,
    storage: ModelStorage,
    plan: ModelQueryPlan,
    operation: 'count' | 'min' | 'max' | 'sum' | 'average',
    attribute?: string,
  ): Promise<number | ModelQueryValue | undefined> {
    if (operation !== 'count' && !attribute) {
      throw new PersistenceError(`${operation} model aggregate requires an attribute.`)
    }
    const where = queryWhere(type, storage, plan.constraints)
    const expression = aggregateExpression(storage, operation, attribute)
    const source =
      storage.kind === 'entity-state' ? sql`${entityStates}` : qualifiedIdentifier(storage.table)
    const result = await this.session.execute(sql`
      SELECT ${expression} AS ${sql.identifier('__doxa_aggregate')}
      FROM ${source}
      ${where}
    `)
    const value = (result.rows[0] as Record<string, unknown> | undefined)?.__doxa_aggregate
    if (value === null || value === undefined) return undefined
    return operation === 'count' || operation === 'sum' || operation === 'average'
      ? Number(value)
      : (databaseModelValue(value, modelAttributeKind(storage, attribute!)) as ModelQueryValue)
  }

  saveEntity<State extends JsonValue>(entity: SaveEntity<State>): Promise<number | SavedEntity> {
    return this.runOperation(() => this.saveEntityNow(entity))
  }

  private async saveEntityNow<State extends JsonValue>(
    entity: SaveEntity<State>,
  ): Promise<number | SavedEntity> {
    if (entity.storage?.kind === 'table') return await this.saveMappedEntity(entity, entity.storage)
    const now = new Date()
    if (entity.expectedVersion === undefined) {
      try {
        const [created] = await this.session
          .insert(entityStates)
          .values({
            entityType: entity.type,
            entityId: entity.id,
            version: 1,
            state: entity.state,
            updatedAt: now,
          })
          .returning({ version: entityStates.version })
        if (!created)
          throw new PersistenceError('PostgreSQL did not return the inserted entity version.')
        return created.version
      } catch (error) {
        if (postgresCode(error) === '23505') {
          throw new OptimisticConcurrencyError(entity.type, entity.id, entity.expectedVersion)
        }
        throw translatePersistenceError(error)
      }
    }

    const [updated] = await this.session
      .update(entityStates)
      .set({
        version: entity.expectedVersion + 1,
        state: entity.state,
        updatedAt: now,
      })
      .where(
        and(
          eq(entityStates.entityType, entity.type),
          eq(entityStates.entityId, entity.id),
          eq(entityStates.version, entity.expectedVersion),
        ),
      )
      .returning({ version: entityStates.version })
    if (!updated) {
      throw new OptimisticConcurrencyError(entity.type, entity.id, entity.expectedVersion)
    }
    return updated.version
  }

  deleteEntity(
    type: string,
    id: string,
    expectedVersion: number,
    storage: ModelStorage = { kind: 'entity-state' },
  ): Promise<void> {
    return this.runOperation(() => this.deleteEntityNow(type, id, expectedVersion, storage))
  }

  private async deleteEntityNow(
    type: string,
    id: string,
    expectedVersion: number,
    storage: ModelStorage,
  ): Promise<void> {
    if (storage.kind === 'table') {
      await this.deleteMappedEntity(type, id, expectedVersion, storage)
      return
    }
    const [deleted] = await this.session
      .delete(entityStates)
      .where(
        and(
          eq(entityStates.entityType, type),
          eq(entityStates.entityId, id),
          eq(entityStates.version, expectedVersion),
        ),
      )
      .returning({ id: entityStates.entityId })
    if (!deleted) throw new OptimisticConcurrencyError(type, id, expectedVersion)
  }

  private async findMappedEntity<State extends JsonValue>(
    type: string,
    id: string,
    storage: Extract<ModelStorage, { readonly kind: 'table' }>,
  ): Promise<PersistedEntity<State> | undefined> {
    const version = versionExpression(storage)
    const projection = mappedProjection(storage)
    const result = await this.session.execute(sql`
      SELECT ${projection}, ${version} AS ${sql.identifier('__doxa_version')}
      FROM ${qualifiedIdentifier(storage.table)}
      WHERE ${sql.identifier(storage.primaryKey)} = ${id}
      LIMIT 1
    `)
    const row = result.rows[0] as Record<string, unknown> | undefined
    if (!row) return undefined
    const state = hydrateMappedState(row, storage)
    return {
      type,
      id: String(state.id),
      version: numberVersion(row.__doxa_version, type, id),
      state: state as State,
    }
  }

  private async saveMappedEntity<State extends JsonValue>(
    entity: SaveEntity<State>,
    storage: Extract<ModelStorage, { readonly kind: 'table' }>,
  ): Promise<number | SavedEntity> {
    if (storage.readOnly) {
      throw new PersistenceError(`Mapped model ${entity.type} is read-only.`)
    }
    if (typeof entity.state !== 'object' || entity.state === null || Array.isArray(entity.state)) {
      throw new PersistenceError(`Mapped model ${entity.type} state must be a JSON object.`)
    }
    const update = entity.expectedVersion !== undefined
    const values = dehydrateMappedState(
      (update ? entity.patch : entity.state) as Record<string, JsonValue>,
      storage,
    )
    if (entity.expectedVersion !== undefined) {
      for (const attribute of entity.removedAttributes ?? []) {
        assertMappedAttribute(attribute, storage)
        values.set(mappedColumn(attribute, storage), null)
      }
    }
    const now = new Date()
    if (storage.timestamps) {
      if (entity.expectedVersion === undefined && !values.has(storage.timestamps.createdAt))
        values.set(storage.timestamps.createdAt, now)
      if (!values.has(storage.timestamps.updatedAt)) values.set(storage.timestamps.updatedAt, now)
    }
    if (storage.versionColumn)
      values.set(
        storage.versionColumn,
        entity.expectedVersion === undefined ? 1 : entity.expectedVersion + 1,
      )
    if (entity.expectedVersion === undefined) {
      try {
        const databaseGeneratedIdentity = entity.id.startsWith('doxa-generated:')
        if (databaseGeneratedIdentity) values.delete(storage.primaryKey)
        const columns = [...values.keys()].map((column) => sql.identifier(column))
        const parameters = [...values.values()].map((value) => sql`${value}`)
        const result = await this.session.execute(sql`
          INSERT INTO ${qualifiedIdentifier(storage.table)} (${sql.join(columns, sql`, `)})
          VALUES (${sql.join(parameters, sql`, `)})
          RETURNING ${versionExpression(storage)} AS ${sql.identifier('__doxa_version')},
                    ${sql.identifier(storage.primaryKey)} AS ${sql.identifier('__doxa_id')}
        `)
        const row = result.rows[0] as Record<string, unknown> | undefined
        if (!row)
          throw new PersistenceError('PostgreSQL did not return the inserted mapped model version.')
        const version = numberVersion(row.__doxa_version, entity.type, entity.id)
        return databaseGeneratedIdentity ? { version, id: String(row.__doxa_id) } : version
      } catch (error) {
        if (postgresCode(error) === '23505')
          throw new OptimisticConcurrencyError(entity.type, entity.id, entity.expectedVersion)
        throw translatePersistenceError(error)
      }
    }
    values.delete(storage.primaryKey)
    const assignments = [...values.entries()].map(
      ([column, value]) => sql`${sql.identifier(column)} = ${value}`,
    )
    if (assignments.length === 0) return entity.expectedVersion
    const result = await this.session.execute(sql`
      UPDATE ${qualifiedIdentifier(storage.table)}
      SET ${sql.join(assignments, sql`, `)}
      WHERE ${sql.identifier(storage.primaryKey)} = ${entity.id}
        AND ${versionPredicate(storage, entity.expectedVersion)}
      RETURNING ${versionExpression(storage)} AS ${sql.identifier('__doxa_version')}
    `)
    const row = result.rows[0] as Record<string, unknown> | undefined
    if (!row) throw new OptimisticConcurrencyError(entity.type, entity.id, entity.expectedVersion)
    return numberVersion(row.__doxa_version, entity.type, entity.id)
  }

  private async deleteMappedEntity(
    type: string,
    id: string,
    expectedVersion: number,
    storage: Extract<ModelStorage, { readonly kind: 'table' }>,
  ): Promise<void> {
    if (storage.readOnly) {
      throw new PersistenceError(`Mapped model ${type} is read-only.`)
    }
    const result = await this.session.execute(sql`
      DELETE FROM ${qualifiedIdentifier(storage.table)}
      WHERE ${sql.identifier(storage.primaryKey)} = ${id}
        AND ${versionPredicate(storage, expectedVersion)}
      RETURNING ${sql.identifier(storage.primaryKey)}
    `)
    if (result.rows.length === 0) throw new OptimisticConcurrencyError(type, id, expectedVersion)
  }

  record<Payload extends JsonValue>(fact: JournalFact<Payload>): Promise<string> {
    return this.runOperation(() => this.recordNow(fact))
  }

  private async recordNow<Payload extends JsonValue>(fact: JournalFact<Payload>): Promise<string> {
    const id = randomUUID()
    await this.session.insert(journalEntries).values({
      id,
      factType: fact.type,
      payloadVersion: fact.version ?? 1,
      entityType: fact.entityType,
      entityId: fact.entityId,
      payload: fact.payload,
      context: durableContext(this.context),
      occurredAt: new Date(),
    })
    return id
  }

  enqueue<Payload extends JsonValue>(message: OutboxMessage<Payload>): Promise<string> {
    return this.runOperation(() => this.enqueueNow(message))
  }

  private async enqueueNow<Payload extends JsonValue>(
    message: OutboxMessage<Payload>,
  ): Promise<string> {
    const id = randomUUID()
    const now = new Date()
    await this.session.insert(outboxMessages).values({
      id,
      messageType: message.type,
      payload: message.payload,
      context: durableContext(this.context),
      status: 'pending',
      availableAt: message.availableAt ? sql`${message.availableAt.toString()}::timestamptz` : now,
      createdAt: now,
    })
    return id
  }

  stageDelivery(delivery: StagedDelivery): Promise<void> {
    return this.runOperation(() => this.stageDeliveryNow(delivery))
  }

  private async stageDeliveryNow(delivery: StagedDelivery): Promise<void> {
    const now = new Date()
    await this.session.insert(deliveryMessages).values({
      id: delivery.id,
      channel: delivery.channel,
      recipients: delivery.recipients,
      payload: delivery.payload,
      state: 'pending',
      context: deliveryContext(this.context),
      createdAt: now,
      updatedAt: now,
    })
  }

  transitionDelivery(transition: DeliveryTransition): Promise<void> {
    return this.runOperation(() => this.transitionDeliveryNow(transition))
  }

  private async transitionDeliveryNow(transition: DeliveryTransition): Promise<void> {
    if (transition.eventId) {
      const inserted = await this.session
        .insert(deliveryEvents)
        .values({
          eventId: transition.eventId,
          messageId: transition.messageId,
          state: transition.state,
          occurredAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ eventId: deliveryEvents.eventId })
      if (inserted.length === 0) return
    }
    await this.session
      .update(deliveryMessages)
      .set({
        state: transition.state,
        ...(transition.providerMessageId
          ? { providerMessageId: transition.providerMessageId }
          : {}),
        failureKind: transition.failureKind ?? null,
        failureCode: transition.code ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(deliveryMessages.id, transition.messageId),
          inArray(deliveryMessages.state, allowedDeliveryPreviousStates(transition.state)),
        ),
      )
  }

  afterCommit(callback: () => void | Promise<void>): void {
    this.assertActive()
    this.#afterCommit.push(callback)
  }

  close(): void {
    this.#active = false
  }

  async releaseAfterCommit(): Promise<void> {
    const errors: unknown[] = []
    for (const callback of this.#afterCommit) {
      try {
        await callback()
      } catch (error) {
        errors.push(error)
      }
    }
    this.#afterCommit.length = 0
    if (errors.length > 0) throw new AfterCommitError(errors)
  }

  private assertActive(): void {
    if (!this.#active) throw new StaleUnitOfWorkError('Unit of Work is no longer active.')
  }
}

function queryWhere(
  type: string,
  storage: ModelStorage,
  constraints: readonly ModelQueryConstraint[],
): SQL {
  const application = compileConstraints(storage, constraints)
  const typeConstraint =
    storage.kind === 'entity-state' ? sql`${entityStates.entityType} = ${type}` : undefined
  const combined =
    typeConstraint && application
      ? sql`(${typeConstraint}) AND (${application})`
      : (typeConstraint ?? application)
  return combined ? sql`WHERE ${combined}` : sql``
}

function compileConstraints(
  storage: ModelStorage,
  constraints: readonly ModelQueryConstraint[],
): SQL | undefined {
  let expression: SQL | undefined
  for (const constraint of constraints) {
    const next = compilePredicate(storage, constraint.predicate)
    expression = expression
      ? constraint.boolean === 'and'
        ? sql`(${expression}) AND (${next})`
        : sql`(${expression}) OR (${next})`
      : next
  }
  return expression
}

function compilePredicate(storage: ModelStorage, predicate: ModelQueryPredicate): SQL {
  if (predicate.kind === 'group')
    return compileConstraints(storage, predicate.predicates) ?? sql`TRUE`
  if (predicate.kind === 'null') {
    if (storage.kind === 'entity-state' && predicate.attribute !== 'id') {
      const json = jsonAttribute(predicate.attribute)
      const condition = sql`(${json} IS NULL OR ${json} = 'null'::jsonb)`
      return predicate.negate ? sql`NOT (${condition})` : condition
    }
    const field = queryAttribute(storage, predicate.attribute)
    return predicate.negate ? sql`${field} IS NOT NULL` : sql`${field} IS NULL`
  }
  if (predicate.kind === 'membership') {
    if (predicate.values.length === 0) return predicate.negate ? sql`TRUE` : sql`FALSE`
    const nonNullValues = predicate.values.filter((value) => value !== null)
    const field = comparableAttribute(
      storage,
      predicate.attribute,
      nonNullValues[0] ?? predicate.values[0]!,
    )
    const membership =
      nonNullValues.length === 0
        ? sql`FALSE`
        : sql`COALESCE(${field} IN (${sql.join(
            nonNullValues.map((value) => sql`${databaseQueryValue(value)}`),
            sql`, `,
          )}), FALSE)`
    const condition = predicate.values.includes(null)
      ? sql`(${membership}) OR (${nullCondition(storage, predicate.attribute)})`
      : membership
    return predicate.negate ? sql`NOT (${condition})` : condition
  }
  if (predicate.kind === 'between') {
    const field = comparableAttribute(storage, predicate.attribute, predicate.values[0])
    const condition = sql`${field} BETWEEN ${databaseQueryValue(predicate.values[0])} AND ${databaseQueryValue(predicate.values[1])}`
    return predicate.negate ? sql`NOT (${condition})` : condition
  }
  if (predicate.kind === 'column') {
    return comparisonSql(
      columnComparisonAttribute(storage, predicate.attribute, predicate.operator),
      predicate.operator,
      columnComparisonAttribute(storage, predicate.comparedAttribute, predicate.operator),
    )
  }
  return comparisonSql(
    comparableAttribute(storage, predicate.attribute, predicate.value),
    predicate.operator,
    sql`${databaseQueryValue(predicate.value)}`,
  )
}

function comparisonSql(left: SQL, operator: ModelQueryOperator, right: SQL): SQL {
  if (operator === '=') return sql`${left} IS NOT DISTINCT FROM ${right}`
  if (operator === '!=') return sql`${left} IS DISTINCT FROM ${right}`
  if (operator === '<') return sql`${left} < ${right}`
  if (operator === '<=') return sql`${left} <= ${right}`
  if (operator === '>') return sql`${left} > ${right}`
  if (operator === '>=') return sql`${left} >= ${right}`
  if (operator === 'like') return sql`${left} LIKE ${right}`
  return sql`${left} ILIKE ${right}`
}

function queryAttribute(storage: ModelStorage, attribute: string): SQL {
  if (storage.kind === 'entity-state') {
    return attribute === 'id' ? sql`${entityStates.entityId}` : jsonTextAttribute(attribute)
  }
  return sql`${sql.identifier(attribute === 'id' ? storage.primaryKey : (storage.columns[attribute] ?? attribute))}`
}

function comparableAttribute(
  storage: ModelStorage,
  attribute: string,
  value: ModelQueryValue,
): SQL {
  if (storage.kind === 'table' || attribute === 'id') return queryAttribute(storage, attribute)
  const kind = modelAttributeKind(storage, attribute)
  if (kind === 'graphite')
    return sql`split_part(${jsonDateTimeValue(attribute)}, '[', 1)::timestamptz`
  if (kind === 'instant') return sql`(${jsonDateTimeValue(attribute)})::timestamptz`
  if (kind === 'local-date') return sql`(${jsonDateTimeValue(attribute)})::date`
  if (kind === 'duration') return jsonDateTimeValue(attribute)
  const field = jsonTextAttribute(attribute)
  if (typeof value === 'number') return sql`(${field})::numeric`
  if (typeof value === 'boolean') return sql`(${field})::boolean`
  return field
}

function columnComparisonAttribute(
  storage: ModelStorage,
  attribute: string,
  operator: ModelQueryOperator,
): SQL {
  if (storage.kind === 'table' || operator === 'like' || operator === 'ilike') {
    return queryAttribute(storage, attribute)
  }
  if (attribute === 'id') return sql`to_jsonb(${queryAttribute(storage, attribute)})`
  const kind = modelAttributeKind(storage, attribute)
  if (kind === 'graphite')
    return sql`split_part(${jsonDateTimeValue(attribute)}, '[', 1)::timestamptz`
  if (kind === 'instant') return sql`(${jsonDateTimeValue(attribute)})::timestamptz`
  if (kind === 'local-date') return sql`(${jsonDateTimeValue(attribute)})::date`
  if (kind === 'duration') return jsonDateTimeValue(attribute)
  return sql`COALESCE(${jsonAttribute(attribute)}, 'null'::jsonb)`
}

function jsonTextAttribute(attribute: string): SQL {
  return sql`(${entityStates.state} ->> ${attribute})`
}

function jsonAttribute(attribute: string): SQL {
  return sql`(${entityStates.state} -> ${attribute})`
}

function jsonDateTimeValue(attribute: string): SQL {
  return sql`(${jsonAttribute(attribute)} ->> 'value')`
}

function nullCondition(storage: ModelStorage, attribute: string): SQL {
  if (storage.kind === 'entity-state' && attribute !== 'id') {
    const json = jsonAttribute(attribute)
    return sql`(${json} IS NULL OR ${json} = 'null'::jsonb)`
  }
  return sql`${queryAttribute(storage, attribute)} IS NULL`
}

function databaseQueryValue(value: ModelQueryValue): unknown {
  if (value instanceof Graphite) return value.toInstant().toString()
  if (value instanceof Instant || value instanceof LocalDate || value instanceof Duration) {
    return value.toString()
  }
  return value
}

function queryOrder(storage: ModelStorage, orders: ModelQueryPlan['orders']): SQL {
  if (orders.length === 0) return sql``
  return sql`ORDER BY ${sql.join(
    orders.flatMap((order) => {
      const field = orderedAttribute(storage, order.attribute)
      const nullRank = nullCondition(storage, order.attribute)
      return order.direction === 'desc'
        ? [sql`CASE WHEN ${nullRank} THEN 1 ELSE 0 END ASC`, sql`${field} DESC`]
        : [sql`CASE WHEN ${nullRank} THEN 0 ELSE 1 END ASC`, sql`${field} ASC`]
    }),
    sql`, `,
  )}`
}

function orderedAttribute(storage: ModelStorage, attribute: string): SQL {
  if (storage.kind === 'table' || attribute === 'id') return queryAttribute(storage, attribute)
  const kind = modelAttributeKind(storage, attribute)
  if (kind === 'graphite')
    return sql`split_part(${jsonDateTimeValue(attribute)}, '[', 1)::timestamptz`
  if (kind === 'instant') return sql`(${jsonDateTimeValue(attribute)})::timestamptz`
  if (kind === 'local-date') return sql`(${jsonDateTimeValue(attribute)})::date`
  if (kind === 'duration') return jsonDateTimeValue(attribute)
  return jsonAttribute(attribute)
}

function queryBounds(plan: ModelQueryPlan): SQL {
  return sql`${plan.limit === undefined ? sql`` : sql`LIMIT ${plan.limit}`} ${
    plan.offset === undefined ? sql`` : sql`OFFSET ${plan.offset}`
  }`
}

function aggregateExpression(
  storage: ModelStorage,
  operation: 'count' | 'min' | 'max' | 'sum' | 'average',
  attribute?: string,
): SQL {
  if (operation === 'count') return sql`count(*)`
  const field =
    storage.kind === 'entity-state'
      ? operation === 'sum' || operation === 'average'
        ? sql`(${jsonTextAttribute(attribute!)})::numeric`
        : orderedAttribute(storage, attribute!)
      : queryAttribute(storage, attribute!)
  if (operation === 'min') return sql`min(${field})`
  if (operation === 'max') return sql`max(${field})`
  if (operation === 'sum') return sql`sum(${field})`
  return sql`avg(${field})`
}

function qualifiedIdentifier(value: string): SQL {
  return sql.join(
    value.split('.').map((part) => sql.identifier(part)),
    sql`.`,
  )
}

/** @internal Exact identifier text for PostgreSQL regclass catalog lookups. */
export function postgresRegclassIdentifier(value: string): string {
  return value
    .split('.')
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join('.')
}

function versionExpression(storage: Extract<ModelStorage, { readonly kind: 'table' }>): SQL {
  const source = mappedModelVersionSource(storage)
  if (source.kind === 'column') return sql`${sql.identifier(source.column)}`
  return source.kind === 'none' ? sql`0` : sql.raw('(xmin::text)::bigint')
}

/** @internal Pure version-source contract used by adapter conformance tests. */
export function mappedModelVersionSource(
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
):
  | { readonly kind: 'column'; readonly column: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'xmin' } {
  const derived:
    | { readonly kind: 'column'; readonly column: string }
    | { readonly kind: 'none' }
    | { readonly kind: 'xmin' } = storage.versionColumn
    ? { kind: 'column', column: storage.versionColumn }
    : storage.readOnly
      ? { kind: 'none' }
      : { kind: 'xmin' }
  if (
    storage.versionSource &&
    (storage.versionSource.kind !== derived.kind ||
      (storage.versionSource.kind === 'column' &&
        derived.kind === 'column' &&
        storage.versionSource.column !== derived.column))
  ) {
    throw new PersistenceError('Mapped model version source is inconsistent with its storage mode.')
  }
  return storage.versionSource ?? derived
}

function versionPredicate(
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
  expectedVersion: number,
): SQL {
  return storage.versionColumn
    ? sql`${sql.identifier(storage.versionColumn)} = ${expectedVersion}`
    : sql`(xmin::text)::bigint = ${expectedVersion}`
}

/** @internal Strict projected-row hydration used by adapter conformance tests. */
export function hydrateMappedState(
  row: Readonly<Record<string, unknown>>,
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
): Record<string, JsonValue> {
  const optionalAttributes = new Set(storage.optionalAttributes ?? [])
  const projection = mappedModelProjection(storage)
  const state: Record<string, JsonValue> = {}
  const expected = new Set([...projection.map((entry) => entry.alias), '__doxa_version'])
  const unexpected = Object.keys(row).find((column) => !expected.has(column))
  if (unexpected) {
    throw new PersistenceError(`Mapped model query returned undeclared column ${unexpected}.`)
  }
  for (const { attribute, column, alias } of projection) {
    if (!Object.hasOwn(row, alias)) {
      throw new PersistenceError(`Mapped model query did not return declared column ${column}.`)
    }
    const value = row[alias]
    if (value === null && optionalAttributes.has(attribute)) continue
    if (value === null && storage.attributeTypes?.[attribute]?.nullable === false) {
      throw new PersistenceError(
        `Mapped model query returned NULL for required attribute ${attribute}.`,
      )
    }
    state[attribute] = databaseModelValue(value, storage.attributeTypes?.[attribute]?.kind)
  }
  const id = projection.find((entry) => entry.attribute === 'id')
  if (!id) {
    throw new PersistenceError('Mapped model projection does not declare the id attribute.')
  }
  state.id = String(row[id.alias])
  return state
}

function mappedProjection(storage: Extract<ModelStorage, { readonly kind: 'table' }>): SQL {
  return sql.join(
    mappedModelProjection(storage).map(
      ({ column, alias }) => sql`${sql.identifier(column)} AS ${sql.identifier(alias)}`,
    ),
    sql`, `,
  )
}

/** @internal Pure projection contract used by adapter conformance tests. */
export function mappedModelProjection(
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
): readonly {
  readonly attribute: string
  readonly column: string
  readonly alias: string
}[] {
  return Object.entries(storage.columns).map(([attribute, column], index) => ({
    attribute,
    column,
    alias: `__doxa_attribute_${index}`,
  }))
}

/** @internal Strict UTC dehydration used by adapter conformance tests. */
export function dehydrateMappedState(
  state: Readonly<Record<string, unknown>>,
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
): Map<string, unknown> {
  const values = new Map<string, unknown>()
  for (const [attribute, value] of Object.entries(state)) {
    assertMappedAttribute(attribute, storage)
    values.set(
      mappedColumn(attribute, storage),
      databasePersistenceValue(value, storage.attributeTypes?.[attribute]?.kind),
    )
  }
  return values
}

function assertMappedAttribute(
  attribute: string,
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
): void {
  if (!Object.hasOwn(storage.columns, attribute)) {
    throw new PersistenceError(`Mapped model write contains undeclared attribute ${attribute}.`)
  }
}

function mappedColumn(
  attribute: string,
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
): string {
  return attribute === 'id' ? storage.primaryKey : (storage.columns[attribute] ?? attribute)
}

function databaseJsonValue(value: unknown): JsonValue {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value
  if (Array.isArray(value)) return value.map(databaseJsonValue)
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, databaseJsonValue(nested)]),
    )
  throw new PersistenceError(
    `Mapped PostgreSQL value of type ${typeof value} is not JSON-compatible.`,
  )
}

function databasePersistenceValue(
  value: unknown,
  kind:
    | NonNullable<
        Extract<ModelStorage, { readonly kind: 'table' }>['attributeTypes']
      >[string]['kind']
    | undefined,
): unknown {
  if (value === null || value === undefined) return value
  if (kind === 'graphite') {
    if (!(value instanceof Graphite))
      throw new PersistenceError('Graphite model attribute must contain Graphite.')
    return value.toInstant().toString()
  }
  if (kind === 'instant') {
    if (!(value instanceof Instant))
      throw new PersistenceError('Instant model attribute must contain Instant.')
    return value.toString()
  }
  if (kind === 'local-date') {
    if (!(value instanceof LocalDate))
      throw new PersistenceError('LocalDate model attribute must contain LocalDate.')
    return value.toString()
  }
  if (kind === 'duration') {
    if (!(value instanceof Duration))
      throw new PersistenceError('Duration model attribute must contain Duration.')
    return value.toString()
  }
  return value
}

function databaseModelValue(
  value: unknown,
  kind:
    | NonNullable<
        Extract<ModelStorage, { readonly kind: 'table' }>['attributeTypes']
      >[string]['kind']
    | undefined,
): JsonValue {
  if (value === null || value === undefined) return value as JsonValue
  if (kind === 'graphite') {
    return Graphite.fromInstant(
      Instant.parse(databaseInstantString(value)),
      'UTC',
    ) as unknown as JsonValue
  }
  if (kind === 'instant') return Instant.parse(databaseInstantString(value)) as unknown as JsonValue
  if (kind === 'local-date') {
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
    return LocalDate.parse(text) as unknown as JsonValue
  }
  if (kind === 'duration') return Duration.parse(String(value)) as unknown as JsonValue
  return databaseJsonValue(value)
}

function databaseInstantString(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  let text = String(value).replace(' ', 'T')
  if (/[+-]\d{2}$/u.test(text)) text = `${text}:00`
  return /(?:Z|[+-]\d{2}:\d{2})$/u.test(text) ? text : `${text}Z`
}

function modelAttributeKind(
  storage: ModelStorage,
  attribute: string,
):
  | NonNullable<Extract<ModelStorage, { readonly kind: 'table' }>['attributeTypes']>[string]['kind']
  | undefined {
  return storage.attributeTypes?.[attribute]?.kind
}

export interface ModelColumnMetadata {
  readonly name: string
  readonly type: string
  readonly typeKind: string
  readonly baseType?: string
  readonly notNull: boolean
  readonly generated: boolean
  readonly identity: boolean
  readonly hasDefault: boolean
}

async function validateCompiledModelStorage(
  pool: Pool,
  models: readonly CompiledModelStorage[],
): Promise<void> {
  for (const model of models) {
    if (model.storage.kind !== 'table') continue
    await validateMappedModelStorage(pool, model.entityType, model.storage)
  }
}

async function validateMappedModelStorage(
  pool: Pool,
  entityType: string,
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
): Promise<void> {
  const relationIdentifier = postgresRegclassIdentifier(storage.table)
  const relation = await pool.query<{ relkind: string }>(
    `SELECT c.relkind
     FROM pg_class c
     WHERE c.oid = to_regclass($1)`,
    [relationIdentifier],
  )
  const relkind = relation.rows[0]?.relkind
  if (!relkind) {
    throw new PersistenceError(
      `Mapped model ${entityType} relation ${storage.table} does not exist.`,
    )
  }
  const view = relkind === 'v' || relkind === 'm'

  const result = await pool.query<{
    name: string
    type: string
    type_kind: string
    base_type: string | null
    not_null: boolean
    generated: string
    identity: string
    has_default: boolean
  }>(
    `SELECT a.attname AS name,
            t.typname AS type,
            t.typtype AS type_kind,
            bt.typname AS base_type,
            a.attnotnull AS not_null,
            a.attgenerated AS generated,
            a.attidentity AS identity,
            a.atthasdef AS has_default
     FROM pg_attribute a
     JOIN pg_type t ON t.oid = a.atttypid
     LEFT JOIN pg_type bt ON bt.oid = t.typbasetype
     WHERE a.attrelid = to_regclass($1)
       AND a.attnum > 0
       AND NOT a.attisdropped`,
    [relationIdentifier],
  )
  const columns = new Map<string, ModelColumnMetadata>(
    result.rows.map((row) => [
      row.name,
      {
        name: row.name,
        type: row.type,
        typeKind: row.type_kind,
        ...(row.base_type ? { baseType: row.base_type } : {}),
        notNull: row.not_null,
        generated: Boolean(row.generated),
        identity: Boolean(row.identity),
        hasDefault: row.has_default,
      },
    ]),
  )
  const primary = view
    ? []
    : (
        await pool.query<{ name: string }>(
          `SELECT a.attname AS name
           FROM pg_index i
           JOIN pg_attribute a
             ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey::smallint[])
           WHERE i.indrelid = to_regclass($1)
             AND i.indisprimary
           ORDER BY array_position(i.indkey::smallint[], a.attnum)`,
          [relationIdentifier],
        )
      ).rows.map((row) => row.name)
  validateMappedModelReadiness(entityType, storage, relkind, [...columns.values()], primary)
}

/** @internal Pure readiness contract used by adapter conformance tests. */
export function validateMappedModelReadiness(
  entityType: string,
  storage: Extract<ModelStorage, { readonly kind: 'table' }>,
  relationKind: string | undefined,
  columnMetadata: readonly ModelColumnMetadata[],
  primaryKeyColumns: readonly string[],
): void {
  if (!relationKind) {
    throw new PersistenceError(
      `Mapped model ${entityType} relation ${storage.table} does not exist.`,
    )
  }
  const view = relationKind === 'v' || relationKind === 'm'
  if (view && !storage.readOnly) {
    throw new PersistenceError(
      `Mapped model ${entityType} relation ${storage.table} is a view and must declare readOnly = true.`,
    )
  }
  if (!['r', 'p', 'v', 'm'].includes(relationKind)) {
    throw new PersistenceError(
      `Mapped model ${entityType} relation ${storage.table} has an unsupported PostgreSQL relation kind.`,
    )
  }
  const columns = new Map(columnMetadata.map((column) => [column.name, column]))
  for (const [attribute, column] of Object.entries(storage.columns)) {
    const metadata = columns.get(column)
    if (!metadata) {
      throw new PersistenceError(
        `Mapped model ${entityType} attribute ${attribute} references missing column ${column}.`,
      )
    }
    const contract = storage.attributeTypes?.[attribute]
    if (
      contract &&
      !compatiblePostgresType(
        contract.kind,
        metadata,
        attribute === 'id' && contract.kind === 'string',
      )
    ) {
      throw new PersistenceError(
        `Mapped model ${entityType} attribute ${attribute} is incompatible with PostgreSQL type ${metadata.type}.`,
      )
    }
    if (contract && !view) {
      const permitsNull = contract.optional || contract.nullable
      if (permitsNull === metadata.notNull) {
        throw new PersistenceError(
          `Mapped model ${entityType} attribute ${attribute} has incompatible nullability for column ${column}.`,
        )
      }
    }
    if (!storage.readOnly && attribute !== 'id' && (metadata.generated || metadata.identity)) {
      throw new PersistenceError(
        `Writable mapped model ${entityType} attribute ${attribute} uses generated column ${column}.`,
      )
    }
  }

  for (const infrastructure of [
    storage.versionColumn,
    ...(storage.timestamps ? [storage.timestamps.createdAt, storage.timestamps.updatedAt] : []),
  ].filter((column): column is string => Boolean(column))) {
    if (!columns.has(infrastructure)) {
      throw new PersistenceError(
        `Mapped model ${entityType} references missing infrastructure column ${infrastructure}.`,
      )
    }
  }
  if (storage.versionColumn) {
    const version = columns.get(storage.versionColumn)!
    if (
      !compatiblePostgresType('number', version) ||
      !version.notNull ||
      (!storage.readOnly && (version.generated || version.identity))
    ) {
      throw new PersistenceError(
        `Mapped model ${entityType} version column ${storage.versionColumn} must be a writable non-null numeric column.`,
      )
    }
  }
  if (storage.timestamps) {
    for (const timestamp of [storage.timestamps.createdAt, storage.timestamps.updatedAt]) {
      const metadata = columns.get(timestamp)!
      if (
        !compatiblePostgresType('instant', metadata) ||
        (!storage.readOnly && (metadata.generated || metadata.identity))
      ) {
        throw new PersistenceError(
          `Writable mapped model ${entityType} timestamp column ${timestamp} must be a writable PostgreSQL timestamp column.`,
        )
      }
    }
  }

  if (!view) {
    if (primaryKeyColumns.length !== 1 || primaryKeyColumns[0] !== storage.primaryKey) {
      throw new PersistenceError(
        `Mapped model ${entityType} requires single-column primary key ${storage.primaryKey}.`,
      )
    }
  }

  if (!storage.readOnly) {
    const supplied = new Set([
      ...Object.values(storage.columns),
      storage.versionColumn,
      ...(storage.timestamps ? [storage.timestamps.createdAt, storage.timestamps.updatedAt] : []),
    ])
    const impossible = [...columns.values()].find(
      (column) =>
        !supplied.has(column.name) &&
        column.notNull &&
        !column.hasDefault &&
        !column.generated &&
        !column.identity,
    )
    if (impossible) {
      throw new PersistenceError(
        `Writable mapped model ${entityType} cannot insert because undeclared column ${impossible.name} is required and has no default.`,
      )
    }
  }
}

function compatiblePostgresType(
  kind: NonNullable<
    Extract<ModelStorage, { readonly kind: 'table' }>['attributeTypes']
  >[string]['kind'],
  metadata: Pick<ModelColumnMetadata, 'type' | 'typeKind' | 'baseType'>,
  allowNumericString = false,
): boolean {
  const type = metadata.baseType ?? metadata.type
  if (kind === 'json') return true
  if (kind === 'string' && metadata.typeKind === 'e') return true
  if (kind === 'string')
    return (
      new Set(['text', 'varchar', 'bpchar', 'citext', 'uuid', 'name', 'inet']).has(type) ||
      (allowNumericString && new Set(['numeric', 'int2', 'int4', 'int8']).has(type))
    )
  if (kind === 'number')
    return new Set(['int2', 'int4', 'int8', 'float4', 'float8', 'numeric']).has(type)
  if (kind === 'boolean') return type === 'bool'
  if (kind === 'graphite' || kind === 'instant')
    return new Set(['timestamp', 'timestamptz']).has(type)
  if (kind === 'local-date') return type === 'date'
  if (kind === 'duration') return new Set(['text', 'varchar', 'bpchar', 'citext']).has(type)
  return false
}

function numberVersion(value: unknown, type: string, id: string): number {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new PersistenceError(
      `Mapped model ${type}/${id} returned an invalid optimistic-concurrency version.`,
    )
  }
  return version
}

function durableContext(context: ExecutionContext): DurableExecutionEnvelope {
  return {
    executionId: context.executionId,
    correlationId: context.correlationId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
    actor: { ...context.actor },
    initiator: { ...context.initiator },
    ...(context.tenant ? { tenant: { ...context.tenant } } : {}),
    ...(context.delegation.length > 0
      ? {
          delegation: context.delegation.map((hop) => ({
            from: { ...hop.from },
            to: { ...hop.to },
            grantId: hop.grantId,
            reason: hop.reason,
            ...(hop.expiresAt ? { expiresAt: hop.expiresAt.toString() } : {}),
          })),
        }
      : {}),
    ...(context.trace.traceId || context.trace.spanId ? { trace: { ...context.trace } } : {}),
  }
}

function deliveryContext(context: ExecutionContext): DurableExecutionEnvelope {
  return {
    ...durableContext(context),
    delegation: context.delegation.map((hop) => ({
      from: { ...hop.from },
      to: { ...hop.to },
      grantId: hop.grantId,
      reason: hop.reason,
      ...(hop.expiresAt ? { expiresAt: hop.expiresAt.toString() } : {}),
    })),
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
  }
}

function translatePersistenceError(error: unknown): unknown {
  if (error instanceof PersistenceError) return error
  return postgresDriverFailure(error)
    ? new PersistenceError('PostgreSQL persistence operation failed.', { cause: error })
    : error
}

function translatePostgresOperationError(error: unknown): PersistenceError {
  return error instanceof PersistenceError
    ? error
    : new PersistenceError('PostgreSQL persistence operation failed.', { cause: error })
}

/** @internal Exported only for adapter regression tests; not part of the package entry point. */
export function transactionFailure(
  error: unknown,
  workFailure: { readonly error: unknown } | undefined,
): unknown {
  if (workFailure) return translatePersistenceError(workFailure.error)
  return translatePostgresOperationError(error)
}

/** @internal Creates a vendor error without exposing its type through the package boundary. */
export function drizzleDriverFailureForTesting(cause: Error): Error {
  return new DrizzleQueryError('select 1', [], cause)
}

function postgresCode(error: unknown): string | undefined {
  return postgresError(error)?.code
}

function postgresError(error: unknown): DatabaseError | undefined {
  return findError(
    error,
    (candidate): candidate is DatabaseError => candidate instanceof DatabaseError,
  )
}

function postgresDriverFailure(error: unknown): Error | undefined {
  if (error instanceof DatabaseError) return error
  return error instanceof DrizzleQueryError ? error : undefined
}

function findError<ErrorType>(
  error: unknown,
  predicate: (candidate: unknown) => candidate is ErrorType,
): ErrorType | undefined {
  const visited = new Set<unknown>()
  const remaining: unknown[] = [error]
  while (remaining.length > 0) {
    const current = remaining.pop()
    if (typeof current !== 'object' || current === null || visited.has(current)) continue
    visited.add(current)
    if (predicate(current)) return current
    if (current instanceof AggregateError) remaining.push(...current.errors)
    if ('cause' in current) remaining.push(current.cause)
  }
  return undefined
}
