import type { DoxaManifest } from '@doxajs/manifest'

export const GNOSIS_HANDBOOK_SCHEMA_VERSION = 1 as const

export type HandbookKind = 'programming-model' | 'role' | 'concept' | 'module' | 'diagnostic'

export type DoxaRole =
  | 'application'
  | 'feature'
  | 'configuration'
  | 'provider'
  | 'service'
  | 'model'
  | 'action'
  | 'query'
  | 'route'
  | 'event'
  | 'listener'
  | 'job'
  | 'schedule'
  | 'observer'
  | 'policy'
  | 'permission-source'
  | 'signal'
  | 'signal-handler'
  | 'command'

export interface RoleGuideDetails {
  readonly purpose: string
  readonly useWhen: string
  readonly registration: string
  readonly generator: string
  readonly canonicalFolder: string
  readonly invocation: string
  readonly authorization: string
  readonly transaction: string
  readonly injection: string
  readonly scope: string
  readonly lifecycle: string
  readonly dependencies: string
  readonly rationale: string
  readonly example: string
  readonly antiPatterns: readonly string[]
  readonly testing: readonly string[]
}

export interface HandbookActivation {
  readonly plugins?: readonly string[]
  readonly capabilities?: readonly string[]
}

export interface HandbookEntry {
  readonly id: string
  readonly kind: HandbookKind
  readonly package: string
  readonly version: string
  readonly source: string
  readonly heading: string
  readonly summary: string
  readonly aliases: readonly string[]
  readonly rationale: string
  readonly text: string
  readonly role?: DoxaRole
  readonly details?: RoleGuideDetails
  readonly activation?: HandbookActivation
}

export interface ProgrammingModel {
  readonly schemaVersion: typeof GNOSIS_HANDBOOK_SCHEMA_VERSION
  readonly version: string
  readonly title: 'Doxa Programming Model'
  readonly rules: readonly string[]
  readonly decisionGuide: Readonly<Record<'atomic' | 'afterCommit' | 'eventual', string>>
  readonly guideIds: readonly string[]
}

