# The Doxa.js Manifesto

## Status

Doxa.js 0.1 has reached the viability bar defined by this knowledge base. Its connected acceptance
flow proves compile-to-boot composition, execution and authorization, PostgreSQL-backed atomic
durability, Eloquent-style models and observers, events and signals, Hono-backed HTTP, auth, pg-boss
workers and schedules, communications, observability, testing, Praxis, and the Gnosis read-only
architectural authority. It remains a controlled-adoption alpha rather than a production-proven 1.0
release. Doxa is independently owned and maintained by div0ky, with Midtown Home Improvements as its
sole supported consumer. Public npm availability does not open the supported adoption program or
create external compatibility and support commitments.

## Using this knowledge base

This manifesto is the constitutional document for Doxa. It records the durable convictions that
should survive changes in syntax, package layout, and infrastructure. Supporting documents turn
those convictions into decision rules and, eventually, executable specifications.

- [Principles](principles.md) distills the manifesto into tests for design decisions.
- [Architecture](architecture.md) describes the framework boundary and the dependency direction it
  requires.
- [Specifications](specifications.md) tracks the contracts that must be settled before the next
  implementation begins.
- [Technology decisions](decisions/index.md) records selected engines, rejected alternatives, and
  the boundaries that keep those engines from becoming Doxa's application model.
- [MVP viability bar](mvp.md) defines the smallest product that can honestly demonstrate the
  complete Doxa application model.
- [Security model and threat assessment](security.md) records protected assets, trust boundaries,
  abuse cases, controls, and the release review gate.
- [Controlled production adoption](decisions/0033-controlled-production-adoption.md) defines the
  alpha, controlled production beta, and production-proven 1.0 maturity stages.
- [First-class logging](specifications/logging.md) defines structured records, automatic execution
  context, safe redaction, and the colorful local console experience.
- [Telemetry and distributed tracing](specifications/telemetry-and-tracing.md) defines span
  parentage, links, instrumented scopes, and the OpenTelemetry adapter boundary.
- [Theoria](specifications/theoria.md) defines the typed execution debugger, causal timeline,
  waterfall, production diagnostics, and safety and retention boundaries.
- [AI observations](specifications/ai-observations.md) defines privacy-safe operational evidence for
  model, tool, critic, and retry work.
- [Container deployment](specifications/container-deployment.md) defines the one-image web,
  background, and migration production topology.
- [Implementation proofs](implementation/index.md) record which accepted contracts have executable
  evidence without overstating the completeness of their specifications.
- [Gnosis](specifications/gnosis.md) defines the active read-only local engineering server and
  version-matched architectural authority; its
  [product direction](future/ai-assisted-engineering.md) separates shipped capabilities from future
  extensions.

These documents have different authority:

1. The manifesto explains what Doxa is and why it exists.
2. Principles constrain choices when several designs appear plausible.
3. Specifications define observable framework behavior.
4. Implementation realizes the specifications and may be replaced when it no longer serves them.

When implementation and specification disagree, the discrepancy must be resolved explicitly. The
implementation does not silently become the design.

## What Doxa is

Doxa is an opinionated application framework for TypeScript teams that want a coherent, productive,
Laravel-like developer experience without pretending JavaScript should become PHP or rebuilding
excellent infrastructure that already exists.

Doxa is best understood as a curated distribution.

A good mod pack does not rewrite every mod. It selects strong components, pins compatible versions,
integrates them, resolves their conflicts, supplies conventions, and makes the result feel like one
designed experience. Doxa will do the same for server-side TypeScript.

Doxa will combine excellent focused libraries for HTTP, persistence, queues, validation, caching,
storage, observability, and vendor integrations. It will own the application model that connects
them. Developers should experience one framework, one vocabulary, one lifecycle, and one obvious way
to perform ordinary work.

The value is not that Doxa authored every wheel. The value is that the wheels fit one chassis, are
tested together, and disappear beneath a coherent driving experience.

## Why Doxa must own the application model

Doxa originally treated NestJS as its runtime and composition kernel. That boundary is not stable.

