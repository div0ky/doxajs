import type {
  DoxaManifest,
  JobManifestEntry,
  OperationManifestEntry,
  ProviderManifestEntry,
  RealtimeCommandManifestEntry,
  SourceProvenance,
} from '@doxajs/manifest'

import { DoxaCompilationError } from './errors.js'

export type CompilerArchitectureAdvisoryCode =
  | 'DOXA-GNOSIS-STRUCTURE-001'
  | 'DOXA-GNOSIS-STRUCTURE-002'
  | 'DOXA-GNOSIS-STRUCTURE-003'
  | 'DOXA-GNOSIS-STRUCTURE-004'
  | 'DOXA-GNOSIS-STRUCTURE-005'

export interface CompilerArchitectureAdvisory {
  readonly code: CompilerArchitectureAdvisoryCode
  readonly severity: 'warning'
  readonly componentId: string
  readonly message: string
  readonly guideId: 'diagnostic.provider-service-location' | 'diagnostic.canonical-folder'
  readonly source: SourceProvenance
}

export function assertUnique<T>(
  items: readonly T[],
  identity: (item: T) => string,
  label: string,
): void {
  const seen = new Set<string>()
  for (const item of items) {
    const id = identity(item)
    if (seen.has(id)) throw new DoxaCompilationError(`Duplicate ${label}: ${id}`)
    seen.add(id)
  }
}

export function assertAcyclicProviderGraph(providers: readonly ProviderManifestEntry[]): void {
  const byId = new Map(providers.map((provider) => [provider.id, provider]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) {
      throw new DoxaCompilationError(`Dependency cycle: ${[...path, id].join(' -> ')}`)
    }
    if (visited.has(id)) return
    const provider = byId.get(id)
    if (!provider) return
    visiting.add(id)
    for (const dependency of provider.dependencies) {
      if (dependency.targetId && byId.has(dependency.targetId)) {
        visit(dependency.targetId, [...path, id])
      }
    }
    visiting.delete(id)
    visited.add(id)
  }

  for (const provider of providers) visit(provider.id, [])
}

export function assertScopeSafety(providers: readonly ProviderManifestEntry[]): void {
  const byId = new Map(providers.map((provider) => [provider.id, provider]))

  const reachesExecutionScope = (id: string, visited: Set<string>): boolean => {
    if (visited.has(id)) return false
    visited.add(id)
    const provider = byId.get(id)
    if (!provider) return false
    if (provider.scope === 'execution') return true
    return provider.dependencies.some(
      (dependency) => dependency.targetId && reachesExecutionScope(dependency.targetId, visited),
    )
  }

  for (const provider of providers) {
    if (provider.scope !== 'singleton') continue
    for (const dependency of provider.dependencies) {
      if (dependency.targetId && reachesExecutionScope(dependency.targetId, new Set())) {
        throw new DoxaCompilationError(
          `[DOXA-COMPILER-SCOPE-001] Singleton ${provider.id} cannot depend on execution-scoped ${dependency.targetId}. See Gnosis guide concept.providers-provides.`,
        )
      }
    }
  }
}

export function assertNoNestedActionBusReachability(
  providers: readonly ProviderManifestEntry[],
  operations: readonly OperationManifestEntry[],
  jobs: readonly JobManifestEntry[],
  realtimeCommands: readonly RealtimeCommandManifestEntry[] = [],
): void {
  const providersById = new Map(providers.map((provider) => [provider.id, provider]))
  for (const root of [...operations, ...jobs, ...realtimeCommands]) {
    const visited = new Set<string>()
    const visit = (targetId: string, path: readonly string[]): void => {
      if (targetId === 'doxa:action-bus') {
        throw new DoxaCompilationError(
          `[DOXA-COMPILER-ARCH-001] ${root.id} reaches ActionBus through ${[...path, targetId].join(' -> ')}. Nested Action dispatch from Actions, Queries, Jobs, and RealtimeCommands is prohibited. Move reusable behavior into an ordinary service and let a durable top-level Action or Job own mutations. See Gnosis guide diagnostic.nested-action-dispatch.`,
        )
      }
      if (visited.has(targetId)) return
      visited.add(targetId)
      const provider = providersById.get(targetId)
      if (!provider) return
      for (const dependency of provider.dependencies) {
        if (dependency.targetId) {
          visit(dependency.targetId, [...path, targetId])
        }
      }
    }
    for (const dependency of root.dependencies) {
      if (dependency.targetId) visit(dependency.targetId, [root.id])
    }
  }
}