const roleDefinitions: readonly Omit<HandbookEntry, 'version'>[] = [
  role('role.application', 'application', 'Application', ['app.config', 'application root'], {
    purpose: 'Select the Features, plugins, and typed framework configuration for one application.',
    useWhen: 'Every Doxa application has exactly one root Application declaration.',
    registration:
      'Export the Application from app.config.ts and list selected Features and plugins.',
    generator:
      'doxa new creates the declaration; do not hand-build generated framework composition.',
    canonicalFolder: 'The repository application root.',
    invocation: 'Praxis compiles the declaration; application code does not instantiate it.',
    authorization: 'The Application does not authorize work; admitted entry roles do.',
    transaction:
      'The Application selects infrastructure but does not own an execution transaction.',
    injection: 'Do not inject dependencies into the declaration.',
    scope: 'One compiled application identity.',
    lifecycle: 'Runtime boot owns startup and shutdown for the selected graph.',
    dependencies: 'May select Features, plugins, and configuration only.',
    rationale:
      'One explicit root keeps discovery deterministic and artifact-only runtime boot possible.',
    example:
      'class Application extends DoxaApplication { id = "app"; features = [BillingFeature] }',
    antiPatterns: [
      'Runtime discovery',
      'Environment-dependent Feature selection',
      'Application I/O',
    ],
    testing: ['Compile the application', 'Assert its manifest identity and selected graph'],
  }),
  role('role.feature', 'feature', 'Feature', ['module', 'bounded context', 'provides'], {
    purpose: 'Own and explicitly register one coherent application capability.',
    useWhen: 'Group models and framework-facing roles that share ownership and privacy boundaries.',
    registration: 'Select the Feature from the Application and declare its role arrays.',
    generator: 'doxa make:feature FeatureName',
    canonicalFolder:
      'src/features/<feature>/<feature>.feature.ts; the root AppFeature uses src/app/app.feature.ts.',
    invocation: 'The compiler reads the declaration without executing application code.',
    authorization:
      'The Feature owns ability-bearing entry roles and may select one PermissionSource.',
    transaction: 'Features do not create transactions; their admitted roles do.',
    injection: 'Features are declarations, not service locators.',
    scope: 'Static ownership boundary.',
    lifecycle: 'No application lifecycle methods.',
    dependencies: 'Cross-Feature service access requires an explicit Feature.provides export.',
    rationale:
      'Explicit ownership lets Doxa compile privacy, capabilities, and dependencies before boot.',
    example: 'class BillingFeature extends Feature { id = "billing"; actions = [ChargeCard] }',
    antiPatterns: [
      'Relying on folders for registration',
      'Exporting framework roles through provides',
    ],
    testing: ['Compile ownership and privacy', 'Inspect the Feature graph through Gnosis'],
  }),
  role('role.configuration', 'configuration', 'Configuration', ['config', 'environment'], {
    purpose: 'Declare typed, classified application configuration.',
    useWhen: 'A provider or service requires deployment-supplied values.',
    registration: 'Declare the configuration on the Application or owning Feature.',
    generator: 'doxa make:config Feature/Name',
    canonicalFolder: 'src/features/<feature>/config',
    invocation: 'Doxa resolves values before dependent lifecycle starts.',
    authorization: 'Configuration is not an authorization mechanism.',
    transaction: 'Configuration is transaction-independent.',
    injection: 'Constructor-inject into services or use this.inject() from framework roles.',
    scope: 'Immutable resolved configuration.',
    lifecycle: 'No I/O or lifecycle behavior.',
    dependencies: 'May not depend on runtime services.',
    rationale: 'Typed classification enables fail-closed validation and secret-safe inspection.',
    example: 'class BillingConfig extends Configuration { apiBase = "https://billing.test" }',
    antiPatterns: ['Reading process.env throughout domain code', 'Logging resolved secrets'],
    testing: [
      'Test required/default values',
      'Assert Gnosis exposes classifications, never values',
    ],
  }),
  role(
    'role.provider',
    'provider',
    'Infrastructure provider',
    ['providers', 'adapter', 'singleton infrastructure'],
    {
      purpose: 'Supply a selected application-wide infrastructure capability or durable adapter.',
      useWhen:
        'Implement transactions, queues, auth, cache, communications, telemetry, or another durable port.',
      registration: 'Select the concrete provider through Feature.providers.',
      generator: 'doxa make:provider Feature/Name',
      canonicalFolder: 'src/features/<feature>/providers',
      invocation:
        'The container constructs it during application boot or a restricted runtime profile.',
      authorization:
        'Providers implement infrastructure and must not make application policy decisions.',
      transaction:
        'A provider may implement transaction infrastructure but must not capture one execution transaction.',
      injection: 'Plain constructor injection.',
      scope: 'Singleton with durable manifest identity.',
      lifecycle: 'May implement explicit start, drain, stop, and dispose phases.',
      dependencies: 'May depend only on scope-safe configuration, ports, and providers.',
      rationale: 'Explicit singleton infrastructure is inspectable and lifecycle-safe.',
      example: 'class Transactions extends TransactionManager { static id = "postgres" }',
      antiPatterns: [
        'Putting reusable domain behavior in providers',
        'Holding actor, request, model-session, or transaction state',
      ],
      testing: ['Test lifecycle and capability conformance', 'Test failure and shutdown behavior'],
    },
  ),
  role(
    'role.service',
    'service',
    'Ordinary service',
    ['services', 'provides', 'domain service', 'application service'],
    {
      purpose: 'Perform reusable application or domain work inside the boundary that invoked it.',
      useWhen: 'Actions, jobs, listeners, policies, or other roles need shared behavior.',
      registration:
        'Autowiring is automatic within the owning Feature; use Feature.provides for cross-Feature access.',
      generator:
        'doxa make:service Feature/Name; add --provide only for intentional cross-Feature export.',
      canonicalFolder: 'src/features/<feature>/services',
      invocation: 'Call it directly from the owning framework role.',
      authorization:
        'The admitted entry role owns authorization; a service may enforce domain invariants.',
      transaction:
        'It never opens or owns a transaction. It joins the caller’s active execution and unit of work.',
      injection: 'Plain class with constructor injection.',
      scope:
        'Transient by default; implement ExecutionScoped only for per-execution identity or caching.',
      lifecycle:
        'May implement Disposes to dispose scope-local resources; cannot own application start, drain, or stop phases.',
      dependencies:
        'May depend on scope-safe services, ports, configuration, and selected providers.',
      rationale:
        'A shared service preserves reuse without nesting operation boundaries or weakening atomicity.',
      example:
        'CreateNotification Action and DeliverDueReminders Job both call NotificationCreator.',
      antiPatterns: [
        'Injecting ActionBus to reuse an Action',
        'Registering domain services in Feature.providers',
        'Starting independent transactions',
      ],
      testing: [
        'Test through each owning boundary',
        'Prove rollback under the caller’s transaction',
      ],
    },
  ),
  role('role.model', 'model', 'Model', ['entity', 'record', 'relationship'], {
    purpose: 'Declare and operate on one typed persistent domain projection.',
    useWhen: 'Application behavior needs Doxa-owned persistence and identity mapping.',
    registration: 'Declare the Model in Feature.models.',
    generator: 'doxa make:model Feature/Name',
    canonicalFolder: 'src/features/<feature>/models',
    invocation:
      'Use typed static query APIs and mutate attached instances only in writable executions.',
    authorization: 'Models do not authorize access; policies and entry roles do.',
    transaction:
      'Queries join the active model session; save/delete require an Action or Job writable unit of work.',
    injection: 'Models are not injected dependencies.',
    scope: 'Identity-mapped within one execution.',
    lifecycle: 'Observer phases surround persistence; models do not own application lifecycle.',
    dependencies: 'May declare typed relationships to selected Models.',
    rationale:
      'Logical projections keep storage details private and make reads and writes inspectable.',
    example: 'const reminder = await Reminder.findOrFail(id); await reminder.delete()',
    antiPatterns: [
      'Injecting Models',
      'Raw SQL in feature code',
      'Persisting from read-only queries',
    ],
    testing: ['Test mapping and relationships', 'Test read-only and rollback behavior'],
  }),
  role('role.action', 'action', 'Action', ['command handler', 'mutation', 'unit of work'], {
    purpose: 'Serve as the primary top-level boundary for an intentional state change.',
    useWhen: 'HTTP, console, signal, or other admitted work requests one synchronous mutation.',
    registration: 'Declare the Action in Feature.actions with a stable ID and access rule.',
    generator: 'doxa make:action Feature/Name --public or --ability=<ability>',
    canonicalFolder: 'src/features/<feature>/actions',
    invocation: 'A route or other external adapter dispatches it through ActionBus.',
    authorization: 'Declare public access or one ability resolved before handle().',
    transaction: 'Owns one writable transaction and commits or rolls back the complete operation.',
    injection: 'Extend Action and use this.inject() for scoped dependencies.',
    scope: 'Transient handler inside one admitted execution.',
    lifecycle: 'May dispose local resources but cannot own application start/drain/stop.',
    dependencies: 'Use ordinary services for reuse. Never dispatch another Action.',
    rationale:
      'One visible mutation boundary gives authorization, transaction, telemetry, and failure semantics one owner.',
    example: 'class CreateNotification extends Action<Input, Notification> { ... }',
    antiPatterns: [
      'Nested ActionBus dispatch',
      'Calling an Action from a Job',
      'Hidden durable writes in queries',
    ],
    testing: ['Test authorization', 'Test commit and rollback', 'Test emitted facts and result'],
  }),
  role('role.query', 'query', 'Query', ['read handler', 'read-only'], {
    purpose: 'Serve as a top-level read boundary.',
    useWhen: 'An adapter needs composed application reads with authorization.',
    registration: 'Declare the Query in Feature.queries with a stable ID and access rule.',
    generator: 'doxa make:query Feature/Name --public or --ability=<ability>',
    canonicalFolder: 'src/features/<feature>/queries',
    invocation: 'Dispatch through QueryBus from an admitted adapter.',
    authorization: 'Declare public access or one ability.',
    transaction: 'Owns a bounded read-only model session; create/save/delete fail closed.',
    injection: 'Extend Query and use this.inject().',
    scope: 'Transient handler inside one admitted execution.',
    lifecycle:
      'May dispose scope-local resources; cannot own application start, drain, or stop phases.',
    dependencies:
      'May call read-only services; must not reach ActionBus or mutation-only behavior.',
    rationale: 'A read boundary prevents durable side effects from hiding behind retrieval.',
    example: 'class GetReminder extends Query<Input, ReminderView> { ... }',
    antiPatterns: ['Mutation in Query.handle()', 'Nested Action dispatch', 'Raw database access'],
    testing: ['Test authorization and result shape', 'Assert mutation attempts fail'],
  }),
  role('role.route', 'route', 'Route', ['http', 'controller'], {
    purpose: 'Adapt one HTTP request to application behavior.',
    useWhen: 'Expose an HTTP endpoint.',
    registration: 'Declare the Route in Feature.routes with method, path, and access.',
    generator: 'doxa make:route Feature/Name --method=<method> --path=<path>',
    canonicalFolder: 'src/features/<feature>/http',
    invocation: 'The HTTP host admits and invokes it.',
    authorization: 'Declare public or ability access; do not duplicate policy logic.',
    transaction: 'Dispatch an Action or Query; the route does not own an independent transaction.',
    injection: 'Extend Route and use this.inject(ActionBus or QueryBus).',
    scope: 'Transient per request.',
    lifecycle:
      'May dispose scope-local resources; cannot own application start, drain, or stop phases.',
    dependencies: 'Prefer operation buses over direct domain mutation.',
    rationale:
      'Thin transport adapters preserve automatic envelopes and reusable application boundaries.',
    example: 'return this.actions.execute(CreateNotification, input)',
    antiPatterns: [
      'Manual response envelopes',
      'Persistence in routes',
      'Constructing role classes',
    ],
    testing: ['Test transport validation and envelope', 'Test access and operation dispatch'],
  }),
  role('role.event', 'event', 'Event', ['domain event', 'fact', 'after commit'], {
    purpose: 'Represent an accepted fact and notify genuine reactions.',
    useWhen: 'Other behavior needs to react to something that has happened.',
    registration: 'Declare the Event in Feature.events and listeners separately.',
    generator: 'doxa make:event Feature/Name',
    canonicalFolder: 'src/features/<feature>/events',
    invocation:
      'Dispatch inside an admitted execution; DomainEvent requires a writable unit of work.',
    authorization: 'The boundary producing the fact owns authorization.',
    transaction:
      'Domain facts and queued intent stage atomically; listener delivery determines execution timing.',
    injection: 'Event payload constructors are data, not dependency injection.',
    scope: 'Payload in the current execution or a versioned queued envelope.',
    lifecycle: 'No lifecycle.',
    dependencies: 'Keep payloads versioned, bounded, and serializable across durable boundaries.',
    rationale: 'Events decouple genuine reactions while making delivery guarantees explicit.',
    example: 'await NotificationCreated.dispatch({ notificationId })',
    antiPatterns: [
      'Using an asynchronous event to evade nested Action restrictions',
      'Treating queued delivery as same-transaction work',
    ],
    testing: ['Assert dispatch', 'Test each declared delivery phase and rollback behavior'],
  }),
  role('role.listener', 'listener', 'Listener', ['reaction', 'local listener', 'queued listener'], {
    purpose: 'React to a declared Event with explicit delivery semantics.',
    useWhen: 'Behavior is a consequence of a fact rather than required direct orchestration.',
    registration: 'Declare the Listener in Feature.listeners and bind its Event type.',
    generator: 'doxa make:listener Feature/Name --event=<Event> with one delivery flag.',
    canonicalFolder: 'src/features/<feature>/listeners',
    invocation: 'Doxa invokes it locally, after commit, or in a queued execution.',
    authorization:
      'Declare public or ability access. Local delivery reuses the producer context; queued delivery re-resolves access in its fresh execution.',
    transaction:
      'Local delivery can share the current unit of work. After-commit has no rollback path. Queued delivery gets a fresh execution but must dispatch an Action or use a Job for writable model work.',
    injection: 'Extend Listener and use this.inject().',
    scope: 'Transient; queued listeners reconstruct dependencies in a fresh scope.',
    lifecycle:
      'May dispose scope-local resources; cannot own application start, drain, or stop phases.',
    dependencies:
      'Use services for reusable work. A queued Listener may dispatch an Action as a new top-level operation; local and after-commit Listeners may not nest one.',
    rationale:
      'Explicit delivery prevents accidental confusion between atomic and eventual behavior.',
    example:
      'A queued Listener may dispatch CreateNotification as a later top-level Action when notification creation is intentionally eventual.',
    antiPatterns: [
      'Hiding a required invariant in a queued listener',
      'Treating a queued Listener as if it automatically owns a writable transaction',
    ],
    testing: [
      'Test failure semantics for the selected phase',
      'Test retries and idempotency when queued',
    ],
  }),
  role('role.job', 'job', 'Job', ['queue job', 'worker', 'asynchronous mutation'], {
    purpose: 'Serve as a top-level writable boundary for durable asynchronous work.',
    useWhen: 'Work must be delayed, retried, scheduled, or processed outside the caller.',
    registration: 'Declare the Job in Feature.jobs with stable ID, access, and retry policy.',
    generator: 'doxa make:job Feature/Name --public or --ability=<ability>',
    canonicalFolder: 'src/features/<feature>/jobs',
    invocation: 'Dispatch a versioned input through the Doxa queue or select it from a Schedule.',
    authorization: 'Protected attempts re-resolve authorization in their admitted execution.',
    transaction: 'Every attempt owns one writable transaction. Services called by the Job join it.',
    injection: 'Extend Job and use this.inject().',
    scope: 'Fresh execution per attempt with explicitly propagated actor and causality.',
    lifecycle:
      'May dispose attempt-local resources; cannot own application start, drain, or stop phases. Worker draining owns attempt completion.',
    dependencies: 'Use ordinary services. Never dispatch an Action from inside handle().',
    rationale:
      'A Job is already a complete mutation boundary; nesting an Action would create competing ownership.',
    example:
      'DeliverDueReminders calls NotificationCreator, dispatches NotificationCreated, then deletes the reminder.',
    antiPatterns: [
      'Job-to-Action dispatch',
      'Non-idempotent external effects',
      'Assuming caller memory survives',
    ],
    testing: [
      'Test retry/idempotency',
      'Test atomic rollback',
      'Test propagated execution context',
    ],
  }),
  role('role.schedule', 'schedule', 'Schedule', ['cron', 'interval'], {
    purpose: 'Declare when a Job should be admitted.',
    useWhen: 'A durable Job runs on a cron or interval cadence.',
    registration: 'Declare the Schedule in Feature.schedules and reference one selected Job.',
    generator: 'doxa make:schedule Feature/Name --job=<Job>',
    canonicalFolder: 'src/features/<feature>/schedules',
    invocation: 'The scheduler enqueues the Job according to cadence and overlap policy.',
    authorization: 'Declare public or ability access for schedule admission.',
    transaction: 'The Schedule has no transaction; each dequeued Job attempt owns one.',
    injection: 'Schedules are declaration-only and are never constructed.',
    scope: 'Static timing metadata.',
    lifecycle: 'Scheduler lifecycle belongs to the runtime queue provider.',
    dependencies: 'May reference only its selected Job and literal input.',
    rationale: 'Separating timing from work preserves testability and one queue execution model.',
    example: 'DailyReminders dispatches DeliverDueReminders.',
    antiPatterns: ['Business logic in a Schedule', 'Runtime-computed cadence'],
    testing: ['Test compiled cadence and target', 'Test manual firing and overlap behavior'],
  }),
  role('role.observer', 'observer', 'Observer', ['model observer', 'persistence phase'], {
    purpose: 'Observe named model retrieval and persistence phases.',
    useWhen:
      'Cross-cutting model behavior belongs during retrieval or immediately around persistence.',
    registration: 'Declare the Observer in Feature.observers and bind one Model.',
    generator: 'doxa make:observer Feature/Name --model=<Model>',
    canonicalFolder: 'src/features/<feature>/observers',
    invocation: 'The model session invokes declared phases.',
    authorization: 'Observers inherit the owning operation; they are not entry points.',
    transaction:
      'Retrieved joins the caller’s read-only or writable model session. Before/after-persist phases share the writable unit of work; committed is materially later.',
    injection: 'Extend Observer and use this.inject().',
    scope: 'Transient in the current execution.',
    lifecycle: 'No application lifecycle.',
    dependencies: 'Must not create hidden operation boundaries.',
    rationale: 'Named phases make durability guarantees explicit.',
    example:
      'Decorate a model after retrieval, normalize it before persistence, or publish non-critical work after commit.',
    antiPatterns: ['Ambiguous save hooks', 'Authorization policy in observers'],
    testing: [
      'Test retrieval in read-only and writable sessions',
      'Test ordering, rollback, and after-commit failure semantics',
    ],
  }),
  role('role.policy', 'policy', 'Policy', ['ability', 'resource authorization'], {
    purpose: 'Make one resource-aware authorization decision.',
    useWhen: 'An ability depends on the target resource, not only application permission facts.',
    registration: 'Declare the Policy in Feature.policies with literal abilities.',
    generator: 'doxa make:policy Feature/Name',
    canonicalFolder: 'src/features/<feature>/policies',
    invocation: 'Doxa evaluates it before the protected entry role.',
    authorization:
      'A Policy may narrow a PermissionSource grant and never widen credential denial.',
    transaction:
      'Shares an owning operation session or uses a bounded read-only authorization session.',
    injection: 'Extend Policy and use this.inject().',
    scope: 'Transient per authorization evaluation.',
    lifecycle:
      'May dispose scope-local resources; cannot own application start, drain, or stop phases.',
    dependencies: 'Use read-only models and services; recursive authorization is prohibited.',
    rationale: 'One decision point keeps access explainable and default-deny.',
    example: 'ContactPolicy decides contact.update for the admitted actor and Contact.',
    antiPatterns: ['Authorization scattered through queries', 'Returning undeclared abilities'],
    testing: ['Test allow and deny', 'Test source grants cannot bypass resource narrowing'],
  }),
  role(
    'role.permission-source',
    'permission-source',
    'PermissionSource',
    ['application permissions', 'abilities', 'roles'],
    {
      purpose: 'Map application-owned permission facts to a stable Doxa ability catalog.',
      useWhen: 'Groups, roles, or user grants provide application-wide permissions.',
      registration: 'Select at most one source through Feature.permissionSources.',
      generator: 'doxa make:permission-source Feature/Name',
      canonicalFolder: 'src/features/<feature>/permission-sources',
      invocation: 'Doxa resolves it at most once per admitted execution.',
      authorization: 'Credential constraints deny first; resource Policies may narrow grants.',
      transaction:
        'Shares the owning operation session or a bounded read-only authorization session.',
      injection: 'Extend PermissionSource and use this.inject().',
      scope: 'Execution-scoped.',
      lifecycle:
        'May dispose scope-local resources; cannot own application start, drain, or stop phases.',
      dependencies: 'May use read-only models and exported ordinary services.',
      rationale: 'A stable catalog separates authentication from application permission storage.',
      example: 'ApplicationPermissionSource returns declared contact.read grants.',
      antiPatterns: [
        'Putting permission snapshots in ExecutionContext',
        'Singleton mutable permission state',
      ],
      testing: [
        'Test declared grants and fail-closed unknowns',
        'Test one resolution per execution',
      ],
    },
  ),
  role('role.signal', 'signal', 'Signal', ['synchronous message'], {
    purpose: 'Represent an explicitly handled in-process application message.',
    useWhen:
      'One admitted execution synchronously invokes a declared handler without becoming an Action.',
    registration: 'Declare Signals and SignalHandlers in their Feature arrays.',
    generator: 'doxa make:signal Feature/Name',
    canonicalFolder: 'src/features/<feature>/signals',
    invocation: 'Dispatch inside an admitted execution.',
    authorization: 'The handler declares access where admission requires it.',
    transaction: 'Shares the current execution; it does not open an independent transaction.',
    injection: 'Signal payload construction is not dependency injection.',
    scope: 'Current execution only.',
    lifecycle: 'No lifecycle.',
    dependencies: 'Use bounded payloads and one declared handler contract.',
    rationale:
      'Signals provide explicit synchronous messaging without pretending to be durable events.',
    example: 'RefreshContactScore dispatches to one handler in the current execution.',
    antiPatterns: ['Using signals for durable work', 'Treating a signal as a new transaction'],
    testing: ['Assert handler selection', 'Test failure propagation'],
  }),
  role('role.signal-handler', 'signal-handler', 'SignalHandler', ['signal consumer'], {
    purpose: 'Handle one Signal synchronously.',
    useWhen: 'A declared Signal needs application behavior.',
    registration: 'Declare it in Feature.signalHandlers and bind its Signal.',
    generator: 'doxa make:signal-handler Feature/Name --signal=<Signal>',
    canonicalFolder: 'src/features/<feature>/signal-handlers',
    invocation: 'Doxa invokes it during Signal dispatch.',
    authorization: 'Declare public or ability access.',
    transaction: 'Shares the caller’s current execution and unit of work.',
    injection: 'Extend SignalHandler and use this.inject().',
    scope: 'Transient in the current execution.',
    lifecycle:
      'May dispose scope-local resources; cannot own application start, drain, or stop phases.',
    dependencies: 'Use services; do not create nested operation boundaries.',
    rationale: 'A declared handler keeps synchronous coupling visible in the manifest.',
    example: 'A handler calls an ordinary service under the caller’s transaction.',
    antiPatterns: ['Dispatching an Action for reuse', 'Assuming asynchronous retry'],
    testing: ['Test authorization and propagated failure', 'Test transaction participation'],
  }),
  role('role.command', 'command', 'Command', ['console command', 'cli'], {
    purpose: 'Expose an admitted application console entry point.',
    useWhen: 'Operators or developers need application behavior through doxa <name>.',
    registration: 'Declare the Command in Feature.commands with stable command text and access.',
    generator: 'doxa make:command Feature/Name',
    canonicalFolder: 'src/features/<feature>/commands',
    invocation: 'Praxis admits and invokes it over the console transport.',
    authorization: 'Declare public or ability access.',
    transaction: 'Dispatch an Action or Query when operation semantics are required.',
    injection: 'Extend Command and use this.inject().',
    scope: 'Transient per console execution.',
    lifecycle:
      'May dispose scope-local resources; cannot own application start, drain, or stop phases.',
    dependencies: 'Prefer reusable operations and services over duplicate business logic.',
    rationale:
      'Declared commands preserve authorization, observability, and deterministic discovery.',
    example: 'doxa reminders:deliver dispatches a Job or Action.',
    antiPatterns: ['Arbitrary script entrypoints', 'Raw SQL or process-global mutation'],
    testing: ['Test input/output and exit behavior', 'Test access and delegated operation'],
  }),
]

