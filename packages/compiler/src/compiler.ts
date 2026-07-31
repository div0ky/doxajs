import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

import {
  MANIFEST_FORMAT_VERSION,
  canonicalJson,
  type AuthenticationEligibilityPredicate,
  type AuthenticationManifestEntry,
  type DoxaManifest,
  type CommandManifestEntry,
  type ConfigurationDefault,
  type ConfigurationManifestEntry,
  type ConfigurationPropertyManifest,
  type DependencyManifestEntry,
  type EventManifestEntry,
  type FeatureManifestEntry,
  type ListenerManifestEntry,
  type JobManifestEntry,
  type ModelManifestEntry,
  type ModelRelationshipManifest,
  type OperationManifestEntry,
  type ObserverManifestEntry,
  type PermissionSourceManifestEntry,
  type ProviderManifestEntry,
  type RealtimeCommandManifestEntry,
  type PolicyManifestEntry,
  type PluginManifestEntry,
  type RouteManifestEntry,
  type ScheduleManifestEntry,
  type SignalManifestEntry,
  type SignalHandlerManifestEntry,
  type SourceProvenance,
} from '@doxajs/manifest'

import { DoxaCompilationError } from './errors.js'
import { prepareFrameworkSource } from './framework-source.js'
import {
  architectureAdvisories,
  assertAcyclicProviderGraph,
  assertNoNestedActionBusReachability,
  assertScopeSafety,
  assertUnique,
  type CompilerArchitectureAdvisory,
} from './manifest-validation.js'

export { DoxaCompilationError } from './errors.js'

const DECLARATION_FIELDS = new Set([
  'id',
  'features',
  'plugins',
  'framework',
  'configs',
  'provides',
  'providers',
  'actions',
  'queries',
  'models',
  'observers',
  'routes',
  'events',
  'listeners',
  'jobs',
  'schedules',
  'policies',
  'permissionSources',
  'signals',
  'signalHandlers',
  'commands',
  'realtimeCommands',
])

export interface CompileApplicationOptions {
  readonly tsconfigPath: string
  readonly applicationFile: string
  readonly sourceRoot: string
  readonly outputRoot: string
  readonly artifactsDirectory: string
  readonly frameworkFile?: string
  readonly applicationExport?: string
}

export interface PrepareApplicationOptions {
  readonly applicationFile: string
  readonly frameworkFile: string
}

export interface CompileApplicationResult {
  readonly manifest: DoxaManifest
  readonly manifestPath: string
  readonly registryPath: string
  readonly advisories: readonly CompilerArchitectureAdvisory[]
}

interface RegisteredClass {
  readonly id: string
  readonly declaration: ts.ClassDeclaration
}

export async function prepareApplication(options: PrepareApplicationOptions): Promise<{
  readonly applicationId: string
  readonly plugins: readonly string[]
  readonly frameworkFile: string
}> {
  const applicationFile = path.resolve(options.applicationFile)
  const frameworkFile = path.resolve(options.frameworkFile)
  const prepared = prepareFrameworkSource(
    applicationFile,
    await readFile(applicationFile, 'utf8').catch((error: unknown) => {
      throw new DoxaCompilationError(
        `Application configuration is not readable: ${applicationFile}`,
        {
          cause: error,
        },
      )
    }),
  )
  await mkdir(path.dirname(frameworkFile), { recursive: true })
  await writeFile(frameworkFile, prepared.source, 'utf8')
  return {
    applicationId: prepared.applicationId,
    plugins: prepared.plugins,
    frameworkFile,
  }
}

