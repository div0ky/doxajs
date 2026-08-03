# Getting Started

Create a production-shaped Doxa application in a few minutes.

## Requirements

- Node.js 24.7 or newer within the 24.x line
- pnpm 11 through Corepack
- PostgreSQL 16 or 17
- Docker for the generated local PostgreSQL service

## Create and run

```sh
pnpm dlx @doxajs/praxis@alpha new MyApplication
cd my-application
pnpm install
cp .env.example .env
docker compose up -d
pnpm migrate
pnpm dev
```

Open `http://127.0.0.1:3000/` for the generated application. Doxa owns the mandatory public
`GET /health` operational endpoint. `pnpm dev` watches `app.config.ts` and source, preserves the
last valid runtime when compilation fails, and replaces it with a fresh process after a valid build.

## Generated structure

```text
app.config.ts
src/
  app/
  features/
migrations/
Dockerfile
compose.yaml
compose.production.yaml
```

`app.config.ts` selects user Features and optional plugins. The editable `AppFeature` owns the
default root route and any other application-level routes. Mandatory HTTP, PostgreSQL, pg-boss,
cache, auth, and health declarations are generated under gitignored `.doxa/` and remain visible in
the compiled manifest rather than user source. Folder names are organizational only.

## Migrations

Doxa uses a Laravel-like migration lifecycle. Create a timestamped migration stub, write the
forward-only SQL yourself, inspect its status, and apply it explicitly:

```sh
pnpm doxa make:migration CreateContacts
pnpm doxa migrate:status
pnpm doxa migrate
```

Praxis orders framework and application migrations, records successful applications and checksums,
and refuses drift when an applied file changes. Models remain independent from migrations: a model
may map a compatible existing table, and `managed = false` declares that Doxa must not manage that
table's schema. Doxa does not infer migrations from models or perform Drizzle-style schema diffs.

## Useful commands

```sh
pnpm doxa route:list
pnpm doxa model:list
pnpm doxa graph
pnpm doxa db:studio
pnpm doxa add sendgrid
pnpm doxa add twilio-sms
pnpm doxa add opentelemetry
pnpm doxa add theoria
pnpm doxa add keryx
pnpm test
```

Run `pnpm doxa --help` or `pnpm doxa <command> --help` for generators, inspection, recovery,
authentication, queue, schedule, cache, migration, Gnosis, and runtime commands.

## Gnosis and coding agents

Generated applications include project-scoped Gnosis registration for Codex, Claude Code, Cursor,
and VS Code plus a managed Doxa guidance block in the root `AGENTS.md`. Gnosis automatically gives
agents the [Doxa agent handbook](../guides/doxa-agent-handbook.md), including role selection,
transactions, service/provider boundaries, consistency, diagnostics, and installed-module guidance.
After `pnpm install`, open the application in a supported client. The client launches Gnosis over
stdio when it needs Doxa inspection, architecture review, documentation, or a bounded non-production
model read and stops it with the client session; there is no Gnosis daemon to start. Model reads use
stable model IDs and logical attributes, never raw SQL, and run through a fresh read-only execution.
A client may ask you to trust the project MCP server on first use. Project MCP configuration is
discovered when the client opens the workspace or starts a task. If creation, upgrade, or
`gnosis:install` ran inside an existing agent task, reload or reopen the client and start a new
task; the current task cannot gain newly registered tools. If a new task still lacks them, inspect
the client's MCP startup error; registration files alone do not prove that the server initialized.
Praxis uses a portable repository-relative Node launcher for Codex, Claude Code, Cursor, and VS
Code. Nested applications pass their repository-relative root to `doxa mcp --cwd=...`; generated
configuration stays portable across machines without relying on an undocumented client-specific
`cwd` field.

If Gnosis is absent or version-mismatched, agents must stop Doxa-specific structural and
architectural changes until the startup problem is resolved. The manifest explains application
structure but cannot reveal an unstated business invariant, so architecture review also requires an
explicit atomic, after-commit, or eventual consistency requirement.

Run `pnpm doxa gnosis:install --agent=all` only to regenerate deleted or customized registration.
`doxa mcp` is the client entrypoint and protocol-debugging command, not an ordinary startup step.