const conceptDefinitions: readonly Omit<HandbookEntry, 'version'>[] = [
  concept(
    'programming-model.core',
    'programming-model',
    '@doxajs/core',
    'programming-model.md',
    'Doxa Programming Model',
    ['architecture', 'ideology', 'how doxa works', 'folders runtime meaning'],
    'Choose one admitted boundary, preserve one execution scope, and make consistency guarantees explicit.',
    'Doxa is opinionated so the shortest valid path also preserves determinism, inspection, authorization, and failure behavior.',
    [
      'Framework-facing roles extend their Doxa role and use this.inject(); ordinary services are plain constructor-injected classes.',
      'Actions are primary synchronous mutation boundaries. Jobs are equally valid top-level writable boundaries for asynchronous work.',
      'An ordinary service inherits its caller’s execution and transaction; it does not own a transaction.',
      'Actions, Queries, and Jobs must not directly or transitively reach ActionBus. Share behavior through an ordinary service.',
      'Queries are read-only. Actions and Job attempts are writable.',
      'Local work may share the current unit of work. After-commit and queued work cannot preserve same-transaction atomicity; queued mutation requires a later Action or Job transaction.',
      'Feature.provides exports ordinary services. Feature.providers selects singleton infrastructure.',
      'Folders express canonical organization but never activate runtime behavior.',
    ].join('\n'),
  ),
  concept(
    'concept.orchestration-consistency',
    'concept',
    '@doxajs/core',
    'orchestration.md',
    'Orchestration and consistency',
    ['atomic invariant', 'eventual consistency', 'after commit', 'shared service', 'reminder'],
    'Select direct service collaboration, after-commit delivery, or queued delivery from the business invariant.',
    'Delivery mechanisms are architectural guarantees, not interchangeable style choices.',
    [
      'Atomic: if mutations must succeed or fail together, one Action or Job owns the transaction and directly calls an ordinary service for required work.',
      'After commit: use an after-commit listener only when the original mutation may remain committed if the reaction fails.',
      'Eventual: use queued delivery when the consequence is independently retryable and may happen later. A queued Listener may dispatch an Action as a new top-level operation; a queued Job owns its attempt transaction directly.',
      'Events represent accepted facts and genuine reactions. Do not introduce asynchronous events merely to bypass nested Action dispatch.',
      'Example: if a reminder is removed if and only if a notification is created, DeliverDueReminders owns one transaction, calls NotificationCreator, dispatches NotificationCreated, deletes the reminder, and commits or rolls back everything.',
    ].join('\n'),
  ),
  concept(
    'concept.execution-transactions',
    'concept',
    '@doxajs/core',
    'execution-transactions.md',
    'Execution scopes and transactions',
    ['unit of work', 'scope', 'transaction owner'],
    'Every admitted entry point owns one execution; asynchronous delivery starts another.',
    'One owner prevents nested containers and ambiguous commit behavior.',
    [
      'Requests, Actions, Queries, Job attempts, Commands, and queued listeners are admitted boundaries.',
      'Inline services, local listeners, observers, and signals share the current execution.',
      'Actions and Jobs receive writable model sessions. Queries receive read-only model sessions.',
      'Services resolve in the caller’s scope and therefore see the caller’s active model session and unit of work.',
    ].join('\n'),
  ),
  concept(
    'concept.providers-provides',
    'concept',
    '@doxajs/core',
    'providers-and-provides.md',
    'Providers, services, and Feature exports',
    ['provider vs service', 'Feature.provides', 'Feature.providers'],
    'Providers are singleton infrastructure; provides is a Feature visibility declaration for ordinary services.',
    'Conflating them promotes execution-specific application behavior into unsafe global state.',
    [
      'Feature.providers selects infrastructure implementations with durable IDs and lifecycle.',
      'Feature.provides intentionally exposes a concrete ordinary service across Feature boundaries.',
      'Exporting a service preserves transient or ExecutionScoped behavior; it does not make the service singleton.',
      'A class cannot be both a provider and a provided service.',
    ].join('\n'),
  ),
  concept(
    'concept.authorization',
    'concept',
    '@doxajs/core',
    'authorization.md',
    'Authorization ownership',
    ['public', 'ability', 'policy'],
    'Every admitted entry role fails closed unless public or protected by a declared ability.',
    'A single explicit decision path is inspectable and prevents accidental privilege widening.',
    'Credential constraints deny first. A PermissionSource supplies application grants. A resource Policy may narrow but never widen them. Services do not replace entry-role authorization.',
  ),
  concept(
    'concept.testing',
    'concept',
    '@doxajs/testing',
    'testing.md',
    'Testing Doxa architecture',
    ['harness', 'rollback', 'fake'],
    'Test behavior through admitted boundaries and assert the guarantee the architecture claims.',
    'Architecture is correct only when failure, rollback, delivery phase, authorization, and retry behavior are executable.',
    'Use the Doxa harness for Actions, Queries, events, jobs, HTTP, fakes, and transaction semantics. Test a shared service through every owning boundary rather than constructing framework roles manually.',
  ),
  concept(
    'concept.deployment',
    'concept',
    '@doxajs/praxis',
    'deployment.md',
    'Artifact-only deployment',
    ['serve', 'work', 'migrate', 'immutable image'],
    'Build one immutable image and run role-specific commands against the same artifacts.',
    'Runtime compilation or migration would make production behavior differ by process.',
    'Run doxa build during image construction, doxa migrate as an explicit release job, doxa serve for web, and doxa work for background execution. Production startup consumes dist and .doxa artifacts only.',
  ),
  concept(
    'concept.praxis-generators',
    'concept',
    '@doxajs/praxis',
    'generators.md',
    'Praxis generator catalog',
    [
      'doxa new',
      'doxa make:feature',
      'doxa make:model',
      'doxa make:action',
      'doxa make:query',
      'doxa make:route',
      'doxa make:event',
      'doxa make:listener',
      'doxa make:signal',
      'doxa make:signal-handler',
      'doxa make:observer',
      'doxa make:job',
      'doxa make:schedule',
      'doxa make:policy',
      'doxa make:permission-source',
      'doxa make:config',
      'doxa make:provider',
      'doxa make:service',
      'doxa make:command',
      'doxa make:migration',
      'doxa make:test',
    ],
    'Praxis is the canonical way to create Doxa declarations, migrations, and architectural tests.',
    'Generators encode canonical names, folders, registration, imports, access declarations, and capability choices without giving paths runtime meaning.',
    'Use doxa new for an application; make:feature, make:model, make:action, make:query, make:route, make:event, make:listener, make:signal, make:signal-handler, make:observer, make:job, make:schedule, make:policy, make:permission-source, make:config, make:provider, make:service, and make:command for declared architecture; make:migration for application-owned schema changes; and make:test for admitted feature tests. Read the matching role guide before choosing role-specific flags.',
  ),
  concept(
    'concept.capability-catalog',
    'concept',
    '@doxajs/core',
    'capabilities.md',
    'Framework capability catalog',
    [
      'ExecutionScoped',
      'ShouldDispatchAfterCommit',
      'ShouldHandleEventsAfterCommit',
      'ShouldQueue',
      'ShouldQueueAfterCommit',
      'ShouldBroadcast',
      'ShouldBroadcastNow',
      'Starts',
      'Drains',
      'Stops',
      'Disposes',
    ],
    'Doxa marker interfaces opt declared roles into compiled scope, delivery, broadcast, and lifecycle behavior.',
    'Capabilities are explicit compile-time contracts; naming, folders, and runtime reflection must not imply them.',
    'ExecutionScoped gives an ordinary service one instance per admitted execution. ShouldDispatchAfterCommit delays an Event; ShouldHandleEventsAfterCommit delays a local Listener; ShouldQueue and ShouldQueueAfterCommit select durable Listener delivery. ShouldBroadcast and ShouldBroadcastNow select queued or synchronous broadcast. Starts, Drains, Stops, and Disposes are infrastructure-provider lifecycle phases; application roles may only use the lifecycle behavior their role permits. Provider capabilities are compiled as authentication, transactions, queues, cache, mail, sms, broadcasting, telemetry, or observations and select installed-module guidance.',
  ),
  concept(
    'diagnostic.nested-action-dispatch',
    'diagnostic',
    '@doxajs/compiler',
    'diagnostics.md',
    'Nested ActionBus reachability',
    ['ActionBus', 'nested action', 'DOXA-COMPILER-ARCH-001'],
    'Actions, Queries, and Jobs cannot directly or transitively depend on ActionBus.',
    'Each operation boundary would otherwise compete for authorization, transaction, telemetry, and failure ownership.',
    'Move reusable mutation behavior into an ordinary service. Let each top-level Action or Job call that service under its own execution and transaction.',
  ),
  concept(
    'diagnostic.provider-service-location',
    'diagnostic',
    '@doxajs/introspection',
    'diagnostics.md',
    'Provider and service convention advisories',
    ['folder warning', 'DOXA-GNOSIS-STRUCTURE'],
    'Compilation and Gnosis warn when provider/service names or opposite canonical folders communicate the wrong role.',
    'Folders do not affect runtime, but misleading structure causes humans and agents to choose unsafe patterns.',
    'Move ordinary services from providers to services and infrastructure providers from services to providers. The advisory never changes compiled ownership or scope.',
  ),
  concept(
    'diagnostic.canonical-folder',
    'diagnostic',
    '@doxajs/introspection',
    'diagnostics.md',
    'Canonical folder advisories',
    ['folder deviation', 'DOXA-GNOSIS-STRUCTURE-005'],
    'Compilation and Gnosis warn when a component is placed in another role’s canonical folder.',
    'Folders never carry runtime meaning, but an unambiguous mismatch communicates the wrong intent to humans and agents.',
    'Move the component to the canonical folder reported by explain_component, or keep the explicit registration and document the deliberate exception.',
  ),
]

