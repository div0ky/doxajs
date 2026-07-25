# `@doxajs/praxis`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Praxis is Doxa's canonical generator and command suite. It owns application generation, compilation,
development hot reload, migrations, runtime roles, inspection, recovery, Drizzle Studio, Gnosis
knowledge, and Theoria operations.

```sh
pnpm dlx @doxajs/praxis new MyApplication
cd my-application
pnpm install
pnpm dev
```

Run `doxa --help` for the complete command surface.

Install Doxa's optional realtime broadcasting core with `doxa add keryx`. Praxis enables
`framework.broadcasting` and scaffolds the web listener, signed worker publish path, readiness
check, same-origin browser authorization route, and optional Redis topology. Keryx is not added to
`Application.plugins`.

Praxis follows a Laravel-like migration lifecycle with developer-authored, forward-only SQL. Use
`doxa make:migration <Name>` to create a timestamped stub, `doxa migrate:status` to inspect pending
or drifted files, and `doxa migrate` to apply and track them. Models do not generate DDL, and
Drizzle Studio is an inspection tool rather than a schema-diff or migration generator.

Use `doxa permission-source:list` (or `--json`) to inspect the selected application permission
source and its declared abilities without evaluating runtime permission records.

`doxa model:list` reports mapped-table migration management and runtime read-only status as
independent settings, alongside the declared physical projection, primary key, and concurrency
source.

Generate the source with
`doxa make:permission-source Feature/ApplicationPermissions --abilities=contact.read,contact.update`.
Use `doxa make:service Feature/ApplicationAccess --provide` when its ordinary service adapter must
cross a Feature boundary.

Praxis registers the local read-only Gnosis MCP server with Codex, Claude Code, Cursor, and VS Code
when it creates or upgrades an application and maintains a Doxa guidance block in the root
`AGENTS.md`. Open the repository in a supported client; the client starts and stops Gnosis on demand
in the application workspace, including when the application is nested in a monorepo. Along with
compiled application inspection and documentation, Gnosis can perform bounded non-production model
reads through Doxa's read-only persistence path. Some clients ask you to trust a project MCP server
the first time they use it. Clients discover project MCP configuration when opening the workspace or
starting a task. After creation, upgrade, or `gnosis:install`, reload or reopen the client and start
a new task; an already-running task cannot acquire the newly registered tools. If a new task still
lacks them, inspect the client's MCP startup error; registration files alone do not prove that the
server initialized. Praxis writes Codex's application working directory as an absolute path because
Codex does not anchor a configured relative MCP working directory to the task workspace, while
preserving each other client's own path convention.

Regenerate one or more project registrations after removing or customizing them:

```sh
pnpm doxa gnosis:install --agent=codex,claude
```

`doxa mcp` is the underlying stdio entrypoint for clients and protocol diagnostics, not a process
developers normally start themselves.

Upgrade an existing application with a reviewable plan and post-install validation:

```sh
pnpm doxa upgrade --dry-run
pnpm doxa upgrade --verify
```

For applications whose installed Praxis predates `doxa upgrade`, bootstrap once with
`pnpm dlx @doxajs/praxis@alpha upgrade`.
