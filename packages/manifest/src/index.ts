export const MANIFEST_FORMAT_VERSION = 9 as const

export type Scope = 'singleton' | 'execution' | 'transient'

export interface SourceProvenance {
  readonly file: string
  readonly line: number
  readonly column: number
}

export interface ApplicationManifestEntry {
  readonly id: string
  readonly name: string
  readonly source: SourceProvenance
}

export interface FeatureManifestEntry {
  readonly id: string
  readonly name: string
  readonly source: SourceProvenance
}

export interface PluginManifestEntry {
  readonly id: string
  readonly package: string
  readonly source: SourceProvenance
}

export type ConfigurationValueKind =
  'string' | 'number' | 'boolean' | 'literal-union' | 'secret-string'

export type ConfigurationDefault = string | number | boolean

export interface ConfigurationPropertyManifest {
  readonly name: string
  readonly environmentKey: string
  readonly kind: ConfigurationValueKind
  readonly allowedValues?: readonly ConfigurationDefault[]
  readonly optional: boolean
  readonly sensitive: boolean
  readonly defaultValue?: ConfigurationDefault
  readonly source: SourceProvenance
}

export interface ConfigurationManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly source: SourceProvenance
  readonly properties: readonly ConfigurationPropertyManifest[]
}

export interface DependencyManifestEntry {
  readonly kind: 'constructor' | 'role'
  readonly parameter: string
  readonly token: string
  readonly targetId?: string
  readonly optional: boolean
  readonly source: SourceProvenance
}

export interface LifecycleManifestEntry {
  readonly start: boolean
  readonly drain: boolean
  readonly stop: boolean
  readonly dispose: boolean
}

export interface ProviderManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly role: 'provider' | 'service'
  readonly scope: Scope
  readonly durableIdentity: boolean
  readonly capabilities: readonly (
    | 'authentication'
    | 'queues'
    | 'transactions'
    | 'cache'
    | 'mail'
    | 'sms'
    | 'broadcasting'
    | 'telemetry'
    | 'observations'
  )[]
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface OperationManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly role: 'action' | 'query'
  readonly scope: 'transient'
  readonly transactional: boolean
  readonly access: 'public' | string
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface ModelManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly entityType: string
  readonly attributes: readonly string[]
  readonly attributeTypes: Readonly<
    Record<
      string,
      {
        readonly kind:
          | 'string'
          | 'number'
          | 'boolean'
          | 'graphite'
          | 'instant'
          | 'local-date'
          | 'duration'
          | 'json'
        readonly nullable: boolean
        readonly optional: boolean
      }
    >
  >
  readonly relationships: readonly ModelRelationshipManifest[]
  readonly storage:
    | { readonly kind: 'entity-state' }
    | {
        readonly kind: 'table'
        readonly table: string
        readonly primaryKey: string
        readonly columns: Readonly<Record<string, string>>
        readonly attributeTypes: ModelManifestEntry['attributeTypes']
        readonly optionalAttributes?: readonly string[]
        readonly versionColumn?: string
        readonly versionSource:
          | { readonly kind: 'column'; readonly column: string }
          | { readonly kind: 'xmin' }
          | { readonly kind: 'none' }
        readonly timestamps: false | { readonly createdAt: string; readonly updatedAt: string }
        readonly managed: boolean
        readonly readOnly: boolean
      }
  readonly source: SourceProvenance
}

export type AuthenticationEligibilityPredicate =
  | { readonly column: string; readonly equals: string | number | boolean | null }
  | { readonly column: string; readonly in: readonly (string | number | boolean | null)[] }
  | { readonly column: string; readonly null: true }
  | { readonly column: string; readonly notNull: true }