export function architectureAdvisories(
  manifest: DoxaManifest,
): readonly CompilerArchitectureAdvisory[] {
  return componentEntries(manifest)
    .flatMap(({ kind, entry }) => componentAdvisories(kind, entry))
    .sort(
      (left, right) =>
        left.componentId.localeCompare(right.componentId) || left.code.localeCompare(right.code),
    )
}

type AdvisoryComponentKind =
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

interface AdvisoryComponent {
  readonly id: string
  readonly name: string
  readonly source: SourceProvenance
}

function componentEntries(
  manifest: DoxaManifest,
): readonly { readonly kind: AdvisoryComponentKind; readonly entry: AdvisoryComponent }[] {
  const entries: { kind: AdvisoryComponentKind; entry: AdvisoryComponent }[] = []
  const add = (kind: AdvisoryComponentKind, values: readonly AdvisoryComponent[]): void => {
    for (const entry of values) entries.push({ kind, entry })
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
  return entries
}

function componentAdvisories(
  kind: AdvisoryComponentKind,
  entry: AdvisoryComponent,
): readonly CompilerArchitectureAdvisory[] {
  const advisories: CompilerArchitectureAdvisory[] = []
  const add = (
    code: CompilerArchitectureAdvisoryCode,
    guideId: CompilerArchitectureAdvisory['guideId'],
    message: string,
  ): void => {
    advisories.push({
      code,
      severity: 'warning',
      componentId: entry.id,
      message,
      guideId,
      source: entry.source,
    })
  }
  const roleFolder = nearestRoleFolder(entry.source.file)
  if (kind === 'service' && roleFolder === 'providers') {
    add(
      'DOXA-GNOSIS-STRUCTURE-001',
      'diagnostic.provider-service-location',
      `${entry.name} is an ordinary service under a providers folder. Move it to services so its path communicates its compiled role; folders do not change runtime behavior.`,
    )
  }
  if (kind === 'provider' && roleFolder === 'services') {
    add(
      'DOXA-GNOSIS-STRUCTURE-002',
      'diagnostic.provider-service-location',
      `${entry.name} is an infrastructure provider under a services folder. Move it to providers so its path communicates its compiled role; folders do not change runtime behavior.`,
    )
  }
  if (kind === 'service' && /Provider$/.test(entry.name)) {
    add(
      'DOXA-GNOSIS-STRUCTURE-003',
      'diagnostic.provider-service-location',
      `${entry.name} is compiled as an ordinary service but its name implies singleton infrastructure.`,
    )
  }
  if (kind === 'provider' && /Service$/.test(entry.name)) {
    add(
      'DOXA-GNOSIS-STRUCTURE-004',
      'diagnostic.provider-service-location',
      `${entry.name} is compiled as singleton infrastructure but its name implies an ordinary service.`,
    )
  }

  const expectedFolder = canonicalFolder(kind)
  const conflictingFolder = roleFolder === expectedFolder ? undefined : roleFolder
  const alreadyReportedOpposite =
    (kind === 'service' && conflictingFolder === 'providers') ||
    (kind === 'provider' && conflictingFolder === 'services')
  if (conflictingFolder && !alreadyReportedOpposite) {
    add(
      'DOXA-GNOSIS-STRUCTURE-005',
      'diagnostic.canonical-folder',
      `${entry.name} is compiled as ${kind} but is under the canonical ${conflictingFolder} folder. Move it to ${expectedFolder} so its path communicates its role; folders do not change runtime behavior.`,
    )
  }
  return advisories
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

function canonicalFolder(kind: AdvisoryComponentKind): string {
  return {
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
  }[kind]
}