NestJS is not merely an HTTP engine. It has its own application graph, modules, dependency injection
container, lifecycle, controllers, providers, middleware, guards, pipes, interceptors, exception
filters, discovery model, and testing conventions. Those are precisely the surfaces Doxa must
control if it is to offer a cohesive developer experience.

Neither framework is wrong. They simply want authority over the same decisions.

Building Doxa on top of NestJS means translating Doxa concepts into NestJS concepts, preserving
NestJS escape hatches, and teaching developers where one framework stops and the other begins. Over
time, that makes Doxa a library collection with a branded facade rather than a framework with a
clear point of view.

Doxa will therefore own its application kernel. It will not build a general-purpose replacement for
NestJS. It will build only the small, opinionated kernel required by the Doxa programming model and
delegate focused technical work to focused libraries.

## Coherence over feature checklists

Doxa is inspired by what makes Laravel feel coherent, not by the goal of cloning every Laravel API.

Framework coherence comes from:

- One unmistakable application lifecycle.
- One dominant way to express each common operation.
- Vocabulary that remains consistent across features.
- First-party capabilities designed as parts of one system.
- Defaults that work together without application-level assembly.
- Documentation that teaches an application model rather than a catalog of APIs.
- Escape hatches that exist without dominating everyday code.

Having a controller, container, ORM, validator, command runner, and queue package is not enough.
Those parts must agree about how an application is structured and how work flows through it.

Doxa will prefer fewer supported patterns with excellent integration over broad flexibility that
makes every application invent its own architecture.

## Developer experience breaks ties

When multiple designs satisfy Doxa's requirements for correctness, security, durability,
operability, performance, maintainability, and explainability equally well, the design with the
better developer experience wins.

Developer experience is not decoration applied after the architecture is complete. It is one of the
framework's primary outcomes. Doxa should absorb incidental complexity into its compiler,
generators, defaults, and tooling when doing so preserves explicit behavior and strong diagnostics.
A shorter, clearer application-facing API is preferable to ceremony that exists only to make the
framework implementation easier.

Ergonomics do not excuse hidden consequences or weakened guarantees. A design that is more concise
but less safe, predictable, observable, or debuggable is not equally viable and does not win this
tie-breaker.

Doxa is deliberately opinionated, magical wherever that magic is safe, trivial for Gnosis to
understand, and extremely difficult to misuse. This is not merely an implementation preference or
documentation goal. It is the point of the framework.

Doxa should make routine choices on the application's behalf, infer what can be proven safely,
generate what should not be handwritten, and reject ambiguous or unsafe constructions before the
application boots. Every ordinary task should have one recognizable Doxa shape. That shape must be
simple enough for a developer to remember, explicit enough for the compiler to verify, and regular
enough for Gnosis to generate and explain without guessing.

The framework should spend complexity so applications do not have to. When safe automation is
possible, forcing repetitive configuration onto developers is a framework failure. When safety
cannot be inferred, Doxa must require an intention-revealing declaration and provide a precise
diagnostic rather than silently guessing.

## Object-oriented by conviction

Doxa believes application behavior belongs in objects with identity, state, invariants, and explicit
collaborators. Domain models, actions, queries, policies, observers, listeners, jobs, schedules, and
console commands should primarily be classes resolved through constructor injection.

This is not nostalgia for class syntax and it is not permission to build inheritance hierarchies for
their own sake. The value is encapsulation: an object owns behavior, protects its invariants, and
exposes an intention-revealing interface. Polymorphism belongs at deliberate application and
infrastructure boundaries.

Doxa applications are class-first and manifest-composed. Declarative fields and helpers may assemble
features and applications, but they do not turn domain behavior into configuration. Decorators are
deferred from the MVP and may eventually provide optional metadata syntax; the object model and
dependency graph will not depend on legacy runtime reflection.

The Doxa compiler will produce an inspectable application manifest and dependency graph from
TypeScript source. Concrete classes may be autowired. Abstract ports, aliases, values, and factories
are bound explicitly. The runtime container remains small, reflection-free, deterministic, and
subordinate to the programming model.