export interface AuthenticationManifestEntry {
  readonly mode: 'doxa-owned' | 'managed' | 'login-only'
  readonly source: 'doxa-owned' | 'model' | 'table'
  readonly modelId?: string
  readonly table: string
  readonly columns: {
    readonly id: string
    readonly identifier: string
    readonly contactEmail?: string
    readonly createdAt: string
    readonly updatedAt: string
  }
  readonly attributes?: {
    readonly identifier: string
    readonly contactEmail?: string
    readonly createdAt: string
    readonly updatedAt: string
    readonly verification?: string
  }
  readonly identifier: {
    readonly kind: 'email' | 'username' | 'custom'
    readonly normalization:
      | { readonly preset: 'exact' | 'lowercase' | 'email' }
      | { readonly preset: 'email-or-domain'; readonly domain: string }
  }
  readonly verification:
    | { readonly mode: 'mapped'; readonly column: string }
    | { readonly mode: 'trusted' }
    | { readonly mode: 'unsupported' }
  readonly eligibility: readonly AuthenticationEligibilityPredicate[]
  readonly credentials: {
    readonly table: string
    readonly identityId: string
    readonly password: string
    readonly readers: readonly {
      readonly preset: 'doxa-argon2id' | 'bcrypt' | 'argon2id-phc' | 'sha256-hex'
      readonly hash: string
    }[]
    readonly upgrade:
      | { readonly mode: 'never' }
      | {
          readonly mode: 'in-place'
          readonly format: 'doxa-argon2id'
          readonly password: string
          readonly updatedAt?: string
        }
  }
  readonly registrationFactoryId?: string
  readonly routes: {
    readonly registration: boolean
    readonly verification: boolean
    readonly recovery: boolean
    readonly passwordChange: boolean
  }
}

export type ModelRelationshipManifest =
  | {
      readonly name: string
      readonly kind: 'belongsTo'
      readonly relatedModelId: string
      readonly foreignKey: string
      readonly ownerKey: string
    }
  | {
      readonly name: string
      readonly kind: 'hasOne' | 'hasMany'
      readonly relatedModelId: string
      readonly localKey: string
      readonly foreignKey: string
    }
  | {
      readonly name: string
      readonly kind: 'belongsToMany'
      readonly relatedModelId: string
      readonly throughModelId: string
      readonly localKey: string
      readonly relatedKey: string
      readonly foreignKey: string
      readonly relatedForeignKey: string
    }

export type ModelObserverPhase =
  'retrieved' | 'saving' | 'creating' | 'updating' | 'created' | 'updated' | 'saved' | 'committed'

export interface ObserverManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly modelId: string
  readonly phases: readonly ModelObserverPhase[]
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface RouteManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly method: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT'
  readonly path: string
  readonly access: 'public' | string
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface EventManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly payloadVersion: number
  readonly dispatch: 'immediate' | 'after-commit'
  readonly broadcast: false | 'queued' | 'now'
  readonly domain: false | { readonly entityType: string }
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
}

export interface ListenerManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly eventId: string
  readonly delivery: 'local' | 'after-commit' | 'queued' | 'queued-after-commit'
  readonly access: 'public' | string
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface JobManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly scope: 'transient'
  readonly retries: number
  readonly retryDelay: number
  readonly backoff: boolean
  readonly timeout: number
  readonly access: 'public' | string
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface ScheduleManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly jobId: string
  readonly cadence:
    | { readonly kind: 'cron'; readonly expression: string }
    | { readonly kind: 'interval'; readonly seconds: number }
  readonly timeZone: string
  readonly overlap: 'allow' | 'serialize'
  readonly misfire: 'skip' | 'catch-up-once'
  readonly input: unknown
  readonly access: 'public' | string
  readonly source: SourceProvenance
}

export interface PolicyManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly scope: 'transient'
  readonly abilities: readonly string[]
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface PermissionSourceManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly scope: 'execution'
  readonly abilities: readonly string[]
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface SignalManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
}

export interface SignalHandlerManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly signalId: string
  readonly access: 'public' | string
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface CommandManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly command: string
  readonly description: string
  readonly access: 'public' | string
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface RealtimeCommandManifestEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly exportName: string
  readonly command: string
  readonly access: string
  readonly throttle: { readonly limit: number; readonly windowMs: number }
  readonly timeoutMs: number
  readonly scope: 'transient'
  readonly source: SourceProvenance
  readonly dependencies: readonly DependencyManifestEntry[]
  readonly lifecycle: LifecycleManifestEntry
}

