# 0013: Build Gnosis as Doxa's First-Party AI Engineering Product

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Product name:** Gnosis
- **Package:** `@doxajs/gnosis`
- **Implementation:** Read-only local Phase 1 activated
- **Activated:** 2026-07-13
- **Architectural guidance:** Comprehensive authority activated by
  [0036](0036-gnosis-architectural-authority.md) on 2026-07-30
- **Decision owners:** Doxa maintainers

## Decision

Doxa will provide a first-party AI-assisted engineering product named **Gnosis**, built around a
local MCP server, version-aware documentation, generated guidelines, focused skills, application
inspection, and safe engineering workflows. Doxa will design its manifest, diagnostics,
documentation, CLI, and package metadata to power Gnosis. The local read-only Phase 1 is activated
now that the manifest is versioned, compiler provenance is stable, runtime boot is artifact-only,
and Praxis inspection is proven. Mutating workflows remain deferred until the shared operation
planner exists.

Gnosis includes more than an MCP transport. It combines:

- A Doxa-aware local MCP server.
- Version-aware framework and plugin documentation.
- Generated agent guidelines.
- On-demand agent skills.
- Structured application inspection.
- Safe, reviewable access to selected CLI and testing workflows.

## Why it is viable

Doxa already intends to compile one application manifest containing features, providers, routes,
models, actions, queries, policies, observers, listeners, jobs, schedules, schemas, scopes, and
source provenance. The CLI and diagnostics consume the same representation.

The MCP server can therefore adapt a stable Doxa introspection API rather than reconstructing the
application through runtime reflection. This makes the protocol layer comparatively small and keeps
agent behavior consistent with boot validation, generators, tests, and human-facing diagnostics.

## Activation boundary

The Phase 1 server must not freeze Praxis presentation strings or create a second application
scanner. Activation therefore includes a protocol-independent typed introspection package shared by
Praxis and Gnosis. It consumes the validated generated manifest and exposes bounded deterministic
records. The MCP package remains a thin transport adapter.

The following foundations are required as part of Phase 1 rather than deferred prerequisites:

- The application manifest has a versioned schema.
- Source locations and declaration provenance are reliable.
- `doxa inspect:*` commands expose stable structured results.
- Framework and plugin documentation is versioned and package-addressable.
- Configuration and diagnostics classify secret and sensitive values.

CLI mutation plans and diffs are required before Phase 3, not before the read-only local server.

## Boundary

The MCP server is a developer tool and local adapter over Doxa capabilities. It does not become the
source of truth for application discovery, schema, diagnostics, generation, or documentation.

```text
application manifest ─┐
diagnostics API       ├─> Doxa introspection API ─> CLI
documentation index  ┤                              └─> MCP server
operation planner    ┘
```

Every MCP capability should have a corresponding Doxa contract usable without MCP. Agent clients
must not receive privileged framework APIs unavailable to tests, diagnostics, or the CLI without an
explicit security reason.

## Initial transport

Gnosis's first server should be local-only and use MCP's stdio transport:

```text
doxa mcp
```

The AI client launches the command inside the application workspace. A remote Streamable HTTP
transport is deferred because it introduces authentication, tenancy, origin validation, network
exposure, and production-data concerns unrelated to the initial developer experience.

Praxis must make that launch declarative rather than procedural for the developer. New applications
receive project-scoped MCP configuration for supported agents, and framework upgrades add or update
the same registration without replacing unrelated agent configuration. The registered command uses
the application's installed Praxis package. `doxa mcp` remains available for protocol diagnostics,
but documentation must not instruct developers to start it as a standing process. Project MCP
configuration is discovered when the client opens the workspace or starts a task. Praxis must tell
developers to reload or reopen the client and begin a new task after registration changes, because
an already-running task cannot acquire a new tool surface. MCP clients do not share one
working-directory contract, so Praxis must register a portable repository-relative Node launcher.
Root applications use `./node_modules/@doxajs/praxis/dist/bin.js mcp`; nested applications use the
repository-relative installed binary plus `mcp --cwd=<application>`. This selects the application
before starting the installed Praxis package instead of embedding a machine-specific absolute path
or relying on an undocumented client-specific `cwd` field.

Doxa should use the official TypeScript MCP SDK behind a small protocol adapter and pin its version
through the Doxa compatibility contract.

## Read-only first surface

The initial MCP server should be read-only by default.

Recommended resources include:

```text
doxa://application/manifest
doxa://application/graph
doxa://routes
doxa://models/{model}
doxa://events
doxa://jobs
doxa://schedules
doxa://database/schema
doxa://docs/{package}/{version}
```

Recommended tools include:

```text
application_info
search_docs
inspect_graph
list_routes
describe_model
list_actions
list_queries
list_events
list_listeners
list_observers
list_jobs
list_schedules
migration_status
last_error
read_logs
list_commands
list_tests
run_tests
```

Tool names are illustrative. The specification must keep the surface focused so tool discovery does
not create context bloat.

## Generated agent guidance

Gnosis installation must create or update a managed Gnosis block in the repository-root `AGENTS.md`.
New applications receive the guidance automatically, upgrades refresh it, and `doxa gnosis:install`
restores it alongside project-scoped MCP registration. The writer preserves all application-owned
content outside the managed block and fails closed for malformed or duplicate managed markers.

