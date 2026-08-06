# `@doxajs/manifest`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The versioned, serializable, inert manifest contract shared by the Doxa compiler and runtime.
Ordinary applications should use `@doxajs/core` instead of importing this package.

Manifest formats fail closed when compiler and runtime compatibility do not match. The package has
no dependency on application code, runtime construction, or TypeScript compilation. Boundary
validation also rejects duplicate configuration IDs and application permission sources that claim
the framework-owned `accounts.impersonation.stop` ability, including otherwise hash-consistent
artifacts produced outside the semantic compiler.

Format 6 adds complete declared model attribute type/nullability and physical projection contracts,
resolved `column`/`xmin`/`none` concurrency sources, plus independent mapped-table `managed` and
`readOnly` settings. Old artifacts fail closed with a `doxa build` rebuild diagnostic.

See the
[manifest architecture](https://github.com/div0ky/doxajs/blob/main/manifesto/architecture.md) for
the compatibility contract.