export async function compileApplication(
  options: CompileApplicationOptions,
): Promise<CompileApplicationResult> {
  const normalized = normalizeOptions(options)
  const program = createProgram(normalized.tsconfigPath)
  const checker = program.getTypeChecker()
  assertValidProgram(program)

  const applicationSource = program.getSourceFile(normalized.applicationFile)
  if (!applicationSource) {
    throw new DoxaCompilationError(
      `Application source is not part of the TypeScript program: ${normalized.applicationFile}`,
    )
  }

  const applicationDeclaration = findExportedClass(applicationSource, normalized.applicationExport)
  assertDeclarationOnly(applicationDeclaration, 'Application')
  const applicationId = readRequiredInstanceString(applicationDeclaration, 'id')
  const applicationName = requiredClassName(applicationDeclaration)

  const frameworkDeclaration = normalized.frameworkFile
    ? findExportedClass(
        program.getSourceFile(normalized.frameworkFile) ??
          failSource(
            `Framework source is not part of the TypeScript program: ${normalized.frameworkFile}`,
          ),
        'DoxaCoreFeature',
      )
    : undefined
  const featureDeclarations = [
    ...(frameworkDeclaration ? [frameworkDeclaration] : []),
    ...readClassArray(applicationDeclaration, 'features', checker),
  ]
  const features = featureDeclarations.map((declaration) => {
    assertDeclarationOnly(declaration, 'Feature')
    return {
      id: readRequiredInstanceString(declaration, 'id'),
      name: requiredClassName(declaration),
      source: sourceOf(declaration, normalized.projectRoot),
    } satisfies FeatureManifestEntry
  })
  assertUnique(features, (feature) => feature.id, 'Feature ID')

  const plugins: PluginManifestEntry[] = readStringArray(applicationDeclaration, 'plugins').map(
    (packageName) => ({
      id: packageName.replace(/^@doxajs\//, ''),
      package: packageName,
      source: sourceOf(applicationDeclaration, normalized.projectRoot),
    }),
  )
  assertUnique(plugins, (plugin) => plugin.package, 'plugin package')

  const configurations: ConfigurationManifestEntry[] = []
  const configurationByDeclaration = new Map<ts.ClassDeclaration, ConfigurationManifestEntry>()

  registerConfigurations(
    readClassArray(applicationDeclaration, 'configs', checker),
    `application:${applicationId}`,
  )

  for (let index = 0; index < featureDeclarations.length; index += 1) {
    const declaration = featureDeclarations[index]
    const feature = features[index]
    if (!declaration || !feature) continue
    registerConfigurations(readClassArray(declaration, 'configs', checker), feature.id)
  }

  const providers: ProviderManifestEntry[] = []
  const providerByDeclaration = new Map<ts.ClassDeclaration, ProviderManifestEntry>()
  const providerRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const sharedServiceRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const actions: OperationManifestEntry[] = []
  const queries: OperationManifestEntry[] = []
  const operationByDeclaration = new Map<ts.ClassDeclaration, OperationManifestEntry>()
  const operationRoots = new Map<
    ts.ClassDeclaration,
    { readonly ownerId: string; readonly role: 'action' | 'query' }
  >()
  const models: ModelManifestEntry[] = []
  const modelByDeclaration = new Map<ts.ClassDeclaration, ModelManifestEntry>()
  const modelRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const observers: ObserverManifestEntry[] = []
  const observerByDeclaration = new Map<ts.ClassDeclaration, ObserverManifestEntry>()
  const observerRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const routes: RouteManifestEntry[] = []
  const routeByDeclaration = new Map<ts.ClassDeclaration, RouteManifestEntry>()
  const routeRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const events: EventManifestEntry[] = []
  const eventByDeclaration = new Map<ts.ClassDeclaration, EventManifestEntry>()
  const eventRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const listeners: ListenerManifestEntry[] = []
  const listenerByDeclaration = new Map<ts.ClassDeclaration, ListenerManifestEntry>()
  const listenerRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const jobs: JobManifestEntry[] = []
  const jobByDeclaration = new Map<ts.ClassDeclaration, JobManifestEntry>()
  const jobRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const schedules: ScheduleManifestEntry[] = []
  const scheduleByDeclaration = new Map<ts.ClassDeclaration, ScheduleManifestEntry>()
  const scheduleRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const policies: PolicyManifestEntry[] = []
  const policyByDeclaration = new Map<ts.ClassDeclaration, PolicyManifestEntry>()
  const policyRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  let permissionSource: PermissionSourceManifestEntry | null = null
  const permissionSourceByDeclaration = new Map<
    ts.ClassDeclaration,
    PermissionSourceManifestEntry
  >()
  const permissionSourceRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const signals: SignalManifestEntry[] = []
  const signalByDeclaration = new Map<ts.ClassDeclaration, SignalManifestEntry>()
  const signalRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const signalHandlers: SignalHandlerManifestEntry[] = []
  const signalHandlerByDeclaration = new Map<ts.ClassDeclaration, SignalHandlerManifestEntry>()
  const signalHandlerRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const commands: CommandManifestEntry[] = []
  const commandByDeclaration = new Map<ts.ClassDeclaration, CommandManifestEntry>()
  const commandRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()
  const realtimeCommands: RealtimeCommandManifestEntry[] = []
  const realtimeCommandByDeclaration = new Map<ts.ClassDeclaration, RealtimeCommandManifestEntry>()
  const realtimeCommandRoots = new Map<ts.ClassDeclaration, { readonly ownerId: string }>()

  for (let index = 0; index < featureDeclarations.length; index += 1) {
    const featureDeclaration = featureDeclarations[index]
    const feature = features[index]
    if (!featureDeclaration || !feature) continue

    for (const providerDeclaration of readClassArray(featureDeclaration, 'providers', checker)) {
      const existing = providerRoots.get(providerDeclaration)
      if (existing && existing.ownerId !== feature.id) {
        fail(
          providerDeclaration,
          `${requiredClassName(providerDeclaration)} is declared as a provider by multiple Features.`,
        )
      }
      if (sharedServiceRoots.has(providerDeclaration)) {
        fail(
          providerDeclaration,
          `[DOXA-COMPILER-ROLE-002] ${requiredClassName(providerDeclaration)} cannot be both an infrastructure provider and an exported ordinary service. See Gnosis guide concept.providers-provides.`,
        )
      }
      providerRoots.set(providerDeclaration, { ownerId: feature.id })
    }
    for (const serviceDeclaration of readClassArray(featureDeclaration, 'provides', checker)) {
      const frameworkBase = [
        'Action',
        'Query',
        'Model',
        'Observer',
        'Route',
        'Event',
        'Listener',
        'Job',
        'Schedule',
        'Policy',
        'PermissionSource',
        'Signal',
        'SignalHandler',
        'Command',
        'RealtimeCommand',
        'Auth',
        'TransactionManager',
        'QueueManager',
        'Cache',
        'MailTransport',
        'SmsTransport',
        'BroadcastTransport',
        'Telemetry',
        'ObservationRecorder',
      ].find((name) => extendsNamedClass(serviceDeclaration, name, checker))
      if (frameworkBase || configurationByDeclaration.has(serviceDeclaration)) {
        fail(
          serviceDeclaration,
          `[DOXA-COMPILER-ROLE-001] ${requiredClassName(serviceDeclaration)} is framework-facing and cannot be exported as an ordinary service through provides. See Gnosis guide role.service.`,
        )
      }
      const existing = sharedServiceRoots.get(serviceDeclaration)
      if (existing) {
        fail(
          serviceDeclaration,
          `${requiredClassName(serviceDeclaration)} is already provided by Feature ${existing.ownerId}.`,
        )
      }
      if (providerRoots.has(serviceDeclaration)) {
        fail(
          serviceDeclaration,
          `[DOXA-COMPILER-ROLE-002] ${requiredClassName(serviceDeclaration)} cannot be both an infrastructure provider and an exported ordinary service. See Gnosis guide concept.providers-provides.`,
        )
      }
      sharedServiceRoots.set(serviceDeclaration, { ownerId: feature.id })
    }
  }

  for (let index = 0; index < featureDeclarations.length; index += 1) {
    const featureDeclaration = featureDeclarations[index]
    const feature = features[index]
    if (!featureDeclaration || !feature) continue
    for (const action of readClassArray(featureDeclaration, 'actions', checker)) {
      registerOperationRoot(action, feature.id, 'action')
    }
    for (const query of readClassArray(featureDeclaration, 'queries', checker)) {
      registerOperationRoot(query, feature.id, 'query')
    }
    for (const model of readClassArray(featureDeclaration, 'models', checker)) {
      const existing = modelRoots.get(model)
      if (existing) {
        fail(
          model,
          `${requiredClassName(model)} is already declared as a model by ${existing.ownerId}.`,
        )
      }
      modelRoots.set(model, { ownerId: feature.id })
    }
    registerOwnedRoots(featureDeclaration, 'observers', feature.id, observerRoots, 'observer')
    registerOwnedRoots(featureDeclaration, 'routes', feature.id, routeRoots, 'route')
    registerOwnedRoots(featureDeclaration, 'events', feature.id, eventRoots, 'event')
    registerOwnedRoots(featureDeclaration, 'listeners', feature.id, listenerRoots, 'listener')
    registerOwnedRoots(featureDeclaration, 'jobs', feature.id, jobRoots, 'job')
    registerOwnedRoots(featureDeclaration, 'schedules', feature.id, scheduleRoots, 'schedule')
    registerOwnedRoots(featureDeclaration, 'policies', feature.id, policyRoots, 'policy')
    for (const source of readClassArray(featureDeclaration, 'permissionSources', checker)) {
      const existing = [...permissionSourceRoots.entries()][0]
      if (existing) {
        fail(
          source,
          `Applications may select at most one PermissionSource; ${requiredClassName(existing[0])} is already selected by ${existing[1].ownerId}.`,
        )
      }
      permissionSourceRoots.set(source, { ownerId: feature.id })
    }
    registerOwnedRoots(featureDeclaration, 'signals', feature.id, signalRoots, 'signal')
    registerOwnedRoots(
      featureDeclaration,
      'signalHandlers',
      feature.id,
      signalHandlerRoots,
      'signal handler',
    )
    registerOwnedRoots(featureDeclaration, 'commands', feature.id, commandRoots, 'command')
    registerOwnedRoots(
      featureDeclaration,
      'realtimeCommands',
      feature.id,
      realtimeCommandRoots,
      'realtime command',
    )
  }

  for (const [providerDeclaration, root] of providerRoots) {
    registerProvider(providerDeclaration, root.ownerId, 'provider')
  }
  for (const [serviceDeclaration, root] of sharedServiceRoots) {
    registerProvider(serviceDeclaration, root.ownerId, 'service')
  }

  for (const [operation, root] of operationRoots) {
    registerOperation(operation, root.ownerId, root.role)
  }
  for (const [model, root] of modelRoots) {
    registerModel(model, root.ownerId)
  }
  for (const [declaration, entry] of modelByDeclaration) {
    const updated = {
      ...entry,
      relationships: compileModelRelationships(declaration),
    } satisfies ModelManifestEntry
    modelByDeclaration.set(declaration, updated)
    models[models.indexOf(entry)] = updated
  }
  for (const [observer, root] of observerRoots) registerObserver(observer, root.ownerId)
  for (const [event, root] of eventRoots) {
    registerEvent(event, root.ownerId)
  }
  for (const [listener, root] of listenerRoots) {
    registerListener(listener, root.ownerId)
  }
  for (const [route, root] of routeRoots) {
    registerRoute(route, root.ownerId)
  }
  for (const [job, root] of jobRoots) {
    registerJob(job, root.ownerId)
  }
  for (const [schedule, root] of scheduleRoots) {
    registerSchedule(schedule, root.ownerId)
  }
  for (const [policy, root] of policyRoots) {
    registerPolicy(policy, root.ownerId)
  }
  for (const [source, root] of permissionSourceRoots) {
    permissionSource = registerPermissionSource(source, root.ownerId)
  }
  for (const [signal, root] of signalRoots) registerSignal(signal, root.ownerId)
  for (const [handler, root] of signalHandlerRoots) registerSignalHandler(handler, root.ownerId)
  for (const [command, root] of commandRoots) registerCommand(command, root.ownerId)
  for (const [command, root] of realtimeCommandRoots) registerRealtimeCommand(command, root.ownerId)

  const authentication = compileAuthentication()

  assertUnique(providers, (provider) => provider.id, 'provider ID')
  assertUnique(actions, (operation) => operation.id, 'action ID')
  assertUnique(queries, (operation) => operation.id, 'query ID')
  assertUnique(models, (model) => model.id, 'model ID')
  assertUnique(observers, (observer) => observer.id, 'observer ID')
  assertUnique(routes, (route) => route.id, 'route ID')
  assertUnique(routes, (route) => `${route.method} ${route.path}`, 'HTTP route')
  assertUnique(events, (event) => event.id, 'event ID')
  assertUnique(listeners, (listener) => listener.id, 'listener ID')
  assertUnique(jobs, (job) => job.id, 'job ID')
  assertUnique(schedules, (schedule) => schedule.id, 'schedule ID')
  assertUnique(policies, (policy) => policy.id, 'policy ID')
  assertUnique(signals, (signal) => signal.id, 'signal ID')
  assertUnique(signalHandlers, (handler) => handler.id, 'signal handler ID')
  assertUnique(commands, (command) => command.id, 'command ID')
  assertUnique(commands, (command) => command.command, 'command name')
  assertUnique(realtimeCommands, (command) => command.command, 'realtime command ID')
  assertUnique(
    policies.flatMap((policy) => policy.abilities.map((ability) => ({ ability, policy }))),
    (entry) => entry.ability,
    'policy ability',
  )
  const policyAbilities = new Set(policies.flatMap((policy) => policy.abilities))
  const availableAbilities = new Set([...policyAbilities, ...(permissionSource?.abilities ?? [])])
  for (const entry of [
    ...routes,
    ...actions,
    ...queries,
    ...listeners,
    ...jobs,
    ...schedules,
    ...signalHandlers,
    ...commands,
    ...realtimeCommands,
  ]) {
    if (entry.access !== 'public' && !availableAbilities.has(entry.access)) {
      throw new DoxaCompilationError(
        `${entry.id} requires ability ${entry.access}, but no selected Policy or PermissionSource declares it.`,
      )
    }
  }
  assertAcyclicProviderGraph(providers)
  assertScopeSafety(providers)
  assertNoNestedActionBusReachability(providers, [...actions, ...queries], jobs, realtimeCommands)
  const transactionProviders = providers.filter((provider) =>
    provider.capabilities.includes('transactions'),
  )
  if (actions.length > 0 && transactionProviders.length !== 1) {
    throw new DoxaCompilationError(
      `Applications with actions require exactly one transaction provider; found ${transactionProviders.length}.`,
    )
  }
  const queueProviders = providers.filter((provider) => provider.capabilities.includes('queues'))
  const authenticationProviders = providers.filter((provider) =>
    provider.capabilities.includes('authentication'),
  )
  if (authenticationProviders.length > 1) {
    throw new DoxaCompilationError(
      `Applications may declare at most one authentication provider; found ${authenticationProviders.length}.`,
    )
  }
  const cacheProviders = providers.filter((provider) => provider.capabilities.includes('cache'))
  if (cacheProviders.length > 1) {
    throw new DoxaCompilationError(
      `Applications may declare at most one cache provider; found ${cacheProviders.length}.`,
    )
  }
  for (const capability of ['mail', 'sms', 'broadcasting', 'telemetry'] as const) {
    const selected = providers.filter((provider) => provider.capabilities.includes(capability))
    if (selected.length > 1)
      throw new DoxaCompilationError(
        `Applications may declare at most one ${capability} provider; found ${selected.length}.`,
      )
  }
  const queuedListeners = listeners.filter(
    (listener) => listener.delivery === 'queued' || listener.delivery === 'queued-after-commit',
  )
  const queuedBroadcasts = events.filter((event) => event.broadcast === 'queued')
  const broadcastingProviders = providers.filter((provider) =>
    provider.capabilities.includes('broadcasting'),
  )
  if (events.some((event) => event.broadcast !== false) && broadcastingProviders.length !== 1) {
    throw new DoxaCompilationError(
      `Applications with broadcast events require exactly one broadcasting provider; found ${broadcastingProviders.length}.`,
    )
  }
  if (
    events.some((event) => event.broadcast !== false) &&
    !policyAbilities.has('broadcast.subscribe')
  ) {
    throw new DoxaCompilationError(
      'Applications with broadcast events must declare a Policy for the broadcast.subscribe ability.',
    )
  }
  const communicationProviders = providers.filter(
    (provider) => provider.capabilities.includes('mail') || provider.capabilities.includes('sms'),
  )
  if (
    (jobs.length > 0 ||
      queuedListeners.length > 0 ||
      queuedBroadcasts.length > 0 ||
      schedules.length > 0 ||
      communicationProviders.length > 0) &&
    queueProviders.length !== 1
  ) {
    throw new DoxaCompilationError(
      `Applications with jobs, schedules, queued listeners, or queued broadcasts require exactly one queue provider; found ${queueProviders.length}.`,
    )
  }
  const application = {
    id: applicationId,
    name: applicationName,
    source: sourceOf(applicationDeclaration, normalized.projectRoot),
  }

  const compilerVersion = await installedCompilerVersion()
  const semanticManifest = {
    formatVersion: MANIFEST_FORMAT_VERSION,
    applicationId,
    frameworkVersion: compilerVersion,
    compilerVersion,
    application,
    authentication,
    plugins: [...plugins].sort(byId),
    features: [...features].sort(byId),
    configurations: [...configurations].sort(byId),
    providers: [...providers].sort(byId),
    actions: [...actions].sort(byId),
    queries: [...queries].sort(byId),
    models: [...models].sort(byId),
    observers: [...observers].sort(byId),
    routes: [...routes].sort(byId),
    events: [...events].sort(byId),
    listeners: [...listeners].sort(byId),
    jobs: [...jobs].sort(byId),
    schedules: [...schedules].sort(byId),
    policies: [...policies].sort(byId),
    permissionSource,
    signals: [...signals].sort(byId),
    signalHandlers: [...signalHandlers].sort(byId),
    commands: [...commands].sort(byId),
    realtimeCommands: [...realtimeCommands].sort(byId),
  }
  const buildHash = createHash('sha256').update(canonicalJson(semanticManifest)).digest('hex')
  const manifest: DoxaManifest = { ...semanticManifest, buildHash }
  const advisories = architectureAdvisories(manifest)

  await mkdir(normalized.artifactsDirectory, { recursive: true })
  const manifestPath = path.join(normalized.artifactsDirectory, 'manifest.json')
  const registryPath = path.join(normalized.artifactsDirectory, 'registry.mjs')
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, 'utf8')
  await writeFile(
    registryPath,
    renderRegistry(
      {
        id: `application:${applicationId}`,
        declaration: applicationDeclaration,
      },
      [...configurationByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...providerByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...operationByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...modelByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...observerByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...routeByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...eventByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...listenerByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...jobByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...scheduleByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...policyByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...permissionSourceByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...signalByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...signalHandlerByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...commandByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      [...realtimeCommandByDeclaration.entries()].map(([declaration, entry]) => ({
        id: entry.id,
        declaration,
      })),
      buildHash,
      normalized,
    ),
    'utf8',
  )

  return { manifest, manifestPath, registryPath, advisories }

  function compileAuthentication(): AuthenticationManifestEntry {
    const framework = instanceObject(applicationDeclaration, 'framework')
    const auth = framework ? objectFieldObject(framework, 'auth') : undefined
    const identity = auth ? objectFieldObject(auth, 'identity') : undefined
    if (!identity) {
      return {
        mode: 'doxa-owned',
        source: 'doxa-owned',
        table: 'doxa_auth_identities',
        columns: {
          id: 'id',
          identifier: 'email',
          contactEmail: 'email',
          createdAt: 'created_at',
          updatedAt: 'updated_at',
        },
        identifier: { kind: 'email', normalization: { preset: 'email' } },
        verification: { mode: 'mapped', column: 'email_verified_at' },
        eligibility: [],
        credentials: {
          table: 'doxa_auth_passwords',
          identityId: 'identity_id',
          password: 'hash',
          readers: [{ preset: 'doxa-argon2id', hash: 'hash' }],
          upgrade: {
            mode: 'in-place',
            format: 'doxa-argon2id',
            password: 'hash',
            updatedAt: 'updated_at',
          },
        },
        routes: {
          registration: true,
          verification: true,
          recovery: true,
          passwordChange: true,
        },
      }
    }

    const mode = requiredObjectString(identity, 'mode')
    if (mode !== 'managed' && mode !== 'login-only') {
      fail(identity, 'framework.auth.identity.mode must be "managed" or "login-only".')
    }
    const identifierObject = requiredObjectFieldObject(identity, 'identifier')
    const kind = requiredObjectString(identifierObject, 'kind')
    if (kind !== 'email' && kind !== 'username' && kind !== 'custom') {
      fail(identifierObject, 'Auth identifier kind must be email, username, or custom.')
    }
    const normalization = compileNormalization(
      requiredObjectFieldObject(identifierObject, 'normalize'),
    )
    const emailNormalization =
      normalization.preset === 'email' || normalization.preset === 'email-or-domain'
    if ((kind === 'email') !== emailNormalization) {
      fail(
        identifierObject,
        kind === 'email'
          ? 'Email auth identifiers require email or email-or-domain normalization.'
          : 'Email normalization requires the email auth identifier kind.',
      )
    }
    const credentials = compileCredentials(requiredObjectFieldObject(identity, 'credentials'))
    if (mode === 'managed' && credentials.upgrade.mode !== 'in-place') {
      fail(identity, 'Managed auth credentials require an explicit in-place upgrade policy.')
    }
    const eligibilityObject = objectField(identity, 'eligibility')
    const modelProperty = objectField(identity, 'model')

    if (modelProperty) {
      const modelDeclaration = resolveClassReference(modelProperty.initializer, checker)
      const model = modelDeclaration ? modelByDeclaration.get(modelDeclaration) : undefined
      if (!model || model.storage.kind !== 'table') {
        fail(
          modelProperty,
          'Auth identity model must be a table-backed Model selected by a Feature.',
        )
      }
      const identifierAttribute = requiredObjectString(identifierObject, 'attribute')
      const contactEmail = optionalObjectString(identity, 'contactEmail')
      const timestamps = requiredObjectFieldObject(identity, 'timestamps')
      const createdAt = requiredObjectString(timestamps, 'createdAt')
      const updatedAt = requiredObjectString(timestamps, 'updatedAt')
      const verificationObject = objectFieldObject(identity, 'verification')
      const configuredVerification = compileModelVerification(verificationObject, model)
      const verification = contactEmail
        ? configuredVerification
        : ({ mode: 'unsupported' } as const)
      const attributes = new Set(model.attributes)
      const credentialColumns = new Set([credentials.password])
      const credentialAttribute = model.attributes.find((attribute) =>
        credentialColumns.has(physicalModelColumn(model, attribute)),
      )
      if (credentialAttribute) {
        fail(
          identity,
          `Auth credential column for ${credentialAttribute} cannot be part of ordinary Model state.`,
        )
      }
      for (const attribute of [identifierAttribute, contactEmail, createdAt, updatedAt].filter(
        (value): value is string => Boolean(value),
      )) {
        if (!attributes.has(attribute)) {
          fail(identity, `Auth identity attribute ${attribute} is not declared by ${model.name}.`)
        }
      }
      const eligibility = compileEligibility(eligibilityObject, 'attribute', (attribute) => {
        if (!attributes.has(attribute)) {
          fail(
            identity,
            `Auth eligibility attribute ${attribute} is not declared by ${model.name}.`,
          )
        }
        return physicalModelColumn(model, attribute)
      })
      const registrationFactoryProperty = objectField(identity, 'registrationFactory')
      let registrationFactoryId: string | undefined
      if (registrationFactoryProperty) {
        if (mode !== 'managed') {
          fail(
            registrationFactoryProperty,
            'registrationFactory is available only in managed mode.',
          )
        }
        const declaration = resolveClassReference(registrationFactoryProperty.initializer, checker)
        if (!declaration) {
          fail(registrationFactoryProperty, 'registrationFactory must reference a concrete class.')
        }
        const provider =
          providerByDeclaration.get(declaration) ??
          registerProvider(declaration, model.ownerId, 'service')
        registrationFactoryId = provider.id
      }
      return {
        mode,
        source: 'model',
        modelId: model.id,
        table: model.storage.table,
        columns: {
          id: model.storage.primaryKey,
          identifier: physicalModelColumn(model, identifierAttribute),
          ...(contactEmail ? { contactEmail: physicalModelColumn(model, contactEmail) } : {}),
          createdAt: physicalModelColumn(model, createdAt),
          updatedAt: physicalModelColumn(model, updatedAt),
        },
        attributes: {
          identifier: identifierAttribute,
          ...(contactEmail ? { contactEmail } : {}),
          createdAt,
          updatedAt,
          ...(verification.mode === 'mapped' && verificationObject
            ? {
                verification: requiredObjectString(verificationObject, 'attribute'),
              }
            : {}),
        },
        identifier: { kind, normalization },
        verification,
        eligibility,
        credentials,
        ...(registrationFactoryId ? { registrationFactoryId } : {}),
        routes: {
          registration: mode === 'managed',
          verification: mode === 'managed' && verification.mode === 'mapped',
          recovery: mode === 'managed' && Boolean(contactEmail),
          passwordChange: mode === 'managed',
        },
      }
    }

    if (mode !== 'login-only') {
      fail(identity, 'Raw auth table mappings are available only in login-only mode.')
    }
    const table = requiredObjectString(identity, 'table')
    if (!validQualifiedIdentifier(table)) fail(identity, 'Auth identity table is invalid.')
    const columns = requiredObjectFieldObject(identity, 'columns')
    const id = requiredDatabaseIdentifier(columns, 'id')
    const identifierColumn = requiredDatabaseIdentifier(columns, 'identifier')
    const contactEmail = optionalDatabaseIdentifier(columns, 'contactEmail')
    const createdAt = requiredDatabaseIdentifier(columns, 'createdAt')
    const updatedAt = requiredDatabaseIdentifier(columns, 'updatedAt')
    const verificationObject = objectFieldObject(identity, 'verification')
    const verificationMode = verificationObject
      ? requiredObjectString(verificationObject, 'mode')
      : undefined
    const verification =
      verificationMode === undefined
        ? ({ mode: 'unsupported' } as const)
        : verificationMode === 'trusted'
          ? ({ mode: 'trusted' } as const)
          : verificationMode === 'mapped'
            ? ({
                mode: 'mapped',
                column:
                  optionalDatabaseIdentifier(columns, 'verification') ??
                  fail(columns, 'Mapped raw verification requires columns.verification.'),
              } as const)
            : fail(verificationObject!, 'Raw verification mode must be mapped or trusted.')
    return {
      mode: 'login-only',
      source: 'table',
      table,
      columns: {
        id,
        identifier: identifierColumn,
        ...(contactEmail ? { contactEmail } : {}),
        createdAt,
        updatedAt,
      },
      identifier: { kind, normalization },
      verification,
      eligibility: compileEligibility(eligibilityObject, 'column', (column) => column),
      credentials,
      routes: {
        registration: false,
        verification: false,
        recovery: false,
        passwordChange: false,
      },
    }
  }

  function compileNormalization(
    object: ts.ObjectLiteralExpression,
  ): AuthenticationManifestEntry['identifier']['normalization'] {
    const preset = requiredObjectString(object, 'preset')
    if (preset === 'email-or-domain') {
      const domain = requiredObjectString(object, 'domain').trim().toLowerCase()
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        fail(object, 'email-or-domain normalization requires a valid domain literal.')
      }
      return { preset, domain }
    }
    if (preset !== 'exact' && preset !== 'lowercase' && preset !== 'email') {
      fail(object, 'Auth normalization preset must be exact, lowercase, email, or email-or-domain.')
    }
    return { preset }
  }

  function compileModelVerification(
    object: ts.ObjectLiteralExpression | undefined,
    model: ModelManifestEntry,
  ): AuthenticationManifestEntry['verification'] {
    if (!object) return { mode: 'unsupported' }
    const mode = requiredObjectString(object, 'mode')
    if (mode === 'trusted') return { mode }
    if (mode !== 'mapped') {
      fail(object, 'Auth verification mode must be mapped or trusted.')
    }
    const attribute = requiredObjectString(object, 'attribute')
    if (!model.attributes.includes(attribute)) {
      fail(object, `Auth verification attribute ${attribute} is not declared by ${model.name}.`)
    }
    return { mode, column: physicalModelColumn(model, attribute) }
  }

  function compileEligibility(
    property: ts.PropertyAssignment | undefined,
    key: 'attribute' | 'column',
    columnFor: (value: string) => string,
  ): readonly AuthenticationEligibilityPredicate[] {
    if (!property) return []
    const initializer = unwrapLiteralExpression(property.initializer)
    if (!ts.isArrayLiteralExpression(initializer)) {
      fail(property, 'Auth eligibility must be a literal predicate array.')
    }
    return initializer.elements.map((element) => {
      const object = unwrapLiteralExpression(element as ts.Expression)
      if (!ts.isObjectLiteralExpression(object)) {
        fail(element, 'Auth eligibility predicates must be literal objects.')
      }
      const source = requiredObjectString(object, key)
      const column = columnFor(source)
      if (!validIdentifier(column)) fail(object, `Auth eligibility column ${column} is invalid.`)
      const equals = objectField(object, 'equals')
      if (equals) return { column, equals: scalarJson(equals.initializer, equals) }
      const values = objectField(object, 'in')
      if (values) {
        const parsed = readJsonLiteral(values.initializer)
        if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isScalarJson)) {
          fail(values, 'Auth eligibility in must be a non-empty scalar literal array.')
        }
        return { column, in: parsed }
      }
      if (objectBoolean(object, 'null') === true) return { column, null: true }
      if (objectBoolean(object, 'notNull') === true) return { column, notNull: true }
      fail(object, 'Auth eligibility requires equals, in, null: true, or notNull: true.')
    })
  }

  function compileCredentials(
    object: ts.ObjectLiteralExpression,
  ): AuthenticationManifestEntry['credentials'] {
    const removedWrite = objectField(object, 'write')
    if (removedWrite) {
      fail(
        removedWrite,
        'credentials.write was removed; use credentials.upgrade with "never" or an in-place policy.',
      )
    }
    const table = requiredObjectString(object, 'table')
    if (!validQualifiedIdentifier(table)) fail(object, 'Auth credential table is invalid.')
    const identityId = requiredDatabaseIdentifier(object, 'identityId')
    const readersProperty = objectField(object, 'readers')
    const readersExpression = readersProperty
      ? unwrapLiteralExpression(readersProperty.initializer)
      : undefined
    if (
      !readersExpression ||
      !ts.isArrayLiteralExpression(readersExpression) ||
      readersExpression.elements.length === 0
    ) {
      fail(object, 'Auth credentials require at least one literal reader.')
    }
    const readers = readersExpression.elements.map((element) => {
      const reader = unwrapLiteralExpression(element as ts.Expression)
      if (!ts.isObjectLiteralExpression(reader))
        fail(element, 'Credential readers must be literal objects.')
      const preset = requiredObjectString(reader, 'preset')
      if (!['doxa-argon2id', 'bcrypt', 'argon2id-phc', 'sha256-hex'].includes(preset)) {
        fail(reader, `Unsupported credential reader ${preset}.`)
      }
      return {
        preset: preset as AuthenticationManifestEntry['credentials']['readers'][number]['preset'],
        hash: requiredDatabaseIdentifier(reader, 'hash'),
      }
    })
    const password = readers[0]!.hash
    if (readers.some((reader) => reader.hash !== password)) {
      fail(object, 'All auth credential readers must use the same authoritative password column.')
    }
    const upgradeProperty = objectField(object, 'upgrade')
    if (!upgradeProperty) {
      return {
        table,
        identityId,
        password,
        readers,
        upgrade: { mode: 'never' },
      }
    }
    const upgrade = unwrapLiteralExpression(upgradeProperty.initializer)
    if (ts.isStringLiteral(upgrade) && upgrade.text === 'never') {
      return {
        table,
        identityId,
        password,
        readers,
        upgrade: { mode: 'never' },
      }
    }
    if (!ts.isObjectLiteralExpression(upgrade)) {
      fail(upgrade, 'Credential upgrade must be "never" or an in-place policy object.')
    }
    if (requiredObjectString(upgrade, 'mode') !== 'in-place') {
      fail(upgrade, 'In-place is the only supported automatic credential upgrade mode.')
    }
    if (requiredObjectString(upgrade, 'format') !== 'doxa-argon2id') {
      fail(upgrade, 'Doxa Argon2id is the only supported credential upgrade format.')
    }
    const upgradePassword = requiredDatabaseIdentifier(upgrade, 'password')
    if (upgradePassword !== password) {
      fail(upgrade, 'Credential upgrades must replace the authoritative password column in place.')
    }
    if (!readers.some((reader) => reader.preset === 'doxa-argon2id')) {
      fail(upgrade, 'In-place credential upgrades require a doxa-argon2id reader.')
    }
    const updatedAt = optionalDatabaseIdentifier(upgrade, 'updatedAt')
    return {
      table,
      identityId,
      password,
      readers,
      upgrade: {
        mode: 'in-place',
        format: 'doxa-argon2id',
        password,
        ...(updatedAt ? { updatedAt } : {}),
      },
    }
  }

  function physicalModelColumn(model: ModelManifestEntry, attribute: string): string {
    if (model.storage.kind !== 'table')
      fail(applicationDeclaration, `${model.name} is not table-backed.`)
    if (attribute === 'id') return model.storage.primaryKey
    return model.storage.columns[attribute] ?? attribute
  }

  function registerConfigurations(
    declarations: readonly ts.ClassDeclaration[],
    ownerId: string,
  ): void {
    for (const declaration of declarations) {
      const existing = configurationByDeclaration.get(declaration)
      if (existing) {
        if (existing.ownerId !== ownerId) {
          fail(declaration, `Configuration ${existing.name} is declared by multiple owners.`)
        }
        continue
      }

      assertConfigurationDeclaration(declaration)
      const name = requiredClassName(declaration)
      const localId = toKebabCase(name.replace(/Config$/, ''))
      const id = `config:${ownerId}/${localId}`
      const properties = declaration.members
        .filter(ts.isPropertyDeclaration)
        .filter((property) => !hasModifier(property, ts.SyntaxKind.StaticKeyword))
        .map((property) =>
          compileConfigurationProperty(name, property, checker, normalized.projectRoot),
        )

      const entry: ConfigurationManifestEntry = {
        id,
        ownerId,
        name,
        exportName: name,
        source: sourceOf(declaration, normalized.projectRoot),
        properties,
      }
      configurations.push(entry)
      configurationByDeclaration.set(declaration, entry)
    }
  }

  function registerProvider(
    declaration: ts.ClassDeclaration,
    ownerId: string,
    role: 'provider' | 'service',
  ): ProviderManifestEntry {
    assertConcreteClass(declaration)
    const existing = providerByDeclaration.get(declaration)
    if (existing) {
      if (existing.ownerId !== ownerId) {
        fail(
          declaration,
          `Concrete service ${existing.name} is reachable across Feature boundaries without being provided explicitly.`,
        )
      }
      return existing
    }

    const name = requiredClassName(declaration)
    const lifecycle =
      role === 'service'
        ? {
            start: implementsNamedInterface(declaration, 'Starts', checker),
            drain: implementsNamedInterface(declaration, 'Drains', checker),
            stop: implementsNamedInterface(declaration, 'Stops', checker),
            dispose: implementsNamedInterface(declaration, 'Disposes', checker),
          }
        : lifecycleOf(declaration, checker)
    if (role === 'service' && (lifecycle.start || lifecycle.drain || lifecycle.stop)) {
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${name} may define dispose(), but ordinary services cannot own application lifecycle phases. See Gnosis guide role.service.`,
      )
    }
    const localId =
      role === 'provider' ? readRequiredStaticString(declaration, 'id') : toKebabCase(name)
    const id = `${role}:${ownerId}/${localId}`
    const placeholder: ProviderManifestEntry = {
      id,
      ownerId,
      name,
      exportName: name,
      role,
      scope:
        role === 'provider'
          ? 'singleton'
          : implementsNamedInterface(declaration, 'ExecutionScoped', checker)
            ? 'execution'
            : 'transient',
      durableIdentity: role === 'provider',
      capabilities: [
        ...(extendsNamedClass(declaration, 'Auth', checker) ? ['authentication' as const] : []),
        ...(extendsNamedClass(declaration, 'TransactionManager', checker)
          ? ['transactions' as const]
          : []),
        ...(extendsNamedClass(declaration, 'QueueManager', checker) ? ['queues' as const] : []),
        ...(extendsNamedClass(declaration, 'Cache', checker) ? ['cache' as const] : []),
        ...(extendsNamedClass(declaration, 'MailTransport', checker) ? ['mail' as const] : []),
        ...(extendsNamedClass(declaration, 'SmsTransport', checker) ? ['sms' as const] : []),
        ...(extendsNamedClass(declaration, 'BroadcastTransport', checker)
          ? ['broadcasting' as const]
          : []),
        ...(extendsNamedClass(declaration, 'Telemetry', checker) ? ['telemetry' as const] : []),
        ...(extendsNamedClass(declaration, 'ObservationRecorder', checker)
          ? ['observations' as const]
          : []),
      ],
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    providerByDeclaration.set(declaration, placeholder)
    providers.push(placeholder)

    const complete = { ...placeholder, dependencies: dependenciesFor(declaration, ownerId) }
    providerByDeclaration.set(declaration, complete)
    providers[providers.indexOf(placeholder)] = complete
    return complete
  }

  function dependenciesFor(
    declaration: ts.ClassDeclaration,
    ownerId: string,
    includeConstructorDependencies = true,
  ): readonly DependencyManifestEntry[] {
    const constructor = declaration.members.find(ts.isConstructorDeclaration)
    const frameworkRole = [
      'Action',
      'Query',
      'Route',
      'Listener',
      'Job',
      'Policy',
      'PermissionSource',
      'SignalHandler',
      'Observer',
      'Command',
    ].some((role) => extendsNamedClass(declaration, role, checker))
    if (
      includeConstructorDependencies &&
      frameworkRole &&
      constructor &&
      constructor.parameters.length > 0
    ) {
      fail(
        constructor,
        `${requiredClassName(declaration)} is a framework role; declare scoped dependencies with this.inject() instead of constructor parameters.`,
      )
    }
    const constructorDependencies = includeConstructorDependencies
      ? (constructor?.parameters.map((parameter) =>
          dependencyFor(
            parameter,
            parameter.name.getText(),
            Boolean(parameter.questionToken || parameter.initializer) ||
              includesUndefined(checker.getTypeAtLocation(parameter)),
            'constructor',
            classDeclarationForType(parameter, checker),
          ),
        ) ?? [])
      : []
    const injectionCalls: ts.CallExpression[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && roleInjectionKind(node)) {
        injectionCalls.push(node)
      }
      ts.forEachChild(node, visit)
    }
    declaration.members.forEach(visit)
    const roleDependencies = injectionCalls.map((call) => {
      const member = call.parent
      if (
        !ts.isPropertyDeclaration(member) ||
        member.initializer !== call ||
        member.parent !== declaration
      ) {
        fail(call, 'this.inject() must be the direct initializer of a role class property.')
      }
      const injectionKind = roleInjectionKind(call)
      if (!injectionKind || call.arguments.length !== 1) {
        fail(call, 'this.inject() requires exactly one statically identifiable dependency token.')
      }
      const name = propertyName(member.name)
      if (!name)
        fail(member, 'Injected role properties must use an identifier or string literal name.')
      const dependencyDeclaration = resolveClassReference(call.arguments[0]!, checker)
      return dependencyFor(call, name, injectionKind === 'optional', 'role', dependencyDeclaration)
    })
    return [...constructorDependencies, ...roleDependencies]

    function dependencyFor(
      source: ts.Node,
      parameter: string,
      optional: boolean,
      kind: DependencyManifestEntry['kind'],
      dependencyDeclaration: ts.ClassDeclaration | undefined,
    ): DependencyManifestEntry {
      let targetId: string | undefined

      if (dependencyDeclaration) {
        const builtinId = builtinIdForDeclaration(dependencyDeclaration)
        const capability = providerCapabilityForDeclaration(dependencyDeclaration)
        const capabilityProvider = capability
          ? providers.find((provider) => provider.capabilities.includes(capability))
          : undefined
        if (capability && !capabilityProvider && !optional) {
          fail(
            source,
            `${requiredClassName(dependencyDeclaration)} requires one selected ${capability} provider.`,
          )
        }
        const configuration = configurationByDeclaration.get(dependencyDeclaration)
        const providerRoot = providerRoots.get(dependencyDeclaration)
        const operationRoot = operationRoots.get(dependencyDeclaration)
        const modelRoot = modelRoots.get(dependencyDeclaration)
        const observerRoot = observerRoots.get(dependencyDeclaration)
        const routeRoot = routeRoots.get(dependencyDeclaration)
        const eventRoot = eventRoots.get(dependencyDeclaration)
        const listenerRoot = listenerRoots.get(dependencyDeclaration)
        const jobRoot = jobRoots.get(dependencyDeclaration)
        const scheduleRoot = scheduleRoots.get(dependencyDeclaration)
        const policyRoot = policyRoots.get(dependencyDeclaration)
        const permissionSourceRoot = permissionSourceRoots.get(dependencyDeclaration)
        const signalRoot = signalRoots.get(dependencyDeclaration)
        const signalHandlerRoot = signalHandlerRoots.get(dependencyDeclaration)
        const commandRoot = commandRoots.get(dependencyDeclaration)
        if (operationRoot) {
          fail(
            source,
            `${requiredClassName(dependencyDeclaration)} is an operation class; inject ActionBus or QueryBus instead.`,
          )
        }
        if (modelRoot) {
          fail(
            source,
            `${requiredClassName(dependencyDeclaration)} is a model class and is not a dependency; use its static retrieval API.`,
          )
        }
        if (
          routeRoot ||
          eventRoot ||
          listenerRoot ||
          jobRoot ||
          scheduleRoot ||
          policyRoot ||
          permissionSourceRoot ||
          observerRoot ||
          signalRoot ||
          signalHandlerRoot ||
          commandRoot
        ) {
          fail(
            source,
            `${requiredClassName(dependencyDeclaration)} is a framework role class and cannot be injected directly.`,
          )
        }
        if (providerRoot && providerRoot.ownerId !== ownerId) {
          fail(
            source,
            `${requiredClassName(dependencyDeclaration)} is private to Feature ${providerRoot.ownerId}.`,
          )
        }
        const abstractDependency = hasModifier(dependencyDeclaration, ts.SyntaxKind.AbstractKeyword)
        const sharedServiceRoot = sharedServiceRoots.get(dependencyDeclaration)
        targetId =
          builtinId ??
          capabilityProvider?.id ??
          configuration?.id ??
          (optional && abstractDependency
            ? undefined
            : registerProvider(
                dependencyDeclaration,
                providerRoot?.ownerId ?? sharedServiceRoot?.ownerId ?? ownerId,
                providerRoot ? 'provider' : 'service',
              ).id)
      }

      if (!targetId && !optional) {
        fail(
          source,
          `Required ${kind === 'role' ? 'role' : 'constructor'} dependency ${parameter} cannot be resolved to a declared configuration or concrete class.`,
        )
      }

      return {
        kind,
        parameter,
        token: dependencyDeclaration ? requiredClassName(dependencyDeclaration) : parameter,
        ...(targetId ? { targetId } : {}),
        optional,
        source: sourceOf(source, normalized.projectRoot),
      } satisfies DependencyManifestEntry
    }
  }

  function registerOperation(
    declaration: ts.ClassDeclaration,
    ownerId: string,
    role: 'action' | 'query',
  ): OperationManifestEntry {
    assertConcreteClass(declaration)
    const existing = operationByDeclaration.get(declaration)
    if (existing) {
      fail(declaration, `${existing.name} is declared more than once as an application operation.`)
    }
    if (!extendsNamedClass(declaration, role === 'action' ? 'Action' : 'Query', checker)) {
      fail(
        declaration,
        `${requiredClassName(declaration)} must extend ${role === 'action' ? 'Action' : 'Query'}.`,
      )
    }
    if (!checker.getTypeAtLocation(declaration).getProperty('handle')) {
      fail(declaration, `${requiredClassName(declaration)} must define handle(input).`)
    }

    const name = requiredClassName(declaration)
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${name} may define dispose(), but operation handlers cannot own application lifecycle phases. See Gnosis guide role.${role}.`,
      )
    }
    const entry: OperationManifestEntry = {
      id: `${role}:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      role,
      scope: 'transient',
      transactional: role === 'action',
      access: readAccess(declaration),
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    operationByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    operationByDeclaration.set(declaration, complete)
    const operations = role === 'action' ? actions : queries
    operations.push(complete)
    return complete
  }

  function registerOperationRoot(
    declaration: ts.ClassDeclaration,
    ownerId: string,
    role: 'action' | 'query',
  ): void {
    const existing = operationRoots.get(declaration)
    if (existing) {
      fail(
        declaration,
        `${requiredClassName(declaration)} is already declared as ${existing.role} by ${existing.ownerId}.`,
      )
    }
    operationRoots.set(declaration, { ownerId, role })
  }

  function registerOwnedRoots(
    feature: ts.ClassDeclaration,
    field:
      | 'routes'
      | 'events'
      | 'listeners'
      | 'jobs'
      | 'schedules'
      | 'policies'
      | 'signals'
      | 'signalHandlers'
      | 'observers'
      | 'commands'
      | 'realtimeCommands',
    ownerId: string,
    roots: Map<ts.ClassDeclaration, { readonly ownerId: string }>,
    role: string,
  ): void {
    for (const declaration of readClassArray(feature, field, checker)) {
      const existing = roots.get(declaration)
      if (existing) {
        fail(
          declaration,
          `${requiredClassName(declaration)} is already declared as a ${role} by ${existing.ownerId}.`,
        )
      }
      roots.set(declaration, { ownerId })
    }
  }

  function registerModel(declaration: ts.ClassDeclaration, ownerId: string): ModelManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Model', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Model.`)
    }
    const name = requiredClassName(declaration)
    const localId = readRequiredStaticString(declaration, 'id')
    const attributeTypes = compileModelAttributeTypes(declaration)
    const attributes = Object.keys(attributeTypes).sort((left, right) => left.localeCompare(right))
    const optionalAttributes = attributes.filter((attribute) => attributeTypes[attribute]!.optional)
    const entry: ModelManifestEntry = {
      id: `model:${ownerId}/${localId}`,
      ownerId,
      name,
      exportName: name,
      entityType: `model:${ownerId}/${localId}`,
      attributes,
      attributeTypes,
      relationships: [],
      storage: compileModelStorage(declaration, attributes, attributeTypes, optionalAttributes),
      source: sourceOf(declaration, normalized.projectRoot),
    }
    modelByDeclaration.set(declaration, entry)
    models.push(entry)
    return entry
  }

  function compileModelRelationships(
    declaration: ts.ClassDeclaration,
  ): readonly ModelRelationshipManifest[] {
    const property = staticProperty(declaration, 'relationships')
    if (!property) return []
    const initializer = property.initializer
      ? unwrapLiteralExpression(property.initializer)
      : undefined
    if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
      fail(property, `${requiredClassName(declaration)}.relationships must be a literal object.`)
    }
    return initializer.properties
      .map((member): ModelRelationshipManifest => {
        if (!ts.isPropertyAssignment(member)) {
          fail(member, 'Model relationships must use explicit property assignments.')
        }
        const name = propertyName(member.name)
        const call = unwrapLiteralExpression(member.initializer)
        if (!name || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) {
          fail(member, 'Model relationships must call a Doxa relationship helper directly.')
        }
        const helper = resolveNamedDeclaration(call.expression, checker)
        const kind = helper?.name?.text
        if (
          !helper ||
          !isCoreDeclaration(helper) ||
          !kind ||
          !['belongsTo', 'hasOne', 'hasMany', 'belongsToMany'].includes(kind)
        ) {
          fail(call, 'Model relationships must call a Doxa relationship helper directly.')
        }
        const related = resolveModelReference(call.arguments[0], checker)
        const relatedEntry = related ? modelByDeclaration.get(related) : undefined
        if (!relatedEntry) {
          fail(call, `${name} must reference a model selected by an application Feature.`)
        }
        const options = relationshipOptions(call.arguments[1], name, call)
        if (kind === 'belongsTo') {
          return {
            name,
            kind,
            relatedModelId: relatedEntry.id,
            foreignKey: relationshipString(options, 'foreignKey', name),
            ownerKey: relationshipString(options, 'ownerKey', name, 'id'),
          }
        }
        if (kind === 'hasOne' || kind === 'hasMany') {
          return {
            name,
            kind,
            relatedModelId: relatedEntry.id,
            localKey: relationshipString(options, 'localKey', name, 'id'),
            foreignKey: relationshipString(options, 'foreignKey', name),
          }
        }
        const through = resolveModelReference(
          relationshipProperty(options, 'through', name).initializer,
          checker,
        )
        const throughEntry = through ? modelByDeclaration.get(through) : undefined
        if (!throughEntry) {
          fail(call, `${name}.through must reference a model selected by an application Feature.`)
        }
        return {
          name,
          kind: 'belongsToMany',
          relatedModelId: relatedEntry.id,
          throughModelId: throughEntry.id,
          localKey: relationshipString(options, 'localKey', name, 'id'),
          relatedKey: relationshipString(options, 'relatedKey', name, 'id'),
          foreignKey: relationshipString(options, 'foreignKey', name),
          relatedForeignKey: relationshipString(options, 'relatedForeignKey', name),
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  function relationshipOptions(
    node: ts.Expression | undefined,
    name: string,
    source: ts.Node,
  ): ts.ObjectLiteralExpression {
    const unwrapped = node ? unwrapLiteralExpression(node) : undefined
    if (!unwrapped || !ts.isObjectLiteralExpression(unwrapped)) {
      fail(node ?? source, `${name} relationship options must be a literal object.`)
    }
    for (const property of unwrapped.properties) {
      if (!ts.isPropertyAssignment(property) || !propertyName(property.name)) {
        fail(property, `${name} relationship options must use explicit property assignments.`)
      }
    }
    return unwrapped
  }

  function relationshipProperty(
    options: ts.ObjectLiteralExpression,
    key: string,
    relationship: string,
  ): ts.PropertyAssignment {
    const property = options.properties.find(
      (entry): entry is ts.PropertyAssignment =>
        ts.isPropertyAssignment(entry) && propertyName(entry.name) === key,
    )
    if (!property) fail(options, `${relationship}.${key} is required.`)
    return property
  }

  function relationshipString(
    options: ts.ObjectLiteralExpression,
    key: string,
    relationship: string,
    fallback?: string,
  ): string {
    const property = options.properties.find(
      (entry): entry is ts.PropertyAssignment =>
        ts.isPropertyAssignment(entry) && propertyName(entry.name) === key,
    )
    if (!property) {
      if (fallback !== undefined) return fallback
      fail(options, `${relationship}.${key} is required.`)
    }
    const value = unwrapLiteralExpression(property.initializer)
    if (!ts.isStringLiteral(value) || value.text.length === 0) {
      fail(property, `${relationship}.${key} must be a non-empty string literal.`)
    }
    return value.text
  }

  function compileModelAttributeTypes(
    declaration: ts.ClassDeclaration,
  ): ModelManifestEntry['attributeTypes'] {
    const symbol = declaration.name ? checker.getSymbolAtLocation(declaration.name) : undefined
    if (!symbol) fail(declaration, 'Model attributes could not be resolved.')
    const modelType = checker.getDeclaredTypeOfSymbol(symbol)
    const attributes = modelAttributeType(modelType)
    if (!attributes) {
      fail(declaration, `${requiredClassName(declaration)} must declare Model attribute types.`)
    }
    const entries = checker
      .getPropertiesOfType(attributes)
      .filter((property) => validIdentifier(property.name))
      .map((property) => {
        const source = property.valueDeclaration ?? property.declarations?.[0] ?? declaration
        const type = checker.getTypeOfSymbolAtLocation(property, source)
        const members = type.isUnion() ? type.types : [type]
        const nullable = members.some((member) => (member.flags & ts.TypeFlags.Null) !== 0)
        const optional =
          (property.flags & ts.SymbolFlags.Optional) !== 0 ||
          members.some((member) => (member.flags & ts.TypeFlags.Undefined) !== 0)
        const values = members.filter(
          (member) => (member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0,
        )
        const kind = modelAttributeKind(values)
        return [
          property.name,
          {
            kind,
            nullable,
            optional,
          },
        ] as const
      })
      .sort(([left], [right]) => left.localeCompare(right))
    if (!entries.some(([name]) => name === 'id')) {
      fail(declaration, `${requiredClassName(declaration)} model attributes must include id.`)
    }
    return Object.fromEntries(entries)
  }

  function modelAttributeKind(
    types: readonly ts.Type[],
  ): ModelManifestEntry['attributeTypes'][string]['kind'] {
    if (
      types.length > 0 &&
      types.every(
        (type) =>
          (type.flags &
            (ts.TypeFlags.String | ts.TypeFlags.StringLiteral | ts.TypeFlags.TemplateLiteral)) !==
          0,
      )
    )
      return 'string'
    if (
      types.length > 0 &&
      types.every((type) => (type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) !== 0)
    )
      return 'number'
    if (
      types.length > 0 &&
      types.every(
        (type) => (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0,
      )
    )
      return 'boolean'
    if (types.length > 0 && types.every((type) => type.getSymbol()?.name === 'Date')) return 'date'
    return 'json'
  }

  function modelAttributeType(type: ts.Type): ts.Type | undefined {
    for (const base of checker.getBaseTypes(type as ts.InterfaceType)) {
      const declaration = base.getSymbol()?.declarations?.[0]
      if (base.getSymbol()?.name === 'Model' && declaration && isCoreDeclaration(declaration)) {
        return checker.getTypeArguments(base as ts.TypeReference)[0]
      }
      const nested = modelAttributeType(base)
      if (nested) return nested
    }
    return undefined
  }

  function compileModelStorage(
    declaration: ts.ClassDeclaration,
    attributes: readonly string[],
    attributeTypes: ModelManifestEntry['attributeTypes'],
    optionalAttributes: readonly string[],
  ): ModelManifestEntry['storage'] {
    const tableValue = readOptionalStaticJson(declaration, 'table')
    if (tableValue === undefined) {
      if (staticProperty(declaration, 'managed') || staticProperty(declaration, 'readOnly')) {
        fail(
          declaration,
          `${requiredClassName(declaration)} may declare managed or readOnly only when static table is present.`,
        )
      }
      return { kind: 'entity-state' }
    }
    if (typeof tableValue !== 'string' || !validQualifiedIdentifier(tableValue)) {
      fail(
        declaration,
        `${requiredClassName(declaration)}.table must be a literal PostgreSQL table name.`,
      )
    }
    const columnsValue = readOptionalStaticJson(declaration, 'columns') ?? {}
    if (!isStringRecord(columnsValue)) {
      fail(
        declaration,
        `${requiredClassName(declaration)}.columns must be a literal attribute-to-column string object.`,
      )
    }
    for (const [attribute, column] of Object.entries(columnsValue)) {
      if (!validIdentifier(attribute) || !validIdentifier(column)) {
        fail(
          declaration,
          `${requiredClassName(declaration)}.columns contains an invalid attribute or PostgreSQL column name.`,
        )
      }
      if (!attributes.includes(attribute)) {
        fail(
          declaration,
          `${requiredClassName(declaration)}.columns maps undeclared attribute ${attribute}.`,
        )
      }
    }
    const primaryKeyValue =
      readOptionalStaticJson(declaration, 'primaryKey') ?? columnsValue.id ?? 'id'
    if (typeof primaryKeyValue !== 'string' || !validIdentifier(primaryKeyValue)) {
      fail(
        declaration,
        `${requiredClassName(declaration)}.primaryKey must be a literal PostgreSQL column name.`,
      )
    }
    const versionValue = readOptionalStaticJson(declaration, 'versionColumn')
    if (
      versionValue !== undefined &&
      (typeof versionValue !== 'string' || !validIdentifier(versionValue))
    ) {
      fail(
        declaration,
        `${requiredClassName(declaration)}.versionColumn must be a literal PostgreSQL column name.`,
      )
    }
    const timestampsValue = readOptionalStaticJson(declaration, 'timestamps') ?? false
    let timestamps: false | { readonly createdAt: string; readonly updatedAt: string }
    if (timestampsValue === false) timestamps = false
    else if (timestampsValue === true)
      timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' }
    else if (
      isStringRecord(timestampsValue) &&
      typeof timestampsValue.createdAt === 'string' &&
      validIdentifier(timestampsValue.createdAt) &&
      typeof timestampsValue.updatedAt === 'string' &&
      validIdentifier(timestampsValue.updatedAt)
    ) {
      timestamps = { createdAt: timestampsValue.createdAt, updatedAt: timestampsValue.updatedAt }
    } else {
      fail(
        declaration,
        `${requiredClassName(declaration)}.timestamps must be false, true, or { createdAt, updatedAt } column names.`,
      )
    }
    const columns = Object.fromEntries(
      attributes.map((attribute) => [
        attribute,
        attribute === 'id' ? primaryKeyValue : (columnsValue[attribute] ?? attribute),
      ]),
    )
    const duplicateColumn = Object.values(columns).find(
      (column, index, all) => all.indexOf(column) !== index,
    )
    if (duplicateColumn) {
      fail(
        declaration,
        `${requiredClassName(declaration)} maps more than one attribute to physical column ${duplicateColumn}.`,
      )
    }
    const managed = readOptionalStaticBoolean(declaration, 'managed', true)
    const readOnly = readOptionalStaticBoolean(declaration, 'readOnly', false)
    return {
      kind: 'table',
      table: tableValue,
      primaryKey: primaryKeyValue,
      columns,
      attributeTypes,
      ...(optionalAttributes.length > 0 ? { optionalAttributes } : {}),
      ...(typeof versionValue === 'string' ? { versionColumn: versionValue } : {}),
      versionSource:
        typeof versionValue === 'string'
          ? { kind: 'column', column: versionValue }
          : readOnly
            ? { kind: 'none' }
            : { kind: 'xmin' },
      timestamps,
      managed,
      readOnly,
    }
  }

  function registerObserver(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): ObserverManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Observer', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Observer.`)
    }
    const phaseNames = [
      'retrieved',
      'saving',
      'creating',
      'updating',
      'created',
      'updated',
      'saved',
      'committed',
    ] as const
    const methods = declaration.members.filter(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) &&
        phaseNames.includes(propertyName(member.name) as (typeof phaseNames)[number]),
    )
    if (methods.length === 0) {
      fail(
        declaration,
        `${requiredClassName(declaration)} must define at least one model lifecycle method.`,
      )
    }
    let model: ModelManifestEntry | undefined
    for (const method of methods) {
      if (method.parameters.length !== 1) {
        fail(
          method,
          `Observer method ${propertyName(method.name)} must accept one typed model parameter.`,
        )
      }
      const modelDeclaration = classDeclarationForType(method.parameters[0]!, checker)
      const candidate = modelDeclaration ? modelByDeclaration.get(modelDeclaration) : undefined
      if (!candidate) {
        fail(
          method.parameters[0]!,
          'Observer lifecycle methods must name a Model declared by a selected Feature.',
        )
      }
      if (model && model.id !== candidate.id) {
        fail(method, `${requiredClassName(declaration)} cannot observe more than one Model.`)
      }
      model = candidate
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop || lifecycle.dispose) {
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${requiredClassName(declaration)} cannot own container lifecycle phases. See Gnosis guide role.observer.`,
      )
    }
    const name = requiredClassName(declaration)
    const entry: ObserverManifestEntry = {
      id: `observer:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      modelId: model!.id,
      phases: methods.map((method) => propertyName(method.name) as (typeof phaseNames)[number]),
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    observerByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    observerByDeclaration.set(declaration, complete)
    observers.push(complete)
    return complete
  }

  function registerEvent(declaration: ts.ClassDeclaration, ownerId: string): EventManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Event', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Event.`)
    }
    const name = requiredClassName(declaration)
    const payloadVersion = readOptionalStaticNumber(declaration, 'version', 1)
    if (!Number.isInteger(payloadVersion) || payloadVersion < 1) {
      fail(declaration, `${name}.version must be a positive integer.`)
    }
    let domain: EventManifestEntry['domain'] = false
    if (extendsNamedClass(declaration, 'DomainEvent', checker)) {
      const modelDeclaration = readRequiredStaticClass(declaration, 'model', checker)
      const model = modelByDeclaration.get(modelDeclaration)
      if (!model) {
        fail(declaration, `${name}.model must name a Model declared by a selected Feature.`)
      }
      domain = { entityType: model.entityType }
    }
    const entry: EventManifestEntry = {
      id: `event:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      payloadVersion,
      dispatch: implementsNamedInterface(declaration, 'ShouldDispatchAfterCommit', checker)
        ? 'after-commit'
        : 'immediate',
      broadcast: implementsNamedInterface(declaration, 'ShouldBroadcastNow', checker)
        ? 'now'
        : implementsNamedInterface(declaration, 'ShouldBroadcast', checker)
          ? 'queued'
          : false,
      domain,
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: dependenciesFor(declaration, ownerId, false),
    }
    eventByDeclaration.set(declaration, entry)
    events.push(entry)
    return entry
  }

  function registerListener(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): ListenerManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Listener', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Listener.`)
    }
    const handle = declaration.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) && propertyName(member.name) === 'handle',
    )
    if (!handle || handle.parameters.length !== 1) {
      fail(
        declaration,
        `${requiredClassName(declaration)} must define handle(event) with one typed event parameter.`,
      )
    }
    const eventDeclaration = classDeclarationForType(handle.parameters[0]!, checker)
    const event = eventDeclaration ? eventByDeclaration.get(eventDeclaration) : undefined
    if (!event) {
      fail(
        handle.parameters[0]!,
        'Listener handle(event) must name an Event declared by a selected Feature.',
      )
    }
    const queuedAfterCommit = implementsNamedInterface(
      declaration,
      'ShouldQueueAfterCommit',
      checker,
    )
    const queued =
      queuedAfterCommit || implementsNamedInterface(declaration, 'ShouldQueue', checker)
    const afterCommit = implementsNamedInterface(
      declaration,
      'ShouldHandleEventsAfterCommit',
      checker,
    )
    if (queued && afterCommit) {
      fail(
        declaration,
        `${requiredClassName(declaration)} cannot combine queued and local after-commit capabilities.`,
      )
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${requiredClassName(declaration)} may define dispose(), but listeners cannot own application lifecycle phases. See Gnosis guide role.listener.`,
      )
    }
    const name = requiredClassName(declaration)
    const entry: ListenerManifestEntry = {
      id: `listener:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      eventId: event.id,
      delivery: queuedAfterCommit
        ? 'queued-after-commit'
        : queued
          ? 'queued'
          : afterCommit
            ? 'after-commit'
            : 'local',
      access: readAccess(declaration),
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    listenerByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    listenerByDeclaration.set(declaration, complete)
    listeners.push(complete)
    return complete
  }

  function registerRoute(declaration: ts.ClassDeclaration, ownerId: string): RouteManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Route', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Route.`)
    }
    const method = readRequiredInstanceString(declaration, 'method').toUpperCase()
    if (!['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'].includes(method)) {
      fail(declaration, `${requiredClassName(declaration)}.method is not a supported HTTP method.`)
    }
    const routePath = readRequiredInstanceString(declaration, 'path')
    if (!routePath.startsWith('/')) {
      fail(declaration, `${requiredClassName(declaration)}.path must begin with /.`)
    }
    const handle = declaration.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) && propertyName(member.name) === 'handle',
    )
    if (!handle || handle.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define handle(request).`)
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${requiredClassName(declaration)} may define dispose(), but routes cannot own application lifecycle phases. See Gnosis guide role.route.`,
      )
    }
    const name = requiredClassName(declaration)
    const access = readRequiredStaticString(declaration, 'access')
    if (access !== 'public' && !/^[a-z][a-z0-9._:-]{1,127}$/.test(access)) {
      fail(declaration, `${name}.access must be "public" or a stable ability name.`)
    }
    const entry: RouteManifestEntry = {
      id: `route:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      method: method as RouteManifestEntry['method'],
      path: routePath,
      access,
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    routeByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    routeByDeclaration.set(declaration, complete)
    routes.push(complete)
    return complete
  }

  function registerJob(declaration: ts.ClassDeclaration, ownerId: string): JobManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Job', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Job.`)
    }
    const handle = declaration.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) && propertyName(member.name) === 'handle',
    )
    if (!handle || handle.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define handle(input).`)
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${requiredClassName(declaration)} may define dispose(), but jobs cannot own application lifecycle phases. See Gnosis guide role.job.`,
      )
    }
    const name = requiredClassName(declaration)
    const retries = readOptionalStaticNumber(declaration, 'retries', 3)
    const retryDelay = readOptionalStaticNumber(declaration, 'retryDelay', 1)
    const timeout = readOptionalStaticNumber(declaration, 'timeout', 30)
    if (!Number.isInteger(retries) || retries < 0) {
      fail(declaration, `${name}.retries must be a non-negative integer.`)
    }
    if (!Number.isFinite(retryDelay) || retryDelay < 0) {
      fail(declaration, `${name}.retryDelay must be a non-negative number.`)
    }
    if (!Number.isFinite(timeout) || timeout < 1) {
      fail(declaration, `${name}.timeout must be at least one second.`)
    }
    const entry: JobManifestEntry = {
      id: `job:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      scope: 'transient',
      retries,
      retryDelay,
      backoff: readOptionalStaticBoolean(declaration, 'backoff', true),
      timeout,
      access: readAccess(declaration),
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    jobByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    jobByDeclaration.set(declaration, complete)
    jobs.push(complete)
    return complete
  }

  function registerSchedule(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): ScheduleManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Schedule', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Schedule.`)
    }
    const jobDeclaration = readRequiredStaticClass(declaration, 'job', checker)
    const job = jobByDeclaration.get(jobDeclaration)
    if (!job)
      fail(
        declaration,
        `${requiredClassName(declaration)}.job must name a Job declared by a selected Feature.`,
      )
    const cron = readOptionalStaticString(declaration, 'cron')
    const everySeconds = readOptionalStaticNumberValue(declaration, 'everySeconds')
    if ((cron === undefined) === (everySeconds === undefined)) {
      fail(
        declaration,
        `${requiredClassName(declaration)} must declare exactly one of static cron or static everySeconds.`,
      )
    }
    if (cron !== undefined && cron.trim().split(/\s+/).length !== 5) {
      fail(
        declaration,
        `${requiredClassName(declaration)}.cron must use a five-field cron expression.`,
      )
    }
    if (everySeconds !== undefined && (!Number.isInteger(everySeconds) || everySeconds < 1)) {
      fail(
        declaration,
        `${requiredClassName(declaration)}.everySeconds must be a positive integer.`,
      )
    }
    const timeZone = readOptionalStaticString(declaration, 'timeZone') ?? 'UTC'
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format()
    } catch {
      fail(
        declaration,
        `${requiredClassName(declaration)}.timeZone must be a valid IANA time-zone name.`,
      )
    }
    const overlap = readOptionalStaticString(declaration, 'overlap') ?? 'serialize'
    if (overlap !== 'allow' && overlap !== 'serialize') {
      fail(declaration, `${requiredClassName(declaration)}.overlap must be "allow" or "serialize".`)
    }
    const misfire = readOptionalStaticString(declaration, 'misfire') ?? 'skip'
    if (misfire !== 'skip' && misfire !== 'catch-up-once') {
      fail(
        declaration,
        `${requiredClassName(declaration)}.misfire must be "skip" or "catch-up-once".`,
      )
    }
    const entry: ScheduleManifestEntry = {
      id: `schedule:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name: requiredClassName(declaration),
      exportName: requiredClassName(declaration),
      jobId: job.id,
      cadence:
        cron !== undefined
          ? { kind: 'cron', expression: cron }
          : { kind: 'interval', seconds: everySeconds! },
      timeZone,
      overlap,
      misfire,
      input: readOptionalStaticJson(declaration, 'input') ?? null,
      access: readAccess(declaration),
      source: sourceOf(declaration, normalized.projectRoot),
    }
    scheduleByDeclaration.set(declaration, entry)
    schedules.push(entry)
    return entry
  }

  function registerPolicy(declaration: ts.ClassDeclaration, ownerId: string): PolicyManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Policy', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Policy.`)
    }
    const decide = declaration.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) && propertyName(member.name) === 'decide',
    )
    if (!decide || decide.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define decide(request).`)
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${requiredClassName(declaration)} may define dispose(), but policies cannot own application lifecycle phases. See Gnosis guide role.policy.`,
      )
    }
    const name = requiredClassName(declaration)
    const abilities = readRequiredStaticStringArray(declaration, 'abilities')
    if (abilities.length === 0)
      fail(declaration, `${name}.abilities must contain at least one ability.`)
    for (const ability of abilities) assertAbilityName(declaration, ability)
    const entry: PolicyManifestEntry = {
      id: `policy:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      scope: 'transient',
      abilities: [...new Set(abilities)].sort(),
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    policyByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    policyByDeclaration.set(declaration, complete)
    policies.push(complete)
    return complete
  }

  function registerPermissionSource(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): PermissionSourceManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'PermissionSource', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend PermissionSource.`)
    }
    const resolve = declaration.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) && propertyName(member.name) === 'resolve',
    )
    if (!resolve || resolve.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define resolve(request).`)
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${requiredClassName(declaration)} may define dispose(), but permission sources cannot own application lifecycle phases. See Gnosis guide role.permission-source.`,
      )
    }
    const name = requiredClassName(declaration)
    const abilities = readRequiredStaticStringArray(declaration, 'abilities')
    if (abilities.length === 0) {
      fail(declaration, `${name}.abilities must contain at least one ability.`)
    }
    if (new Set(abilities).size !== abilities.length) {
      fail(declaration, `${name}.abilities must not contain duplicates.`)
    }
    for (const ability of abilities) assertAbilityName(declaration, ability)
    const entry: PermissionSourceManifestEntry = {
      id: `permission-source:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      scope: 'execution',
      abilities: [...new Set(abilities)].sort(),
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    permissionSourceByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    permissionSourceByDeclaration.set(declaration, complete)
    return complete
  }

  function registerSignal(declaration: ts.ClassDeclaration, ownerId: string): SignalManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Signal', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend Signal.`)
    }
    const name = requiredClassName(declaration)
    const entry: SignalManifestEntry = {
      id: `signal:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: dependenciesFor(declaration, ownerId, false),
    }
    signalByDeclaration.set(declaration, entry)
    signals.push(entry)
    return entry
  }

  function registerSignalHandler(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): SignalHandlerManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'SignalHandler', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend SignalHandler.`)
    }
    const handle = declaration.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) && propertyName(member.name) === 'handle',
    )
    if (!handle || handle.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define handle(signal).`)
    }
    const signalDeclaration = classDeclarationForType(handle.parameters[0]!, checker)
    const signal = signalDeclaration ? signalByDeclaration.get(signalDeclaration) : undefined
    if (!signal)
      fail(
        handle.parameters[0]!,
        'SignalHandler handle(signal) must name a Signal declared by a selected Feature.',
      )
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${requiredClassName(declaration)} may define dispose(), but signal handlers cannot own lifecycle phases. See Gnosis guide role.signal-handler.`,
      )
    }
    const name = requiredClassName(declaration)
    const entry: SignalHandlerManifestEntry = {
      id: `signal-handler:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      signalId: signal.id,
      access: readAccess(declaration),
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    signalHandlerByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    signalHandlerByDeclaration.set(declaration, complete)
    signalHandlers.push(complete)
    return complete
  }

  function registerCommand(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): CommandManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'Command', checker))
      fail(declaration, `${requiredClassName(declaration)} must extend Command.`)
    const handle = declaration.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) && propertyName(member.name) === 'handle',
    )
    if (!handle || handle.parameters.length !== 1)
      fail(declaration, `${requiredClassName(declaration)} must define handle(arguments_).`)
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop)
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${requiredClassName(declaration)} may define dispose(), but commands cannot own application lifecycle phases. See Gnosis guide role.command.`,
      )
    const name = requiredClassName(declaration)
    const command = readRequiredStaticString(declaration, 'name')
    if (!/^[a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)*$/.test(command))
      fail(declaration, `${name}.name must be a stable colon-delimited command name.`)
    const entry: CommandManifestEntry = {
      id: `command:${ownerId}/${readRequiredStaticString(declaration, 'id')}`,
      ownerId,
      name,
      exportName: name,
      command,
      description: readOptionalStaticString(declaration, 'description') ?? '',
      access: readAccess(declaration),
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    commandByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    commandByDeclaration.set(declaration, complete)
    commands.push(complete)
    return complete
  }

  function registerRealtimeCommand(
    declaration: ts.ClassDeclaration,
    ownerId: string,
  ): RealtimeCommandManifestEntry {
    assertConcreteClass(declaration)
    if (!extendsNamedClass(declaration, 'RealtimeCommand', checker)) {
      fail(declaration, `${requiredClassName(declaration)} must extend RealtimeCommand.`)
    }
    const handle = declaration.members.find(
      (member): member is ts.MethodDeclaration =>
        ts.isMethodDeclaration(member) && propertyName(member.name) === 'handle',
    )
    if (!handle || handle.parameters.length !== 1) {
      fail(declaration, `${requiredClassName(declaration)} must define handle(input).`)
    }
    const lifecycle = lifecycleOf(declaration, checker)
    if (lifecycle.start || lifecycle.drain || lifecycle.stop) {
      fail(
        declaration,
        `[DOXA-COMPILER-LIFECYCLE-001] ${requiredClassName(declaration)} may define dispose(), but realtime commands cannot own application lifecycle phases. See Gnosis guide role.realtime-command.`,
      )
    }
    const name = requiredClassName(declaration)
    const command = readRequiredStaticString(declaration, 'id')
    if (!/^[a-z][a-z0-9._:-]{1,127}$/.test(command)) {
      fail(declaration, `${name}.id must be a stable realtime command name.`)
    }
    const access = readAccess(declaration)
    if (access === 'public') {
      fail(declaration, `${name}.access must require an authenticated ability.`)
    }
    const schema = staticProperty(declaration, 'schema')
    if (!schema?.initializer) {
      fail(declaration, `${name} must declare a static Standard Schema as schema.`)
    }
    const schemaType = checker.getTypeAtLocation(schema.initializer)
    if (!schemaType.getProperty('~standard')) {
      fail(schema, `${name}.schema must implement the Standard Schema contract.`)
    }
    const throttle = readRealtimeCommandThrottle(declaration)
    const timeoutMs = readOptionalStaticNumber(declaration, 'timeoutMs', 2_000)
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) {
      fail(declaration, `${name}.timeoutMs must be an integer from 1 through 10000.`)
    }
    const entry: RealtimeCommandManifestEntry = {
      id: `realtime-command:${ownerId}/${command}`,
      ownerId,
      name,
      exportName: name,
      command,
      access,
      throttle,
      timeoutMs,
      scope: 'transient',
      source: sourceOf(declaration, normalized.projectRoot),
      dependencies: [],
      lifecycle,
    }
    realtimeCommandByDeclaration.set(declaration, entry)
    const complete = { ...entry, dependencies: dependenciesFor(declaration, ownerId) }
    realtimeCommandByDeclaration.set(declaration, complete)
    realtimeCommands.push(complete)
    return complete
  }
}