export interface DoxaManifest {
  readonly formatVersion: typeof MANIFEST_FORMAT_VERSION
  readonly applicationId: string
  readonly frameworkVersion: string
  readonly compilerVersion: string
  readonly buildHash: string
  readonly application: ApplicationManifestEntry
  readonly time: { readonly timeZone: string; readonly locale: string }
  readonly authentication: AuthenticationManifestEntry
  readonly plugins: readonly PluginManifestEntry[]
  readonly features: readonly FeatureManifestEntry[]
  readonly configurations: readonly ConfigurationManifestEntry[]
  readonly providers: readonly ProviderManifestEntry[]
  readonly actions: readonly OperationManifestEntry[]
  readonly queries: readonly OperationManifestEntry[]
  readonly models: readonly ModelManifestEntry[]
  readonly observers: readonly ObserverManifestEntry[]
  readonly routes: readonly RouteManifestEntry[]
  readonly events: readonly EventManifestEntry[]
  readonly listeners: readonly ListenerManifestEntry[]
  readonly jobs: readonly JobManifestEntry[]
  readonly schedules: readonly ScheduleManifestEntry[]
  readonly policies: readonly PolicyManifestEntry[]
  readonly permissionSource: PermissionSourceManifestEntry | null
  readonly signals: readonly SignalManifestEntry[]
  readonly signalHandlers: readonly SignalHandlerManifestEntry[]
  readonly commands: readonly CommandManifestEntry[]
  readonly realtimeCommands: readonly RealtimeCommandManifestEntry[]
}

export interface RegistryModule {
  readonly formatVersion: number
  readonly buildHash: string
  readonly constructors: Readonly<Record<string, new (...dependencies: unknown[]) => object>>
}

export class ManifestCompatibilityError extends Error {
  override readonly name = 'ManifestCompatibilityError'
}

