# 0036: Make Gnosis Doxa's Version-Matched Architectural Authority

- **Status:** Accepted
- **Accepted:** 2026-07-30
- **Amends:** [0013: first-party AI engineering MCP](0013-first-party-ai-engineering-mcp.md)
- **Specification:** [Gnosis](../specifications/gnosis.md)

## Decision

Gnosis will ship a canonical, version-matched agent handbook and expose it automatically through MCP
instructions, managed agent guidance, deterministic tools, and resources. An agent must be able to
choose and explain Doxa roles, scopes, transaction ownership, dependency boundaries, consistency,
and canonical organization without reading framework source or the contributor-facing manifesto.

The handbook is structured package data. Public documentation renders from the same catalog.
`@doxajs/introspection` combines the compiled manifest with protocol-independent component
explanations and architecture diagnostics; `@doxajs/gnosis` combines that application truth with the
installed handbook. Praxis JSON generation and MCP use the same assembled knowledge.

## Required programming model

The automatically disclosed model includes these rules:

- Actions are primary synchronous mutation boundaries.
- Job attempts are independent top-level writable boundaries.
- Queries are read-only.
- Ordinary services are constructor-injected and join the caller's execution and transaction.
- Actions and Jobs may share a service without calling one another.
- Actions, Queries, and Jobs may not directly or transitively reach `ActionBus`.
- `Feature.provides` exports ordinary services; `Feature.providers` selects singleton
  infrastructure.
- Local, after-commit, and queued reactions have materially different guarantees.
- Canonical folders communicate intent but never carry runtime meaning.

Architecture review requires explicit business invariants and an atomic, after-commit, or eventual
consistency requirement. Gnosis does not infer business intent from the manifest. Atomic invariants
use direct service collaboration inside one Action or Job transaction. After-commit work may not
roll back the original mutation. Queued work runs in a later execution; a queued Listener may
dispatch an Action as a new top-level operation, while a Job attempt owns its writable transaction
directly.

## Enforcement and diagnostics

The compiler rejects direct and transitive `ActionBus` reachability from Actions, Queries, and Jobs
with a stable diagnostic and the ordinary-service remedy. Gnosis derives advisory diagnostics when
provider/service names or an unambiguous role-folder mismatch miscommunicates the compiled role.
Folder advisories never change ownership, registration, scope, or runtime behavior.

Every diagnostic links to a stable handbook guide. The compiler and Praxis enforce validity; Gnosis
explains the rule, rationale, alternatives, and effective application behavior.

## Boundary

- Gnosis remains local, stdio-only, read-only, deterministic, and closed-world.
- The compiled manifest remains authoritative for application structure.
- Gnosis does not scan source, execute arbitrary code, access the network, or read the manifesto.
- Core guidance is always available; installed first-party module guidance is selected from compiled
  plugin and provider-capability metadata.
- Existing MCP tools remain additive and compatible within the controlled prerelease.
- The manifest format does not change for this decision.
- Introspection, Gnosis knowledge, and protocol-adapter schemas version independently.

If matching Gnosis guidance is unavailable or version-mismatched, managed guidance instructs agents
to stop Doxa-specific structural and architectural changes and report the startup or version
failure. Unrelated work may continue.

## Alternatives considered

### Bundle the raw manifesto

Rejected. The manifesto contains contributor authority, historical decisions, and implementation
proofs that are too broad for application agents and difficult to version as a focused product
contract.

### Continue with brief searchable summaries

Rejected. Short prose leaves agents to infer transaction, role, and consistency semantics and
recreates the misuse Gnosis exists to prevent.

### Scan application and framework source

Rejected. Source scanning would create a second interpreter, weaken deterministic inspection, and
make Gnosis dependent on private implementation details.

### Treat folder conventions as compiler semantics

Rejected. Paths remain organizational guidance; explicit Feature declarations and the manifest own
runtime meaning.

## Consequences

- Package size increases because the complete handbook ships with Gnosis.
- Handbook changes require schema-aware tests, public documentation parity, and changesets.
- Architecture advice is deterministic only for explicitly supplied business intent.
- Compiler enforcement may reject applications that previously reached `ActionBus` from nested
  operation graphs even though runtime dispatch would fail later.
- Agents receive the framework's intended answer before choosing application structure.
