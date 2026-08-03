# Upgrading Doxa

Doxa packages use one fixed version while the framework is pre-1.0. Praxis upgrades every existing
first-party dependency together, aligns the supported Node and pnpm toolchain, updates the lockfile,
and validates the application with the newly installed CLI.

Preview the exact changes first:

```sh
pnpm doxa upgrade --dry-run
```

Then commit or stash application work and upgrade:

```sh
pnpm doxa upgrade
```

The default target resolves npm's sole moving `latest` dist-tag. The version itself communicates
whether that newest release is alpha, beta, a release candidate, or stable. Pin a target when
reproducibility requires it:

```sh
pnpm doxa upgrade --to=0.1.0-alpha.5
```

Applications created before Praxis provided this command need one bootstrap invocation. It runs the
current CLI against the existing application; subsequent upgrades use the locally installed CLI:

```sh
pnpm dlx @doxajs/praxis upgrade --dry-run
pnpm dlx @doxajs/praxis upgrade
```

## Safety contract

Praxis:

- refuses to mutate a dirty Git worktree unless `--force` is explicit;
- changes only existing first-party package entries, so it does not silently add capabilities;
- restores `package.json` if `pnpm install` fails and reports that the lockfile or `node_modules`
  may still need a fresh install;
- hands validation to the newly installed Praxis process;
- runs `doxa build` and the read-only `doxa migrate:status`, but never applies migrations;
- runs `pnpm test` when `--verify` is supplied; and
- executes only release-declared, built-in Doxa recipes—never arbitrary registry code.

Use `--skip-migration-status` only when a database is deliberately unavailable. A failed validation
leaves the upgraded packages installed so the application error can be fixed and the named command
rerun.

Doxa uses forward-only migrations. Downgrading code across a completed schema migration is not
assumed safe, and Praxis refuses version downgrades. Read the release notes before applying a
breaking prerelease upgrade; those notes must include explicit application, manifest, operational,
and migration guidance.

Before the first stable release, a release may explicitly re-baseline Doxa-owned framework schemas
instead of preserving alpha migration history. Such a release requires recreating prerelease
databases; it must never present rewritten migration checksums as a compatible forward migration.

## Keryx protocol v3

Protocol v3 adds registered, authenticated `RealtimeCommand` ingress and deliberately breaks
protocol v2. Upgrade `@doxajs/core`, `@doxajs/compiler`, `@doxajs/runtime`, `@doxajs/keryx`, and
`@doxajs/realtime` together. Realtime clients now offer `doxa.realtime.v3`; earlier clients cannot
connect to a v3 server.

Deploy protocol v3 as a coordinated cutover across every web replica, worker role, and browser
client. The signed worker publish envelope also carries the protocol version, so a rolling fleet
must not mix v2 and v3 web or worker processes behind shared routing. This upgrade requires no
database migration or new environment variable, but all realtime participants must change together.

Applications must declare commands in `Feature.realtimeCommands` and provide a Standard Schema,
declared non-public ability, throttle, and optional bounded timeout. The ability may be granted by a
`PermissionSource`; a resource `Policy` may narrow it using the validated input. Replace
application-specific socket frames with `Realtime.command()`. Do not move durable Action behavior to
commands: commands create no command-specific durable, retry, replay, journal, or outbox record.
Their required authorization decisions still use Doxa's normal authorization audit and telemetry
path. Command handlers own no writable Unit of Work, while authorization and QueryBus reads may use
bounded read-only sessions.

## Keryx protocol v2

The alpha release that introduced Keryx protocol v2 deliberately breaks protocol v1. Upgrade
`@doxajs/keryx` and `@doxajs/realtime` together. Remove an application-authored
`ApplicationBroadcasting extends Keryx` provider, run `pnpm doxa add keryx`, and keep Keryx out of
`Application.plugins`.

Deploy web and worker roles with one shared `DOXA_KERYX_SECRET`. Generated Compose supplies
`DOXA_KERYX_PUBLISH_URL`; other platforms set it to the private origin of the web role. One web
replica remains `DOXA_KERYX_TOPOLOGY=single`. Multiple web replicas must set
`DOXA_KERYX_TOPOLOGY=redis`, provide `DOXA_KERYX_REDIS_URL`, and route only instances whose Keryx
`GET /ready` succeeds.

When application HTTP and the browser-facing Keryx listener use different hostnames, configure
`@doxajs/realtime` with the generated same-origin `/broadcasting/authorize` path (including any
reverse-proxy prefix). Do not share the Doxa host-only session cookie across subdomains. Upgrade
Keryx and Realtime together because ticket admission uses the `doxa.realtime.v2` WebSocket
subprotocol offer.