/** One canonical representation shared by artifact producers and consumers. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonicalValue(value), null, 2)
}

export function assertManifest(value: unknown): asserts value is DoxaManifest {
  if (!isRecord(value)) {
    throw new ManifestCompatibilityError('Doxa manifest must be a JSON object.')
  }

  if (value.formatVersion !== MANIFEST_FORMAT_VERSION) {
    throw new ManifestCompatibilityError(
      `Unsupported Doxa manifest format ${String(value.formatVersion)}; expected ${MANIFEST_FORMAT_VERSION}. Run doxa build to rebuild the application artifacts.`,
    )
  }

  for (const field of [
    'applicationId',
    'frameworkVersion',
    'compilerVersion',
    'buildHash',
  ] as const) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new ManifestCompatibilityError(
        `Doxa manifest field ${field} must be a non-empty string.`,
      )
    }
  }

  if (
    !isRecord(value.application) ||
    !isRecord(value.time) ||
    !isRecord(value.authentication) ||
    !Array.isArray(value.plugins) ||
    !Array.isArray(value.features) ||
    !Array.isArray(value.configurations) ||
    !Array.isArray(value.providers) ||
    !Array.isArray(value.actions) ||
    !Array.isArray(value.queries) ||
    !Array.isArray(value.models) ||
    !Array.isArray(value.observers) ||
    !Array.isArray(value.routes) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.listeners) ||
    !Array.isArray(value.jobs) ||
    !Array.isArray(value.schedules) ||
    !Array.isArray(value.policies) ||
    (value.permissionSource !== null && !isRecord(value.permissionSource)) ||
    !Array.isArray(value.signals) ||
    !Array.isArray(value.signalHandlers) ||
    !Array.isArray(value.commands) ||
    !Array.isArray(value.realtimeCommands)
  ) {
    throw new ManifestCompatibilityError('Doxa manifest is missing required graph sections.')
  }

  if (!validManifestTime(value.time)) {
    throw new ManifestCompatibilityError('Doxa manifest has invalid time defaults.')
  }

  assertManifestEntry(value.application, 'application')
  assertAuthenticationManifest(value.authentication)
  if (value.permissionSource) {
    assertManifestEntry(value.permissionSource, 'permissionSource')
    if (
      !value.permissionSource.id.startsWith('permission-source:') ||
      !nonEmptyString(value.permissionSource.ownerId) ||
      !nonEmptyString(value.permissionSource.name) ||
      !nonEmptyString(value.permissionSource.exportName) ||
      value.permissionSource.scope !== 'execution' ||
      !Array.isArray(value.permissionSource.abilities) ||
      value.permissionSource.abilities.length === 0 ||
      !value.permissionSource.abilities.every(validAbility) ||
      new Set(value.permissionSource.abilities).size !== value.permissionSource.abilities.length ||
      !Array.isArray(value.permissionSource.dependencies) ||
      !value.permissionSource.dependencies.every(validDependency) ||
      !validLifecycle(value.permissionSource.lifecycle)
    ) {
      throw new ManifestCompatibilityError(
        `Doxa manifest permission source ${value.permissionSource.id} is invalid.`,
      )
    }
  }
  for (const [section, entries] of Object.entries({
    plugins: value.plugins,
    features: value.features,
    configurations: value.configurations,
    providers: value.providers,
    actions: value.actions,
    queries: value.queries,
    models: value.models,
    observers: value.observers,
    routes: value.routes,
    events: value.events,
    listeners: value.listeners,
    jobs: value.jobs,
    schedules: value.schedules,
    policies: value.policies,
    signals: value.signals,
    signalHandlers: value.signalHandlers,
    commands: value.commands,
    realtimeCommands: value.realtimeCommands,
  })) {
    for (const entry of entries) assertManifestEntry(entry, section)
  }
  for (const command of value.realtimeCommands) {
    if (
      !isRecord(command) ||
      !nonEmptyString(command.id) ||
      !command.id.startsWith('realtime-command:') ||
      !nonEmptyString(command.ownerId) ||
      !nonEmptyString(command.name) ||
      !nonEmptyString(command.exportName) ||
      !validAbility(command.command) ||
      command.id !== `realtime-command:${command.ownerId}/${command.command}` ||
      !validAbility(command.access) ||
      command.access === 'public' ||
      command.scope !== 'transient' ||
      !isRecord(command.throttle) ||
      !positiveInteger(command.throttle.limit) ||
      !positiveInteger(command.throttle.windowMs) ||
      !positiveInteger(command.timeoutMs) ||
      command.timeoutMs > 10_000 ||
      !Array.isArray(command.dependencies) ||
      !command.dependencies.every(validDependency) ||
      !validLifecycle(command.lifecycle)
    ) {
      throw new ManifestCompatibilityError(
        `Doxa manifest realtime command ${String(command.id)} is invalid.`,
      )
    }
  }
  for (const model of value.models) {
    if (
      !Array.isArray(model.attributes) ||
      !model.attributes.every(nonEmptyString) ||
      new Set(model.attributes).size !== model.attributes.length
    ) {
      throw new ManifestCompatibilityError(
        `Doxa manifest model ${model.id} has invalid attributes.`,
      )
    }
    if (
      !isRecord(model.attributeTypes) ||
      Object.keys(model.attributeTypes).length !== model.attributes.length ||
      (model.attributes as unknown[]).some((attribute: unknown) => {
        if (typeof attribute !== 'string') return true
        const contract = model.attributeTypes[attribute]
        return (
          !isRecord(contract) ||
          ![
            'string',
            'number',
            'boolean',
            'graphite',
            'instant',
            'local-date',
            'duration',
            'json',
          ].includes(String(contract.kind)) ||
          typeof contract.nullable !== 'boolean' ||
          typeof contract.optional !== 'boolean'
        )
      })
    ) {
      throw new ManifestCompatibilityError(
        `Doxa manifest model ${model.id} has invalid attribute type contracts.`,
      )
    }
    if (!Array.isArray(model.relationships)) {
      throw new ManifestCompatibilityError(
        `Doxa manifest model ${model.id} has invalid relationships.`,
      )
    }
    if (
      !isRecord(model.storage) ||
      (model.storage.kind !== 'entity-state' && model.storage.kind !== 'table')
    ) {
      throw new ManifestCompatibilityError(`Doxa manifest model ${model.id} has invalid storage.`)
    }
    if (
      model.storage.kind === 'table' &&
      (!nonEmptyString(model.storage.table) ||
        !nonEmptyString(model.storage.primaryKey) ||
        typeof model.storage.managed !== 'boolean' ||
        typeof model.storage.readOnly !== 'boolean' ||
        !isRecord(model.storage.columns) ||
        !isRecord(model.storage.attributeTypes) ||
        Object.keys(model.storage.columns).length !== model.attributes.length ||
        Object.keys(model.storage.attributeTypes).length !== model.attributes.length ||
        new Set(Object.values(model.storage.columns)).size !== model.attributes.length ||
        model.storage.columns.id !== model.storage.primaryKey ||
        (model.storage.versionColumn !== undefined &&
          !nonEmptyString(model.storage.versionColumn)) ||
        !validModelVersionSource(model.storage) ||
        (model.storage.timestamps !== false &&
          (!isRecord(model.storage.timestamps) ||
            !nonEmptyString(model.storage.timestamps.createdAt) ||
            !nonEmptyString(model.storage.timestamps.updatedAt))) ||
        (model.attributes as unknown[]).some((attribute: unknown) => {
          if (typeof attribute !== 'string' || !nonEmptyString(model.storage.columns[attribute]))
            return true
          const topLevel = model.attributeTypes[attribute]
          const storageContract = model.storage.attributeTypes[attribute]
          return (
            !isRecord(topLevel) ||
            !isRecord(storageContract) ||
            storageContract.kind !== topLevel.kind ||
            storageContract.nullable !== topLevel.nullable ||
            storageContract.optional !== topLevel.optional
          )
        }))
    ) {
      throw new ManifestCompatibilityError(
        `Doxa manifest model ${model.id} has an invalid table projection contract.`,
      )
    }
    if (model.storage.kind === 'table' && model.storage.optionalAttributes !== undefined) {
      const optionalAttributes = model.storage.optionalAttributes
      if (
        !Array.isArray(optionalAttributes) ||
        !optionalAttributes.every(nonEmptyString) ||
        new Set(optionalAttributes).size !== optionalAttributes.length ||
        optionalAttributes.some(
          (attribute) => attribute === 'id' || !model.attributes.includes(attribute),
        ) ||
        model.attributes.some(
          (attribute: string) =>
            Boolean(model.attributeTypes[attribute]?.optional) !==
            optionalAttributes.includes(attribute),
        )
      ) {
        throw new ManifestCompatibilityError(
          `Doxa manifest model ${model.id} has invalid optional attributes.`,
        )
      }
    } else if (
      model.storage.kind === 'table' &&
      model.attributes.some((attribute: string) => model.attributeTypes[attribute]?.optional)
    ) {
      throw new ManifestCompatibilityError(
        `Doxa manifest model ${model.id} has invalid optional attributes.`,
      )
    }
    for (const relationship of model.relationships) {
      if (
        !isRecord(relationship) ||
        !nonEmptyString(relationship.name) ||
        !nonEmptyString(relationship.kind) ||
        !nonEmptyString(relationship.relatedModelId)
      ) {
        throw new ManifestCompatibilityError(
          `Doxa manifest model ${model.id} has an invalid relationship.`,
        )
      }
      assertModelRelationship(model.id, relationship)
    }
  }
}

function validManifestTime(value: Record<string, unknown>): boolean {
  if (!nonEmptyString(value.timeZone) || !nonEmptyString(value.locale)) return false
  try {
    const timeZone = new Intl.DateTimeFormat('en-US', {
      timeZone: value.timeZone,
    }).resolvedOptions().timeZone
    const locale = Intl.getCanonicalLocales(value.locale)[0]
    return timeZone === value.timeZone && locale === value.locale
  } catch {
    return false
  }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function assertAuthenticationManifest(value: Record<string, unknown>): void {
  if (
    !['doxa-owned', 'managed', 'login-only'].includes(String(value.mode)) ||
    !['doxa-owned', 'model', 'table'].includes(String(value.source)) ||
    !nonEmptyString(value.table) ||
    !isRecord(value.columns) ||
    !nonEmptyString(value.columns.id) ||
    !nonEmptyString(value.columns.identifier) ||
    !nonEmptyString(value.columns.createdAt) ||
    !nonEmptyString(value.columns.updatedAt) ||
    !isRecord(value.identifier) ||
    !['email', 'username', 'custom'].includes(String(value.identifier.kind)) ||
    !isRecord(value.identifier.normalization) ||
    !['exact', 'lowercase', 'email', 'email-or-domain'].includes(
      String(value.identifier.normalization.preset),
    ) ||
    !isRecord(value.verification) ||
    !['mapped', 'trusted', 'unsupported'].includes(String(value.verification.mode)) ||
    !Array.isArray(value.eligibility) ||
    !isRecord(value.credentials) ||
    !nonEmptyString(value.credentials.table) ||
    !nonEmptyString(value.credentials.identityId) ||
    !nonEmptyString(value.credentials.password) ||
    !Array.isArray(value.credentials.readers) ||
    value.credentials.readers.length === 0 ||
    !isRecord(value.credentials.upgrade) ||
    !isRecord(value.routes)
  ) {
    throw new ManifestCompatibilityError('Doxa manifest authentication contract is invalid.')
  }
  for (const reader of value.credentials.readers) {
    if (
      !isRecord(reader) ||
      !['doxa-argon2id', 'bcrypt', 'argon2id-phc', 'sha256-hex'].includes(String(reader.preset)) ||
      !nonEmptyString(reader.hash) ||
      reader.hash !== value.credentials.password
    ) {
      throw new ManifestCompatibilityError('Doxa manifest credential reader is invalid.')
    }
  }
  if (
    !['never', 'in-place'].includes(String(value.credentials.upgrade.mode)) ||
    (value.credentials.upgrade.mode === 'in-place' &&
      (value.credentials.upgrade.format !== 'doxa-argon2id' ||
        value.credentials.upgrade.password !== value.credentials.password ||
        (value.credentials.upgrade.updatedAt !== undefined &&
          !nonEmptyString(value.credentials.upgrade.updatedAt)) ||
        !value.credentials.readers.some(
          (reader) => isRecord(reader) && reader.preset === 'doxa-argon2id',
        )))
  ) {
    throw new ManifestCompatibilityError('Doxa manifest credential upgrade policy is invalid.')
  }
  if (
    value.mode === 'login-only' &&
    Object.values(value.routes).some((enabled) => enabled === true)
  ) {
    throw new ManifestCompatibilityError(
      'Login-only authentication cannot expose credential mutation routes.',
    )
  }
  if (value.verification.mode === 'mapped' && !nonEmptyString(value.verification.column)) {
    throw new ManifestCompatibilityError('Mapped verification requires a physical column.')
  }
  if (
    value.identifier.normalization.preset === 'email-or-domain' &&
    !nonEmptyString(value.identifier.normalization.domain)
  ) {
    throw new ManifestCompatibilityError('Email domain normalization requires a domain.')
  }
}

function assertManifestEntry(
  value: unknown,
  section: string,
): asserts value is Record<string, unknown> & { readonly id: string } {
  if (!isRecord(value) || !nonEmptyString(value.id)) {
    throw new ManifestCompatibilityError(`Doxa manifest ${section} entry must have a stable ID.`)
  }
  const source = value.source
  if (
    !isRecord(source) ||
    !nonEmptyString(source.file) ||
    !Number.isInteger(source.line) ||
    !Number.isInteger(source.column)
  ) {
    throw new ManifestCompatibilityError(
      `Doxa manifest ${section} entry ${value.id} has invalid source provenance.`,
    )
  }
}

function assertModelRelationship(modelId: string, value: Record<string, unknown>): void {
  const keys =
    value.kind === 'belongsTo'
      ? ['foreignKey', 'ownerKey']
      : value.kind === 'hasOne' || value.kind === 'hasMany'
        ? ['localKey', 'foreignKey']
        : value.kind === 'belongsToMany'
          ? ['throughModelId', 'localKey', 'relatedKey', 'foreignKey', 'relatedForeignKey']
          : undefined
  if (!keys || !keys.every((key) => nonEmptyString(value[key]))) {
    throw new ManifestCompatibilityError(
      `Doxa manifest model ${modelId} has an invalid ${String(value.kind)} relationship.`,
    )
  }
}

function validModelVersionSource(storage: Record<string, unknown>): boolean {
  const source = storage.versionSource
  if (!isRecord(source)) return false
  if (source.kind === 'column') {
    return nonEmptyString(source.column) && storage.versionColumn === source.column
  }
  if (source.kind === 'xmin') {
    return storage.versionColumn === undefined && storage.readOnly === false
  }
  return source.kind === 'none' && storage.versionColumn === undefined && storage.readOnly === true
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function validAbility(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9._:-]{1,127}$/.test(value)
}

function validDependency(value: unknown): boolean {
  return Boolean(
    isRecord(value) &&
    (value.kind === 'constructor' || value.kind === 'role') &&
    nonEmptyString(value.parameter) &&
    nonEmptyString(value.token) &&
    (value.targetId === undefined || nonEmptyString(value.targetId)) &&
    typeof value.optional === 'boolean' &&
    isRecord(value.source) &&
    nonEmptyString(value.source.file) &&
    Number.isInteger(value.source.line) &&
    Number.isInteger(value.source.column),
  )
}

function validLifecycle(value: unknown): boolean {
  return Boolean(
    isRecord(value) &&
    typeof value.start === 'boolean' &&
    typeof value.drain === 'boolean' &&
    typeof value.stop === 'boolean' &&
    typeof value.dispose === 'boolean',
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortCanonicalValue(nested)]),
  )
}
