# `@doxajs/testing`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The first-party test harness for Doxa applications. It boots real compiled manifests with safe
provider overrides and supplies HTTP, authentication, persistence, queue, schedule, cache,
communications, observation, logging, and telemetry fakes.

```sh
pnpm add -D @doxajs/testing vitest
```

Test-only behavior stays outside `@doxajs/core` and production applications.

The harness owns an isolated mutable clock. Freeze it at an `Instant` or `Graphite`, travel by a
`Duration`, and restore native time without changing global process time:

```ts
import { Duration, Instant } from '@doxajs/core'

const harness = await DoxaTestHarness.boot(Application)
harness
  .freezeTime(Instant.parse('2026-08-05T14:00:00Z'))
  .travel(Duration.parse('PT30M'))
  .restoreTime()
```

Clock changes affect work admitted through that harness only.

Acting-as helpers traverse the real compiled permission source and policy pipeline. Captured
authorization decisions identify source, policy, credential, and default-deny outcomes without
exposing raw permission facts.
