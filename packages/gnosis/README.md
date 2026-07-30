# `@doxajs/gnosis`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Gnosis is Doxa's local, read-only AI engineering server. Praxis registers it in project-scoped MCP
configuration when an application is created or upgraded. Open the application in Codex, Claude
Code, Cursor, or VS Code and the client starts and stops Gnosis automatically.

The registered command uses the application's installed Praxis package. Praxis compiles the current
application before connecting Gnosis over MCP stdio. Gnosis exposes bounded structured inspection
and version-matched local documentation from the compiled artifact. Its `query_models` tool may boot
that exact artifact in a fresh non-production, read-only console execution to retrieve explicitly
selected logical model fields; it does not accept SQL or expose mutation. Praxis also installs a
managed Doxa guidance block in the application's root `AGENTS.md`. Clients may require their normal
first-use project trust confirmation. Clients discover project MCP configuration when opening the
workspace or starting a task, so an agent task already running during creation or upgrade cannot
gain Gnosis tools. Reload or reopen the client and start a new task after registration changes. If
the new task still lacks them, inspect the client's MCP startup error; registration files alone do
not prove that the server initialized.

Model knowledge contains only compiler-declared logical/physical attributes, type/nullability,
relationships, concurrency source, `managed`, and `readOnly`. Gnosis does not inspect or expose
unrelated physical columns.

`list_permission_sources` exposes the compiled source catalog and graph metadata without loading
group memberships, user grants, or other runtime permission facts.

Gnosis also ships Doxa's complete version-matched agent handbook. MCP initialization and managed
guidance disclose the core programming model automatically. `get_programming_model`, `explain_role`,
`explain_component`, `list_services`, `list_providers`, `review_architecture`, and `read_doc`
provide deterministic detail without source or manifesto access.

Architecture review requires an explicit business invariant and atomic, after-commit, or eventual
consistency requirement. It explains transaction ownership, shared-service collaboration,
provider-versus-service semantics, rejected alternatives, and handbook-linked diagnostics. If
matching Gnosis guidance is unavailable, managed guidance requires agents to stop Doxa-specific
structural and architectural changes.