interface NormalizedOptions {
  readonly tsconfigPath: string
  readonly applicationFile: string
  readonly sourceRoot: string
  readonly outputRoot: string
  readonly artifactsDirectory: string
  readonly frameworkFile?: string
  readonly applicationExport: string
  readonly projectRoot: string
}

function normalizeOptions(options: CompileApplicationOptions): NormalizedOptions {
  const tsconfigPath = path.resolve(options.tsconfigPath)
  return {
    tsconfigPath,
    applicationFile: path.resolve(options.applicationFile),
    sourceRoot: path.resolve(options.sourceRoot),
    outputRoot: path.resolve(options.outputRoot),
    artifactsDirectory: path.resolve(options.artifactsDirectory),
    ...(options.frameworkFile ? { frameworkFile: path.resolve(options.frameworkFile) } : {}),
    applicationExport: options.applicationExport ?? 'Application',
    projectRoot: path.dirname(tsconfigPath),
  }
}

async function installedCompilerVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown }
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new DoxaCompilationError('The installed Doxa compiler package has no valid version.')
  }
  return packageJson.version
}

function createProgram(tsconfigPath: string): ts.Program {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    throw new DoxaCompilationError(formatDiagnostics([configFile.error]))
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
  )
  if (parsed.errors.length > 0) {
    throw new DoxaCompilationError(formatDiagnostics(parsed.errors))
  }
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
}