const moduleDefinitions: readonly Omit<HandbookEntry, 'version'>[] = [
  moduleGuide(
    'module.core',
    '@doxajs/core',
    undefined,
    undefined,
    'Core programming model',
    'Application code imports Doxa roles and contracts from core; the handbook programming model governs their use.',
  ),
  moduleGuide(
    'module.manifest',
    '@doxajs/manifest',
    undefined,
    undefined,
    'Application manifest',
    'The versioned inert manifest is authoritative for application structure; agents and runtime code must not replace it with source discovery.',
  ),
  moduleGuide(
    'module.compiler',
    '@doxajs/compiler',
    undefined,
    undefined,
    'Semantic compiler',
    'The compiler reads declaration-only application structure, emits deterministic artifacts, and fails closed on invalid architecture.',
  ),
  moduleGuide(
    'module.runtime',
    '@doxajs/runtime',
    undefined,
    undefined,
    'Artifact-only runtime',
    'The runtime boots only compiled artifacts and owns admitted execution, transaction, lifecycle, authorization, and delivery semantics.',
  ),
  moduleGuide(
    'module.introspection',
    '@doxajs/introspection',
    undefined,
    undefined,
    'Application introspection',
    'Introspection provides bounded deterministic manifest views shared by Praxis and Gnosis.',
  ),
  moduleGuide(
    'module.gnosis',
    '@doxajs/gnosis',
    undefined,
    undefined,
    'Gnosis',
    'Gnosis combines compiled application truth with this version-matched handbook and never scans source.',
  ),
  moduleGuide(
    'module.praxis',
    '@doxajs/praxis',
    undefined,
    undefined,
    'Praxis',
    'Praxis is the canonical generator, build, migration, runtime, inspection, upgrade, and Gnosis registration command suite.',
  ),
  moduleGuide(
    'module.testing',
    '@doxajs/testing',
    undefined,
    undefined,
    'Testing harness',
    'Use admitted Action, Query, HTTP, event, and Job harness paths to prove transaction, authorization, and delivery guarantees.',
  ),
  moduleGuide(
    'module.http-hono',
    '@doxajs/http-hono',
    undefined,
    undefined,
    'HTTP adapter',
    'Routes are thin admitted adapters. Return payloads and let Doxa own success and failure envelopes.',
  ),
  moduleGuide(
    'module.postgres-drizzle',
    '@doxajs/postgres-drizzle',
    undefined,
    undefined,
    'PostgreSQL persistence',
    'Actions and Jobs write through one PostgreSQL unit of work; Queries and authorization use read-only sessions.',
  ),
  moduleGuide(
    'module.queue-pg-boss',
    '@doxajs/queue-pg-boss',
    undefined,
    undefined,
    'Queueing and scheduling',
    'Jobs are at-least-once writable executions. Queued listener intent is outbox-backed and becomes eligible only after commit.',
  ),
  moduleGuide(
    'module.auth-postgres',
    '@doxajs/auth-postgres',
    undefined,
    undefined,
    'Authentication',
    'Authentication is framework-owned and separate from application permission facts.',
  ),
  moduleGuide(
    'module.keryx',
    '@doxajs/keryx',
    ['@doxajs/keryx'],
    ['broadcasting'],
    'Realtime broadcasting',
    'Broadcast accepted facts through the selected transport; admission, authorization, and causal execution remain Doxa-owned.',
  ),
  moduleGuide(
    'module.realtime',
    '@doxajs/realtime',
    undefined,
    ['broadcasting'],
    'Realtime client',
    'The browser client follows Keryx admission and protocol contracts; application authorization remains server-owned.',
  ),
  moduleGuide(
    'module.opentelemetry',
    '@doxajs/opentelemetry',
    undefined,
    ['telemetry'],
    'Distributed tracing',
    'Doxa owns trace context across admitted executions and links durable asynchronous work causally.',
  ),
  moduleGuide(
    'module.theoria',
    '@doxajs/theoria',
    ['@doxajs/theoria'],
    ['observations'],
    'Theoria diagnostics',
    'Theoria records privacy-safe bounded execution observations and never changes application semantics.',
  ),
  moduleGuide(
    'module.sendgrid',
    '@doxajs/sendgrid',
    ['@doxajs/sendgrid'],
    ['mail'],
    'SendGrid mail',
    'Queue mail inside an Action or Job so delivery intent commits atomically with application state.',
  ),
  moduleGuide(
    'module.twilio-sms',
    '@doxajs/twilio-sms',
    ['@doxajs/twilio-sms'],
    ['sms'],
    'Twilio SMS',
    'Queue SMS inside an Action or Job so delivery intent commits atomically with application state.',
  ),
]

