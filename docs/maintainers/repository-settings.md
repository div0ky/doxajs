# Repository Settings

After the workflows reach `main`, configure a GitHub ruleset for the default branch:

- Require pull requests and one approving review.
- Dismiss stale approvals and require approval of the latest reviewable push.
- Require resolved conversations.
- Require `CI / Verify`, `CI / PostgreSQL 16 compatibility`,
  `Dependency review / dependency-review`, and CodeQL checks.
- Block force pushes and branch deletion.
- Require signed commits when every active maintainer can comply.
- Restrict workflow changes to CODEOWNERS review.

Enable the dependency graph, Dependabot alerts and security updates, secret scanning, push
protection, private vulnerability reporting, code scanning, and GitHub Discussions. Disable other
unused repository features instead of leaving unmaintained support surfaces visible.

## npm publication

1. Reserve the `@doxajs` npm organization and require two-factor authentication.
2. Bootstrap each public package once if npm requires an initial owner publication.
3. Configure `release.yml` as the trusted publisher for every package and restrict token-based
   publication afterward.
4. Protect the `npm` GitHub environment and require maintainer approval.
5. Publish prereleases under the tag configured by Changesets prerelease mode. The current release
   train uses `alpha`; do not introduce a parallel `next` channel unless a release decision changes
   `.changeset/pre.json`, upgrade guidance, and installation documentation together.

Required pull-request CI is the comprehensive validation gate: formatting, lint, type checks,
website and field-guide builds, coverage, architecture and documentation audits, Changesets status,
package validation, the production dependency audit, PostgreSQL compatibility, dependency review,
and CodeQL must pass before merge.

The trusted `release.yml` workflow deliberately does not repeat `pnpm verify`. When Changesets finds
unpublished package versions, `pnpm release` rebuilds and packs every public package, validates the
published file and type surfaces, installs the packed artifacts into clean consumers, rejects
forbidden production dependencies, reruns the production vulnerability audit, and only then invokes
plain `changeset publish`. Any failed release check prevents publication. The workflow retains
`id-token: write`, the protected `npm` environment, npm provenance metadata, and no npm token so
publishing continues through npm's OIDC trusted publisher.

`setup-node` caches only pnpm's content-addressed store. Release build outputs and TypeScript build
metadata use an exact content-derived cache key with no fallback restore key; changes to the
lockfile, TypeScript configuration, package metadata, or package source force a clean rebuild.
