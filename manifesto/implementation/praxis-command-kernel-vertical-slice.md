# Praxis Command Kernel Vertical Slice

- **Status:** Implemented proof
- **Working name:** Praxis
- **Completed:** 2026-07-10

`@doxajs/praxis` provides Doxa's first-party Artisan-like command suite. The canonical executable is
`doxa`, exposed in this workspace through `pnpm doxa`.

Praxis implements application creation; every canonical `make:*` role; compilation; migrations;
serve, worker, scheduler, combined development, and test processes; application commands; graph and
role inspection; Gnosis registration and version-matched knowledge generation; and queue, delivery,
auth, journal, outbox, cache, and schedule operations. Human-facing builds print the compiler's
handbook-linked architecture advisories without changing the successful build result.
`doxa db:studio` launches the framework-pinned Drizzle Studio using the declared `.env` database
without placing credentials in command arguments. Generators use the canonical Feature declaration,
add imports and role-array entries automatically, and reject overwrites. Route generation requires
an explicit path, defaults to `GET`, and emits explicitly public access unless `--ability=...`
protects it. Other generated entry points continue to require an explicit `--public` or
`--ability=...` posture. `--help` and `-h` print the complete command surface and exit successfully
from every argument position before any command validation, application dispatch, or side effect.

`make:permission-source` generates and registers the application's static ability catalog.
`make:service --provide` creates an ordinary service and intentionally exports it without promoting
it to singleton provider scope.

Manual schedule firing uses the transactional outbox instead of starting an incidental scheduler
inside the command. It is therefore durable even when workers are offline. Schedule enablement is
stored in PostgreSQL and reconciled by the scheduler role. Praxis is the accepted ecosystem name.