export function handbookIndex(version: string, manifest?: DoxaManifest): readonly HandbookEntry[] {
  return Object.freeze(
    [...roleDefinitions, ...conceptDefinitions, ...moduleDefinitions]
      .filter((entry) => !entry.activation || !manifest || isInstalled(entry.activation, manifest))
      .map((entry) =>
        Object.freeze({
          ...entry,
          version,
          aliases: Object.freeze([...entry.aliases]),
          ...(entry.details
            ? {
                details: Object.freeze({
                  ...entry.details,
                  antiPatterns: Object.freeze([...entry.details.antiPatterns]),
                  testing: Object.freeze([...entry.details.testing]),
                }),
              }
            : {}),
        }),
      )
      .sort((left, right) => left.id.localeCompare(right.id)),
  )
}

export function programmingModel(version: string): ProgrammingModel {
  return Object.freeze({
    schemaVersion: GNOSIS_HANDBOOK_SCHEMA_VERSION,
    version,
    title: 'Doxa Programming Model',
    rules: Object.freeze([
      'Begin with one admitted Doxa boundary and one execution scope.',
      'Actions are primary synchronous mutation boundaries; Job attempts are top-level asynchronous writable boundaries.',
      'Queries are read-only.',
      'Put reusable application behavior in ordinary constructor-injected services.',
      'A service joins its caller’s execution and transaction; it does not own either.',
      'Never dispatch an Action from an Action, Query, or Job, directly or through a service.',
      'Preserve atomic invariants with direct service collaboration in one transaction.',
      'Use after-commit or queued delivery only when later failure may not roll back the original mutation.',
      'Use Feature.provides for shared services and Feature.providers for singleton infrastructure.',
      'Use canonical folders for clarity, but never infer runtime registration from a path.',
    ]),
    decisionGuide: Object.freeze({
      atomic:
        'One Action or Job owns one writable transaction and directly calls ordinary services for every required mutation.',
      afterCommit:
        'Use an after-commit listener when the original mutation must remain committed even if the reaction fails.',
      eventual:
        'Use a queued Listener that dispatches a later top-level Action, or use a Job whose attempt owns the transaction, when the consequence is independently retryable and may complete later.',
    }),
    guideIds: Object.freeze([
      'concept.orchestration-consistency',
      'concept.execution-transactions',
      'concept.providers-provides',
      'diagnostic.nested-action-dispatch',
    ]),
  })
}