function assertValidProgram(program: ts.Program): void {
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length > 0) {
    throw new DoxaCompilationError(formatDiagnostics(diagnostics))
  }
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  })
}

function findExportedClass(source: ts.SourceFile, exportName: string): ts.ClassDeclaration {
  const declaration = source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) &&
      statement.name?.text === exportName &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword),
  )
  if (!declaration) {
    throw new DoxaCompilationError(
      `Expected exported Application class ${exportName} in ${source.fileName}.`,
    )
  }
  return declaration
}

function assertDeclarationOnly(
  declaration: ts.ClassDeclaration,
  kind: 'Application' | 'Feature',
): void {
  for (const member of declaration.members) {
    if (!ts.isPropertyDeclaration(member)) {
      fail(member, `${kind} declarations may contain declarative fields only.`)
    }
    const name = propertyName(member.name)
    if (
      !name ||
      !DECLARATION_FIELDS.has(name) ||
      hasModifier(member, ts.SyntaxKind.StaticKeyword)
    ) {
      fail(
        member,
        `${kind} field ${name ?? member.name.getText()} is not a supported declaration field.`,
      )
    }
  }
}

function assertConfigurationDeclaration(declaration: ts.ClassDeclaration): void {
  for (const member of declaration.members) {
    if (!ts.isPropertyDeclaration(member) || hasModifier(member, ts.SyntaxKind.StaticKeyword)) {
      fail(member, 'Configuration declarations may contain instance properties only.')
    }
  }
}