The application chooses its features. Features own their code. Doxa discovers and wires their
declared classes. The compiler makes every resulting behavior explicit before the process boots.

Persistent models should feel alive. Doxa will hydrate identity-bearing model objects from their
stored state, track their original and changed attributes, allow behavior to mutate them, and
persist them through methods such as `save()`, `delete()`, and `refresh()`. This Eloquent-like
experience is part of the framework promise, not optional repository boilerplate every application
must recreate.

Events should feel equally natural. A developer should be able to define a named event class,
dispatch it from any Doxa-managed application context, and attach typed listener classes whose
`handle` methods state exactly what they consume. Queueing, after-commit delivery, and future
broadcasting should be concise class capabilities rather than dispatcher plumbing repeated at each
call site.

Folder paths organize humans; imports and Feature declarations organize Doxa. Applications may use
role-first folders, domain folders, vertical slices, or workspace packages without changing
framework semantics or adding discovery configuration. Moving a file must not change the identity,
ownership, or behavior of the class it contains.

Large business logic should decompose naturally. Ordinary concrete services and helpers are
autowired through constructor reachability without base classes, decorators, provider entries, or
Feature registration. These collaborators remain directly constructible in focused unit tests.
Cross-feature concrete dependencies are rejected unless the application exposes an intentional
capability or port.

Configuration should feel like ordinary typed application code. Applications and Features declare
configuration classes, Doxa derives conventional environment names and validation, and services
inject frozen groups for direct property access. Only declared configuration exists inside the
application; unusual schemas remain an escape hatch rather than common-path ceremony.

The ergonomic surface does not weaken the execution model. Model persistence participates in the
active Doxa unit of work, optimistic concurrency, lifecycle observers, journal, outbox, actor
context, and transaction. A model cannot silently open an unrelated transaction or expose the
private database engine.

## Our promise to developers

If a team subscribes to Doxa's opinions, Doxa should make application development feel almost
unfairly simple.

Developers should spend their design energy on their domain. They should not repeatedly assemble
HTTP middleware, transaction boundaries, validation, authorization, serialization, background
delivery, tracing, test fakes, and shutdown behavior.

Doxa should make the correct path the short path.

More strongly, the correct path should be the obvious path, and incorrect paths should be hard to
express accidentally. Framework APIs should be designed for both human and machine comprehension:
few concepts, stable patterns, strong types, deterministic manifests, excellent diagnostics, and no
ceremony that exists only because Doxa declined to make a safe decision.

The framework may feel magical, but its behavior must remain explainable. Good magic removes
repetition while preserving a comprehensible execution model. Bad magic hides ordering, failure, or
state behind conventions that cannot be inspected.

Doxa will automate the tedious parts and make the consequential parts explicit.

## Identity, authority, and causality are one system

Authentication does more than attach a user to an HTTP request. It establishes identity for the
framework-wide actor model that governs authorization, observability, auditing, journal records,
jobs, and tests.

Doxa distinguishes the actor performing work from the initiator who began the larger chain. They are
often the same in synchronous work, but they must not be collapsed. A delayed job may execute as a
named worker or system actor while preserving the user who originally caused it. Impersonation and
delegation must retain both sides of the authority transfer rather than overwrite history.

Every request, action, query, listener, job, schedule, console command, WebSocket message, and
future transport participates in one immutable execution context. That context carries actor,
initiator, tenant, delegation, correlation, causation, trace linkage, deadline, and cancellation
through a documented lifecycle.

Doxa will attach this causal metadata automatically to logs, traces, security audits, journal
entries, outbox records, and jobs. Sensitive identity data will not be propagated merely because it
is observable. Durable records retain the opaque references required to explain what happened;
general telemetry applies deliberate disclosure, pseudonymization, and cardinality rules.

Authentication mechanisms and optional auth plugins may prove identity. They do not define the
application actor, session semantics, tenant authority, or authorization model. Doxa owns the
translation from authenticated identity to actor and applies default-deny policies through one
consistent pipeline across every execution type.

## The framework boundary

Doxa owns:

- The application lifecycle.
- Application and feature composition.
- Dependency registration and resolution.
- Execution context and scoping.
- Actions, queries, and their dispatch.
- Domain models and persistence semantics.
- Transactions and units of work.
- Domain events, the journal, and the outbox.
- Listeners, observers, jobs, and schedules.
- The public HTTP programming model.
- Authentication and authorization integration.
- Validation behavior and error representation.
- Resources and response serialization.
- Configuration conventions.
- Testing APIs and framework fakes.
- The CLI, generators, diagnostics, and project structure.
- Compatibility between the curated components beneath it.

Doxa delegates:

- HTTP routing and request mechanics.
- Database drivers and query engines.
- Queue transport and distributed job mechanics.
- Schema validation algorithms.
- Cache and storage transports.
- WebSocket protocols and servers.
- Cryptography.
- Logging and telemetry transports.
- Vendor-specific API clients.

Delegation is deliberate. A delegated library is an implementation engine, not a second public
framework.

## Hono is the initial HTTP engine

Doxa will begin with Hono as its private HTTP routing and middleware engine, with the Hono Node
server adapter as the initial runtime implementation.

Hono is selected because it is focused, stable, fast, Web Standards-based, portable, testable
without opening a socket, and capable enough to keep Doxa out of low-level HTTP mechanics. It does
not require control over the entire application architecture.

Hono is not part of the public Doxa programming model.

Application and feature code must not depend on Hono contexts, exceptions, validators, middleware
types, RPC types, or route builders. Doxa will compile its own HTTP definitions into Hono
registrations through an adapter.

The foundational transport boundary is the Web Standards contract:

```ts
export interface HttpEngine {
  fetch(request: Request): Promise<Response>
}
```

Doxa should remain intelligible if Hono is replaced tomorrow. An adapter conformance suite will
protect that boundary.

H3 remains a credible future engine. Its small, composable design and relationship with the UnJS
ecosystem align well with Doxa. We are not selecting it initially because Doxa should begin on the
more settled foundation, not because H3 is philosophically unsuitable. The adapter boundary allows
this decision to change without changing application code.

Nitro is not the Doxa kernel. Nitro is itself a server framework and build/deployment system. It may
eventually host a Doxa Web Standards handler, but Doxa will not adopt Nitro's application model,
routing conventions, plugin lifecycle, or configuration as its own foundation.

## Adapters are containment boundaries

Every major infrastructure dependency should sit behind a Doxa-owned contract when its native API
would otherwise shape application code.

An adapter is not ceremonial indirection. It gives Doxa four important properties:

1. Doxa controls the vocabulary developers use.
2. Compatibility and configuration live in one maintained place.
3. Infrastructure can be replaced without rewriting feature code.
4. Tests can use faithful framework fakes instead of mocking vendor internals.

Adapters must not become lowest-common-denominator abstractions. Doxa should expose the capabilities
its programming model promises and choose infrastructure that implements them well. We do not need
interchangeable implementations merely for the appearance of flexibility.

Where developers need an escape hatch, prefer durable standards and Doxa contracts. For HTTP, that
means `Request` and `Response`, not a Hono context. Escape hatches should be intentional, visible,
and uncommon.

## A curated compatibility contract

A Doxa release represents a tested combination of framework behavior and infrastructure versions.

Doxa will:

- Select foundational dependencies intentionally.
- Pin their versions rather than outsource compatibility to each application.
- Configure secure and production-ready defaults.
- Maintain integration and adapter conformance tests.
- Test boot, normal operation, failure, retry, and shutdown behavior across the stack.
- Upgrade dependencies through deliberate Doxa releases.
- Describe behavior changes rather than merely list dependency bumps.
- Provide one supported path before providing multiple optional paths.

Applications should upgrade Doxa, not independently solve a compatibility matrix across a dozen
runtime packages.

Controlled adoption makes this discipline more important, not less. Doxa should let the supported
consumer move quickly because the framework has already made and verified the infrastructure
decisions. If the adoption program later opens, this compatibility contract becomes part of the
supported product rather than an internal assumption that must be reconstructed.