export function roleGuide(
  entries: readonly HandbookEntry[],
  roleName: DoxaRole,
): HandbookEntry | undefined {
  return entries.find((entry) => entry.role === roleName)
}

export function handbookEntry(
  entries: readonly HandbookEntry[],
  id: string,
): HandbookEntry | undefined {
  return entries.find((entry) => entry.id === id)
}

export function renderHandbookMarkdown(version: string): string {
  const entries = handbookIndex(version)
  const groups: readonly [string, HandbookKind[]][] = [
    ['Programming model', ['programming-model']],
    ['Framework roles', ['role']],
    ['Architecture guides', ['concept']],
    ['Diagnostics', ['diagnostic']],
    ['First-party modules', ['module']],
  ]
  const sections = groups.flatMap(([heading, kinds]) => {
    const matching = entries.filter((entry) => kinds.includes(entry.kind))
    if (matching.length === 0) return []
    return [
      `## ${heading}`,
      ...matching.map((entry) => {
        const body =
          entry.summary === entry.text ? entry.summary : `${entry.summary}\n\n${entry.text}`
        return `### ${entry.heading}\n\nStable guide: \`${entry.id}\`\n\n${body}`
      }),
    ]
  })
  return `# Doxa Agent Handbook\n\n> Generated from the canonical handbook bundled with \`@doxajs/gnosis\` ${version}. Do not edit this file independently.\n\n${sections.join('\n\n')}\n`
}