function readClassArray(
  declaration: ts.ClassDeclaration,
  name: string,
  checker: ts.TypeChecker,
): readonly ts.ClassDeclaration[] {
  const property = findInstanceProperty(declaration, name)
  if (!property) return []
  if (!property.initializer || !ts.isArrayLiteralExpression(property.initializer)) {
    fail(property, `${name} must be a literal array of direct class references.`)
  }
  return property.initializer.elements.map((element) => {
    if (ts.isSpreadElement(element)) {
      fail(element, `${name} may not contain spread elements.`)
    }
    const resolved = resolveClassReference(element, checker)
    if (!resolved) fail(element, `${element.getText()} does not resolve to a class declaration.`)
    return resolved
  })
}

function readStringArray(declaration: ts.ClassDeclaration, name: string): readonly string[] {
  const property = findInstanceProperty(declaration, name)
  if (!property) return []
  const initializer = property.initializer
    ? unwrapLiteralExpression(property.initializer)
    : undefined
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    fail(property, `${name} must be a literal string array.`)
  }
  return initializer.elements.map((element) => {
    if (!ts.isStringLiteral(element)) fail(element, `${name} must contain string literals only.`)
    return element.text
  })
}

function unwrapLiteralExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function failSource(message: string): never {
  throw new DoxaCompilationError(message)
}

