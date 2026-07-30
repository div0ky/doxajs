# Changesets

Published Doxa packages use one fixed version while the framework is pre-1.0. Add a Changeset for
every user-visible package change:

```sh
pnpm changeset
```

Choose the smallest accurate bump and explain the developer-visible outcome. Repository-only,
documentation-only, and test-only changes may omit a Changeset when the pull request says why.

Do not run `changeset version` directly for a repository release. The automated version PR uses
`pnpm version:packages` so the Gnosis handbook and immutable release-candidate manifest stay aligned
with the coordinated package version.
