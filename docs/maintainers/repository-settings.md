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
6. Keep `latest` absent from every public package until the accepted 1.0 maturity bar is met.
   Prerelease installation and upgrade guidance must use `@alpha` or an exact version.

## Alpha release state machine

Ordinary feature pull requests are the comprehensive validation boundary. `CI / Verify` runs
`pnpm verify`, including formatting, lint, type checks, website and field-guide builds, coverage,
architecture and documentation audits, Changesets status, package validation, and the production
dependency audit. `CI / PostgreSQL 16 compatibility` runs the container-backed conformance suite.
Dependency review and CodeQL remain separate required checks. CI does not repeat those checks on a
`main` push after the reviewed pull request merges.

Every merge to `main` lets Changesets create or update `changeset-release/main`. Its
`pnpm version:packages` command:

1. applies `changeset version`;
2. synchronizes the public Gnosis handbook to the generated package version; and
3. writes `.changeset/release-candidate.json` with the exact `alpha` version and complete public
   package set.

The generated version pull request uses the same required `CI / Verify` check name, but runs
`pnpm release:validate` instead of the feature suite. That release-specific gate rebuilds every
package, packs it, validates required runtime and declaration files, runs Publint and Are The Types
Wrong, installs the tarballs into clean consumers, rejects forbidden production dependencies, checks
the fixed coordinated package set and internal workspace dependency contract, and compares the
public handbook with the built Gnosis handbook. The PostgreSQL compatibility job is skipped because
a generated version commit changes release metadata rather than runtime behavior.

Changesets currently opens that pull request with the repository `GITHUB_TOKEN`. GitHub may place
the resulting pull-request workflows in an approval-required state; a maintainer must approve those
runs before merging. Avoiding that approval requires separately authorizing a narrowly scoped GitHub
App installation token or personal access token for version-PR creation.

When the version pull request merges, `release.yml` notices that the release-candidate manifest
changed in that exact `main` commit. It checks out the immutable event SHA again inside the
protected `npm` environment and runs only `pnpm release:publish`. The command repeats package
artifact validation, confirms `HEAD` equals the selected full SHA, preflights registry state, and
invokes plain `changeset publish`. It then requires every coordinated package version and every
`alpha` dist-tag to match, and requires `latest` to remain absent, before the job succeeds.
`id-token: write`, package `publishConfig.provenance`, and the absence of npm tokens preserve npm
OIDC trusted publishing and provenance.

After publication succeeds, a separate least-privilege job creates the complete public package tag
set at the same immutable release commit. Existing tags at that commit are accepted, missing tags
are created, and any tag that resolves to another commit fails closed before anything is pushed.

### Retry an alpha publication

The preferred retry is **Re-run failed jobs** on the failed release run; GitHub retains its original
push SHA. If a separate run is needed, manually dispatch the **Release** workflow and enter the full
40-character version-commit SHA. The selector rejects branch names, shortened SHAs, commits not
merged into `main`, and candidates whose package versions, fixed group, internal dependencies,
handbook, or manifest disagree.

The registry preflight treats an already complete candidate as a successful no-op and lets
Changesets fill packages missing from a partial attempt. It refuses a retry when any package already
has a newer `alpha` tag, preventing tag rollback. New Changesets or feature merges on `main` cannot
join a retry because both automatic and manual publication check out the selected candidate commit,
not the current branch tip.

Do not dispatch the workflow with a feature commit. Ordinary `main` pushes do not modify the
release-candidate manifest and therefore skip publication.

`setup-node` caches pnpm's content-addressed store. Release build outputs are rebuilt from the
selected commit rather than restored from a mutable artifact cache.