function resolveClassReference(
  node: ts.Expression,
  checker: ts.TypeChecker,
): ts.ClassDeclaration | undefined {
  let symbol = checker.getSymbolAtLocation(node)
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol)
  }
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
  return declaration && ts.isClassDeclaration(declaration) ? declaration : undefined
}

function resolveModelReference(
  node: ts.Expression | undefined,
  checker: ts.TypeChecker,
): ts.ClassDeclaration | undefined {
  if (!node) return undefined
  const reference = unwrapLiteralExpression(node)
  if (!ts.isArrowFunction(reference) && !ts.isFunctionExpression(reference)) return undefined
  const statement = ts.isBlock(reference.body) ? reference.body.statements.at(0) : undefined
  const returned = ts.isBlock(reference.body)
    ? reference.body.statements.length === 1 && statement && ts.isReturnStatement(statement)
      ? statement.expression
      : undefined
    : reference.body
  return returned ? resolveClassReference(unwrapLiteralExpression(returned), checker) : undefined
}

function classDeclarationForType(
  parameter: ts.ParameterDeclaration,
  checker: ts.TypeChecker,
): ts.ClassDeclaration | undefined {
  const type = checker.getNonNullableType(checker.getTypeAtLocation(parameter))
  const symbol = type.getSymbol()
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
  return declaration && ts.isClassDeclaration(declaration) ? declaration : undefined
}

