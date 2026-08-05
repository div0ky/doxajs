# 0017: Use a Runtime-Owned Deterministic Lifecycle

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Scope:** MVP
- **Decision owners:** Doxa maintainers

## Decision

Doxa's runtime owns one deterministic lifecycle:

```text
start → ready → drain → stop → dispose
```

Providers and adapters may participate through exactly four optional lifecycle hooks: `start()`,
`drain()`, `stop()`, and `dispose()`. Readiness is a runtime-controlled state reached only after
validation, construction, startup, and readiness checks succeed.

Feature and Application declarations have no lifecycle hooks and are never constructed.

## Public lifecycle API

Ordinary application code uses one public lifecycle surface:

```ts
const runtime = await Doxa.boot(Application)

await runtime.shutdown()
```

`Doxa.boot()` validates the artifacts and configuration, constructs the runtime graph, starts
lifecycle participants, performs readiness checks, and resolves only after the runtime reaches
`ready`. It never returns a half-started runtime. Failure completes the required unwind and rejects
according to the accepted primary- and cleanup-error model.

`runtime.shutdown()` performs drain, stop, and disposal. It is idempotent: repeated and concurrent
callers receive the same shutdown promise and cannot initiate competing lifecycle transitions. A
stopped runtime cannot restart; callers create a new runtime through a new boot instead.

Individual phase controls are internal host-adapter capabilities. Ordinary application code cannot
skip drain, stop resources without disposal, force readiness, or manually transition lifecycle
state.

### Restricted tooling profiles

An accepted first-party development tool may request a named restricted runtime profile when the
complete application lifecycle would violate that tool's safety boundary. A restricted profile is
not a partially started application runtime: it validates the complete artifact pair, then
materializes configuration, constructs providers, and runs lifecycle hooks only for the explicitly
owned capability and its declared dependency closure.

The `model-reader` profile exists solely for bounded Gnosis model inspection. It starts the selected
transaction provider and its dependency closure, substitutes no-op diagnostics, does not construct
or start unrelated queue, observation, authentication, communication, cache, or broadcast providers,
and admits only the dedicated model-record query entrypoint. Shutdown owns exactly the participants
that the profile started. Adding another profile requires an accepted decision; hosts cannot supply
arbitrary provider filters.

## Process host integration

`Doxa.boot()` does not install `SIGTERM`, `SIGINT`, uncaught-error, rejection, or other
process-global handlers. Booting a runtime must not mutate global process behavior or interfere with
another runtime or concurrent test.

Official Node host adapters and commands such as `doxa serve` and `doxa worker` own process signal
integration. The first termination signal initiates idempotent `runtime.shutdown()` with the host's
configured deadline. Repeated signals may escalate cancellation according to explicit host policy.
Host adapters must remove handlers they install when their runtime terminates.

Embedded applications may wire their own host policy around the public lifecycle API. The Doxa
kernel exposes lifecycle state and normalized outcomes but never calls `process.exit()`; final
process termination and exit-code policy belong to the host.

## Startup

Runtime startup proceeds through these phases:

1. Validate manifest format, manifest-registry integrity, configuration, dependency graph, scopes,
   and required capabilities without executing application behavior.
2. Construct the complete singleton graph, or the declared dependency closure for an accepted
   restricted profile, through synchronous, side-effect-free constructors.
3. Invoke `start()` for the selected lifecycle participants in dependency order.
4. Perform declared readiness checks.
5. Transition atomically to `ready` and begin admitting work.

`start()` acquires resources and begins internal behavior. A provider must not admit framework work
before the runtime reaches `ready`.

If validation, construction, startup, or readiness fails, the runtime must not enter `ready` and
must unwind every lifecycle participant that successfully started.

## Dependency-derived ordering

Dependency relationships are the only semantic source of lifecycle ordering. If `Worker` depends on
`DatabasePool`, startup orders `DatabasePool` before `Worker`, while drain, stop, and disposal order
`Worker` before `DatabasePool`.

Feature-array position, provider-array position, file order, import order, source location, and
canonical ID sorting have no lifecycle meaning. Diagnostics may display unrelated peers in stable
canonical-ID order, but application behavior must not depend on that presentation order.

Unrelated providers have no guaranteed relative order and may be executed sequentially or
concurrently by a compatible runtime. If one provider requires another lifecycle participant to
reach a phase first, the application must declare a real dependency or an explicit lifecycle
ordering capability represented in the manifest.

## Readiness

`ready` is a runtime state, not a provider hook. Providers may contribute inspectable readiness
checks, but they cannot mark the application ready, admit work independently, or mutate the
application graph during readiness.

The runtime becomes ready only when all required startup work and readiness checks succeed. The
transition and its failure are observable through structured diagnostics and health state.