## The desired programming experience

Application composition should approach this level of simplicity:

```ts
export class Application extends DoxaApplication {
  features = [OrdersFeature, CustomersFeature, BillingFeature]
}
```

A feature should describe its capabilities without exposing infrastructure composition:

```ts
export class OrdersFeature extends Feature {
  id = 'orders'
  models = [Order]
  actions = [CreateOrder, UpdateOrder]
  queries = [GetOrder, ListOrders]
  events = [OrderShipped]
  observers = [OrderObserver]
  listeners = [SendOrderCreatedNotification]
  routes = [OrdersController]
}
```

An event should be a named application fact that can be dispatched wherever the application needs
it, without requiring a payload constructor:

```ts
export class OrderShipped extends Event<{ orderId: string }> {}

await OrderShipped.dispatch({ orderId: order.id })
```

Framework-facing classes extend their Doxa role and receive scoped dependencies through
`this.inject()`. They also receive an automatically class-bound `this.logger`. Ordinary services
remain plain classes and use constructor injection. Normal application code never writes `super()`;
it appears only when a developer intentionally implements an exceptional custom role constructor.

An HTTP endpoint should express application intent rather than HTTP plumbing:

```ts
@HttpController('/orders')
@Authenticated()
export class OrdersController {
  public constructor(
    private readonly actions: ActionBus,
    private readonly queries: QueryBus,
  ) {}

  @Post('/')
  public create(@Body(CreateOrderRequest) input: CreateOrderInput): Promise<OrderResource> {
    return this.actions.execute(new CreateOrder(input))
  }
}
```

Decorators are not yet a foregone conclusion. A declarative non-decorator API may offer better type
inference, tooling, and portability. Both styles may compile to the same application manifest. The
specification must select a primary style based on clarity and capability, not familiarity alone.

Routes return application payloads, not transport envelopes. Doxa owns the JSON boundary and
automatically emits `{ ok: true, data }` for success or
`{ ok: false, code, message, data: null, details? }` for failure. Status codes remain meaningful;
explicit Web Standards responses are reserved for bodyless or raw protocol behavior.

Testing should feel like testing the application, not reconstructing its internals:

```ts
const app = await DoxaTest.create({ features: [Orders] })
  .fake(Notifications)
  .fake(Broadcasting)
  .boot()

const response = await app.post('/orders', input).actingAs(user)

response.assertCreated()
Notifications.assertSent(OrderCreatedNotification)
```

## What Doxa should make automatic

Subject to the specifications, Doxa should be able to:

- Build an application manifest from its features.
- Resolve dependencies and validate the dependency graph at boot.
- Start and stop infrastructure in deterministic order.
- Establish request and job execution context.
- Propagate actor, correlation, causation, locale, and trace metadata.
- Validate request inputs and return canonical success and failure envelopes.
- Invoke authentication and authorization policies.
- Open transactions for mutating application operations.
- Persist entity state with optimistic concurrency.
- Append journal and outbox records atomically.
- Run model lifecycle observers at defined phases.
- Dispatch local and queued event listeners at the correct time.
- Serialize resources consistently.
- Enqueue jobs with retry, timeout, uniqueness, and context conventions.
- Reconcile schedules at boot.
- Produce useful logs, traces, and reports without per-feature wiring.
- Generate API contracts and developer documentation.
- Replace framework services with fakes in tests.
- Shut down gracefully when startup partially fails or the process receives a signal.

Every automatic behavior must have a documented phase in the application lifecycle and an observable
failure mode.

## The application kernel should remain small

Owning the kernel does not grant permission to recreate NestJS.

Doxa needs a focused container and lifecycle, not a general-purpose module metaframework. It should
support the dependency patterns the Doxa programming model actually requires:

- Values.
- Factories.
- Classes.
- Aliases or tokens where TypeScript types do not survive at runtime.
- Application singletons.
- Request and job execution scopes.
- Test overrides.
- Deterministic disposal.
- Excellent cycle and missing-binding diagnostics.

HTTP requests, jobs, schedules, console commands, listeners, and future transports each receive a
distinct execution scope with identical semantics. Doxa does not create parallel request and job
container models.

