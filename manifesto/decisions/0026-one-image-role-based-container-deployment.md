# 0026: Ship One Immutable Image with Role-Based Container Commands

- **Status:** Accepted
- **Accepted:** 2026-07-11
- **Scope:** Generated production deployment baseline
- **Decision owners:** Doxa maintainers

## Decision

Doxa applications will ship one immutable production image. Deployments run that exact image as
separate process roles rather than building role-specific images:

| Role       | Command        | Scaling                                                   |
| ---------- | -------------- | --------------------------------------------------------- |
| Web        | `doxa serve`   | Horizontally scalable                                     |
| Background | `doxa work`    | Horizontally scalable; consumes queues and runs schedules |
| Migration  | `doxa migrate` | One-off release job                                       |

`doxa schedule` remains available when an advanced deployment deliberately isolates schedule
admission from queue consumption. It is not the generated default.

> Containers specialize by command. Images do not specialize by role.

## Build and boot boundary

`doxa build` runs during the image build and produces `dist/` plus the canonical `.doxa/` manifest
and registry. Production runtime commands consume those artifacts and must not compile TypeScript,
inspect source files, mutate generated artifacts, or install dependencies during boot. Missing or
incompatible artifacts fail closed with a diagnostic that tells the operator to build the
application.

`doxa dev` remains the source-watching, compiling, migrating, hot-reloading development command. The
production boundary must not inherit those behaviors.

## Background scheduling safety

Every background replica may enable both worker and scheduler behavior. This is safe because the
accepted scheduling adapter is distributed by construction:

- Cron reconciliation converges on stable pg-boss schedule keys.
- Interval slots derive deterministic UUIDs from schedule identity and Unix-time slot.
- PostgreSQL admits at most one interval transport record for a slot.
- Existing overlap policy governs execution concurrency after admission.

Scaling background replicas therefore increases queue consumption without multiplying scheduled
firings or requiring a process-local leader.

## Migration boundary

Migrations use the same image as application roles but run as an explicit release job. Web and
background startup never run migrations automatically. A failed migration prevents release promotion
rather than racing multiple starting replicas.

## Generated artifacts

`doxa new` generates:

- `Dockerfile`: pinned Node 26, pnpm, multi-stage build, production dependencies, non-root runtime,
  precompiled Doxa artifacts, and a web default command.
- `.dockerignore`: excludes credentials, local dependencies, generated output, tests, and local
  tooling residue from the build context.
- `compose.production.yaml`: one shared image with web, background, and release-profile migration
  services.

The production Compose file is an executable topology example, not a claim that Compose is Doxa's
only supported orchestrator.

## Gnosis contract

Gnosis describes the image strategy, build outputs, role commands, scaling posture, migration
boundary, required environment, health expectations, scheduler distribution guarantee, and advanced
isolation option. Agents must be able to deploy a Doxa application without inventing a process model
or placing migrations in an entrypoint.

## Safety invariants

- The same image digest runs every role in one release.
- Application secrets enter at runtime and are never copied into image layers.
- Runtime processes run as a non-root user.
- Web health checks use Doxa's framework-owned `GET /health` endpoint. Applications cannot remove,
  protect, or replace this operational contract.
- Background health is process/lifecycle health; it does not pretend to expose HTTP.
- `SIGTERM` reaches Praxis so Doxa drains before shutdown.
- Theoria remains inactive in production unless the explicit bounded `production-diagnostics`
  profile and protected operator access are configured.
- A release runs migrations once before promoting application roles.

## Consequences

- One build proves one release artifact and eliminates web/worker Dockerfile drift.
- Background replicas are operationally simple while remaining distributed-safe.
- Production images cannot rely on source-time compilation or development dependencies.
- Applications may still author platform-specific manifests around the canonical role commands.

## Required implementation proof

1. Generated container files encode one image and the three default roles.
2. `serve` and `work` boot precompiled artifacts without invoking TypeScript or the compiler.
3. `work` enables worker and scheduler behavior by default.
4. `schedule` can still isolate schedule admission intentionally.
5. Missing build artifacts fail before application infrastructure starts.
6. Migrations are explicit and absent from web/background startup.
7. Gnosis reports the same topology and invariants as generated files.
8. Docker validates the generated Dockerfile and Compose configuration.
9. The framework-owned health endpoint remains present when the user-owned App Feature changes.

## References

- [pg-boss queue and scheduling](0010-pg-boss-queue-scheduling.md)
- [Deterministic runtime lifecycle](0017-deterministic-runtime-lifecycle.md)
- [Gnosis](0013-first-party-ai-engineering-mcp.md)
- [Container deployment specification](../specifications/container-deployment.md)
