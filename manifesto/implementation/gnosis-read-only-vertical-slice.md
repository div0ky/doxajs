# Gnosis Read-Only Local Engineering Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-14
- **Specification:** [Gnosis](../specifications/gnosis.md)

Gnosis now runs as a client-owned local MCP stdio process. Praxis creates project-scoped
registration for Codex, Claude Code, Cursor, and VS Code in new applications and applies the same
registration as an upgrade recipe. Each client launches the application's installed Praxis
`doxa mcp` entrypoint on demand through a portable repository-relative Node command; developers do
not start a daemon or standing process. The installer updates only the Gnosis entry and preserves
unrelated agent configuration. It also creates or updates one marked Doxa guidance block in the root
`AGENTS.md`, preserving guidance outside that block and failing closed on malformed or duplicate
markers. Registration is discovered when a client opens the workspace or starts a task; Praxis
output and the managed guidance now state that creation or upgrade inside an existing task requires
a client reload or reopen and a new task before Gnosis tools can appear. The generated launcher
selects the application with a repository-relative binary path and an explicit
`mcp --cwd=<application>` argument, so registration files contain no machine-specific absolute paths
and do not depend on an undocumented client-specific `cwd` field.

Praxis compiles the application through the ordinary development build path and passes the resulting
manifest directly to Gnosis; the server never scans source, boots the application, or trusts a
separately discovered artifact.

`@doxajs/introspection` validates the manifest and build hash, derives typed deterministic graph and
role records, bounds lists, redacts credential-shaped values, and owns the generated Gnosis
knowledge contract. Its schema 2 records providers, services, component dependency and consumer
relationships, effective transaction behavior, and advisory architecture diagnostics. Gnosis
knowledge schema 3 combines those application facts with the installed handbook. Praxis JSON and MCP
use the same assembled knowledge.

This historical slice added declared model relationships, related and pivot model IDs, and logical
key metadata to the then-current manifest format. The compiler resolves relationship helper
declarations against models selected by Features and fails closed when a relationship points outside
the application graph.

`@doxajs/gnosis` uses the pinned official TypeScript MCP SDK. It exposes application information,
graph, routes, models, actions, queries, events, listeners, observers, jobs, schedules, policies,
permission sources, commands, and deterministic version-matched documentation search. All tools are
read-only, idempotent, bounded, and closed-world. Unknown models return stable structured errors.

The architectural-authority expansion adds a package-owned handbook schema with stable guides for
the programming model, every framework role and generator, scope/delivery/broadcast/lifecycle
capabilities, orchestration and consistency, authorization, testing, deployment, diagnostics, and
installed first-party modules. MCP protocol adapter 2 supplies concise initialization instructions
plus `get_programming_model`, `explain_role`, `explain_component`, `list_services`,
`list_providers`, `review_architecture`, and `read_doc`. The same catalog renders the public Doxa
agent handbook and managed `AGENTS.md` guidance.

Architecture review requires explicit invariants and consistency intent. Its executable reminder
fixture proves that `CreateNotification` and `DeliverDueReminders` both depend on one
`NotificationCreator` ordinary service exported through `Feature.provides`; the Action or Job owns
the writable transaction and the service joins it. Atomic review rejects nested Action dispatch and
queued-listener substitution. Missing consistency returns `insufficient-intent`.

The compiler now rejects direct and transitive `ActionBus` reachability from Actions, Queries, and
Jobs through `DOXA-COMPILER-ARCH-001`. The compiler build result and Introspection expose matching
handbook-linked warnings when provider/service names or an unambiguous role-folder mismatch
miscommunicates the compiled role. Praxis prints those advisories for human-facing builds, while
paths remain semantically inert.

The sole application-data capability is `query_models`. It accepts a stable model ID, explicitly
selected logical fields, bounded comparison filters and ordering, and at most 100 rows. Praxis boots
the matching artifact with the restricted `model-reader` profile in a fresh authenticated
non-production console execution. The profile starts only the transaction-provider dependency
closure, uses Doxa's read-only `ModelSession` without application model observers, disables
application logging and diagnostic adapters, and always shuts the runtime down. The tool refuses
production, raw SQL, physical table and column names, arbitrary expressions, and mutations.

The package is an optional Praxis dependency and is absent from production installations performed
with `--prod --no-optional`. Remote transport, unrestricted application-data access, logs, tests,
arbitrary execution, and mutations remain outside this slice.

Executable evidence lives in `tests/gnosis.test.ts`, including the reminder architecture, in-memory
MCP instructions/tools/resources, and a real client launched from generated registration. Compiler
fixtures cover direct and transitive nested Action reachability. Packaging proves the executable
handbook ships without repository docs or manifesto files. Praxis generation and upgrade tests,
package audits, boundary audits, documentation audits, and the repository verification gate cover
the remaining contract.