Features should compose directly. We should avoid a system in which modules import modules to export
providers to modules that indirectly expose them elsewhere. The application graph should be
inspectable, deterministic, and easy for tooling to explain.

We will add extension mechanisms in response to demonstrated application needs, not imagined
framework completeness.

## Opinionated means saying no

Doxa will not optimize for every TypeScript team.

Doxa will choose:

- A preferred project structure.
- A preferred way to model commands and reads.
- A preferred transaction boundary.
- A preferred event delivery model.
- A preferred validation and error shape.
- A preferred testing vocabulary.
- A preferred queue and scheduling model.
- A preferred way to represent infrastructure ports.
- A preferred path for common production concerns.

Teams that reject these opinions may be better served by focused libraries or a more configurable
framework. That is healthy. Doxa succeeds by making its chosen path exceptional, not by making every
path possible.

## Non-goals

Doxa is not:

- A reimplementation of NestJS.
- A wrapper that renames every method from its dependencies.
- A generic dependency injection container project.
- A generic HTTP framework.
- A database engine, generic SQL query builder, or schema-diff migration generator written from
  scratch.
- A queue transport written from scratch.
- A universal compatibility layer for arbitrary infrastructure choices.
- A Laravel syntax clone.
- A collection of unrelated packages marketed under one name.
- An excuse to hide consequential domain behavior.

Doxa will not compete on the number of replaceable components. It will compete on how little
application developers must think about components that should already work together.

## Standards for framework magic

Framework magic is acceptable when it meets all of these standards:

1. It removes recurring application-level tedium.
2. It behaves deterministically.
3. Its lifecycle phase is documented.
4. It can be inspected through tooling or diagnostics.
5. Its failures point to the application concept the developer understands.
6. It can be replaced or overridden in tests through Doxa APIs.
7. It does not require application code to understand the hidden engine.

If a behavior cannot meet those standards, prefer explicit code.

## Success criteria

Doxa is succeeding when:

- A new developer can trace a request from route to durable side effects without learning the
  internals of the HTTP, database, queue, or telemetry engines.
- A feature reads primarily as domain vocabulary and application intent.
- The normal implementation path is short, safe, and consistent.
- Cross-cutting behavior is configured once and applied predictably.
- Tests express application behavior using Doxa-owned fakes and assertions.
- Framework diagnostics explain the resolved application graph and lifecycle.
- Infrastructure upgrades are absorbed and verified by Doxa rather than every application.
- An adapter can be replaced without changing feature code.
- Escape hatches remain available but rarely necessary.
- The documentation feels like one book written for one system.

## The next repository

The next Doxa repository should begin with specifications, not implementation momentum.

The initial specification set should define:

1. The application and feature model.
2. The application lifecycle and failure semantics.
3. The dependency container and execution scopes.
4. The HTTP manifest and Hono adapter boundary.
5. Actions, queries, and handler dispatch.
6. Domain models, repositories, and units of work.
7. Journal, outbox, events, listeners, and observers.
8. Jobs, retries, uniqueness, schedules, and worker lifecycle.
9. Authentication, authorization, and execution context.
10. Resources, validation, and error documents.
11. Testing applications, fakes, and assertions.
12. Configuration, observability, diagnostics, and CLI behavior.
13. Adapter contracts and the compatibility test suite.
14. Package boundaries and dependency rules.

Each specification should answer:

- What does the application developer write?
- What does Doxa guarantee?
- Which lifecycle phase owns the behavior?
- How does failure behave?
- How is it tested?
- What is the escape hatch?
- Which implementation dependency performs the underlying work?
- How is that dependency prevented from leaking into feature code?

## Closing conviction

Doxa should feel like a framework, not like a pile of libraries and not like a facade over another
application framework.

It will earn that coherence by being decisive above the infrastructure boundary and humble below it:
opinionated about the developer experience, rigorous about compatibility, and eager to rely on
excellent focused tools.

We are not rebuilding the ecosystem.

We are making the ecosystem feel like one thing.