function roleInjectionKind(call: ts.CallExpression): 'required' | 'optional' | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined
  if (
    call.expression.name.text === 'inject' &&
    call.expression.expression.kind === ts.SyntaxKind.ThisKeyword
  )
    return 'required'
  const receiver = call.expression.expression
  return call.expression.name.text === 'optional' &&
    ts.isPropertyAccessExpression(receiver) &&
    receiver.name.text === 'inject' &&
    receiver.expression.kind === ts.SyntaxKind.ThisKeyword
    ? 'optional'
    : undefined
}

function compileConfigurationProperty(
  configurationName: string,
  property: ts.PropertyDeclaration,
  checker: ts.TypeChecker,
  projectRoot: string,
): ConfigurationPropertyManifest {
  const name = propertyName(property.name)
  if (!name) fail(property, 'Configuration property names must be identifiers or string literals.')
  const type = checker.getTypeAtLocation(property)
  const nonNullable = checker.getNonNullableType(type)
  const secret = isNamedCoreType(nonNullable, 'SecretString')
  const literalValues = literalUnionValues(nonNullable)
  const kind = secret
    ? 'secret-string'
    : literalValues
      ? 'literal-union'
      : (nonNullable.flags & ts.TypeFlags.StringLike) !== 0
        ? 'string'
        : (nonNullable.flags & ts.TypeFlags.NumberLike) !== 0
          ? 'number'
          : (nonNullable.flags & ts.TypeFlags.BooleanLike) !== 0
            ? 'boolean'
            : undefined
  if (!kind) {
    fail(
      property,
      `Configuration property ${name} must use a supported scalar or literal union type.`,
    )
  }

  const defaultValue = property.initializer
    ? readScalarInitializer(property.initializer)
    : undefined
  const group = toScreamingSnake(configurationName.replace(/Config$/, ''))
  const result: ConfigurationPropertyManifest = {
    name,
    environmentKey: `${group}_${toScreamingSnake(name)}`,
    kind,
    ...(literalValues ? { allowedValues: literalValues } : {}),
    optional: Boolean(property.questionToken) || includesUndefined(type),
    sensitive: secret,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    source: sourceOf(property, projectRoot),
  }
  return result
}

function literalUnionValues(type: ts.Type): readonly ConfigurationDefault[] | undefined {
  if (!type.isUnion()) return undefined
  const values: ConfigurationDefault[] = []
  for (const member of type.types) {
    if (member.isStringLiteral() || member.isNumberLiteral()) {
      values.push(member.value)
    } else if ((member.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
      values.push((member as ts.Type & { intrinsicName?: string }).intrinsicName === 'true')
    } else {
      return undefined
    }
  }
  return values.length > 0 ? values : undefined
}

function isNamedCoreType(type: ts.Type, name: string): boolean {
  const declaration = type.getSymbol()?.declarations?.[0]
  return Boolean(
    declaration &&
    ts.isClassDeclaration(declaration) &&
    declaration.name?.text === name &&
    isCoreDeclaration(declaration),
  )
}

function readScalarInitializer(initializer: ts.Expression): ConfigurationDefault {
  if (ts.isStringLiteral(initializer) || ts.isNumericLiteral(initializer)) {
    return ts.isNumericLiteral(initializer) ? Number(initializer.text) : initializer.text
  }
  if (initializer.kind === ts.SyntaxKind.TrueKeyword) return true
  if (initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  fail(initializer, 'Configuration defaults must be literal strings, numbers, or booleans.')
}

function lifecycleOf(declaration: ts.ClassDeclaration, checker: ts.TypeChecker) {
  const type = checker.getTypeAtLocation(declaration)
  return {
    start: Boolean(type.getProperty('start')),
    drain: Boolean(type.getProperty('drain')),
    stop: Boolean(type.getProperty('stop')),
    dispose: Boolean(type.getProperty('dispose')),
  }
}

function implementsNamedInterface(
  declaration: ts.ClassDeclaration,
  name: string,
  checker: ts.TypeChecker,
): boolean {
  return (
    declaration.heritageClauses
      ?.filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
      .some((clause) =>
        clause.types.some((type) => {
          const referenced = resolveNamedDeclaration(type.expression, checker)
          return referenced?.name?.text === name && isCoreDeclaration(referenced)
        }),
      ) ?? false
  )
}

function extendsNamedClass(
  declaration: ts.ClassDeclaration,
  name: string,
  checker: ts.TypeChecker,
): boolean {
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
    for (const type of clause.types) {
      const base = resolveClassReference(type.expression, checker)
      if (base?.name?.text === name && isCoreDeclaration(base)) return true
      if (base && extendsNamedClass(base, name, checker)) return true
    }
  }
  return false
}

function resolveNamedDeclaration(
  node: ts.Expression,
  checker: ts.TypeChecker,
): (ts.Declaration & { readonly name?: ts.Identifier }) | undefined {
  let symbol = checker.getSymbolAtLocation(node)
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol)
  }
  return symbol?.declarations?.find(
    (declaration): declaration is ts.Declaration & { readonly name?: ts.Identifier } =>
      'name' in declaration,
  )
}

function isCoreDeclaration(declaration: ts.Declaration): boolean {
  const source = declaration.getSourceFile().fileName.split(path.sep).join('/')
  return source.includes('/packages/core/') || source.includes('/@doxajs/core/')
}

function builtinIdForDeclaration(declaration: ts.ClassDeclaration): string | undefined {
  const name = requiredClassName(declaration)
  if (
    name !== 'ActionBus' &&
    name !== 'QueryBus' &&
    name !== 'CurrentExecution' &&
    name !== 'CurrentJob' &&
    name !== 'UnitOfWork' &&
    name !== 'Authorization' &&
    name !== 'AiObservability' &&
    name !== 'Mailer' &&
    name !== 'Sms' &&
    name !== 'DeliveryLedger' &&
    name !== 'Logger'
  )
    return undefined
  const source = declaration.getSourceFile().fileName.split(path.sep).join('/')
  if (!source.includes('/packages/core/') && !source.includes('/@doxajs/core/')) return undefined
  if (name === 'ActionBus') return 'doxa:action-bus'
  if (name === 'QueryBus') return 'doxa:query-bus'
  if (name === 'CurrentExecution') return 'doxa:current-execution'
  if (name === 'CurrentJob') return 'doxa:current-job'
  if (name === 'Authorization') return 'doxa:authorization'
  if (name === 'AiObservability') return 'doxa:ai-observability'
  if (name === 'Mailer') return 'doxa:mailer'
  if (name === 'Sms') return 'doxa:sms'
  if (name === 'DeliveryLedger') return 'doxa:delivery-ledger'
  if (name === 'Logger') return 'doxa:logger'
  return 'doxa:unit-of-work'
}

function providerCapabilityForDeclaration(
  declaration: ts.ClassDeclaration,
): ProviderManifestEntry['capabilities'][number] | undefined {
  const name = requiredClassName(declaration)
  if (
    name !== 'Auth' &&
    name !== 'TransactionManager' &&
    name !== 'QueueManager' &&
    name !== 'Cache' &&
    name !== 'MailTransport' &&
    name !== 'SmsTransport' &&
    name !== 'BroadcastTransport' &&
    name !== 'Telemetry' &&
    name !== 'ObservationRecorder'
  )
    return undefined
  const source = declaration.getSourceFile().fileName.split(path.sep).join('/')
  return source.includes('/packages/core/') || source.includes('/@doxajs/core/')
    ? name === 'Auth'
      ? 'authentication'
      : name === 'TransactionManager'
        ? 'transactions'
        : name === 'QueueManager'
          ? 'queues'
          : name === 'Cache'
            ? 'cache'
            : name === 'MailTransport'
              ? 'mail'
              : name === 'SmsTransport'
                ? 'sms'
                : name === 'BroadcastTransport'
                  ? 'broadcasting'
                  : name === 'Telemetry'
                    ? 'telemetry'
                    : 'observations'
    : undefined
}

function assertConcreteClass(declaration: ts.ClassDeclaration): void {
  if (hasModifier(declaration, ts.SyntaxKind.AbstractKeyword)) {
    fail(
      declaration,
      `${requiredClassName(declaration)} must be concrete before it can be registered.`,
    )
  }
}

