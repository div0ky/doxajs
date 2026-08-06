# Application Permission Source and Shared Service Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-17
- **Extended:** 2026-07-23 with first-class authorization model sessions
- **Governing decisions:**
  [Path-independent services](../decisions/0016-path-independent-structure-autowired-services.md),
  [application permission sources](../decisions/0034-application-permission-sources.md), and
  [authorization model sessions](../decisions/0035-read-only-model-sessions-during-authorization.md)

This slice closes the concrete-service branch of the accepted `Feature.provides` contract and adds
the first-party `PermissionSource` integration seam for application-owned group and user
permissions.

## Shared execution-scoped services

`Feature.provides` now marks an ordinary concrete service as an intentional cross-Feature
capability. The compiler records the declaring Feature as owner and preserves normal service scope:
an `ExecutionScoped` service remains execution-scoped and an unmarked service remains transient. The
service is not promoted into `Feature.providers`, does not become an infrastructure singleton, and
gains no application lifecycle.

The reference application exports `ApplicationAccess` and `ExecutionCounter` from
`SharedStateFeature`. `ApplicationPermissions`, owned by a separate authorization Feature, injects
the shared access service. `OperationsFeature` actions and queries inject the same shared counter.
Compilation proves stable owner-qualified service IDs; runtime tests prove one instance within an
execution, a different instance in concurrent executions, and execution disposal.

Unprovided concrete dependencies remain private. Ambiguous ownership, duplicate exports, and
provider/service category conflicts fail compilation.

## Permission source

`PermissionSource` is a framework role with a stable ID, a literal ability catalog, scoped
`this.inject()` dependencies, and `resolve(request)`. An application selects zero or one source
through `Feature.permissionSources`.

Manifest format 5 records the optional source, its exact abilities, source provenance, execution
scope, dependencies, and lifecycle metadata. Runtime boot includes the source in manifest/registry
integrity checks and constructs it only from the generated registry. The current compiler and
artifact boundary reject the framework-owned `accounts.impersonation.stop` ability from application
source catalogs.

The authorization pipeline now proves:

1. Credential constraints deny before source resolution.
2. A source-only `contact.read` grant authorizes a protected query.
3. Missing source grants deny with `permission_required`.
4. A `contact.update` policy can narrow a source grant but cannot widen a source denial.
5. Source resolution is cached at most once within an execution and repeated in the next execution
   that checks a source-managed ability.
6. Unknown application records grant nothing.
7. Source loading failures and undeclared returned abilities fail closed.
8. Final decisions retain structured source or policy identity for audit and telemetry without
   recording raw permission facts.

Permission results remain outside `ExecutionContext` and every durable propagation envelope.
Existing queue, retry, listener, schedule, command, HTTP, and WebSocket admission paths therefore
create a new store with no cached source result and re-evaluate current permissions.

## First-class model hydration

The persistence reference application includes a consumer-shaped user, group, permission, user
assignment, and group assignment graph. Its permission source resolves direct and group abilities
with:

```ts
const user = await User.with(['permissions', 'group.permissions']).find(actorId)
```

The source imports no `TransactionManager`, `ModelStorage`, entity-type construction, raw
`queryEntities` reader, or persisted-state representation. A resource policy uses the same ambient
model API.

Runtime and persistence evidence proves that query entry authorization shares one read transaction,
snapshot, and identity map with the query handler. Action and job entry authorization runs inside
the owning transaction through a separate read-only session before the writable handler session is
constructed. Resource authorization invoked from writable handlers receives another read-only
identity map over that Unit of Work. Direct authorization and protected routes, commands, standalone
listeners, signal handlers, schedules, and WebSocket subscriptions receive bounded read sessions.

Source and policy `create`, `save`, and `delete` attempts fail with `ReadOnlyExecutionError` before
persistence. A policy's injected `UnitOfWork` is also guarded read-only and cannot register an
`afterCommit` callback against the action or job transaction. Nested policy authorization reuses the
current read-only session, and the application permission source still resolves at most once per
admitted execution. Captured authorization models become stale when their session closes.

## Inspection

Praxis generates sources through `make:permission-source`, exports ordinary adapters through
`make:service --provide`, and exposes `permission-source:list` plus its JSON form. Shared
introspection and Gnosis expose the same bounded manifest fact through `permissionSources` and
`list_permission_sources`. Inspection contains only the declared catalog and source graph metadata;
it never invokes the source or loads application permission records.

## Evidence

- `tests/foundation.test.ts` proves shared ownership, preserved execution scope, private-service
  rejection, source/policy composition, source caching, credential precedence, source failures,
  catalog validation, and one-source compilation.
- `tests/persistence.test.ts` proves consumer-shaped relationship hydration, query snapshot and
  identity reuse, action/job read-only isolation over one transaction, nested resource
  authorization, bounded direct authorization reads, mutation rejection, missing-record denial, and
  session closure.
- `tests/testing.test.ts` repeats the consumer-shaped proof through the first-party memory adapter
  and covers protected non-operation roles, default-deny and credential transaction elision,
  failure, cancellation, and concurrent session isolation. `tests/broadcasting.test.ts` proves
  private-channel policy model access through the runtime WebSocket subscription gateway.
- `tests/gnosis.test.ts` proves manifest-format compatibility and shared deterministic
  introspection.
- `tests/praxis.test.ts` and the repository verification gate cover the expanded inspection surface,
  generated application compatibility, documentation links, package archives, and consumer
  installation.

## Deliberate boundary

Doxa still does not define permission, group, role, membership, assignment, or administration
tables. Abstract-port bindings and typed-token exports remain governed by their separate container
contract; this slice specifically proves the concrete ordinary-service sharing required by the
application permission adapter.
