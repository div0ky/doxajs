import { createHash } from 'node:crypto'

import {
  assertManifest,
  canonicalJson,
  type DoxaManifest,
  type ModelManifestEntry,
} from '@doxajs/manifest'

export const INTROSPECTION_SCHEMA_VERSION = 2 as const
export const GNOSIS_KNOWLEDGE_SCHEMA_VERSION = 3 as const
export const MAX_INSPECTION_RESULTS = 100
export const MAX_INSPECTION_OBJECT_PROPERTIES = 100

export type InspectionSurface =
  | 'actions'
  | 'commands'
  | 'realtimeCommands'
  | 'events'
  | 'jobs'
  | 'listeners'
  | 'models'
  | 'observers'
  | 'permissionSources'
  | 'policies'
  | 'providers'
  | 'queries'
  | 'routes'
  | 'schedules'
  | 'services'

export type IntrospectionErrorCode =
  'invalid_manifest' | 'stale_manifest' | 'not_found' | 'invalid_input'

export class IntrospectionError extends Error {
  override readonly name = 'IntrospectionError'

  constructor(
    readonly code: IntrospectionErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface ApplicationInfo {
  readonly schemaVersion: typeof INTROSPECTION_SCHEMA_VERSION
  readonly applicationId: string
  readonly frameworkVersion: string
  readonly compilerVersion: string
  readonly manifestFormatVersion: number
  readonly buildHash: string
  readonly time: { readonly timeZone: string; readonly locale: string }
  readonly plugins: readonly string[]
}

export interface GraphInspection {
  readonly schemaVersion: typeof INTROSPECTION_SCHEMA_VERSION
  readonly applicationId: string
  readonly buildHash: string
  readonly counts: Readonly<Record<string, number>>
}

export interface BoundedInspection<T> {
  readonly items: readonly T[]
  readonly total: number
  readonly truncated: boolean
}

export type ArchitectureDiagnosticCode =
  | 'DOXA-GNOSIS-STRUCTURE-001'
  | 'DOXA-GNOSIS-STRUCTURE-002'
  | 'DOXA-GNOSIS-STRUCTURE-003'
  | 'DOXA-GNOSIS-STRUCTURE-004'
  | 'DOXA-GNOSIS-STRUCTURE-005'

export interface ArchitectureDiagnostic {
  readonly code: ArchitectureDiagnosticCode
  readonly severity: 'warning'
  readonly componentId: string
  readonly message: string
  readonly guideId: 'diagnostic.provider-service-location' | 'diagnostic.canonical-folder'
  readonly source: Readonly<{
    readonly file: string
    readonly line: number
    readonly column: number
  }>
}

export type ComponentKind =
  | 'action'
  | 'command'
  | 'realtime-command'
  | 'configuration'
  | 'event'
  | 'job'
  | 'listener'
  | 'model'
  | 'observer'
  | 'permission-source'
  | 'policy'
  | 'provider'
  | 'query'
  | 'route'
  | 'schedule'
  | 'service'
  | 'signal'
  | 'signal-handler'

export interface ComponentExplanation {
  readonly schemaVersion: typeof INTROSPECTION_SCHEMA_VERSION
  readonly id: string
  readonly kind: ComponentKind
  readonly ownerId: string
  readonly name: string
  readonly source: Readonly<{
    readonly file: string
    readonly line: number
    readonly column: number
  }>
  readonly component: Readonly<Record<string, unknown>>
  readonly dependencies: readonly Readonly<Record<string, unknown>>[]
  readonly consumers: readonly string[]
  readonly transaction: Readonly<{
    readonly mode:
      'owns-writable' | 'owns-read-only' | 'joins-caller' | 'delivery-dependent' | 'none'
    readonly description: string
  }>
  readonly canonicalFolder: string
  readonly guideIds: readonly string[]
  readonly diagnostics: readonly ArchitectureDiagnostic[]
}

export interface GnosisKnowledge {
  readonly schemaVersion: typeof GNOSIS_KNOWLEDGE_SCHEMA_VERSION
  readonly framework: 'Doxa'
  readonly applicationId: string
  readonly buildHash: string
  readonly application: ApplicationInfo
  readonly graph: GraphInspection
  readonly principles: readonly string[]
  readonly conventions: Readonly<Record<string, string>>
  readonly roles: Readonly<Record<string, unknown>>
  readonly providers: BoundedInspection<Readonly<Record<string, unknown>>>
  readonly services: BoundedInspection<Readonly<Record<string, unknown>>>
  readonly diagnostics: BoundedInspection<ArchitectureDiagnostic>
  readonly theoria: Readonly<Record<string, unknown>>
  readonly deployment: Readonly<Record<string, unknown>>
  readonly praxis: Readonly<Record<string, readonly string[]>>
}

const surfaces: Readonly<Record<InspectionSurface, keyof DoxaManifest>> = {
  actions: 'actions',
  commands: 'commands',
  realtimeCommands: 'realtimeCommands',
  events: 'events',
  jobs: 'jobs',
  listeners: 'listeners',
  models: 'models',
  observers: 'observers',
  permissionSources: 'permissionSource',
  policies: 'policies',
  providers: 'providers',
  queries: 'queries',
  routes: 'routes',
  schedules: 'schedules',
  services: 'providers',
}

const graphSections = [
  'features',
  'configurations',
  'providers',
  'models',
  'observers',
  'actions',
  'queries',
  'routes',
  'events',
  'listeners',
  'signals',
  'signalHandlers',
  'jobs',
  'schedules',
  'policies',
  'permissionSource',
  'commands',
  'realtimeCommands',
] as const satisfies readonly (keyof DoxaManifest)[]

export function assertCurrentManifest(value: unknown): asserts value is DoxaManifest {
  try {
    assertManifest(value)
  } catch (error) {
    throw new IntrospectionError('invalid_manifest', safeErrorMessage(error))
  }
  const { buildHash, ...semanticManifest } = value
  const actual = createHash('sha256').update(canonicalJson(semanticManifest)).digest('hex')
  if (actual !== buildHash) {
    throw new IntrospectionError(
      'stale_manifest',
      'The Doxa manifest content does not match its build hash. Run doxa build again.',
    )
  }
}

export function applicationInfo(manifest: DoxaManifest): ApplicationInfo {
  assertCurrentManifest(manifest)
  return Object.freeze({
    schemaVersion: INTROSPECTION_SCHEMA_VERSION,
    applicationId: manifest.applicationId,
    frameworkVersion: manifest.frameworkVersion,
    compilerVersion: manifest.compilerVersion,
    manifestFormatVersion: manifest.formatVersion,
    buildHash: manifest.buildHash,
    time: Object.freeze({ ...manifest.time }),
    plugins: Object.freeze(manifest.plugins.map((plugin) => plugin.package).sort()),
  })
}

export function inspectGraph(manifest: DoxaManifest): GraphInspection {
  assertCurrentManifest(manifest)
  return Object.freeze({
    schemaVersion: INTROSPECTION_SCHEMA_VERSION,
    applicationId: manifest.applicationId,
    buildHash: manifest.buildHash,
    counts: Object.freeze(
      Object.fromEntries(
        graphSections.map((section) => [
          section,
          Array.isArray(manifest[section])
            ? manifest[section].length
            : manifest[section] === null
              ? 0
              : 1,
        ]),
      ),
    ),
  })
}

export function inspectSurface(
  manifest: DoxaManifest,
  surface: InspectionSurface,
): BoundedInspection<Readonly<Record<string, unknown>>> {
  assertCurrentManifest(manifest)
  const section = manifest[surfaces[surface]]
  const entries = (
    Array.isArray(section) ? section : section === null ? [] : [section]
  ) as readonly unknown[]
  const filtered =
    surface === 'providers' || surface === 'services'
      ? entries.filter(
          (entry) =>
            isRecord(entry) && entry.role === (surface === 'providers' ? 'provider' : 'service'),
        )
      : entries
  const items = filtered
    .map((entry) => sanitizeInspectionValue(entry) as Readonly<Record<string, unknown>>)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .slice(0, MAX_INSPECTION_RESULTS)
  return Object.freeze({
    items: Object.freeze(items),
    total: filtered.length,
    truncated: filtered.length > items.length,
  })
}

export function inspectArchitectureDiagnostics(
  manifest: DoxaManifest,
): BoundedInspection<ArchitectureDiagnostic> {
  assertCurrentManifest(manifest)
  const diagnostics = componentEntries(manifest)
    .flatMap(({ kind, entry }) => componentDiagnostics(kind, entry))
    .sort(
      (left, right) =>
        left.componentId.localeCompare(right.componentId) || left.code.localeCompare(right.code),
    )
  const items = diagnostics.slice(0, MAX_INSPECTION_RESULTS)
  return Object.freeze({
    items: Object.freeze(items),
    total: diagnostics.length,
    truncated: diagnostics.length > items.length,
  })
}

export function explainComponent(manifest: DoxaManifest, id: string): ComponentExplanation {
  assertCurrentManifest(manifest)
  if (id.length === 0 || id.length > 256) {
    throw new IntrospectionError(
      'invalid_input',
      'Component ID must contain 1 through 256 characters.',
    )
  }
  const components = componentEntries(manifest)
  const selected = components.find((component) => component.entry.id === id)
  if (!selected) throw new IntrospectionError('not_found', `Component ${id} is not declared.`)
  const dependencies = Array.isArray(selected.entry.dependencies) ? selected.entry.dependencies : []
  const consumers = components
    .filter((component) => referencesComponent(component.entry, id))
    .map((component) => component.entry.id)
    .sort()
  const diagnostics = inspectArchitectureDiagnostics(manifest).items.filter(
    (diagnostic) => diagnostic.componentId === id,
  )
  return Object.freeze({
    schemaVersion: INTROSPECTION_SCHEMA_VERSION,
    id,
    kind: selected.kind,
    ownerId: selected.entry.ownerId,
    name: selected.entry.name,
    source: selected.entry.source,
    component: sanitizeInspectionValue(selected.entry) as Readonly<Record<string, unknown>>,
    dependencies: Object.freeze(
      dependencies.map(
        (dependency) => sanitizeInspectionValue(dependency) as Readonly<Record<string, unknown>>,
      ),
    ),
    consumers: Object.freeze(consumers),
    transaction: Object.freeze(transactionFor(selected.kind, selected.entry)),
    canonicalFolder: canonicalFolderFor(selected.kind),
    guideIds: Object.freeze(guideIdsFor(selected.kind)),
    diagnostics: Object.freeze(diagnostics),
  })
}

export function describeModel(manifest: DoxaManifest, id: string): Readonly<ModelManifestEntry> {
  assertCurrentManifest(manifest)
  if (id.length === 0 || id.length > 256) {
    throw new IntrospectionError('invalid_input', 'Model ID must contain 1 through 256 characters.')
  }
  const model = manifest.models.find((entry) => entry.id === id)
  if (!model) throw new IntrospectionError('not_found', `Model ${id} is not declared.`)
  return sanitizeInspectionValue(model) as Readonly<ModelManifestEntry>
}

export function describeAuthentication(manifest: DoxaManifest): Readonly<Record<string, unknown>> {
  assertCurrentManifest(manifest)
  const authentication = manifest.authentication
  return Object.freeze({
    mode: authentication.mode,
    source: authentication.source,
    ...(authentication.modelId ? { modelId: authentication.modelId } : {}),
    table: authentication.table,
    identifier: Object.freeze({
      kind: authentication.identifier.kind,
      field: authentication.columns.identifier,
      normalization: authentication.identifier.normalization,
    }),
    ...(authentication.columns.contactEmail
      ? { contactEmail: authentication.columns.contactEmail }
      : {}),
    verification: authentication.verification,
    eligibility: Object.freeze(
      authentication.eligibility.map((predicate) =>
        Object.freeze({
          column: predicate.column,
          operation:
            'equals' in predicate
              ? 'equals'
              : 'in' in predicate
                ? 'in'
                : 'null' in predicate
                  ? 'null'
                  : 'notNull',
        }),
      ),
    ),
    hashers: Object.freeze(authentication.credentials.readers.map((reader) => reader.preset)),
    credentialOwnership: authentication.source === 'doxa-owned' ? 'doxa' : 'external',
    credentialUpgrade: authentication.credentials.upgrade.mode,
    securityWarnings: Object.freeze(
      authentication.credentials.readers.some((reader) => reader.preset === 'sha256-hex')
        ? [
            'sha256-hex is an unsalted weak credential reader; prefer an explicit in-place Argon2id upgrade where every credential consumer supports it.',
          ]
        : [],
    ),
    routes: authentication.routes,
  })
}

export function safeManifest(manifest: DoxaManifest): Readonly<Record<string, unknown>> {
  assertCurrentManifest(manifest)
  const sanitized = sanitizeInspectionValue(manifest) as Readonly<Record<string, unknown>>
  const truncatedSections = Object.freeze(
    Object.entries(manifest)
      .filter(([, value]) => Array.isArray(value) && value.length > MAX_INSPECTION_RESULTS)
      .map(([section]) => section),
  )
  return Object.freeze({
    ...sanitized,
    _gnosis: Object.freeze({
      arrayLimit: MAX_INSPECTION_RESULTS,
      truncatedSections,
    }),
  })
}

export function createGnosisKnowledge(manifest: DoxaManifest): GnosisKnowledge {
  const info = applicationInfo(manifest)
  const graph = inspectGraph(manifest)
  const hasTheoria = manifest.providers.some((provider) =>
    provider.capabilities.includes('observations'),
  )
  return Object.freeze({
    schemaVersion: GNOSIS_KNOWLEDGE_SCHEMA_VERSION,
    framework: 'Doxa',
    applicationId: manifest.applicationId,
    buildHash: manifest.buildHash,
    application: info,
    graph,
    principles: Object.freeze([
      'Opinionated and magical where safety permits.',
      'Prefer the better developer experience between equally viable choices.',
      'Folder names have no runtime meaning.',
      'Framework roles are explicitly declared by Features and compiled before boot.',
      'Entry points fail closed unless public or owned by a declared policy or permission-source ability.',
      'Constructors are side-effect free; lifecycle owns I/O and background behavior.',
    ]),
    conventions: Object.freeze({
      files: 'kebab-case',
      classes: 'PascalCase',
      featureRegistration: 'role arrays',
      concreteDependencies: 'constructor autowiring',
      applicationCommands: 'doxa <colon-delimited-name>',
      httpResponses: 'return payloads; Doxa owns the success and failure envelope',
      deployment: 'one precompiled immutable image with role-specific commands',
    }),
    roles: Object.freeze(
      Object.fromEntries(
        graphSections.map((role) => [role, sanitizeInspectionValue(manifest[role])]),
      ),
    ),
    providers: inspectSurface(manifest, 'providers'),
    services: inspectSurface(manifest, 'services'),
    diagnostics: inspectArchitectureDiagnostics(manifest),
    theoria: Object.freeze({
      installed: hasTheoria,
      purpose: 'Read-only correlation and causation debugger for framework executions.',
      safety: Object.freeze([
        'recursive secret redaction',
        'bounded PostgreSQL retention',
        'loopback by default; protected audited operator access otherwise',
        'bounded buffered production capture',
        'recording failure isolation',
      ]),
    }),
    deployment: Object.freeze({
      strategy: 'one-immutable-image',
      build: Object.freeze({
        command: 'doxa build',
        phase: 'image-build',
        outputs: Object.freeze(['dist/', '.doxa/']),
        runtimeCompilation: false,
      }),
      roles: Object.freeze({
        web: Object.freeze({ command: 'doxa serve', scalesHorizontally: true }),
        background: Object.freeze({
          command: 'doxa work',
          scalesHorizontally: true,
          admitsSchedules: true,
        }),
        migration: Object.freeze({
          command: 'doxa migrate',
          releaseJob: true,
          automaticOnBoot: false,
        }),
      }),
      advancedIsolation: Object.freeze({
        workerCommand: 'doxa work --without-scheduler',
        schedulerCommand: 'doxa schedule',
        useWhen: 'schedule admission requires independent resources or fault isolation',
      }),
    }),
    praxis: Object.freeze({
      runtime: Object.freeze(['dev', 'serve', 'work', 'work --without-scheduler', 'schedule']),
      inspect: Object.freeze([
        'graph',
        'route:list',
        'model:list',
        'event:list',
        'listener:list',
        'observer:list',
        'job:list',
        'schedule:list',
        'policy:list',
        'command:list',
      ]),
    }),
  })
}

interface ManifestComponent {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly source: Readonly<{
    readonly file: string
    readonly line: number
    readonly column: number
  }>
  readonly dependencies?: readonly Readonly<Record<string, unknown>>[]
  readonly [key: string]: unknown
}

function componentEntries(
  manifest: DoxaManifest,
): readonly { readonly kind: ComponentKind; readonly entry: ManifestComponent }[] {
  const entries: { kind: ComponentKind; entry: ManifestComponent }[] = []
  const add = (kind: ComponentKind, values: readonly unknown[]): void => {
    for (const value of values) entries.push({ kind, entry: value as ManifestComponent })
  }
  add('action', manifest.actions)
  add('command', manifest.commands)
  add('realtime-command', manifest.realtimeCommands)
  add('configuration', manifest.configurations)
  add('event', manifest.events)
  add('job', manifest.jobs)
  add('listener', manifest.listeners)
  add('model', manifest.models)
  add('observer', manifest.observers)
  if (manifest.permissionSource) add('permission-source', [manifest.permissionSource])
  add('policy', manifest.policies)
  add(
    'provider',
    manifest.providers.filter((provider) => provider.role === 'provider'),
  )
  add('query', manifest.queries)
  add('route', manifest.routes)
  add('schedule', manifest.schedules)
  add(
    'service',
    manifest.providers.filter((provider) => provider.role === 'service'),
  )
  add('signal', manifest.signals)
  add('signal-handler', manifest.signalHandlers)
  return entries.sort((left, right) => left.entry.id.localeCompare(right.entry.id))
}

function referencesComponent(entry: ManifestComponent, id: string): boolean {
  if (entry.dependencies?.some((dependency) => dependency.targetId === id)) return true
  for (const field of ['eventId', 'jobId', 'modelId', 'signalId'] as const) {
    if (entry[field] === id) return true
  }
  const relationships = entry.relationships
  return (
    Array.isArray(relationships) &&
    relationships.some(
      (relationship) =>
        isRecord(relationship) &&
        (relationship.relatedModelId === id || relationship.throughModelId === id),
    )
  )
}

function transactionFor(
  kind: ComponentKind,
  entry: ManifestComponent,
): ComponentExplanation['transaction'] {
  if (kind === 'action') {
    return {
      mode: 'owns-writable',
      description: 'The Action owns one writable unit of work and commits or rolls it back.',
    }
  }
  if (kind === 'job') {
    return {
      mode: 'owns-writable',
      description:
        'Each Job attempt owns one fresh writable execution and unit of work; called services join it.',
    }
  }
  if (kind === 'query') {
    return {
      mode: 'owns-read-only',
      description:
        'The Query owns a bounded read-only model session; durable mutation fails closed.',
    }
  }
  if (kind === 'service') {
    return {
      mode: 'joins-caller',
      description:
        'The ordinary service has no transaction of its own and joins the execution and unit of work of its caller.',
    }
  }
  if (kind === 'listener') {
    return {
      mode: 'delivery-dependent',
      description:
        entry.delivery === 'local'
          ? 'The local Listener joins the producer execution and may participate in its unit of work.'
          : entry.delivery === 'after-commit'
            ? 'The after-commit Listener runs only after durability and cannot roll back the committed mutation.'
            : 'The queued Listener runs later in a fresh execution with no automatic writable transaction and cannot share the producer transaction. It must dispatch an Action as a new top-level operation or use a Job for writable model work.',
    }
  }
  if (kind === 'event') {
    return {
      mode: 'delivery-dependent',
      description:
        'Event facts and queued intent may stage in the active unit of work; each Listener delivery mode determines when reactions execute.',
    }
  }
  if (kind === 'observer') {
    const phases = Array.isArray(entry.phases) ? entry.phases : []
    const includesRetrieved = phases.includes('retrieved')
    const includesCommitted = phases.includes('committed')
    const includesPersistence = phases.some(
      (phase) => phase !== 'retrieved' && phase !== 'committed',
    )
    const descriptions = [
      ...(includesRetrieved
        ? ['The retrieved phase joins the caller’s active read-only or writable model session.']
        : []),
      ...(includesPersistence
        ? ['Persistence phases join the active writable model unit of work.']
        : []),
      ...(includesCommitted
        ? ['The committed phase runs after durability and cannot roll back the write.']
        : []),
    ]
    return {
      mode: includesCommitted ? 'delivery-dependent' : 'joins-caller',
      description:
        descriptions.join(' ') || 'The Observer joins the caller’s active model session.',
    }
  }
  if (
    kind === 'model' ||
    kind === 'policy' ||
    kind === 'permission-source' ||
    kind === 'signal' ||
    kind === 'signal-handler'
  ) {
    return {
      mode: 'joins-caller',
      description: 'This component participates in its admitted caller’s execution semantics.',
    }
  }
  return {
    mode: 'none',
    description: 'This component does not own an application transaction.',
  }
}

function canonicalFolderFor(kind: ComponentKind): string {
  return (
    {
      action: 'actions',
      command: 'commands',
      'realtime-command': 'realtime-commands',
      configuration: 'config',
      event: 'events',
      job: 'jobs',
      listener: 'listeners',
      model: 'models',
      observer: 'observers',
      'permission-source': 'permission-sources',
      policy: 'policies',
      provider: 'providers',
      query: 'queries',
      route: 'http',
      schedule: 'schedules',
      service: 'services',
      signal: 'signals',
      'signal-handler': 'signal-handlers',
    } satisfies Record<ComponentKind, string>
  )[kind]
}

function guideIdsFor(kind: ComponentKind): readonly string[] {
  const guideIds = [`role.${kind}`]
  if (kind === 'action' || kind === 'job' || kind === 'service') {
    guideIds.push('concept.orchestration-consistency', 'concept.execution-transactions')
  }
  if (kind === 'provider' || kind === 'service') guideIds.push('concept.providers-provides')
  if (kind === 'event' || kind === 'listener') guideIds.push('concept.orchestration-consistency')
  return guideIds
}

function providerServiceDiagnostics(
  entry: ManifestComponent,
  role: 'provider' | 'service',
): readonly ArchitectureDiagnostic[] {
  const roleFolder = nearestRoleFolder(entry.source.file)
  const diagnostics: ArchitectureDiagnostic[] = []
  const add = (code: ArchitectureDiagnosticCode, message: string): void => {
    diagnostics.push(
      Object.freeze({
        code,
        severity: 'warning',
        componentId: entry.id,
        message,
        guideId: 'diagnostic.provider-service-location',
        source: entry.source,
      }),
    )
  }
  if (role === 'service' && roleFolder === 'providers') {
    add(
      'DOXA-GNOSIS-STRUCTURE-001',
      `${entry.name} is an ordinary service under a providers folder. Move it to services so its path communicates its compiled role; folders do not change runtime behavior.`,
    )
  }
  if (role === 'provider' && roleFolder === 'services') {
    add(
      'DOXA-GNOSIS-STRUCTURE-002',
      `${entry.name} is an infrastructure provider under a services folder. Move it to providers so its path communicates its compiled role; folders do not change runtime behavior.`,
    )
  }
  if (role === 'service' && /Provider$/.test(entry.name)) {
    add(
      'DOXA-GNOSIS-STRUCTURE-003',
      `${entry.name} is compiled as an ordinary service but its name implies singleton infrastructure.`,
    )
  }
  if (role === 'provider' && /Service$/.test(entry.name)) {
    add(
      'DOXA-GNOSIS-STRUCTURE-004',
      `${entry.name} is compiled as singleton infrastructure but its name implies an ordinary service.`,
    )
  }
  return diagnostics
}

function componentDiagnostics(
  kind: ComponentKind,
  entry: ManifestComponent,
): readonly ArchitectureDiagnostic[] {
  const diagnostics =
    kind === 'provider' || kind === 'service' ? [...providerServiceDiagnostics(entry, kind)] : []
  const expectedFolder = canonicalFolderFor(kind)
  const roleFolder = nearestRoleFolder(entry.source.file)
  const conflictingFolder = roleFolder === expectedFolder ? undefined : roleFolder
  const alreadyReportedOpposite =
    (kind === 'service' && conflictingFolder === 'providers') ||
    (kind === 'provider' && conflictingFolder === 'services')
  if (conflictingFolder && !alreadyReportedOpposite) {
    diagnostics.push(
      Object.freeze({
        code: 'DOXA-GNOSIS-STRUCTURE-005',
        severity: 'warning',
        componentId: entry.id,
        message: `${entry.name} is compiled as ${kind} but is under the canonical ${conflictingFolder} folder. Move it to ${expectedFolder} so its path communicates its role; folders do not change runtime behavior.`,
        guideId: 'diagnostic.canonical-folder',
        source: entry.source,
      }),
    )
  }
  return diagnostics
}

const canonicalRoleFolders = new Set([
  'actions',
  'commands',
  'realtime-commands',
  'config',
  'events',
  'http',
  'jobs',
  'listeners',
  'models',
  'observers',
  'permission-sources',
  'policies',
  'providers',
  'queries',
  'schedules',
  'services',
  'signals',
  'signal-handlers',
])

function nearestRoleFolder(file: string): string | undefined {
  const segments = file.replaceAll('\\', '/').toLowerCase().split('/')
  const featuresIndex = segments.lastIndexOf('features')
  const firstRoleIndex = featuresIndex >= 0 ? featuresIndex + 2 : 0
  for (let index = segments.length - 1; index >= firstRoleIndex; index -= 1) {
    const segment = segments[index]
    if (segment && canonicalRoleFolders.has(segment)) return segment
  }
  return undefined
}

export function sanitizeInspectionValue(value: unknown, key?: string, depth = 0): unknown {
  if (depth > 12) return '[TRUNCATED]'
  if (isSensitiveKey(key) && !isSafeDoxaToken(key, value)) return '[REDACTED]'
  if (typeof value === 'string') return redactText(value).slice(0, 20_000)
  if (Array.isArray(value)) {
    return Object.freeze(
      value
        .slice(0, MAX_INSPECTION_RESULTS)
        .map((entry) => sanitizeInspectionValue(entry, undefined, depth + 1)),
    )
  }
  if (!isRecord(value)) return value
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_INSPECTION_OBJECT_PROPERTIES)
        .map(([name, entry]) => [name, sanitizeInspectionValue(entry, name, depth + 1)]),
    ),
  )
}