function role(
  id: string,
  roleName: DoxaRole,
  heading: string,
  aliases: readonly string[],
  details: RoleGuideDetails,
): Omit<HandbookEntry, 'version'> {
  const source =
    roleName === 'model'
      ? 'models.md'
      : roleName === 'action' || roleName === 'query'
        ? 'operations.md'
        : roleName === 'policy' || roleName === 'permission-source'
          ? 'authorization.md'
          : `roles/${roleName}.md`
  return {
    id,
    kind: 'role',
    package: '@doxajs/core',
    source,
    heading,
    summary: details.purpose,
    aliases,
    rationale: details.rationale,
    text: renderRoleText(details),
    role: roleName,
    details,
  }
}

function concept(
  id: string,
  kind: Exclude<HandbookKind, 'role' | 'module'>,
  packageName: string,
  source: string,
  heading: string,
  aliases: readonly string[],
  summary: string,
  rationale: string,
  text: string,
): Omit<HandbookEntry, 'version'> {
  return {
    id,
    kind,
    package: packageName,
    source,
    heading,
    summary,
    aliases,
    rationale,
    text,
  }
}

function moduleGuide(
  id: string,
  packageName: string,
  plugins: readonly string[] | undefined,
  capabilities: readonly string[] | undefined,
  heading: string,
  text: string,
): Omit<HandbookEntry, 'version'> {
  const activation = {
    ...(plugins ? { plugins } : {}),
    ...(capabilities ? { capabilities } : {}),
  }
  return {
    id,
    kind: 'module',
    package: packageName,
    source: 'module-guidance.md',
    heading,
    summary: text,
    aliases: [packageName, heading],
    rationale:
      'Installed first-party modules must extend the core programming model without changing its execution guarantees.',
    text,
    ...(Object.keys(activation).length > 0 ? { activation } : {}),
  }
}

