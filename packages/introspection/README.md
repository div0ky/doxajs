# `@doxajs/introspection`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Typed, deterministic inspection records derived from the validated Doxa application manifest. Praxis
and Gnosis share this package so human and agent tooling cannot develop competing interpretations of
an application.

The bounded graph includes the optional permission-source identity, declared ability catalog,
dependencies, scope, and provenance. Introspection never invokes the source or reads application
permission records.

Ordinary application code should not import this package.

Schema 2 adds provider and ordinary-service surfaces, component dependency and consumer
explanations, effective transaction behavior, canonical folder guidance, and stable advisory
diagnostics. Folder diagnostics describe misleading provider/service names and any unambiguous
role-folder mismatch without changing path-independent runtime semantics.
