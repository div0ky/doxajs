# Observability, OpenTelemetry, and Theoria

Doxa emits one framework-owned stream of structured logs, metrics, spans, and semantic observations.
Applications select telemetry and observation sinks independently:

- `@doxajs/opentelemetry` exports standards-compatible traces and metrics to a registered
  OpenTelemetry SDK.
- `@doxajs/theoria` retains redacted semantic execution evidence in PostgreSQL and presents both a
  hierarchical waterfall and a causal timeline.

Use them together. OpenTelemetry connects Doxa to service-wide tracing, metrics, alerting, and SLO
systems. Theoria explains Doxa-specific actions, queries, model operations, policies, reactions,
events, jobs, tools, and failures. Neither replaces durable audit or business records.

## Distributed tracing

Every admitted request, job, schedule, command, WebSocket message, or test receives a new execution
span. Incoming W3C `traceparent` context becomes its parent. Doxa-owned timed boundaries create
child spans automatically, including routes, actions, queries, transactions, model persistence and
query operations, policies, listeners, reactions, jobs, queues, communications, broadcasts, and AI
work.

Delayed, retried, fanned-out, or multi-source work may carry explicit span links where a single
parent would misstate causality. Business `correlationId` and `causationId` remain independent from
trace parentage. The first-party queue adapter retains actual attempt trace identities until a job
is terminal, keeping retry links valid across worker replacement and SDK-assigned span IDs.

## OpenTelemetry

Install the adapter:

```sh
pnpm doxa add opentelemetry
```

Praxis adds it to the literal application plugin list:

```ts
import { DoxaApplication, type DoxaFrameworkConfiguration } from '@doxajs/core'

export class Application extends DoxaApplication {
  plugins = ['@doxajs/opentelemetry'] as const
}
```

Initialize an OpenTelemetry Node SDK before importing or booting the application. Select the OTLP or
other exporter in that SDK; Doxa does not own exporter credentials or endpoint configuration. The
adapter adopts the SDK-reported trace and span identity at scope start, so exported spans, Theoria
observations, logs, queue envelopes, and response `traceparent` headers describe the same tree.
Without inbound context, the SDK owns the new root trace identity; with inbound context, Doxa
retains the admitted trace ID and the SDK supplies the child span ID.

## Transaction serialization diagnostics

Concurrent model operations inside one Query, Action, Job, or authorization session share one
transaction client and execute serially. Development and test runtimes warn once per affected model
session because `Promise.all` cannot add database parallelism there. Production omits that warning
log but records a `model` observation named `transaction serialization` and increments
`doxa.persistence.transaction.serialization.total`. Attributes include only model entity types and
operation names.

## Development Theoria

```sh
pnpm doxa add theoria
pnpm migrate
pnpm theoria
```

The default explorer binds to `127.0.0.1:4400`. The Timeline view preserves chronological semantic
facts and cross-execution causality. The Waterfall view groups timed work by trace parentage. Source
and worker execution links move between asynchronous parts of a correlation chain.

## Production diagnostics

Production recording must be explicit in `app.config.ts`:

```ts
export class Application extends DoxaApplication {
  plugins = ['@doxajs/theoria'] as const

  framework: DoxaFrameworkConfiguration = {
    theoria: {
      profile: 'production-diagnostics',
      productionEnabled: true,
      sampleRate: 0.1,
      includeKinds: ['execution', 'http', 'action', 'query', 'job', 'ai.operation'],
      includePhases: ['started', 'completed', 'failed'],
      minimumDurationMilliseconds: 5,
      maximumPending: 10_000,
      overflowPolicy: 'drop-oldest',
      batchSize: 200,
      flushIntervalMilliseconds: 100,
      hotRetentionDays: 3,
      warmRetentionDays: 30,
      maximumObservations: 5_000_000,
      poolMaximum: 4,
      serviceName: 'evergreen-worker',
      environment: 'production',
      release: '2026.07.16',
      instanceId: 'worker-7',
    },
  }
}
```

The recorder samples deterministically by execution, batches writes, bounds its pending queue, and
never delays application work when saturated. A production `NODE_ENV` cannot be downgraded by
resource-label configuration. `health()` reports queued, accepted, persisted, dropped, and failed
writes. Hot evidence stays in the indexed write table; older evidence moves into monthly warm
partitions. Pruning removes expired partitions and enforces the configured hot bound. Kind, phase,
exact-name, and minimum-duration filters run before persistence; duration filtering retains or
rejects both ends of a span together. Each record also persists application, service, environment,
release, and instance identity. `DOXA_RELEASE` and `DOXA_INSTANCE_ID` supply the latter two when
recorder options do not.

For protected non-loopback access, run:

```sh
THEORIA_ACCESS_TOKEN='<at-least-32-random-characters>' \
THEORIA_OPERATOR_ID='operator:aaron' \
pnpm doxa theoria --host=0.0.0.0
```

Praxis enables the `production-diagnostics` explorer profile, requires bearer authentication, and
emits an audit line for allowed and denied requests. Terminate TLS at a deliberately trusted
operator proxy. For direct integration, `listenTheoria()` also supports a fail-closed trusted-proxy
identity header with explicit proxy-address and operator allowlists plus a mandatory audit callback.

The explorer is read-only. Do not route it through ordinary application business middleware or
expose it anonymously.

## Privacy-safe AI evidence

AI adapters and application services inject `AiObservability` and provide only operational metadata:

```ts
const result = await this.ai.run(
  {
    kind: 'ai.operation',
    operationId: 'riley.classify-reply',
    provider: 'openai',
    model: 'configured-model-id',
  },
  async () => ({
    value: await classify(),
    outcome: {
      tokenUsage: { input: 120, output: 18 },
      finishReason: 'stop',
      outcome: 'qualified',
      reasonCode: 'classifier-approved',
    },
  }),
)
```

The public contract has no prompt, completion, tool-payload, SMS-body, phone-number, or customer-PII
fields. Model, tool, critic, and retry work receive spans and safe observations; recursive redaction
remains defense in depth.