function isInstalled(activation: HandbookActivation, manifest: DoxaManifest): boolean {
  const plugins = new Set(manifest.plugins.map((plugin) => plugin.package))
  const capabilities = new Set<string>(
    manifest.providers.flatMap((provider) => provider.capabilities),
  )
  return (
    (activation.plugins?.some((plugin) => plugins.has(plugin)) ?? false) ||
    (activation.capabilities?.some((capability) => capabilities.has(capability)) ?? false)
  )
}

function renderRoleText(details: RoleGuideDetails): string {
  return [
    `Purpose: ${details.purpose}`,
    `Use when: ${details.useWhen}`,
    `Registration: ${details.registration}`,
    `Generator: ${details.generator}`,
    `Canonical folder: ${details.canonicalFolder}`,
    `Invocation: ${details.invocation}`,
    `Authorization: ${details.authorization}`,
    `Transaction: ${details.transaction}`,
    `Injection: ${details.injection}`,
    `Scope: ${details.scope}`,
    `Lifecycle: ${details.lifecycle}`,
    `Dependencies: ${details.dependencies}`,
    `Rationale: ${details.rationale}`,
    `Example: ${details.example}`,
    `Anti-patterns: ${details.antiPatterns.join('; ')}`,
    `Testing: ${details.testing.join('; ')}`,
  ].join('\n')
}