The versioned guidance is owned by `@doxajs/gnosis` and must teach agents to prefer Gnosis's
structured inspection and documentation tools over path inference, raw database access, or
framework-private APIs. It must also distinguish missing tools in the current task from missing
registration and direct the developer to the client reload and new-task boundary after registration
changes. If tools remain absent in a new task, the guidance must direct the developer to the MCP
startup error rather than treating registration files as proof of initialization. Praxis owns the
filesystem merge because it already owns application creation, upgrades, and agent registration.

## Bounded model-data inspection

Gnosis may expose a read-only `query_models`-equivalent tool for local development. This is a
distinct application-data capability, not arbitrary SQL or application evaluation. It must:

- Resolve one declared model by stable manifest ID.
- Accept only logical model attributes and Doxa-owned comparison and ordering vocabulary.
- Require an explicit bounded field selection and cap predicates, ordering, returned rows, scalar
  input size, and serialized result size.
- Execute through a fresh admitted console execution and read-only `ModelSession` without model
  observer callbacks.
- Require the runtime to admit that entrypoint only for an authenticated system actor whose identity
  matches the actor ID over the console transport.
- Boot the runtime's named `model-reader` profile so only the transaction provider and its declared
  dependency closure participate in lifecycle.
- Return detached plain structured values before the execution closes.
- Recursively redact credential-shaped keys and values.
- Refuse production execution and never accept SQL, filesystem paths, commands, or expressions.

The MCP adapter receives this capability through a protocol-independent bridge supplied by Praxis.
`@doxajs/gnosis` does not import the runtime or persistence adapter, and the runtime method remains
usable by tests and non-MCP Doxa tooling.

## Mutating tools

Code generation, migrations, raw database access, job redrive, and arbitrary application evaluation
are not part of the initial read-only surface. The bounded model-data inspection contract above is
the only application-data exception.

When mutating tools are introduced, they must:

- Reuse Doxa's CLI operation planner.
- Return a dry-run plan or diff before applying.
- Require explicit user approval through the client where supported.
- Stay inside the declared workspace root.
- Refuse to overwrite user code silently.
- Respect dirty-worktree and conflict policies.
- Emit a structured audit record of the requested and completed operation.

An unrestricted Tinker-like evaluator or arbitrary SQL tool should not be exposed by default. If
either is ever supported, it requires a distinct high-risk capability, strict local-only policy,
limits, redaction, and explicit opt-in.

## Guidelines and skills

Doxa releases should ship versioned agent guidelines describing durable framework conventions.
Focused skills should be installable on demand for areas such as models, actions, testing, jobs,
authentication, and plugin development.

First-party plugins may contribute versioned documentation, guidelines, and skills through signed or
package-verifiable metadata. They may not inject executable MCP tools merely by being installed;
tool contribution requires a separate trusted extension contract.

The Doxa CLI should generate agent-specific configuration without making any one editor or coding
agent part of the framework contract.

## Documentation search

The first implementation may use a local, version-filtered documentation index. Semantic search or a
hosted embeddings service is an enhancement, not a prerequisite for the MCP server.

Search results must identify the package, exact supported version, source document, and relevant
section so agents do not combine incompatible framework releases.

## Security model

The developer MCP server must:

- Run as a development-only dependency and remain absent from production startup.
- Use stdio and the current workspace by default.
- Expose configuration keys and classifications without revealing secret values.
- Redact credentials, session tokens, password hashes, personal data, and provider secrets from logs
  and diagnostics.
- Treat database schemas as readable metadata but database contents as a separate privileged
  capability.
- Keep read operations bounded by size, time, and result count.
- Validate all tool inputs through Doxa's Standard Schema boundary.
- Return stable structured errors rather than raw internal exceptions.
- Record framework, manifest, protocol, and package versions in `application_info`.

## Manifest requirements created now

To keep this future capability easy, today's manifest and tooling contracts should include:

- Stable IDs for every feature and declared capability.
- Human-readable descriptions.
- Exact source file and declaration locations.
- Input and output schemas where applicable.
- Provider, scope, lifecycle, and dependency relationships.
- Route, policy, observer, listener, job, and schedule relationships.
- Framework and plugin package provenance and versions.
- Sensitivity and mutability classifications for inspectable values and operations.
- Machine-readable diagnostic codes and suggested remediation.

These fields benefit human tooling and testing even if the MCP server is never enabled.

## Effort assessment

A minimal read-only stdio MCP server should be straightforward once the introspection API exists.
The larger effort is a Boost-quality product: high-quality versioned documentation search, useful
guidelines and skills, safe mutation planning, agent installers, security review, and compatibility
testing across clients.

Doxa should treat that larger product as post-MVP developer experience work, not as a reason to
pollute or delay the core runtime.

## Required proof before activation

1. MCP and CLI inspection return the same application facts.
2. Tool schemas derive from stable Doxa contracts.
3. No secret values or private provider types cross the server boundary.
4. Read-only tools remain bounded and deterministic.
5. Agent configuration works with multiple MCP-capable clients.
6. Documentation search returns version-correct sources.
7. Mutating previews, when later enabled, exactly match the changes applied by the CLI.
8. Protocol upgrades remain isolated inside the MCP adapter.

## References

- [Gnosis AI-assisted engineering direction](../future/ai-assisted-engineering.md)
- [Doxa CLI and generator decision](0004-first-party-cli-generators.md)
- [Doxa OOP and manifest decision](0011-class-first-oop-container.md)
- [Laravel Boost](https://laravel.com/docs/12.x/boost)
- [Model Context Protocol server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts)
- [Official MCP SDKs](https://modelcontextprotocol.io/docs/sdk)