## Drain

Drain stops admission before shutdown proceeds. `drain()` allows HTTP servers, workers, schedulers,
consumers, and other active providers to stop accepting new work and finish or hand off work already
accepted according to their contract.

The runtime remains not-ready while draining. New framework executions must be rejected or routed
away through the entry point's documented behavior.

## Stop

`stop()` ends active behavior after drain completes or its deadline expires. It stops loops,
workers, polling, timers, servers, and other activity that should no longer run but may still rely
on acquired resources during shutdown.

## Dispose

`dispose()` releases acquired resources. Disposal runs after active behavior stops and unwinds
participants in reverse dependency order. Execution-scoped resources use the same disposal contract
when their execution ends.

`stop()` and `dispose()` must be safe during partial startup and repeated shutdown attempts.
Implementations must not assume every other provider reached `start()` or `ready`.

## Deadlines and cancellation

Lifecycle hooks must not wait indefinitely. Every hook receives a runtime-owned lifecycle context:

```ts
interface LifecycleContext {
  signal: AbortSignal
  deadline: Instant
}
```

Runtime configuration owns startup, drain, stop, disposal, and total-shutdown deadlines. Hooks must
observe cancellation and settle promptly after their signal is aborted. Deadline exhaustion produces
a normalized lifecycle timeout containing the participant, phase, start time, deadline, and elapsed
duration.

A drain timeout advances shutdown into forced stop. Later phase behavior must preserve the global
shutdown deadline and report participants that do not cooperate with cancellation. The Doxa kernel
never calls `process.exit()`; the runtime host decides how to terminate a process that cannot
settle.

## Failure and observability

Every lifecycle transition must expose its phase, participant ID, source provenance, duration,
outcome, and normalized failure. Cleanup failures must be reported without hiding the original
startup or runtime failure that caused the unwind.

Startup and readiness failure trigger a full unwind of every participant that successfully started.
The runtime waits for already-starting lifecycle work to settle, then stops and disposes successful
participants in reverse dependency order. The runtime never transitions to `ready`.

The initiating startup or readiness failure remains the primary error returned by boot. Stop and
dispose failures are preserved as ordered secondary cleanup errors and emitted individually through
diagnostics; they must not replace, mask, or rewrite the initiating cause.

Boot rejects only after unwind completes or reaches its cleanup deadline. A deadline failure adds
the participants and phases that did not settle to the cleanup errors while preserving the original
failure as primary.

The exact timeout, cancellation, and process-signal policies remain specification work. They must
preserve this primary-error and cleanup-error model.

## Consequences

- No arbitrary `boot()` hooks can hide registration or mutate the graph.
- Providers use the same lifecycle vocabulary regardless of infrastructure engine.
- Readiness reflects the complete application rather than individual provider optimism.
- Partial startup has an explicit unwind path.
- Active shutdown and resource release remain separate phases.

## Required implementation proof

The MVP must prove:

1. Validation failure executes no constructors or lifecycle hooks.
2. `Doxa.boot()` resolves only with a ready runtime or rejects after required unwind.
3. Concurrent shutdown callers share one idempotent lifecycle transition and promise.
4. A stopped runtime rejects restart attempts.
5. `Doxa.boot()` installs no process-global handlers.
6. Official Node hosts translate termination signals into idempotent shutdown and remove their
   handlers afterward.
7. Constructors remain synchronous and side-effect-free.
8. Successful startup reaches readiness only after all required starts and checks succeed.
9. Dependencies start before dependents and shut down after dependents.
10. Reordering arrays, imports, and files does not change lifecycle ordering.
11. Startup failure never reaches readiness and fully unwinds successfully started participants.
12. The initiating failure remains primary while every cleanup failure remains inspectable.
13. Boot rejects only after unwind completion or cleanup deadline exhaustion.
14. Every lifecycle hook receives an abort signal and deadline.
15. Deadline exhaustion produces a normalized participant- and phase-specific timeout.
16. Drain timeout advances shutdown to forced stop without resetting the global deadline.
17. Drain stops new admission while allowing accepted work to follow its deadline policy.
18. Stop ends active behavior before resource disposal.
19. Disposal releases execution and singleton resources in the required order.
20. Repeated shutdown and partial-startup cleanup do not double-release resources incorrectly.
21. Diagnostics identify every lifecycle participant, phase, duration, and failure.

## References

- [Doxa architecture](../architecture.md#runtime-lifecycle)
- [Class-first container](0011-class-first-oop-container.md)
- [Application and Feature declarations](0014-explicit-features-generated-manifest.md)
- [Doxa MVP viability bar](../mvp.md#required-foundation)
