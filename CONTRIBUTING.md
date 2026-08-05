# Contributing to Doxa

Doxa exists to make the right application architecture feel obvious. Contributions should preserve
that standard: opinionated, magical where safe, deterministic beneath the surface, trivial for
Gnosis to explain, and difficult to misuse.

Doxa's packages and repository are public, but its supported adoption program and roadmap are
closed. Midtown Home Improvements is currently the sole supported consumer. An external contribution
does not create compatibility, support, roadmap, or production-readiness commitments.

## Before opening a change

- Use GitHub Discussions or an issue for substantial new behavior before investing in an
  implementation.
- Security vulnerabilities must follow [SECURITY.md](SECURITY.md), never a public issue.
- Architectural changes require a decision record under `manifesto/decisions/`.
- Ordinary fixes should remain as small as the complete behavior permits.

## Development setup

Doxa supports Node.js 26.6 or newer within the 26.x line and pnpm 11.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env
docker compose up -d postgres
pnpm doxa migrate
pnpm dev
```

Run the complete local acceptance gate with:

```sh
pnpm verify
```

## Repository boundaries

- Application-facing vocabulary belongs in `@doxajs/core`.
- Application code must not import Hono, Drizzle, pg-boss, telemetry vendors, provider SDKs, or
  private framework implementation types.
- Packages communicate only through declared exports and declared dependencies.
- `@doxajs/manifest` remains inert and cannot depend on runtime, compiler, Praxis, testing, or an
  infrastructure adapter.
- Production runtime boot consumes prebuilt artifacts and never compiles source.
- Folder names have no runtime meaning in generated Doxa applications.

Read [the architecture](manifesto/architecture.md), [principles](manifesto/principles.md), and
[accepted decisions](manifesto/decisions/index.md) before changing a framework boundary.

## Tests

- Focused unit tests should live with the package or focused suite they prove.
- PostgreSQL, queue, authentication, migration, and multi-process behavior require integration
  evidence.
- Public package changes require packed-consumer evidence, not only workspace imports.
- Generator changes require a clean generated-application fixture.
- Bug fixes require a regression test that fails for the original behavior.

## Commits and pull requests

Every commit must be signed off under the [Developer Certificate of Origin](DCO):

```sh
git commit -s -m "Describe the change"
```

Pull requests must explain the user-visible outcome, tests run, compatibility impact, and any
remaining risk. Add a Changeset for every change that affects a published package. Documentation,
test-only, and repository-internal changes may omit one when the pull request explains why.

## Compatibility

Doxa is pre-1.0. Breaking changes are possible, but they must be deliberate, documented, and
released through the normal versioning process. Stable IDs, manifest formats, migrations, HTTP
envelopes, and security boundaries never change accidentally.
