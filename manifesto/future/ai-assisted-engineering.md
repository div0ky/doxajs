# Gnosis: AI-Assisted Engineering

- **Viability:** High
- **Direction:** Accepted
- **Product:** Gnosis
- **Package:** `@doxajs/gnosis`
- **Implementation:** Read-only local architectural authority active
- **Decision:** [0013: Gnosis](../decisions/0013-first-party-ai-engineering-mcp.md)
- **Architectural authority:**
  [0036: version-matched architectural authority](../decisions/0036-gnosis-architectural-authority.md)

Gnosis provides Doxa's Laravel Boost-like developer experience through a local MCP server,
version-aware documentation, automatic framework guidance, application inspection, and bounded model
queries. Focused agent skills and reviewable mutations remain future extensions.

## Product shape

Praxis registers Gnosis in project-scoped agent configuration. The coding agent owns the process
lifecycle and launches the application's installed framework CLI entrypoint on demand:

```text
doxa mcp
```

Developers do not run this as a standing process.

Project MCP configuration is discovered when the client opens the workspace or starts a task.
Creation, upgrade, or registration changes made inside an existing task require the developer to
reload or reopen the client and start a new task before Gnosis tools become available. If they
remain absent, the client startup error is authoritative; the presence of registration files alone
does not prove that Gnosis initialized.

The local server runs over stdio and gives compatible coding agents read-only access to the actual
Doxa application model: packages and versions, features, dependency graph, routes, models, actions,
queries, policies, events, observers, listeners, jobs, schedules, architecture diagnostics, and
version-matched documentation. Its one application-data tool performs bounded model reads through
Doxa's own read-only runtime path rather than accepting SQL.

Doxa generates a managed root `AGENTS.md` guidance block and project-scoped registration for
supported agents. Gnosis initialization, stable handbook tools, and installed-module guidance make
the matching package Doxa's architectural authority. Focused on-demand skills based on the framework
and first-party plugins remain future work.

## Architectural advantage

The MCP server does not need to discover Doxa from scratch. The same generated manifest powers boot
validation, the dependency container, runtime adapters, CLI inspection, generators, diagnostics,
testing, and future AI tooling.

That creates one chain of truth:

```text
TypeScript application
  -> Doxa compiler
  -> versioned application manifest
  -> introspection and diagnostics API
  -> CLI, tests, documentation tools, and MCP
```

If MCP requires a separate scanner, runtime boot, or application interpretation, the design has
drifted.

## Foundation contracts

The active implementation preserves these foundational contracts:

- Stable capability identifiers and descriptions.
- Source provenance and file locations.
- Machine-readable schemas and diagnostics.
- Structured JSON output for CLI inspection.
- Package and framework version information.
- Secret, sensitive, high-cardinality, and mutability classifications.
- Version-addressable framework and plugin documentation.

Operation planning and dry-run diffs remain prerequisites for future mutating tools. These
requirements improve Doxa's ordinary human tooling and keep the MCP adapter small.

## Implementation phases

### Active: Read-only local server and architectural authority

- Application and package information.
- Version-matched programming model, role, component, module, consistency, and documentation tools.
- Manifest and dependency-graph inspection.
- Routes, models, actions, queries, events, observers, listeners, jobs, schedules, policies,
  providers, services, permission sources, and commands.
- Architecture review and compiler-aligned diagnostics.
- Bounded non-production model queries.

Database schema and migration status, logs, recent errors, test discovery, and test execution remain
deferred.

### Active guidance and future skills

- Versioned Doxa engineering guidelines are active through MCP initialization and managed
  `AGENTS.md` generation.
- Installed first-party module guidance is active through compiled plugin and provider-capability
  metadata.
- Agent-specific project configuration is active for Codex, Claude Code, Cursor, and VS Code.
- Focused skills for common development workflows remain future work.

### Phase 3: Reviewable mutations

- Generator and codemod previews.
- User-approved application of CLI operation plans.
- Migration planning without automatic production application.
- Explicitly privileged operational tools where justified.

Remote application MCP endpoints and arbitrary evaluation are separate product decisions and are not
implied by this developer-tool direction.

## Success criteria

The capability succeeds when an AI coding agent can understand the exact Doxa version and real
application graph, find version-correct guidance, inspect framework behavior, run targeted tests,
and propose idiomatic changes without guessing private engine APIs or bypassing Doxa's safety model.