function isSensitiveKey(key: string | undefined): boolean {
  return (
    key !== undefined &&
    /(?:authorization|cookie|password|passwd|passphrase|secret|token|api[-_]?key|credential|session|csrf|signature|private[-_]?key)/i.test(
      key,
    )
  )
}

function isSafeDoxaToken(key: string | undefined, value: unknown): boolean {
  return key === 'token' && typeof value === 'string' && value.startsWith('doxa:')
}

function redactText(value: string): string {
  return redactUriCredentials(value)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/\b(token|password|secret|api[-_]?key|authorization)=([^\s&]+)/gi, '$1=[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(
      /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g,
      '[REDACTED]',
    )
    .slice(0, 20_000)
}

function redactUriCredentials(value: string): string {
  let cursor = 0
  let searchFrom = 0
  let redacted = ''
  while (searchFrom < value.length) {
    const protocol = value.indexOf('://', searchFrom)
    if (protocol === -1) break
    let schemeStart = protocol - 1
    while (schemeStart >= 0 && isUriSchemeCharacter(value[schemeStart]!)) schemeStart -= 1
    schemeStart += 1
    if (schemeStart === protocol || !/[A-Za-z]/.test(value[schemeStart]!)) {
      searchFrom = protocol + 3
      continue
    }
    const authorityStart = protocol + 3
    let authorityEnd = authorityStart
    while (authorityEnd < value.length && !isUriAuthorityBoundary(value[authorityEnd]!)) {
      authorityEnd += 1
    }
    const at = value.lastIndexOf('@', authorityEnd - 1)
    const separator = value.indexOf(':', authorityStart)
    if (at < authorityStart || separator < authorityStart || separator >= at) {
      searchFrom = Math.max(authorityEnd, protocol + 3)
      continue
    }
    redacted += `${value.slice(cursor, separator + 1)}[REDACTED]`
    cursor = at
    searchFrom = authorityEnd
  }
  return `${redacted}${value.slice(cursor)}`
}

function isUriSchemeCharacter(character: string): boolean {
  return /[A-Za-z0-9+.-]/.test(character)
}

function isUriAuthorityBoundary(character: string): boolean {
  return character === '/' || character === '?' || character === '#' || /\s/u.test(character)
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? redactText(error.message) : 'The Doxa manifest is invalid.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