function renderRegistry(
  application: RegisteredClass,
  configurations: readonly RegisteredClass[],
  providers: readonly RegisteredClass[],
  operations: readonly RegisteredClass[],
  models: readonly RegisteredClass[],
  observers: readonly RegisteredClass[],
  routes: readonly RegisteredClass[],
  events: readonly RegisteredClass[],
  listeners: readonly RegisteredClass[],
  jobs: readonly RegisteredClass[],
  schedules: readonly RegisteredClass[],
  policies: readonly RegisteredClass[],
  permissionSources: readonly RegisteredClass[],
  signals: readonly RegisteredClass[],
  signalHandlers: readonly RegisteredClass[],
  commands: readonly RegisteredClass[],
  realtimeCommands: readonly RegisteredClass[],
  buildHash: string,
  options: NormalizedOptions,
): string {
  const registrations = [
    application,
    ...configurations,
    ...providers,
    ...operations,
    ...models,
    ...observers,
    ...routes,
    ...events,
    ...listeners,
    ...jobs,
    ...schedules,
    ...policies,
    ...permissionSources,
    ...signals,
    ...signalHandlers,
    ...commands,
    ...realtimeCommands,
  ].sort((left, right) => left.id.localeCompare(right.id))
  const imports = registrations.map((registration, index) => {
    const sourceFile = registration.declaration.getSourceFile().fileName
    const relativeSource = path.relative(options.sourceRoot, sourceFile)
    if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) {
      fail(
        registration.declaration,
        'Registry classes must be emitted from within the configured source root.',
      )
    }
    const outputFile = path
      .join(options.outputRoot, relativeSource)
      .replace(/\.(?:mts|cts|tsx|ts)$/, '.js')
    let specifier = path.relative(options.artifactsDirectory, outputFile).split(path.sep).join('/')
    if (!specifier.startsWith('.')) specifier = `./${specifier}`
    return `import { ${requiredClassName(registration.declaration)} as C${index} } from ${JSON.stringify(specifier)}`
  })
  const entries = registrations.map(
    (registration, index) => `  ${JSON.stringify(registration.id)}: C${index},`,
  )
  return [
    '// Generated by @doxajs/compiler. Do not edit.',
    ...imports,
    '',
    `export const formatVersion = ${MANIFEST_FORMAT_VERSION}`,
    `export const buildHash = ${JSON.stringify(buildHash)}`,
    'export const constructors = Object.freeze({',
    ...entries,
    '})',
    '',
  ].join('\n')
}

function readRequiredInstanceString(declaration: ts.ClassDeclaration, name: string): string {
  const property = findInstanceProperty(declaration, name)
  if (
    !property?.initializer ||
    !ts.isStringLiteral(property.initializer) ||
    property.initializer.text.length === 0
  ) {
    fail(
      declaration,
      `${requiredClassName(declaration)}.${name} must be a non-empty string literal.`,
    )
  }
  return property.initializer.text
}

function instanceObject(
  declaration: ts.ClassDeclaration,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const property = findInstanceProperty(declaration, name)
  if (!property) return undefined
  const initializer = property.initializer
    ? unwrapLiteralExpression(property.initializer)
    : undefined
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    fail(property, `${requiredClassName(declaration)}.${name} must be a literal object.`)
  }
  return initializer
}

function objectField(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === name,
  )
}

function objectFieldObject(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const property = objectField(object, name)
  if (!property) return undefined
  const initializer = unwrapLiteralExpression(property.initializer)
  if (!ts.isObjectLiteralExpression(initializer))
    fail(property, `${name} must be a literal object.`)
  return initializer
}

function requiredObjectFieldObject(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralExpression {
  return objectFieldObject(object, name) ?? fail(object, `${name} is required.`)
}

function requiredObjectString(object: ts.ObjectLiteralExpression, name: string): string {
  const value = optionalObjectString(object, name)
  if (!value) fail(object, `${name} must be a non-empty string literal.`)
  return value
}

function optionalObjectString(
  object: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const property = objectField(object, name)
  if (!property) return undefined
  const initializer = unwrapLiteralExpression(property.initializer)
  if (!ts.isStringLiteral(initializer) || initializer.text.length === 0) {
    fail(property, `${name} must be a non-empty string literal.`)
  }
  return initializer.text
}

function requiredDatabaseIdentifier(object: ts.ObjectLiteralExpression, name: string): string {
  const value = requiredObjectString(object, name)
  if (!validIdentifier(value)) fail(object, `${name} must be a PostgreSQL identifier.`)
  return value
}

function optionalDatabaseIdentifier(
  object: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const value = optionalObjectString(object, name)
  if (value !== undefined && !validIdentifier(value)) {
    fail(object, `${name} must be a PostgreSQL identifier.`)
  }
  return value
}

function objectBoolean(object: ts.ObjectLiteralExpression, name: string): boolean | undefined {
  const property = objectField(object, name)
  if (!property) return undefined
  const initializer = unwrapLiteralExpression(property.initializer)
  if (initializer.kind === ts.SyntaxKind.TrueKeyword) return true
  if (initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  fail(property, `${name} must be a boolean literal.`)
}

function isScalarJson(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function scalarJson(expression: ts.Expression, source: ts.Node): string | number | boolean | null {
  const value = readJsonLiteral(expression)
  if (!isScalarJson(value)) fail(source, 'Expected a scalar literal value.')
  return value
}

function readRequiredStaticString(declaration: ts.ClassDeclaration, name: string): string {
  const property = declaration.members.find(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) &&
      hasModifier(member, ts.SyntaxKind.StaticKeyword) &&
      propertyName(member.name) === name,
  )
  if (
    !property?.initializer ||
    !ts.isStringLiteral(property.initializer) ||
    property.initializer.text.length === 0
  ) {
    fail(
      declaration,
      `${requiredClassName(declaration)} must declare static ${name} as a non-empty string literal.`,
    )
  }
  return property.initializer.text
}

function readAccess(declaration: ts.ClassDeclaration): string {
  const access = readRequiredStaticString(declaration, 'access')
  if (access !== 'public' && !/^[a-z][a-z0-9._:-]{1,127}$/.test(access)) {
    fail(
      declaration,
      `${requiredClassName(declaration)}.access must be "public" or a stable ability name.`,
    )
  }
  return access
}

function assertAbilityName(declaration: ts.ClassDeclaration, ability: string): void {
  if (!/^[a-z][a-z0-9._:-]{1,127}$/.test(ability)) {
    fail(declaration, `${requiredClassName(declaration)} declares invalid ability ${ability}.`)
  }
}

function staticProperty(
  declaration: ts.ClassDeclaration,
  name: string,
): ts.PropertyDeclaration | undefined {
  return declaration.members.find(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) &&
      hasModifier(member, ts.SyntaxKind.StaticKeyword) &&
      propertyName(member.name) === name,
  )
}

function readOptionalStaticString(
  declaration: ts.ClassDeclaration,
  name: string,
): string | undefined {
  const property = staticProperty(declaration, name)
  if (!property) return undefined
  if (
    !property.initializer ||
    !ts.isStringLiteral(property.initializer) ||
    property.initializer.text.length === 0
  ) {
    fail(property, `${requiredClassName(declaration)}.${name} must be a non-empty string literal.`)
  }
  return property.initializer.text
}

function readRequiredStaticStringArray(
  declaration: ts.ClassDeclaration,
  name: string,
): readonly string[] {
  const property = staticProperty(declaration, name)
  if (!property?.initializer || !ts.isArrayLiteralExpression(property.initializer)) {
    fail(
      declaration,
      `${requiredClassName(declaration)} must declare static ${name} as a literal string array.`,
    )
  }
  return property.initializer.elements.map((element) => {
    if (!ts.isStringLiteral(element) || element.text.length === 0) {
      fail(
        element,
        `${requiredClassName(declaration)}.${name} may contain only non-empty string literals.`,
      )
    }
    return element.text
  })
}

function readOptionalStaticNumberValue(
  declaration: ts.ClassDeclaration,
  name: string,
): number | undefined {
  const property = staticProperty(declaration, name)
  if (!property) return undefined
  if (!property.initializer || !ts.isNumericLiteral(property.initializer)) {
    fail(property, `${requiredClassName(declaration)}.${name} must be a numeric literal.`)
  }
  return Number(property.initializer.text)
}

function readRequiredStaticClass(
  declaration: ts.ClassDeclaration,
  name: string,
  checker: ts.TypeChecker,
): ts.ClassDeclaration {
  const property = staticProperty(declaration, name)
  if (!property?.initializer) {
    fail(
      declaration,
      `${requiredClassName(declaration)} must declare static ${name} as a direct class reference.`,
    )
  }
  const resolved = resolveClassReference(property.initializer, checker)
  if (!resolved)
    fail(property, `${requiredClassName(declaration)}.${name} must be a direct class reference.`)
  return resolved
}

function readOptionalStaticJson(declaration: ts.ClassDeclaration, name: string): unknown {
  const property = staticProperty(declaration, name)
  return property?.initializer ? readJsonLiteral(property.initializer) : undefined
}

function readJsonLiteral(node: ts.Expression): unknown {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return readJsonLiteral(node.expression)
  }
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return ts.isNumericLiteral(node) ? Number(node.text) : node.text
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text)
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => {
      if (ts.isSpreadElement(element)) fail(element, 'Schedule input may not contain spreads.')
      return readJsonLiteral(element)
    })
  }
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) {
          fail(property, 'Schedule input must use explicit JSON property assignments.')
        }
        const key = propertyName(property.name)
        if (!key) fail(property, 'Schedule input property names must be literal.')
        return [key, readJsonLiteral(property.initializer)]
      }),
    )
  }
  fail(node, 'Schedule input must be a JSON literal so Gnosis and the manifest can inspect it.')
}

function validIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)
}

function validQualifiedIdentifier(value: string): boolean {
  const parts = value.split('.')
  return parts.length > 0 && parts.length <= 2 && parts.every(validIdentifier)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

function readOptionalStaticNumber(
  declaration: ts.ClassDeclaration,
  name: string,
  fallback: number,
): number {
  const property = declaration.members.find(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) &&
      hasModifier(member, ts.SyntaxKind.StaticKeyword) &&
      propertyName(member.name) === name,
  )
  if (!property) return fallback
  if (!property.initializer || !ts.isNumericLiteral(property.initializer)) {
    fail(property, `${requiredClassName(declaration)}.${name} must be a numeric literal.`)
  }
  return Number(property.initializer.text)
}

function readRealtimeCommandThrottle(declaration: ts.ClassDeclaration): {
  readonly limit: number
  readonly windowMs: number
} {
  const property = staticProperty(declaration, 'throttle')
  if (!property?.initializer || !ts.isObjectLiteralExpression(property.initializer)) {
    fail(
      declaration,
      `${requiredClassName(declaration)} must declare static throttle as { limit, windowMs }.`,
    )
  }
  const initializer = property.initializer
  const readInteger = (name: string): number => {
    const field = initializer.properties.find(
      (entry): entry is ts.PropertyAssignment =>
        ts.isPropertyAssignment(entry) && propertyName(entry.name) === name,
    )
    if (!field || !ts.isNumericLiteral(field.initializer)) {
      fail(
        property,
        `${requiredClassName(declaration)}.throttle.${name} must be a numeric literal.`,
      )
    }
    const value = Number(field.initializer.text)
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail(
        property,
        `${requiredClassName(declaration)}.throttle.${name} must be a positive integer.`,
      )
    }
    return value
  }
  return Object.freeze({ limit: readInteger('limit'), windowMs: readInteger('windowMs') })
}

function readOptionalStaticBoolean(
  declaration: ts.ClassDeclaration,
  name: string,
  fallback: boolean,
): boolean {
  const property = declaration.members.find(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) &&
      hasModifier(member, ts.SyntaxKind.StaticKeyword) &&
      propertyName(member.name) === name,
  )
  if (!property) return fallback
  if (property.initializer?.kind === ts.SyntaxKind.TrueKeyword) return true
  if (property.initializer?.kind === ts.SyntaxKind.FalseKeyword) return false
  fail(property, `${requiredClassName(declaration)}.${name} must be a boolean literal.`)
}

function findInstanceProperty(
  declaration: ts.ClassDeclaration,
  name: string,
): ts.PropertyDeclaration | undefined {
  return declaration.members.find(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) &&
      !hasModifier(member, ts.SyntaxKind.StaticKeyword) &&
      propertyName(member.name) === name,
  )
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
}

function requiredClassName(declaration: ts.ClassDeclaration): string {
  if (!declaration.name) fail(declaration, 'Doxa declarations must use named classes.')
  return declaration.name.text
}

function sourceOf(node: ts.Node, projectRoot: string): SourceProvenance {
  const source = node.getSourceFile()
  const position = source.getLineAndCharacterOfPosition(node.getStart(source))
  return {
    file: path.relative(projectRoot, source.fileName).split(path.sep).join('/'),
    line: position.line + 1,
    column: position.character + 1,
  }
}

function includesUndefined(type: ts.Type): boolean {
  return (
    type.isUnion() && type.types.some((member) => (member.flags & ts.TypeFlags.Undefined) !== 0)
  )
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind),
  )
}

function byId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id)
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

function toScreamingSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toUpperCase()
}

function fail(node: ts.Node, message: string): never {
  const source = node.getSourceFile()
  const position = source.getLineAndCharacterOfPosition(node.getStart(source))
  throw new DoxaCompilationError(
    `${source.fileName}:${position.line + 1}:${position.character + 1} ${message}`,
  )
}
